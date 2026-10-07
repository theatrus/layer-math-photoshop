"use strict";
const {app, core, imaging, constants, action} = require("photoshop");
const P = require("./pixels.js"), D = require("./live-data.js");
let addon;
async function native() {
  if (!addon) { const loaded = await require("layer_math.uxpaddon"); if (loaded.abiVersion() !== 1) throw new Error("Native ABI mismatch. Reinstall Layer Math."); addon = loaded; }
  return addon;
}
function bits(doc) {
  if (doc.bitsPerChannel === constants.BitsPerChannelType.SIXTEEN) return 16;
  if (doc.bitsPerChannel === constants.BitsPerChannelType.THIRTYTWO) return 32;
  throw new Error("Use a 16-bit or 32-bit document.");
}
function channels(doc) {
  if (doc.mode === constants.DocumentMode.RGB) return 3;
  if (doc.mode === constants.DocumentMode.GRAYSCALE) return 1;
  throw new Error("Use an RGB or grayscale document.");
}
function layers(doc = app.activeDocument) {
  return doc ? Array.from(doc.layers).map(l => ({id:l.id,name:l.name})) : [];
}
async function play(commands) {
  const results=await action.batchPlay(commands,{});
  const error=results.find(r=>r._obj==="error");
  if(error)throw new Error(error.message||"Photoshop command failed.");
  return results;
}
function target(docId,layerId) {return [{_ref:"layer",_id:layerId},{_ref:"document",_id:docId}];}
async function descriptor(docId,layerId) {return (await play([{_obj:"get",_target:target(docId,layerId)}]))[0];}
const RECIPE_NS="https://theatr.us/layer-math/1.0/";
async function recipePacket(docId) {
  const {XMPMeta}=require("uxp").xmp;
  XMPMeta.registerNamespace(RECIPE_NS,"layerMath");
  const desc=(await play([{_obj:"get",_target:[{_ref:"property",_property:"XMPMetadataAsUTF8"},{_ref:"document",_id:docId}]}]))[0];
  return new XMPMeta(desc.XMPMetadataAsUTF8||"");
}
async function metadata(docId,layerId) {
  const packet=await recipePacket(docId),text=packet.getProperty(RECIPE_NS,`result${layerId}`)?.value;
  if(!text)return null;
  if(typeof text!=="string"||text.length>131072)throw new Error("Invalid live result metadata size.");
  const record=JSON.parse(text);D.options(record,docId);return record;
}
async function saveMetadata(docId,layerId,record) {
  // Document XMP survives PSD save/reopen; layer generatorSettings did not in PS 27.10.
  // Preserve other namespaces and key recipes by the PSD's persistent layer ID.
  const packet=await recipePacket(docId),text=JSON.stringify(record);
  if(text.length>131072)throw new Error("Live recipe exceeds the metadata size limit.");
  packet.setProperty(RECIPE_NS,`result${layerId}`,text);
  await play([{_obj:"set",_target:[{_ref:"property",_property:"XMPMetadataAsUTF8"},{_ref:"document",_id:docId}],to:{_obj:"document",XMPMetadataAsUTF8:packet.serialize()}}]);
}
async function setMask(docId,layerId,enabled) {await play([{_obj:"set",_target:target(docId,layerId),to:{_obj:"layer",userMaskEnabled:enabled}}]);}
async function validate(doc, bindings) {
  const depth = bits(doc), count = channels(doc);
  if (doc.selection.bounds !== null) throw new Error("Clear the document selection before using Layer Math.");
  if (!Array.isArray(bindings) || !bindings.length || bindings.length > 32) throw new Error("Bind 1 to 32 inputs.");
  const inputs = [], masks=new Set();
  for (const binding of bindings) {
    const layer = Array.from(doc.layers).find(l => l.id === binding.layerId),kind=binding.kind||"pixels";
    if (!layer) throw new Error(`Remap ${binding.name}: the source layer is missing or nested.`);
    if(!["pixels","mask"].includes(kind))throw new Error("Unknown input kind.");
    const desc=await descriptor(doc.id,layer.id);
    if(kind==="mask") {
      if(!desc.hasUserMask)throw new Error(`${binding.name}: the layer has no pixel mask.`);
      if(desc.userMaskDensity!==255 || desc.userMaskFeather!==0)throw new Error(`${binding.name}: use mask density 100% and feather 0 for raw mask input.`);
    } else {
      if(layer.kind!==constants.LayerKind.NORMAL)throw new Error(`${binding.name}: Pixels requires a raster layer.`);
      if(layer.blendMode!==constants.BlendMode.NORMAL||layer.opacity!==100||layer.fillOpacity!==100)throw new Error(`${binding.name}: use Normal mode, 100% opacity and fill.`);
      if(desc.hasVectorMask||desc.hasFilterMask||desc.layerEffects||desc.group||desc.smartObject)throw new Error(`${binding.name}: vector/filter masks, effects, clipping and Smart Objects require a prepared raster copy.`);
      const bounds=desc.boundsNoMask||desc.boundsNoEffects;
      if(!bounds||["left","top","right","bottom"].some((k,i)=>bounds[k]._value!==[0,0,doc.width,doc.height][i]))throw new Error(`${binding.name}: the pixels must match the full canvas.`);
      if(desc.hasUserMask&&desc.userMaskEnabled)masks.add(layer.id);
    }
    inputs.push({name:binding.name,kind,channels:kind==="mask"?1:count,layerId:layer.id});
  }
  return {depth,count,inputs,masks};
}
async function read(doc, input, bounds, depth, count) {
  const mask=input.kind==="mask";
  const got = mask ? await imaging.getLayerMask({documentID:doc.id,layerID:input.layerId,kind:"user",sourceBounds:bounds}) : await imaging.getPixels({documentID:doc.id,layerID:input.layerId,sourceBounds:bounds,componentSize:-1,applyAlpha:false});
  try {
    const img = got.imageData;
    if (img.width !== bounds.right-bounds.left || img.height !== bounds.bottom-bounds.top || ["left","top","right","bottom"].some(k => got.sourceBounds[k] !== bounds[k])) throw new Error(`${input.name}: Photoshop returned cropped input bounds. Prepare a full-canvas source.`);
    if(mask) {
      if(img.components!==1||img.hasAlpha)throw new Error("Expected a single-channel pixel mask.");
      return P.decodeMask(await img.getData({chunky:true,fullRange:false}),img.componentSize);
    }
    if(img.componentSize!==depth||img.colorSpace!==(count===3?"RGB":"Grayscale"))throw new Error(`${input.name}: unexpected mode or depth.`);
    const profile=P.profileName(img.colorProfile),expected=P.profileName(doc.colorProfileName);
    if(profile&&expected&&profile!==expected)throw new Error(`${input.name}: pixel profile differs from the document.`);
    return P.decode(await img.getData({chunky:true,fullRange:false}),depth,img.components,img.hasAlpha,count);
  } finally { got.imageData.dispose(); }
}
async function evaluateTile(doc, config, handle, bounds, hash) {
  const buffers = [];
  for (const input of config.inputs) {
    const values=await read(doc,input,bounds,config.depth,input.channels);
    if(hash)hash.add(new Uint8Array(values.buffer));
    buffers.push(values.buffer);
  }
  try { return (await native()).evaluate(handle,buffers,(bounds.right-bounds.left)*(bounds.bottom-bounds.top)); }
  catch (e) { throw new Error(`Tile (${bounds.left}, ${bounds.top}): ${e.message}`); }
}
async function run(options, previewBounds = null) {
  const bridge = await native();
  const doc = Array.from(app.documents).find(d => d.id === options.documentId);
  if (!doc) throw new Error("The bound document was closed. Refresh and remap the inputs.");
  return core.executeAsModal(async ctx => {
    const config = await validate(doc,options.bindings),maskOutput=options.destination==="layer-mask";
    const count=maskOutput?1:config.count;
    if(maskOutput && options.expressions.shared===undefined)throw new Error("Mask output needs one shared expression. Use explicit RGB channel references if needed.");
    if(options.live && options.destination!=="new-layer")throw new Error("Live mode requires a result pixel layer in this document.");
    if(options.outputLayerId && options.bindings.some(b=>b.layerId===options.outputLayerId))throw new Error("A live result cannot read its own pixels or mask.");
    let layer;
    if(options.outputLayerId) {
      layer=Array.from(doc.layers).find(l=>l.id===options.outputLayerId);
      if(!layer||layer.kind!==constants.LayerKind.NORMAL||!await metadata(doc.id,layer.id))throw new Error("The live output is missing or no longer a Layer Math pixel layer.");
      const desc=await descriptor(doc.id,layer.id),bounds=desc.boundsNoMask||desc.boundsNoEffects;
      if(["left","top","right","bottom"].some((k,i)=>bounds[k]._value!==[0,0,doc.width,doc.height][i]))throw new Error("The live output was moved or resized. Restore its canvas bounds before resuming.");
      if(options.live){
        const records=[];
        for(const candidate of Array.from(doc.layers)){
          const record=candidate.id===layer.id?D.make(options,""):await metadata(doc.id,candidate.id);
          if(record?.enabled)records.push({layerId:candidate.id,record});
        }
        D.order(records);
      }
    }
    if(maskOutput) {
      layer=Array.from(doc.layers).find(l=>l.id===options.maskTargetId);
      if(!layer)throw new Error("Choose a target layer for the mask.");
      if(options.bindings.some(b=>b.kind==="mask"&&b.layerId===layer.id))throw new Error("Mask output cannot overwrite an input mask. Choose another target.");
    }
    const spec = {channels:count,inputs:config.inputs.map(({name,channels})=>({name,channels})),parameters:options.parameters,expressions:options.expressions};
    const handle = bridge.compile(JSON.stringify(spec));
    const cancelled = () => { if (ctx.isCancelled || options.cancelled?.()) throw new Error("Cancelled."); };
    let sourceHistory=null,outputHistory=null,newDoc=null,targetDoc=doc,complete=false,createdMask=false;
    try {
      sourceHistory=await ctx.hostControl.suspendHistory({documentID:doc.id,name:options.outputLayerId?"Update Layer Math":"Apply Layer Math"});
      for(const id of config.masks)await setMask(doc.id,id,false);
      if(previewBounds) {
        const b=previewBounds;
        if(![b.left,b.top,b.right,b.bottom].every(Number.isInteger)||b.left<0||b.top<0||b.right>doc.width||b.bottom>doc.height||b.right<=b.left||b.bottom<=b.top||(b.right-b.left)*(b.bottom-b.top)>16384)throw new Error("Preview must be a crop of at most 16,384 pixels inside the canvas.");
        const values=await evaluateTile(doc,config,handle,b),range=P.emptyRange();P.include(range,values);
        return {values,range,bounds:b,channels:count};
      }
      const hash=P.fingerprint(JSON.stringify([doc.width,doc.height,config.depth,P.profileName(doc.colorProfileName),spec,config.inputs,options.rangePolicy]));
      const range=P.emptyRange();let processed=0;
      for(const bounds of P.tiles(doc.width,doc.height)) {
        cancelled();const values=await evaluateTile(doc,config,handle,bounds,hash);P.include(range,values);
        processed+=values.length/count;ctx.reportProgress({value:0.5*processed/(doc.width*doc.height)});
      }
      const fingerprint=hash.value();
      if(options.outputLayerId && options.skipFingerprint===fingerprint)return {documentId:doc.id,layerId:layer.id,range,fingerprint,unchanged:true};
      const depth=options.destination==="new-document"?32:config.depth;
      if(!["new-layer","new-document","layer-mask"].includes(options.destination))throw new Error("Unsupported output destination.");
      // Masks always have a bounded domain, even in 32-bit documents.
      P.rangePolicy(range,maskOutput?16:depth,options.rangePolicy);cancelled();
      if(options.destination==="new-document") {
        newDoc=await app.createDocument({name:options.name||"Layer Math",width:doc.width,height:doc.height,resolution:doc.resolution,mode:count===3?constants.NewDocumentMode.RGB:constants.NewDocumentMode.GRAYSCALE,depth:32,...(P.profileName(doc.colorProfileName)?{profile:P.profileName(doc.colorProfileName)}:{})});
        targetDoc=newDoc;await ctx.hostControl.registerAutoCloseDocument(newDoc.id);
        outputHistory=await ctx.hostControl.suspendHistory({documentID:newDoc.id,name:"Apply Layer Math"});
      }
      if(!layer) {
        layer=await targetDoc.createLayer({name:options.name||"Layer Math",blendMode:constants.BlendMode.NORMAL,opacity:100});
        if(targetDoc.layers[0].id!==layer.id)await layer.move(targetDoc.layers[0],constants.ElementPlacement.PLACEBEFORE);
      }
      if(maskOutput && !(await descriptor(doc.id,layer.id)).hasUserMask) {
        await play([{_obj:"select",_target:target(doc.id,layer.id),makeVisible:false},{_obj:"make",new:{_class:"channel"},at:{_ref:"channel",_enum:"channel",_value:"mask"},using:{_enum:"userMaskEnabled",_value:"revealAll"}}]);
        createdMask=true;
        if(config.inputs.some(i=>i.kind==="pixels"&&i.layerId===layer.id))await setMask(doc.id,layer.id,false);
      }
      processed=0;
      for(const bounds of P.tiles(doc.width,doc.height)) {
        cancelled();const values=await evaluateTile(doc,config,handle,bounds);
        const imageData=await imaging.createImageDataFromBuffer(P.encode(values,maskOutput?16:depth,range,options.rangePolicy),{width:bounds.right-bounds.left,height:bounds.bottom-bounds.top,components:count,colorSpace:count===3?"RGB":"Grayscale",colorProfile:maskOutput?"":P.profileName(targetDoc.colorProfileName),chunky:true,fullRange:false});
        try {
          const args={documentID:targetDoc.id,layerID:layer.id,imageData,replace:processed===0,targetBounds:{left:bounds.left,top:bounds.top}};
          if(maskOutput)await imaging.putLayerMask(args);else await imaging.putPixels(args);
        }finally{imageData.dispose();}
        processed+=values.length/count;ctx.reportProgress({value:0.5+0.5*processed/(doc.width*doc.height)});
      }
      if(options.live)await saveMetadata(doc.id,layer.id,D.make(options,fingerprint));
      for(const id of config.masks)await setMask(doc.id,id,true);
      if(createdMask)await setMask(doc.id,layer.id,true);
      cancelled();
      if(outputHistory){await ctx.hostControl.resumeHistory(outputHistory,true);outputHistory=null;}
      await ctx.hostControl.resumeHistory(sourceHistory,!newDoc);sourceHistory=null;
      if(newDoc)await ctx.hostControl.unregisterAutoCloseDocument(newDoc.id);
      complete=true;return {documentId:targetDoc.id,layerId:layer.id,range,fingerprint};
    }finally{
      bridge.dispose(handle);
      if(outputHistory)await ctx.hostControl.resumeHistory(outputHistory,false);
      if(sourceHistory)await ctx.hostControl.resumeHistory(sourceHistory,false);
      if(newDoc&&!complete){try{await newDoc.closeWithoutSaving();}catch(_){/* auto-close remains registered */}}
    }
  },{commandName:previewBounds?"Preview Layer Math crop":options.outputLayerId?"Update Layer Math":"Apply Layer Math"});
}
module.exports = {run,layers,bits,channels,read,native,metadata,saveMetadata,descriptor,play};
