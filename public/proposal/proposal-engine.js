/* Cabinet Visualizer Proposal Engine */
(function () {
  const API_BASE = "https://kitchen-visualizer-api.vercel.app";

  window.CV = {
    companyKey: null,
    company: {},
    proposalNumber: "",
    proposalDate: new Date().toLocaleDateString(),
    proposal: {
      customer: {},
      design: {},
      pricing: {},
      images: {}
    }
  };

  function getCompanyKey() {
    const params = new URLSearchParams(window.location.search);
    return params.get("companyKey") || params.get("company") || "";
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value || "";
  }

  function setValue(id, value) {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = value || "";
  }

  function getValue(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : "";
  }

  function applyCompanyBrand(company) {
    const primary = company.primaryColor || company.brandColor || "#0f3d5e";
    document.documentElement.style.setProperty("--cv-primary", primary);

    setText("cv_company_name", company.companyName || company.name || "Cabinet Visualizer");
    setText("cv_company_key", window.CV.companyKey ? "Company Key: " + window.CV.companyKey : "Company Key Missing");
    setText("cv_loaded_company", company.companyName || company.name || "No company loaded yet");

    const logo = document.getElementById("cv_company_logo");
    if (logo && company.logoUrl) {
      logo.src = company.logoUrl;
      logo.style.display = "block";
    }
  }

  async function loadCompany() {
    window.CV.companyKey = getCompanyKey();

    if (!window.CV.companyKey) {
      applyCompanyBrand({ companyName: "Cabinet Visualizer" });
      setText("cv_engine_status", "Missing companyKey");
      return;
    }

    try {
      const response = await fetch(
        API_BASE + "/api/company?companyKey=" + encodeURIComponent(window.CV.companyKey),
        { cache: "no-store" }
      );

      const data = await response.json().catch(function () { return {}; });

      if (!response.ok) {
        throw new Error(data.error || "Company not found");
      }

      window.CV.company = data;
      applyCompanyBrand(data);
      setText("cv_engine_status", "Company loaded");
    } catch (error) {
      console.warn("Company load failed", error);
      applyCompanyBrand({ companyName: "Cabinet Visualizer" });
      setText("cv_engine_status", "Company could not be loaded");
    }
  }

  function showStep(stepName) {
    document.querySelectorAll(".cv-panel").forEach(function (panel) {
      panel.classList.toggle("active", panel.getAttribute("data-panel") === stepName);
    });

    document.querySelectorAll(".cv-step").forEach(function (button) {
      button.classList.toggle("active", button.getAttribute("data-step") === stepName);
    });
  }

  function saveCustomerStep() {
    window.CV.proposal.customer = {
      name: getValue("cv_customer_name"),
      phone: getValue("cv_customer_phone"),
      email: getValue("cv_customer_email"),
      address: getValue("cv_project_address"),
      city: getValue("cv_project_city"),
      state: getValue("cv_project_state"),
      zip: getValue("cv_project_zip"),
      salesperson: getValue("cv_salesperson")
    };

    showStep("design");
  }

  function savePricingStep() {
    window.CV.proposal.pricing = {
      projectTotal: getValue("cv_project_total"),
      deposit: getValue("cv_project_deposit"),
      timeline: getValue("cv_project_timeline"),
      validFor: getValue("cv_valid_for") || "30 Days",
      notes: getValue("cv_project_notes")
    };

    window.CV.proposal.design = {
      upperColor: "White",
      baseColor: "Same as Upper",
      doorStyle: "Shaker",
      hardware: "Matte Black",
      countertop: "Calacatta Quartz",
      backsplash: "White Subway Tile",
      flooring: "White Oak LVP",
      upperCabinets: "Keep Existing"
    };

    renderProposalPreview();
    showStep("preview");
  }

  function renderProposalPreview() {
    const container = document.getElementById("cv_proposal_preview_pages");
    if (!container) return;

    const data = {
      company: window.CV.company || {},
      customer: window.CV.proposal.customer || {},
      pricing: window.CV.proposal.pricing || {},
      design: window.CV.proposal.design || {},
      images: window.CV.proposal.images || {},
      proposalNumber: window.CV.proposalNumber,
      proposalDate: window.CV.proposalDate,
      companyKey: window.CV.companyKey
    };

    let html = "";

    if (window.CVProposalPages && typeof window.CVProposalPages.coverPage === "function") {
      html += window.CVProposalPages.coverPage(data);
    }

    if (window.CVProposalPages && typeof window.CVProposalPages.beforeAfterPage === "function") {
      html += window.CVProposalPages.beforeAfterPage(data);
    }

    if (window.CVProposalPages && typeof window.CVProposalPages.selectionsPage === "function") {
      html += window.CVProposalPages.selectionsPage(data);
    }

    container.innerHTML = html || '<div class="cv-empty-preview">Proposal page components not loaded.</div>';
  }

  function createProposalNumber() {
    const year = new Date().getFullYear();
    const key = window.CV.companyKey || "000";
    const random = Math.floor(100000 + Math.random() * 900000);
    return "CV-" + key + "-" + year + "-" + random;
  }

  function init() {
    window.CV.companyKey = getCompanyKey();
    window.CV.proposalNumber = createProposalNumber();

    loadCompany();

    setValue("cv_valid_for", "30 Days");
    setText("cv_proposal_number", window.CV.proposalNumber);

    document.querySelectorAll(".cv-step").forEach(function (button) {
      button.addEventListener("click", function () {
        showStep(button.getAttribute("data-step"));
      });
    });

    const customerNext = document.getElementById("cv_customer_next");
    if (customerNext) customerNext.addEventListener("click", saveCustomerStep);

    const pricingNext = document.getElementById("cv_pricing_next");
    if (pricingNext) pricingNext.addEventListener("click", savePricingStep);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
