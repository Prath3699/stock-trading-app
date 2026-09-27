/* =========================================================
   Trading module — order ticket (market/limit), qty % presets,
   live limit-order engine, orders tab, portfolio tab, header
   equity. All state lives in Store (js/store.js).
   ========================================================= */

(function () {
    "use strict";

    var $ = window.jQuery;

    // ---- number formatting ----
    function fmtUSD(v) {
        if (v == null || isNaN(v)) return "$0.00";
        var abs = Math.abs(v);
        var digits = abs < 1 ? 4 : 2;
        return "$" + v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    }
    function fmtQty(v) {
        return (Math.round(v * 1e6) / 1e6).toLocaleString("en-US");
    }

    // ---- current price provider (set by data-chart.js via App.priceOf) ----
    function spot(symbol) {
        return (window.App && App.priceOf) ? App.priceOf(symbol) : null;
    }

    var orderType = "market";

    // ================= ticket =================
    function bindTicket() {
        $(".ot_btn").on("click", function () {
            $(".ot_btn").removeClass("active");
            $(this).addClass("active");
            orderType = $(this).data("otype");
            $("#ord_limit_wrap").prop("hidden", orderType !== "limit");
            if (orderType === "limit" && !$("#ord_limit").val()) {
                var p = spot(window.ChartState ? ChartState.asset : "BTC");
                if (p) $("#ord_limit").val(p.toFixed(p < 5 ? 6 : 2));
            }
            updateSummary();
        });

        $("#ord_qty, #ord_limit").on("input", updateSummary);

        $(".pct_btn").on("click", function () {
            var pct = Number($(this).data("pct")) / 100;
            var symbol = currentSymbol();
            var p = orderType === "limit"
                ? (Number($("#ord_limit").val()) || spot(symbol) || 0)
                : (spot(symbol) || 0);
            if (!p) return toast("No price yet — try again in a second", false);
            var db = Store.get();
            var qty;
            // BUY sizes against cash, SELL sizes against holdings
            qty = _side === "SELL"
                ? (db.holdings[symbol] || 0) * pct
                : (db.cash * pct) / p;
            $("#ord_qty").val(fmtQty(qty));
            updateSummary();
        });

        $("#btn_buy").on("click", function () { submit("BUY"); });
        $("#btn_sell").on("click", function () { submit("SELL"); });
    }

    function currentSymbol() {
        return (window.ChartState && ChartState.asset) || "BTC";
    }

    function updateSummary() {
        var qty = Number($("#ord_qty").val()) || 0;
        var symbol = currentSymbol();
        var px = orderType === "limit" ? (Number($("#ord_limit").val()) || 0) : (spot(symbol) || 0);
        var total = qty * px;
        var db = Store.get();
        $("#ticket_summary").html(
            "Est. " + (lastSideGlobal() === "SELL" ? "proceeds" : "cost") + " — <b>" + fmtUSD(total) +
            "</b> &nbsp;·&nbsp; Cash — <b>" + fmtUSD(db.cash) + "</b>"
        );
    }
    var _side = "BUY";
    function lastSideGlobal() { return _side; }

    function submit(side) {
        _side = side;
        var symbol = currentSymbol();
        var qty = Number($("#ord_qty").val());
        if (!qty || qty <= 0) return toast("Enter a quantity first", false);

        if (orderType === "market") {
            var p = spot(symbol);
            if (!p) return toast("Waiting for price feed…", false);
            var res = Store.marketOrder(side, symbol, qty, p);
            if (!res.ok) return toast(res.error, false);
            toast(side + " " + fmtQty(qty) + " " + symbol + " @ " + fmtUSD(p), true);
        } else {
            var limit = Number($("#ord_limit").val());
            if (!limit || limit <= 0) return toast("Enter a limit price", false);
            var r = Store.placeLimit(side, symbol, qty, limit);
            if (!r.ok) return toast(r.error, false);
            toast("Limit " + side + " placed — " + fmtQty(qty) + " " + symbol + " @ " + fmtUSD(limit), true);
        }
        $("#ord_qty").val("");
        updateSummary();
    }

    // ================= limit engine =================
    // Every tick of the chart loop we check open orders against latest prices.
    setInterval(function () {
        var map = {};
        ["BTC", "ETH", "SOL", "DOGE"].forEach(function (s) {
            var p = spot(s); if (p) map[s] = p;
        });
        Store.get().orders.forEach(function (o) {
            var p = window.CoinPrices && CoinPrices[o.symbol];
            if (p) map[o.symbol] = p;
        });
        var fills = Store.checkLimitFills(map);
        fills.forEach(function (f) {
            if (f.tx) toast("⚡ Limit filled: " + f.order.side + " " + fmtQty(f.order.qty) + " " +
                f.order.symbol + " @ " + fmtUSD(f.tx.price), true);
            else toast("Limit " + f.order.id + " rejected: " + f.error, false);
        });
    }, 4000);

    // ================= orders tab =================
    function renderOrders() {
        var db = Store.get();
        var open = db.orders.filter(function (o) { return o.status === "open"; });
        $("#orders_count").text(open.length);

        function row(o, withCancel) {
            var p = spot(o.symbol);
            var dist = p ? ((o.limit - p) / p * 100) : null;
            return '<div class="order_row">' +
                '<div><span class="ord_side ' + (o.side === "BUY" ? "up" : "down") + '">' + o.side + '</span>' +
                ' <b>' + o.symbol + '</b></div>' +
                '<div class="ord_meta">' + fmtQty(o.qty) + ' @ ' + fmtUSD(o.limit) +
                (dist != null ? ' <span class="' + (dist >= 0 ? "up" : "down") + '">(' + (dist >= 0 ? "+" : "") + dist.toFixed(2) + '% vs mkt)</span>' : '') +
                '</div>' +
                (withCancel ? '<button class="btn cancel_btn" data-id="' + o.id + '">Cancel</button>' : '') +
                '</div>';
        }

        $("#orders_list").html(open.length
            ? open.map(function (o) { return row(o, true); }).join("")
            : '<div class="empty_note">No open orders.</div>');

        $("#history_list").html(db.transactions.slice(0, 30).length
            ? db.transactions.slice(0, 30).map(function (t) {
                return '<div class="order_row hist">' +
                    '<div><span class="ord_side ' + (t.side === "BUY" ? "up" : "down") + '">' + t.side + '</span>' +
                    ' <b>' + t.symbol + '</b></div>' +
                    '<div class="ord_meta">' + fmtQty(t.qty) + ' @ ' + fmtUSD(t.price) + ' · ' + fmtUSD(t.total) + '</div>' +
                    '<div class="ord_time">' + new Date(t.ts).toLocaleDateString() + '</div>' +
                    '</div>';
            }).join("")
            : '<div class="empty_note">No fills yet.</div>');

        $(".cancel_btn").off("click").on("click", function () {
            Store.cancelOrder($(this).data("id"));
            toast("Order cancelled", true);
        });
    }

    // ================= portfolio tab =================
    function renderPortfolio() {
        var db = Store.get();
        var symbols = Object.keys(db.holdings);
        var pnl = 0, holdingsVal = 0;
        var rows = symbols.map(function (s) {
            var p = spot(s) || 0;
            var avg = db.avgCost[s] || 0;
            var val = db.holdings[s] * p;
            var upl = (p - avg) * db.holdings[s];
            pnl += upl; holdingsVal += val;
            var cls = upl >= 0 ? "up" : "down";
            return '<div class="holding_row clickable" data-asset="' + s + '">' +
                '<div><b>' + s + '</b><div class="ord_meta">' + fmtQty(db.holdings[s]) + ' · avg ' + fmtUSD(avg) + '</div></div>' +
                '<div class="text-right"><div>' + fmtUSD(val) + '</div>' +
                '<div class="ord_meta ' + cls + '">' + (upl >= 0 ? "+" : "") + fmtUSD(upl) + '</div></div>' +
                '</div>';
        });
        $("#holdings_list").html(rows.length ? rows.join("") : '<div class="empty_note">No holdings yet — place a trade from the Chart tab.</div>');
        $("#pf_equity").text(fmtUSD(db.cash + holdingsVal));
        $("#pf_cash").text(fmtUSD(db.cash));
        $("#pf_pnl").text((pnl >= 0 ? "+" : "") + fmtUSD(pnl)).removeClass("up down").addClass(pnl >= 0 ? "up" : "down");
        $("#header_equity").text(fmtUSD(db.cash + holdingsVal));

        $(".holding_row.clickable").on("click", function () {
            var s = $(this).data("asset");
            $('.asset_btn[data-asset="' + s + '"]').trigger("click");
            switchTab("chart");
        });
    }

    // ================= tabs =================
    function switchTab(name) {
        $(".tab_btn").removeClass("active");
        $('.tab_btn[data-tab="' + name + '"]').addClass("active");
        $(".tab-pane").removeClass("active");
        $("#tab_" + name).addClass("active");
        if (name === "portfolio") renderPortfolio();
        if (name === "orders") renderOrders();
        if (name === "market" && window.Market) Market.refresh();
    }

    // ================= transactions list (chart tab) =================
    function renderTransactions(expanded) {
        var db = Store.get();
        var txs = db.transactions.slice(0, expanded ? 50 : 3);
        if (!txs.length) {
            $("#transactions_list").html('<div class="empty_note">No transactions yet. Place your first trade above!</div>');
            return;
        }
        $("#transactions_list").html(txs.map(function (t) {
            var cls = t.side === "BUY" ? "buy" : "sell";
            return '<div class="transaction ' + cls + '">' +
                '<div class="tx_side"><i class="fa fa-' + (t.side === "BUY" ? "plus" : "minus") + '"></i> ' + t.side + '</div>' +
                '<div class="tx_mid"><b>' + t.symbol + '</b><span class="tx_date">' + new Date(t.ts).toLocaleString() + '</span></div>' +
                '<div class="tx_right">' + fmtQty(t.qty) + '<span class="tx_price">@ ' + fmtUSD(t.price) + '</span></div>' +
                '</div>';
        }).join(""));
    }

    // ================= init =================
    $(function () {
        bindTicket();

        $(".tab_btn").on("click", function () { switchTab($(this).data("tab")); });

        $("#btn_reset").on("click", function () {
            if (confirm("Reset account to $10,000 paper cash? This clears trades, orders and holdings.")) {
                Store.resetAccount();
                toast("Account reset", true);
                renderAll();
            }
        });

        var txExpanded = false;
        $("#tx_view_all").on("click", function () {
            txExpanded = !txExpanded;
            $(this).text(txExpanded ? "Show less" : "View all");
            renderTransactions(txExpanded);
        });

        function renderAll() {
            renderTransactions(txExpanded);
            renderOrders();
            renderPortfolio();
            updateSummary();
        }
        Store.onChange(renderAll);

        // expose for chart module (asset switch → refresh ticket context)
        window.Trading = { renderAll: renderAll, switchTab: switchTab };

        renderAll();
        // keep summary/equity fresh with prices
        setInterval(function () { renderPortfolio(); renderOrders(); updateSummary(); }, 5000);
    });
})();
