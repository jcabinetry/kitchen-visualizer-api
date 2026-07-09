(function(){
  if(window.__premiumAdminEnhanced)return;
  window.__premiumAdminEnhanced=true;

  function $(selector,root){return (root||document).querySelector(selector)}
  function $all(selector,root){return Array.from((root||document).querySelectorAll(selector))}
  function text(selector,root){const node=$(selector,root);return node?node.textContent.trim():""}
  function byLabel(label,root){const match=$all(".info",root).find(function(info){return text("span",info).toLowerCase()===label.toLowerCase()});return match?text("strong",match):"-"}
  function safe(value){return String(value||"").replace(/[&<>"]/g,function(ch){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[ch]})}
  function visible(el,show){if(el)el.classList.toggle("visible",!!show)}

  function ready(fn){
    if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",fn,{once:true});
    else fn();
  }

  ready(function(){
    const root=document.documentElement;
    root.classList.add("premium-admin");
    enhanceWhenAvailable();
  });

  function enhanceWhenAvailable(){
    const shell=$("#adminShell");
    const topbar=$(".topbar");
    if(!shell||!topbar){setTimeout(enhanceWhenAvailable,80);return;}
    setupHeader(topbar);
    setupDashboardCards();
    setupQuickDrawer();
    setupBackToTop();
    setupModalScrollLock();
    setupSectionLabels();
    setupRefreshHooks();
    updatePremiumMetrics();
    setInterval(updatePremiumMetrics,5000);
  }

  function setupHeader(topbar){
    if($(".admin-header-tools",topbar))return;
    const month=$(".month-picker",topbar);
    const tools=document.createElement("div");
    tools.className="admin-header-tools";
    const search=document.createElement("label");
    search.className="admin-global-search";
    search.innerHTML='<input id="adminGlobalSearch" type="search" placeholder="Search company, customer, key, email, phone, manufacturer">';
    const bell=document.createElement("div");
    bell.className="admin-bell";
    bell.innerHTML='<button class="admin-bell-button" id="adminBellButton" type="button" aria-label="Notifications"></button><div class="admin-notifications" id="adminNotifications"><div class="admin-notification-title">Notification Center</div><div class="admin-note-item"><strong>Customer activity</strong><span>Customer created and updated notices can appear here.</span></div><div class="admin-note-item"><strong>Catalog activity</strong><span>Catalog uploads and extractions can appear here.</span></div><div class="admin-note-item"><strong>Demo access</strong><span>Demo PIN creation and subscription notices can appear here.</span></div></div>';
    tools.appendChild(search);
    if(month)tools.appendChild(month);
    tools.appendChild(bell);
    topbar.appendChild(tools);

    const globalInput=$("#adminGlobalSearch");
    const existingSearch=$("#searchInput");
    globalInput.addEventListener("input",function(){
      if(existingSearch){
        existingSearch.value=globalInput.value;
        existingSearch.dispatchEvent(new Event("input",{bubbles:true}));
      }
      filterVisibleCatalogs(globalInput.value);
    });
    if(existingSearch){
      existingSearch.addEventListener("input",function(){if(document.activeElement!==globalInput)globalInput.value=existingSearch.value;});
    }
    $("#adminBellButton").addEventListener("click",function(event){
      event.stopPropagation();
      $("#adminNotifications").classList.toggle("active");
    });
    document.addEventListener("click",function(event){
      const panel=$("#adminNotifications");
      if(panel&&!event.target.closest(".admin-bell"))panel.classList.remove("active");
    });
  }

  function setupDashboardCards(){
    const grid=$(".summary-grid");
    if(!grid)return;
    ensureMetric(grid,"activeDemoPinsMetric","Active Demo PINs","--","demo");
    ensureMetric(grid,"manufacturerCatalogsMetric","Manufacturer Catalogs","--","catalogs");
    const targets={
      totalCustomers:".customer-list",
      activeCustomers:".customer-list",
      monthlyRevenue:".customer-list",
      annualRevenue:".customer-list",
      activeDemoPinsMetric:".demo-access-panel",
      manufacturerCatalogsMetric:".catalog-manager-panel"
    };
    $all(".metric",grid).forEach(function(card){
      card.setAttribute("tabindex","0");
      card.setAttribute("role","button");
      function go(){
        const strong=$("strong",card);
        const id=strong&&strong.id;
        const target=$(targets[id]||".customer-list");
        if(target)target.scrollIntoView({behavior:"smooth",block:"start"});
      }
      card.addEventListener("click",go);
      card.addEventListener("keydown",function(event){if(event.key==="Enter"||event.key===" "){event.preventDefault();go();}});
    });
  }

  function ensureMetric(grid,id,label,value,type){
    if($("#"+id))return;
    const card=document.createElement("div");
    card.className="metric";
    card.setAttribute("data-premium-metric",type);
    card.innerHTML='<span>'+safe(label)+'</span><strong id="'+id+'">'+safe(value)+'</strong>';
    grid.appendChild(card);
  }

  async function updatePremiumMetrics(){
    const catalogMetric=$("#manufacturerCatalogsMetric");
    if(catalogMetric){
      let count=0;
      try{if(typeof state!=="undefined"&&Array.isArray(state.catalogs))count=state.catalogs.length;}catch(_){count=0;}
      if(!count)count=$all("#catalogLibraryList .catalog-card").length;
      catalogMetric.textContent=String(count||0);
    }
    const demoMetric=$("#activeDemoPinsMetric");
    if(demoMetric&&typeof api==="function"){
      try{
        const data=await api("/api/admin/demo-pins");
        const active=(data.demoPins||[]).filter(function(pin){return (pin.status||"active")==="active"&&(!pin.expiresAt||new Date(pin.expiresAt)>new Date());}).length;
        demoMetric.textContent=String(active);
      }catch(_){
        if(demoMetric.textContent==="--")demoMetric.textContent="0";
      }
    }
  }

  function filterVisibleCatalogs(query){
    const q=String(query||"").trim().toLowerCase();
    $all("#catalogLibraryList .catalog-card").forEach(function(card){
      card.classList.toggle("admin-filter-dim",!!q&&!card.textContent.toLowerCase().includes(q));
    });
  }

  function setupQuickDrawer(){
    if($("#adminQuickDrawer"))return;
    const drawer=document.createElement("div");
    drawer.id="adminQuickDrawer";
    drawer.className="admin-quick-drawer";
    drawer.innerHTML='<div class="admin-quick-scrim" data-close-quick="1"></div><aside class="admin-quick-panel" aria-label="Customer quick view"><div id="adminQuickContent"></div></aside>';
    document.body.appendChild(drawer);
    drawer.addEventListener("click",function(event){if(event.target.matches("[data-close-quick]"))closeQuickDrawer();});
    document.addEventListener("keydown",function(event){if(event.key==="Escape")closeQuickDrawer();});

    const rows=$("#customerRows");
    if(!rows)return;
    rows.addEventListener("click",function(event){
      if(event.target.closest("button,a,input,select,textarea,label"))return;
      const card=event.target.closest(".customer-card");
      if(card)openQuickDrawer(card);
    });
    rows.addEventListener("keydown",function(event){
      if(event.key!=="Enter"&&event.key!==" ")return;
      const card=event.target.closest(".customer-card");
      if(card){event.preventDefault();openQuickDrawer(card);}
    });
    makeCardsFocusable();
    const observer=new MutationObserver(makeCardsFocusable);
    observer.observe(rows,{childList:true,subtree:false});
  }

  function makeCardsFocusable(){
    $all("#customerRows .customer-card").forEach(function(card){
      card.setAttribute("tabindex","0");
      card.setAttribute("role","button");
      card.setAttribute("aria-label","Open customer quick view");
    });
  }

  function openQuickDrawer(card){
    const drawer=$("#adminQuickDrawer");
    const content=$("#adminQuickContent");
    if(!drawer||!content)return;
    const logo=$(".logo-box",card);
    const title=text(".company-name b",card)||"Customer";
    const key=text(".company-name small",card);
    const plan=text(".plan-badge",card)||"-";
    const status=text(".badge",card)||"-";
    const monthly=byLabel("Monthly Price",card);
    const email=byLabel("Email",card);
    const phone=byLabel("Phone",card);
    const city=byLabel("City",card);
    const catalogs=byLabel("Catalogs",card);
    const usage=byLabel("Usage",card);
    const actionButtons=$all(".row-actions button",card);
    content.innerHTML='<div class="admin-quick-head"><div class="admin-quick-brand"><div class="logo-box">'+(logo?logo.innerHTML:"")+'</div><div class="admin-quick-title"><strong>'+safe(title)+'</strong><span>'+safe(key)+'</span></div></div><button class="admin-quick-close" type="button" data-close-quick="1">X</button></div><div class="badge-row"><span class="plan-badge">'+safe(plan)+'</span><span class="badge '+(status.toLowerCase().includes("inactive")?"archived":"")+'">'+safe(status)+'</span></div><div class="admin-quick-grid"><div class="info"><span>Monthly Price</span><strong>'+safe(monthly)+'</strong></div><div class="info"><span>Usage</span><strong>'+safe(usage)+'</strong></div><div class="info"><span>Email</span><strong>'+safe(email)+'</strong></div><div class="info"><span>Phone</span><strong>'+safe(phone)+'</strong></div><div class="info"><span>City</span><strong>'+safe(city)+'</strong></div><div class="info"><span>Catalogs</span><strong>'+safe(catalogs)+'</strong></div></div><div class="admin-quick-actions" id="adminQuickActions"></div>';
    const quickActions=$("#adminQuickActions",content);
    actionButtons.forEach(function(button){
      const clone=button.cloneNode(true);
      clone.addEventListener("click",function(){button.click();if((button.dataset.action||"")==="edit")closeQuickDrawer();});
      quickActions.appendChild(clone);
    });
    document.body.classList.add("modal-lock");
    drawer.classList.add("active");
  }

  function closeQuickDrawer(){
    const drawer=$("#adminQuickDrawer");
    if(drawer)drawer.classList.remove("active");
    if(!$(".catalog-modal.active"))document.body.classList.remove("modal-lock");
  }

  function setupBackToTop(){
    if($("#adminBackTop"))return;
    const button=document.createElement("button");
    button.id="adminBackTop";
    button.className="admin-back-top";
    button.type="button";
    button.setAttribute("aria-label","Back to top");
    document.body.appendChild(button);
    button.addEventListener("click",function(){window.scrollTo({top:0,behavior:"smooth"});});
    function sync(){visible(button,window.scrollY>520)}
    window.addEventListener("scroll",sync,{passive:true});
    sync();
  }

  function setupModalScrollLock(){
    let previousScroll=0;
    function sync(){
      const open=!!$(".catalog-modal.active")||!!$("#adminQuickDrawer.active");
      if(open&&!document.body.classList.contains("modal-lock"))previousScroll=window.scrollY;
      document.body.classList.toggle("modal-lock",open);
      if(!open&&previousScroll)window.scrollTo({top:previousScroll});
    }
    const observer=new MutationObserver(sync);
    observer.observe(document.body,{attributes:true,subtree:true,attributeFilter:["class"]});
    document.addEventListener("click",function(event){if(event.target.matches("#cvCatClose"))setTimeout(sync,50);});
    sync();
  }

  function setupSectionLabels(){
    $all(".panel-header h2").forEach(function(heading){
      if(!heading.id&&heading.textContent.trim()==="Customers")heading.id="customersSectionTitle";
    });
  }

  function setupRefreshHooks(){
    document.addEventListener("click",function(event){
      if(event.target.closest("#refreshButton,#refreshCatalogsButton,#refreshDemoPinsButton,#generateDemoPinButton,#deleteDemoPinButton,#reactivateDemoPinButton,#deactivateDemoPinButton")){
        setTimeout(updatePremiumMetrics,800);
        setTimeout(updatePremiumMetrics,1800);
      }
    });
  }
})();
