// Run demo-photoshop.js first. Uses only that script's synthetic document.
// Export with save-demo-gallery.py alongside the original gallery export.
(async()=>{
  const {app,core,imaging}=require("photoshop"),H=require("./host.js"),Live=require("./live.js");
  const d=globalThis.layerMathDemo;if(!d)throw Error("Run demo-photoshop.js first.");
  const doc=Array.from(app.documents).find(doc=>doc.id===d.documentId);
  if(!doc)throw Error("The synthetic demo document was closed.");
  const width=doc.width,height=doc.height,examples=[];
  let controller;
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const recipe=(name,bindings,expression,destination="new-layer",description="")=>({formatVersion:1,languageVersion:"layer-math-1",name,inputs:bindings.map(b=>b.name),inputKinds:Object.fromEntries(bindings.map(b=>[b.name,b.kind||"pixels"])),parameters:{},expressions:{shared:expression},output:{destination,depth:"document",outOfRange16:"ask"},description});
  async function capture(id,title,layerId,r,bindings,note) {
    const jpeg=await core.executeAsModal(async()=>{
      const got=await imaging.getPixels({documentID:doc.id,layerID:layerId,componentSize:8,applyAlpha:true,colorSpace:"RGB",colorProfile:"sRGB IEC61966-2.1"});
      try{return await imaging.encodeImageData({imageData:got.imageData,base64:true});}finally{got.imageData.dispose();}
    },{commandName:"Export mask and live example"});
    examples.push({id,title,recipe:r,bindings,note,jpeg});
  }
  async function render(r,bindings,extra={}){return H.run({documentId:doc.id,bindings,parameters:r.parameters,expressions:r.expressions,destination:r.output.destination,rangePolicy:"ask",name:r.name,...extra});}
  async function paintMask(invert) {
    await core.executeAsModal(async()=>{
      const data=new Uint16Array(width*height);
      for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
        const t=Math.max(0,Math.min(1,(x/width-0.22)/0.56)),smooth=t*t*(3-2*t);
        data[y*width+x]=Math.round((invert?1-smooth:smooth)*32768);
      }
      const image=await imaging.createImageDataFromBuffer(data,{width,height,components:1,colorSpace:"Grayscale",fullRange:false});
      try{await imaging.putLayerMask({documentID:doc.id,layerID:d.resultId,imageData:image});}finally{image.dispose();}
    },{commandName:invert?"Invert source mask for live demo":"Paint gradient source mask"});
  }
  // Avoid a second controller racing the demonstration's observed refresh.
  live.stop();
  try {
    await core.executeAsModal(async()=>{
      await H.play([{_obj:"select",_target:[{_ref:"layer",_id:d.resultId},{_ref:"document",_id:doc.id}],makeVisible:false},{_obj:"make",new:{_class:"channel"},at:{_ref:"channel",_enum:"channel",_value:"mask"},using:{_enum:"userMaskEnabled",_value:"revealAll"}}]);
    },{commandName:"Attach demo source mask"});
    await paintMask(false);
    const maskBinding=[{name:"M",layerId:d.resultId,kind:"mask"}],maskRecipe=recipe("Read a layer mask",maskBinding,"M","new-layer","A scalar pixel mask is broadcast equally to R, G and B. Use Mask as the input kind.");
    const maskBefore=await render(maskRecipe,maskBinding);
    await capture("layer-mask-before","1 · Source layer mask",maskBefore.layerId,maskRecipe,{M:"Screen recombination → Mask"},"An attached pixel mask, displayed as grayscale. Black keeps A; white selects B in the live blend.");
    const bindings=[{name:"A",layerId:d.resultId,kind:"pixels"},{name:"B",layerId:d.stretchId,kind:"pixels"},{name:"M",layerId:d.resultId,kind:"mask"}];
    const r=recipe("Live masked stretch",bindings,"mix(A, B, M)","new-layer","Blend the original and stretched image through an attached pixel mask. Check Live result before Apply.");
    const output=await render(r,bindings,{live:true});
    await capture("live-mask-before","2 · Live result before mask edit",output.layerId,r,{A:"Screen recombination → Pixels",B:"Midtones stretch → Pixels",M:"Screen recombination → Mask"},"Live result enabled. The right side receives the stretch; the left retains the original pixels.");
    const multiplyBindings=[bindings[0],bindings[2]],multiplyRecipe=recipe("Multiply by a layer mask",multiplyBindings,"A*M","new-layer","Multiply original pixel values by an attached mask. This writes a separate pixel layer.");
    const multiplied=await render(multiplyRecipe,multiplyBindings);
    await capture("multiply-layer-mask","Multiply pixels by a mask",multiplied.layerId,multiplyRecipe,{A:"Screen recombination → Pixels",M:"Screen recombination → Mask"},"Mask arithmetic: black becomes 0, white retains A, intermediate values attenuate A.");
    controller=Live.create();await controller.refresh();controller.start();
    const oldFingerprint=(await H.metadata(doc.id,output.layerId)).fingerprint;
    await paintMask(true);
    let refreshed=false;
    for(let i=0;i<100;i++){
      await sleep(200);
      const record=await H.metadata(doc.id,output.layerId);
      if(record.fingerprint!==oldFingerprint&&!controller.busy){refreshed=true;break;}
    }
    if(!refreshed)throw Error("The source-mask edit did not trigger an automatic refresh.");
    controller.stop();
    const maskAfter=await render(maskRecipe,maskBinding);
    await capture("layer-mask-after","3 · Source mask after inversion",maskAfter.layerId,maskRecipe,{M:"Screen recombination → Mask (inverted)"},"Only the attached source mask was edited. The formula and source pixel layers are unchanged.");
    await capture("live-mask-after","4 · Same result after automatic refresh",output.layerId,r,{A:"Screen recombination → Pixels",B:"Midtones stretch → Pixels",M:"Screen recombination → Mask (inverted)"},"Captured after the live controller detected the source edit and updated the same layer. The stretch now affects the left side.");
    const target=await core.executeAsModal(()=>doc.createLayer({name:"Generated mask target"}),{commandName:"Create generated-mask target"});
    const generatedBindings=[{name:"A",layerId:d.resultId,kind:"pixels"}],generatedRecipe=recipe("Write a brightness mask",generatedBindings,"clamp((0.2126*A[0] + 0.7152*A[1] + 0.0722*A[2] - 0.05) / 0.3, 0, 1)","layer-mask","Select Write layer mask and choose a target. Weighted RGB sample brightness is not a linear-light luminance conversion in this sRGB fixture.");
    await render(generatedRecipe,generatedBindings,{maskTargetId:target.id});
    const view=await render(maskRecipe,[{name:"M",layerId:target.id,kind:"mask"}]);
    await capture("generated-layer-mask","Write a formula into a layer mask",view.layerId,generatedRecipe,{A:"Screen recombination → Pixels"},"An actual attached mask created by the formula, read back and displayed as grayscale. Mask output is one-shot; live output currently uses a pixel layer.");
    await core.executeAsModal(async()=>{
      const result=Array.from(doc.layers).find(l=>l.id===output.layerId);
      await result.move(doc.layers[0],require("photoshop").constants.ElementPlacement.PLACEBEFORE);
      doc.activeLayers=[result];
    },{commandName:"Show live demo result"});
    await live.changed();
    $("liveResults").value=String(output.layerId);await $("editLive").onclick();
    return {photoshopVersion:app.version,source:"Synthetic 960 × 640, 16-bit RGB fixture",documentId:doc.id,liveResultId:output.layerId,verifiedAutomaticRefresh:refreshed,examples};
  }finally{if(controller)controller.stop();live.start();}
})()
