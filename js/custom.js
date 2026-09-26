/* =========================================================
   Trading App – UI behaviour: dark mode, toasts, buy/sell
   with a persisted portfolio, live total value.
   ========================================================= */

$(function () {

    // ---------- Dark / light theme with localStorage persistence ----------
    var $toggle = $("#theme_toggle");
    var saved = null;
    try { saved = localStorage.getItem("ta-theme"); } catch (e) {}

    function applyTheme(dark) {
        document.documentElement.classList.toggle("ta-dark", dark);
        $toggle.find("i").toggleClass("fa-sun-o", dark).toggleClass("fa-moon-o", !dark);
        if (window.taRefreshChartTheme) window.taRefreshChartTheme();
    }

    applyTheme(saved === "dark");

    $toggle.on("click", function () {
        var dark = !document.documentElement.classList.contains("ta-dark");
        try { localStorage.setItem("ta-theme", dark ? "dark" : "light"); } catch (e) {}
        applyTheme(dark);
    });

    // ---------- Toast helper ----------
    var toastTimer = null;
    function showToast(msg, ok) {
        var $t = $("#ta_toast");
        $t.text(msg)
          .toggleClass("toast-error", !ok)
          .addClass("show");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { $t.removeClass("show"); }, 2600);
    }
    window.taShowToast = showToast;

    // ---------- Portfolio (persisted) ----------
    var HOLDINGS_KEY = "ta-holdings";
    var holdings = null;
    try { holdings = JSON.parse(localStorage.getItem(HOLDINGS_KEY)); } catch (e) {}
    if (!holdings || typeof holdings !== "object") {
        holdings = { BTC: 9.086, ETH: 4.2, SOL: 35, DOGE: 12000 };
    }

    function saveHoldings() {
        try { localStorage.setItem(HOLDINGS_KEY, JSON.stringify(holdings)); } catch (e) {}
    }

    function fmtUsd(n) {
        if (n >= 1000) return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
        if (n >= 1) return "$" + n.toFixed(2);
        return "$" + n.toFixed(4);
    }

    async function renderPortfolio() {
        var assets = ["BTC", "ETH", "SOL"];
        var html = "";
        var prices = {};

        // try live prices; fall back to last-known/demo
        for (var i = 0; i < assets.length; i++) {
            try {
                var s = await fetchSpot(MARKETS[assets[i]].id);
                prices[assets[i]] = s.price;
            } catch (e) {
                prices[assets[i]] = { BTC: 42000, ETH: 2300, SOL: 98 }[assets[i]];
            }
        }

        var total = 0;
        $.each(assets, function (_, a) {
            var usd = holdings[a] * prices[a];
            total += usd;
            html +=
                '<div class="pf_card">' +
                    '<div class="pf_name"><i class="fa ' + MARKETS[a].icon + '" style="color:' + MARKETS[a].color + '"></i> ' + a + '</div>' +
                    '<div class="pf_amt">' + holdings[a].toLocaleString("en-US", { maximumFractionDigits: 3 }) + '</div>' +
                    '<div class="pf_usd">' + fmtUsd(usd) + '</div>' +
                '</div>';
        });

        html +=
            '<div class="pf_card pf_total">' +
                '<div class="pf_name">Total</div>' +
                '<div class="pf_amt">' + fmtUsd(total) + '</div>' +
                '<div class="pf_usd">≈ portfolio value</div>' +
            '</div>';

        $("#portfolio_list").html(html);
    }

    window.taRefreshPortfolio = renderPortfolio;
    renderPortfolio();
    setInterval(renderPortfolio, 60000); // refresh valuation every minute

    // ---------- Buy / Sell actions ----------
    var TRADE_SIZE = { BTC: 0.01, ETH: 0.1, SOL: 1, DOGE: 100 };

    $("#ta_action_btns button").on("click", function () {
        var side = $(this).data("side");
        var asset = ($(".asset_btn.active").data("asset")) || "BTC";
        var qty = TRADE_SIZE[asset] || 0.01;

        if (side === "sell" && (holdings[asset] || 0) < qty) {
            showToast("Not enough " + asset + " to sell this amount", false);
            return;
        }

        holdings[asset] = (holdings[asset] || 0) + (side === "buy" ? qty : -qty);
        if (holdings[asset] < 0) holdings[asset] = 0;
        saveHoldings();

        // record the trade so it appears in Recent Transactions
        var price = window.taCurrentPrice ? window.taCurrentPrice() : 0;
        if (window.taRecordTrade) window.taRecordTrade(side, asset, qty, price);

        showToast(
            (side === "buy" ? "Bought " : "Sold ") + qty + " " + asset +
            " at " + (price ? "$" + price.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "market"),
            true
        );
        renderPortfolio();
        if (window.taRefreshTransactions) window.taRefreshTransactions();
    });

    $(".view_all").on("click", function () {
        var $list = $("#transactions_list");
        var expanded = $list.toggleClass("txn-expanded").hasClass("txn-expanded");
        $(this).html(expanded ? 'View less <i class="fa fa-angle-up"></i>'
                             : 'View all <i class="fa fa-angle-down"></i>');
    });
});
