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
      salesperson: customer.salesperson || customer.designer || "",
      proposalNumber: customer.proposalNumber || ""
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

      const customProposalNumber = stored.proposalNumber || window.CV.proposal.customer.proposalNumber || "";
      if (customProposalNumber) window.CV.proposalNumber = customProposalNumber;

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
    setText("cv_company_key", "");
    setText("cv_loaded_company", company.companyName || company.name || "");

    const logo = document.getElementById("cv_company_logo");
    if (logo && company.logoUrl) {
      logo.crossOrigin = "anonymous";
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
      if (!response.ok) throw new Error(data.error || "Company not found");

      window.CV.company = data;
      applyCompanyBrand(data);
      setText("cv_engine_status", "Ready");
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

    if (stepName === "design") renderDesignReview();
    if (stepName === "export") renderProposalPreview();
  }

  function designItem(label, value) {
    return '<div class="cv-design-selection-item"><span>' + label + '</span><strong>' + (value || "Not Selected") + '</strong></div>';
  }

  function renderDesignReview() {
    const container = document.getElementById("cv_design_review");
    if (!container) return;

    const images = window.CV.proposal.images || {};
    const design = window.CV.proposal.design || {};

    container.innerHTML = `
      <div class="cv-design-image-grid">
        <div class="cv-design-image-card">
          <h3>Current Kitchen</h3>
          <div class="cv-design-image-box">
            ${images.beforeImage ? `<img src="${images.beforeImage}" alt="Current Kitchen">` : "Before image not loaded yet."}
          </div>
        </div>
        <div class="cv-design-image-card">
          <h3>New Kitchen Design</h3>
          <div class="cv-design-image-box">
            ${images.afterImage ? `<img src="${images.afterImage}" alt="New Kitchen Design">` : "After image not loaded yet."}
          </div>
        </div>
      </div>
      <div class="cv-design-selection-grid">
        ${designItem("Upper Color", design.upperColor)}
        ${designItem("Base Color", design.baseColor)}
        ${designItem("Door Style", design.doorStyle)}
        ${designItem("Hardware", design.hardware)}
        ${designItem("Countertops", design.countertop)}
        ${designItem("Backsplash", design.backsplash)}
        ${designItem("Flooring", design.flooring)}
        ${designItem("Upper Cabinets", design.upperCabinets)}
      </div>
    `;
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

  function getProposalData() {
    return {
      company: window.CV.company || {},
      customer: window.CV.proposal.customer || {},
      pricing: window.CV.proposal.pricing || {},
      design: window.CV.proposal.design || {},
      images: window.CV.proposal.images || {},
      proposalNumber: window.CV.proposalNumber,
      proposalDate: window.CV.proposalDate,
      companyKey: window.CV.companyKey
    };
  }

  function buildProposalPagesHTML() {
    const data = getProposalData();
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

    return html;
  }

  function renderProposalPreview() {
    const container = document.getElementById("cv_proposal_preview_pages");
    if (!container) return;
    container.innerHTML = buildProposalPagesHTML() || '<div class="cv-empty-preview">Proposal page components not loaded.</div>';
  }

  function waitForImages(container) {
    const images = Array.from(container.querySelectorAll("img"));
    images.forEach(function (img) {
      if (img.src && img.src.indexOf("data:image") !== 0) {
        img.crossOrigin = "anonymous";
      }
    });
    return Promise.all(images.map(function (img) {
      if (img.complete) return Promise.resolve();
      return new Promise(function (resolve) {
        img.onload = resolve;
        img.onerror = resolve;
      });
    }));
  }

  function createPdfExportContainer() {
    const wrapper = document.createElement("div");
    wrapper.id = "cv_pdf_export_render_area";
    wrapper.style.position = "fixed";
    wrapper.style.left = "-10000px";
    wrapper.style.top = "0";
    wrapper.style.width = "900px";
    wrapper.style.background = "#ffffff";
    wrapper.style.zIndex = "-1";
    wrapper.innerHTML = '<div class="cv-proposal-preview-stack">' + buildProposalPagesHTML() + '</div>';
    document.body.appendChild(wrapper);
    return wrapper;
  }

  async function downloadProposalPDF() {
    const button = document.getElementById("cv_download_pdf");

    if (!window.jspdf || !window.jspdf.jsPDF || !window.html2canvas) {
      alert("PDF tools are still loading. Please wait a few seconds and try again.");
      return;
    }

    let renderArea = null;

    try {
      if (button) {
        button.disabled = true;
        button.textContent = "Creating PDF...";
      }
      setText("cv_engine_status", "Creating PDF...");
      renderProposalPreview();

      renderArea = createPdfExportContainer();
      await waitForImages(renderArea);

      const pages = Array.from(renderArea.querySelectorAll(".cv-proposal-page"));
      if (!pages.length) {
        alert("Please create the proposal preview first.");
        return;
      }

      const pdf = new window.jspdf.jsPDF("p", "pt", "letter");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      for (let i = 0; i < pages.length; i++) {
        const canvas = await window.html2canvas(pages[i], {
          scale: 2,
          useCORS: true,
          allowTaint: false,
          backgroundColor: "#ffffff",
          imageTimeout: 15000
        });

        const imgData = canvas.toDataURL("image/jpeg", 0.95);
        const imgWidth = pageWidth;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        const y = imgHeight < pageHeight ? (pageHeight - imgHeight) / 2 : 0;

        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, "JPEG", 0, y, imgWidth, Math.min(imgHeight, pageHeight));
      }

      const safeNumber = (window.CV.proposalNumber || "proposal").replace(/[^a-z0-9-_]/gi, "-");
      pdf.save(safeNumber + ".pdf");
      setText("cv_engine_status", "Ready");
    } catch (error) {
      console.error("PDF export failed", error);
      alert("PDF export failed. Please try again, or use your browser print option for now.");
      setText("cv_engine_status", "PDF failed");
    } finally {
      if (renderArea && renderArea.parentNode) renderArea.parentNode.removeChild(renderArea);
      if (button) {
        button.disabled = false;
        button.textContent = "Download Proposal PDF";
      }
    }
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
    const hasStoredData = loadStoredProposalData();

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

    const downloadPDF = document.getElementById("cv_download_pdf");
    if (downloadPDF) downloadPDF.addEventListener("click", downloadProposalPDF);

    if (hasStoredData) {
      renderDesignReview();
      renderProposalPreview();
      showStep("preview");
      setText("cv_engine_status", "Proposal data loaded");
    } else {
      renderDesignReview();
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
