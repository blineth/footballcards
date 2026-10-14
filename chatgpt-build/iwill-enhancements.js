(() => {
  const KEY='iwill_people_registry_v4';
  const all=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const clean=v=>(v||'').replace(/\s+/g,' ').trim();
  const low=v=>clean(v).toLowerCase();
  const empty=()=>({family:[],executors:[],guardians:[],beneficiaries:[]});
  const load=()=>{try{return {...empty(),...JSON.parse(sessionStorage.getItem(KEY)||'{}')}}catch{return empty()}};
  const save=r=>{try{sessionStorage.setItem(KEY,JSON.stringify(r))}catch{}};
  const upsert=(list,p)=>{const name=clean(p.name);if(!name)return list;return [...list.filter(x=>low(x.name)!==low(name)),{name,relationship:clean(p.relationship),source:clean(p.source)}]};
  const merge=(...lists)=>{const seen=new Set(),out=[];for(const p of lists.flat()){const n=clean(p?.name),k=low(n);if(!n||seen.has(k))continue;seen.add(k);out.push({name:n,relationship:clean(p.relationship),source:clean(p.source)})}return out};
  function step(){const li=document.querySelector('.iwill-step-list li.is-current');if(!li)return'';const c=li.cloneNode(true);c.querySelectorAll('span').forEach(n=>n.remove());return clean(c.textContent)}
  function field(root,text){return all('label.iwill-field,label',root).find(l=>low(l.querySelector('.iwill-label')?.textContent||l.textContent).startsWith(low(text)))?.querySelector('input,textarea,select')||null}
  const title=card=>clean(card.querySelector('.iwill-repeat-head strong')?.textContent);
  function harvest(){
    const s=step();if(!s)return;const r=load();
    if(s==='Family'){const p=field(document,'Spouse / civil partner / partner full name');if(p?.value)r.family=upsert(r.family,{name:p.value,relationship:'Partner',source:'Family'});for(const c of all('.iwill-repeat-card'))if(/^Child\s+/i.test(title(c))){const n=field(c,'Full name');if(n?.value)r.family=upsert(r.family,{name:n.value,relationship:'Child',source:'Family'})}}
    if(s==='Executors')for(const c of all('.iwill-repeat-card')){const n=field(c,'Full name'),rel=field(c,'Relationship');if(n?.value)r.executors=upsert(r.executors,{name:n.value,relationship:rel?.value,source:'Executor'})}
    if(s==='Guardians')for(const c of all('.iwill-repeat-card')){const n=field(c,'Full name'),rel=field(c,'Relationship');if(n?.value)r.guardians=upsert(r.guardians,{name:n.value,relationship:rel?.value,source:'Guardian'})}
    if(s==='Gifts & beneficiaries')for(const c of all('.iwill-repeat-card')){const t=title(c);if(/^Residuary beneficiary/i.test(t)){const n=field(c,'Full name'),rel=field(c,'Relationship');if(n?.value)r.beneficiaries=upsert(r.beneficiaries,{name:n.value,relationship:rel?.value,source:'Beneficiary'})}else if(/Specific gift/i.test(t)){const n=field(c,'Beneficiary / charity'),rel=field(c,'Relationship');if(n?.value)r.beneficiaries=upsert(r.beneficiaries,{name:n.value,relationship:rel?.value,source:'Beneficiary'})}}
    save(r);
  }
  function setVal(el,v){if(!el)return;const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;setter?setter.call(el,v):el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))}
  function picker(input,cands,rel){
    if(!input||input.dataset.peoplePicker==='1')return;const people=merge(cands);if(!people.length)return;input.dataset.peoplePicker='1';
    const sel=document.createElement('select');sel.className='iwill-person-select';sel.setAttribute('aria-label','Choose someone already entered');
    const ph=document.createElement('option');ph.value='';ph.textContent='Choose someone already entered';sel.appendChild(ph);
    people.forEach(p=>{const op=document.createElement('option');op.value=p.name;op.textContent=p.name+(p.relationship?' — '+p.relationship:'');op.dataset.rel=p.relationship||'';sel.appendChild(op)});
    const man=document.createElement('option');man.value='__manual__';man.textContent='Type someone else';sel.appendChild(man);
    const hint=document.createElement('small');hint.className='iwill-person-hint';hint.textContent='Select someone already entered, or choose “Type someone else”.';
    input.parentNode.insertBefore(sel,input);input.parentNode.insertBefore(hint,input);
    sel.addEventListener('change',()=>{if(sel.value==='__manual__'){input.focus();return}if(!sel.value)return;const op=sel.options[sel.selectedIndex];setVal(input,sel.value);if(rel&&op.dataset.rel)setVal(rel,op.dataset.rel);harvest()});
  }
  function enhancePickers(){
    const s=step(),r=load();
    if(s==='Executors')for(const c of all('.iwill-repeat-card'))picker(field(c,'Full name'),r.family,field(c,'Relationship'));
    if(s==='Guardians'){const people=merge(r.family,r.executors);for(const c of all('.iwill-repeat-card'))picker(field(c,'Full name'),people,field(c,'Relationship'))}
    if(s==='Gifts & beneficiaries'){const assignable=merge(r.family,r.executors,r.guardians);for(const c of all('.iwill-repeat-card')){const t=title(c);if(/^Residuary beneficiary/i.test(t))picker(field(c,'Full name'),assignable,field(c,'Relationship'));if(/Specific gift/i.test(t))picker(field(c,'Beneficiary / charity'),r.beneficiaries,field(c,'Relationship'))}}
    if(s==='Other wishes')picker(field(document,'Who should care for your pets?')||field(document,'Pet carer'),merge(r.family,r.executors,r.guardians,r.beneficiaries),null);
  }
  function removeUnwanted(){
    for(const n of all('.iwill-label,label,span'))if(/Would you like to discuss a separate letter of wishes\?/i.test(clean(n.textContent))){const b=n.closest('.iwill-field')||n.closest('label')||n.parentElement;if(b)b.style.display='none'}
    for(const n of all('small,p,span,div')){const t=clean(n.textContent);if(t==='Secure submission · Sent directly to the iTrustLaw team'||t==='Secure submission - Sent directly to the iTrustLaw team')n.style.display='none'}
  }
  function declaration(){
    const box=document.querySelector('.iwill-declaration');if(!box||box.dataset.merged==='1')return;
    const labels=Array.from(box.querySelectorAll(':scope > label')),checks=labels.map(l=>l.querySelector('input[type=checkbox]')).filter(Boolean);if(checks.length<3)return;
    box.dataset.merged='1';labels.forEach(l=>l.style.display='none');
    const lab=document.createElement('label');lab.className='iwill-combined-declaration';const cb=document.createElement('input');cb.type='checkbox';cb.required=true;cb.checked=checks.every(x=>x.checked);
    const sp=document.createElement('span');sp.textContent='I confirm the information I have provided is accurate to the best of my knowledge and reflects my current wishes. I understand iTrustLaw may contact me if anything needs clarifying, and I agree to iTrustLaw’s Terms & Conditions and Privacy Policy.';
    lab.append(cb,sp);box.insertBefore(lab,box.firstChild);cb.addEventListener('change',()=>checks.forEach(x=>{if(x.checked!==cb.checked)x.click()}));
  }
  function sidebar(){const items=all('.iwill-step-list li'),cur=items.findIndex(x=>x.classList.contains('is-current'));items.forEach((li,i)=>{if(i<cur){li.classList.add('iwill-step-clickable');li.tabIndex=0;li.setAttribute('role','button')}else{li.classList.remove('iwill-step-clickable');li.removeAttribute('tabindex');li.removeAttribute('role')}})}
  function backTo(target){harvest();const go=()=>{const items=all('.iwill-step-list li'),cur=items.findIndex(x=>x.classList.contains('is-current'));if(cur<=target||cur<0)return;const b=all('button').find(x=>clean(x.textContent)==='Back'&&!x.disabled);if(!b)return;b.click();setTimeout(go,90)};go()}
  document.addEventListener('click',e=>{const li=e.target.closest?.('.iwill-step-list li.iwill-step-clickable');if(li){e.preventDefault();backTo(all('.iwill-step-list li').indexOf(li));return}const b=e.target.closest?.('button');if(b&&['Continue','Back','Submit Will instructions'].includes(clean(b.textContent)))harvest()},true);
  document.addEventListener('keydown',e=>{const li=e.target.closest?.('.iwill-step-list li.iwill-step-clickable');if(li&&(e.key==='Enter'||e.key===' ')){e.preventDefault();backTo(all('.iwill-step-list li').indexOf(li))}});
  function run(){removeUnwanted();declaration();sidebar();enhancePickers()}
  const st=document.createElement('style');st.textContent='.iwill-step-clickable{cursor:pointer}.iwill-step-clickable:hover{opacity:.72}.iwill-step-clickable:focus-visible{outline:2px solid currentColor;outline-offset:4px;border-radius:4px}.iwill-person-select{width:100%;min-height:48px;margin:0 0 8px;padding:0 14px;border:1px solid #c8d2d7;border-radius:7px;background:#fff;color:#181818;font:inherit}.iwill-person-hint{display:block;margin:-2px 0 8px;color:#6b7479}.iwill-combined-declaration{display:flex!important;gap:12px;align-items:flex-start}.iwill-combined-declaration input{margin-top:4px;flex:0 0 auto}@media(max-width:760px){.iwill-person-select{min-height:50px;font-size:16px}}';document.head.appendChild(st);
  new MutationObserver(()=>requestAnimationFrame(run)).observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('load',run);run();
})();