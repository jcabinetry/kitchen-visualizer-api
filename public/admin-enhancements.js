(function(){
  if(window.__premiumAdminEnhanced)return;
  window.__premiumAdminEnhanced=true;

  function $(selector,root){return (root||document).querySelector(selector)}
  function $all(selector,root){return Array.from((root||document).querySelectorAll(selector))}
  function text(selector,root){const node=$(selector,root);return node?node.textContent.trim():""}
  function byLabel(label,root){const match=$all(".info",root).find(function(info){return text("span",info).toLowerCase()===label.toLowerCase()});return match?text("strong",match):"-"}
  function safe(value){return String(value||"").replace(/[&<>"]/g,function(ch){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[ch]})}
  function visible(el,show){if(el)el.classList.toggle("visible",!!show)}
  function safeRun(fn){try{fn();}catch(error){if(window.console&&console.warn)console.warn("Admin enhancement skipped:",error);}}

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
    safeRun(function(){setupHeader(topbar);});
    safeRun(function(){setupDashboardCards();});
    setupQuickDrawer();
    safeRun(function(){setupBackToTop();});
    safeRun(function(){setupModalScrollLock();});
    safeRun(function(){setupSectionLabels();});
    safeRun(function(){setupRefreshHooks();});
    safeRun(function(){updatePremiumMetrics();});
    setInterval(function(){safeRun(updatePremiumMetrics);},5000);
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


  function ensureMetric(grid,id,label,value,type){
    let strong=$("#"+id,grid);
    if(strong)return strong.closest(".metric");
    const card=document.createElement("div");
    card.className="metric";
    card.setAttribute("data-premium-metric",type||"secondary");
    card.innerHTML='<span>'+safe(label)+'</span><strong id="'+safe(id)+'">'+safe(value||"--")+'</strong>';
    grid.appendChild(card);
    return card;
  }

  function filterVisibleCatalogs(query){
    const value=String(query||"").trim().toLowerCase();
    $all(".catalog-card,.demo-pin-row,.customer-key-row").forEach(function(card){
      card.hidden=!!value&&!card.textContent.toLowerCase().includes(value);
    });
  }

  function updatePremiumMetrics(){
    const customers=(()=>{try{return Array.isArray(state&&state.customers)?state.customers:[];}catch(_){return [];}})();
    const catalogs=(()=>{try{return Array.isArray(state&&state.catalogs)?state.catalogs:[];}catch(_){return [];}})();
    const activePins=$all("#activeDemoPins .demo-pin-row").filter(function(row){return !row.hidden;}).length;
    const activeDemoPins=$("#activeDemoPinsMetric");
    if(activeDemoPins)activeDemoPins.textContent=String(activePins||"--");
    const manufacturerCatalogs=$("#manufacturerCatalogsMetric");
    if(manufacturerCatalogs)manufacturerCatalogs.textContent=String(catalogs.length||$all("#catalogLibraryList .catalog-card").length||"--");
    const activeCustomers=$("#activeCustomers");
    if(activeCustomers&&!activeCustomers.textContent.trim())activeCustomers.textContent=String(customers.filter(function(customer){return (customer.status||"active")!=="archived";}).length);
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
      card.setAttribute("tabindex","0");
      card.setAttribute("role","button");
      card.setAttribute("aria-label","Open dashboard section");
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


  function setupQuickDrawer(){
    if($("#adminQuickDrawer"))return;
    const drawer=document.createElement("div");
    drawer.id="adminQuickDrawer";
    drawer.className="admin-quick-drawer";
    drawer.innerHTML='<div class="admin-quick-scrim" data-close-quick="1"></div><aside class="admin-quick-panel" aria-label="Customer workspace"><div id="adminQuickContent"></div></aside>';
    document.body.appendChild(drawer);
    drawer.addEventListener("click",function(event){if(event.target.matches("[data-close-quick]"))closeQuickDrawer();});
    document.addEventListener("keydown",function(event){if(event.key==="Escape")closeQuickDrawer();});
    const rows=$("#customerRows");
    if(!rows)return;
    rows.addEventListener("click",function(event){
      const workspace=event.target.closest('button[data-action="workspace"]');
      if(!workspace)return;
      const card=workspace.closest(".customer-card");
      if(card)openQuickDrawer(card);
    });
    addWorkspaceButtons();
    const observer=new MutationObserver(addWorkspaceButtons);
    observer.observe(rows,{childList:true,subtree:false});
  }

  function addWorkspaceButtons(){
    $all("#customerRows .customer-card").forEach(function(card){
      card.removeAttribute("tabindex");
      card.removeAttribute("role");
      card.removeAttribute("aria-label");
      const actions=$(".row-actions",card);
      const key=text(".company-name small",card);
      const lead=$('button[data-action="copy-lead"]',actions);
      const showroom=$('button[data-action="copy-showroom"]',actions);
      const customLead=$('button[data-action="copy-custom"]',actions);
      if(lead)lead.textContent="Copy Lead Premium";
      if(showroom)showroom.textContent="Copy Showroom Premium";
      if(customLead)customLead.textContent="Copy Custom Lead Premium";
      if(actions&&!$('button[data-action="copy-custom-showroom"]',actions)){
        const customShowroom=document.createElement("button");
        customShowroom.className="link-button";
        customShowroom.type="button";
        customShowroom.dataset.action="copy-custom-showroom";
        customShowroom.dataset.key=key;
        customShowroom.textContent="Copy Custom Showroom Premium";
        customShowroom.addEventListener("click",function(event){event.stopPropagation();copyText(embedSnippet(key,"custom-showroom"),"Custom showroom premium embed copied.");});
        actions.insertBefore(customShowroom,customLead?customLead.nextSibling:null);
      }
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

  let workspaceState={key:"",record:null,editing:"",saving:false,message:"",error:false};

  function getPath(source,path,fallback){
    const value=recordValue(source,[path],"");
    return value==="" ? (fallback||"") : value;
  }

  function setPath(target,path,value){
    const parts=path.split(".");
    let cursor=target;
    parts.forEach(function(part,index){
      if(index===parts.length-1){cursor[part]=value;return;}
      cursor[part]=cursor[part]&&typeof cursor[part]==="object"&&!Array.isArray(cursor[part])?cursor[part]:{};
      cursor=cursor[part];
    });
  }

  function readWorkspaceField(sectionId,name){
    const field=$("[data-workspace-section='"+sectionId+"'] [name='"+name+"']");
    if(!field)return "";
    return field.type==="number"?Number(field.value||0):field.value.trim();
  }

  function workspaceSections(record){
    return [
      {id:"company",title:"Company Information",fields:[
        {name:"companyName",label:"Company Name",path:"companyName",fallback:"companyName"},
        {name:"websiteUrl",label:"Website",path:"public.websiteUrl",fallback:"websiteUrl",type:"url"},
        {name:"estimateUrl",label:"Estimate URL",path:"public.estimateUrl",fallback:"estimateUrl",type:"url"},
        {name:"status",label:"Status",path:"status",type:"select",options:["active","archived"]},
        {name:"plan",label:"Plan",path:"plan",type:"select",options:["Trial","Starter","Professional","Enterprise"]}
      ],payload:function(){const websiteUrl=readWorkspaceField("company","websiteUrl");const estimateUrl=readWorkspaceField("company","estimateUrl");return {companyName:readWorkspaceField("company","companyName"),status:readWorkspaceField("company","status"),plan:readWorkspaceField("company","plan"),public:{websiteUrl,estimateUrl},websiteUrl,customerPageUrl:websiteUrl,estimateUrl,branding:{websiteUrl,customerPageUrl:websiteUrl,estimateUrl}};}},
      {id:"contact",title:"Primary Contact",fields:[
        {name:"name",label:"Contact Name",path:"contact.name"},
        {name:"title",label:"Title",path:"contact.title"},
        {name:"email",label:"Email",path:"contact.email",fallback:"email",type:"email"},
        {name:"phone",label:"Phone",path:"contact.phone",fallback:"phone",type:"tel"}
      ],payload:function(){const email=readWorkspaceField("contact","email");const phone=readWorkspaceField("contact","phone");return {contact:{name:readWorkspaceField("contact","name"),title:readWorkspaceField("contact","title"),email,phone},email,phone,branding:{email,contactEmail:email,phone}};}},
      {id:"address",title:"Address",fields:[
        {name:"street",label:"Street",path:"address.street"},
        {name:"city",label:"City",path:"address.city",fallback:"city"},
        {name:"state",label:"State",path:"address.state"},
        {name:"postalCode",label:"ZIP",path:"address.postalCode"},
        {name:"serviceArea",label:"Service Area",path:"address.serviceArea"}
      ],payload:function(){const city=readWorkspaceField("address","city");return {address:{street:readWorkspaceField("address","street"),city,state:readWorkspaceField("address","state"),postalCode:readWorkspaceField("address","postalCode"),serviceArea:readWorkspaceField("address","serviceArea")},city,branding:{city}};}},
      {id:"branding",title:"Branding",fields:[
        {name:"logoUrl",label:"Logo URL",path:"branding.logoUrl",fallback:"logoUrl",type:"url"},
        {name:"primaryColor",label:"Primary Color",path:"branding.primaryColor",fallback:"primaryColor",type:"color"},
        {name:"secondaryColor",label:"Secondary Color",path:"branding.secondaryColor",fallback:"secondaryColor",type:"color"},
        {name:"accentColor",label:"Accent Color",path:"branding.accentColor",fallback:"accentColor",type:"color"},
        {name:"backgroundColor",label:"Background Color",path:"branding.backgroundColor",fallback:"backgroundColor",type:"color"},
        {name:"cardColor",label:"Card Color",path:"branding.cardColor",fallback:"cardColor",type:"color"},
        {name:"ctaText",label:"CTA Text",path:"branding.ctaText",fallback:"ctaText"}
      ],payload:function(){const branding={logoUrl:readWorkspaceField("branding","logoUrl"),primaryColor:readWorkspaceField("branding","primaryColor"),secondaryColor:readWorkspaceField("branding","secondaryColor"),accentColor:readWorkspaceField("branding","accentColor"),backgroundColor:readWorkspaceField("branding","backgroundColor"),cardColor:readWorkspaceField("branding","cardColor"),ctaText:readWorkspaceField("branding","ctaText")};return {...branding,branding};}},
      {id:"billing",title:"Subscription and Billing Tracking",fields:[
        {name:"monthlyPrice",label:"Monthly Price",path:"monthlyPrice",type:"number"},
        {name:"monthlyLimit",label:"Monthly Limit",path:"monthlyLimit",type:"number"},
        {name:"status",label:"Billing Status",path:"billing.status"},
        {name:"renewalDate",label:"Renewal Date",path:"billing.renewalDate",type:"date"},
        {name:"paymentMethodSummary",label:"Payment Method Summary",path:"billing.paymentMethodSummary"},
        {name:"notes",label:"Billing Notes",path:"billing.notes",type:"textarea"}
      ],payload:function(){return {monthlyPrice:readWorkspaceField("billing","monthlyPrice"),monthlyLimit:readWorkspaceField("billing","monthlyLimit"),billing:{status:readWorkspaceField("billing","status"),renewalDate:readWorkspaceField("billing","renewalDate"),paymentMethodSummary:readWorkspaceField("billing","paymentMethodSummary"),notes:readWorkspaceField("billing","notes")}};}},
      {id:"crm",title:"Sales CRM",fields:[
        {name:"leadSource",label:"Lead Source",path:"crm.leadSource"},
        {name:"stage",label:"Stage",path:"crm.stage"},
        {name:"dealValue",label:"Deal Value",path:"crm.dealValue",type:"number"},
        {name:"owner",label:"Owner",path:"crm.owner"},
        {name:"followUpDate",label:"Follow-up Date",path:"crm.followUpDate",type:"date"},
        {name:"notes",label:"Sales Notes",path:"crm.notes",type:"textarea"}
      ],payload:function(){return {crm:{leadSource:readWorkspaceField("crm","leadSource"),stage:readWorkspaceField("crm","stage"),dealValue:readWorkspaceField("crm","dealValue"),owner:readWorkspaceField("crm","owner"),followUpDate:readWorkspaceField("crm","followUpDate"),notes:readWorkspaceField("crm","notes")}};}},
      {id:"proposal",title:"Proposal Defaults",fields:[
        {name:"template",label:"Template",path:"proposalDefaults.template"},
        {name:"packageTier",label:"Package / Tier",path:"proposalDefaults.packageTier"},
        {name:"disclaimer",label:"Disclaimer",path:"proposalDefaults.disclaimer",type:"textarea"},
        {name:"taxRate",label:"Tax Rate",path:"proposalDefaults.taxRate",type:"number"},
        {name:"notes",label:"Proposal Notes",path:"proposalDefaults.notes",type:"textarea"}
      ],payload:function(){return {proposalDefaults:{template:readWorkspaceField("proposal","template"),packageTier:readWorkspaceField("proposal","packageTier"),disclaimer:readWorkspaceField("proposal","disclaimer"),taxRate:readWorkspaceField("proposal","taxRate"),notes:readWorkspaceField("proposal","notes")}};}},
      {id:"support",title:"Support",fields:[
        {name:"status",label:"Support Status",path:"support.status"},
        {name:"priority",label:"Priority",path:"support.priority"},
        {name:"owner",label:"Owner",path:"support.owner"},
        {name:"lastContactAt",label:"Last Contact",path:"support.lastContactAt",type:"date"},
        {name:"notes",label:"Support Notes",path:"support.notes",type:"textarea"}
      ],payload:function(){return {support:{status:readWorkspaceField("support","status"),priority:readWorkspaceField("support","priority"),owner:readWorkspaceField("support","owner"),lastContactAt:readWorkspaceField("support","lastContactAt"),notes:readWorkspaceField("support","notes")}};}},
      {id:"notes",title:"Internal Notes",fields:[
        {name:"general",label:"General",path:"internalNotes.general",fallback:"notes",type:"textarea"},
        {name:"sales",label:"Sales",path:"internalNotes.sales",type:"textarea"},
        {name:"billing",label:"Billing",path:"internalNotes.billing",type:"textarea"},
        {name:"support",label:"Support",path:"internalNotes.support",type:"textarea"},
        {name:"technical",label:"Technical",path:"internalNotes.technical",type:"textarea"},
        {name:"onboarding",label:"Onboarding",path:"internalNotes.onboarding",type:"textarea"}
      ],payload:function(){const internalNotes={general:readWorkspaceField("notes","general"),sales:readWorkspaceField("notes","sales"),billing:readWorkspaceField("notes","billing"),support:readWorkspaceField("notes","support"),technical:readWorkspaceField("notes","technical"),onboarding:readWorkspaceField("notes","onboarding")};return {internalNotes,notes:internalNotes.general};}}
    ];
  }

  function renderWorkspaceField(section,field,record,editing){
    const value=getPath(record,field.path,getPath(record,field.fallback||field.path,""));
    if(editing){
      if(field.type==="textarea")return '<label>'+safe(field.label)+'<textarea name="'+safe(field.name)+'">'+safe(value)+'</textarea></label>';
      if(field.type==="select")return '<label>'+safe(field.label)+'<select name="'+safe(field.name)+'">'+field.options.map(function(option){return '<option value="'+safe(option)+'" '+(String(value)===option?'selected':'')+'>'+safe(option)+'</option>';}).join('')+'</select></label>';
      return '<label>'+safe(field.label)+'<input name="'+safe(field.name)+'" type="'+safe(field.type||"text")+'" value="'+safe(value)+'"></label>';
    }
    return '<div class="info '+(field.type==="textarea"?'admin-workspace-full':'')+'"><span>'+safe(field.label)+'</span><strong>'+safe(value||"Not set")+'</strong></div>';
  }

  function renderEditableSection(section,record){
    const editing=workspaceState.editing===section.id;
    const feedback=workspaceState.message&&workspaceState.editing===""?'<p class="admin-workspace-feedback '+(workspaceState.error?'error':'success')+'">'+safe(workspaceState.message)+'</p>':'';
    return '<section class="admin-workspace-card admin-workspace-editable" data-workspace-section="'+safe(section.id)+'"><div class="admin-workspace-section-head"><h3>'+safe(section.title)+'</h3>'+(editing?'':'<button class="neutral" type="button" data-workspace-edit="'+safe(section.id)+'">Edit</button>')+'</div>'+(editing?'<div class="admin-workspace-form">'+section.fields.map(function(field){return renderWorkspaceField(section,field,record,true);}).join('')+'</div><div class="admin-workspace-save-row"><button class="primary" type="button" data-workspace-save="'+safe(section.id)+'" '+(workspaceState.saving?'disabled':'')+'>Save Changes</button><button class="neutral" type="button" data-workspace-cancel="1" '+(workspaceState.saving?'disabled':'')+'>Cancel</button></div>':'<div class="admin-workspace-grid">'+section.fields.map(function(field){return renderWorkspaceField(section,field,record,false);}).join('')+'</div>')+feedback+'</section>';
  }

  function renderWorkspace(record,card){
    const drawer=$("#adminQuickDrawer");
    const content=$("#adminQuickContent");
    if(!drawer||!content)return;
    const logo=card&&$(".logo-box",card);
    const key=record.companyKey||workspaceState.key||"";
    const title=record.companyName||key||"Customer";
    workspaceState.key=key;
    workspaceState.record=record;
    workspaceState.card=card||workspaceState.card;
    const usage=usageDetails(record,card||document);
    const catalogs=catalogSummary(record);
    const status=record.status||"active";
    const health=status.toLowerCase().includes("archived")||usage.percent>=95?"Needs Attention":"Healthy";
    const healthStars=health==="Healthy"?"Healthy":"Needs Review";
    content.innerHTML='<div class="admin-workspace"><div class="admin-workspace-head"><div class="admin-quick-brand"><div class="logo-box">'+(logo?logo.innerHTML:record.logoUrl?'<img src="'+safe(record.logoUrl)+'" alt="">':'')+'</div><div class="admin-quick-title"><span class="admin-section-kicker">Customer Workspace</span><strong>'+safe(title)+'</strong><span>'+safe(key)+'</span></div></div><button class="admin-quick-close" type="button" data-close-quick="1">X</button></div><div class="admin-workspace-body"><section class="admin-workspace-card admin-workspace-profile"><div class="badge-row"><span class="plan-badge">'+safe(record.plan||"Not set")+'</span><span class="badge '+(status==="archived"?"archived":"")+'">'+safe(status)+'</span></div><div class="admin-health-card"><span>'+safe(healthStars)+'</span><strong>'+safe(health)+'</strong><small>Health score placeholder</small></div><div class="admin-workspace-grid"><div class="info"><span>Company Key</span><strong>'+safe(key)+'</strong></div><div class="info"><span>Created</span><strong>'+safe(formatDate(record.createdAt))+'</strong></div><div class="info"><span>Last Updated</span><strong>'+safe(formatDate(record.updatedAt))+'</strong></div><div class="info"><span>Catalog Count</span><strong>'+safe(catalogs.count)+'</strong></div></div></section><section class="admin-workspace-card"><h3>Usage</h3><div class="admin-workspace-usage"><div class="usage-bar '+(usage.percent>=100?"over":usage.percent>=80?"warn":"")+'"><span style="--value:'+usage.percent+'%"></span></div><strong>'+usage.percent+'%</strong></div><div class="admin-workspace-grid"><div class="info"><span>Visualizations Used</span><strong>'+usage.used.toLocaleString()+'</strong></div><div class="info"><span>Monthly Limit</span><strong>'+usage.limit.toLocaleString()+'</strong></div><div class="info"><span>Remaining</span><strong>'+usage.remaining.toLocaleString()+'</strong></div><div class="info"><span>Estimated AI Cost</span><strong>$'+usage.aiCost.toFixed(2)+'</strong></div><div class="info admin-workspace-full"><span>Estimated Monthly Profit</span><strong>$'+usage.profit.toFixed(2)+'</strong></div></div></section>'+workspaceSections(record).map(function(section){return renderEditableSection(section,record);}).join('')+'<section class="admin-workspace-card"><div class="admin-workspace-section-head"><h3>Catalogs</h3><button class="neutral" id="workspaceOpenCatalogs" type="button">Open Catalog Manager</button></div><div class="info"><span>Catalog Count</span><strong>'+catalogs.count+'</strong></div><div class="admin-workspace-catalogs">'+catalogs.html+'</div></section><section class="admin-workspace-card"><div class="admin-workspace-section-head"><h3>Demo Access</h3><button class="neutral" id="workspaceOpenDemo" type="button">Open Demo Manager</button></div><div class="admin-workspace-actions"><button class="primary" id="workspaceGenerateDemo" type="button">Generate Demo PIN</button><button class="neutral" id="workspaceViewDemoPins" type="button">View Active Demo PINs</button><button class="link-button" id="workspaceCopyDemoLink" type="button">Copy Demo Link</button></div></section><section class="admin-workspace-card"><h3>Recent Activity</h3><p class="admin-workspace-empty">Activity history coming soon.</p></section></div><div class="admin-workspace-quick"><div class="admin-quick-actions" id="adminQuickActions"><button class="neutral" type="button" data-workspace-copy-key="1">Copy Company Key</button><button class="link-button" type="button" data-workspace-copy="lead">Copy Lead Premium</button><button class="link-button" type="button" data-workspace-copy="custom-lead">Copy Custom Lead Premium</button><button class="link-button" type="button" data-workspace-copy="showroom">Copy Showroom Premium</button><button class="link-button" type="button" data-workspace-copy="custom-showroom">Copy Custom Showroom Premium</button><button class="neutral" type="button" data-workspace-reset="1">Reset Usage</button><button class="link-button" type="button" data-workspace-full-edit="1">Advanced / Full Edit</button><button class="danger" type="button" data-workspace-archive="1">Archive Customer</button><button class="danger" type="button" data-workspace-delete="1">Delete Customer</button></div></div></div>';
    bindWorkspaceActions(record);
    drawer.classList.add("active");
    document.body.classList.add("modal-lock");
  }

  function bindWorkspaceActions(record){
    const content=$("#adminQuickContent");
    if(!content)return;
    const key=record.companyKey;
    content.onclick=handleWorkspaceClick;
    function handleWorkspaceClick(event){
      const edit=event.target.closest("[data-workspace-edit]");
      const save=event.target.closest("[data-workspace-save]");
      const cancel=event.target.closest("[data-workspace-cancel]");
      if(edit){workspaceState.editing=edit.dataset.workspaceEdit;workspaceState.message="";renderWorkspace(workspaceState.record,workspaceState.card);return;}
      if(cancel){workspaceState.editing="";workspaceState.message="";renderWorkspace(workspaceState.record,workspaceState.card);return;}
      if(save){saveWorkspaceSection(save.dataset.workspaceSave);return;}
      if(event.target.closest("#workspaceOpenCatalogs")){const button=$("#cvCatBtn");if(button)button.click();return;}
      if(event.target.closest("#workspaceOpenDemo")){scrollWorkspaceTarget(".demo-access-panel");return;}
      if(event.target.closest("#workspaceViewDemoPins")){const toggle=$("#activeDemoPins")&&$("#activeDemoPins").previousElementSibling;if(toggle&&toggle.classList.contains("admin-list-toggle")&&!toggle.classList.contains("open"))toggle.click();scrollWorkspaceTarget(".demo-access-panel");return;}
      if(event.target.closest("#workspaceGenerateDemo")){const input=$("#demoCompanyName");if(input)input.value=record.companyName||key;const button=$("#generateDemoPinButton");if(button)button.click();scrollWorkspaceTarget(".demo-access-panel");return;}
      if(event.target.closest("#workspaceCopyDemoLink")){copyText(new URL("demo-links.html",window.location.href).href,"Demo link copied.");return;}
      if(event.target.closest("[data-workspace-copy-key]")){copyText(key,"Customer key copied.");return;}
      const copy=event.target.closest("[data-workspace-copy]");
      if(copy){copyText(embedSnippet(key,copy.dataset.workspaceCopy),copy.dataset.workspaceCopy+" visualizer copied.");return;}
      if(event.target.closest("[data-workspace-full-edit]")){if(typeof editCustomer==="function")editCustomer(key);closeQuickDrawer();return;}
      if(event.target.closest("[data-workspace-reset]")){if(typeof resetUsage==="function")resetUsage(key);return;}
      if(event.target.closest("[data-workspace-archive]")){if(window.confirm("Archive "+key+"?")){if(typeof updateCustomerStatus==="function")updateCustomerStatus(key,"archived");}return;}
      if(event.target.closest("[data-workspace-delete]")){if(window.confirm("Delete "+key+"? This cannot be undone.")){if(typeof deleteCustomer==="function")deleteCustomer(key);closeQuickDrawer();}return;}
    }
  }

  function scrollWorkspaceTarget(selector){
    const target=$(selector);
    if(target){closeQuickDrawer();target.scrollIntoView({behavior:"smooth",block:"start"});}
  }

  async function saveWorkspaceSection(sectionId){
    if(workspaceState.saving)return;
    const section=workspaceSections(workspaceState.record).find(function(item){return item.id===sectionId});
    if(!section)return;
    const payload={companyKey:workspaceState.key,...section.payload()};
    const saveButton=$("[data-workspace-save='"+sectionId+"']");
    const cancelButton=$("[data-workspace-section='"+sectionId+"'] [data-workspace-cancel]");
    workspaceState.saving=true;
    if(saveButton){saveButton.disabled=true;saveButton.textContent="Saving...";}
    if(cancelButton)cancelButton.disabled=true;
    try{
      const data=await api("/api/admin/customers",{method:"PATCH",body:JSON.stringify(payload)});
      if(data.customer){
        workspaceState.record=data.customer;
        try{if(typeof state!=="undefined"&&Array.isArray(state.customers)){state.customers=state.customers.map(function(customer){return customer.companyKey===data.customer.companyKey?{...customer,...data.customer,usage:customer.usage||data.customer.usage}:customer;});}}catch(_){}
      }
      workspaceState.editing="";
      workspaceState.message=section.title+" saved.";
      workspaceState.error=false;
    }catch(error){
      workspaceState.message=error.message||"Could not save changes.";
      workspaceState.error=true;
    }finally{
      workspaceState.saving=false;
      renderWorkspace(workspaceState.record,workspaceState.card);
    }
  }

  function openQuickDrawer(card){
    const key=text(".company-name small",card);
    const record=customerRecord(key)||{companyKey:key,companyName:text(".company-name b",card)};
    workspaceState={key,record,card,editing:"",saving:false,message:"",error:false};
    renderWorkspace(record,card);
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
