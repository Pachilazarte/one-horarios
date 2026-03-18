// js/carga.js — Panel de carga individual
// - Fecha predeterminada: ayer
// - Navegación de fechas con flechas
// - Lee horario planificado desde horarios_semanales

const Carga = (() => {

  let sessionQueue = [];
  let horarioPlan  = null;
  let fechaActual  = '';

  function init() {
    fechaActual = yesterday();
    document.getElementById('lFecha').value = fechaActual;
    _updFechaDisplay();
  }

  function cambiarFecha(dir) {
    const nueva = addDays(fechaActual, dir);
    const hoy   = today();
    if (nueva > hoy) return;
    fechaActual = nueva;
    document.getElementById('lFecha').value = fechaActual;
    _updFechaDisplay();
    const nomSel = document.getElementById('lNom');
    if (nomSel?.value) onPersonaChange();
    else { horarioPlan = null; _clearCalc(); _clearPlanInfo(); }
  }

  function _updFechaDisplay() {
    const el    = document.getElementById('fechaDisplay');
    const flSig = document.getElementById('flechaSig');
    if (el) el.textContent = getDayName(fechaActual);
    if (flSig) flSig.style.opacity = fechaActual >= today() ? '0.25' : '1';
  }

  async function loadPersonal() {
    const area = document.getElementById('lArea').value;
    const sel  = document.getElementById('lNom');
    horarioPlan = null; _clearCalc(); _clearPlanInfo();
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

  async function onPersonaChange() {
    const nomSel = document.getElementById('lNom');
    const nomOpt = nomSel.options[nomSel.selectedIndex];
    horarioPlan  = null; _clearCalc(); _clearPlanInfo();
    if (!nomOpt?.value) return;
    let nombre;
    try { nombre = JSON.parse(nomOpt.value).nombre; } catch { return; }

    const plan = await getHorarioPlanificado(nombre, fechaActual);
    horarioPlan = plan;

    const infoEl = document.getElementById('lPlanInfo');
    if (plan) {
      infoEl.style.display = '';
      const bloque1 = `<span style="font-weight:800;color:var(--one-cyan);">${plan.entrada}</span>${plan.salida?`<span style="color:rgba(198,201,215,.45);font-size:11px;"> → </span><span style="font-weight:700;">${plan.salida}</span>`:''}`;
      const bloque2 = plan.entrada2
        ? `<span style="color:rgba(198,201,215,.35);font-size:11px;margin:0 5px;">·</span><span style="font-weight:800;color:var(--one-gold);">${plan.entrada2}</span>${plan.salida2?`<span style="color:rgba(198,201,215,.35);font-size:11px;"> → </span><span style="font-weight:700;color:var(--one-gold);">${plan.salida2}</span>`:''}`
        : '';
      infoEl.innerHTML = `<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;"><span style="font-size:11px;color:rgba(198,201,215,.55);">Horario planificado:</span> ${bloque1}${bloque2}</div>`;
    } else {
      infoEl.style.display = '';
      infoEl.innerHTML = `<span style="font-size:11px;color:rgba(198,201,215,.38);">Sin horario planificado para este día — podés ingresar igual.</span>`;
    }
    updCalc();
  }

  function _clearPlanInfo() {
    const el = document.getElementById('lPlanInfo');
    if (el) { el.style.display='none'; el.innerHTML=''; }
  }

  function _clearCalc() {
    ['lInfoT','lInfoH'].forEach(id => { const el=document.getElementById(id); if(el) el.textContent=''; });
  }

  function updCalc() {
    const ent = document.getElementById('lEnt').value;
    const sal = document.getElementById('lSal').value;
    const it  = document.getElementById('lInfoT');
    const ih  = document.getElementById('lInfoH');

    if (ent && horarioPlan?.entrada) {
      const diff = calcTardVsPlan(horarioPlan.entrada, ent);
      const info = tardInfoText(diff);
      it.style.color = info.color;
      it.textContent = info.text;
    } else if (ent) {
      it.style.color = 'rgba(198,201,215,.45)';
      it.textContent = 'Sin planificación para comparar';
    } else {
      it.textContent = '';
    }

    const hs = calcHs(ent, sal);
    if (hs !== null) {
      let extraTxt = '';
      if (horarioPlan?.salida && sal) {
        const extra = calcHsExtra(horarioPlan.salida, sal);
        if (extra > 0) extraTxt = ` <span style="color:var(--one-gold);">(+${extra}m extra)</span>`;
      }
      ih.innerHTML = `⏱ ${fmtHs(hs)} trabajadas${extraTxt}`;
    } else {
      ih.textContent = '';
    }
  }

  async function guardar() {
    const area   = document.getElementById('lArea').value;
    const nomSel = document.getElementById('lNom');
    const nomOpt = nomSel.options[nomSel.selectedIndex];
    const ent    = document.getElementById('lEnt').value;
    const sal    = document.getElementById('lSal').value;
    const obs    = document.getElementById('lObs').value.trim();
    const fecha  = fechaActual;

    if (!area||!nomOpt?.value||!ent) { showToast('Completá área, nombre y hora de entrada','err'); return; }
    let nombre, rol;
    try { const d=JSON.parse(nomOpt.value); nombre=d.nombre; rol=d.rol; }
    catch { showToast('Seleccioná una persona válida','err'); return; }

    const btn = document.getElementById('lBtnG');
    btn.disabled = true;
    document.getElementById('lBIco').textContent = '⏳';
    document.getElementById('lBTxt').textContent = 'Guardando...';

    let turnoStr = 'Personalizado';
    if (horarioPlan) {
      turnoStr = `${horarioPlan.entrada}${horarioPlan.salida?' → '+horarioPlan.salida:''}`;
      if (horarioPlan.entrada2) turnoStr += ` / ${horarioPlan.entrada2}${horarioPlan.salida2?' → '+horarioPlan.salida2:''}`;
    }

    const { error } = await SB.from('registros').insert({
      area, nombre, rol, fecha,
      turno: turnoStr,
      hora_entrada: ent+':00',
      hora_salida:  sal ? sal+':00' : null,
      observaciones: obs||null,
    });

    btn.disabled = false;
    document.getElementById('lBIco').textContent = '✅';
    document.getElementById('lBTxt').textContent = 'Guardar registro';

    if (error) { showToast('Error: '+error.message,'err'); return; }

    const tardanza = horarioPlan?.entrada ? calcTardVsPlan(horarioPlan.entrada, ent) : null;
    sessionQueue.unshift({ nombre, area, ent, sal, tardanza, hs:calcHs(ent,sal), plan:horarioPlan, fecha });
    _renderQueue();

    document.getElementById('lOkMsg').textContent = `✓ ${nombre} registrado (${fmtDate(fecha)})`;
    const banner = document.getElementById('lOkBanner');
    banner.style.display = '';
    clearTimeout(banner._t);
    banner._t = setTimeout(()=>banner.style.display='none', 5000);

    document.getElementById('lNom').value = '';
    document.getElementById('lEnt').value = '';
    document.getElementById('lSal').value = '';
    document.getElementById('lObs').value = '';
    horarioPlan = null; _clearCalc(); _clearPlanInfo();
    window.scrollTo({top:0,behavior:'smooth'});
  }

  function _renderQueue() {
    const sec = document.getElementById('lQSec');
    if (!sessionQueue.length) { sec.style.display='none'; return; }
    sec.style.display = '';
    document.getElementById('lQCnt').textContent = sessionQueue.length;
    document.getElementById('lQList').innerHTML = sessionQueue.slice(0,12).map(r => {
      const tb = r.tardanza===null ? '' :
        r.tardanza<=0 ? `<span class="badge badge-green" style="font-size:10px;">✓ ${Math.abs(r.tardanza)}m antes</span>` :
                        `<span class="badge badge-red" style="font-size:10px;">+${r.tardanza}m tarde</span>`;
      const hb = r.hs ? `<span class="badge badge-cyan" style="font-size:10px;">${fmtHs(r.hs)}</span>` : '';
      const planTxt = r.plan ? `<span style="font-size:11px;color:rgba(198,201,215,.5);">${r.plan.entrada}</span>` : '';
      const fechaTxt = r.fecha !== today() ? `<span style="font-size:10px;color:rgba(198,201,215,.35);">${fmtDate(r.fecha)}</span>` : '';
      return `<div class="queue-row">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="color:${areaColor(r.area)};font-size:11px;font-weight:800;">${r.area.split(' ')[0]}</span>
          <span style="font-weight:700;font-size:14px;">${r.nombre}</span>
          ${fechaTxt}${planTxt}
          <span style="font-size:13px;color:rgba(198,201,215,.6);">${r.ent}${r.sal?' → '+r.sal:''}</span>
          ${hb}${tb}
        </div>
        <span style="color:var(--color-success-text);font-size:15px;flex-shrink:0;">✓</span>
      </div>`;
    }).join('');
  }

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

  return { init, loadPersonal, onPersonaChange, updCalc, guardar, loginAdmin, showAdminLogin, cambiarFecha };

})();

window.lLoadPers      = ()    => Carga.loadPersonal();
window.lOnPersona     = ()    => Carga.onPersonaChange();
window.lUpdCalc       = ()    => Carga.updCalc();
window.lGuardar       = ()    => Carga.guardar();
window.loginAdmin     = ()    => Carga.loginAdmin();
window.showAdminLogin = ()    => Carga.showAdminLogin();
window.lCambiarFecha  = (dir) => Carga.cambiarFecha(dir);

document.addEventListener('DOMContentLoaded', () => Carga.init());