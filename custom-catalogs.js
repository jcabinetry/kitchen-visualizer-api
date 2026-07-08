/*
  Cabinet Visualizer Custom Catalog Data
  This file is for the new custom-visualizer.html only.
  It supports multiple manufacturers, multiple lines per manufacturer,
  and separate door styles / finishes for each line.
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

(function catalogVisualizerBridge() {
  function getCatalog() {
    try {
      if (typeof KV_COMPANY !== "undefined" && KV_COMPANY.catalog && KV_COMPANY.catalog.manufacturers) return KV_COMPANY.catalog;
    } catch (_error) {}
    return window.CV_CUSTOM_CATALOGS && window.CV_CUSTOM_CATALOGS.defaultCatalog;
  }

  function swatchMap() {
    const catalog = getCatalog();
    const map = new Map();
    (catalog?.manufacturers || []).forEach(function(manufacturer) {
      (manufacturer.lines || []).forEach(function(line) {
        (line.finishes || []).forEach(function(finish) {
          const label = String(finish.label || finish.name || "").trim();
          const swatch = finish.swatch || finish.image || finish.thumbnail || "";
          if (label && swatch) map.set(label.toLowerCase(), swatch);
        });
      });
    });
    return map;
  }

  function doorMap() {
    const catalog = getCatalog();
    const map = new Map();
    (catalog?.manufacturers || []).forEach(function(manufacturer) {
      (manufacturer.lines || []).forEach(function(line) {
        (line.doors || []).forEach(function(door) {
          const label = String(door.label || door.name || "").trim();
          const image = door.image || door.thumbnail || "";
          if (label && image) map.set(label.toLowerCase(), image);
        });
      });
    });
    return map;
  }

  function cssImageUrl(value) {
    const raw = String(value || "").trim();
    const match = raw.match(/^url\(["']?(.*?)["']?\)$/i);
    return match ? match[1] : "";
  }

  function selectedSwatch(selectId) {
    const select = document.getElementById(selectId);
    if (!select || !select.options.length) return "";
    const label = select.options[select.selectedIndex]?.textContent || "";
    const fromMap = swatchMap().get(label.trim().toLowerCase());
    if (fromMap) return fromMap;
    const active = document.querySelector('.jcr-swatch.active[data-select="' + selectId + '"] .jcr-dot');
    return active ? cssImageUrl(active.style.backgroundImage) : "";
  }

  function selectedDoorImage() {
    const activeImg = document.querySelector(".jcr-door-option.active .jcr-door-preview img");
    if (activeImg && activeImg.src) return activeImg.src;
    const selectedText = document.querySelector(".jcr-door-option.active .jcr-door-name")?.textContent || "";
    return doorMap().get(selectedText.trim().toLowerCase()) || "";
  }

  function selectedDoorLabel() {
    return document.querySelector(".jcr-door-option.active .jcr-door-name")?.textContent?.trim() || "";
  }

  function repaint() {
    const map = swatchMap();
    if (!map.size) return;
    document.querySelectorAll(".jcr-swatch").forEach(function(button) {
      const label = (button.querySelector("span")?.textContent || "").trim();
      const swatch = map.get(label.toLowerCase());
      const dot = button.querySelector(".jcr-dot");
      if (!swatch || !dot) return;
      dot.style.backgroundImage = "url(\"" + swatch + "\")";
      dot.style.backgroundSize = "cover";
      dot.style.backgroundPosition = "center";
      dot.style.backgroundColor = "#fff";
    });
  }

  function patchGenerateFetch() {
    if (window.__catalogGenerateFetchPatched) return;
    window.__catalogGenerateFetchPatched = true;
    const originalFetch = window.fetch.bind(window);
    window.fetch = function(input, init) {
      let target = input;
      try {
        const url = typeof input === "string" ? input : input?.url || "";
        const isSharedGenerate = url.includes("/api/generate") && !url.includes("/api/generate-catalog");
        if (isSharedGenerate && init?.body && typeof init.body === "string") {
          const body = JSON.parse(init.body);
          const upperSwatch = selectedSwatch("jcr_color");
          const baseSwatch = selectedSwatch("jcr_island") || upperSwatch;
          const doorImage = selectedDoorImage();
          const doorLabel = selectedDoorLabel();
          const colorSelect = document.getElementById("jcr_color");
          const baseSelect = document.getElementById("jcr_island");
          const upperName = colorSelect?.options[colorSelect.selectedIndex]?.textContent || "";
          const baseName = baseSelect?.value === "" ? upperName : (baseSelect?.options[baseSelect.selectedIndex]?.textContent || upperName);
          const refs = Array.isArray(body.referenceImages) ? body.referenceImages.filter(Boolean) : [];
          if (doorImage) refs.unshift(doorImage);
          if (upperSwatch) refs.unshift(upperSwatch);
          if (baseSwatch && baseSwatch !== upperSwatch) refs.unshift(baseSwatch);
          body.referenceImages = Array.from(new Set(refs)).slice(0, 8);
          if (upperSwatch) body.mainCustomReference = upperSwatch;
          if (baseSwatch) body.islandCustomReference = baseSwatch;
          body.color = upperName ? "upper/wall cabinet finish: " + upperName : body.color;
          body.island = baseName ? "base/lower cabinet finish: " + baseName + " applied to all base cabinets and any island cabinets" : body.island;
          if (doorLabel) body.style = doorLabel + " catalog door style";
          body.prompt = String(body.prompt || "") + "\n\nSELECTED CATALOG REFERENCES SENT WITH THIS REQUEST:\nDoor style image: " + (doorImage ? "attached" : "not attached") + "\nUpper/wall finish swatch: " + (upperSwatch ? upperName + " attached" : "not attached") + "\nBase/lower cabinet finish swatch: " + (baseSwatch ? baseName + " attached" : "not attached") + "\nUse the base/lower finish for all base cabinets, including any island cabinets. Do not treat this as island-only.";
          init = { ...init, body: JSON.stringify(body) };
          target = typeof input === "string" ? url.replace("/api/generate", "/api/generate-catalog") : url.replace("/api/generate", "/api/generate-catalog");
        }
      } catch (_error) {}
      return originalFetch(target, init);
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function() { repaint(); patchGenerateFetch(); });
  else { repaint(); patchGenerateFetch(); }

  const observer = new MutationObserver(function() { repaint(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("catalogs-updated", repaint);
})();
