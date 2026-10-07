// Evaluate in the loaded Layer Math plugin's UXP development console.
// Creates a synthetic 16-bit document; no existing document is changed.
(async () => {
  const {app, core, imaging, constants} = require("photoshop");
  const H = require("./host.js");
  const width=960, height=640;
  let seed=713;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const nebula=new Uint16Array(width*height*3), stars=new Uint16Array(width*height*3);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const u=(x-width*.5)/width, v=(y-height*.5)/height;
    const bend=v+.3*Math.sin(u*5)-.05*Math.sin(u*19);
    const cloud=Math.exp(-bend*bend*32-u*u*2.5);
    const filament=.58+.22*Math.sin(x*.035+y*.026)+.13*Math.sin(x*.079-y*.04)+.07*Math.sin(x*.17+y*.13);
    const dust=1-.78*Math.exp(-Math.pow(bend+.06*Math.sin(u*13),2)*600);
    const blue=Math.exp(-Math.pow(u-.21,2)*28-Math.pow(v+.17,2)*38);
    const glow=cloud*(.32+.55*filament)*dust;
    const rgb=[.025+.69*glow+.11*blue,.018+.23*glow+.33*blue,.05+.29*glow+.67*blue];
    for(let c=0;c<3;c++)nebula[(y*width+x)*3+c]=Math.round(Math.min(1,rgb[c])*32768);
  }
  for(let i=0;i<480;i++) {
    const x=random()*width,y=random()*height,sigma=.45+Math.pow(random(),5)*2;
    const amplitude=.25+.7*random(),warm=random(),radius=Math.ceil(sigma*5);
    for(let yy=Math.max(0,Math.floor(y)-radius);yy<Math.min(height,Math.ceil(y)+radius);yy++)
      for(let xx=Math.max(0,Math.floor(x)-radius);xx<Math.min(width,Math.ceil(x)+radius);xx++) {
        const d=(xx-x)**2+(yy-y)**2;
        const light=amplitude*(.86*Math.exp(-d/(2*sigma*sigma))+.14*Math.exp(-d/(8*sigma*sigma)));
        for(let c=0;c<3;c++) {const k=(yy*width+xx)*3+c;const tint=c===0?1:c===1?.86:.7+.3*warm;stars[k]=Math.min(32768,stars[k]+Math.round(light*tint*32768));}
      }
  }
  let doc, sources=[];
  await core.executeAsModal(async()=>{
    doc=await app.createDocument({name:"Layer Math — synthetic nebula demo",width,height,mode:constants.NewDocumentMode.RGB,depth:16,profile:"sRGB IEC61966-2.1"});
    for(const [name,data] of [["Starless",nebula],["Stars",stars]]) {
      const layer=await doc.createLayer({name});
      const image=await imaging.createImageDataFromBuffer(data,{width,height,components:3,colorSpace:"RGB",colorProfile:"sRGB IEC61966-2.1",fullRange:false});
      try{await imaging.putPixels({documentID:doc.id,layerID:layer.id,imageData:image});}finally{image.dispose();}
      sources.push(layer);
    }
    sources[1].visible=false;
  },{commandName:"Create synthetic Layer Math demo"});
  const result=await H.run({documentId:doc.id,bindings:sources.map(l=>({name:l.name,layerId:l.id})),parameters:{},expressions:{shared:"combine(Starless, Stars, op_screen())"},destination:"new-layer",rangePolicy:"ask",name:"Stars restored — Screen"});
  const stretch=await H.run({documentId:doc.id,bindings:[{name:"A",layerId:result.layerId}],parameters:{midtones:0.25},expressions:{shared:"mtf(midtones, A)"},destination:"new-layer",rangePolicy:"ask",name:"Midtones stretch"});
  globalThis.layerMathDemo={documentId:doc.id,starlessId:sources[0].id,starsId:sources[1].id,resultId:result.layerId,stretchId:stretch.layerId};
  return {...globalThis.layerMathDemo,range:result.range};
})()
