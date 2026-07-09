function safeCompanyScript(company) {
  return "const KV_COMPANY = " + JSON.stringify(company).replace(/<\//g, "<\\/") + ";";
}

function demoSourceUrl(demoType) {
  if (demoType === "lead") return "lead-visualizer.html";
  if (demoType === "showroom") return "showroom-visualizer.html";
  return "https://raw.githubusercontent.com/jcabinetry/kitchen-visualizer-api/main/custom-visualizer.html?ts=" + Date.now();
}

function selectedCompanyKey() {
  const root = document.documentElement;
  return String(root.dataset.companyKey || window.DEMO_COMPANY_KEY || "DEMO").trim() || "DEMO";
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
  expiresText.textContent = expiresAt ? "PIN expires " + new Date(expiresAt).toLocaleString() : "";

  const response = await fetch(demoSourceUrl(demoType), { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load demo visualizer.");

  let html = await response.text();
  html = html.replace(
    /const urlParams = new URLSearchParams\(window\.location\.search\);[\s\S]*?const KV_COMPANY = \{[\s\S]*?\};/,
    safeCompanyScript({ companyKey: selectedCompanyKey(), demoType })
  );

  if (demoType === "custom") {
    html = html.replace('src="custom-catalogs.js"', 'src="demo-custom-catalogs.js?v=' + Date.now() + '"');
  }

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
