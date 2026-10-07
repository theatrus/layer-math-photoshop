"use strict";
const {app,core,imaging,constants}=require("photoshop"),H=require("./host.js"),P=require("./pixels.js"),Live=require("./live.js"),D=require("./live-data.js");
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const assert=(value,message)=>{if(!value)throw new Error(message);};
async function suite(depth=16) {
 let doc,controller;const results=[];const width=259,height=133,box={left:0,top:0,right:width,bottom:height};
 let a,b;
 async function pixels(layer,value) {
  const array=depth===16?new Uint16Array(width*height*3).fill(Math.round(value*32768)):new Float32Array(width*height*3).fill(value);
  const data=await imaging.createImageDataFromBuffer(array,{width,height,components:3,colorSpace:"RGB",colorProfile:P.profileName(doc.colorProfileName),fullRange:false});
  try{await imaging.putPixels({documentID:doc.id,layerID:layer.id,imageData:data});}finally{data.dispose();}
 }
 async function mask(layer,invert=false) {
  if(!(await H.descriptor(doc.id,layer.id)).hasUserMask)await H.play([{_obj:"select",_target:[{_ref:"layer",_id:layer.id}],makeVisible:false},{_obj:"make",new:{_class:"channel"},at:{_ref:"channel",_enum:"channel",_value:"mask"},using:{_enum:"userMaskEnabled",_value:"revealAll"}}]);
  const data=await imaging.createImageDataFromBuffer(Uint8Array.from({length:width*height},(_,i)=>{const v=[0,64,128,255][i%4];return invert?255-v:v;}),{width,height,components:1,colorSpace:"Grayscale"});
  try{await imaging.putLayerMask({documentID:doc.id,layerID:layer.id,imageData:data});}finally{data.dispose();}
 }
 async function read(layerId){return core.executeAsModal(()=>H.read(doc,{name:"test",layerId},box,depth,3),{commandName:"Read verification pixels"});}
 async function readRaw(layerId){return core.executeAsModal(async ctx=>{
  const history=await ctx.hostControl.suspendHistory({documentID:doc.id,name:"Read raw verification pixels"});
  try{await H.play([{_obj:"set",_target:[{_ref:"layer",_id:layerId},{_ref:"document",_id:doc.id}],to:{_obj:"layer",userMaskEnabled:false}}]);return await H.read(doc,{name:"raw output",layerId},box,depth,3);}
  finally{await ctx.hostControl.resumeHistory(history,false);}
 },{commandName:"Read raw verification pixels"});}
 try{
  await core.executeAsModal(async()=>{
   doc=await app.createDocument({name:`Layer Math masks and live test ${depth}`,width,height,mode:constants.NewDocumentMode.RGB,depth,profile:"sRGB IEC61966-2.1"});
   a=await doc.createLayer({name:"A"});await pixels(a,0.25);b=await doc.createLayer({name:"B"});await pixels(b,0.75);await mask(a);
  },{commandName:"Create mask fixtures"});
  const options={documentId:doc.id,bindings:[{name:"A",layerId:a.id,kind:"pixels"},{name:"B",layerId:b.id,kind:"pixels"},{name:"M",layerId:a.id,kind:"mask"}],parameters:{},expressions:{shared:"mix(A,B,M)"},destination:"new-layer",rangePolicy:"ask",name:"Live masked blend",live:true};
  const output=await H.run(options),layer=Array.from(doc.layers).find(l=>l.id===output.layerId);
  const saved=await H.metadata(doc.id,layer.id);assert(saved?.enabled&&saved.bindings[2].kind==="mask","Metadata did not roundtrip");
  let masks=await core.executeAsModal(()=>H.read(doc,{name:"M",layerId:a.id,kind:"mask"},box,depth,1),{commandName:"Read mask fixture"});
  let values=await read(layer.id);
  const tolerance=depth===16?1/32768:1e-7;
  assert(values.every((v,i)=>Math.abs(v-(0.25+0.5*masks[Math.floor(i/3)]))<=tolerance),"Mask broadcasting or raw pixel read is wrong");
  assert((await H.descriptor(doc.id,a.id)).userMaskEnabled,"Input mask was not restored");results.push("mask broadcasting, full-canvas raw masked pixels, metadata");
  const oldHistory=doc.activeHistoryState.id;
  const unchanged=await H.run({...options,outputLayerId:layer.id,skipFingerprint:output.fingerprint});
  assert(unchanged.unchanged&&doc.activeHistoryState.id===oldHistory,"Unchanged refresh added history");results.push("unchanged refresh has no history entry");
  await core.executeAsModal(async()=>{await mask(layer);layer.opacity=55;layer.visible=false;await pixels(b,0.5);},{commandName:"Change input and output appearance"});
  const originalOpacity=layer.opacity;
  const updated=await H.run({...options,outputLayerId:layer.id});
  assert(updated.layerId===layer.id&&layer.opacity===originalOpacity&&!layer.visible,`Output identity/appearance changed: ${updated.layerId}/${layer.id}, opacity ${layer.opacity}, visible ${layer.visible}`);
  let outMask=await core.executeAsModal(()=>H.read(doc,{name:"out mask",layerId:layer.id,kind:"mask"},box,depth,1),{commandName:"Read output mask"});
  assert(outMask.every((v,i)=>v===masks[i]),"Output mask was overwritten");results.push("in-place update preserves mask, visibility and opacity");
  // Verify raw output pixels by using the adapter with a temporary disabled mask.
  const inspected=await H.run({...options,bindings:[{name:"A",layerId:a.id,kind:"pixels"}],expressions:{shared:"A"},live:false},{left:0,top:0,right:4,bottom:1});
  assert(inspected.values.every(v=>v===0.25),"Masked source pixels changed");
  const before=await H.metadata(doc.id,layer.id),beforePixels=await readRaw(layer.id);let checks=0;
  try{await H.run({...options,outputLayerId:layer.id,expressions:{shared:"A+B"},cancelled:()=>++checks>=Array.from(P.tiles(width,height)).length+3});throw new Error("Cancellation accepted");}catch(e){assert(String(e.message||e).includes("Cancelled"),String(e.message||e));}
  assert(JSON.stringify(await H.metadata(doc.id,layer.id))===JSON.stringify(before),"Cancelled update changed recipe");assert((await H.descriptor(doc.id,a.id)).userMaskEnabled,"Cancel left mask disabled");
  assert((await readRaw(layer.id)).every((v,i)=>v===beforePixels[i]),"Cancelled update changed output pixels");
  checks=0;
  try{await H.run({...options,outputLayerId:layer.id,expressions:{shared:"A+B"},cancelled:()=>++checks>=2*Array.from(P.tiles(width,height)).length+2});throw new Error("Late cancellation accepted");}catch(e){assert(String(e.message||e).includes("Cancelled"),String(e.message||e));}
  assert(JSON.stringify(await H.metadata(doc.id,layer.id))===JSON.stringify(before),"Late cancellation changed XMP recipe");
  assert((await readRaw(layer.id)).every((v,i)=>v===beforePixels[i]),"Late cancellation changed output pixels");results.push("cancel rolls back updated pixels, recipe and temporary mask state");
  const target=await core.executeAsModal(()=>doc.createLayer({name:"Generated mask target"}),{commandName:"Create mask target"});
  await H.run({...options,live:false,destination:"layer-mask",maskTargetId:target.id,bindings:[{name:"A",layerId:a.id}],expressions:{shared:"A"}});
  const generated=await core.executeAsModal(()=>H.read(doc,{name:"generated",layerId:target.id,kind:"mask"},box,depth,1),{commandName:"Check generated mask"});
  assert(generated.every(v=>Math.abs(v-0.25)<1/255),"Generated mask values incorrect");results.push("formula output to attached layer mask");
  let latest;
  controller=Live.create(info=>{latest=info;});await controller.refresh();controller.start();
  const startFingerprint=(await H.metadata(doc.id,layer.id)).fingerprint;
  await core.executeAsModal(()=>mask(a,true),{commandName:"Paint source mask"});
  for(let i=0;i<30;i++){await sleep(200);if((await H.metadata(doc.id,layer.id)).fingerprint!==startFingerprint)break;}
  assert((await H.metadata(doc.id,layer.id)).fingerprint!==startFingerprint,"Source mask change did not auto-refresh");results.push("source-mask edit automatically refreshes live result");
  await core.executeAsModal(()=>H.play([{_obj:"select",_target:[{_ref:"historyState",_enum:"ordinal",_value:"previous"}]}]),{commandName:"Undo live refresh"});
  await sleep(1300);assert(controller.paused,"Undo did not pause automatic updates");const undone=doc.activeHistoryState.id;await sleep(1000);assert(doc.activeHistoryState.id===undone,"Automatic update fought Undo");results.push("Undo pauses without destroying redo history");
  await controller.resume();assert(!controller.paused,"Resume failed");
  await controller.freeze(layer.id);const frozen=(await H.metadata(doc.id,layer.id));assert(!frozen.enabled,"Freeze failed");results.push("resume and freeze");
  controller.stop();
  await core.executeAsModal(()=>H.play([{_obj:"select",_target:[{_ref:"historyState",_enum:"ordinal",_value:"previous"}]}]),{commandName:"Undo freeze"});
  assert((await H.metadata(doc.id,layer.id)).enabled,"Undo freeze did not restore recipe metadata");results.push("recipe metadata participates in Undo");
  const chainOptions={...options,bindings:[{name:"A",layerId:b.id}],expressions:{shared:"A/2"},name:"Upstream"};
  const upstream=await H.run(chainOptions);
  const downstream=await H.run({...chainOptions,bindings:[{name:"A",layerId:upstream.layerId}],expressions:{shared:"A*2"},name:"Downstream"});
  const previous=await H.metadata(doc.id,upstream.layerId);
  try{await H.run({...chainOptions,outputLayerId:upstream.layerId,bindings:[{name:"A",layerId:downstream.layerId}]});throw Error("Cycle accepted");}
  catch(e){assert(String(e.message||e).includes("cycle"),String(e.message||e));}
  assert(JSON.stringify(previous)===JSON.stringify(await H.metadata(doc.id,upstream.layerId)),"Cycle changed saved recipe");
  await core.executeAsModal(()=>pixels(b,0.625),{commandName:"Edit pixel source"});
  await controller.refresh();
  assert((await read(downstream.layerId)).every(v=>Math.abs(v-0.625)<=tolerance),"Dependency order did not propagate pixel change");results.push("pixel changes propagate upstream first; feedback cycles rejected");
  const preserved=await read(upstream.layerId);
  await core.executeAsModal(()=>b.delete(),{commandName:"Delete source fixture"});
  await controller.refresh();
  assert(latest.state==="stale"&&latest.error.includes("missing"),"Missing source was not reported");
  assert((await read(upstream.layerId)).every((v,i)=>v===preserved[i]),"Missing source overwrote last good output");results.push("missing source marks results stale and preserves pixels");
  return {depth,results,pass:true};
 }finally{if(controller)controller.stop();if(doc)await core.executeAsModal(()=>doc.closeWithoutSaving(),{commandName:"Close masks/live fixtures"});}
}
async function persistence(depth=16) {
  let doc,file;const {XMPMeta}=require("uxp").xmp,namespace="https://theatr.us/layer-math/test/";
  try {
    const folder=await require("uxp").storage.localFileSystem.getTemporaryFolder();
    file=await folder.createFile(`layer-math-save-test-${Date.now()}.psd`,{overwrite:false});
    let source;
    await core.executeAsModal(async()=>{
      doc=await app.createDocument({name:"Layer Math persistence test",width:4,height:3,mode:constants.NewDocumentMode.RGB,depth,profile:"sRGB IEC61966-2.1"});
      source=await doc.createLayer({name:"Source"});
      const array=depth===16?new Uint16Array(36).fill(8192):new Float32Array(36).fill(0.25);
      const data=await imaging.createImageDataFromBuffer(array,{width:4,height:3,components:3,colorSpace:"RGB",colorProfile:"sRGB IEC61966-2.1",fullRange:false});
      try{await imaging.putPixels({documentID:doc.id,layerID:source.id,imageData:data});}finally{data.dispose();}
      XMPMeta.registerNamespace(namespace,"layerMathTest");const packet=new XMPMeta();packet.setProperty(namespace,"unrelated","Keep this value");
      await H.play([{_obj:"set",_target:[{_ref:"property",_property:"XMPMetadataAsUTF8"},{_ref:"document",_id:doc.id}],to:{_obj:"document",XMPMetadataAsUTF8:packet.serialize()}}]);
    },{commandName:"Create persistence fixture"});
    const output=await H.run({documentId:doc.id,bindings:[{name:"A",layerId:source.id}],parameters:{},expressions:{shared:"A*2"},destination:"new-layer",rangePolicy:"ask",name:"Persistent live result",live:true});
    await core.executeAsModal(async()=>{await doc.saveAs.psd(file,{layers:true},false);await doc.closeWithoutSaving();doc=null;doc=await app.open(file);},{commandName:"Save and reopen fixture"});
    const record=await H.metadata(doc.id,output.layerId);assert(record?.recipe.expressions.shared==="A*2"&&record.enabled,"PSD did not retain recipe");
    const restored=D.options(record,doc.id);assert(restored.bindings[0].layerId===source.id,"Saved layer binding changed");
    const checked=await H.run({...restored,outputLayerId:output.layerId,live:true,skipFingerprint:record.fingerprint});assert(checked.unchanged,"Reopened input changed fingerprint");
    const desc=(await H.play([{_obj:"get",_target:[{_ref:"property",_property:"XMPMetadataAsUTF8"},{_ref:"document",_id:doc.id}]}]))[0];
    assert(new XMPMeta(desc.XMPMetadataAsUTF8).getProperty(namespace,"unrelated").value==="Keep this value","Unrelated metadata lost");
    return {depth,pass:true,results:["PSD save/reopen retains recipe and source IDs","unchanged reopened result needs no rewrite","unrelated XMP metadata preserved"]};
  }finally{
    if(doc)await core.executeAsModal(()=>doc.closeWithoutSaving(),{commandName:"Close persistence fixture"});
    if(file){try{await file.delete();}catch(_){/* creation can fail before a file exists */}}
  }
}
module.exports={suite,persistence};
