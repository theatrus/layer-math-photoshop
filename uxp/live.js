"use strict";
// History polling covers document edits from tools, actions, other plugins and masks.
// It deliberately does not rely on an incomplete list of Photoshop event names.
const {app,core}=require("photoshop"),H=require("./host.js"),D=require("./live-data.js");
function snapshot(doc) {
  const states=Array.from(doc.historyStates),id=doc.activeHistoryState.id;
  return {id,ids:new Set(states.map(s=>s.id))};
}
function create(onChange=()=>{},blocked=()=>false) {
  let timer=null,busy=false,lastDoc=null,last=null,due=0,paused=false,reason="",records=[],state="idle",error="";
  const sessions=new Map();
  const notify=()=>onChange({state,error,paused,reason,records:records.map(r=>({layerId:r.layerId,name:r.name,error:r.error,enabled:r.record.enabled}))});
  function remember(){if(lastDoc)sessions.set(lastDoc,{last,paused,reason});}
  function resetBaseline(){const doc=app.activeDocument;lastDoc=doc?.id||null;last=doc?snapshot(doc):null;due=0;remember();}
  async function scan(doc) {
    const found=[];
    for(const layer of Array.from(doc.layers)) {
      const record=await H.metadata(doc.id,layer.id);
      if(record)found.push({layerId:layer.id,name:layer.name,record,error:""});
    }
    records=found;return found;
  }
  async function refresh(force=false) {
    if(busy||blocked())return;
    const doc=app.activeDocument;if(!doc)return;
    busy=true;error="";state="checking";notify();
    try {
      await scan(doc);
      const enabled=records.filter(r=>r.record.enabled);
      const ordered=D.order(enabled),failed=new Set();
      for(const r of ordered) {
        if(app.activeDocument?.id!==doc.id)break;
        if(paused&&!force)break;
        if(r.record.bindings.some(b=>failed.has(b.layerId))){r.error="An upstream live result is stale.";failed.add(r.layerId);continue;}
        try {
          const result=await H.run({...D.options(r.record,doc.id),outputLayerId:r.layerId,live:true,skipFingerprint:force?null:r.record.fingerprint});
          r.record.fingerprint=result.fingerprint;
        }catch(e){r.error=String(e.message||e);failed.add(r.layerId);}
      }
      state=paused?"paused":failed.size?"stale":enabled.length?"live":"idle";
      error=records.filter(r=>r.error).map(r=>`${r.name}: ${r.error}`).join("\n");
    }catch(e){state="stale";error=String(e.message||e);}
    finally{busy=false;resetBaseline();notify();}
  }
  async function tick() {
    if(busy||blocked())return;
    try {
      const doc=app.activeDocument;
      if(!doc){records=[];state="idle";resetBaseline();notify();return;}
      const current=snapshot(doc);
      if(doc.id!==lastDoc){remember();const previous=sessions.get(doc.id);paused=previous?.paused||false;reason=previous?.reason||"";lastDoc=doc.id;last=previous?.last||current;due=Date.now()+600;records=[];}
      if(last && current.id!==last.id) {
        if(last.ids.has(current.id)) {paused=true;reason="Undo/redo detected. Resume when you are ready to update results.";state="paused";notify();}
        else if(!paused)due=Date.now()+600;
        last=current;remember();
      }
      if(due&&Date.now()>=due){due=0;await refresh();}
    }catch(e){state="stale";error=String(e.message||e);notify();}
  }
  function start(){if(!timer){timer=setInterval(tick,400);tick();}}
  function stop(){if(timer)clearInterval(timer);timer=null;}
  function pause(){paused=true;due=0;reason="Live updates paused for this document.";state="paused";remember();notify();}
  async function resume(){paused=false;reason="";await refresh(true);}
  async function changed(){resetBaseline();await scan(app.activeDocument);state=paused?"paused":"live";notify();}
  async function freeze(layerId) {
    if(busy||blocked())throw new Error("Wait for the current update to finish.");
    const doc=app.activeDocument;if(!doc)throw new Error("Open the source document.");
    busy=true;
    try {
      await core.executeAsModal(async ctx=>{
        const record=await H.metadata(doc.id,layerId);if(!record)throw new Error("Select a Layer Math result.");
        const history=await ctx.hostControl.suspendHistory({documentID:doc.id,name:"Freeze Layer Math result"});
        try{record.enabled=false;await H.saveMetadata(doc.id,layerId,record);await ctx.hostControl.resumeHistory(history,true);}
        catch(e){await ctx.hostControl.resumeHistory(history,false);throw e;}
      },{commandName:"Freeze Layer Math result"});
      await scan(doc);state=paused?"paused":records.some(r=>r.record.enabled)?"live":"idle";
    }finally{busy=false;resetBaseline();notify();}
  }
  return {start,stop,pause,resume,refresh,changed,freeze,get busy(){return busy;},get records(){return records;},get paused(){return paused;}};
}
module.exports={create,snapshot};
