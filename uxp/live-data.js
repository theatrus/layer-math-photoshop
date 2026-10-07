"use strict";
const R=require("./recipes.js");
function options(record, documentId) {
  if(!record || record.version!==1 || typeof record.enabled!=="boolean")throw new Error("Unsupported live result metadata.");
  const r=R.validate(record.recipe);
  if(r.output.destination!=="new-layer")throw new Error("Live results must be pixel layers in the source document.");
  if(!Array.isArray(record.bindings)||record.bindings.length!==r.inputs.length)throw new Error("Invalid live input bindings.");
  const bindings=record.bindings.map((b,i)=>{
    if(!b||b.name!==r.inputs[i]||!Number.isSafeInteger(b.layerId)||b.layerId<=0||!["pixels","mask"].includes(b.kind))throw new Error("Invalid saved layer binding.");
    return {name:b.name,layerId:b.layerId,kind:b.kind};
  });
  return {documentId,bindings,parameters:r.parameters,expressions:r.expressions,destination:"new-layer",rangePolicy:r.output.outOfRange16,name:r.name};
}
function make(o, fingerprint) {
  const bindings=o.bindings.map(b=>({name:b.name,layerId:b.layerId,kind:b.kind||"pixels"}));
  const record={version:1,enabled:true,fingerprint,bindings,recipe:{formatVersion:1,languageVersion:"layer-math-1",name:o.name||"Layer Math",inputs:bindings.map(b=>b.name),inputKinds:Object.fromEntries(bindings.map(b=>[b.name,b.kind])),parameters:o.parameters,expressions:o.expressions,output:{destination:"new-layer",depth:"document",outOfRange16:o.rangePolicy}}};
  options(record,o.documentId);return record;
}
function order(records) {
  const byId=new Map(records.map(r=>[r.layerId,r])), visiting=new Set(),done=new Set(),sorted=[];
  function visit(r) {
    if(visiting.has(r.layerId))throw new Error("Live result dependency cycle. Freeze a result or change its inputs.");
    if(done.has(r.layerId))return;
    visiting.add(r.layerId);
    for(const b of r.record.bindings)if(byId.has(b.layerId))visit(byId.get(b.layerId));
    visiting.delete(r.layerId);done.add(r.layerId);sorted.push(r);
  }
  records.forEach(visit);return sorted;
}
module.exports={options,make,order};
