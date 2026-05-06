// js/carga.js — Panel de carga individual
// Lee el horario semanal planificado de la persona para calcular tardanza real

const Carga = (() => {

  let sessionQueue = [];
  let horarioPlan  = null; // { entrada, salida, tipo } del horario semanal

  function init() {
    // La fecha se maneja ahora desde index.html con las flechitas
    // Solo inicializamos el display si existe el elemento legacy
    _actualizarFecha();
  }

  function _actualizarFecha() {
    // Compatibilidad: si existe el input hidden lFecha, lo actualizamos
    const el = document.getElementById('lFecha');
    if (el && !el.value) el.value = _getFechaActual ? _getFechaActual() : today();
  }

  // Retorna la fecha actualmente seleccionada (hoy o la elegida con las flechas)
  function _fecha() {
    return (window._getFechaActual ? window._getFechaActual() : null)
        || document.getElementById('lFecha')?.value
        || today();
  }

  // ── CARGAR PERSONAL DEL ÁREA ──
  async function loadPersonal() {
    const area = document.getElementById('lArea').value;
    const sel  = document.getElementById('lNom');
    horarioPlan = null;
    _clearCalc();
    if (!area) { sel.innerHTML='<option value="">Seleccioná área primero</option>'; return; }
    sel.innerHTML = '<option value="">Cargando...</option>';
    const { data } = await SB.from('personal').select('nombre,rol').eq('area',area).eq('activo',true).order('nombre');
    sel.innerHTML = '<option value="">Seleccionar persona...</option>';
    (data||[]).forEach(p => {
      const o = document.createElement('option');
      o.value = JSON.stringify({nombre:p.nombre, rol:p.rol||''});
      o.textContent = p.nombre;
      sel.appendChild(o);
    });
  }

/* ── Persona cambia ── */
async function onPersonaChange() {
  const opt = document.getElementById('lNom').selectedOptions[0];
  horarioPlan = null; _clearCalc(); _clearPlan();
  if (!opt?.value) return;
  let nombre;
  try { nombre = JSON.parse(opt.value).nombre; } catch { return; }

  const plan = await getHorarioPlanificado(nombre, getFechaActual());
  horarioPlan = plan;

  // ✅ Buscar si existe un registro del MISMO DÍA para cargar datos previos
  const { data: regHoy } = await SB.from('registros')
    .select('*')
    .eq('nombre', nombre)
    .eq('fecha', getFechaActual())
    .limit(1);

  if (regHoy && Array.isArray(regHoy) && regHoy.length > 0) {
    const reg = regHoy[0];
    document.getElementById('lEnt').value = reg.hora_entrada?.slice(0,5) || '';
    document.getElementById('lSal').value = reg.hora_salida?.slice(0,5) || '';
    document.getElementById('lObs').value = reg.observaciones || '';
  }

  const el = document.getElementById('lPlanInfo');
  el.className = 'plan-info';
  el.style.display = 'flex'; // forzar visible

  if (!plan) {
    el.innerHTML = '<span style="color:rgba(198,201,215,.45);">Sin horario planificado — podés ingresar igualmente.</span>';
    document.getElementById('btnAgregar2do').style.display = '';
    document.getElementById('turno2Wrap').style.display = 'none';
    return;
  }
  if (plan.tipo === 'flex') {
    el.classList.add('plan-flex');
    el.innerHTML = '<span style="color:rgba(198,201,215,.6);">Planificado:</span>'
      + '<strong style="color:var(--one-purple);margin-left:5px;">🔄 Flex</strong>'
      + '<span style="font-size:10px;color:rgba(198,201,215,.35);margin-left:4px;">Sin hora fija</span>';
    document.getElementById('btnAgregar2do').style.display = 'none';
    document.getElementById('turno2Wrap').style.display = 'none';
    return;
  } else if (plan.tipo === 'guardia') {
    el.classList.add('plan-guardia');
    el.innerHTML = '<span style="color:rgba(198,201,215,.6);">Planificado:</span>'
      + '<strong style="color:var(--one-gold);margin-left:5px;">🛡 Guardia</strong>'
      + '<span style="font-size:10px;color:rgba(198,201,215,.35);margin-left:4px;">1h computable</span>';
    document.getElementById('btnAgregar2do').style.display = 'none';
    document.getElementById('turno2Wrap').style.display = 'none';
    return;
  } else {
    // Horario normal — mostrar horario y si es partido
    const esCortado = !!(plan.entrada2 || plan.salida2);
    let html = '<span style="color:rgba(198,201,215,.6);">Planificado:</span>'
      + '<strong style="color:var(--one-cyan);margin-left:5px;">' + plan.entrada + '</strong>'
      + (plan.salida ? '<span style="color:rgba(198,201,215,.4);font-size:11px;"> → </span><strong>' + plan.salida + '</strong>' : '');
    if (esCortado) {
      html += '<span style="color:rgba(228,199,106,.6);margin-left:8px;font-size:11px;">✂</span>'
        + '<strong style="color:var(--one-gold);margin-left:4px;font-size:11px;">'
        + (plan.entrada2 || '?') + (plan.salida2 ? ' → ' + plan.salida2 : '') + '</strong>'
        + '<span style="font-size:10px;color:rgba(228,199,106,.5);margin-left:4px;">turno partido</span>';
    }
    el.innerHTML = html;

    // Mostrar/ocultar bloque de 2° turno
    const t2 = document.getElementById('turno2Wrap');
    const btn2 = document.getElementById('btnAgregar2do');
    if (esCortado) {
      if (t2) t2.style.display = '';
      if (btn2) btn2.style.display = 'none';
      const e2 = document.getElementById('lEnt2');
      const s2 = document.getElementById('lSal2');
      if (e2) e2.value = '';
      if (s2) s2.value = '';
    } else {
      if (t2) t2.style.display = 'none';
      if (btn2) btn2.style.display = ''; // mostrar botón manual
    }
  }
  updCalc();
}

  function _clearPlanInfo() {
    const el = document.getElementById('lPlanInfo');
    if (el) el.style.display = 'none';
  }

  function _clearCalc() {
    const it = document.getElementById('lInfoT');
    const ih = document.getElementById('lInfoH');
    if (it) it.textContent = '';
    if (ih) ih.textContent = '';
  }

  // ── CALCULAR TARDANZA Y HORAS EN VIVO ──
  function updCalc() {
    const ent = document.getElementById('lEnt').value;
    const sal = document.getElementById('lSal').value;
    const it  = document.getElementById('lInfoT');
    const ih  = document.getElementById('lInfoH');

    // Para flex y guardia no hay tardanza calculable
    if (horarioPlan?.tipo === 'flex') {
      it.style.color = 'var(--one-purple)';
      it.textContent = ent ? '🔄 Horario Flex — sin tardanza calculada' : '';
    } else if (horarioPlan?.tipo === 'guardia') {
      it.style.color = 'var(--one-gold)';
      it.textContent = ent ? '🛡 Guardia — 1h computable' : '';
    } else if (ent && horarioPlan?.entrada) {
      // Horario normal: calcular tardanza
      const diff = calcTardVsPlan(horarioPlan.entrada, ent);
      const info = tardInfoText(diff);
      it.style.color = info.color;
      it.textContent = info.text;
    } else if (ent) {
      it.style.color = 'rgba(198,201,215,.5)';
      it.textContent = 'Sin planificación para comparar';
    } else {
      it.textContent = '';
    }

    // Horas trabajadas (aplica a todos los tipos)
    const hs = calcHs(ent, sal);
    if (hs !== null) {
      let extraTxt = '';
      // Solo calcular horas extra para horario normal con salida planificada
      if (horarioPlan?.tipo === 'normal' && horarioPlan?.salida && sal) {
        const extra = calcHsExtra(horarioPlan.salida, sal);
        if (extra > 0) extraTxt = ` <span style="color:var(--one-gold);">(+${extra}m extra)</span>`;
      }
      ih.innerHTML = `⏱ ${fmtHs(hs)} trabajadas${extraTxt}`;
    } else {
      ih.textContent = '';
    }
  }

// ── GUARDAR REGISTRO (INSERT o UPDATE si ya existe del mismo día) ──
// ═══════════════════════════════════════════════════════════════════════════
// SOLUCIÓN SIMPLE: En vez de UPSERT, usa UPDATE+INSERT manual
// NO necesita constraint en Supabase
// ═══════════════════════════════════════════════════════════════════════════

// REEMPLAZA la función guardarRegistro() en index.html con ESTA:

async function guardarRegistro() {
  const area = document.getElementById('lArea').value;
  const opt  = document.getElementById('lNom').selectedOptions[0];
  const ent  = document.getElementById('lEnt').value;
  const sal  = document.getElementById('lSal').value;
  const ent2 = document.getElementById('lEnt2')?.value || '';
  const sal2 = document.getElementById('lSal2')?.value || '';
  const obs  = document.getElementById('lObs').value.trim();
  const fecha = getFechaActual();

  if (!area || !opt?.value || !ent) {
    showToast('Completá área, nombre y hora de entrada', 'err'); return;
  }
  let nombre, rol;
  try { const d = JSON.parse(opt.value); nombre = d.nombre; rol = d.rol; }
  catch { showToast('Seleccioná una persona válida', 'err'); return; }

  const btn = document.getElementById('lBtnG');
  btn.disabled = true;
  document.getElementById('lBIco').textContent = '⏳';
  document.getElementById('lBTxt').textContent = 'Guardando...';

  const turno = !horarioPlan ? 'Personalizado'
    : horarioPlan.tipo === 'flex'    ? 'Flex'
    : horarioPlan.tipo === 'guardia' ? 'Guardia'
    : (() => {
        const esCortado = !!(horarioPlan.entrada2 || horarioPlan.salida2);
        let t = horarioPlan.entrada + (horarioPlan.salida ? ' → ' + horarioPlan.salida : '');
        if (esCortado) t += ' | ' + (horarioPlan.entrada2 || '') + (horarioPlan.salida2 ? ' → ' + horarioPlan.salida2 : '');
        return t;
      })();

  const tardanza = horarioPlan?.tipo === 'normal' && horarioPlan?.entrada
    ? calcTardVsPlan(horarioPlan.entrada, ent) : null;

  let obsFinal = obs || null;
  if (ent2) {
    const t2str = ent2 + (sal2 ? ' → ' + sal2 : '');
    obsFinal = (obs ? obs + ' | ' : '') + '2° turno: ' + t2str;
  }

  // ✅ NUEVA LÓGICA: Buscar si existe, UPDATE si existe, INSERT si no
  
  // 1. Buscar si ya existe registro para esta persona este día
  const { data: existing } = await SB
    .from('registros')
    .select('id')
    .eq('nombre', nombre)
    .eq('fecha', fecha)
    .limit(1);

  let error = null;

  if (existing && existing.length > 0) {
    // YA EXISTE → ACTUALIZAR
    const id = existing[0].id;
    const { error: errUpdate } = await SB
      .from('registros')
      .update({
        area, rol, turno,
        hora_entrada: ent + ':00',
        hora_salida: sal ? sal + ':00' : null,
        observaciones: obsFinal,
      })
      .eq('id', id);
    error = errUpdate;
  } else {
    // NO EXISTE → INSERTAR
    const { error: errInsert } = await SB
      .from('registros')
      .insert({
        area, nombre, rol, fecha,
        turno,
        hora_entrada: ent + ':00',
        hora_salida: sal ? sal + ':00' : null,
        observaciones: obsFinal,
      });
    error = errInsert;
  }

  btn.disabled = false;
  document.getElementById('lBIco').textContent = '✅';
  document.getElementById('lBTxt').textContent = 'Guardar registro';

  if (error) { 
    console.error('Error:', error);
    showToast('Error: ' + error.message, 'err'); 
    return; 
  }

  sessionQueue.unshift({ nombre, area, ent, sal, tardanza, hs: calcHs(ent,sal), plan: horarioPlan });
  _renderQueue();

  document.getElementById('lOkMsg').textContent = '✓ ' + nombre + ' registrado';
  const banner = document.getElementById('lOkBanner');
  banner.style.display = '';
  clearTimeout(banner._t);
  banner._t = setTimeout(() => banner.style.display = 'none', 5000);

  document.getElementById('lNom').value = '';
  document.getElementById('lEnt').value = '';
  document.getElementById('lSal').value = '';
  document.getElementById('lObs').value = '';
  const e2 = document.getElementById('lEnt2'); if (e2) e2.value = '';
  const s2 = document.getElementById('lSal2'); if (s2) s2.value = '';
  const t2w = document.getElementById('turno2Wrap'); if (t2w) t2w.style.display = 'none';
  horarioPlan = null; _clearCalc(); _clearPlan();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ═══════════════════════════════════════════════════════════════════════════
// ¿QUÉ HACE?
// 
// 1. Busca: ¿Existe registro para (nombre, fecha)?
// 2. Si SÍ existe → UPDATE (actualiza entrada/salida/obs)
// 3. Si NO existe → INSERT (crea registro nuevo)
// 4. Listo
//
// NO necesita constraint
// NO necesita UPSERT
// Funciona al toque
// ═══════════════════════════════════════════════════════════════════════════


function _renderQueue() {
    const sec = document.getElementById('lQSec');
    if (!sessionQueue.length) { sec.style.display='none'; return; }
    sec.style.display = '';
    document.getElementById('lQCnt').textContent = sessionQueue.length;
    document.getElementById('lQList').innerHTML = sessionQueue.slice(0,12).map(r => {
      let tb = '';
      if (r.plan?.tipo === 'flex') {
        tb = `<span class="badge badge-purple" style="font-size:10px;">🔄 Flex</span>`;
      } else if (r.plan?.tipo === 'guardia') {
        tb = `<span class="badge badge-gold" style="font-size:10px;">🛡 Guardia</span>`;
      } else if (r.tardanza !== null) {
        tb = r.tardanza <= 0
          ? `<span class="badge badge-green" style="font-size:10px;">✓ ${Math.abs(r.tardanza)}m antes</span>`
          : `<span class="badge badge-red" style="font-size:10px;">+${r.tardanza}m tarde</span>`;
      }
      const hb = r.hs ? `<span class="badge badge-cyan" style="font-size:10px;">${fmtHs(r.hs)}</span>` : '';
      let planTxt = '';
      if (r.plan?.tipo === 'flex')    planTxt = `<span style="font-size:11px;color:var(--one-purple);">Flex</span>`;
      else if (r.plan?.tipo === 'guardia') planTxt = `<span style="font-size:11px;color:var(--one-gold);">Guardia</span>`;
      else if (r.plan?.entrada)       planTxt = `<span style="font-size:11px;color:rgba(198,201,215,.5);">${r.plan.entrada}</span>`;
      return `<div class="queue-row">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="color:${areaColor(r.area)};font-size:11px;font-weight:800;">${r.area.split(' ')[0]}</span>
          <span style="font-weight:700;font-size:14px;">${r.nombre}</span>
          ${planTxt}
          <span style="font-size:13px;color:rgba(198,201,215,.6);">${r.ent}${r.sal?' → '+r.sal:''}</span>
          ${hb}${tb}
        </div>
        <span style="color:var(--color-success-text);font-size:15px;flex-shrink:0;">✓</span>
      </div>`;
}).join('');
  }

  // ── LOGIN ADMIN ──
  function loginAdmin() {
    const u = document.getElementById('aU').value.trim();
    const p = document.getElementById('aP').value.trim();
    if (Auth.loginAdmin(u,p)) window.location.href='admin.html';
    else showToast('Usuario o contraseña incorrectos','err');
  }

  function showAdminLogin() {
    const box = document.getElementById('adminLoginBox');
    const visible = box.style.display!=='none';
    box.style.display = visible ? 'none' : '';
    document.getElementById('btnShowAdmin').style.display = visible ? '' : 'none';
  }

  return { init, loadPersonal, onPersonaChange, updCalc, guardar, loginAdmin, showAdminLogin };

})();

// Globales para onclick
window.lLoadPers      = () => Carga.loadPersonal();
window.lOnPersona     = () => Carga.onPersonaChange();
window.lUpdCalc       = () => Carga.updCalc();
window.lGuardar       = () => Carga.guardar();
window.loginAdmin     = () => Carga.loginAdmin();
window.showAdminLogin = () => Carga.showAdminLogin();

document.addEventListener('DOMContentLoaded', () => Carga.init());