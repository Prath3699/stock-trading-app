/* =========================================================
   Trading App – chart + live data simulation
   Generates realistic OHLC candlestick data for BTC/USD,
   supports 1M / 3M / 6M / 1Y timeframes and a live tick.
   ========================================================= */

(function () {
    "use strict";

    // ---- deterministic PRNG so the demo looks the same on reload ----
    function mulberry32(seed) {
        return function () {
            seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
            var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // ---- generate daily OHLC candles ending "today" ----
    function generateCandles(days, startPrice, seed) {
        var rand = mulberry32(seed);
        var candles = [];
        var price = startPrice;
        var now = new Date();
        now.setHours(0, 0, 0, 0);

        for (var i = days - 1; i >= 0; i--) {
            var d = new Date(now.getTime());
            d.setDate(d.getDate() - i);

            var drift = (rand() - 0.48) * 0.045;          // slight upward bias
            var open = price;
            var close = open * (1 + drift);
            var high = Math.max(open, close) * (1 + rand() * 0.02);
            var low = Math.min(open, close) * (1 - rand() * 0.02);

            candles.push({
                x: d,
                y: [
                    +open.toFixed(2),
                    +high.toFixed(2),
                    +low.toFixed(2),
                    +close.toFixed(2)
                ]
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
            lineColor: dark ? "#5c8dff" : "#3d30bb"
        };
    }

    var allCandles = generateCandles(365, 42000, 20260926);
    var currentDays = 365;
    var chart = null;

    function visibleCandles(days) {
        return allCandles.slice(-days);
    }

    // moving-average overlay (last 7 closes of each point)
    function maLine(candles) {
        var pts = [];
        for (var i = 6; i < candles.length; i++) {
            var sum = 0;
            for (var j = i - 6; j <= i; j++) sum += candles[j].y[3];
            pts.push({ x: candles[i].x, y: +(sum / 7).toFixed(2) });
        }
        return pts;
    }

    function renderChart() {
        var candles = visibleCandles(currentDays);
        var c = chartColors();

        if (chart) chart.destroy();

        chart = new CanvasJS.Chart("chartContainer", {
            animationEnabled: true,
            exportEnabled: false,
            backgroundColor: "transparent",
            title: { text: "" },
            axisX: {
                valueFormatString: currentDays <= 30 ? "DD MMM" : "MMM",
                lineThickness: 0,
                gridThickness: 0,
                tickLength: 0,
                labelFontFamily: "Poppins",
                labelFontSize: 11,
                labelFontColor: c.labelFontColor
            },
            axisY: {
                prefix: "$",
                includeZero: false,
                labelFontFamily: "Poppins",
                labelFontSize: 11,
                labelFontColor: "transparent",
                lineThickness: 0,
                gridThickness: 0,
                tickLength: 0
            },
            toolTip: {
                shared: true,
                backgroundColor: c.tooltipBg,
                fontFamily: "Poppins",
                fontColor: c.tooltipFont,
                borderColor: "rgba(0,0,0,0.08)"
            },
            legend: { cursor: "pointer", itemclick: toggleDataSeries },
            data: [
                {
                    type: "candlestick",
                    color: c.lineColor,
                    risingColor: "#28a745",
                    showInLegend: true,
                    name: "BTC/USD",
                    cornerRadius: 2,
                    yValueFormatString: "$#,##0.00",
                    xValueFormatString: "DD MMM YYYY",
                    dataPoints: candles
                },
                {
                    type: "line",
                    color: "#f7b32b",
                    showInLegend: true,
                    name: "MA(7)",
                    lineThickness: 2,
                    markerSize: 0,
                    yValueFormatString: "$#,##0.00",
                    xValueFormatString: "DD MMM YYYY",
                    dataPoints: maLine(candles)
                }
            ]
        });
        chart.render();
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
        var last = allCandles[allCandles.length - 1];
        var prev = allCandles[allCandles.length - 2];
        var close = last.y[3], open = prev.y[3];
        var pct = ((close - open) / open) * 100;
        var up = pct >= 0;

        $("#balance_btc").text("9.086 BTC");
        $("#balance_change").text(
            (up ? "+" : "") + pct.toFixed(2) + "% ($" +
            Math.abs(close - open).toFixed(0) + ")"
        );
        $("#balance_arrow")
            .removeClass("fa-caret-up fa-caret-down text-success text-danger")
            .addClass(up ? "fa-caret-up text-success" : "fa-caret-down text-danger");
        $("#balance_change").css(
            "color", up ? "var(--app-primary-color)" : "#dc3545"
        );
    }

    // ---- recent transactions rendered from data ----
    function renderTransactions() {
        var txns = [
            { type: "in",  title: "Received", amount: "+ 0.085 BTC", ago: "Today 01:55 PM" },
            { type: "out", title: "Sent",     amount: "- 0.032 BTC", ago: "Today 03:14 PM" },
            { type: "buy", title: "Buy BTC",  amount: "$43,120.00",  ago: "Yesterday 09:02 AM" },
            { type: "in",  title: "Received", amount: "+ 1.065 BTC", ago: "Sep 24, 2026 05:38 PM" }
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

    // ---- live tick: nudge the latest candle every few seconds ----
    function startLiveTick() {
        setInterval(function () {
            var last = allCandles[allCandles.length - 1];
            var jitter = (Math.random() - 0.5) * 0.006;
            last.y[3] = +(last.y[3] * (1 + jitter)).toFixed(2);
            last.y[1] = Math.max(last.y[1], last.y[3]);
            last.y[2] = Math.min(last.y[2], last.y[3]);
            if (chart) {
                var series = chart.data[0].dataPoints;
                series[series.length - 1] = last;
                chart.data[1].dataPoints = maLine(visibleCandles(currentDays));
                chart.render();
            }
            updateBalance();
        }, 4000);
    }

    // ---- boot ----
    $(function () {
        renderChart();
        updateBalance();
        renderTransactions();
        startLiveTick();

        $(".tf_btn").on("click", function () {
            $(".tf_btn").removeClass("active");
            $(this).addClass("active");
            currentDays = parseInt($(this).data("days"), 10);
            renderChart();
        });
    });

    // re-render chart when theme flips (exposed for custom.js)
    window.taRefreshChartTheme = renderChart;
})();
