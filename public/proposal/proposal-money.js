(function () {
  function cleanMoney(value) {
    var raw = String(value || "");
    var digits = "";
    for (var i = 0; i < raw.length; i++) {
      var c = raw.charAt(i);
      if (c >= "0" && c <= "9") digits += c;
    }
    if (!digits) return "";
    return "$" + Number(digits).toLocaleString("en-US");
  }

  function initMoneyFields() {
    var customerTotal = document.getElementById("cv_project_total");
    var pricingTotal = document.getElementById("cv_project_total_pricing");
    var deposit = document.getElementById("cv_project_deposit");

    function syncTotals(source) {
      var formatted = cleanMoney(source && source.value);
      if (customerTotal) customerTotal.value = formatted;
      if (pricingTotal) pricingTotal.value = formatted;
    }

    function formatDeposit() {
      if (deposit) deposit.value = cleanMoney(deposit.value);
    }

    if (customerTotal) customerTotal.addEventListener("input", function () { syncTotals(customerTotal); });
    if (pricingTotal) pricingTotal.addEventListener("input", function () { syncTotals(pricingTotal); });
    if (deposit) deposit.addEventListener("input", formatDeposit);

    setTimeout(function () {
      if (customerTotal && customerTotal.value) syncTotals(customerTotal);
      if (deposit && deposit.value) formatDeposit();
    }, 300);
  }

  document.addEventListener("DOMContentLoaded", initMoneyFields);
})();
