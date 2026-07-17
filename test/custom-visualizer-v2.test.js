import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildMasterPrompt, normalizeValidation, resolveCatalogSelection, stableCatalogOptionId } from "../api/_lib/customVisualizerV2.js";

const image = "data:image/png;base64,aGVsbG8=";
const customer = { companyKey: "dealer-a", status: "active", catalogSelections: [{ catalogId: "catalog-a", lineIds: ["premium-line"] }] };
const catalog = { catalogId: "catalog-a", name: "Catalog A", status: "active", manufacturers: [{ id: "maker-a", name: "Maker A", lines: [{ id: "premium-line", name: "Premium Line", doors: [{ id: "heritage-raised", name: "Heritage Raised", aiDoorReference: image, aiDrawerReference: image, doorConstructionType: "raised", drawerConstructionType: "raised", doorProfileDescription: "A raised center panel with a stepped inner profile.", drawerProfileDescription: "A wide raised drawer panel with matching stepped transitions.", doorProfileMustAvoid: "flat or recessed center panels", drawerProfileMustAvoid: "slab or door-shaped proportions", profileAnalysisStatus: "ready" }], finishes: [{ id: "warm-white", name: "Warm White", swatch: image }] }] }] };
const selection = { catalogId: "catalog-a", manufacturerId: "maker-a", lineId: "premium-line", doorId: "heritage-raised", finishId: "warm-white" };

test("resolves only an assigned authoritative catalog selection", function() {
  const result = resolveCatalogSelection({ customer, catalog, selection });
  assert.equal(result.doorName, "Heritage Raised");
  assert.equal(result.finishName, "Warm White");
  assert.equal(result.doorReference, image);
});

test("rejects catalogs that are not assigned to the customer", function() {
  assert.throws(function() { resolveCatalogSelection({ customer: { ...customer, catalogSelections: [] }, catalog, selection }); }, /not assigned/);
});

test("rejects cabinet lines outside the customer's catalog assignment", function() {
  assert.throws(function() { resolveCatalogSelection({ customer: { ...customer, catalogSelections: [{ catalogId: "catalog-a", lineIds: ["another-line"] }] }, catalog, selection }); }, /not assigned/);
});

test("rejects a missing drawer master rather than guessing", function() {
  const broken = structuredClone(catalog);
  broken.manufacturers[0].lines[0].doors[0].aiDrawerReference = "";
  assert.throws(function() { resolveCatalogSelection({ customer, catalog: broken, selection }); }, /drawer-front reference/);
});

test("master prompt keeps geometry, color, and room roles separate", function() {
  const resolved = resolveCatalogSelection({ customer, catalog, selection });
  const prompt = buildMasterPrompt(resolved);
  assert.match(prompt, /IMAGE ROLES/);
  assert.match(prompt, /geometry only/);
  assert.match(prompt, /color and finish only/);
  assert.match(prompt, /Preserve the exact camera position/);
  assert.doesNotMatch(prompt, /default to shaker/i);
});

test("validation cannot pass below hard thresholds", function() {
  assert.equal(normalizeValidation({ pass: true, layoutScore: 91, doorGeometryScore: 100, drawerGeometryScore: 100, finishScore: 100, violations: [] }).pass, false);
  assert.equal(normalizeValidation({ pass: true, layoutScore: 95, doorGeometryScore: 92, drawerGeometryScore: 91, finishScore: 90, violations: [] }).pass, true);
});

test("catalog option IDs are deterministic", function() {
  assert.equal(stableCatalogOptionId({ label: " Heritage Raised Panel " }), "heritage-raised-panel");
});

test("V2 browser request sends IDs instead of authoritative catalog assets", async function() {
  const html = await readFile(new URL("../public/custom-visualizer-v2.html", import.meta.url), "utf8");
  assert.match(html, /selection:\{catalogId:catalog\(\)\.id,manufacturerId:manufacturer\(\)\.id,lineId:line\(\)\.id,doorId:door\(\)\.id,finishId:finish\(\)\.id\}/);
  assert.doesNotMatch(html, /catalogDoorReference|catalogDrawerReference|catalogSwatchReference/);
});
