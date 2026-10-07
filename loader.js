'use strict';
const status=document.querySelector('#load-status');
const password=document.querySelector('#dashboard-password');
const remember=document.querySelector('#remember-access');
const unlock=document.querySelector('#unlock');
const lock=document.querySelector('#lock');
const warning=document.querySelector('#archive-warning');
const inputPanel=document.querySelector('#login-controls');
const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
let envelope=null;
const listKeys=['cupones','apuestas_largo_plazo','fantasy','alineaciones_propuestas','rivales_probables','waivers_propuestos','posiciones','cronologia','fantasy_cortes'];
const objectKeys=['meta','resumen','ultimo_cierre','estadisticas_doctor','resumen_largo_plazo','revision_semanal_fantasy','hipica','finanzas'];
function validate(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Formato no válido');
  for(const key of listKeys)if(!Array.isArray(value[key]))throw Error('Sección ausente');
  for(const key of objectKeys)if(!value[key]||typeof value[key]!=='object'||Array.isArray(value[key]))throw Error('Sección ausente');
  if(typeof value.meta.generado_label!=='string')throw Error('Corte ausente');
}
function escapePayload(value,depth=0){
  if(depth>40)throw Error('Datos demasiado anidados');
  if(typeof value==='string')return value.replace(/[&<>"'`]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;'}[c]));
  if(Array.isArray(value))return value.map(v=>escapePayload(v,depth+1));
  if(value&&typeof value==='object'){
    const out=Object.create(null);
    for(const [key,item]of Object.entries(value)){
      if(['__proto__','constructor','prototype'].includes(key))throw Error('Clave no válida');
      out[key]=escapePayload(item,depth+1);
    }
    return out;
  }
  return value;
}
// Persist only a non-extractable CryptoKey, with explicit device consent.
async function savedAccess(mode,value){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('sportcenter-access-v1',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('access');
    request.onerror=()=>reject(Error('No se pudo acceder al almacenamiento del navegador'));
    request.onsuccess=()=>{
      const db=request.result,tx=db.transaction('access',mode==='get'?'readonly':'readwrite');
      const store=tx.objectStore('access');
      const op=mode==='get'?store.get('current'):mode==='put'?store.put(value,'current'):store.clear();
      let result;op.onsuccess=()=>{result=op.result};
      tx.oncomplete=()=>{db.close();resolve(result)};
      tx.onerror=()=>{db.close();reject(Error('No se pudo guardar el acceso'))};
    };
  });
}
async function derive(secret){
  const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt:bytes(envelope.salt),iterations:600000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['decrypt']);
}
async function show(key){
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(envelope.iv),additionalData:new TextEncoder().encode('SportCenter sealed snapshot v1'),tagLength:128},key,bytes(envelope.ciphertext));
  const data=JSON.parse(new TextDecoder().decode(plain));validate(data);
  window.renderSportCenter(escapePayload(data));
  warning.textContent=data.meta.generado_label+'. '+(data.meta.nota_datos||'Cada sección conserva su propio corte.');
  warning.hidden=false;document.querySelector('main').hidden=false;document.querySelector('nav.tabs').hidden=false;
  document.querySelector('#data-cut').textContent='Actualizado · '+data.meta.generado_label;
  document.querySelector('.live-dot').hidden=true;
  inputPanel.hidden=true;lock.hidden=false;password.value='';
  status.textContent='Dashboard actualizado. Las próximas publicaciones aparecerán al abrir este enlace.';
}
unlock.addEventListener('click',async()=>{
  if(!envelope)return;
  unlock.disabled=true;status.textContent='Abriendo tu dashboard…';
  try{
    const key=await derive(password.value);password.value='';await show(key);
    if(remember.checked){
      try{await savedAccess('put',{salt:envelope.salt,key});status.textContent='Acceso recordado en este navegador. Puedes abrir este enlace sin cargar archivos.'}
      catch{status.textContent='Dashboard abierto. Este navegador no pudo recordar el acceso; pedirá la contraseña la próxima vez.'}
    }
  }catch{password.value='';status.textContent='No se pudo abrir: comprueba la contraseña. Si persiste, pide revisar la publicación.'}
  finally{unlock.disabled=false}
});
password.addEventListener('keydown',e=>{if(e.key==='Enter')unlock.click()});
lock.addEventListener('click',async()=>{
  try{await savedAccess('clear');location.reload()}
  catch{status.textContent='No se pudo borrar el acceso recordado. Borra los datos de este sitio en tu navegador.'}
});
document.querySelector('#refresh-dashboard').addEventListener('click',()=>location.reload());
(async()=>{
  try{
    if(!crypto.subtle)throw Error('Se necesita HTTPS');
    const response=await fetch('sealed.json?t='+Date.now(),{cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'});
    if(!response.ok)throw Error('Publicación no disponible');
    const text=await response.text();if(text.length>16*1024*1024)throw Error('Archivo demasiado grande');
    envelope=JSON.parse(text);
    if(envelope.version!==1||envelope.kdf!=='PBKDF2-SHA256'||envelope.iterations!==600000||bytes(envelope.salt).length!==32||bytes(envelope.iv).length!==12)throw Error('Formato no válido');
    unlock.disabled=false;status.textContent='Escribe tu contraseña para abrir el dashboard.';
    try{
      const saved=await savedAccess('get');
      if(saved&&saved.salt===envelope.salt){await show(saved.key);status.textContent='Última publicación cargada automáticamente.'}
    }catch{status.textContent='Introduce la contraseña para renovar el acceso.'}
  }catch{status.textContent='No se pudo cargar la última publicación. Pulsa Actualizar para reintentar.'}
})();
