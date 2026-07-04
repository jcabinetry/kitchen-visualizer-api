/* Proposal Selections Page Component */
(function () {
  window.CVProposalPages = window.CVProposalPages || {};

  function item(label, value) {
    return `
      <div class="cv-selection-card">
        <div class="cv-selection-icon">✓</div>
        <div>
          <span>${label}</span>
          <strong>${value || "Not Selected"}</strong>
        </div>
      </div>
    `;
  }

  window.CVProposalPages.selectionsPage = function selectionsPage(data) {
    const design = data.design || {};
    const pricing = data.pricing || {};

    return `
      <article class="cv-proposal-page cv-selections-page">
        <div class="cv-page-header">
          <div>
            <div class="cv-page-kicker">Design Selections</div>
            <h2>Selected Kitchen Finishes</h2>
          </div>
          <div class="cv-page-number">Page 3</div>
        </div>

        <div class="cv-selections-intro">
          These selections summarize the cabinet and surface options chosen for this kitchen design proposal.
        </div>

        <div class="cv-selections-grid">
          ${item("Upper Cabinet Color", design.upperColor)}
          ${item("Base Cabinet Color", design.baseColor)}
          ${item("Door Style", design.doorStyle)}
          ${item("Hardware", design.hardware)}
          ${item("Countertops", design.countertop)}
          ${item("Backsplash", design.backsplash)}
          ${item("Flooring", design.flooring)}
          ${item("Upper Cabinets", design.upperCabinets)}
        </div>

        <div class="cv-investment-section">
          <div class="cv-page-kicker">Project Details</div>
          <h2>Investment Summary</h2>

          <div class="cv-investment-grid">
            ${item("Project Total", pricing.projectTotal)}
            ${item("Deposit", pricing.deposit)}
            ${item("Estimated Timeline", pricing.timeline)}
            ${item("Proposal Valid For", pricing.validFor || "30 Days")}
          </div>
        </div>

        <div class="cv-selection-note">
          <h3>Project Notes</h3>
          <p>${pricing.notes || "Final colors, materials, and product availability should be confirmed before ordering. This proposal is intended to help the homeowner clearly visualize the selected design direction."}</p>
        </div>
      </article>
    `;
  };
})();
