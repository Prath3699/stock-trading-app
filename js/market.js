/* =========================================================
   Market module — top-30 CoinGecko screener with sortable
   columns, watchlist stars (persisted in Store) and a global
   search overlay (typeahead over the full coin list).
   Clicking any row adds/switches it on the chart when the
   symbol is one of the tracked assets; unknown coins open a
   dedicated chart via App.addChartCoin().
   ========================================================= */

(function () {
    "use strict";

    var $ = window.jQuery;

    var COINS_URL = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=30&page=1&price_change_percentage=24h";

    var SEARCH_URL = "https://api.coingecko.com/api/v3/search?query=";

    var rows = [];           // fetched market rows
    var sortKey = "rank";
    var sortAsc = true;
    var filter = "";

    function fmtP(v) {
        if (v == null || isNaN(v)) return "—";
        return (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
    }
    function fmtPrice(v) {
        if (v == null) return "—";
        var d = v < 0.01 ? 6 : v < 1 ? 4 : 2;
        return "$" + v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
    }

    var LAST_GOOD = null;   // keep the previous snapshot so a failed refresh never blanks the table
    async function fetchMarkets() {
        try {
            const j = await cached("markets", 60000, 45000, () =>
                cgFetch(COINS_URL, x => Array.isArray(x) && x.length));
            rows = j.map((c, i) => ({
                rank: i + 1, id: c.id, symbol: (c.symbol || "").toUpperCase(),
                name: c.name, price: c.current_price, chg: c.price_change_percentage_24h_in_currency,
                cap: c.market_cap, thumb: c.thumb || c.image || null
            }));
            LAST_GOOD = rows;
            render();
        } catch (e) {
            if (LAST_GOOD) { render(); return; }   // stale-but-real beats blank
            rows = ["BTC", "ETH", "SOL", "DOGE"].map(function (s, i) {
                var m = MARKETS[s];
                var p = (window.App && App.priceOf) ? App.priceOf(s) : null;
                return { rank: i + 1, id: m.id, symbol: s, name: m.name, price: p, chg: null, cap: null };
            });
            render();
        }
    }

    function render() {
        var db = Store.get();
        var list = rows.filter(function (r) {
            return !filter || r.name.toLowerCase().indexOf(filter) >= 0 || r.symbol.toLowerCase().indexOf(filter) >= 0;
        });
        list.sort(function (a, b) {
            var va = a[sortKey], vb = b[sortKey];
            if (va == null) return 1; if (vb == null) return -1;
            return (va > vb ? 1 : va < vb ? -1 : 0) * (sortAsc ? 1 : -1);
        });
        $("#mkt_tbody").html(list.map(function (r) {
            var star = db.watchlist.indexOf(r.symbol) >= 0 ? "fa-star" : "fa-star-o";
            var cls = r.chg == null ? "" : r.chg >= 0 ? "up" : "down";
            var logo = (r.thumb ? '<img class="coin_img" src="' + r.thumb + '" loading="lazy" onerror="this.remove()"> ' : "");
            return '<tr data-symbol="' + r.symbol + '" data-id="' + r.id + '">' +
                "<td>" + r.rank + "</td>" +
                "<td>" + logo + r.name +
                ' <span class="mkt_sym">' + r.symbol + "</span></td>" +
                "<td class='num'>" + fmtPrice(r.price) + "</td>" +
                '<td class="num ' + cls + '">' + fmtP(r.chg) + "</td>" +
                '<td class="num"><button class="btn star_btn" data-symbol="' + r.symbol + '" aria-label="Toggle watchlist"><i class="fa ' + star + '"></i></button></td>' +
                "</tr>";
        }).join(""));

        $(".star_btn").on("click", function (ev) {
            ev.stopPropagation();
            Store.toggleWatch($(this).data("symbol"));
            render();
        });
        $("#mkt_tbody tr[data-symbol]").on("click", function () {
            var sym = $(this).data("symbol");
            if ($('.asset_btn[data-asset="' + sym + '"]').length) {
                $('.asset_btn[data-asset="' + sym + '"]').trigger("click");
            } else {
                toast(sym + " chart coming right up…", true);
                if (window.App && App.addChartCoin) App.addChartCoin($(this).data("id"), sym, $(this).data("name") || sym);
            }
            if (window.Trading) Trading.switchTab("chart");
        });
    }

    // ================= global search =================
    var searchTimer = null;
    function bindSearch() {
        $("#search_btn").on("click", function () {
            $("#search_overlay").prop("hidden", false);
            setTimeout(function () { $("#global_search").trigger("focus"); }, 50);
        });
        $("#search_close").on("click", function () { $("#search_overlay").prop("hidden", true); });
        $("#search_overlay").on("click", function (e) { if (e.target === this) $(this).prop("hidden", true); });
        $(document).on("keydown", function (e) { if (e.key === "Escape") $("#search_overlay").prop("hidden", true); });

        $("#global_search").on("input", function () {
            var q = $(this).val().trim();
            clearTimeout(searchTimer);
            if (q.length < 2) { $("#search_results").html(""); return; }
            searchTimer = setTimeout(function () { doSearch(q); }, 350);
        });
    }

    var ALL_COINS = null;   // full id->symbol list, fetched once for offline-friendly typeahead
    async function ensureAllCoins() {
        if (ALL_COINS) return ALL_COINS;
        const url = "https://api.coingecko.com/api/v3/coins/list";
        ALL_COINS = await cached("coinlist", 86400000, 0, () =>
            cgFetch(url, x => Array.isArray(x) && x.length > 100));
        return ALL_COINS;
    }

    async function doSearch(q) {
        $("#search_results").html('<div class="empty_note">Searching…</div>');
        try {
            var list;
            try { list = await ensureAllCoins(); }
            catch (err) {
                list = Object.keys(MARKETS).map(function (k) { return { id: MARKETS[k].id, symbol: k.toLowerCase(), name: MARKETS[k].name }; })
                    .concat(rows.map(function (r) { return { id: r.id, symbol: r.symbol.toLowerCase(), name: r.name }; }));
            }
            const ql = q.toLowerCase();
            const coins = list.filter(function (c) {
                return c.name.toLowerCase().indexOf(ql) >= 0 || (c.symbol || "").toLowerCase().indexOf(ql) >= 0;
            }).slice(0, 12);
            if (!coins.length) { $("#search_results").html('<div class="empty_note">No matches.</div>'); return; }
            $("#search_results").html(coins.map(function (c) {
                return '<div class="search_row" data-id="' + c.id + '" data-symbol="' + (c.symbol || "").toUpperCase() + '" data-name="' + c.name + '">' +
                    "<b>" + c.name + "</b> <span class='mkt_sym'>" + (c.symbol || "").toUpperCase() + "</span></div>";
            }).join(""));
            $(".search_row").on("click", function () {
                $("#search_overlay").prop("hidden", true);
                $("#global_search").val("");
                if (window.App && App.addChartCoin) App.addChartCoin($(this).data("id"), $(this).data("symbol"), $(this).data("name"));
                if (window.Trading) Trading.switchTab("chart");
            });
        } catch (e) {
            $("#search_results").html('<div class="empty_note">Search needs internet — connect for live data.</div>');
        }
    }

    // ================= init =================
    $(function () {
        $("#mkt_search").on("input", function () { filter = $(this).val().trim().toLowerCase(); render(); });
        $(".sortable").on("click", function () {
            var k = $(this).data("sort");
            if (sortKey === k) sortAsc = !sortAsc; else { sortKey = k; sortAsc = k === "rank"; }
            $(".sortable").removeClass("asc desc").addClass($(this).hasClass(sortAsc ? "asc" : "desc"));
            render();
        });
        bindSearch();
        fetchMarkets();
        setInterval(fetchMarkets, 60000); // refresh screener every minute

        window.Market = { refresh: fetchMarkets };
    });
})();
