import sharp from "sharp";

function stripDataUrl(value) {
  const parts = String(value || "").split(",");
  return parts.length > 1 ? parts[1] : "";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseHex(value, fallback) {
  const match = String(value || "").trim().match(/^#?([0-9a-f]{6})$/i);
  if (!match) return fallback;
  const n = parseInt(match[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

async function dominantColor(dataUrl, fallback) {
  const base64 = stripDataUrl(dataUrl);
  if (!base64) return fallback;
  try {
    const stats = await sharp(Buffer.from(base64, "base64")).resize(64, 64, { fit: "cover" }).stats();
    return {
      r: Math.round(stats.channels[0].mean),
      g: Math.round(stats.channels[1].mean),
      b: Math.round(stats.channels[2].mean)
    };
  } catch (_error) {
    return fallback;
  }
}

async function prepareAsset(dataUrl) {
  const base64 = stripDataUrl(dataUrl);
  if (!base64) throw new Error("Missing catalog face asset.");
  const trimmed = await sharp(Buffer.from(base64, "base64"))
    .rotate()
    .trim({ threshold: 18 })
    .ensureAlpha()
    .resize(640, 640, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: trimmed.data, width: trimmed.info.width, height: trimmed.info.height };
}

function quadHomography(points) {
  const [p0, p1, p2, p3] = points;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  const denominator = dx1 * dy2 - dx2 * dy1;
  let g = 0;
  let h = 0;
  if (Math.abs(denominator) > 1e-8) {
    g = (dx3 * dy2 - dx2 * dy3) / denominator;
    h = (dx1 * dy3 - dx3 * dy1) / denominator;
  }
  return [
    p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x,
    p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y,
    g, h, 1
  ];
}

function invert3(m) {
  const a=m[0],b=m[1],c=m[2],d=m[3],e=m[4],f=m[5],g=m[6],h=m[7],i=m[8];
  const A=e*i-f*h, B=-(d*i-f*g), C=d*h-e*g;
  const D=-(b*i-c*h), E=a*i-c*g, F=-(a*h-b*g);
  const G=b*f-c*e, H=-(a*f-c*d), I=a*e-b*d;
  const det=a*A+b*B+c*C;
  if (Math.abs(det) < 1e-8) return null;
  return [A/det,D/det,G/det,B/det,E/det,H/det,C/det,F/det,I/det];
}

function sample(asset, u, v) {
  const x = clamp(Math.round(u * (asset.width - 1)), 0, asset.width - 1);
  const y = clamp(Math.round(v * (asset.height - 1)), 0, asset.height - 1);
  const index = (y * asset.width + x) * 4;
  return [asset.data[index], asset.data[index + 1], asset.data[index + 2], asset.data[index + 3]];
}

function pointInQuad(x, y, points) {
  let sign = 0;
  for (let n=0;n<4;n++) {
    const a=points[n], b=points[(n+1)%4];
    const cross=(b.x-a.x)*(y-a.y)-(b.y-a.y)*(x-a.x);
    if (Math.abs(cross)<0.001) continue;
    const current=cross>0?1:-1;
    if (!sign) sign=current;
    else if (sign!==current) return false;
  }
  return true;
}

function applyFace(output, width, height, face, asset, finish) {
  const points = face.polygon.map(([x,y]) => ({ x: x * width / 1000, y: y * height / 1000 }));
  const inverse = invert3(quadHomography(points));
  if (!inverse) return;
  const minX=clamp(Math.floor(Math.min(...points.map(p=>p.x))),0,width-1);
  const maxX=clamp(Math.ceil(Math.max(...points.map(p=>p.x))),0,width-1);
  const minY=clamp(Math.floor(Math.min(...points.map(p=>p.y))),0,height-1);
  const maxY=clamp(Math.ceil(Math.max(...points.map(p=>p.y))),0,height-1);
  for(let y=minY;y<=maxY;y++) {
    for(let x=minX;x<=maxX;x++) {
      if(!pointInQuad(x+0.5,y+0.5,points)) continue;
      const denominator=inverse[6]*(x+0.5)+inverse[7]*(y+0.5)+inverse[8];
      if(Math.abs(denominator)<1e-8) continue;
      const u=(inverse[0]*(x+0.5)+inverse[1]*(y+0.5)+inverse[2])/denominator;
      const v=(inverse[3]*(x+0.5)+inverse[4]*(y+0.5)+inverse[5])/denominator;
      if(u<0||u>1||v<0||v>1) continue;
      const [sr,sg,sb,sa]=sample(asset,u,v);
      const sourceLuma=(0.2126*sr+0.7152*sg+0.0722*sb)/255;
      const relief=clamp((sourceLuma-0.5)*1.35+0.82,0.35,1.28);
      const index=(y*width+x)*4;
      const originalLuma=(0.2126*output[index]+0.7152*output[index+1]+0.0722*output[index+2])/255;
      const light=clamp(0.72+originalLuma*0.45,0.72,1.15);
      const tr=clamp(Math.round(finish.r*relief*light),0,255);
      const tg=clamp(Math.round(finish.g*relief*light),0,255);
      const tb=clamp(Math.round(finish.b*relief*light),0,255);
      const edge=Math.min(u,v,1-u,1-v);
      const feather=clamp(edge*70,0,1);
      const alpha=(sa/255)*(0.9*feather);
      output[index]=Math.round(output[index]*(1-alpha)+tr*alpha);
      output[index+1]=Math.round(output[index+1]*(1-alpha)+tg*alpha);
      output[index+2]=Math.round(output[index+2]*(1-alpha)+tb*alpha);
      output[index+3]=255;
    }
  }
}

export async function renderHybridCabinetFaces({ image, faces, doorReference, drawerReference, upperHex, baseHex, upperSwatch, baseSwatch }) {
  const input=Buffer.from(stripDataUrl(image),"base64");
  if(!input.length) throw new Error("Invalid kitchen image.");
  const raw=await sharp(input).rotate().ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const width=raw.info.width;
  const height=raw.info.height;
  const output=Buffer.from(raw.data);
  const doorAsset=await prepareAsset(doorReference);
  const drawerAsset=await prepareAsset(drawerReference || doorReference);
  const upperFallback=parseHex(upperHex,{r:112,g:124,b:103});
  const baseFallback=parseHex(baseHex,{r:124,g:82,b:48});
  const upperFinish=await dominantColor(upperSwatch,upperFallback);
  const baseFinish=await dominantColor(baseSwatch,baseFallback);
  const usableFaces=(Array.isArray(faces)?faces:[]).filter(face=>Array.isArray(face?.polygon)&&face.polygon.length===4);
  if(!usableFaces.length) throw new Error("No individual cabinet faces were detected. Upload the kitchen again.");
  for(const face of usableFaces) {
    applyFace(output,width,height,face,face.type==="drawer"?drawerAsset:doorAsset,face.group==="upper"?upperFinish:baseFinish);
  }
  const png=await sharp(output,{raw:{width,height,channels:4}}).png().toBuffer();
  return { image:`data:image/png;base64,${png.toString("base64")}`, faceCount:usableFaces.length };
}
