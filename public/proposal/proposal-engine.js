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

  function normalizeCustomer(customer) {
    customer = customer || {};
    return {
      name: customer.name || customer.customer || customer.clientName || "",
      phone: customer.phone || customer.clientPhone || "",
      email: customer.email || customer.clientEmail || "",
      address: customer.address || customer.projectAddress || "",
      city: customer.city || "",
      state: customer.state || "",
      zip: customer.zip || "",
      salesperson: customer.salesperson || customer.designer || ""
    };
  }

  function normalizeDesign(design) {
    design = design || {};
    return {
      upperColor: design.upperColor || design.mainColor || "",
      baseColor: design.baseColor || design.islandColor || "",
      doorStyle: design.doorStyle || "",
      hardware: design.hardware || "",
      countertop: design.countertop || design.countertops || "",
      backsplash: design.backsplash || "",
      flooring: design.flooring || "",
      upperCabinets: design.upperCabinets || design.upperHeight || ""
    };
  }

  function normalizeImages(images) {
    images = images || {};

    // The showroom visualizer currently stores these reversed:
    // beforeImage = generated preview, afterImage = original uploaded photo.
    // Normalize them here so the Proposal Engine always has:
    // beforeImage = original kitchen, afterImage = generated design.
    return {
      beforeImage: images.afterImage || images.beforeImage || "",
      afterImage: images.beforeImage || images.afterImage || ""
    };
  }

  function loadStoredProposalData() {
    try {
      const raw = sessionStorage.getItem("cv_proposal_data");
      if (!raw) return false;

      const stored = JSON.parse(raw);
      window.CV.companyKey = stored.companyKey || window.CV.companyKey;
      window.CV.proposal.customer = normalizeCustomer(stored.customer);
      window.CV.proposal.pricing = stored.pricing || {};
      window.CV.proposal.design = normalizeDesign(stored.design);
      window.CV.proposal.images = normalizeImages(stored.images);

      const customer = window.CV.proposal.customer;
      const pricing = window.CV.proposal.pricing;

      setValue("cv_customer_name", customer.name);
      setValue("cv_customer_phone", customer.phone);
      setValue("cv_customer_email", customer.email);
      setValue("cv_salesperson", customer.salesperson);
      setValue("cv_project_address", customer.address);
      setValue("cv_project_city", customer.city);
      setValue("cv_project_state", customer.state);
      setValue("cv_project_zip", customer.zip);
      setValue("cv_project_total", pricing.projectTotal || "");
      setValue("cv_project_notes", pricing.notes || "");

      return true;
    } catch (error) {
      console.warn("Could not load stored proposal data", error);
      return false;
    }
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
    window.CV.companyKey = window.CV.companyKey || getCompanyKey();

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

    if (!window.CV.proposal.design || !Object.keys(window.CV.proposal.design).length) {
      window.CV.proposal.design = {
        upperColor: "",
        baseColor: "",
        doorStyle: "",
        hardware: "",
        countertop: "",
        backsplash: "",
        flooring: "",
        upperCabinets: ""
      };
    }

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
    const hasStoredData = loadStoredProposalData();
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

    if (hasStoredData) {
      renderProposalPreview();
      showStep("preview");
      setText("cv_engine_status", "Proposal data loaded");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
