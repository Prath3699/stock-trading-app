/* =========================================================
   Store – shared app state: wallet, holdings, orders,
   transactions, watchlist. Persisted to localStorage under
   one key so every module (chart, trading, market list)
   reads/writes the same source of truth.
   ========================================================= */

(function () {
    "use strict";

    var KEY = "stocklab.store.v1";

    function today() { return new Date().toISOString(); }

    var DEFAULTS = {
        cash: 10000,                       // starting paper-money balance
        holdings: {},                      // { BTC: 0.0521, ... } in whole units
        avgCost: {},                       // { BTC: 43120.55 } average buy price
        orders: [],                        // limit orders: {id, side, symbol, qty, limit, status}
        transactions: [],                  // fills: {id, ts, side, symbol, qty, price, total}
        watchlist: ["AAPL", "TSLA", "NVDA"],  // symbols shown on Market tab
        recent: [],                        // recently viewed tickers (newest first): [{symbol,id,name,ts}]
        seq: 1
    };

    function load() {
        try {
            var raw = localStorage.getItem(KEY);
            if (!raw) return JSON.parse(JSON.stringify(DEFAULTS));
            var data = JSON.parse(raw);
            // merge with defaults so new fields survive upgrades
            for (var k in DEFAULTS) {
                if (!(k in data)) data[k] = JSON.parse(JSON.stringify(DEFAULTS[k]));
            }
            return data;
        } catch (e) {
            return JSON.parse(JSON.stringify(DEFAULTS));
        }
    }

    var db = load();
    var listeners = [];

    function save() {
        try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* private mode */ }
        listeners.forEach(function (fn) { try { fn(db); } catch (e) {} });
    }

    window.Store = {
        get: function () { return db; },
        save: save,
        onChange: function (fn) { listeners.push(fn); },

        // ---- portfolio helpers ----
        holdingValue: function (symbol, price) {
            return (db.holdings[symbol] || 0) * (price || 0);
        },
        totalValue: function (priceMap) {
            var v = db.cash;
            Object.keys(db.holdings).forEach(function (s) {
                v += (db.holdings[s] || 0) * (priceMap[s] || 0);
            });
            return v;
        },

        // ---- trading ----
        priceOf: function (symbol) {
            if (window.App && App.priceOf) { var p = App.priceOf(symbol); if (p) return p; }
            if (window.CoinPrices && CoinPrices[symbol]) return CoinPrices[symbol];
            return null;
        },

        marketOrder: function (side, symbol, qty, price) {
            var cost = qty * price;
            if (side === "BUY") {
                if (cost > db.cash + 1e-9) return { ok: false, error: "Insufficient cash" };
                db.cash -= cost;
                var prevQty = db.holdings[symbol] || 0;
                var prevAvg = db.avgCost[symbol] || 0;
                db.holdings[symbol] = prevQty + qty;
                db.avgCost[symbol] = prevQty > 0
                    ? (prevQty * prevAvg + cost) / (prevQty + qty)
                    : price;
            } else {
                if ((db.holdings[symbol] || 0) + 1e-12 < qty) return { ok: false, error: "Not enough " + symbol };
                db.cash += cost;
                db.holdings[symbol] = (db.holdings[symbol] || 0) - qty;
                if (db.holdings[symbol] <= 1e-12) {
                    delete db.holdings[symbol];
                    delete db.avgCost[symbol];
                }
            }
            var tx = { id: "T" + (db.seq++), ts: today(), side: side, symbol: symbol,
                       qty: qty, price: price, total: cost, type: "market" };
            db.transactions.unshift(tx);
            save();
            return { ok: true, tx: tx };
        },

        placeLimit: function (side, symbol, qty, limit) {
            if (side === "BUY" && qty * limit > db.cash + 1e-9) return { ok: false, error: "Insufficient cash" };
            if (side === "SELL" && (db.holdings[symbol] || 0) + 1e-12 < qty) return { ok: false, error: "Not enough " + symbol };
            var order = { id: "O" + (db.seq++), ts: today(), side: side, symbol: symbol,
                          qty: qty, limit: limit, status: "open" };
            db.orders.unshift(order);
            save();
            return { ok: true, order: order };
        },

        cancelOrder: function (id) {
            db.orders = db.orders.filter(function (o) { return !(o.id === id && o.status === "open"); });
            save();
        },

        // called by the engine whenever a live price crosses a limit
        checkLimitFills: function (priceMap) {
            priceMap = priceMap || {};
            var filled = [];
            db.orders.forEach(function (o) {
                if (o.status !== "open") return;
                var p = priceMap[o.symbol] || Store.priceOf(o.symbol);
                if (!p) return;
                var hit = o.side === "BUY" ? p <= o.limit : p >= o.limit;
                if (!hit) return;
                var res = Store.marketOrder(o.side, o.symbol, o.qty, Math.min(p, o.limit) * (o.side === "BUY" ? 1 : 1));
                if (res.ok) { o.status = "filled"; filled.push({ order: o, tx: res.tx }); }
                else { o.status = "rejected"; filled.push({ order: o, error: res.error }); }
            });
            if (db.orders.some(function (o) { return o.status !== "open"; })) {
                db.orders = db.orders.filter(function (o) { return o.status === "open"; });
                save();
            }
            return filled;
        },

        toggleWatch: function (symbol) {
            var i = db.watchlist.indexOf(symbol);
            if (i >= 0) db.watchlist.splice(i, 1); else db.watchlist.push(symbol);
            save();
        },

        // ---- recently viewed tickers (for the Home screen) ----
        trackRecent: function (entry) {   // entry: {symbol, id, name}
            if (!entry || !entry.symbol) return;
            if (!Array.isArray(db.recent)) db.recent = [];
            db.recent = db.recent.filter(function (r) { return r.symbol !== entry.symbol; });
            db.recent.unshift({ symbol: entry.symbol, id: entry.id, name: entry.name, ts: today() });
            db.recent = db.recent.slice(0, 8);
            save();
        },
        recent: function () { return Array.isArray(db.recent) ? db.recent.slice() : []; },

        resetAccount: function () {
            db = JSON.parse(JSON.stringify(DEFAULTS));
            save();
        }
    };
})();
