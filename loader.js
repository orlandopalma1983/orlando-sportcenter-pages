'use strict';
const input = document.querySelector('#snapshot-file');
const status = document.querySelector('#load-status');
const clear = document.querySelector('#clear-data');
const warning = document.querySelector('#archive-warning');
const listKeys = ['cupones', 'apuestas_largo_plazo', 'fantasy', 'alineaciones_propuestas', 'rivales_probables', 'waivers_propuestos', 'posiciones', 'cronologia', 'fantasy_cortes'];
const objectKeys = ['meta', 'resumen', 'ultimo_cierre', 'estadisticas_doctor', 'resumen_largo_plazo', 'revision_semanal_fantasy', 'hipica', 'finanzas'];
function validate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Formato no válido: se requiere un objeto SportCenter.');
  for (const key of listKeys) if (!Array.isArray(value[key])) throw Error('Falta una sección: '+key);
  for (const key of objectKeys) if (!value[key] || typeof value[key] !== 'object' || Array.isArray(value[key])) throw Error('Falta una sección: '+key);
  if (typeof value.meta.generado_label !== 'string' || typeof value.meta.corte_label !== 'string') throw Error('El archivo no identifica su fecha y corte.');
}
function escapePayload(value, depth=0) {
  if (depth > 40) throw Error('Archivo demasiado anidado.');
  if (typeof value === 'string') return value.replace(/[&<>"'`]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;', '`':'&#96;'}[c]));
  if (Array.isArray(value)) return value.map(v => escapePayload(v, depth+1));
  if (value && typeof value === 'object') {
    const out = Object.create(null);
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__','constructor','prototype'].includes(key)) throw Error('Clave de archivo no válida.');
      out[key] = escapePayload(item, depth+1);
    }
    return out;
  }
  return value;
}
input.addEventListener('change', async () => {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { status.textContent='El archivo supera 10 MB.'; input.value=''; return; }
  try {
    const data = JSON.parse(await file.text());
    validate(data);
    window.renderSportCenter(escapePayload(data));
    warning.textContent = (data.meta.snapshot_tipo==='CORTE_VERIFICADO'?'CORTE VERIFICADO · ':'ARCHIVO HISTÓRICO · ')+data.meta.generado_label+'. '+(data.meta.nota_datos||'Cada sección conserva su propio corte. No es una actualización automática; conciliación Betano pendiente.');
    warning.hidden = false;
    document.querySelector('main').hidden = false;
    document.querySelector('nav.tabs').hidden = false;
    clear.hidden = false;
    input.disabled = true;
    status.textContent='Archivo abierto localmente. Para abrir otro, cierra este primero.';
    document.querySelector('#data-cut').textContent='Archivo · '+data.meta.generado_label;
    // Remove the legacy live signal: opening a snapshot does not refresh it.
    document.querySelector('.live-dot').hidden = true;
  } catch (error) {
    document.querySelector('main').hidden = true;
    document.querySelector('nav.tabs').hidden = true;
    status.textContent='No se pudo abrir el archivo. '+error.message+' Recarga la página antes de intentarlo otra vez.';
    input.disabled = true;
    clear.hidden = false;
  } finally { input.value=''; }
});
clear.addEventListener('click', () => location.reload());
// No fetch, APIs, analytics, cookies, storage, service workers or automatic imports.
