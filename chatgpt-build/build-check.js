const fs=require('fs'),path=require('path');
const mustExist=['dist/index.html','dist/iwill-enhancements.js','server.js','dist/logo-black.png'];
const missing=mustExist.filter(f=>!fs.existsSync(path.join(__dirname,f)));
const assetsDir=path.join(__dirname,'dist','assets');
const assets=fs.existsSync(assetsDir)?fs.readdirSync(assetsDir):[];
if(!assets.some(f=>/^index-.*\.js$/.test(f))) missing.push('dist/assets/index-*.js');
if(!assets.some(f=>/^IWillFormPage-.*\.js$/.test(f))) missing.push('dist/assets/IWillFormPage-*.js');
if(missing.length){console.error('Missing required files:',missing.join(', '));process.exit(1)}
console.log('Build check passed.');
