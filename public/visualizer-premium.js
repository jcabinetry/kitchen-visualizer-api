/*
  Premium Visualizer presentation helpers.
  No API calls, prompt logic, usage counting, lead submission, catalog loading, proposal logic, or demo validation.
*/
(function(){
  "use strict";

  var initialized = false;
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function qs(selector, root){ return (root || document).querySelector(selector); }
  function qsa(selector, root){ return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }

  function safe(fn){
    try { fn(); } catch (error) { if (window.console) console.warn("Visualizer premium helper skipped:", error); }
  }

  function setStepState(container, activeKey){
    var steps = qsa("[data-kv-step]", container || document);
    var activeIndex = steps.findIndex(function(step){ return step.getAttribute("data-kv-step") === activeKey; });
    steps.forEach(function(step, index){
      var isActive = step.getAttribute("data-kv-step") === activeKey;
      step.classList.toggle("is-current", isActive);
      step.classList.toggle("active", isActive);
      step.classList.toggle("is-completed", activeIndex >= 0 && index < activeIndex);
      if (step.hasAttribute("aria-current")) step.removeAttribute("aria-current");
      if (isActive) step.setAttribute("aria-current", "step");
    });
    scrollActiveStep(container || document);
  }

  function scrollActiveStep(root){
    var active = qs(".kv-step.is-current, .kv-step.active, .cv-v2-step.active", root);
    if (!active || reduceMotion) return;
    var scroller = active.closest(".kv-progress-horizontal,.kv-mobile-progress,.cv-v2-mobile-tabs");
    if (scroller && active.scrollIntoView) active.scrollIntoView({behavior:"smooth",block:"nearest",inline:"center"});
  }

  function scrollToTop(target){
    if (reduceMotion) return;
    var node = target || qs(".kv-premium-main") || document.documentElement;
    if (node.scrollIntoView) node.scrollIntoView({behavior:"smooth",block:"start"});
  }

  function bindStepButtons(){
    qsa("[data-kv-step-target]").forEach(function(button){
      if (button.dataset.kvPremiumStepBound === "1") return;
      button.dataset.kvPremiumStepBound = "1";
      button.addEventListener("click", function(){
        var target = button.getAttribute("data-kv-step-target");
        setStepState(document, target);
        scrollToTop();
      });
    });
  }

  function bindUploadDrag(){
    qsa(".kv-upload,.jcr-upload-box").forEach(function(box){
      if (box.dataset.kvPremiumUploadBound === "1") return;
      box.dataset.kvPremiumUploadBound = "1";
      ["dragenter","dragover"].forEach(function(type){
        box.addEventListener(type, function(event){
          event.preventDefault();
          box.classList.add("is-dragover");
        });
      });
      ["dragleave","drop"].forEach(function(type){
        box.addEventListener(type, function(event){
          event.preventDefault();
          box.classList.remove("is-dragover");
        });
      });
    });
  }

  function bindPresentationPanels(){
    qsa("[data-kv-toggle-panel]").forEach(function(button){
      if (button.dataset.kvPremiumPanelBound === "1") return;
      button.dataset.kvPremiumPanelBound = "1";
      button.addEventListener("click", function(){
        var selector = button.getAttribute("data-kv-toggle-panel");
        var panel = selector ? qs(selector) : null;
        if (!panel) return;
        panel.classList.toggle("is-open");
        panel.classList.toggle("active", panel.classList.contains("is-open"));
      });
    });
  }

  function bindModalControls(){
    qsa("[data-kv-open-modal]").forEach(function(button){
      if (button.dataset.kvPremiumModalBound === "1") return;
      button.dataset.kvPremiumModalBound = "1";
      button.addEventListener("click", function(){
        var modal = qs(button.getAttribute("data-kv-open-modal"));
        if (!modal) return;
        modal.classList.add("is-open");
        modal.setAttribute("aria-hidden", "false");
      });
    });
    qsa("[data-kv-close-modal]").forEach(function(button){
      if (button.dataset.kvPremiumCloseBound === "1") return;
      button.dataset.kvPremiumCloseBound = "1";
      button.addEventListener("click", function(){
        var modal = button.closest(".kv-modal");
        if (!modal) return;
        modal.classList.remove("is-open");
        modal.setAttribute("aria-hidden", "true");
      });
    });
    document.addEventListener("keydown", function(event){
      if (event.key !== "Escape") return;
      qsa(".kv-modal.is-open").forEach(function(modal){
        modal.classList.remove("is-open");
        modal.setAttribute("aria-hidden", "true");
      });
    });
  }

  function updateProgress(percent, root){
    var value = Math.max(0, Math.min(100, Number(percent) || 0));
    qsa("[data-kv-progress-fill]", root || document).forEach(function(fill){
      fill.style.width = value + "%";
      fill.setAttribute("aria-valuenow", String(value));
    });
  }

  function markMobileBar(){
    if (qs(".kv-mobile-action-bar,.cv-v2-mobile-bar")) document.body.classList.add("has-kv-mobile-bar");
  }

  function enhanceExistingShells(){
    qsa(".kv-wrap,.cv-v2-shell").forEach(function(node){ node.classList.add("kv-premium-upgraded"); });
  }

  function init(){
    if (initialized) return;
    initialized = true;
    document.documentElement.classList.add("kv-premium-ready");
    safe(bindStepButtons);
    safe(bindUploadDrag);
    safe(bindPresentationPanels);
    safe(bindModalControls);
    safe(markMobileBar);
    safe(enhanceExistingShells);
    safe(function(){ scrollActiveStep(document); });
  }

  window.VisualizerPremium = {
    init:init,
    setStepState:setStepState,
    scrollActiveStep:scrollActiveStep,
    scrollToTop:scrollToTop,
    updateProgress:updateProgress,
    prefersReducedMotion:function(){ return reduceMotion; }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
