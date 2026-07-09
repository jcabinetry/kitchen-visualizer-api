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
  function init(){
    const donePins=setupList("#activeDemoPins","saved demo PINs");
    const doneKeys=setupList("#customerKeyList","saved customer keys");
    if(!donePins||!doneKeys)setTimeout(init,120);
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
  else init();
})();
