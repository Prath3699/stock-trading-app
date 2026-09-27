/* =========================================================
   Home screen — top performing STOCKS (24h / last session)
   and recently viewed tickers. Stock movers come from real
   Stooq data when reachable; otherwise they fall back to the
   deterministic demo generator so the layout never breaks.
   ========================================================= */

(function () {
    "use strict";

    var $ = window.jQuery;

    function fmtP(v) {
        if (v == null || isNaN(v)) return "—";
        return (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
    }
    function fmtPrice(v) {
        if (v == null) return "—";
        var d = v < 1 ? 4 : 2;
        return "$" + v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
    }

    // ---- simulated % changes for offline/demo mode (deterministic per day) ----
    function simChanges() {
        var out = {};
        COINS.forEach(function (c) {
            var seed = 0;
            for (var i = 0; i < c.symbol.length; i++) seed = (seed * 31 + c.symbol.charCodeAt(i)) | 0;
            var r = mulberry(seed ^ Math.floor(Date.now() / 86400000));
            out[c.symbol] = (r() - 0.45) * 9;           // roughly -4% .. +5%
        });
        return out;
    }
    function mulberry(seed) {
        return function () {
            seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
            var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            (t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    var LAST_CHANGES = null;

    var COINS_URL = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=30&page=1&price_change_percentage=24h";
    var COINS = [
        { symbol: "BTC",   name: "Bitcoin" },
        { symbol: "ETH",   name: "Ethereum" },
        { symbol: "BNB",   name: "BNB" },
        { symbol: "SOL",   name: "Solana" },
        { symbol: "XRP",   name: "XRP" },
        { symbol: "ADA",   name: "Cardano" },
        { symbol: "DOGE",  name: "Dogecoin" },
        { symbol: "AVAX",  name: "Avalanche" },
        { symbol: "DOT",   name: "Polkadot" },
        { symbol: "LINK",  name: "Chainlink" },
        { symbol: "MATIC", name: "Polygon" },
        { symbol: "LTC",   name: "Litecoin" },
        { symbol: "TRX",   name: "TRON" },
        { symbol: "ATOM",  name: "Cosmos" },
        { symbol: "UNI",   name: "Uniswap" },
        { symbol: "ETC",   name: "Ethereum Classic" }
    ];

    async function loadMovers() {
        var changes = null;
        try {
            var rows = await cached("markets", 60000, 45000, function () {
                return cgFetch(COINS_URL, function (x) { return Array.isArray(x) && x.length; });
            });
            changes = {};
            rows.forEach(function (c) {
                if (c.price_change_percentage_24h_in_currency != null)
                    changes[(c.symbol || "").toUpperCase()] = c.price_change_percentage_24h_in_currency;
            });
        } catch (e) {
            changes = LAST_CHANGES || simChanges();     // stale-but-real beats blank; else demo
        }
        LAST_CHANGES = changes;

        var list = COINS
            .filter(function (s) { return changes[s.symbol] != null; })
            .map(function (s) { return { symbol: s.symbol, name: s.name, chg: changes[s.symbol] }; })
            .sort(function (a, b) { return b.chg - a.chg; });

        renderCards("#home_gainers", list.slice(0, 6), true);
        renderCards("#home_losers", list.slice(-6).reverse(), false);
        renderRecent();
    }

    function cardHtml(item, isUp) {
        var cls = item.chg >= 0 ? "up" : "down";
        var arrow = item.chg >= 0 ? "fa-caret-up" : "fa-caret-down";
        return '<button type="button" class="home_card" data-symbol="' + item.symbol + '" data-name="' + item.name + '">' +
            '<span class="hc_sym"><i class="fa fa-' + (isUp ? "arrow-up" : "arrow-down") + ' hc_icon"></i>' + item.symbol + '</span>' +
            '<span class="hc_name">' + item.name + '</span>' +
            '<span class="hc_chg ' + cls + '"><i class="fa ' + arrow + '"></i> ' + fmtP(item.chg) + '</span>' +
            '</button>';
    }

    function renderCards(sel, items, isUp) {
        $(sel).html(items.length
            ? items.map(function (i) { return cardHtml(i, isUp); }).join("")
            : '<div class="empty_note">No data yet — check your connection.</div>');
        $(sel + " .home_card").on("click", function () {
            openCoin(String($(this).data("symbol")), String($(this).data("name")));
        });
    }

    // ---- recently viewed (persisted by Store.trackRecent on every chart open) ----
    function renderRecent() {
        var rec = (window.Store && Store.recent) ? Store.recent() : [];
        if (!rec.length) {
            $("#home_recent").html('<div class="empty_note">Nothing here yet — open a ticker from Movers or Market to start your history.</div>');
            return;
        }
        $("#home_recent").html(rec.map(function (r) {
            return '<button type="button" class="recent_chip" data-symbol="' + r.symbol + '" data-id="' + (r.id || "") + '" data-name="' + (r.name || r.symbol) + '">' +
                '<i class="fa fa-clock-o"></i> ' + r.symbol + '</button>';
        }).join(""));
        $("#home_recent .recent_chip").on("click", function () {
            var sym = String($(this).data("symbol"));
            if (MARKETS[sym]) {                                   // known stock/coin pill
                App.openTicker(sym, null, null);
            } else {
                App.openTicker(sym, $(this).data("id"), $(this).data("name"));
            }
        });
    }

    // open a ticker from Home: known coin -> pill click; unknown -> add live coin
    function openCoin(symbol, name) {
        var known = Object.keys(MARKETS).find(function (k) { return MARKETS[k].name === name || k === symbol; });
        if ($('.asset_btn[data-asset="' + symbol + '"]').length || known) {
            App.openTicker(known || symbol, null, null);
        } else {
            var cgId = symbol.toLowerCase();                      // best-effort CoinGecko id
            App.addChartCoin(cgId, symbol, name || symbol);       // registers pill + selects it
            Trading.switchTab("chart");
        }
    }

    $(function () {
        loadMovers();
        setInterval(loadMovers, 120000);                          // refresh movers every 2 min
        $(document).on("candela:tab", function (e, tab) {          // re-render recent list when returning home
            if (tab === "home") renderRecent();
        });
        window.Home = { refresh: loadMovers };
    });
})();
