/* Proposal Before / After Page Component */
(function () {
  window.CVProposalPages = window.CVProposalPages || {};

  function money(value) {
    var raw = String(value || "");
    var digits = "";
    for (var i = 0; i < raw.length; i++) {
      var c = raw.charAt(i);
      if (c >= "0" && c <= "9") digits += c;
    }
    if (!digits) return "";
    return "$" + Number(digits).toLocaleString("en-US");
  }

  function phone(value) {
    var raw = String(value || "");
    var digits = "";
    for (var i = 0; i < raw.length; i++) {
      var c = raw.charAt(i);
      if (c >= "0" && c <= "9") digits += c;
    }
    digits = digits.slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return "(" + digits.slice(0, 3) + ") " + digits.slice(3);
    return "(" + digits.slice(0, 3) + ") " + digits.slice(3, 6) + "-" + digits.slice(6);
  }

  function addPricingHelpers() {
    var grid = document.querySelector('[data-panel="pricing"] .cv-form-grid');
    var customerTotal = document.getElementById("cv_project_total");
    var deposit = document.getElementById("cv_project_deposit");
    var customerPhone = document.getElementById("cv_customer_phone");

    if (grid && !document.getElementById("cv_project_total_pricing")) {
      var field = document.createElement("div");
      field.className = "cv-field";
      var label = document.createElement("label");
      label.textContent = "Project Total";
      var input = document.createElement("input");
      input.id = "cv_project_total_pricing";
      input.placeholder = "$18,450";
      field.appendChild(label);
      field.appendChild(input);
      grid.insertBefore(field, grid.firstChild);
    }

    var pricingTotal = document.getElementById("cv_project_total_pricing");

    function sync(source) {
      var formatted = money(source && source.value);
      if (customerTotal) customerTotal.value = formatted;
      if (pricingTotal) pricingTotal.value = formatted;
    }

    function formatDeposit() {
      if (deposit) deposit.value = money(deposit.value);
    }

    function formatPhone() {
      if (customerPhone) customerPhone.value = phone(customerPhone.value);
    }

    if (customerTotal) customerTotal.addEventListener("input", function () { sync(customerTotal); });
    if (pricingTotal) pricingTotal.addEventListener("input", function () { sync(pricingTotal); });
    if (deposit) deposit.addEventListener("input", formatDeposit);
    if (customerPhone) customerPhone.addEventListener("input", formatPhone);

    setTimeout(function () {
      if (customerTotal && customerTotal.value) sync(customerTotal);
      if (deposit && deposit.value) formatDeposit();
      if (customerPhone && customerPhone.value) formatPhone();
    }, 400);
  }

  document.addEventListener("DOMContentLoaded", addPricingHelpers);

  window.CVProposalPages.beforeAfterPage = function beforeAfterPage(data) {
    const images = data.images || {};
    const beforeImage = images.beforeImage || "";
    const afterImage = images.afterImage || "";

    return `
      <article class="cv-proposal-page cv-before-after-page">
        <div class="cv-page-header">
          <div>
            <div class="cv-page-kicker">Design Transformation</div>
            <h2>Before & After Preview</h2>
          </div>
          <div class="cv-page-number">Page 2</div>
        </div>

        <div class="cv-before-after-grid">
          <div class="cv-ba-card">
            <div class="cv-ba-label">Current Kitchen</div>
            <div class="cv-ba-image">
              ${beforeImage ? `<img src="${beforeImage}" alt="Current Kitchen">` : `<span>Before image will appear here</span>`}
            </div>
          </div>

          <div class="cv-ba-card featured">
            <div class="cv-ba-label">New Kitchen Design</div>
            <div class="cv-ba-image">
              ${afterImage ? `<img src="${afterImage}" alt="New Kitchen Design">` : `<span>After image will appear here</span>`}
            </div>
          </div>
        </div>

        <div class="cv-ba-summary">
          <h3>Design Goal</h3>
          <p>This proposal shows the customer's existing kitchen transformed with the selected cabinet finish, door style, hardware, and design selections.</p>
        </div>
      </article>
    `;
  };
})();
