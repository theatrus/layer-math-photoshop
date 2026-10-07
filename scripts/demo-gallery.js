// Run demo-photoshop.js first in the same loaded development plugin context.
// Every thumbnail is exported from a result produced by the native addon.
// Returns JPEG data plus recipe metadata for scripts/save-demo-gallery.py.
(async()=>{
  const {app,core,imaging}=require("photoshop"), H=require("./host.js");
  const d=globalThis.layerMathDemo;
  if(!d)throw new Error("Run demo-photoshop.js in this plugin context first.");
  const recipes=require("./presets.json").recipes;
  const examples=[];
  async function capture(id,title,layerId,recipe,bindings={}) {
    const jpeg=await core.executeAsModal(async()=>{
      const got=await imaging.getPixels({documentID:d.documentId,layerID:layerId,componentSize:8,applyAlpha:true,colorSpace:"RGB",colorProfile:"sRGB IEC61966-2.1"});
      try{return await imaging.encodeImageData({imageData:got.imageData,base64:true});}finally{got.imageData.dispose();}
    },{commandName:"Export Layer Math gallery image"});
    examples.push({id,title,recipe,bindings,jpeg});
  }
  const layers={A:d.resultId,B:d.starsId,Starless:d.starlessId,Stars:d.starsId,Combined:d.resultId};
  await capture("screen","Screen recombination",d.resultId,recipes.find(r=>r.name==="Screen stars"),{Starless:"Starless",Stars:"Stars"});
  await capture("midtones","Midtones stretch",d.stretchId,recipes.find(r=>r.name==="Midtones stretch"),{A:"Screen recombination"});
  const tasks=[
    ["half-stars","Screen stars with strength"],
    ["extracted-stars","Extract screen stars"],
    ["log-stretch","Logarithmic stretch"],
    ["gamma","Gamma"],
    ["grayscale","RGB average grayscale"],
    ["channel-gains","Channel gains"],
    ["swap-channels","Swap red and blue"],
    ["soft-mask","Soft threshold mask"],
    ["range-mask","Range mask"],
    ["invert","Invert"]
  ];
  for(const [id,name] of tasks) {
    const original=recipes.find(r=>r.name===name);
    // Explicit display-output choice for channel gains; document it with the image.
    const recipe={...original,output:{...original.output,outOfRange16:id==="channel-gains" ? "clip" : "ask"}};
    const result=await H.run({documentId:d.documentId,bindings:recipe.inputs.map(name=>({name,layerId:layers[name]})),parameters:recipe.parameters,expressions:recipe.expressions,destination:"new-layer",rangePolicy:recipe.output.outOfRange16,name});
    if(id==="soft-mask")layers.Mask=result.layerId;
    await capture(id,name,result.layerId,recipe,Object.fromEntries(recipe.inputs.map(name=>[name,name==="A"?"Screen recombination":name==="Combined"?"Screen recombination":name])));
  }
  const recipe=recipes.find(r=>r.name==="Masked blend");
  const bindings={A:d.resultId,B:d.stretchId,Mask:layers.Mask};
  const result=await H.run({documentId:d.documentId,bindings:Object.entries(bindings).map(([name,layerId])=>({name,layerId})),parameters:recipe.parameters,expressions:recipe.expressions,destination:"new-layer",rangePolicy:"ask",name:"Masked midtones blend"});
  await capture("masked-blend","Masked midtones blend",result.layerId,recipe,{A:"Screen recombination",B:"Midtones stretch",Mask:"Soft threshold mask"});
  // Leave the readable blend result on top, with all source and result pixels intact.
  return {photoshopVersion:app.version,documentId:d.documentId,source:"Deterministic synthetic 960 × 640, 16-bit RGB nebula and stars; sRGB IEC61966-2.1",examples};
})()
