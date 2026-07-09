(function(){
  if(window.__adminCollapsedLists)return;
  window.__adminCollapsedLists=true;

  function $(selector,root){return (root||document).querySelector(selector)}
  function setupList(listId,label){
    const list=$(listId);
    if(!list||list.dataset.collapsedReady)return false;
    list.dataset.collapsedReady="1";
    list.classList.add("admin-collapsible-list");
    const button=document.createElement("button");
    button.type="button";
    button.className="neutral admin-list-toggle";
    button.setAttribute("aria-expanded","false");
    button.textContent="Show "+label;
    list.parentNode.insertBefore(button,list);
    function sync(open){
      list.classList.toggle("open",open);
      button.classList.toggle("open",open);
      button.setAttribute("aria-expanded",open?"true":"false");
      button.textContent=(open?"Hide ":"Show ")+label;
    }
    button.addEventListener("click",function(){sync(!list.classList.contains("open"));});
    sync(false);
    return true;
  }

  function setupCustomerPanel(){
    const form=$("#customerForm");
    if(!form||form.dataset.collapsedReady)return false;
    const panel=form.closest("aside.panel");
    const header=panel&&$(".panel-header",panel);
    if(!panel||!header)return false;
    form.dataset.collapsedReady="1";
    panel.classList.add("admin-customer-panel-collapsed");
    const body=document.createElement("div");
    body.className="admin-customer-panel-body";
    panel.insertBefore(body,form);
    body.appendChild(form);
    const status=$("#statusLine",panel);
    if(status)body.appendChild(status);
    const button=document.createElement("button");
    button.type="button";
    button.className="neutral admin-panel-toggle";
    button.setAttribute("aria-expanded","false");
    header.appendChild(button);
    function label(){
      const title=$("#editorTitle");
      const mode=title&&title.textContent.toLowerCase().includes("edit")?"Edit Customer":"Create Customer";
      return body.classList.contains("open")?"Hide "+mode:"Show "+mode;
    }
    function sync(open){
      body.classList.toggle("open",open);
      button.classList.toggle("open",open);
      button.setAttribute("aria-expanded",open?"true":"false");
      button.textContent=label();
    }
    button.addEventListener("click",function(){sync(!body.classList.contains("open"));});
    const newButton=$("#newButton");
    if(newButton)newButton.addEventListener("click",function(){setTimeout(function(){sync(true)},40);});
    const rows=$("#customerRows");
    if(rows){
      rows.addEventListener("click",function(event){
        const edit=event.target.closest('button[data-action="edit"]');
        if(edit)setTimeout(function(){sync(true)},80);
      });
    }
    const title=$("#editorTitle");
    if(title){
      new MutationObserver(function(){button.textContent=label();}).observe(title,{childList:true,characterData:true,subtree:true});
    }
    sync(false);
    return true;
  }

  function init(){
    const donePins=setupList("#activeDemoPins","saved demo PINs");
    const doneKeys=setupList("#customerKeyList","saved customer keys");
    const doneCustomer=setupCustomerPanel();
    if(!donePins||!doneKeys||!doneCustomer)setTimeout(init,120);
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
  else init();
})();
