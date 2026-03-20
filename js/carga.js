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

  // ── CUANDO SE SELECCIONA PERSONA: BUSCAR HORARIO PLANIFICADO ──
  async function onPersonaChange() {
    const nomSel = document.getElementById('lNom');
    const nomOpt = nomSel.options[nomSel.selectedIndex];
    horarioPlan  = null;
    _clearCalc();
    _clearPlanInfo();

    if (!nomOpt?.value) return;
    let nombre;
    try { nombre = JSON.parse(nomOpt.value).nombre; } catch{ return; }

    const fecha = _fecha();
    const plan  = await getHorarioPlanificado(nombre, fecha);
    horarioPlan = plan;

    const infoEl = document.getElementById('lPlanInfo');
    if (!plan) {
      infoEl.style.display = '';
      infoEl.innerHTML = `<span style="font-size:11px;color:rgba(198,201,215,.4);">Sin horario planificado para hoy — podés ingresar la hora de todas formas.</span>`;
      return;
    }

    // Mostrar según tipo
    infoEl.style.display = '';
    if (plan.tipo === 'flex') {
      infoEl.innerHTML = `
        <span style="font-size:11px;color:rgba(198,201,215,.6);">Horario planificado hoy:</span>
        <span style="font-weight:800;color:var(--one-purple);margin-left:6px;">🔄 Flex</span>
        <span style="font-size:10px;color:rgba(198,201,215,.35);margin-left:6px;">Sin hora fija — se registra la entrada/salida real</span>`;
    } else if (plan.tipo === 'guardia') {
      infoEl.innerHTML = `
        <span style="font-size:11px;color:rgba(198,201,215,.6);">Horario planificado hoy:</span>
        <span style="font-weight:800;color:var(--one-gold);margin-left:6px;">🛡 Guardia</span>
        <span style="font-size:10px;color:rgba(198,201,215,.35);margin-left:6px;">1h computable en cualquier horario</span>`;
    } else {
      infoEl.innerHTML = `
        <span style="font-size:11px;color:rgba(198,201,215,.6);">Horario planificado hoy:</span>
        <span style="font-weight:800;color:var(--one-cyan);margin-left:6px;">${plan.entrada}</span>
        ${plan.salida ? `<span style="color:rgba(198,201,215,.45);font-size:11px;"> → </span><span style="font-weight:700;">${plan.salida}</span>` : ''}`;
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

  // ── GUARDAR REGISTRO ──
  async function guardar() {
    const area   = document.getElementById('lArea').value;
    const nomSel = document.getElementById('lNom');
    const nomOpt = nomSel.options[nomSel.selectedIndex];
    const ent    = document.getElementById('lEnt').value;
    const sal    = document.getElementById('lSal').value;
    const obs    = document.getElementById('lObs').value.trim();
    const fecha  = _fecha();

    if (!area || !nomOpt?.value || !ent) {
      showToast('Completá área, nombre y hora de entrada','err'); return;
    }
    let nombre, rol;
    try { const d=JSON.parse(nomOpt.value); nombre=d.nombre; rol=d.rol; }
    catch { showToast('Seleccioná una persona válida','err'); return; }

    const btn = document.getElementById('lBtnG');
    btn.disabled = true;
    document.getElementById('lBIco').textContent = '⏳';
    document.getElementById('lBTxt').textContent = 'Guardando...';

    // ── Determinar el campo "turno" según el tipo de plan ──
    let turnoStr;
    if (!horarioPlan) {
      turnoStr = 'Personalizado';
    } else if (horarioPlan.tipo === 'flex') {
      turnoStr = 'Flex';
    } else if (horarioPlan.tipo === 'guardia') {
      turnoStr = 'Guardia';
    } else {
      // Normal: "09:00 → 17:00" o solo "09:00"
      turnoStr = horarioPlan.entrada
        + (horarioPlan.salida ? ' → ' + horarioPlan.salida : '');
    }

    // Tardanza: solo aplica para horario normal
    const tardanza = (horarioPlan?.tipo === 'normal' && horarioPlan?.entrada)
      ? calcTardVsPlan(horarioPlan.entrada, ent)
      : null;

    const { error } = await SB.from('registros').insert({
      area, nombre, rol, fecha,
      turno:        turnoStr,
      hora_entrada: ent + ':00',
      hora_salida:  sal ? sal + ':00' : null,
      observaciones: obs || null,
    });

    btn.disabled = false;
    document.getElementById('lBIco').textContent = '✅';
    document.getElementById('lBTxt').textContent = 'Guardar registro';

    if (error) { showToast('Error: '+error.message,'err'); return; }

    // Cola visual
    sessionQueue.unshift({ nombre, area, ent, sal, tardanza, hs:calcHs(ent,sal), plan:horarioPlan });
    _renderQueue();

    // Banner
    document.getElementById('lOkMsg').textContent = `✓ ${nombre} registrado`;
    const banner = document.getElementById('lOkBanner');
    banner.style.display = '';
    clearTimeout(banner._t);
    banner._t = setTimeout(()=>banner.style.display='none', 5000);

    // Reset rápido (mantiene área)
    document.getElementById('lNom').value = '';
    document.getElementById('lEnt').value = '';
    document.getElementById('lSal').value = '';
    document.getElementById('lObs').value = '';
    horarioPlan = null;
    _clearCalc();
    _clearPlanInfo();
    window.scrollTo({top:0,behavior:'smooth'});
  }

  function _renderQueue() {
    const sec = document.getElementById('lQSec');
    if (!sessionQueue.length) { sec.style.display='none'; return; }
    sec.style.display = '';
    document.getElementById('lQCnt').textContent = sessionQueue.length;
    document.getElementById('lQList').innerHTML = sessionQueue.slice(0,12).map(r => {
      // Badge de tardanza / tipo
      let tb = '';
      if (r.plan?.tipo === 'flex') {
        tb = `<span class="badge badge-purple" style="font-size:10px;">🔄 Flex</span>`;
      } else if (r.plan?.tipo === 'guardia') {
        tb = `<span class="badge badge-gold" style="font-size:10px;">🛡 Guardia</span>`;
      } else if (r.tardanza !== null) {
        tb = r.tardanza <= 0
          ? `<span class="badge badge-green" style="font-size:10px;">✓ ${Math.abs(r.tardanza)}m antes</span>`
          : `<span class="badge badge-red"   style="font-size:10px;">+${r.tardanza}m tarde</span>`;
      }

      const hb = r.hs ? `<span class="badge badge-cyan" style="font-size:10px;">${fmtHs(r.hs)}</span>` : '';

      // Texto del plan según tipo
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