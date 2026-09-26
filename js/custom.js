/* =========================================================
   Trading App – UI behaviour: dark mode, toasts, buttons
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

    // ---------- Buy / Sell demo actions ----------
    $("#ta_action_btns .ta_btn_buy").on("click", function () {
        showToast("Buy order placed: 0.01 BTC @ market", true);
    });

    $("#ta_action_btns .ta_btn_sell").on("click", function () {
        showToast("Sell order placed: 0.01 BTC @ market", true);
    });

    $(".view_all").on("click", function () {
        showToast("Showing all transactions", true);
    });
});
