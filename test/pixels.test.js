"use strict";
const {test}=require("node:test"), assert=require("node:assert/strict");
const P=require("../uxp/pixels.js"),R=require("../uxp/recipes.js");
test("all Photoshop 16-bit codes survive the host conversion",()=>{
  const codes=Uint16Array.from({length:32769},(_,i)=>i);
  const values=P.decode(codes,16,1,false,1), range=P.emptyRange();P.include(range,values);
  assert.deepEqual(P.encode(values,16,range,"ask"),codes);
});
test("alpha validation and native ranges",()=>{
  assert.deepEqual(Array.from(P.decode(new Float32Array([-2,4,1,1]),32,4,true,3)),[-2,4,1]);
  assert.throws(()=>P.decode(new Float32Array([1,0.5]),32,2,true,1),/opaque/);
  assert.throws(()=>P.decode(new Uint16Array([65535]),16,1,false,1),/Invalid/);
  assert.throws(()=>P.decode(new Float32Array([Infinity]),32,1,false,1),/Invalid/);
});
test("range decisions are global and explicit",()=>{
  const r=P.emptyRange();P.include(r,[-2,0]);P.include(r,[1,2]);
  assert.throws(()=>P.encode([0],16,r,"ask"),/Choose/);
  assert.deepEqual(Array.from(P.encode([-2,0,1,2],16,r,"rescale")),[0,16384,24576,32768]);
  assert.deepEqual(Array.from(P.encode([-2,2],32,r,"ask")),[-2,2]);
  assert.throws(()=>P.encode([3],16,r,"clip"),/snapshot/);
  assert.throws(()=>P.encode([2],16,{min:2,max:2,samples:1},"rescale"),/constant/);
});
test("tiles exactly cover wide and partial canvases",()=>{
  const width=259,height=133,visits=new Uint8Array(width*height);
  for(const b of P.tiles(width,height))for(let y=b.top;y<b.bottom;y++)for(let x=b.left;x<b.right;x++)visits[y*width+x]++;
  assert.ok(visits.every(v=>v===1));
});
test("all supplied recipes validate, IDs never enter recipes",()=>{
  const collection=require("../examples/recipes.json");
  for(const r of collection.recipes)R.validate({...r,formatVersion:collection.formatVersion,languageVersion:collection.languageVersion});
  const r={...collection.recipes[0],formatVersion:1,languageVersion:"layer-math-1"};
  assert.throws(()=>R.validate({...r,formatVersion:2}),/version/);
  assert.throws(()=>R.validate({...r,layerId:32}),/fields/);
  assert.throws(()=>R.validate({...r,parameters:{Starless:1}}),/parameters/);
  assert.throws(()=>R.validate({...r,expressions:{shared:"A",r:"B"}}),/expressions/);
});
