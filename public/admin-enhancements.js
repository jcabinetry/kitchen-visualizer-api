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

  function setupControlCenterIntro(shell){
    if($(".admin-control-center",shell))return;
    const summary=$(".summary-grid",shell);
    if(!summary)return;
    const intro=document.createElement("section");
    intro.className="admin-control-center";
    intro.setAttribute("aria-label","Admin home");
    intro.innerHTML='<div class="admin-control-copy"><span class="admin-section-kicker">Admin Home</span><h2>Cabinet Visualizer Control Center</h2><p>Manage customer accounts, revenue, demos, and catalog operations from one workspace.</p></div><div class="admin-control-status"><span>Workspace</span><strong>Live Customer Operations</strong></div>';
    shell.insertBefore(intro,summary);
  }

  function setupKpiLabels(){
    const metrics=[
      ["#activeCustomers","Active Customers","active",1],
      ["#monthlyRevenue","MRR","mrr",2],
      ["#annualRevenue","ARR","arr",3],
      ["#totalPreviews","Monthly Usage","usage",4],
      ["#activeDemoPinsMetric","Demo PINs","demo",5],
      ["#manufacturerCatalogsMetric","Catalogs","catalogs",6],
      ["#totalCustomers","Total Customers","secondary",7],
      ["#avgRevenue","Avg Revenue","secondary",8],
      ["#aiSpend","AI Cost","secondary",9],
      ["#grossProfit","Gross Profit","secondary",10]
    ];
    metrics.forEach(function(item){
      const strong=$(item[0]);
      const card=strong&&strong.closest(".metric");
      if(!card)return;
      const label=$("span",card);
      if(label)label.textContent=item[1];
      card.setAttribute("data-premium-metric",item[2]);
      card.style.setProperty("--metric-order",String(item[3]));
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
    setupKpiLabels();
    $all(".metric",grid).forEach(function(card){
      card.removeAttribute("tabindex");
      card.removeAttribute("role");
      card.removeAttribute("aria-label");
      const actions=$(".row-actions",card);
      const key=text(".company-name small",card);
      if(actions&&!$('button[data-action="workspace"]',actions)){
        const button=document.createElement("button");
        button.className="primary";
        button.type="button";
        button.dataset.action="workspace";
        button.dataset.key=key;
        button.textContent="Workspace";
        actions.insertBefore(button,actions.firstChild);
      }
    });
  }

  function customerRecord(key){
    try{
      if(typeof state!=="undefined"&&Array.isArray(state.customers))return state.customers.find(function(customer){return customer.companyKey===key})||null;
    }catch(_){return null;}
    return null;
  }

  function recordValue(record,keys,fallback){
    if(!record)return fallback||"-";
    for(const key of keys){
      const parts=key.split(".");
      let value=record;
      for(const part of parts){value=value&&value[part];}
      if(value!==undefined&&value!==null&&String(value).trim()!=="")return value;
    }
    return fallback||"-";
  }

  function formatDate(value){
    if(!value)return "-";
    const date=new Date(value);
    if(Number.isNaN(date.getTime()))return "-";
    return date.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"});
  }

  function parseMoney(value){
    const number=Number(String(value||"").replace(/[^0-9.-]/g,""));
    return Number.isFinite(number)?number:0;
  }

  function usageDetails(record,card){
    const usageText=byLabel("Usage",card);
    const match=String(usageText||"").match(/([0-9,]+)\s*\/\s*([0-9,]+)/);
    const used=Number(String(recordValue(record,["usage.used","usage.count","usage.previews"],match?match[1]:0)).replace(/,/g,""))||0;
    const limit=Number(String(recordValue(record,["monthlyLimit"],match?match[2]:0)).replace(/,/g,""))||0;
    const remaining=Math.max((limit||0)-used,0);
    const percent=limit?Math.min(100,Math.round((used/limit)*100)):0;
    const monthly=parseMoney(byLabel("Monthly Price",card))||Number(recordValue(record,["monthlyPrice","billing.monthlyPrice"],0))||0;
    const aiCost=used*.04;
    const profit=Math.max(monthly-aiCost,0);
    return {used,limit,remaining,percent,aiCost,profit};
  }

  function catalogSummary(record){
    const selections=Array.isArray(record&&record.catalogSelections)?record.catalogSelections:[];
    let catalogs=[];
    try{if(typeof state!=="undefined"&&Array.isArray(state.catalogs))catalogs=state.catalogs;}catch(_){catalogs=[];}
    if(!selections.length)return {count:0,html:'<div class="admin-workspace-empty">No assigned catalogs.</div>'};
    const rows=selections.map(function(selection){
      const catalog=catalogs.find(function(item){return item.catalogId===selection.catalogId})||{};
      const manufacturer=safe(catalog.name||selection.manufacturerId||selection.catalogId||"Catalog");
      const enabled=(selection.lineIds||[]).length;
      const lineText=enabled?enabled+" enabled line"+(enabled===1?"":"s"):"All available lines";
      return '<div class="admin-workspace-catalog"><strong>'+manufacturer+'</strong><span>'+safe(lineText)+'</span></div>';
    }).join("");
    return {count:selections.length,html:rows};
  }

  function openQuickDrawer(card){
    const drawer=$("#adminQuickDrawer");
    const content=$("#adminQuickContent");
    if(!drawer||!content)return;
    const logo=$(".logo-box",card);
    const title=text(".company-name b",card)||"Customer";
    const key=text(".company-name small",card);
    const record=customerRecord(key);
    const plan=text(".plan-badge",card)||recordValue(record,["plan"],"-");
    const status=text(".badge",card)||recordValue(record,["status"],"-");
    const monthly=byLabel("Monthly Price",card)||recordValue(record,["monthlyPrice"],"-");
    const email=byLabel("Email",card)||recordValue(record,["email","branding.email","branding.contactEmail"],"-");
    const phone=byLabel("Phone",card)||recordValue(record,["phone","branding.phone"],"-");
    const city=byLabel("City",card)||recordValue(record,["city","branding.city"],"-");
    const website=recordValue(record,["customerPageUrl","websiteUrl","branding.customerPageUrl","branding.websiteUrl"],"-");
    const notes=recordValue(record,["notes"],"");
    const created=formatDate(recordValue(record,["createdAt","created","createdDate"],""));
    const updated=formatDate(recordValue(record,["updatedAt","lastUpdated","modifiedAt"],""));
    const usage=usageDetails(record,card);
    const catalogs=catalogSummary(record);
    const actionButtons=$all(".row-actions button",card).filter(function(button){return (button.dataset.action||"")!=="workspace"});
    const health=status.toLowerCase().includes("inactive")||usage.percent>=95?"Needs Attention":"Healthy";
    const healthStars=health==="Healthy"?"★★★★★":"★★★☆☆";
    content.innerHTML='<div class="admin-workspace"><div class="admin-workspace-head"><div class="admin-quick-brand"><div class="logo-box">'+(logo?logo.innerHTML:"")+'</div><div class="admin-quick-title"><span class="admin-section-kicker">Customer Workspace</span><strong>'+safe(title)+'</strong><span>'+safe(key)+'</span></div></div><button class="admin-quick-close" type="button" data-close-quick="1">X</button></div><div class="admin-workspace-body"><section class="admin-workspace-card admin-workspace-profile"><div class="badge-row"><span class="plan-badge">'+safe(plan)+'</span><span class="badge '+(status.toLowerCase().includes("inactive")?"archived":"")+'">'+safe(status)+'</span></div><div class="admin-health-card"><span>'+safe(healthStars)+'</span><strong>'+safe(health)+'</strong><small>Health score placeholder</small></div><div class="admin-workspace-grid"><div class="info"><span>Monthly Price</span><strong>'+safe(monthly)+'</strong></div><div class="info"><span>Created</span><strong>'+safe(created)+'</strong></div><div class="info"><span>Last Updated</span><strong>'+safe(updated)+'</strong></div><div class="info"><span>City</span><strong>'+safe(city)+'</strong></div><div class="info"><span>Phone</span><strong>'+safe(phone)+'</strong></div><div class="info"><span>Email</span><strong>'+safe(email)+'</strong></div><div class="info admin-workspace-full"><span>Website</span><strong>'+safe(website)+'</strong></div></div></section><section class="admin-workspace-card"><h3>Usage</h3><div class="admin-workspace-usage"><div class="usage-bar '+(usage.percent>=100?"over":usage.percent>=80?"warn":"")+'"><span style="--value:'+usage.percent+'%"></span></div><strong>'+usage.percent+'%</strong></div><div class="admin-workspace-grid"><div class="info"><span>Visualizations Used</span><strong>'+usage.used.toLocaleString()+'</strong></div><div class="info"><span>Monthly Limit</span><strong>'+usage.limit.toLocaleString()+'</strong></div><div class="info"><span>Remaining</span><strong>'+usage.remaining.toLocaleString()+'</strong></div><div class="info"><span>Estimated AI Cost</span><strong>$'+usage.aiCost.toFixed(2)+'</strong></div><div class="info admin-workspace-full"><span>Estimated Monthly Profit</span><strong>$'+usage.profit.toFixed(2)+'</strong></div></div></section><section class="admin-workspace-card"><div class="admin-workspace-section-head"><h3>Catalogs</h3><button class="neutral" id="workspaceOpenCatalogs" type="button">Open Catalog Manager</button></div><div class="info"><span>Catalog Count</span><strong>'+catalogs.count+'</strong></div><div class="admin-workspace-catalogs">'+catalogs.html+'</div></section><section class="admin-workspace-card"><div class="admin-workspace-section-head"><h3>Demo</h3><button class="neutral" id="workspaceOpenDemo" type="button">Open Demo Manager</button></div><div class="admin-workspace-actions"><button class="primary" id="workspaceGenerateDemo" type="button">Generate Demo PIN</button><button class="neutral" id="workspaceViewDemoPins" type="button">View Active Demo PINs</button><button class="link-button" id="workspaceCopyDemoLink" type="button">Copy Demo Link</button></div></section><section class="admin-workspace-card"><h3>Notes</h3><p class="admin-workspace-notes">'+safe(notes||"No notes available.")+'</p></section><section class="admin-workspace-card"><h3>Recent Activity</h3><p class="admin-workspace-empty">Activity history coming soon.</p></section></div><div class="admin-workspace-quick"><div class="admin-quick-actions" id="adminQuickActions"></div></div></div>';
    const quickActions=$("#adminQuickActions",content);
    actionButtons.forEach(function(button){
      const clone=button.cloneNode(true);
      clone.addEventListener("click",function(){button.click();if((button.dataset.action||"")==="edit")closeQuickDrawer();});
      quickActions.appendChild(clone);
    });
    const scrollToPanel=function(selector){const target=$(selector);if(target){closeQuickDrawer();target.scrollIntoView({behavior:"smooth",block:"start"});}};
    const openCatalog=$("#workspaceOpenCatalogs",content);
    if(openCatalog)openCatalog.addEventListener("click",function(){const button=$("#cvCatBtn");if(button)button.click();});
    const openDemo=$("#workspaceOpenDemo",content);
    if(openDemo)openDemo.addEventListener("click",function(){scrollToPanel(".demo-access-panel");});
    const viewDemo=$("#workspaceViewDemoPins",content);
    if(viewDemo)viewDemo.addEventListener("click",function(){const toggle=$("#activeDemoPins")&&$("#activeDemoPins").previousElementSibling;if(toggle&&toggle.classList.contains("admin-list-toggle")&&!toggle.classList.contains("open"))toggle.click();scrollToPanel(".demo-access-panel");});
    const generateDemo=$("#workspaceGenerateDemo",content);
    if(generateDemo)generateDemo.addEventListener("click",function(){const input=$("#demoCompanyName");if(input)input.value=title;const button=$("#generateDemoPinButton");if(button)button.click();scrollToPanel(".demo-access-panel");});
    const copyDemo=$("#workspaceCopyDemoLink",content);
    if(copyDemo)copyDemo.addEventListener("click",function(){copyText(new URL("demo-links.html",window.location.href).href,"Demo link copied.");});
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
