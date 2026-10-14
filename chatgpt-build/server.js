const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = path.join(__dirname, 'dist');
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY = 1024 * 1024;

const MIME = {
  '.html':'text/html; charset=utf-8',
  '.js':'application/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.png':'image/png',
  '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg',
  '.svg':'image/svg+xml',
  '.ico':'image/x-icon',
  '.woff2':'font/woff2',
  '.pdf':'application/pdf'
};

function headers(res) {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','SAMEORIGIN');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy','same-origin');
}

function sendJson(res,status,payload) {
  headers(res);
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve,reject)=>{
    let size=0;
    const chunks=[];
    req.on('data',chunk=>{
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('Request too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end',()=>{
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error',reject);
  });
}

function text(value) {
  return String(value ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pdfEscape(value) {
  return text(value).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
}

function decodePngRgb(buffer) {
  if (buffer.subarray(0,8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid PNG');
  let offset=8,width=0,height=0,bitDepth=0,colorType=0,interlace=0;
  const idat=[];
  while (offset < buffer.length) {
    const len=buffer.readUInt32BE(offset);
    const type=buffer.subarray(offset+4,offset+8).toString('ascii');
    const data=buffer.subarray(offset+8,offset+8+len);
    offset += 12 + len;
    if (type==='IHDR') {
      width=data.readUInt32BE(0);
      height=data.readUInt32BE(4);
      bitDepth=data[8];
      colorType=data[9];
      interlace=data[12];
    } else if (type==='IDAT') idat.push(data);
    else if (type==='IEND') break;
  }
  if (bitDepth!==8 || interlace!==0 || ![2,6].includes(colorType)) throw new Error('Unsupported logo PNG');
  const bpp=colorType===6 ? 4 : 3;
  const stride=width*bpp;
  const raw=zlib.inflateSync(Buffer.concat(idat));
  const rows=Buffer.alloc(height*stride);
  let pos=0;
  let previous=Buffer.alloc(stride);
  const paeth=(a,b,c)=>{
    const p=a+b-c, pa=Math.abs(p-a), pb=Math.abs(p-b), pc=Math.abs(p-c);
    return pa<=pb && pa<=pc ? a : pb<=pc ? b : c;
  };
  for (let y=0;y<height;y++) {
    const filter=raw[pos++];
    const row=Buffer.alloc(stride);
    for (let x=0;x<stride;x++) {
      const value=raw[pos++];
      const a=x>=bpp ? row[x-bpp] : 0;
      const b=previous[x] || 0;
      const c=x>=bpp ? previous[x-bpp] || 0 : 0;
      if (filter===0) row[x]=value;
      else if (filter===1) row[x]=(value+a)&255;
      else if (filter===2) row[x]=(value+b)&255;
      else if (filter===3) row[x]=(value+Math.floor((a+b)/2))&255;
      else if (filter===4) row[x]=(value+paeth(a,b,c))&255;
      else throw new Error('Unsupported PNG filter');
    }
    row.copy(rows,y*stride);
    previous=row;
  }
  const rgb=Buffer.alloc(width*height*3);
  let j=0;
  for (let i=0;i<rows.length;i+=bpp) {
    const alpha=colorType===6 ? rows[i+3]/255 : 1;
    rgb[j++]=Math.round(rows[i]*alpha + 255*(1-alpha));
    rgb[j++]=Math.round(rows[i+1]*alpha + 255*(1-alpha));
    rgb[j++]=Math.round(rows[i+2]*alpha + 255*(1-alpha));
  }
  return {width,height,data:zlib.deflateSync(rgb)};
}

function willLines(data,reference) {
  const lines=[];
  const heading=(v)=>lines.push({value:v,bold:true,size:13,gap:7});
  const line=(label,value)=>{
    if (value===undefined || value===null || String(value).trim()==='') return;
    lines.push({value:label+': '+text(value),size:9});
  };
  lines.push({value:'Will Instruction Form',bold:true,size:20,gap:10});
  line('Reference',reference);
  line('Submitted',data.submittedAt || new Date().toISOString());

  heading('Your details');
  Object.entries(data.testator || {}).forEach(([k,v])=>line(k.replace(/([A-Z])/g,' $1').replace(/^./,m=>m.toUpperCase()),v));

  heading('Family');
  line('Partner',data.family?.partnerName);
  line('Other dependants',data.family?.otherDependants);
  (data.family?.children || []).forEach((c,i)=>{
    lines.push({value:'Child '+(i+1),bold:true,size:10});
    line('Name',c.fullName); line('Date of birth',c.dob); line('Relationship',c.relationship); line('Under 18',c.under18?'Yes':'No');
  });

  heading('Executors');
  (data.executors || []).forEach((p,i)=>{
    lines.push({value:'Executor '+(i+1),bold:true,size:10});
    Object.entries(p).forEach(([k,v])=>line(k.replace(/([A-Z])/g,' $1'),v));
  });

  heading('Guardians');
  (data.guardians || []).forEach((p,i)=>{
    lines.push({value:'Guardian '+(i+1),bold:true,size:10});
    Object.entries(p).forEach(([k,v])=>line(k.replace(/([A-Z])/g,' $1'),v));
  });

  heading('Specific gifts');
  (data.specificGifts || []).forEach((g,i)=>{
    lines.push({value:'Gift '+(i+1),bold:true,size:10});
    Object.entries(g).forEach(([k,v])=>line(k.replace(/([A-Z])/g,' $1'),v));
  });

  heading('Residuary beneficiaries');
  (data.residue || []).forEach((b,i)=>{
    lines.push({value:'Beneficiary '+(i+1),bold:true,size:10});
    Object.entries(b).forEach(([k,v])=>line(k.replace(/([A-Z])/g,' $1'),v));
  });

  heading('Estate');
  Object.entries(data.estate || {}).forEach(([k,v])=>line(k.replace(/([A-Z])/g,' $1').replace(/^./,m=>m.toUpperCase()),v));

  heading('Other wishes');
  Object.entries(data.wishes || {}).filter(([k])=>k!=='letterOfWishes').forEach(([k,v])=>line(k.replace(/([A-Z])/g,' $1').replace(/^./,m=>m.toUpperCase()),v));

  heading('Declaration');
  line('Confirmed by',data.declaration?.typedName || data.testator?.fullName);
  return lines;
}

function buildPdf(data,reference) {
  let logo=null;
  try { logo=decodePngRgb(fs.readFileSync(path.join(ROOT,'logo-black.png'))); } catch {}
  const source=willLines(data,reference);
  const pages=[];
  let page=[];
  let y=720;
  for (const item of source) {
    const height=(item.size||9)+5+(item.gap||0);
    if (y-height<55) { pages.push(page); page=[]; y=720; }
    page.push({...item,y});
    y -= height;
  }
  if (page.length || !pages.length) pages.push(page);

  const objects={};
  objects[1]=Buffer.from('<< /Type /Catalog /Pages 2 0 R >>');
  objects[3]=Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects[4]=Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  if (logo) {
    objects[5]=Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${logo.data.length} >>\nstream\n`),
      logo.data,
      Buffer.from('\nendstream')
    ]);
  } else {
    objects[5]=Buffer.from('<< /Length 0 >>\nstream\n\nendstream');
  }

  const kids=[];
  pages.forEach((items,index)=>{
    const pageObj=6+index*2;
    const contentObj=7+index*2;
    kids.push(pageObj+' 0 R');
    let content='';
    if (logo) {
      const width=160;
      const height=width*logo.height/logo.width;
      content += `q ${width} 0 0 ${height.toFixed(2)} 48 775 cm /Im1 Do Q\n`;
    } else {
      content += 'BT /F2 20 Tf 48 790 Td (iTrustLaw) Tj ET\n';
    }
    for (const item of items) {
      const font=item.bold ? 'F2' : 'F1';
      const size=item.size || 9;
      let value=pdfEscape(item.value);
      const max=size>=18 ? 48 : size>=12 ? 72 : 96;
      const chunks=[];
      while (value.length>max) {
        let cut=value.lastIndexOf(' ',max);
        if (cut<20) cut=max;
        chunks.push(value.slice(0,cut));
        value=value.slice(cut).trim();
      }
      chunks.push(value);
      chunks.forEach((chunk,row)=>{
        content += `BT /${font} ${size} Tf 48 ${item.y-row*(size+3)} Td (${chunk}) Tj ET\n`;
      });
    }
    const bytes=Buffer.from(content,'ascii');
    objects[contentObj]=Buffer.concat([Buffer.from(`<< /Length ${bytes.length} >>\nstream\n`),bytes,Buffer.from('endstream')]);
    objects[pageObj]=Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Im1 5 0 R >> >> /Contents ${contentObj} 0 R >>`);
  });
  objects[2]=Buffer.from(`<< /Type /Pages /Count ${pages.length} /Kids [${kids.join(' ')}] >>`);

  const maxObject=5+pages.length*2;
  const parts=[Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n','binary')];
  const offsets=[0];
  let position=parts[0].length;
  for (let i=1;i<=maxObject;i++) {
    const body=objects[i] || Buffer.from('<<>>');
    offsets[i]=position;
    const open=Buffer.from(i+' 0 obj\n');
    const close=Buffer.from('\nendobj\n');
    parts.push(open,body,close);
    position += open.length+body.length+close.length;
  }
  const xrefAt=position;
  let xref=`xref\n0 ${maxObject+1}\n0000000000 65535 f \n`;
  for (let i=1;i<=maxObject;i++) xref += String(offsets[i]).padStart(10,'0')+' 00000 n \n';
  xref += `trailer\n<< /Size ${maxObject+1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  parts.push(Buffer.from(xref));
  return Buffer.concat(parts);
}

async function zohoAccessToken() {
  const clientId=process.env.ZOHO_CLIENT_ID;
  const clientSecret=process.env.ZOHO_CLIENT_SECRET;
  const refreshToken=process.env.ZOHO_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) throw new Error('Zoho environment variables are not configured');
  const params=new URLSearchParams({
    refresh_token:refreshToken,
    client_id:clientId,
    client_secret:clientSecret,
    grant_type:'refresh_token'
  });
  const response=await fetch('https://accounts.zoho.eu/oauth/v2/token?'+params,{method:'POST'});
  const result=await response.json();
  if (!response.ok || !result.access_token) throw new Error('Zoho token refresh failed');
  return result.access_token;
}

async function upsertZohoLead(body) {
  if (!body?.email) return {skipped:true};
  const token=await zohoAccessToken();
  const description=[
    'iTrustLaw online assessment',
    'Funnel: '+text(body.funnel || 'Website Assessment'),
    'Answers: '+text(JSON.stringify(body.answers || {})),
    'Attribution: '+text(JSON.stringify(body.attribution || {})),
    body.gclid ? 'GCLID: '+text(body.gclid) : ''
  ].filter(Boolean).join('\n').slice(0,30000);
  const lead={
    First_Name:text(body.firstName),
    Last_Name:text(body.lastName) || text(body.firstName) || 'Website Lead',
    Email:text(body.email),
    Phone:text(body.phone),
    Description:description
  };
  const response=await fetch('https://www.zohoapis.eu/crm/v8/Leads/upsert',{
    method:'POST',
    headers:{Authorization:'Zoho-oauthtoken '+token,'Content-Type':'application/json'},
    body:JSON.stringify({data:[lead],duplicate_check_fields:['Email']})
  });
  const result=await response.json().catch(()=>({}));
  if (!response.ok) throw new Error('Zoho CRM request failed');
  return result;
}

async function sendWill(body) {
  const apiKey=process.env.RESEND_API_KEY;
  const from=process.env.WILL_EMAIL_FROM;
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured');
  if (!from) throw new Error('WILL_EMAIL_FROM is not configured');

  const name=text(body.testator?.fullName) || 'Client';
  const reference='WL-'+new Date().toISOString().slice(0,10).replace(/-/g,'')+'-'+crypto.randomBytes(3).toString('hex').toUpperCase();
  const pdf=buildPdf(body,reference);
  const to=process.env.WILL_EMAIL_TO || 'info@itrust121.com';
  const bcc=process.env.WILL_EMAIL_BCC || 'ethan@itrust121.com';

  const payload={
    from,
    to:[to],
    bcc:[bcc],
    subject:`New Will Instructions - ${name} - ${reference}`,
    html:`<p>New Will instructions have been submitted through iTrustLaw.</p><p><strong>Client:</strong> ${name.replace(/[<>&]/g,'')}</p><p><strong>Reference:</strong> ${reference}</p><p>The completed instruction form is attached.</p>`,
    attachments:[{filename:reference+'-Will-Instructions.pdf',content:pdf.toString('base64')}]
  };
  if (body.testator?.email) payload.reply_to=body.testator.email;

  const response=await fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},
    body:JSON.stringify(payload)
  });
  const result=await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(result.message || 'Resend could not send the email');
  return {reference,emailId:result.id};
}

function serve(req,res) {
  const url=new URL(req.url,'http://localhost');
  let pathname;
  try { pathname=decodeURIComponent(url.pathname); } catch { return sendJson(res,400,{error:'Bad request'}); }
  if (pathname.includes('\0')) return sendJson(res,400,{error:'Bad request'});

  const root=path.resolve(ROOT);
  let target=path.resolve(ROOT,pathname.replace(/^\/+/, ''));
  if (target!==root && !target.startsWith(root+path.sep)) return sendJson(res,403,{error:'Forbidden'});

  if (pathname==='/' || !path.extname(pathname) || !fs.existsSync(target)) target=path.join(ROOT,'index.html');

  fs.stat(target,(err,stat)=>{
    if (err || !stat.isFile()) return sendJson(res,404,{error:'Not found'});
    headers(res);
    const ext=path.extname(target).toLowerCase();
    res.writeHead(200,{
      'Content-Type':MIME[ext] || 'application/octet-stream',
      'Cache-Control':ext==='.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      'Content-Length':stat.size
    });
    if (req.method==='HEAD') return res.end();
    fs.createReadStream(target).pipe(res);
  });
}

const server=http.createServer(async(req,res)=>{
  try {
    if (req.url==='/api/create-lead') {
      if (req.method!=='POST') return sendJson(res,405,{error:'Method not allowed'});
      const body=await readJson(req);
      const result=await upsertZohoLead(body);
      return sendJson(res,200,{ok:true,result});
    }

    if (req.url==='/api/submit-will') {
      if (req.method!=='POST') return sendJson(res,405,{error:'Method not allowed'});
      const body=await readJson(req);
      if (!text(body.testator?.fullName) || !text(body.testator?.email)) return sendJson(res,400,{error:'Name and email are required'});
      const result=await sendWill(body);
      return sendJson(res,200,{ok:true,...result});
    }

    if (!['GET','HEAD'].includes(req.method)) return sendJson(res,405,{error:'Method not allowed'});
    return serve(req,res);
  } catch (error) {
    console.error(error);
    return sendJson(res,500,{error:error.message || 'Something went wrong'});
  }
});

server.requestTimeout=30000;
server.headersTimeout=15000;
server.keepAliveTimeout=5000;
server.listen(PORT,()=>console.log('iTrustLaw assessment running on port '+PORT));
