/*
  Cabinet Visualizer Custom Catalog Data
  Loads the reusable catalog library and filters it by each customer's admin selections.
*/

window.CV_CUSTOM_CATALOGS = {
  defaultCatalog: {
    manufacturers: [
      {
        id: "cabdoor",
        name: "CabDoor",
        lines: [
          {
            id: "euro-shaker",
            name: "Euro Shaker",
            description: "Euro Shaker doors with multiple frame sizes and profile options.",
            doors: [
              { id: "141-85-1-versailles", label: "#141-85.1 Versailles", value: "CabDoor #141-85.1 Versailles Euro Shaker cabinet door style", desc: "1 inch frame Euro Shaker" },
              { id: "141-85-7-florence", label: "#141-85.7 Florence", value: "CabDoor #141-85.7 Florence Euro Shaker cabinet door style", desc: "3/4 inch frame Euro Shaker" },
              { id: "141-85-5-venice", label: "#141-85.5 Venice", value: "CabDoor #141-85.5 Venice Euro Shaker cabinet door style", desc: "1/2 inch frame Euro Shaker" }
            ],
            finishes: [
              { label: "White Paint", value: "white painted cabinet finish" },
              { label: "Off White Paint", value: "off white painted cabinet finish" },
              { label: "Natural Maple", value: "natural maple wood cabinet finish" },
              { label: "Natural White Oak", value: "natural white oak wood cabinet finish" }
            ]
          },
          {
            id: "shaker",
            name: "Shaker",
            description: "Classic shaker and shaker variation door styles.",
            doors: [
              { id: "116-03-shaker-inset", label: "#116.03 Shaker", value: "CabDoor #116.03 Shaker inset panel cabinet door style", desc: "Inset panel shaker" },
              { id: "113-03-04-shaker-rev-raised", label: "#113.03.04 Shaker", value: "CabDoor #113.03.04 Shaker reverse raised panel cabinet door style", desc: "Reverse raised panel shaker" },
              { id: "115-03-43-shaker-beaded", label: "#115.03.43 Shaker", value: "CabDoor #115.03.43 Shaker beaded panel cabinet door style", desc: "Beaded panel shaker" }
            ],
            finishes: [
              { label: "White Paint", value: "white painted cabinet finish" },
              { label: "Light Gray Paint", value: "light gray painted cabinet finish" },
              { label: "Navy Paint", value: "navy blue painted cabinet finish" },
              { label: "Natural Alder", value: "natural alder wood cabinet finish" },
              { label: "Natural Cherry", value: "natural cherry wood cabinet finish" }
            ]
          },
          {
            id: "raised-panel",
            name: "Raised Panel",
            description: "Traditional cope and pattern raised panel options.",
            doors: [
              { id: "100-02-01-winchester", label: "#100.02.01 Winchester", value: "CabDoor #100.02.01 Winchester raised panel cabinet door style", desc: "Raised panel Winchester" },
              { id: "100-47-01-winchester", label: "#100.47.01 Winchester", value: "CabDoor #100.47.01 Winchester raised panel cabinet door style", desc: "Raised panel Winchester" },
              { id: "700-01-01-windsor", label: "#700.01.01 Windsor", value: "CabDoor #700.01.01 Windsor raised panel cabinet door style", desc: "Raised panel Windsor" }
            ],
            finishes: [
              { label: "White Paint", value: "white painted cabinet finish" },
              { label: "Off White Paint", value: "off white painted cabinet finish" },
              { label: "Natural Oak", value: "natural oak wood cabinet finish" },
              { label: "Natural Hickory", value: "natural hickory wood cabinet finish" },
              { label: "Natural Cherry", value: "natural cherry wood cabinet finish" }
            ]
          }
        ]
      },
      {
        id: "aristokraft",
        name: "Aristokraft",
        lines: [
          {
            id: "sample-line",
            name: "Sample Line Placeholder",
            description: "Placeholder until the Aristokraft catalog is extracted.",
            doors: [
              { id: "aristokraft-sample-shaker", label: "Sample Shaker", value: "Aristokraft sample shaker cabinet door style", desc: "Placeholder door style" }
            ],
            finishes: [
              { label: "White", value: "Aristokraft white cabinet finish" },
              { label: "Gray", value: "Aristokraft gray cabinet finish" }
            ]
          }
        ]
      }
    ]
  }
};

(function () {
  const DEFAULT_DOOR_IMAGE = "https://primary.jwwb.nl/public/m/q/r/temp-wfofpuxetbifsbcnmmvn/visualizer-shaker-image-high-tttcry.png";
  const swatchColors = {
    "Same as Main":"linear-gradient(135deg,#f8fafc,#e5e7eb)", "White":"#ffffff", "White Paint":"#ffffff", "Light Gray":"#d1d5db", "Light Gray Paint":"#d1d5db", "Gray":"#6b7280", "Off White":"#f5f0e6", "Off White Paint":"#f5f0e6", "Navy":"#1e3a8a", "Navy Paint":"#1e3a8a", "Black":"#111827", "Natural Alder":"#b7794b", "Natural Beech":"#d6b47c", "Natural Oak":"#c49a6c", "Natural Hickory":"#a66a3f", "Natural Maple":"#d8bc8a", "Natural White Oak":"#cdbb9b", "Natural Cherry":"#7f3f2a"
  };

  function qs(id) { return document.getElementById(id); }
  function option(select, value, label) { const o = document.createElement("option"); o.value = value; o.textContent = label; select.appendChild(o); }
  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  async function waitForVisualizer() {
    for (let i = 0; i < 80; i++) {
      if (qs("jcr_manufacturer") && qs("jcr_catalog_line") && qs("jcr_color") && qs("jcr_door_grid")) return true;
      await sleep(100);
    }
    return false;
  }

  async function fetchJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("Could not load " + url);
    return res.json();
  }

  function filterCatalogBySelections(catalogs, selections) {
    const selected = Array.isArray(selections) ? selections : [];
    if (!selected.length) return null;
    const manufacturers = [];

    selected.forEach(sel => {
      const catalog = catalogs.find(c => c.catalogId === sel.catalogId);
      if (!catalog) return;
      (catalog.manufacturers || []).forEach(manufacturer => {
        const wantedLines = Array.isArray(sel.lineIds) ? sel.lineIds : [];
        const lines = (manufacturer.lines || []).filter(line => !wantedLines.length || wantedLines.includes(line.id));
        if (!lines.length) return;
        manufacturers.push({
          ...manufacturer,
          id: manufacturer.id || sel.manufacturerId || catalog.catalogId,
          name: manufacturer.name || catalog.name,
          lines
        });
      });
    });

    return manufacturers.length ? { manufacturers } : null;
  }

  function buildSwatches(selectId) {
    const select = qs(selectId);
    const grid = document.querySelector('.jcr-swatch-grid[data-select="' + selectId + '"]');
    if (!select || !grid) return;
    grid.innerHTML = "";
    Array.from(select.options).forEach((opt, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "jcr-swatch" + (index === select.selectedIndex ? " active" : "");
      btn.setAttribute("data-value", opt.value);
      btn.setAttribute("data-select", selectId);
      btn.innerHTML = '<div class="jcr-dot"></div><span></span>';
      btn.querySelector(".jcr-dot").style.background = swatchColors[opt.textContent] || "#e5e7eb";
      btn.querySelector("span").textContent = opt.textContent;
      btn.addEventListener("click", function () {
        select.value = opt.value;
        grid.querySelectorAll(".jcr-swatch").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      });
      grid.appendChild(btn);
    });
  }

  function renderDoors(doors) {
    const grid = qs("jcr_door_grid");
    const styleInput = qs("jcr_style");
    if (!grid || !styleInput) return;
    grid.innerHTML = "";
    const safeDoors = doors && doors.length ? doors : [{ label: "Catalog Import Pending", value: "catalog import pending cabinet door style", desc: "Door styles will appear after extraction" }];
    safeDoors.forEach((door, index) => {
      const card = document.createElement("div");
      card.className = "jcr-door-option" + (index === 0 ? " active" : "");
      card.setAttribute("data_value", door.value || door.label);
      card.innerHTML = (index === 0 ? '<div class="jcr-ribbon">Catalog</div>' : '') +
        '<div class="jcr-door-preview"><img src="' + (door.image || DEFAULT_DOOR_IMAGE) + '" alt=""></div>' +
        '<div class="jcr-door-name"></div><div class="jcr-door-desc"></div>';
      card.querySelector(".jcr-door-name").textContent = door.label || door.name || "Door Style";
      card.querySelector(".jcr-door-desc").textContent = door.desc || "Available cabinet door style";
      card.addEventListener("click", function () {
        grid.querySelectorAll(".jcr-door-option").forEach(c => c.classList.remove("active"));
        card.classList.add("active");
        styleInput.value = door.value || door.label || "catalog cabinet door style";
      });
      grid.appendChild(card);
      if (index === 0) styleInput.value = door.value || door.label || "catalog cabinet door style";
    });
  }

  function setFinishOptions(line) {
    const upper = qs("jcr_color");
    const base = qs("jcr_island");
    if (!upper || !base) return;
    const finishes = line.finishes && line.finishes.length ? line.finishes : [{ label: "Catalog Import Pending", value: "catalog import pending cabinet finish" }];
    upper.innerHTML = "";
    base.innerHTML = "";
    option(base, "", "Same as Main");
    finishes.forEach(f => {
      option(upper, f.value || f.label, f.label || f.value);
      option(base, String(f.value || f.label).replace("cabinet finish", "base cabinet finish"), f.label || f.value);
    });
    buildSwatches("jcr_color");
    buildSwatches("jcr_island");
  }

  function applyCatalog(catalog) {
    const manufacturerInput = qs("jcr_manufacturer");
    const lineInput = qs("jcr_catalog_line");
    if (!manufacturerInput || !lineInput || !catalog || !catalog.manufacturers?.length) return;

    function currentManufacturer() {
      return catalog.manufacturers.find(m => m.id === manufacturerInput.value) || catalog.manufacturers[0];
    }
    function currentLine() {
      const m = currentManufacturer();
      return (m.lines || []).find(l => l.id === lineInput.value) || (m.lines || [])[0];
    }
    function renderLines() {
      const m = currentManufacturer();
      lineInput.innerHTML = "";
      (m.lines || []).forEach(line => option(lineInput, line.id, line.name));
      renderSelection();
    }
    function renderSelection() {
      const line = currentLine();
      if (!line) return;
      renderDoors(line.doors || []);
      setFinishOptions(line);
    }

    manufacturerInput.innerHTML = "";
    catalog.manufacturers.forEach(m => option(manufacturerInput, m.id, m.name));
    manufacturerInput.onchange = renderLines;
    lineInput.onchange = renderSelection;
    renderLines();
  }

  async function loadCustomerCatalog() {
    try {
      const companyKey = (window.KV_COMPANY && window.KV_COMPANY.companyKey) || new URLSearchParams(window.location.search).get("companyKey") || "";
      if (!companyKey) return;
      const company = await fetchJson("/api/company?companyKey=" + encodeURIComponent(companyKey) + "&_=" + Date.now());
      const selections = company.catalogSelections || [];
      if (!selections.length) return;
      const catalogs = await Promise.all(selections.map(s => fetchJson("/api/catalogs?catalogId=" + encodeURIComponent(s.catalogId) + "&_=" + Date.now()).catch(() => null)));
      const filtered = filterCatalogBySelections(catalogs.filter(Boolean), selections);
      if (!filtered) return;
      window.CV_CUSTOM_CATALOGS.defaultCatalog = filtered;
      if (await waitForVisualizer()) applyCatalog(filtered);
    } catch (error) {
      console.warn("Customer catalog load skipped:", error);
    }
  }

  loadCustomerCatalog();
})();
