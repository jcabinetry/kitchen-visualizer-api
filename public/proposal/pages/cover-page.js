/* Proposal Cover Page Component */
(function () {
  window.CVProposalPages = window.CVProposalPages || {};

  function safe(value, fallback) {
    return value || fallback || "";
  }

  function buildAddress(customer) {
    return [customer.address, customer.city, customer.state, customer.zip]
      .filter(Boolean)
      .join(", ");
  }

  window.CVProposalPages.coverPage = function coverPage(data) {
    const company = data.company || {};
    const customer = data.customer || {};
    const pricing = data.pricing || {};
    const images = data.images || {};

    const companyName = safe(company.companyName || company.name, "Cabinet Visualizer");
    const customerName = safe(customer.name, "Customer Name");
    const proposalNumber = safe(data.proposalNumber, "CV-0000");
    const proposalDate = safe(data.proposalDate, new Date().toLocaleDateString());
    const projectTotal = safe(pricing.projectTotal, "$0");
    const salesperson = safe(customer.salesperson, "");
    const address = buildAddress(customer);
    const logoUrl = company.logoUrl || "";
    const heroImage = images.afterImage || images.beforeImage || "";

    return `
      <article class="cv-proposal-page cv-cover-page">
        <div class="cv-cover-brand-row">
          ${logoUrl ? `<img class="cv-cover-logo" src="${logoUrl}" alt="${companyName} Logo">` : `<div class="cv-cover-logo-placeholder">${companyName.charAt(0)}</div>`}
          <div>
            <div class="cv-cover-company">${companyName}</div>
            <div class="cv-cover-small">Kitchen Design Proposal</div>
          </div>
        </div>

        <div class="cv-cover-center">
          <div class="cv-cover-label">Prepared Exclusively For</div>
          <h1>${customerName}</h1>
          ${address ? `<p class="cv-cover-address">${address}</p>` : ""}
        </div>

        <div class="cv-cover-hero ${heroImage ? "has-image" : ""}">
          ${heroImage ? `<img src="${heroImage}" alt="Kitchen Preview">` : `<div>Kitchen preview image will appear here</div>`}
        </div>

        <div class="cv-cover-footer-grid">
          <div>
            <span>Proposal #</span>
            <strong>${proposalNumber}</strong>
          </div>
          <div>
            <span>Proposal Date</span>
            <strong>${proposalDate}</strong>
          </div>
          <div>
            <span>Project Total</span>
            <strong>${projectTotal}</strong>
          </div>
          <div>
            <span>Prepared By</span>
            <strong>${salesperson || companyName}</strong>
          </div>
        </div>

        <div class="cv-powered-by">Powered by Cabinet Visualizer</div>
      </article>
    `;
  };
})();
