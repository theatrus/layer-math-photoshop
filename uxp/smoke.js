"use strict";
// Synthetic documents only. Run suite() through UDT's console after loading.
const {app,core,imaging,constants,action}=require("photoshop");
const H=require("./host.js"),P=require("./pixels.js");
async function test(depth, count=3, width=17, height=9) {
  let doc;
  try {
    const fixture=await core.executeAsModal(async()=>{
      doc=await app.createDocument({name:`Layer Math smoke ${depth}`,width,height,mode:count===3?constants.NewDocumentMode.RGB:constants.NewDocumentMode.GRAYSCALE,depth,profile:count===3?"sRGB IEC61966-2.1":"Gray Gamma 2.2"});
      const layers=[];
      for(const [name,value] of [["A",depth===32?2:0.2],["B",0.25]]) {
        const layer=await doc.createLayer({name});
        const data=depth===16?new Uint16Array(width*height*count).fill(Math.round(value*32768)):new Float32Array(width*height*count).fill(value);
        const img=await imaging.createImageDataFromBuffer(data,{width,height,components:count,colorSpace:count===3?"RGB":"Grayscale",colorProfile:P.profileName(doc.colorProfileName),fullRange:false});
        try{await imaging.putPixels({documentID:doc.id,layerID:layer.id,imageData:img});}finally{img.dispose();}
        layers.push(layer);
      }
      layers[0].visible=false;
      return layers;
    },{commandName:"Create Layer Math test fixture"});
    const before=doc.layers.length;
    const options={documentId:doc.id,bindings:fixture.map((l,i)=>({name:i?"B":"A",layerId:l.id})),parameters:{},expressions:{shared:"combine(A,B,op_screen())"},destination:"new-layer",rangePolicy:"ask"};
    const result=await H.run(options);
    const check=await core.executeAsModal(async()=>{
      const values=await H.read(doc,{name:"result",layerId:result.layerId},{left:0,top:0,right:width,bottom:height},depth,count);
      const a=depth===16?Math.round(0.2*32768)/32768:2;
      const expected=depth===16?Math.round((1-(1-a)*0.75)*32768)/32768:1.75;
      let maxError=0; for(const v of values)maxError=Math.max(maxError,Math.abs(v-expected));
      await action.batchPlay([{_obj:"select",_target:[{_ref:"historyState",_enum:"ordinal",_value:"previous"}]}],{});
      return {maxError,undo:doc.layers.length===before,hidden:fixture[0].visible===false};
    },{commandName:"Verify Layer Math result"});
    if(check.maxError>1e-7||!check.undo||!check.hidden)throw new Error(JSON.stringify(check));
    const layerCount=doc.layers.length;
    try{await H.run({...options,expressions:{shared:"1/0"}});throw new Error("Numeric failure was accepted");}catch(e){if(!String(e.message || e).includes("Division by zero"))throw e;}
    if(doc.layers.length!==layerCount)throw new Error("Failure left an output layer");
    let calls=0;
    const tileCount=Array.from(P.tiles(width,height)).length;
    try { await H.run({...options,cancelled:()=>++calls>=tileCount+3}); throw new Error("Cancellation was ignored"); }
    catch(e) { if(!String(e.message||e).includes("Cancelled"))throw e; }
    if(doc.layers.length!==layerCount)throw new Error("Cancelled write left an output layer");
    const newResult=await H.run({...options,destination:"new-document",expressions:{shared:"A-B-1"}});
    const newDoc=Array.from(app.documents).find(d=>d.id===newResult.documentId);
    try {
      await core.executeAsModal(async()=>{
        const values=await H.read(newDoc,{name:"new result",layerId:newResult.layerId},{left:0,top:0,right:width,bottom:height},32,count);
        const expected=(depth===16?Math.round(0.2*32768)/32768:2)-1.25;
        if(values.some(v=>Math.abs(v-expected)>1e-7))throw new Error("New document changed stored values");
        if(H.bits(doc)!==depth)throw new Error("Source depth changed");
      },{commandName:"Verify new 32-bit document"});
    } finally {await core.executeAsModal(()=>newDoc.closeWithoutSaving(),{commandName:"Close result fixture"});}
    if(depth===16) {
      try{await H.run({...options,expressions:{shared:"A+2"}});throw new Error("Range choice was bypassed");}
      catch(e){if(!String(e.message||e).includes("Choose"))throw e;}
      if(doc.layers.length!==layerCount)throw new Error("Range prompt left an output layer");
      if(count===3)for(const [policy,expected] of [["rescale",[0,0.25,1]],["clip",[0,0,1]]]) {
        const result=await H.run({...options,expressions:{r:"-1",g:"0",b:"3"},rangePolicy:policy});
        await core.executeAsModal(async()=>{
          const values=await H.read(doc,{name:policy,layerId:result.layerId},{left:0,top:0,right:width,bottom:height},depth,count);
          if(values.some((v,i)=>v!==expected[i%3]))throw new Error(`Incorrect global ${policy}`);
          await action.batchPlay([{_obj:"select",_target:[{_ref:"historyState",_enum:"ordinal",_value:"previous"}]}],{});
        },{commandName:"Verify range policy"});
      }
    }
    await core.executeAsModal(async()=>{
      for(let i=0;i<fixture.length;i++) {
        const values=await H.read(doc,{name:"source",layerId:fixture[i].id},{left:0,top:0,right:width,bottom:height},depth,count);
        const expected=i?0.25:depth===16?Math.round(0.2*32768)/32768:2;
        if(values.some(v=>v!==expected))throw new Error("Source pixels changed");
      }
      fixture[1].opacity=75;
    },{commandName:"Verify sources and prepare rejected input"});
    try{await H.run(options);throw new Error("Non-opaque layer accepted");}
    catch(e){if(!String(e.message||e).includes("100%"))throw e;}
    if(doc.layers.length!==layerCount)throw new Error("Rejected input created a layer");
    return {depth,channels:count,width,height,...check,cancelRollback:true,new32:true,pass:true};
  } finally { if(doc)await core.executeAsModal(()=>doc.closeWithoutSaving(),{commandName:"Close Layer Math test fixture"}); }
}
async function suite(){return [await test(16),await test(32),await test(16,1),await test(32,1),await test(32,3,259,133)];}
async function operations() {
  // Exercise the shipped presets through the actual host/native/output path.
  const expected={Add:0.75,Subtract:-0.25,Multiply:0.125,Divide:0.5,
    Difference:0.25,Minimum:0.25,Maximum:0.5,Average:0.375,Overlay:0.25,
    "Soft light":0.25,Invert:0.75,"Gain and offset":0.3,
    "Subtract background":0.23,"Midtones stretch":0.5,Gamma:0.5,"Threshold mask":1};
  let doc;
  const results=[];
  try {
    const layers=await core.executeAsModal(async()=>{
      doc=await app.createDocument({name:"Layer Math operation tests",width:4,height:3,mode:constants.NewDocumentMode.RGB,depth:16,profile:"sRGB IEC61966-2.1"});
      const layers=[];
      for(const [name,value] of [["A",8192],["B",16384]]) {
        const layer=await doc.createLayer({name});
        const data=await imaging.createImageDataFromBuffer(new Uint16Array(36).fill(value),{width:4,height:3,components:3,colorSpace:"RGB",colorProfile:"sRGB IEC61966-2.1",fullRange:false});
        try{await imaging.putPixels({documentID:doc.id,layerID:layer.id,imageData:data});}finally{data.dispose();}
        layers.push(layer);
      }
      return layers;
    },{commandName:"Create arithmetic fixtures"});
    for(const [name,value] of Object.entries(expected)) {
      const recipe=require("./presets.json").recipes.find(r=>r.name===name);
      if(!recipe)throw new Error(`Missing preset: ${name}`);
      const result=await H.run({documentId:doc.id,bindings:recipe.inputs.map(name=>({name,layerId:layers.find(l=>l.name===name).id})),parameters:recipe.parameters,expressions:recipe.expressions,destination:"new-document",rangePolicy:"ask",name});
      const output=Array.from(app.documents).find(d=>d.id===result.documentId);
      try {
        await core.executeAsModal(async()=>{
          const values=await H.read(output,{name,layerId:result.layerId},{left:0,top:0,right:4,bottom:3},32,3);
          const maxError=Math.max(...Array.from(values,v=>Math.abs(v-value)));
          if(maxError>1e-7)throw new Error(`${name}: expected ${value}, error ${maxError}`);
          results.push({name,maxError,pass:true});
        },{commandName:"Verify operation pixels"});
      } finally {await core.executeAsModal(()=>output.closeWithoutSaving(),{commandName:"Close arithmetic result"});}
    }
    return results;
  } finally {if(doc)await core.executeAsModal(()=>doc.closeWithoutSaving(),{commandName:"Close arithmetic fixtures"});}
}
async function cookbook() {
  const expected={
    "Screen stars with strength":[0.4375,0.5625,0.765625],
    "Extract screen stars":[0.5,0.25,0.125],
    "Logarithmic stretch":[Math.log(6)/Math.log(21),Math.log(11)/Math.log(21),Math.log(16)/Math.log(21)],
    "Black and white points":[0.23/0.78,0.48/0.78,0.73/0.78],
    "Soft threshold mask":[0.5,1,1],"Range mask":[1,1,0],
    "Masked blend":[0.3125,0.375,0.28125],"RGB average grayscale":[0.5,0.5,0.5],
    "Saturation around RGB average":[0.125,0.5,0.875],"Channel gains":[0.3,0.5,0.6],
    "Swap red and blue":[0.75,0.5,0.25],"Detail boost from blurred layer":[0.3125,0.5,0.875]
  };
  const samples={A:[0.25,0.5,0.75],B:[0.5,0.25,0.125],Mask:[0.25,0.5,0.75],Blur:[0.125,0.5,0.5],Combined:[0.625,0.625,0.78125],Starless:[0.25,0.5,0.75],Stars:[0.5,0.25,0.125]};
  let doc;const layers={},results=[];
  try {
    await core.executeAsModal(async()=>{
      doc=await app.createDocument({name:"Layer Math cookbook tests",width:4,height:3,mode:constants.NewDocumentMode.RGB,depth:16,profile:"sRGB IEC61966-2.1"});
      for(const [name,rgb] of Object.entries(samples)) {
        const layer=await doc.createLayer({name});layers[name]=layer.id;
        const data=await imaging.createImageDataFromBuffer(Uint16Array.from({length:36},(_,i)=>rgb[i%3]*32768),{width:4,height:3,components:3,colorSpace:"RGB",colorProfile:"sRGB IEC61966-2.1",fullRange:false});
        try{await imaging.putPixels({documentID:doc.id,layerID:layer.id,imageData:data});}finally{data.dispose();}
      }
    },{commandName:"Create cookbook fixtures"});
    for(const [name,rgb] of Object.entries(expected)) {
      const recipe=require("./presets.json").recipes.find(r=>r.name===name);
      if(!recipe)throw new Error(`Missing preset: ${name}`);
      const result=await H.run({documentId:doc.id,bindings:recipe.inputs.map(name=>({name,layerId:layers[name]})),parameters:recipe.parameters,expressions:recipe.expressions,destination:"new-document",rangePolicy:"ask",name});
      const output=Array.from(app.documents).find(d=>d.id===result.documentId);
      try {
        await core.executeAsModal(async()=>{
          const values=await H.read(output,{name,layerId:result.layerId},{left:0,top:0,right:4,bottom:3},32,3);
          const maxError=Math.max(...Array.from(values,(v,i)=>Math.abs(v-rgb[i%3])));
          if(maxError>1e-7)throw new Error(`${name}: error ${maxError}`);
          results.push({name,maxError,pass:true});
        },{commandName:"Verify cookbook pixels"});
      } finally {await core.executeAsModal(()=>output.closeWithoutSaving(),{commandName:"Close cookbook result"});}
    }
    return results;
  } finally {if(doc)await core.executeAsModal(()=>doc.closeWithoutSaving(),{commandName:"Close cookbook fixtures"});}
}
module.exports={test,suite,operations,cookbook};
