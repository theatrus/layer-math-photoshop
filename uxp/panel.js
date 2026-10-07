"use strict";
const H = require("./host.js"), R = require("./recipes.js");
const {app} = require("photoshop");
const presets = require("./presets.json");
const Live=require("./live.js"),D=require("./live-data.js");
const $ = id => document.getElementById(id);
let boundDoc = null, available = [], cancelled = false, busy = false;
let editResultId=null,editTimer=null;
const live=Live.create(info=>{
  $("liveState").textContent=info.error || info.reason || (info.state==="live" ? "Live — sources checked after edits settle." : info.state==="checking" ? "Checking live sources…" : "Live recipes are stored with the result. Automatic updates require this plugin.");
  const selected=$("liveResults").value;$("liveResults").innerHTML="";
  const empty=document.createElement("option");empty.value="";empty.textContent="Saved results…";$("liveResults").appendChild(empty);
  for(const r of info.records){const o=document.createElement("option");o.value=String(r.layerId);o.textContent=r.name+(r.enabled?"":" (frozen)");$("liveResults").appendChild(o);}
  $("liveResults").value=info.records.some(r=>String(r.layerId)===selected)?selected:"";
},()=>busy||Boolean(editTimer));
function status(text) { $("status").textContent = text; }
function binding(name, id, kind="pixels") {
  const row = document.createElement("div"); row.className = "binding";
  const alias = document.createElement("input"); alias.value = name; alias.setAttribute("aria-label","Input alias");
  const select = document.createElement("select"); select.setAttribute("aria-label","Source layer");
  const empty = document.createElement("option"); empty.value = ""; empty.textContent = "Choose layer…"; select.appendChild(empty);
  for (const layer of available) { const o = document.createElement("option"); o.value = String(layer.id); o.textContent = layer.name; select.appendChild(o); }
  select.value = id && available.some(l => l.id === id) ? String(id) : "";
  const source=document.createElement("select");source.className="input-kind";source.setAttribute("aria-label","Input kind");
  for(const [value,label] of [["pixels","Pixels"],["mask","Mask"]]){const o=document.createElement("option");o.value=value;o.textContent=label;source.appendChild(o);}source.value=kind;
  const remove = document.createElement("button"); remove.textContent = "−"; remove.setAttribute("aria-label","Remove input"); remove.onclick = () => {row.remove();scheduleEdit();};
  row.appendChild(alias); row.appendChild(select); row.appendChild(source); row.appendChild(remove); $("bindings").appendChild(row);
}
function rows() { return Array.from($("bindings").children).map(row => ({name:row.children[0].value.trim(),layerId:Number(row.children[1].value),kind:row.children[2].value})); }
function parameter(name,value) {
  const row=document.createElement("div");row.className="parameter";
  const key=document.createElement("input");key.value=name;key.setAttribute("aria-label","Parameter name");
  const equal=document.createElement("span");equal.textContent="=";
  const number=document.createElement("input");number.value=String(value);number.setAttribute("aria-label","Parameter value");
  const remove=document.createElement("button");remove.textContent="−";remove.setAttribute("aria-label","Remove parameter");remove.onclick=()=>{row.remove();scheduleEdit();};
  row.appendChild(key);row.appendChild(equal);row.appendChild(number);row.appendChild(remove);$("parameters").appendChild(row);
}
function parameters() {
  const entries=[],names=new Set();
  for(const row of $("parameters").children) {
    const name=row.children[0].value.trim(),text=row.children[2].value.trim();
    if(!/^[A-Za-z_][A-Za-z_0-9]{0,63}$/.test(name))throw new Error("Parameter names must start with a letter or underscore and contain only letters, digits or underscores (up to 64 characters).");
    if(names.has(name))throw new Error(`Duplicate parameter: ${name}.`);
    if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)||!Number.isFinite(Number(text)))throw new Error(`Enter a finite number for ${name}.`);
    names.add(name);entries.push([name,Number(text)]);
  }
  return Object.fromEntries(entries);
}
function refresh() {
  const previous = rows(), doc = app.activeDocument;
  const same = boundDoc === doc?.id; boundDoc = doc?.id || null; available = H.layers(doc);
  if(!same)editResultId=null;
  $("documentName").textContent = doc ? doc.name : "Open a document";
  $("bindings").innerHTML = "";
  for (const row of previous.length ? previous : [{name:"A"},{name:"B"}]) binding(row.name,same ? row.layerId : null,row.kind);
  const previousTarget=$("maskTarget").value;$("maskTarget").innerHTML="";
  const empty=document.createElement("option");empty.value="";empty.textContent="Choose mask target…";$("maskTarget").appendChild(empty);
  for(const layer of available){const o=document.createElement("option");o.value=String(layer.id);o.textContent=layer.name;$("maskTarget").appendChild(o);}
  $("maskTarget").value=same?previousTarget:"";
  $("apply").textContent=editResultId?"Update":"Apply";
}
function recipe() {
  return R.validate({formatVersion:1,languageVersion:"layer-math-1",name:$("name").value,
    inputs:rows().map(r=>r.name),inputKinds:Object.fromEntries(rows().map(r=>[r.name,r.kind])),parameters:parameters(),
    expressions:$("mode").value === "shared" ? {shared:$("expression").value} : {r:$("expression").value,g:$("green").value,b:$("blue").value},
    output:{destination:$("destination").value,depth:$("destination").value === "new-document" ? 32 : "document",outOfRange16:$("range").value}});
}
function loadRecipe(r, preserveBindings=false) {
  R.validate(r); refresh(); const previous=preserveBindings ? rows() : []; $("bindings").innerHTML = "";
  r.inputs.forEach(name=>{const old=previous.find(row=>row.name===name);binding(name,old?.layerId,r.inputKinds?.[name]||old?.kind||"pixels");});
  $("name").value=r.name; $("parameters").innerHTML="";
  Object.entries(r.parameters).forEach(([name,value])=>parameter(name,value));
  $("mode").value=r.expressions.shared !== undefined ? "shared" : "rgb"; mode();
  $("expression").value=r.expressions.shared ?? r.expressions.r; $("green").value=r.expressions.g || ""; $("blue").value=r.expressions.b || "";
  $("destination").value=r.output.destination; $("range").value=r.output.outOfRange16;
  destination();
  $("recipeDescription").textContent=r.description || "";
  disclosure("parameters",Object.keys(r.parameters).length>0);
  $("preview").textContent="";
  status(rows().every(row=>row.layerId) ? "Ready to apply." : "Bind each input to a layer before applying.");
}
function mode() { for(const id of ["redLabel","greenField","blueField"]) $(id).style.display = $("mode").value === "rgb" ? "block" : "none"; }
function disclosure(name,open) {
  $(name+"Section").style.display=open ? "block" : "none";
  $(name+"Toggle").setAttribute("aria-expanded",String(open));
  $(name+"Toggle").textContent=(open ? "− " : "+ ")+(name==="crop" ? "Inspect crop" : "Parameters");
}
async function execute(preview) {
  if (busy || live.busy) {status("An update is running. Try again when it finishes.");return;}
  if(editTimer){clearTimeout(editTimer);editTimer=null;}
  busy=true; cancelled=false;
  for (const control of document.querySelectorAll("button,input,textarea,select")) control.disabled=true;
  $("cancel").disabled=false;
  try {
    if(app.activeDocument?.id!==boundDoc)throw new Error("The active document changed. Refresh layers before applying.");
    const r=recipe();
    const options={documentId:boundDoc,bindings:rows(),parameters:r.parameters,expressions:r.expressions,destination:r.output.destination,rangePolicy:r.output.outOfRange16,name:r.name,cancelled:()=>cancelled,live:$("liveEnabled").checked,outputLayerId:editResultId,maskTargetId:Number($("maskTarget").value)};
    if(editResultId && !options.live)throw new Error("Use Freeze to stop a live result, or New result to create another output.");
    if (options.bindings.some(b=>!b.layerId)) throw new Error("Choose a layer for each input.");
    status(preview ? "Reading crop…" : "Analyzing full image…");
    const doc=Array.from(app.documents).find(d=>d.id===boundDoc);
    const left=Number($("x").value),top=Number($("y").value);
    const b=preview && doc ? {left,top,right:Math.min(left+128,doc.width),bottom:Math.min(top+128,doc.height)} : null;
    const result=await H.run(options,b);
    if(!preview && options.live){editResultId=result.layerId;$("apply").textContent="Update";await live.changed();}
    if (preview) $("preview").textContent=`Crop range: ${result.range.min} … ${result.range.max}\nFirst pixel (${left}, ${top}): ${Array.from(result.values.slice(0,result.channels)).join(", ")}\nCrop inspection does not determine the full-image output range.`;
    status(preview ? "Crop inspected at full resolution." : `${options.outputLayerId?"Updated":"Created"} result. Range: ${result.range.min} … ${result.range.max}`);
    return true;
  } catch(e) { status(String(e.message || e));if(editResultId)live.pause(); }
  finally { busy=false; for(const c of document.querySelectorAll("button,input,textarea,select")) c.disabled=false; $("cancel").disabled=true;destination(); }
}
function destination(){const mask=$("destination").value==="layer-mask";$("maskTarget").style.display=mask?"block":"none";$("liveEnabled").disabled=$("destination").value!=="new-layer";if($("liveEnabled").disabled)$("liveEnabled").checked=false;}
function scheduleEdit(){
  if(!editResultId||!$("liveEnabled").checked||live.paused||busy)return;
  if(editTimer)clearTimeout(editTimer);
  editTimer=setTimeout(()=>{editTimer=null;if(live.busy)scheduleEdit();else execute(false);},900);
}
$("destination").onchange=()=>{editResultId=null;$("apply").textContent="Apply";destination();};
$("newResult").onclick=()=>{editResultId=null;if(editTimer)clearTimeout(editTimer);editTimer=null;$("apply").textContent="Apply";status("Next Apply creates a new result.");};
$("pauseLive").onclick=()=>{if(editTimer)clearTimeout(editTimer);editTimer=null;live.pause();};
$("resumeLive").onclick=async()=>{if(!editResultId||await execute(false))await live.resume();};
$("freezeLive").onclick=async()=>{try{await live.freeze(Number($("liveResults").value)||editResultId);editResultId=null;$("liveEnabled").checked=false;$("apply").textContent="Apply";status("Result frozen. Its pixels and mask are preserved.");}catch(e){status(e.message);}};
$("editLive").onclick=async()=>{try{
  const doc=app.activeDocument,id=Number($("liveResults").value);if(!doc||!id)throw new Error("Choose a saved result.");
  const record=await H.metadata(doc.id,id);if(!record)throw new Error("The saved result is missing.");
  const o=D.options(record,doc.id);loadRecipe(record.recipe);$("bindings").innerHTML="";o.bindings.forEach(b=>binding(b.name,b.layerId,b.kind));
  editResultId=id;$("liveEnabled").checked=true;$("apply").textContent="Update";status("Editing saved result. Formula changes update it while live updates are enabled.");
}catch(e){status(e.message);}};
document.querySelector(".content").addEventListener("input",scheduleEdit);
document.querySelector(".content").addEventListener("change",scheduleEdit);
$("refresh").onclick=refresh; $("add").onclick=()=>{binding("Input"+(rows().length+1));scheduleEdit();}; $("mode").onchange=mode;
$("addParameter").onclick=()=>{
  const names=new Set([...rows().map(r=>r.name),...Array.from($("parameters").children,r=>r.children[0].value.trim())]);
  let i=1;while(names.has("value"+i))i++;parameter("value"+i,1);scheduleEdit();
};
$("apply").onclick=()=>execute(false); $("previewButton").onclick=()=>execute(true); $("cancel").onclick=()=>{cancelled=true;};
presets.recipes.forEach((r,i)=>{const o=document.createElement("option");o.value=String(i);o.textContent=r.name;$("preset").appendChild(o);});
$("preset").onchange=()=>{if($("preset").value!=="") loadRecipe({...presets.recipes[Number($("preset").value)],formatVersion:1,languageVersion:"layer-math-1"},true);};
for(const name of ["parameters","crop"]) $(name+"Toggle").onclick=()=>disclosure(name,$(name+"Toggle").getAttribute("aria-expanded")!=="true");
$("save").onclick=async()=>{try{const r=recipe();const f=await require("uxp").storage.localFileSystem.getFileForSaving("layer-math.json",{types:["json"]});if(f)await f.write(JSON.stringify(r,null,2));}catch(e){status(e.message);}};
$("load").onclick=async()=>{try{const f=await require("uxp").storage.localFileSystem.getFileForOpening({types:["json"]});if(f){loadRecipe(R.parse(await f.read()));$("preset").value="";}}catch(e){status(e.message);}};
refresh();live.start();
