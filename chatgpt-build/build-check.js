const fs=require('fs'),path=require('path');
const required=['dist/index.html','dist/assets/index-8q-tm3Fq.js','dist/iwill-enhancements.js','server.js'];
const missing=required.filter(f=>!fs.existsSync(path.join(__dirname,f)));
if(missing.length){console.error('Missing required files:',missing.join(', '));process.exit(1)}
console.log('Build check passed.');
