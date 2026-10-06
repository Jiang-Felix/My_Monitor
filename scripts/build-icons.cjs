const { app, nativeImage } = require('electron');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
// ICO is a container for the original PNG artwork at standard Windows sizes.
app.whenReady().then(() => {
  for (const name of ['ICON','mini-c','mini-w']) {
    const directory=join(__dirname,'..','ui','assets');
    const original=nativeImage.createFromPath(join(directory,`${name}.png`));
    if(original.isEmpty())throw new Error(`Missing icon: ${name}`);
    const sizes=[16,24,32,48,64,128,256];
    const images=sizes.map(size=>original.resize({width:size,height:size,quality:'best'}).toPNG());
    const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);
    let offset=header.length;
    images.forEach((image,index)=>{
      const at=6+index*16,size=sizes[index];header[at]=header[at+1]=size===256?0:size;
      header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);header.writeUInt32LE(image.length,at+8);header.writeUInt32LE(offset,at+12);offset+=image.length;
    });
    writeFileSync(join(directory,`${name}.ico`),Buffer.concat([header,...images]));
  }
  console.log('Windows icons built from supplied PNG artwork');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
