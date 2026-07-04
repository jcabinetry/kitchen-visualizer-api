/* Proposal Before / After Page Component */
(function () {
  window.CVProposalPages = window.CVProposalPages || {};

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
