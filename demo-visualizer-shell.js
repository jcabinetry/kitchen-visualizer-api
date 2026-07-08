const DEMO_PROFILES = {
  showroom: {
    companyKey: "demo-showroom",
    companyName: "Demo Showroom Cabinetry",
    ctaText: "Create Demo Design Packet"
  },
  lead: {
    companyKey: "demo-lead",
    companyName: "Demo Lead Gen Cabinetry",
    ctaText: "Request My Demo Estimate"
  },
  custom: {
    companyKey: "demo-custom",
    companyName: "Demo Custom Cabinet Studio",
    ctaText: "Create Demo Design Packet"
  }
};

function demoCompany(demoType) {
  const base = DEMO_PROFILES[demoType] || DEMO_PROFILES.custom;
  return {
    ...base,
    monthlyLimit: 9999,
    phone: "(555) 010-2026",
    email: "demo@kpmtechnology.com",
    city: "Denver, CO",
    estimateUrl: "https://example.com/demo-estimate",
    logoUrl: "https://dummyimage.com/420x140/172033/ffffff.png&text=KPM+Demo+Cabinetry",
    primaryColor: "#2457a6",
    secondaryColor: "#647084",
    accentColor: "#16785f",
    backgroundColor: "#f5f7fb",
    cardColor: "#ffffff",
    branding: {
      phone: "(555) 010-2026",
      email: "demo@kpmtechnology.com",
      contactEmail: "demo@kpmtechnology.com",
      city: "Denver, CO",
      estimateUrl: "https://example.com/demo-estimate",
      logoUrl: "https://dummyimage.com/420x140/172033/ffffff.png&text=KPM+Demo+Cabinetry",
      primaryColor: "#2457a6",
      secondaryColor: "#647084",
      accentColor: "#16785f",
      backgroundColor: "#f5f7fb",
      cardColor: "#ffffff",
      ctaText: base.ctaText
    }
  };
}

function safeCompanyScript(company) {
  return "const KV_COMPANY = " + JSON.stringify(company).replace(/<\//g, "<\\/") + ";";
}

function runScriptInOrder(oldScript) {
  return new Promise(function(resolve, reject) {
    const script = document.createElement("script");
    script.async = false;
    Array.from(oldScript.attributes).forEach(function(attr) {
      script.setAttribute(attr.name, attr.value);
    });
    script.onload = resolve;
    script.onerror = reject;
    script.textContent = oldScript.textContent;
    oldScript.replaceWith(script);
    if (!script.src) resolve();
  });
}

async function loadDemoVisualizer(demoType, expiresAt) {
  const mount = document.getElementById("visualizerMount");
  const expiresText = document.getElementById("expiresText");
  const company = demoCompany(demoType);
  expiresText.textContent = expiresAt ? "PIN expires " + new Date(expiresAt).toLocaleString() : "";

  const response = await fetch("custom-visualizer.html", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load demo visualizer.");

  let html = await response.text();
  html = html.replace(
    /const urlParams = new URLSearchParams\(window\.location\.search\);[\s\S]*?const KV_COMPANY = \{[\s\S]*?\};/,
    safeCompanyScript(company)
  );

  mount.innerHTML = html;
  const scripts = Array.from(mount.querySelectorAll("script"));
  for (const script of scripts) {
    await runScriptInOrder(script);
  }
}

(function initDemoPinGate() {
  const root = document.documentElement;
  const demoType = root.dataset.demoType;
  const form = document.getElementById("pinForm");
  const input = document.getElementById("pinInput");
  const button = document.getElementById("pinButton");
  const error = document.getElementById("pinError");
  const pinShell = document.getElementById("pinShell");
  const demoShell = document.getElementById("demoShell");

  form.addEventListener("submit", async function(event) {
    event.preventDefault();
    error.textContent = "";
    button.disabled = true;
    button.textContent = "Checking...";

    try {
      const response = await fetch("/api/demo-pins/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ pin: input.value.trim(), demoType })
      });
      const data = await response.json().catch(function() { return {}; });
      if (!response.ok || !data.valid) throw new Error(data.error || "PIN denied.");

      pinShell.hidden = true;
      demoShell.hidden = false;
      await loadDemoVisualizer(demoType, data.expiresAt);
    } catch (err) {
      error.textContent = err.message || "PIN denied.";
    } finally {
      button.disabled = false;
      button.textContent = "Unlock Demo";
    }
  });
})();
