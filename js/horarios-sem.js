// js/horarios-sem.js — v4 (Flex + Guardia)

const HorariosSem = (() => {

  const DIAS      = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'];
  const DIA_LBL   = {lunes:'Lunes',martes:'Martes',miercoles:'Miércoles',jueves:'Jueves',viernes:'Viernes',sabado:'Sábado',domingo:'Domingo'};
  const DIA_CORTO = {lunes:'Lun',martes:'Mar',miercoles:'Mié',jueves:'Jue',viernes:'Vie',sabado:'Sáb',domingo:'Dom'};
  const AREAS     = ['ADMINISTRACION','COMERCIAL','RECURSOS HUMANOS','MARKETING','ACADEMICO / GT','INNOVACION Y DESARROLLO','MAESTRANZA'];

  let semActual = '';
  let semViendo = '';
  let allData   = [];
  let regsReal  = [];
  let editArea  = null;
  let editRows  = [];
  let editRowId = null;

  // ─── INIT ───
  function init() {
    semActual = getLunes(today(), 0);
    semViendo = semActual;
    load();
  }

  // ─── CARGA ───
  async function load() {
    const desde = semViendo;
    const hasta = getSabado(desde);

    ['hsKP','hsKA','hsKE','hsKH'].forEach(id => {
      const el = document.getElementById(id); if (el) el.textContent = '…';
    });
    const grid = document.getElementById('hsemAreaGrid');
    if (grid) grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:rgba(198,201,215,.3);"><span class="sp"></span></div>';

    const [{ data: hsData }, { data: rdData }] = await Promise.all([
      SB.from('horarios_semanales').select('*').eq('semana_desde', desde).order('area'),
      SB.from('registros').select('*').gte('fecha', desde).lte('fecha', hasta),
    ]);

    allData  = hsData  || [];
    regsReal = rdData  || [];

    _renderKPIs();
    _renderNav();
    _renderAreaGrid();
  }

  // ─── KPIs ───
  function _renderKPIs() {
    const personas = _flatPersonas(allData);
    const areas    = new Set(personas.map(p => p.area)).size;

    let totalHs = 0, conExtra = 0;
    const byNombre = {};
    personas.forEach(p => {
      const hs = _hsPersona(p);
      totalHs += hs;
      if (!byNombre[p.nombre]) byNombre[p.nombre] = { plan: 0, real: 0 };
      byNombre[p.nombre].plan += hs;
    });
    regsReal.forEach(r => {
      if (!r.hora_entrada || !r.hora_salida || r.turno === 'Flex' || r.turno === 'Guardia') return;
      const h = calcHs(r.hora_entrada.slice(0,5), r.hora_salida.slice(0,5));
      if (h && byNombre[r.nombre]) byNombre[r.nombre].real += h;
    });
    const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    s('hsKP', personas.length);
    s('hsKA', areas);
    s('hsKH', totalHs > 0 ? fmtHs(totalHs) : '—');

    const conEspecial = personas.filter(p =>
      DIAS.some(d => p[d+'_tipo']==='flex' || p[d+'_tipo']==='guardia')
    ).length;
    s('hsKE', conEspecial || '—');
  }

  // ─── NAV BAR ───
  function _renderNav() {
    const nav = document.getElementById('hsemNavBar');
    if (!nav) return;

    const limAnt   = getLunes(semActual, -4);
    const limPost  = getLunes(semActual,  1);
    const esActual = semViendo === semActual;
    const esAnt    = semViendo === getLunes(semActual, -1);
    const puedeAnt = semViendo > limAnt;
    const puedeSig = semViendo < limPost;

    const semD   = new Date(semViendo+'T12:00:00');
    const semH   = new Date(getSabado(semViendo)+'T12:00:00');
    const meses  = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
    const label  = `${semD.getDate()} al ${semH.getDate()} de ${meses[semH.getMonth()]} ${semH.getFullYear()}`;

    nav.innerHTML = `
      <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;">
        <button class="tab-btn ${esActual?'active':''}" onclick="HorariosSem.irSemana(0)" style="font-size:12px;padding:6px 14px;">📅 Esta semana</button>
        <button class="tab-btn ${esAnt?'active':''}"    onclick="HorariosSem.irSemana(-1)" style="font-size:12px;padding:6px 14px;">← Semana ant.</button>
        <button class="wnav-sm ${puedeAnt?'':'op30'}" onclick="HorariosSem.movSem(-1)" ${puedeAnt?'':'disabled'}>‹</button>
        <span class="week-pill">📅 ${label}</span>
        <button class="wnav-sm ${puedeSig?'':'op30'}" onclick="HorariosSem.movSem(1)" ${puedeSig?'':'disabled'}>›</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:11px;color:rgba(198,201,215,.4);">Ir a fecha:</span>
          <input class="inp" type="date" style="padding:5px 10px;font-size:12px;max-width:150px;"
            onchange="HorariosSem.irFecha(this.value)"/>
        </div>
        <button class="btn btn-gold no-print" onclick="HorariosSem.exportCSV()" style="font-size:12px;padding:6px 14px;">⬇ CSV</button>
      </div>`;
  }

  function movSem(dir) {
    const lim  = dir < 0 ? getLunes(semActual,-4) : getLunes(semActual,1);
    const nueva = getLunes(semViendo, dir);
    if (dir < 0 && nueva < lim) return;
    if (dir > 0 && nueva > lim) return;
    semViendo = nueva; load();
  }

  function irSemana(off) { semViendo = getLunes(semActual, off); load(); }

  function irFecha(dateStr) {
    if (!dateStr) return;
    const lunes  = getLunes(dateStr, 0);
    const limAnt = getLunes(semActual, -4);
    if (lunes < limAnt) {
      if (!confirm(`Fecha fuera del rango rápido (más de 1 mes).\n¿Cargar igual? (puede ser más lento)`)) return;
    }
    semViendo = lunes; load();
  }

  // ─── FLAT PERSONAS ───
  function _flatPersonas(data) {
    const out = [];
    data.forEach(row => {
      const hs = row.horarios;
      if (!Array.isArray(hs) || !hs.length) return;
      hs.forEach(h => {
        const p = { _rowId:row.id, area:row.area, nombre:h.nombre, rol:h.rol||'', obs:h.obs||'', obsArea:row.observaciones||'' };
        DIAS.forEach(d => {
          p[d+'_e']    = h[d]?.e    || '';
          p[d+'_s']    = h[d]?.s    || '';
          p[d+'_e2']   = h[d]?.e2   || '';
          p[d+'_s2']   = h[d]?.s2   || '';
          p[d+'_tipo'] = h[d]?.tipo  || 'normal';
        });
        out.push(p);
      });
    });
    return out;
  }

  function _hsPersona(p) {
    let t=0;
    DIAS.forEach(d=>{
      const tipo = p[d+'_tipo'] || 'normal';
      if (tipo === 'guardia') { t += 1; return; }
      if (tipo === 'flex')    return;
      const h1=calcHs(p[d+'_e'],p[d+'_s']);
      const h2=calcHs(p[d+'_e2'],p[d+'_s2']);
      if(h1)t+=h1; if(h2)t+=h2;
    });
    return t;
  }

  // ─── GRID DE ÁREAS ───
  function _renderAreaGrid() {
    const grid = document.getElementById('hsemAreaGrid');
    if (!grid) return;

    const byArea = {};
    allData.forEach(row => { byArea[row.area] = row; });

    grid.innerHTML = AREAS.map(area => {
      const row      = byArea[area];
      const col      = areaColor(area);
      const personas = row ? _flatPersonas([row]) : [];
      const totalHs  = personas.reduce((a,p) => a+_hsPersona(p), 0);
      const cargado  = !!row;

      const flexCount    = personas.filter(p => DIAS.some(d => p[d+'_tipo']==='flex')).length;
      const guardiaCount = personas.filter(p => DIAS.some(d => p[d+'_tipo']==='guardia')).length;

      const persHtml = personas.slice(0,5).map(p => {
        const hs = _hsPersona(p);
        const refTipo = DIAS.map(d=>p[d+'_tipo']).find(t=>t&&t!=='normal') || 'normal';
        const refE = DIAS.map(d=>p[d+'_e']).find(x=>x) || '';
        const refS = DIAS.map(d=>p[d+'_s']).find(x=>x) || '';
        let horStr;
        if (refTipo==='flex')         horStr = `<span style="font-size:10px;color:var(--one-purple);">🔄 Flex</span>`;
        else if (refTipo==='guardia') horStr = `<span style="font-size:10px;color:var(--one-gold);">🛡 Guardia</span>`;
        else horStr = refE ? `<span style="font-size:10px;color:rgba(198,201,215,.4);">${refE}${refS?' → '+refS:''}</span>` : '';
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(198,201,215,.05);">
          <div>
            <span style="font-size:12px;font-weight:700;">${p.nombre}</span>
            <span style="margin-left:6px;">${horStr}</span>
          </div>
          <span style="font-size:11px;color:var(--one-cyan);font-weight:700;flex-shrink:0;margin-left:8px;">${hs>0?fmtHs(hs):'—'}</span>
        </div>`;
      }).join('');

      const masHtml = personas.length > 5
        ? `<div style="font-size:11px;color:rgba(198,201,215,.35);padding-top:4px;">+${personas.length-5} más...</div>` : '';

      const badge = cargado
        ? `<span style="background:rgba(34,197,94,.14);border:1px solid rgba(34,197,94,.3);color:var(--color-success-text);padding:2px 9px;border-radius:999px;font-size:10px;font-weight:800;">✓ ${personas.length} personas</span>`
        : `<span style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.22);color:var(--color-danger-text);padding:2px 9px;border-radius:999px;font-size:10px;font-weight:800;">Sin cargar</span>`;

      const extraBadges = [
        flexCount    ? `<span style="background:rgba(167,139,250,.14);border:1px solid rgba(167,139,250,.24);color:var(--one-purple);padding:2px 8px;border-radius:999px;font-size:9px;font-weight:800;">🔄 ${flexCount} Flex</span>` : '',
        guardiaCount ? `<span style="background:rgba(228,199,106,.14);border:1px solid rgba(228,199,106,.24);color:var(--one-gold);padding:2px 8px;border-radius:999px;font-size:9px;font-weight:800;">🛡 ${guardiaCount} Guardia</span>` : '',
      ].filter(Boolean).join(' ');

      return `<div class="area-card" onclick="HorariosSem.openAreaModal('${area}')">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px;gap:8px;">
          <div>
            <div style="font-size:13px;font-weight:800;color:${col};">${area}</div>
            ${cargado?`<div style="font-size:11px;color:rgba(198,201,215,.4);margin-top:1px;">Total: <strong style="color:var(--one-cyan);">${fmtHs(totalHs)}</strong></div>`:''}
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;">
            ${badge}
            ${extraBadges ? `<div style="display:flex;gap:3px;flex-wrap:wrap;justify-content:flex-end;margin-top:3px;">${extraBadges}</div>` : ''}
            <span style="font-size:9px;color:rgba(198,201,215,.28);">${cargado?'Click para editar →':'Click para cargar →'}</span>
          </div>
        </div>
        <div style="border-top:1px solid rgba(198,201,215,.07);padding-top:8px;min-height:52px;">
          ${cargado ? (persHtml+masHtml) : '<div style="font-size:12px;color:rgba(198,201,215,.25);padding:4px 0;">No hay horarios para esta semana</div>'}
        </div>
        ${row?.observaciones?`<div style="margin-top:6px;font-size:11px;color:rgba(198,201,215,.38);padding-top:6px;border-top:1px solid rgba(198,201,215,.06);">📝 ${row.observaciones}</div>`:''}
      </div>`;
    }).join('');

    const tablaWrap = document.getElementById('hsemTablaWrap');
    if (tablaWrap && tablaWrap.style.display !== 'none') _renderTabla();
  }

  // ─── MODAL EDITOR ───
  async function openAreaModal(area) {
    editArea  = area;
    editRowId = null;
    editRows  = [];

    const existing = allData.find(r => r.area === area);
    editRowId = existing?.id || null;

    const { data: personal } = await SB
      .from('personal').select('nombre,rol')
      .eq('area', area).eq('activo', true).order('nombre');

    if (!personal?.length) { showToast('Sin personal activo en esta área','err'); return; }

    const savedMap = {};
    (existing?.horarios || []).forEach(h => savedMap[h.nombre] = h);

    editRows = personal.map(p => {
      const sv = savedMap[p.nombre];
      const r  = { nombre:p.nombre, rol:p.rol||'', obs:sv?.obs||'', split:false };
      DIAS.forEach(d => {
        r[d+'_e']     = sv?.[d]?.e    || '';
        r[d+'_s']     = sv?.[d]?.s    || '';
        r[d+'_e2']    = sv?.[d]?.e2   || '';
        r[d+'_s2']    = sv?.[d]?.s2   || '';
        r[d+'_tipo']  = sv?.[d]?.tipo  || 'normal';
        r[d+'_split'] = !!(sv?.[d]?.e2 || sv?.[d]?.s2);
      });
      r.split = DIAS.some(d => r[d+'_e2']);
      return r;
    });

    const { data: antRow } = await SB
      .from('horarios_semanales').select('*')
      .eq('area', area).eq('semana_desde', getLunes(semViendo,-1))
      .maybeSingle();

    const col   = areaColor(area);
    const desde = semViendo;
    const hasta = getSabado(desde);

    document.getElementById('mhAreaTitle').innerHTML = `<span style="color:${col};">${area}</span>`;
    document.getElementById('mhSemLabel').textContent = `${_dd(desde)} al ${_dd(hasta)}`;
    document.getElementById('mhAreaObs').value = existing?.observaciones || '';

    const btnAnt = document.getElementById('btnCopiarAnt');
    if (btnAnt) {
      const hay = antRow?.horarios?.length > 0;
      btnAnt.style.display = hay ? '' : 'none';
      btnAnt._antData = hay ? antRow.horarios : null;
    }

    _modalView = 'dias';
    _renderEditCards();
    document.getElementById('mHsem').style.display = '';
  }

  function _dd(s) {
    if (!s) return '';
    const [y,m,d] = s.split('-');
    return `${d}/${m}/${y}`;
  }

  function _diasArr(lunes) {
    return Array.from({length:7}, (_,i) => {
      const d = new Date(lunes+'T12:00:00');
      d.setDate(d.getDate()+i);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    });
  }

  let _modalView = 'dias';
  let _modalDia  = 0;

  function _renderEditCards() {
    if (_modalView === 'dias') _renderDiasList();
    else                        _renderDiaDetail(_modalDia);
  }

  function _renderDiasList() {
    const cont = document.getElementById('mhPersonasBody');
    if (!cont) return;
    const fArr = _diasArr(semViendo);

    const rows = DIAS.map((d, di) => {
      const conH    = editRows.filter(r => r[d+'_e'] || r[d+'_tipo']==='flex' || r[d+'_tipo']==='guardia');
      const primerH = conH[0];
      const todosIgual = conH.length > 1 && conH.every(r =>
        r[d+'_tipo'] === conH[0][d+'_tipo'] &&
        r[d+'_e'] === conH[0][d+'_e'] &&
        r[d+'_s'] === conH[0][d+'_s']
      );

      let resumen;
      if (conH.length === 0) {
        resumen = `<span style="font-size:12px;color:rgba(198,201,215,.28);">Sin horario</span>`;
      } else {
        const tipo0 = primerH[d+'_tipo'] || 'normal';
        let horStr;
        if (tipo0==='flex')         horStr = `<span style="color:var(--one-purple);font-weight:800;font-size:13px;">🔄 Flex</span>`;
        else if (tipo0==='guardia') horStr = `<span style="color:var(--one-gold);font-weight:800;font-size:13px;">🛡 Guardia 1h</span>`;
        else horStr = `<span style="font-size:13px;font-weight:800;color:var(--one-cyan);">${primerH[d+'_e']}${primerH[d+'_s']?' → '+primerH[d+'_s']:''}</span>`;
        resumen = `${horStr}
          ${todosIgual
            ? `<span style="font-size:11px;color:rgba(198,201,215,.4);margin-left:8px;">todos igual</span>`
            : `<span style="font-size:11px;color:rgba(198,201,215,.4);margin-left:6px;">${conH.length}/${editRows.length} cargados</span>`}`;
      }

      const statusDot = conH.length === 0
        ? `<span style="width:8px;height:8px;border-radius:50%;background:rgba(239,68,68,.4);display:inline-block;flex-shrink:0;"></span>`
        : conH.length === editRows.length
          ? `<span style="width:8px;height:8px;border-radius:50%;background:rgba(34,197,94,.55);display:inline-block;flex-shrink:0;"></span>`
          : `<span style="width:8px;height:8px;border-radius:50%;background:rgba(228,199,106,.55);display:inline-block;flex-shrink:0;"></span>`;

      return `<div onclick="HorariosSem._goDia(${di})"
        style="display:flex;align-items:center;justify-content:space-between;padding:13px 18px;border:1px solid rgba(198,201,215,.09);border-radius:10px;cursor:pointer;background:rgba(255,255,255,.03);transition:all .15s;margin-bottom:7px;"
        onmouseover="this.style.borderColor='rgba(107,225,227,.3)';this.style.background='rgba(107,225,227,.04)'"
        onmouseout="this.style.borderColor='rgba(198,201,215,.09)';this.style.background='rgba(255,255,255,.03)'">
        <div style="display:flex;align-items:center;gap:14px;">
          ${statusDot}
          <div>
            <span style="font-size:15px;font-weight:800;">${DIA_LBL[d]}</span>
            <span style="font-size:11px;color:rgba(198,201,215,.4);margin-left:8px;">${_ddShort(fArr[di])}</span>
          </div>
          <div>${resumen}</div>
        </div>
        <span style="font-size:16px;color:rgba(198,201,215,.35);">›</span>
      </div>`;
    }).join('');

    cont.innerHTML = rows;
  }

  function _renderDiaDetail(di) {
    const cont = document.getElementById('mhPersonasBody');
    if (!cont) return;
    const d    = DIAS[di];
    const fArr = _diasArr(semViendo);

    const personaRows = editRows.map((r, i) => {
      const tipo  = r[d+'_tipo'] || 'normal';
      const spDia = !!(r[d+'_split'] || r[d+'_e2'] || r[d+'_s2']);

      const tipoSelector = `
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px;">
          <button class="tipo-btn ${tipo==='normal'?'tipo-active-cyan':''}" onclick="HorariosSem._setTipo(${i},'${d}','normal')">🕐 Fijo</button>
          <button class="tipo-btn ${tipo==='flex'?'tipo-active-purple':''}" onclick="HorariosSem._setTipo(${i},'${d}','flex')">🔄 Flex</button>
          <button class="tipo-btn ${tipo==='guardia'?'tipo-active-gold':''}" onclick="HorariosSem._setTipo(${i},'${d}','guardia')">🛡 Guardia</button>
        </div>`;

      let contenido;
      if (tipo === 'flex') {
        contenido = `<div style="padding:10px 14px;background:rgba(167,139,250,.07);border:1px solid rgba(167,139,250,.2);border-radius:8px;font-size:12px;color:var(--one-purple);">🔄 <strong>Horario Flex</strong> — Sin horario fijo.</div>`;
      } else if (tipo === 'guardia') {
        contenido = `<div style="padding:10px 14px;background:rgba(228,199,106,.07);border:1px solid rgba(228,199,106,.2);border-radius:8px;font-size:12px;color:var(--one-gold);">🛡 <strong>Guardia</strong> — 1 hora computable.</div>`;
      } else {
        contenido = `
          <div style="display:grid;grid-template-columns:1fr 18px 1fr;align-items:center;gap:6px;">
            <input class="ht-edit ${r[d+'_e']?'v':''}" type="text" maxlength="5" placeholder="09:00" value="${r[d+'_e']}"
              oninput="HorariosSem._uf(${i},'${d}_e',this)" onblur="HorariosSem._ff(${i},'${d}_e',this)"/>
            <span style="font-size:13px;color:rgba(198,201,215,.3);text-align:center;">→</span>
            <input class="ht-edit ${r[d+'_s']?'v':''}" type="text" maxlength="5" placeholder="17:00" value="${r[d+'_s']}"
              oninput="HorariosSem._uf(${i},'${d}_s',this)" onblur="HorariosSem._ff(${i},'${d}_s',this)"/>
          </div>
          ${spDia ? `
          <div style="margin-top:6px;padding-top:6px;border-top:1px dashed rgba(228,199,106,.25);">
            <div style="font-size:9px;color:rgba(228,199,106,.6);font-weight:800;margin-bottom:4px;">✂ 2° TURNO</div>
            <div style="display:grid;grid-template-columns:1fr 18px 1fr;align-items:center;gap:6px;">
              <input class="ht-edit ht-gold ${r[d+'_e2']?'v':''}" type="text" maxlength="5" placeholder="—" value="${r[d+'_e2']}"
                oninput="HorariosSem._uf(${i},'${d}_e2',this)" onblur="HorariosSem._ff(${i},'${d}_e2',this)"/>
              <span style="font-size:13px;color:rgba(228,199,106,.28);text-align:center;">→</span>
              <input class="ht-edit ht-gold ${r[d+'_s2']?'v':''}" type="text" maxlength="5" placeholder="—" value="${r[d+'_s2']}"
                oninput="HorariosSem._uf(${i},'${d}_s2',this)" onblur="HorariosSem._ff(${i},'${d}_s2',this)"/>
            </div>
          </div>` : ''}
          <button class="btn-split-sm ${spDia?'on':''}" onclick="HorariosSem._tsDia(${i},'${d}')" style="font-size:11px;margin-top:4px;">
            ${spDia?'✂ Quitar 2° turno':'✂ Agregar 2° turno'}
          </button>`;
      }

      let hsDay = '—';
      if (tipo === 'guardia') hsDay = '1h';
      else if (tipo === 'normal') {
        const h1 = calcHs(r[d+'_e'], r[d+'_s']);
        const h2 = calcHs(r[d+'_e2'], r[d+'_s2']);
        const tot = (h1||0)+(h2||0);
        hsDay = tot > 0 ? fmtHs(tot) : '—';
      }

      return `<div id="mh-member-${i}" style="padding:12px 16px;border-bottom:1px solid rgba(198,201,215,.06);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <div>
            <span style="font-size:13px;font-weight:800;">${r.nombre}</span>
            <span style="font-size:11px;color:rgba(198,201,215,.4);margin-left:6px;">${r.rol||''}</span>
          </div>
          <span style="font-size:12px;font-weight:800;color:var(--one-cyan);">${hsDay}</span>
        </div>
        ${tipoSelector}
        ${contenido}
      </div>`;
    }).join('');

    const daySidebar = DIAS.map((dd, ddi) => {
      const isActive = ddi === di;
      const conH = editRows.filter(r => r[dd+'_e'] || r[dd+'_tipo']==='flex' || r[dd+'_tipo']==='guardia');
      const dot = conH.length === 0 ? 'rgba(239,68,68,.4)'
        : conH.length === editRows.length ? 'rgba(34,197,94,.55)' : 'rgba(228,199,106,.55)';
      return `<button onclick="HorariosSem._goDia(${ddi})"
        style="width:100%;padding:8px 6px;border-radius:8px;border:none;cursor:pointer;transition:all .15s;text-align:center;
          background:${isActive?'rgba(167,139,250,.18)':'transparent'};
          border:1px solid ${isActive?'rgba(167,139,250,.45)':'transparent'};">
        <div style="width:6px;height:6px;border-radius:50%;background:${dot};margin:0 auto 4px;"></div>
        <div style="font-size:9px;font-weight:800;letter-spacing:.05em;color:${isActive?'#a78bfa':'rgba(198,201,215,.45)'};text-transform:uppercase;">${DIA_CORTO[dd]}</div>
        <div style="font-size:8px;color:${isActive?'rgba(167,139,250,.7)':'rgba(198,201,215,.25)'};">${_ddShort(fArr[ddi])}</div>
      </button>`;
    }).join('');

    const memberBar = editRows.map((r, i) => {
      const tipo = r[d+'_tipo'] || 'normal';
      const tCol = tipo==='flex' ? '#a78bfa' : tipo==='guardia' ? '#e4c76a' : (r[d+'_e'] ? '#6be1e3' : 'rgba(198,201,215,.28)');
      const initials = r.nombre.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
      const firstName = r.nombre.split(' ')[0];
      return `<button onclick="document.getElementById('mh-member-${i}').scrollIntoView({behavior:'smooth',block:'nearest'})"
        style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:4px;background:none;border:none;cursor:pointer;padding:0;transition:transform .15s;"
        onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">
        <div style="width:40px;height:40px;border-radius:50%;border:2px solid ${tCol};background:${tCol}18;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:${tCol};">${initials}</div>
        <span style="font-size:9px;color:rgba(198,201,215,.5);white-space:nowrap;max-width:44px;overflow:hidden;text-overflow:ellipsis;">${firstName}</span>
      </button>`;
    }).join('');

    cont.innerHTML = `
      <style>
        .tipo-btn{background:rgba(255,255,255,.06);border:1px solid rgba(198,201,215,.18);color:rgba(198,201,215,.6);padding:4px 10px;border-radius:999px;font-family:var(--font-title);font-size:11px;font-weight:700;cursor:pointer;transition:all .18s;}
        .tipo-btn:hover{background:rgba(255,255,255,.11);}
        .tipo-active-cyan{background:rgba(107,225,227,.15)!important;border-color:rgba(107,225,227,.45)!important;color:var(--one-cyan)!important;}
        .tipo-active-purple{background:rgba(167,139,250,.15)!important;border-color:rgba(167,139,250,.45)!important;color:var(--one-purple)!important;}
        .tipo-active-gold{background:rgba(228,199,106,.15)!important;border-color:rgba(228,199,106,.45)!important;color:var(--one-gold)!important;}
      </style>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <button onclick="HorariosSem._backDias()" style="background:rgba(255,255,255,.07);border:1px solid rgba(198,201,215,.18);color:rgba(198,201,215,.8);padding:6px 14px;border-radius:999px;font-family:var(--font-title);font-size:12px;font-weight:700;cursor:pointer;flex-shrink:0;">‹ Volver</button>
        <div>
          <span style="font-size:16px;font-weight:800;">${DIA_LBL[d]}</span>
          <span style="font-size:13px;color:rgba(198,201,215,.45);margin-left:8px;">${_ddShort(fArr[di])}</span>
        </div>
      </div>
      <div style="margin-bottom:12px;padding:8px 12px;background:rgba(167,139,250,.06);border:1px solid rgba(167,139,250,.18);border-radius:10px;">
        <div style="font-size:9px;font-weight:800;letter-spacing:.1em;color:rgba(167,139,250,.55);text-transform:uppercase;margin-bottom:8px;">Miembros del área</div>
        <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;scrollbar-width:thin;scrollbar-color:rgba(167,139,250,.3) transparent;">${memberBar}</div>
      </div>
      <div style="display:flex;gap:8px;">
        <div style="display:flex;flex-direction:column;gap:3px;flex-shrink:0;width:48px;padding:8px 4px;background:rgba(167,139,250,.05);border:1px solid rgba(167,139,250,.18);border-radius:10px;">${daySidebar}</div>
        <div style="flex:1;background:rgba(255,255,255,.03);border:1px solid rgba(198,201,215,.09);border-radius:10px;overflow:hidden;min-width:0;">${personaRows}</div>
      </div>`;
  }

  function _setTipo(i, d, tipo) {
    editRows[i][d+'_tipo'] = tipo;
    if (tipo !== 'normal') {
      editRows[i][d+'_e'] = ''; editRows[i][d+'_s'] = '';
      editRows[i][d+'_e2'] = ''; editRows[i][d+'_s2'] = '';
    }
    _renderEditCards();
  }

  function _goDia(di)   { _modalView = 'dia-X'; _modalDia = di; _renderEditCards(); }
  function _backDias()  { _modalView = 'dias'; _renderEditCards(); }
  function _ddShort(s)  { if(!s)return''; const[y,m,d]=s.split('-'); return`${d}/${m}`; }

  function _tsDia(i, d) {
    const activo = editRows[i][d+'_split'];
    if (activo) {
      editRows[i][d+'_split'] = false;
      editRows[i][d+'_e2'] = ''; editRows[i][d+'_s2'] = '';
    } else {
      editRows[i][d+'_split'] = true;
    }
    _renderEditCards();
  }

  function _nh(raw) {
    if (!raw||!raw.trim()) return '';
    let s = raw.trim().replace(/[.,]/,':');
    let h, m;
    if (s.includes(':')) [h,m]=s.split(':');
    else if (s.length<=2) { h=s; m='0'; }
    else { h=s.slice(0,s.length-2); m=s.slice(-2); }
    h=parseInt(h,10); m=parseInt(m,10);
    if (isNaN(h)||isNaN(m)||h<0||h>23||m<0||m>59) return '';
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  }

  function _uf(i,k,inp) {
    editRows[i][k]=inp.value;
    inp.classList.remove('err'); inp.classList.toggle('v',!!inp.value.trim());
    _ut(i);
  }
  function _ff(i,k,inp) {
    const n=_nh(inp.value); editRows[i][k]=n; inp.value=n;
    inp.classList.remove('err'); inp.classList.toggle('v',!!n);
    _ut(i);
  }
  function _uo(i,v) { editRows[i].obs=v; }
  function _ut(i) {
    const el=document.getElementById('mhTot'+i);
    if(el) el.textContent=_calcTot(editRows[i])>0?fmtHs(_calcTot(editRows[i])):'—';
  }
  function _calcTot(r) {
    let t=0;
    DIAS.forEach(d=>{
      const tipo = r[d+'_tipo'] || 'normal';
      if (tipo === 'guardia') { t += 1; return; }
      if (tipo === 'flex') return;
      const h1=calcHs(r[d+'_e'],r[d+'_s']);
      const h2=calcHs(r[d+'_e2'],r[d+'_s2']);
      if(h1)t+=h1; if(h2)t+=h2;
    });
    return t;
  }

  function copiarAntModal() {
    const btn=document.getElementById('btnCopiarAnt');
    if(!btn?._antData) return;
    const antMap={}; btn._antData.forEach(h=>antMap[h.nombre]=h);
    let c=0;
    editRows.forEach(r=>{
      const a=antMap[r.nombre]; if(!a)return;
      DIAS.forEach(d=>{
        r[d+'_e']    = a[d]?.e    || '';
        r[d+'_s']    = a[d]?.s    || '';
        r[d+'_e2']   = a[d]?.e2   || '';
        r[d+'_s2']   = a[d]?.s2   || '';
        r[d+'_tipo'] = a[d]?.tipo  || 'normal';
      });
      if(a.obs) r.obs=a.obs;
      r.split=DIAS.some(d=>r[d+'_e2']);
      c++;
    });
    _renderEditCards();
    showToast(`✓ ${c} horario(s) copiados`);
  }

  // ─── GUARDAR ÁREA ───
  async function saveArea() {
    if (!editArea||!semViendo) return;
    const btn=document.getElementById('btnSHsem');
    btn.disabled=true; btn.textContent='Guardando...';

    const horarios=editRows.map(r=>{
      const obj={nombre:r.nombre,rol:r.rol,obs:r.obs||''};
      DIAS.forEach(d=>{
        obj[d]={
          e:r[d+'_e']||'', s:r[d+'_s']||'',
          e2:r[d+'_e2']||'', s2:r[d+'_s2']||'',
          tipo:r[d+'_tipo']||'normal',
        };
      });
      return obj;
    });

    const payload={
      semana_desde: semViendo,
      semana_hasta: getSabado(semViendo),
      area: editArea,
      observaciones: document.getElementById('mhAreaObs').value.trim()||null,
      horarios,
    };

    let error;
    if (editRowId) {
      ({error}=await SB.from('horarios_semanales').update(payload).eq('id',editRowId));
    } else {
      const res=await SB.from('horarios_semanales').insert(payload).select('id').single();
      error=res.error;
      if(!error&&res.data?.id) editRowId=res.data.id;
    }

    btn.disabled=false; btn.textContent='✓ Guardar área completa';
    if (error) { showToast('Error: '+error.message,'err'); return; }

    await _sincronizarRegistros(editArea, semViendo, horarios);
    showToast(`✓ Horarios de ${editArea} guardados`);

    const fuera = esFueraDeTerm(semViendo);
    await logActividad(
      'horario_semanal_guardado', editArea, null,
      `Horario semanal ${editRowId?'actualizado':'creado'} para ${editArea} — semana ${semViendo}`,
      { semana:semViendo, personas:editRows.length, accion:editRowId?'actualizado':'creado' },
      fuera
    );

    closeModal();
    load();
  }

  // ─── SINCRONIZAR TURNO EN REGISTROS ───
  async function _sincronizarRegistros(area, semDesde, horarios) {
    const semHasta = getSabado(semDesde);
    const { data: regs } = await SB.from('registros')
      .select('id, nombre, fecha, turno')
      .eq('area', area).gte('fecha', semDesde).lte('fecha', semHasta);

    if (!regs?.length) return;

    const DIAS_SEM = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];
    const horariosMap = {};
    horarios.forEach(h => horariosMap[h.nombre] = h);

    const updates = [];
    regs.forEach(reg => {
      const p = horariosMap[reg.nombre];
      if (!p) return;
      const dKey = DIAS_SEM[new Date(reg.fecha + 'T12:00:00').getDay()];
      const dia  = p[dKey];
      if (!dia) return;
      const tipo = dia.tipo || 'normal';
      let nuevoTurno;
      if (tipo === 'flex')         nuevoTurno = 'Flex';
      else if (tipo === 'guardia') nuevoTurno = 'Guardia';
      else {
        if (!dia.e) return;
        nuevoTurno = dia.e + (dia.s ? ' → ' + dia.s : '');
        if (dia.e2) nuevoTurno += ' | ' + dia.e2 + (dia.s2 ? ' → ' + dia.s2 : '');
      }
      if (reg.turno !== nuevoTurno) updates.push({ id: reg.id, turno: nuevoTurno });
    });

    if (updates.length) {
      await Promise.all(updates.map(u => SB.from('registros').update({ turno: u.turno }).eq('id', u.id)));
      showToast(`✓ Horarios guardados · ${updates.length} registro(s) sincronizado(s)`);
    }
  }

  function closeModal() {
    document.getElementById('mHsem').style.display='none';
    editArea=null; editRows=[]; editRowId=null;
  }

  // ─── ELIMINAR ÁREA ───
  async function delArea() {
    if (!editRowId) { showToast('No hay datos para eliminar','err'); return; }
    if (!confirm(`¿Eliminar los horarios de "${editArea}" para esta semana?`)) return;
    const{error}=await SB.from('horarios_semanales').delete().eq('id',editRowId);
    if(error){showToast('Error','err');return;}
    showToast(`Horarios de ${editArea} eliminados`);

    await logActividad(
      'horario_semanal_eliminado', editArea, null,
      `Horario semanal eliminado para ${editArea} — semana ${semViendo}`,
      { semana:semViendo, personas:editRows.length },
      esFueraDeTerm(semViendo)
    );

    closeModal(); load();
  }

  // ─── TABLA DETALLADA ───
  function _renderTabla() {
    const tbody=document.getElementById('tbHsem');
    if(!tbody) return;
    const personas=_flatPersonas(allData);
    if(!personas.length){
      tbody.innerHTML=`<tr><td colspan="12" style="text-align:center;padding:30px;color:rgba(198,201,215,.3);">No hay horarios para esta semana</td></tr>`;
      return;
    }
    tbody.innerHTML=personas.map(p=>{
      const col=areaColor(p.area);
      const tp=_hsPersona(p);
      const re=regsReal.filter(r=>r.nombre===p.nombre&&r.turno!=='Flex'&&r.turno!=='Guardia')
        .reduce((a,r)=>{const h=calcHs(r.hora_entrada?.slice(0,5),r.hora_salida?.slice(0,5));return h?a+h:a;},0);
      const extra=re>tp&&tp>0?re-tp:0;
      const eb=extra>0?`<span class="badge badge-gold" style="font-size:10px;margin-left:4px;">+${fmtHs(extra)}</span>`:'';
      const fd=(e,s,tipo)=>{
        if(tipo==='flex')    return `<span style="color:var(--one-purple);font-size:11px;font-weight:700;">🔄 Flex</span>`;
        if(tipo==='guardia') return `<span style="color:var(--one-gold);font-size:11px;font-weight:700;">🛡 1h</span>`;
        if(!e) return '<span style="color:rgba(198,201,215,.2);font-size:11px;">—</span>';
        return s?`<b style="font-size:12px;">${e}</b><span style="color:rgba(198,201,215,.35);font-size:10px;"> → ${s}</span>`
                :`<b style="font-size:12px;">${e}</b>`;
      };

      let obsCell;
      if (p.obs) {
        const preview = p.obs.length > 18 ? p.obs.slice(0,18)+'…' : p.obs;
        const safe    = p.obs.replace(/\\/g,'\\\\').replace(/`/g,'\\`');
        obsCell = `<div style="display:flex;align-items:center;gap:5px;">
          <span style="font-size:11px;color:rgba(198,201,215,.45);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:90px;">${preview}</span>
          <button onclick="HorariosSem._showObs(\`${safe}\`)" title="Ver completo"
            style="flex-shrink:0;background:rgba(107,225,227,.12);border:1px solid rgba(107,225,227,.25);color:#6be1e3;border-radius:6px;padding:2px 7px;font-size:10px;cursor:pointer;font-weight:700;line-height:1.5;">👁</button>
        </div>`;
      } else {
        obsCell = `<span style="color:rgba(198,201,215,.2);font-size:11px;">—</span>`;
      }

      return`<tr>
        <td><span style="color:${col};font-weight:800;font-size:11px;">${p.area.split(' ')[0]}</span></td>
        <td style="font-weight:700;white-space:nowrap;">${p.nombre}${eb}</td>
        ${DIAS.map(d=>`<td style="font-size:12px;line-height:1.6;">${fd(p[d+'_e'],p[d+'_s'],p[d+'_tipo'])}${p[d+'_e2']?'<br/>'+fd(p[d+'_e2'],p[d+'_s2'],'normal'):''}</td>`).join('')}
        <td><span class="badge badge-cyan" style="font-size:10px;">${tp>0?fmtHs(tp):'—'}</span></td>
        <td>${obsCell}</td>
        <td class="no-print"><button class="btn btn-ghost" style="padding:4px 8px;font-size:11px;" onclick="HorariosSem.openAreaModal('${p.area}')">✏</button></td>
      </tr>`;
    }).join('');
  }

  // ─── POPUP OBSERVACIÓN ───
  function _showObs(text) {
    document.getElementById('hsemObsPopup')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'hsemObsPopup';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:500;background:rgba(0,0,0,.72);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.innerHTML = `
      <div style="background:#13111c;border:1px solid rgba(107,225,227,.22);border-radius:16px;padding:24px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.6);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <div style="font-size:12px;font-weight:700;color:rgba(107,225,227,.7);text-transform:uppercase;letter-spacing:.07em;">💬 Observación</div>
          <button onclick="document.getElementById('hsemObsPopup').remove()" style="background:none;border:none;color:rgba(198,201,215,.5);font-size:20px;cursor:pointer;">✕</button>
        </div>
        <div style="background:rgba(255,255,255,.05);border:1px solid rgba(198,201,215,.1);border-radius:10px;padding:14px 16px;font-size:14px;line-height:1.7;color:rgba(255,255,255,.88);word-break:break-word;">${text}</div>
        <button onclick="document.getElementById('hsemObsPopup').remove()" style="margin-top:14px;width:100%;padding:10px;border-radius:10px;background:rgba(107,225,227,.12);border:1px solid rgba(107,225,227,.28);color:#6be1e3;font-weight:700;font-size:13px;cursor:pointer;">Cerrar</button>
      </div>`;
    overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  // ─── DESCARGAR IMAGEN ───
  function descargarImagen() {
    const personas = _flatPersonas(allData);
    if (!personas.length) { showToast('Sin datos para generar imagen','err'); return; }

    const desde = semViendo;
    const DLAN  = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];

    const fd = (e,s,tipo) => {
      if (tipo==='flex')    return 'Flex';
      if (tipo==='guardia') return '1h';
      if (!e) return '—';
      return s ? `${e}→${s}` : e;
    };

    const filas = personas.map(p => {
      const tp  = _hsPersona(p);
      const dias = DIAS.map(d => {
        let txt = fd(p[d+'_e'], p[d+'_s'], p[d+'_tipo']);
        if (p[d+'_e2']) txt += ` / ${fd(p[d+'_e2'], p[d+'_s2'], 'normal')}`;
        return txt;
      });
      return { area:p.area, nombre:p.nombre, dias, hs:tp>0?fmtHs(tp):'—', obs:p.obs||'' };
    });

    const colW=108, col0=88, col1=155, colHs=56, colObs=130, rowH=34, headH=42, pad=18;
    const totalW = pad*2 + col0 + col1 + colW*7 + colHs + colObs;
    const totalH = pad*2 + headH*2 + rowH*filas.length + 46;

    const canvas = document.createElement('canvas');
    const scale  = 2;
    canvas.width  = totalW*scale;
    canvas.height = totalH*scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    const ACOLORS = {
      'ADMINISTRACION':'#6be1e3','COMERCIAL':'#e17bd7','RECURSOS HUMANOS':'#e4c76a',
      'MARKETING':'#f472b6','ACADEMICO / GT':'#a78bfa','INNOVACION Y DESARROLLO':'#34d399','MAESTRANZA':'#fb923c',
    };

    ctx.fillStyle='#1a181d'; ctx.fillRect(0,0,totalW,totalH);

    ctx.fillStyle='#ffffff'; ctx.font=`bold 14px "Segoe UI",sans-serif`;
    ctx.fillText(`ONE Horarios · Semana ${_dd(desde)} al ${_dd(getSabado(desde))}`, pad, pad+14);
    ctx.fillStyle='rgba(198,201,215,.4)'; ctx.font=`11px "Segoe UI",sans-serif`;
    ctx.fillText('Escencial Consultora', pad, pad+30);

    const hY = pad+headH;
    const cols = [
      {lbl:'ÁREA',   x:pad},
      {lbl:'NOMBRE', x:pad+col0},
      ...DLAN.map((d,i)=>({lbl:d, x:pad+col0+col1+colW*i})),
      {lbl:'HS/SEM', x:pad+col0+col1+colW*7},
      {lbl:'OBS',    x:pad+col0+col1+colW*7+colHs},
    ];

    ctx.fillStyle='rgba(255,255,255,.06)';
    ctx.fillRect(pad, hY-rowH+6, totalW-pad*2, rowH);
    ctx.fillStyle='rgba(198,201,215,.45)'; ctx.font=`bold 10px "Segoe UI",sans-serif`;
    cols.forEach(c => ctx.fillText(c.lbl, c.x+7, hY-8));

    ctx.strokeStyle='rgba(198,201,215,.12)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(pad,hY+3); ctx.lineTo(totalW-pad,hY+3); ctx.stroke();

    filas.forEach((row,ri) => {
      const y = hY+3+rowH*ri;
      if (ri%2===0) { ctx.fillStyle='rgba(255,255,255,.02)'; ctx.fillRect(pad,y,totalW-pad*2,rowH); }

      const ac = ACOLORS[row.area]||'#a4a8c0';
      ctx.fillStyle=ac; ctx.font=`bold 10px "Segoe UI",sans-serif`;
      ctx.fillText(row.area.split(' ')[0], pad+7, y+rowH*.62);

      ctx.fillStyle='#ffffff'; ctx.font=`bold 12px "Segoe UI",sans-serif`;
      ctx.fillText(row.nombre, pad+col0+7, y+rowH*.62);

      ctx.font=`11px "Segoe UI",sans-serif`;
      row.dias.forEach((txt,di) => {
        const isEsp = txt==='Flex'||txt==='1h';
        ctx.fillStyle = isEsp ? (txt==='Flex'?'#a78bfa':'#e4c76a') : (txt==='—'?'rgba(198,201,215,.25)':'#6be1e3');
        ctx.fillText(txt, pad+col0+col1+colW*di+7, y+rowH*.62);
      });

      ctx.fillStyle='#6be1e3'; ctx.font=`bold 11px "Segoe UI",sans-serif`;
      ctx.fillText(row.hs, pad+col0+col1+colW*7+7, y+rowH*.62);

      if (row.obs) {
        ctx.fillStyle='rgba(198,201,215,.5)'; ctx.font=`10px "Segoe UI",sans-serif`;
        ctx.fillText(row.obs.length>18?row.obs.slice(0,18)+'…':row.obs, pad+col0+col1+colW*7+colHs+7, y+rowH*.62);
      }

      ctx.strokeStyle='rgba(198,201,215,.06)'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(pad,y+rowH); ctx.lineTo(totalW-pad,y+rowH); ctx.stroke();
    });

    const fy = hY+3+rowH*filas.length+16;
    ctx.fillStyle='rgba(198,201,215,.28)'; ctx.font=`10px "Segoe UI",sans-serif`;
    ctx.fillText(`ONE Horarios · Escencial Consultora · ${new Date().toLocaleDateString('es-AR')}`, pad, fy);

    const a = document.createElement('a');
    a.download = `ONE_horarios_${semViendo}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
    showToast('✓ Imagen descargada');
  }

  // ─── EXPORT CSV ───
  function exportCSV() {
    const personas=_flatPersonas(allData);
    if(!personas.length){showToast('Sin datos','err');return;}
    const cols=['Área','Nombre','Rol',
      ...DIAS.flatMap(d=>[`${DIA_LBL[d]} Tipo`,`${DIA_LBL[d]} E`,`${DIA_LBL[d]} S`,`${DIA_LBL[d]} E2`,`${DIA_LBL[d]} S2`]),
      'Hs/sem','Obs. persona','Obs. área'];
    const lines=[cols.join(',')];
    personas.forEach(p=>{
      lines.push([
        `"${p.area}"`,`"${p.nombre}"`,`"${p.rol}"`,
        ...DIAS.flatMap(d=>[
          `"${p[d+'_tipo']||'normal'}"`,
          `"${p[d+'_e']||''}"`,`"${p[d+'_s']||''}"`,`"${p[d+'_e2']||''}"`,`"${p[d+'_s2']||''}"`
        ]),
        _calcTot(p).toFixed(2),`"${p.obs||''}"`,`"${p.obsArea||''}"`
      ].join(','));
    });
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob(['\uFEFF'+lines.join('\n')],{type:'text/csv;charset=utf-8;'}));
    a.download=`ONE_horarios_${semViendo}.csv`;
    a.click(); showToast('CSV descargado ✓');
  }

  return {
    init, load, movSem, irSemana, irFecha,
    openAreaModal, copiarAntModal, closeModal, saveArea, delArea,
    exportCSV, _renderTabla, _showObs, descargarImagen,
    _uf, _ff, _uo, _tsDia, _goDia, _backDias, _setTipo,
  };

})();

window.loadHsem      = () => HorariosSem.load();
window.exportHsemCSV = () => HorariosSem.exportCSV();