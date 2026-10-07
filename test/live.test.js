"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const P=require("../uxp/pixels.js"),D=require("../uxp/live-data.js"),R=require("../uxp/recipes.js");
const options={documentId:1,name:"Masked blend",bindings:[{name:"A",layerId:2},{name:"M",layerId:3,kind:"mask"}],parameters:{amount:0.25},expressions:{shared:"mix(A,amount,M)"},rangePolicy:"ask"};
test("mask codes retain normalized endpoints and reject bad samples",()=>{
 assert.deepEqual(Array.from(P.decodeMask(new Uint8Array([0,128,255]),8)),[0,128/255,1]);
 assert.deepEqual(Array.from(P.decodeMask(new Uint16Array([0,16384,32768]),16)),[0,0.5,1]);
 for(const data of [[-1],[NaN],[Infinity],[32769],[0.5]])assert.throws(()=>P.decodeMask(data,16));
});
test("live metadata roundtrips typed bindings while rebinding the document",()=>{
 const record=JSON.parse(JSON.stringify(D.make(options,"fingerprint")));
 const restored=D.options(record,44);
 assert.equal(restored.documentId,44);assert.deepEqual(restored.bindings,[{name:"A",layerId:2,kind:"pixels"},{name:"M",layerId:3,kind:"mask"}]);
 assert.deepEqual(restored.expressions,options.expressions);
 assert.throws(()=>D.options({...record,version:2},44));
 assert.throws(()=>D.options({...record,bindings:[{name:"wrong",layerId:2,kind:"pixels"},record.bindings[1]]},44));
 assert.throws(()=>R.validate({...record.recipe,inputKinds:{Missing:"mask"}}));
});
test("live dependencies run upstream first and reject feedback loops",()=>{
 const make=(layerId,source)=>({layerId,record:D.make({...options,bindings:[{name:"A",layerId:source}],expressions:{shared:"A"}},"")});
 assert.deepEqual(D.order([make(9,8),make(8,2)]).map(r=>r.layerId),[8,9]);
 assert.throws(()=>D.order([make(9,8),make(8,9)]),/cycle/);
 assert.throws(()=>D.order([make(9,9)]),/cycle/);
});
test("change fingerprints include all input bytes and formula settings",()=>{
 const a=P.fingerprint("A"),b=P.fingerprint("A"),c=P.fingerprint("B");
 a.add(new Uint8Array([1,2,3]));b.add(new Uint8Array([1,2]));b.add(new Uint8Array([3]));c.add(new Uint8Array([1,2,3]));
 assert.equal(a.value(),b.value());assert.notEqual(a.value(),c.value());
 b.add(new Uint8Array([0]));assert.notEqual(a.value(),b.value());
});
