// js/horarios-sem.js — v3

const HorariosSem = (() => {

  const DIAS      = ['lunes','martes','miercoles','jueves','viernes','sabado'];
  const DIA_LBL   = {lunes:'Lunes',martes:'Martes',miercoles:'Miércoles',jueves:'Jueves',viernes:'Viernes',sabado:'Sábado'};
  const DIA_CORTO = {lunes:'Lun',martes:'Mar',miercoles:'Mié',jueves:'Jue',viernes:'Vie',sabado:'Sáb'};
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

    // Estado cargando en KPIs
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

    // Título semana
    const titEl = document.getElementById('hsemTitulo');
    if (titEl) {
      const lD = new Date(desde+'T12:00:00'), sD = new Date(hasta+'T12:00:00');
      const m  = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
      titEl.textContent = `Semana del ${lD.getDate()} al ${sD.getDate()} de ${m[sD.getMonth()]} ${sD.getFullYear()}`;
    }

    _renderKpis();
    _renderNav();
    _renderAreaGrid();
  }

  // ─── KPIs ───
  function _renderKpis() {
    const personas = _flatPersonas(allData);
    const areas    = new Set(allData.map(r => r.area)).size;
    let totalHs = 0, conExtra = 0;
    personas.forEach(p => {
      const pl = _hsPersona(p); totalHs += pl;
      const re = regsReal.filter(r => r.nombre === p.nombre)
        .reduce((a,r) => { const h = calcHs(r.hora_entrada?.slice(0,5), r.hora_salida?.slice(0,5)); return h?a+h:a; }, 0);
      if (re > pl && pl > 0) conExtra++;
    });
    const s = (id, v) => { const e = document.getElementById(id); if(e) e.textContent = v; };
    s('hsKP', personas.length);
    s('hsKA', areas);
    s('hsKE', conExtra);
    s('hsKH', totalHs > 0 ? fmtHs(totalHs) : '—');
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

  // ─── FLAT PERSONAS (JSON → array plano) ───
  function _flatPersonas(data) {
    const out = [];
    data.forEach(row => {
      const hs = row.horarios;
      if (!Array.isArray(hs) || !hs.length) return;
      hs.forEach(h => {
        const p = { _rowId:row.id, area:row.area, nombre:h.nombre, rol:h.rol||'', obs:h.obs||'', obsArea:row.observaciones||'' };
        DIAS.forEach(d => {
          p[d+'_e']  = h[d]?.e  || '';
          p[d+'_s']  = h[d]?.s  || '';
          p[d+'_e2'] = h[d]?.e2 || '';
          p[d+'_s2'] = h[d]?.s2 || '';
        });
        out.push(p);
      });
    });
    return out;
  }

  function _hsPersona(p) {
    let t=0;
    DIAS.forEach(d=>{
      const h1=calcHs(p[d+'_e'],p[d+'_s']); const h2=calcHs(p[d+'_e2'],p[d+'_s2']);
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

      const persHtml = personas.slice(0,5).map(p => {
        const hs = _hsPersona(p);
        // Construir resumen de horario (primera entrada/salida del lunes como referencia)
        const refE = DIAS.map(d=>p[d+'_e']).find(x=>x) || '';
        const refS = DIAS.map(d=>p[d+'_s']).find(x=>x) || '';
        const horStr = refE ? `<span style="font-size:10px;color:rgba(198,201,215,.4);">${refE}${refS?' → '+refS:''}</span>` : '';
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

      return `<div class="area-card" onclick="HorariosSem.openAreaModal('${area}')">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px;gap:8px;">
          <div>
            <div style="font-size:13px;font-weight:800;color:${col};">${area}</div>
            ${cargado?`<div style="font-size:11px;color:rgba(198,201,215,.4);margin-top:1px;">Total: <strong style="color:var(--one-cyan);">${fmtHs(totalHs)}</strong></div>`:''}
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;">
            ${badge}
            <span style="font-size:9px;color:rgba(198,201,215,.28);">${cargado?'Click para editar →':'Click para cargar →'}</span>
          </div>
        </div>
        <div style="border-top:1px solid rgba(198,201,215,.07);padding-top:8px;min-height:52px;">
          ${cargado ? (persHtml+masHtml) : '<div style="font-size:12px;color:rgba(198,201,215,.25);padding:4px 0;">No hay horarios para esta semana</div>'}
        </div>
        ${row?.observaciones?`<div style="margin-top:6px;font-size:11px;color:rgba(198,201,215,.38);padding-top:6px;border-top:1px solid rgba(198,201,215,.06);">📝 ${row.observaciones}</div>`:''}
      </div>`;
    }).join('');

    // También actualiza tabla detalle si está abierta
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
        r[d+'_e']  = sv?.[d]?.e  || '';
        r[d+'_s']  = sv?.[d]?.s  || '';
        r[d+'_e2'] = sv?.[d]?.e2 || '';
        r[d+'_s2'] = sv?.[d]?.s2 || '';
      });
      r.split = DIAS.some(d => r[d+'_e2']);
      return r;
    });

    // Semana anterior
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
    return Array.from({length:6}, (_,i) => {
      const d = new Date(lunes+'T12:00:00');
      d.setDate(d.getDate()+i);
      return d.toISOString().slice(0,10);
    });
  }

  // ─── RENDER MODAL: vista días ───
  // Vista 1: lista de 6 días  → click → Vista 2: personas del día
  let _modalView = 'dias'; // 'dias' | 'dia-X'
  let _modalDia  = 0;

  function _renderEditCards() {
    if (_modalView === 'dias') _renderDiasList();
    else                        _renderDiaDetail(_modalDia);
  }

  // VISTA 1 — lista de días
  function _renderDiasList() {
    const cont = document.getElementById('mhPersonasBody');
    if (!cont) return;
    const fArr = _diasArr(semViendo);

    const rows = DIAS.map((d, di) => {
      const conH    = editRows.filter(r => r[d+'_e']);
      const primerH = conH[0];
      const todosIgual = conH.length > 1 && conH.every(r => r[d+'_e'] === conH[0][d+'_e'] && r[d+'_s'] === conH[0][d+'_s']);

      let resumen;
      if (conH.length === 0) {
        resumen = `<span style="font-size:12px;color:rgba(198,201,215,.28);">Sin horario</span>`;
      } else if (todosIgual) {
        resumen = `<span style="font-size:13px;font-weight:800;color:var(--one-cyan);">${primerH[d+'_e']}${primerH[d+'_s']?' → '+primerH[d+'_s']:''}</span>
                   <span style="font-size:11px;color:rgba(198,201,215,.4);margin-left:8px;">todos igual</span>`;
      } else {
        resumen = `<span style="font-size:12px;color:var(--one-cyan);font-weight:700;">${primerH[d+'_e']}${primerH[d+'_s']?' → '+primerH[d+'_s']:''}</span>
                   <span style="font-size:11px;color:rgba(198,201,215,.4);margin-left:6px;">${conH.length}/${editRows.length} cargados</span>`;
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

  // VISTA 2 — personas del día seleccionado
  function _renderDiaDetail(di) {
    const cont = document.getElementById('mhPersonasBody');
    if (!cont) return;
    const d    = DIAS[di];
    const fArr = _diasArr(semViendo);
    const sp_any = editRows.some(r => r.split);

    const colHeader = `<div style="display:grid;grid-template-columns:170px 1fr 18px 1fr ${sp_any?'28px 1fr 18px 1fr':''};gap:8px;padding:8px 16px 6px;border-bottom:1px solid rgba(198,201,215,.08);">
      <div></div>
      <div style="font-size:9px;font-weight:700;color:rgba(198,201,215,.4);text-transform:uppercase;letter-spacing:.07em;text-align:center;">Entrada</div>
      <div></div>
      <div style="font-size:9px;font-weight:700;color:rgba(198,201,215,.4);text-transform:uppercase;letter-spacing:.07em;text-align:center;">Salida</div>
      ${sp_any?`<div></div>
      <div style="font-size:9px;font-weight:700;color:rgba(228,199,106,.45);text-transform:uppercase;letter-spacing:.07em;text-align:center;">Ent. 2</div>
      <div></div>
      <div style="font-size:9px;font-weight:700;color:rgba(228,199,106,.45);text-transform:uppercase;letter-spacing:.07em;text-align:center;">Sal. 2</div>`:''}
    </div>`;

    const personaRows = editRows.map((r, i) => {
      const sp = r.split;
      return `<div style="display:grid;grid-template-columns:170px 1fr 18px 1fr ${sp?'28px 1fr 18px 1fr':''};align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid rgba(198,201,215,.05);">
        <div>
          <div style="font-size:13px;font-weight:800;">${r.nombre}</div>
          <div style="font-size:10px;color:rgba(198,201,215,.35);">${r.rol||'—'}</div>
        </div>
        <input class="ht-edit ${r[d+'_e']?'v':''}" type="text" maxlength="5" placeholder="09:00" value="${r[d+'_e']}"
          oninput="HorariosSem._uf(${i},'${d}_e',this)" onblur="HorariosSem._ff(${i},'${d}_e',this)"/>
        <span style="font-size:13px;color:rgba(198,201,215,.3);text-align:center;">→</span>
        <input class="ht-edit ${r[d+'_s']?'v':''}" type="text" maxlength="5" placeholder="17:00" value="${r[d+'_s']}"
          oninput="HorariosSem._uf(${i},'${d}_s',this)" onblur="HorariosSem._ff(${i},'${d}_s',this)"/>
        ${sp ? `
        <span style="font-size:11px;color:rgba(228,199,106,.5);text-align:center;font-weight:800;">+</span>
        <input class="ht-edit ht-gold ${r[d+'_e2']?'v':''}" type="text" maxlength="5" placeholder="—" value="${r[d+'_e2']}"
          oninput="HorariosSem._uf(${i},'${d}_e2',this)" onblur="HorariosSem._ff(${i},'${d}_e2',this)"/>
        <span style="font-size:13px;color:rgba(228,199,106,.28);text-align:center;">→</span>
        <input class="ht-edit ht-gold ${r[d+'_s2']?'v':''}" type="text" maxlength="5" placeholder="—" value="${r[d+'_s2']}"
          oninput="HorariosSem._uf(${i},'${d}_s2',this)" onblur="HorariosSem._ff(${i},'${d}_s2',this)"/>
        ` : ''}
      </div>`;
    }).join('');

    // Totales por persona en este día
    const totalesRow = editRows.map((r,i) => {
      const h1 = calcHs(r[d+'_e'], r[d+'_s']);
      const h2 = calcHs(r[d+'_e2'], r[d+'_s2']);
      const tot = (h1||0)+(h2||0);
      return `<span style="font-size:11px;color:rgba(198,201,215,.4);">${r.nombre.split(' ')[0]}: <strong style="color:var(--one-cyan);">${tot>0?fmtHs(tot):'—'}</strong></span>`;
    }).join('<span style="color:rgba(198,201,215,.2);margin:0 6px;">·</span>');

    // Controles turno partido por persona
    const splitControls = editRows.map((r,i) =>
      `<button class="btn-split-sm ${r.split?'on':''}" id="mhSpBtn${i}" onclick="HorariosSem._ts(${i})" style="font-size:11px;">
        ${r.nombre.split(' ')[0]}: ${r.split?'✂ Partido ON':'✂ Turno partido'}
      </button>`
    ).join('');

    cont.innerHTML = `
      <!-- ENCABEZADO DEL DÍA -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <button onclick="HorariosSem._backDias()"
            style="background:rgba(255,255,255,.07);border:1px solid rgba(198,201,215,.18);color:rgba(198,201,215,.8);padding:6px 14px;border-radius:999px;font-family:var(--font-title);font-size:12px;font-weight:700;cursor:pointer;">
            ‹ Volver
          </button>
          <div>
            <span style="font-size:16px;font-weight:800;">${DIA_LBL[d]}</span>
            <span style="font-size:13px;color:rgba(198,201,215,.45);margin-left:8px;">${_ddShort(fArr[di])}</span>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">${splitControls}</div>
      </div>
      <!-- TABLA ENTRADA/SALIDA -->
      <div style="background:rgba(255,255,255,.03);border:1px solid rgba(198,201,215,.09);border-radius:10px;overflow:hidden;margin-bottom:10px;">
        ${colHeader}
        ${personaRows}
      </div>
      <!-- TOTALES DEL DÍA -->
      <div style="display:flex;flex-wrap:wrap;gap:8px;padding:6px 0;">${totalesRow}</div>
    `;
  }

  function _goDia(di) {
    _modalView = 'dia-X';
    _modalDia  = di;
    _renderEditCards();
  }

  function _backDias() {
    _modalView = 'dias';
    _renderEditCards();
  }
  function _ddShort(s) { if(!s)return''; const[y,m,d]=s.split('-'); return`${d}/${m}`; }

  // ─── TOGGLE TURNO PARTIDO ───
  function _ts(i) {
    editRows[i].split = !editRows[i].split;
    if (!editRows[i].split) {
      DIAS.forEach(d => { editRows[i][d+'_e2']=''; editRows[i][d+'_s2']=''; });
    }
    _renderEditCards();
  }

  // ─── NORMALIZAR HORA ───
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
    inp.classList.toggle('err', !!(inp.value&&!n));
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
      const h1=calcHs(r[d+'_e'],r[d+'_s']); const h2=calcHs(r[d+'_e2'],r[d+'_s2']);
      if(h1)t+=h1; if(h2)t+=h2;
    });
    return t;
  }

  // ─── COPIAR SEMANA ANTERIOR ───
  function copiarAntModal() {
    const btn=document.getElementById('btnCopiarAnt');
    if(!btn?._antData) return;
    const antMap={}; btn._antData.forEach(h=>antMap[h.nombre]=h);
    let c=0;
    editRows.forEach(r=>{
      const a=antMap[r.nombre]; if(!a)return;
      DIAS.forEach(d=>{
        r[d+'_e']=a[d]?.e||''; r[d+'_s']=a[d]?.s||'';
        r[d+'_e2']=a[d]?.e2||''; r[d+'_s2']=a[d]?.s2||'';
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
      DIAS.forEach(d=>{ obj[d]={e:r[d+'_e']||'',s:r[d+'_s']||'',e2:r[d+'_e2']||'',s2:r[d+'_s2']||''}; });
      return obj;
    });

    const payload={
      semana_desde:semViendo, semana_hasta:getSabado(semViendo),
      area:editArea,
      observaciones:document.getElementById('mhAreaObs').value.trim()||null,
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
    showToast(`✓ Horarios de ${editArea} guardados`);
    closeModal();
    load();
  }

  function closeModal() {
    document.getElementById('mHsem').style.display='none';
    editArea=null; editRows=[]; editRowId=null;
  }

  async function delArea() {
    if (!editRowId) { showToast('No hay datos para eliminar','err'); return; }
    if (!confirm(`¿Eliminar los horarios de "${editArea}" para esta semana?`)) return;
    const{error}=await SB.from('horarios_semanales').delete().eq('id',editRowId);
    if(error){showToast('Error','err');return;}
    showToast(`Horarios de ${editArea} eliminados`);
    closeModal(); load();
  }

  // ─── TABLA DETALLADA ───
  function _renderTabla() {
    const tbody=document.getElementById('tbHsem');
    if(!tbody) return;
    const personas=_flatPersonas(allData);
    if(!personas.length){
      tbody.innerHTML=`<tr><td colspan="11" style="text-align:center;padding:30px;color:rgba(198,201,215,.3);">No hay horarios para esta semana</td></tr>`;
      return;
    }
    tbody.innerHTML=personas.map(p=>{
      const col=areaColor(p.area);
      const tp=_hsPersona(p);
      const re=regsReal.filter(r=>r.nombre===p.nombre)
        .reduce((a,r)=>{const h=calcHs(r.hora_entrada?.slice(0,5),r.hora_salida?.slice(0,5));return h?a+h:a;},0);
      const extra=re>tp&&tp>0?re-tp:0;
      const eb=extra>0?`<span class="badge badge-gold" style="font-size:10px;margin-left:4px;">+${fmtHs(extra)}</span>`:'';
      const fd=(e,s)=>{
        if(!e) return '<span style="color:rgba(198,201,215,.2);font-size:11px;">—</span>';
        return s?`<b style="font-size:12px;">${e}</b><span style="color:rgba(198,201,215,.35);font-size:10px;"> → ${s}</span>`
                :`<b style="font-size:12px;">${e}</b>`;
      };
      return`<tr>
        <td><span style="color:${col};font-weight:800;font-size:11px;">${p.area.split(' ')[0]}</span></td>
        <td style="font-weight:700;white-space:nowrap;">${p.nombre}${eb}</td>
        ${DIAS.map(d=>`<td style="font-size:12px;line-height:1.6;">${fd(p[d+'_e'],p[d+'_s'])}${p[d+'_e2']?'<br/>'+fd(p[d+'_e2'],p[d+'_s2']):''}</td>`).join('')}
        <td><span class="badge badge-cyan" style="font-size:10px;">${tp>0?fmtHs(tp):'—'}</span></td>
        <td style="color:rgba(198,201,215,.45);font-size:11px;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.obs||'—'}</td>
        <td class="no-print"><button class="btn btn-ghost" style="padding:4px 8px;font-size:11px;" onclick="HorariosSem.openAreaModal('${p.area}')">✏</button></td>
      </tr>`;
    }).join('');
  }

  // ─── EXPORT CSV ───
  function exportCSV() {
    const personas=_flatPersonas(allData);
    if(!personas.length){showToast('Sin datos','err');return;}
    const cols=['Área','Nombre','Rol',
      ...DIAS.flatMap(d=>[`${DIA_LBL[d]} E`,`${DIA_LBL[d]} S`,`${DIA_LBL[d]} E2`,`${DIA_LBL[d]} S2`]),
      'Hs/sem','Obs. persona','Obs. área'];
    const lines=[cols.join(',')];
    personas.forEach(p=>{
      lines.push([
        `"${p.area}"`,`"${p.nombre}"`,`"${p.rol}"`,
        ...DIAS.flatMap(d=>[`"${p[d+'_e']||''}"`,`"${p[d+'_s']||''}"`,`"${p[d+'_e2']||''}"`,`"${p[d+'_s2']||''}"`]),
        _hsPersona(p).toFixed(2),`"${p.obs||''}"`,`"${p.obsArea||''}"`
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
    exportCSV, _renderTabla,
    _uf, _ff, _uo, _ts, _goDia, _backDias,
  };

})();

window.loadHsem      = () => HorariosSem.load();
window.exportHsemCSV = () => HorariosSem.exportCSV();