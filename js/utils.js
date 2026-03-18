// js/utils.js — funciones compartidas

// ── FECHAS ──
const today = () => new Date().toISOString().slice(0,10);

// Día anterior
const yesterday = () => {
  const d = new Date(); d.setDate(d.getDate()-1);
  return d.toISOString().slice(0,10);
};

const addDays = (dateStr, n) => {
  const d = new Date(dateStr+'T12:00:00'); d.setDate(d.getDate()+n);
  return d.toISOString().slice(0,10);
};

const fmtDate = d => {
  if (!d) return '—';
  const [y,m,day] = d.split('-');
  return `${day}/${m}/${y}`;
};

const getDayName = dateStr => {
  const d = new Date(dateStr+'T12:00:00');
  const dias = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const mes  = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  return `${dias[d.getDay()]} ${d.getDate()} de ${mes[d.getMonth()]}`;
};

const getDayKey = dateStr => {
  const d = new Date(dateStr+'T12:00:00');
  const keys = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];
  return keys[d.getDay()];
};

const getLunes = (dateStr, offsetWeeks=0) => {
  const d = new Date(dateStr+'T12:00:00');
  const day = d.getDay();
  d.setDate(d.getDate() + (day===0 ? -6 : 1-day) + offsetWeeks*7);
  return d.toISOString().slice(0,10);
};

const getSabado = dateStr => {
  const d = new Date(getLunes(dateStr)+'T12:00:00');
  d.setDate(d.getDate()+5);
  return d.toISOString().slice(0,10);
};

const getMonthStart = (off=0) => { const d=new Date(); d.setMonth(d.getMonth()+off,1); return d.toISOString().slice(0,10); };
const getMonthEnd   = (off=0) => { const d=new Date(); d.setMonth(d.getMonth()+off+1,0); return d.toISOString().slice(0,10); };

const getDateRange = per => {
  const t = today();
  if (per==='hoy')        return { desde:t, hasta:t };
  if (per==='semana')     return { desde:getLunes(t,0), hasta:t };
  if (per==='semana_ant') return { desde:getLunes(t,-1), hasta:getLunes(t,0) };
  if (per==='mes')        return { desde:getMonthStart(0), hasta:t };
  if (per==='mes_ant')    return { desde:getMonthStart(-1), hasta:getMonthEnd(-1) };
  if (per==='anio')       return { desde:`${new Date().getFullYear()}-01-01`, hasta:t };
  if (per==='custom') {
    return { desde:document.getElementById('fDes')?.value||'', hasta:document.getElementById('fHas')?.value||'' };
  }
  return { desde:null, hasta:null };
};

// ── CÁLCULOS DE TIEMPO ──
const calcHs = (entStr, salStr) => {
  if (!entStr||!salStr) return null;
  const [eh,em] = entStr.split(':').map(Number);
  const [sh,sm] = salStr.split(':').map(Number);
  const mins = (sh*60+sm)-(eh*60+em);
  return mins>0 ? mins/60 : null;
};

const fmtHs = h => {
  if (h===null||h===undefined) return '—';
  const hrs  = Math.floor(h);
  const mins = Math.round((h-hrs)*60);
  return mins>0 ? `${hrs}h ${mins}m` : `${hrs}h`;
};

const calcTardVsPlan = (planStr, entStr) => {
  if (!planStr||!entStr) return null;
  const [ph,pm] = planStr.split(':').map(Number);
  const [eh,em] = entStr.split(':').map(Number);
  return (eh*60+em) - (ph*60+pm);
};

const calcHsExtra = (planSalStr, salRealStr) => {
  if (!planSalStr||!salRealStr) return null;
  const [ph,pm] = planSalStr.split(':').map(Number);
  const [sh,sm] = salRealStr.split(':').map(Number);
  const diff = (sh*60+sm)-(ph*60+pm);
  return diff>0 ? diff : 0;
};

// ── COLORES DE ÁREA ──
const AREA_COLORS_HEX = {
  'ADMINISTRACION':         '#6be1e3',
  'COMERCIAL':              '#e17bd7',
  'RECURSOS HUMANOS':       '#e4c76a',
  'MARKETING':              '#f472b6',
  'ACADEMICO / GT':         '#a78bfa',
  'INNOVACION Y DESARROLLO':'#34d399',
  'MAESTRANZA':             '#fb923c',
};
const areaColorHex = a => AREA_COLORS_HEX[a]||'#a4a8c0';
const areaColor    = a => AREA_COLORS_HEX[a]||'#a4a8c0';
const AREAS = Object.keys(AREA_COLORS_HEX);

// ── TOAST ──
const showToast = (msg, type='ok') => {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(()=>t.classList.remove('show'), 3000);
};

// ── BADGES HTML ──
const tardBadge = diff => {
  if (diff===null)  return '<span class="badge badge-gray">—</span>';
  if (diff<0)       return `<span class="badge badge-green">✓ ${Math.abs(diff)}m ant.</span>`;
  if (diff===0)     return '<span class="badge badge-green">✓ Exacto</span>';
  return `<span class="badge badge-red">+${diff}m</span>`;
};

const tardInfoText = diff => {
  if (diff===null) return { text:'', color:'' };
  if (diff<0)  return { text:`✓ ${Math.abs(diff)} min antes del horario`, color:'var(--color-success-text)' };
  if (diff===0) return { text:'✓ Llegó en horario exacto',               color:'var(--color-success-text)' };
  return           { text:`⚠ ${diff} min tarde`,                         color:'var(--color-danger-text)' };
};

// ── BUSCAR HORARIO PLANIFICADO — lee formato JSON nuevo ──
// La tabla tiene 1 fila por área/semana con columna horarios (JSONB array)
// Devuelve { entrada:"09:00", salida:"17:00" } o null
const getHorarioPlanificado = async (nombre, fecha) => {
  const lunes  = getLunes(fecha);
  const dayKey = getDayKey(fecha); // 'lunes','martes', etc.

  if (!dayKey || dayKey === 'domingo') return null;

  // Buscar la fila del área para esa semana
  // Como no sabemos el área de la persona acá, buscamos en todas las filas de esa semana
  const { data } = await SB
    .from('horarios_semanales')
    .select('horarios')
    .eq('semana_desde', lunes);

  if (!data?.length) return null;

  // Buscar a la persona dentro del JSON de cualquier área
  for (const row of data) {
    const horarios = row.horarios;
    if (!Array.isArray(horarios)) continue;
    const persona = horarios.find(h => h.nombre === nombre);
    if (!persona) continue;
    const diaData = persona[dayKey]; // { e:"09:00", s:"17:00", e2:"", s2:"" }
    if (!diaData?.e) return null;
    return {
      entrada: diaData.e,
      salida:  diaData.s || null,
      entrada2: diaData.e2 || null,
      salida2:  diaData.s2 || null,
    };
  }

  return null;
};

// ── HORAS PLANIFICADAS SEMANALES DE UNA PERSONA (para dashboard) ──
// Lee el JSON y suma todas las horas de la semana para esa persona
const getHsSemanalesPorPersona = (hsRows, nombre) => {
  const DIAS = ['lunes','martes','miercoles','jueves','viernes','sabado'];
  let total = 0;
  for (const row of hsRows) {
    const horarios = row.horarios;
    if (!Array.isArray(horarios)) continue;
    const persona = horarios.find(h => h.nombre === nombre);
    if (!persona) continue;
    DIAS.forEach(d => {
      const dd = persona[d];
      if (!dd) return;
      const h1 = calcHs(dd.e, dd.s);
      const h2 = calcHs(dd.e2, dd.s2);
      if (h1) total += h1;
      if (h2) total += h2;
    });
  }
  return total;
};

// Aplanar todas las personas de las filas de horarios_semanales (formato JSON)
const flatPersonasDeHorarios = (hsRows) => {
  const DIAS = ['lunes','martes','miercoles','jueves','viernes','sabado'];
  const out = [];
  hsRows.forEach(row => {
    const horarios = row.horarios;
    if (!Array.isArray(horarios)) return;
    horarios.forEach(h => {
      const p = { nombre: h.nombre, rol: h.rol||'', area: row.area };
      let total = 0;
      DIAS.forEach(d => {
        const dd = h[d];
        p[d+'_e']  = dd?.e  || '';
        p[d+'_s']  = dd?.s  || '';
        p[d+'_e2'] = dd?.e2 || '';
        p[d+'_s2'] = dd?.s2 || '';
        const h1 = calcHs(dd?.e, dd?.s);
        const h2 = calcHs(dd?.e2, dd?.s2);
        if (h1) total += h1;
        if (h2) total += h2;
      });
      p._totalHs = total;
      out.push(p);
    });
  });
  return out;
};