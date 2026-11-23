'use strict';
const status=document.querySelector('#load-status');
const password=document.querySelector('#dashboard-password');
const remember=document.querySelector('#remember-access');
const unlock=document.querySelector('#unlock');
const lock=document.querySelector('#lock');
const inputPanel=document.querySelector('#login-controls');
const openPanel=document.querySelector('#open-panel');
const maxEnvelopeBytes=48*1024*1024;
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
// Owner requested remembered access; persist only a non-extractable CryptoKey.
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
function decryptPublication(key,publication=envelope){
  return crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(publication.iv),additionalData:new TextEncoder().encode('SportCenter sealed snapshot v1'),tagLength:128},key,bytes(publication.ciphertext));
}
class PublicationSizeError extends Error {}
async function fetchEnvelope(path){
  const response=await fetch(path+'?t='+Date.now(),{cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'});
  if(!response.ok)throw Error('Publicación no disponible');
  const text=await response.text();
  if(text.length>maxEnvelopeBytes)throw new PublicationSizeError('La publicación supera el tamaño que admite el visor.');
  const data=JSON.parse(text);
  if(data.version!==1||data.kdf!=='PBKDF2-SHA256'||data.iterations!==600000||bytes(data.salt).length!==32||bytes(data.iv).length!==12)throw Error('Formato no válido');
  return data;
}
function configureHistory(manifest,key){
  if(!manifest)return;
  const anchor=document.querySelector('#fantasy-live-cuts').closest('.fantasy-cut-wrap');
  const panel=document.createElement('details');
  panel.className='fantasy-cut-wrap';
  panel.innerHTML='<summary>Ver historial Fantasy</summary>';
  const groups=new Map();
  for(const item of manifest.archivos.filter(x=>x.visible)){
    if(!groups.has(item.label))groups.set(item.label,[]);
    groups.get(item.label).push(item);
  }
  for(const [label,parts] of groups){
    const details=document.createElement('details');
    const title=document.createElement('summary');
    title.textContent=label;
    const content=document.createElement('div');
    details.append(title,content);
    panel.append(details);
    let loaded=false,loading=false;
    details.addEventListener('toggle',async()=>{
      if(!details.open||loaded||loading)return;
      loading=true;
      content.textContent='Cargando historial…';
      try{
        const fields={};
        for(const part of parts){
          if(!/^historial\/[a-z0-9-]+\.json$/.test(part.path))throw Error('Ruta no válida');
          const sealed=await fetchEnvelope(part.path);
          if(sealed.salt!==envelope.salt)throw Error('Acceso del archivo distinto');
          const data=JSON.parse(new TextDecoder().decode(await decryptPublication(key,sealed)));
          if(data.release!==manifest.release||data.id!==part.id)throw Error('Archivo de otro corte');
          for(const [name,kind,entry] of data.entries){
            if(!['fantasy_cortes','eventos_revisados_archivo'].includes(name)&&!/^posiciones_semana\d+_archivo$/.test(name))continue;
            if(kind!=='list')continue;
            (fields[name]??=[]).push(entry[1]);
          }
        }
        window.renderSportCenterHistory(content,escapePayload(fields));
        loaded=true;
      }catch(error){
        content.textContent=error instanceof PublicationSizeError?'Este archivo histórico supera el tamaño del visor.':'No se pudo abrir este historial. Cierra y vuelve a abrir para reintentar.';
      }finally{loading=false}
    });
  }
  if(groups.size)anchor.after(panel);
}
function show(plain,key){
  const data=JSON.parse(new TextDecoder().decode(plain));validate(data);
  const {historial_cifrado:history,...snapshot}=data;
  window.renderSportCenter(escapePayload(snapshot));
  configureHistory(history,key);
  document.querySelector('main').hidden=false;document.querySelector('nav.tabs').hidden=false;
  document.querySelector('#data-cut').textContent='Actualizado · '+data.meta.generado_label;
  document.querySelector('.live-dot').hidden=true;
  inputPanel.hidden=true;openPanel.hidden=true;lock.hidden=true;password.value='';
  status.textContent='Dashboard actualizado. Las próximas publicaciones aparecerán al abrir este enlace.';
}
function renderFailure(){
  openPanel.hidden=false;
  inputPanel.hidden=false;
  status.textContent='El acceso se validó, pero el dashboard no pudo mostrar la publicación. Pulsa Actualizar o avisa a soporte.';
}
unlock.addEventListener('click',async()=>{
  if(!envelope)return;
  unlock.disabled=true;
  status.textContent='Abriendo tu dashboard…';
  const entered=password.value;
  password.value='';
  try{
    const key=await derive(entered);
    let plain;
    try{plain=await decryptPublication(key)}
    catch(error){
      if(error.name!=='OperationError')throw error;
      status.textContent='La contraseña no desbloqueó esta publicación. Comprueba la clave vigente.';
      return;
    }
    try{show(plain,key)}
    catch{renderFailure();return}
    if(remember.checked){
      try{
        await savedAccess('put',{salt:envelope.salt,key});
        status.textContent='Acceso recordado en este navegador. Puedes abrir este enlace sin cargar archivos.';
      }catch{
        status.textContent='Dashboard abierto. Este navegador no pudo recordar el acceso; pedirá la contraseña la próxima vez.';
      }
    }
  }catch{status.textContent='El navegador no pudo verificar el acceso. Pulsa Actualizar o avisa a soporte.'}
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
    envelope=await fetchEnvelope('sealed.json');
    unlock.disabled=false;
    try{
      const saved=await savedAccess('get');
      if(saved&&saved.salt===envelope.salt){
        const plain=await decryptPublication(saved.key);
        try{show(plain,saved.key)}catch{renderFailure()}
        return;
      }
    }catch{}
    openPanel.hidden=false;inputPanel.hidden=false;status.textContent='Abre tu dashboard una vez para recordar el acceso en este navegador.';
  }catch(error){
    openPanel.hidden=false;
    inputPanel.hidden=true;
    status.textContent=error instanceof PublicationSizeError?error.message:'No se pudo cargar la última publicación. Pulsa Actualizar para reintentar.';
  }
})();
