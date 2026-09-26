/* =========================================================
   Trading App – chart engine (live CoinGecko data with
   deterministic simulator fallback), MA(7) overlay, volume
   bars, crosshair tooltips, timeframes and live ticking.
   ========================================================= */

(function () {
    "use strict";

    var TF_DAYS = { 30: 30, 90: 90, 180: 180, 365: 365 };

    // ---- state ----
    var state = {
        asset: "BTC",
        days: 365,
        candles: [],       // [{x: Date, y:[o,h,l,c], v: relVolume}]
        live: false,       // true when using real API data
        spot: null,        // latest spot price info
        chart: null
    };

    // ---- deterministic PRNG so the demo looks the same on reload ----
    function mulberry32(seed) {
        return function () {
            seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
            var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    var SEEDS = { BTC: 20260926, ETH: 150903, SOL: 771001, DOGE: 420420 };
    var STARTS = { BTC: 42000, ETH: 2300, SOL: 98, DOGE: 0.082 };

    // ---- generate daily OHLC candles ending "today" (fallback) ----
    function generateCandles(asset, days) {
        var rand = mulberry32(SEEDS[asset] || 1);
        var candles = [];
        var price = STARTS[asset] || 100;
        var now = new Date();
        now.setHours(0, 0, 0, 0);

        for (var i = days - 1; i >= 0; i--) {
            var d = new Date(now.getTime());
            d.setDate(d.getDate() - i);

            var drift = (rand() - 0.48) * 0.045;
            var open = price;
            var close = open * (1 + drift);
            var high = Math.max(open, close) * (1 + rand() * 0.02);
            var low = Math.min(open, close) * (1 - rand() * 0.02);
            var dp = (close > 100) ? 2 : (close > 1 ? 4 : 6);

            candles.push({
                x: d,
                y: [
                    +open.toFixed(dp), +high.toFixed(dp),
                    +low.toFixed(dp), +close.toFixed(dp)
                ],
                v: +(rand() * 0.9 + 0.4).toFixed(2)   // relative volume 0.4–1.3
            });
            price = close;
        }
        return candles;
    }

    // ---- theme-aware chart colors ----
    function chartColors() {
        var dark = document.documentElement.classList.contains("ta-dark");
        return {
            labelFontColor: dark ? "#9aa0b5" : "#8a8a9d",
            tooltipBg: dark ? "#2a2a3d" : "#ffffff",
            tooltipFont: dark ? "#e8e8f0" : "rgba(0,0,0,0.8)",
            upColor: "#28a745",
            downColor: "#dc3545",
            maColor: dark ? "#f7b32b" : "#e8960c",
            gridColor: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
            crosshair: dark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.18)"
        };
    }

    function fmt(n) {
        if (n >= 1000) return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
        if (n >= 1) return "$" + n.toFixed(2);
        return "$" + n.toFixed(4);
    }

    // moving-average overlay
    function maLine(candles, period) {
        var pts = [];
        for (var i = period - 1; i < candles.length; i++) {
            var sum = 0;
            for (var j = i - period + 1; j <= i; j++) sum += candles[j].y[3];
            pts.push({ x: candles[i].x, y: +(sum / period).toFixed(4) });
        }
        return pts;
    }

    function visibleCandles() {
        return state.candles.slice(-state.days);
    }

    // per-candle rich tooltip: O/H/L/C + change%
    function candleToolTip(e) {
        var dp = e.dataPoints && e.dataPoints[0];
        if (!dp) return "";
        var y = dp.y, chg = ((y[3] - y[0]) / y[0] * 100);
        var date = CanvasJS.formatDate(dp.x, "DD MMM YYYY");
        return "<strong>" + MARKETS[state.asset].symbol + "</strong> · " + date +
            "<br/>Open: " + fmt(y[0]) + "&nbsp; High: " + fmt(y[1]) +
            "<br/>Low: " + fmt(y[2]) + "&nbsp; Close: <strong>" + fmt(y[3]) + "</strong>" +
            "<br/>Change: <span style='color:" + (chg >= 0 ? "#28a745" : "#dc3545") + "'>" +
            (chg >= 0 ? "+" : "") + chg.toFixed(2) + "%</span>";
    }

    function renderChart() {
        var candles = visibleCandles();
        var c = chartColors();

        if (state.chart) state.chart.destroy();

        state.chart = new CanvasJS.Chart("chartContainer", {
            animationEnabled: true,
            backgroundColor: "transparent",
            title: { text: "" },
            axisX: {
                valueFormatString: state.days <= 30 ? "DD MMM" : "MMM",
                lineThickness: 0, gridThickness: 0, tickLength: 0,
                labelFontFamily: "Poppins", labelFontSize: 11,
                labelFontColor: c.labelFontColor,
                crosshair: { enabled: true, color: c.crosshair, snapToDataPoint: true }
            },
            axisY: {
                prefix: "$", includeZero: false,
                labelFontFamily: "Poppins", labelFontSize: 11,
                labelFontColor: "transparent",
                lineThickness: 0, gridThickness: 0, tickLength: 0,
                valueFormatString: "#,##0.##"
            },
            toolTip: {
                shared: true,
                backgroundColor: c.tooltipBg,
                fontFamily: "Poppins", fontSize: 12,
                fontColor: c.tooltipFont,
                borderColor: "rgba(0,0,0,0.08)",
                content: candleToolTip
            },
            legend: {
                cursor: "pointer", itemclick: toggleDataSeries,
                verticalAlign: "top", horizontalAlign: "center",
                fontFamily: "Poppins", fontSize: 11,
                fontColor: c.labelFontColor
            },
            data: [
                {
                    type: "candlestick",
                    name: MARKETS[state.asset].symbol,
                    showInLegend: true,
                    color: c.downColor, risingColor: c.upColor,
                    cornerRadius: 2,
                    yValueFormatString: "$#,##0.##",
                    xValueFormatString: "DD MMM YYYY",
                    axisYType: "primary",
                    dataPoints: candles
                },
                {
                    type: "line",
                    name: "MA(7)",
                    showInLegend: true,
                    color: c.maColor, lineThickness: 2, markerSize: 0,
                    yValueFormatString: "$#,##0.##",
                    dataPoints: maLine(candles, 7)
                },
                {
                    type: "column",
                    name: "Volume",
                    showInLegend: true,
                    axisYType: "secondary",
                    axisYSuffix: "",
                    labelFormatter: function () { return ""; },
                    color: c.gridColor,
                    toolTipContent: null,
                    dataPoints: candles.map(function (cd) {
                        return { x: cd.x, y: cd.v || 0 };
                    })
                }
            ]
        });
        state.chart.render();
    }

    window.toggleDataSeries = function (e) {
        if (typeof e.dataSeries.visible === "undefined" || e.dataSeries.visible) {
            e.dataSeries.visible = false;
        } else {
            e.dataSeries.visible = true;
        }
        e.chart.render();
    };

    // ---- balance header reflects last close & daily change ----
    function updateBalance() {
        var m = MARKETS[state.asset];
        var last = state.candles[state.candles.length - 1];
        var prev = state.candles[state.candles.length - 2] || last;
        var close = state.spot ? state.spot.price : last.y[3];
        var base = prev.y[3];
        var pct = (state.spot && typeof state.spot.change24h === "number")
            ? state.spot.change24h
            : ((close - base) / base) * 100;
        var up = pct >= 0;

        $("#balance_symbol").text(m.symbol);
        $("#balance_price").text(fmt(close));
        $("#balance_change")
            .removeClass("text-success text-danger")
            .addClass(up ? "text-success" : "text-danger")
            .text((up ? "+" : "") + pct.toFixed(2) + "% (" + (up ? "+" : "-") +
                  fmt(Math.abs(close - base)) + ")");
        $("#balance_arrow")
            .removeClass("fa-caret-up fa-caret-down")
            .addClass(up ? "fa-caret-up" : "fa-caret-down")
            .css("color", up ? "var(--app-primary-color)" : "#dc3545");

        $("#data_source_badge")
            .toggleClass("badge-live", state.live)
            .toggleClass("badge-demo", !state.live)
            .html(state.live
                ? '<i class="fa fa-circle"></i> LIVE'
                : '<i class="fa fa-flask"></i> DEMO');
    }

    // ---- recent transactions rendered from data ----
    function renderTransactions() {
        var sym = state.asset;
        var txns = [
            { type: "in",  title: "Received", amount: "+ 0.085 " + sym, ago: "Today 01:55 PM" },
            { type: "out", title: "Sent",     amount: "- 0.032 " + sym, ago: "Today 03:14 PM" },
            { type: "buy", title: "Buy " + sym, amount: "$43,120.00",   ago: "Yesterday 09:02 AM" },
            { type: "in",  title: "Received", amount: "+ 1.065 " + sym, ago: "Sep 24, 2026 05:38 PM" }
        ];

        var html = "";
        $.each(txns, function (_, t) {
            var icon = t.type === "in" ? "fa-long-arrow-down"
                     : t.type === "out" ? "fa-long-arrow-up"
                     : "fa-btc";
            var cls = t.type === "out" ? " amount_sent"
                    : t.type === "buy" ? " amount_buy" : "";
            html +=
                '<div class="row txn-row">' +
                    '<div class="col-2 justify-content-center align-self-center transactions_thumb">' +
                        '<i class="fa ' + icon + '"></i>' +
                    '</div>' +
                    '<div class="col-6 text-left pl-2 justify-content-center align-self-center">' +
                        '<span class="transaction_title">' + t.title + '</span>' +
                        '<span class="transaction_caption">' + t.ago + '</span>' +
                    '</div>' +
                    '<div class="col-4 justify-content-center align-self-center text-right transaction_amount' + cls + '">' +
                        t.amount +
                    '</div>' +
                '</div>';
        });
        $("#transactions_list").html(html);
    }

    // ---- data loading: try live API, fall back to simulator ----
    function loadSimulated() {
        state.live = false;
        state.spot = null;
        state.candles = generateCandles(state.asset, 365);
        renderAll();
    }

    async function loadLive(daysForOHLC) {
        var id = MARKETS[state.asset].id;
        try {
            var candlesRaw = await fetchOHLC(id, daysForOHLC || 365);
            var spot = await fetchSpot(id).catch(function () { return null; });

            var candles = candlesRaw.map(function (cd) {
                return { x: cd.x, y: [cd.o, cd.h, cd.l, cd.c], v: 0 };
            });
            if (candles.length < 10) throw new Error("too few candles");

            // attach normalized volume buckets if available
            try {
                var vols = await fetchVolume(id, Math.min(30, Math.ceil(state.days / 30) * 30 || 30));
                var byDay = {};
                vols.forEach(function (p) { byDay[Math.floor(p[0] / DAY_MS)] = p[1]; });
                var maxV = 1;
                candles.forEach(function (cd) {
                    var v = byDay[Math.floor(cd.x.getTime() / DAY_MS)] || 0;
                    cd.v = v; if (v > maxV) maxV = v;
                });
                candles.forEach(function (cd) { cd.v = +(cd.v / maxV).toFixed(3); });
            } catch (e) { /* volume optional */ }

            state.candles = candles;
            state.spot = spot;
            state.live = true;
            renderAll();
            return true;
        } catch (err) {
            return false;
        }
    }

    function renderAll() {
        renderChart();
        updateBalance();
        renderTransactions();
    }

    // ---- live refresh loop ----
    function startLiveTick() {
        setInterval(async function () {
            var last = state.candles[state.candles.length - 1];
            if (!last) return;

            if (state.live) {
                try {
                    state.spot = await fetchSpot(MARKETS[state.asset].id);
                    var p = state.spot.price;
                    last.y[3] = p;
                    last.y[1] = Math.max(last.y[1], p);
                    last.y[2] = Math.min(last.y[2], p);
                } catch (e) { /* keep last data */ }
            } else {
                var jitter = (Math.random() - 0.5) * 0.006;
                last.y[3] = +(last.y[3] * (1 + jitter)).toFixed(4);
                last.y[1] = Math.max(last.y[1], last.y[3]);
                last.y[2] = Math.min(last.y[2], last.y[3]);
            }

            if (state.chart) {
                var pts = state.chart.data[0].dataPoints;
                pts[pts.length - 1] = last;
                state.chart.data[1].dataPoints = maLine(visibleCandles(), 7);
                state.chart.render();
            }
            updateBalance();
        }, 4000);
    }

    // ---- boot ----
    $(async function () {
        loadSimulated();          // instant paint, no blank screen
        startLiveTick();

        var ok = await loadLive(365);
        if (!ok) console.info("Live API unavailable — running in demo mode.");

        // timeframe pills
        $(".tf_btn").on("click", function () {
            $(".tf_btn").removeClass("active");
            $(this).addClass("active");
            state.days = TF_DAYS[$(this).data("days")] || 365;
            renderChart();
        });

        // asset switcher
        $(".asset_btn").on("click", async function () {
            $(".asset_btn").removeClass("active");
            $(this).addClass("active");
            state.asset = $(this).data("asset");
            $("#chart_title").text(MARKETS[state.asset].name + " · " + MARKETS[state.asset].symbol);
            loadSimulated();      // immediate feedback while fetching
            await loadLive(365);
        });
    });

    // re-render chart when theme flips (exposed for custom.js)
    window.taRefreshChartTheme = renderChart;
})();
