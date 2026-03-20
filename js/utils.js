// js/utils.js — funciones compartidas

// ── FECHAS ──
// Usar fecha LOCAL (no UTC) para evitar problemas de zona horaria Argentina (UTC-3)
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

const yesterday = () => {
  const d = new Date();
  d.setDate(d.getDate()-1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

// Helper interno para formatear Date → YYYY-MM-DD en hora local
const _localDate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

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

// Nombre del día de la semana para mapear a columna en horarios_semanales
const getDayKey = dateStr => {
  const d = new Date(dateStr+'T12:00:00');
  const keys = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];
  return keys[d.getDay()];
};

const getLunes = (dateStr, offsetWeeks=0) => {
  const d = new Date(dateStr+'T12:00:00'); // T12:00:00 evita problema de DST
  const day = d.getDay();
  d.setDate(d.getDate() + (day===0 ? -6 : 1-day) + offsetWeeks*7);
  return _localDate(d);
};

const getViernes = dateStr => {
  const d = new Date(getLunes(dateStr)+'T12:00:00');
  d.setDate(d.getDate()+4);
  return _localDate(d);
};

const getDomingo = dateStr => {
  const d = new Date(getLunes(dateStr)+'T12:00:00');
  d.setDate(d.getDate()+6);
  return _localDate(d);
};

// getSabado ahora apunta a domingo (fin de semana real)
const getSabado = getDomingo;

const getMonthStart = (off=0) => {
  const d = new Date();
  d.setMonth(d.getMonth()+off, 1);
  return _localDate(d);
};
const getMonthEnd = (off=0) => {
  const d = new Date();
  d.setMonth(d.getMonth()+off+1, 0);
  return _localDate(d);
};

const getDateRange = (per, diaEspecifico=null) => {
  const t = today();
  if (per==='hoy')        return { desde:t, hasta:t };
  if (per==='ayer')       return { desde:yesterday(), hasta:yesterday() };
  if (per==='semana')     return { desde:getLunes(t,0), hasta:t };
  if (per==='semana_ant') return { desde:getLunes(t,-1), hasta:getDomingo(getLunes(t,-1)) };
  if (per==='mes')        return { desde:getMonthStart(0), hasta:t };
  if (per==='mes_ant')    return { desde:getMonthStart(-1), hasta:getMonthEnd(-1) };
  if (per==='anio')       return { desde:`${new Date().getFullYear()}-01-01`, hasta:t };
  if (per==='dia_especifico') {
    const dia = diaEspecifico
      || document.getElementById('fDiaEsp')?.value
      || document.getElementById('dDiaEsp')?.value
      || '';
    return { desde:dia, hasta:dia };
  }
  if (per==='custom') {
    return {
      desde: document.getElementById('fDes')?.value || '',
      hasta: document.getElementById('fHas')?.value || '',
    };
  }
  return { desde:null, hasta:null }; // 'todos' — sin filtro de fecha
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

// Tardanza en minutos entre hora real de entrada y hora planificada
// planStr = "09:00" (viene del horario semanal)
// entStr  = "09:07" (hora real que ingresó el usuario)
// Retorna: positivo=tarde, negativo=temprano, null=sin dato
const calcTardVsPlan = (planStr, entStr) => {
  if (!planStr||!entStr) return null;
  const [ph,pm] = planStr.split(':').map(Number);
  const [eh,em] = entStr.split(':').map(Number);
  return (eh*60+em) - (ph*60+pm);
};

// Hora extra en minutos: cuánto trabajó más allá de la salida planificada
// planSalStr = "17:00", salRealStr = "18:30" → 90 min extra
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

// ── BUSCAR HORARIO PLANIFICADO DE UNA PERSONA PARA UNA FECHA ──
// Devuelve { entrada, salida, tipo } o null si no hay horario cargado
// Compatible con registros viejos que no tienen campo "tipo"
const getHorarioPlanificado = async (nombre, fecha) => {
  const lunes  = getLunes(fecha);
  const dayKey = getDayKey(fecha);

  // getDayKey devuelve null solo si dateStr es inválido
  if (!dayKey) return null;

  // Traer TODAS las filas de esa semana (una fila por área)
  const { data, error } = await SB
    .from('horarios_semanales')
    .select('area, horarios')
    .eq('semana_desde', lunes);

  if (error || !data?.length) return null;

  for (const row of data) {
    const horarios = row.horarios;
    if (!Array.isArray(horarios) || !horarios.length) continue;

    const persona = horarios.find(h => h.nombre === nombre);
    if (!persona) continue;

    const diaData = persona[dayKey];
    // Si no hay dato del día, el día no tiene horario cargado
    if (!diaData) continue;

    // Leer tipo — registros viejos no tienen campo tipo → asumir 'normal'
    const tipo = diaData.tipo || 'normal';

    if (tipo === 'flex')    return { entrada: null, salida: null, tipo: 'flex' };
    if (tipo === 'guardia') return { entrada: null, salida: null, tipo: 'guardia' };

    // Tipo normal: leer horas
    const entrada = diaData.e || '';
    const salida  = diaData.s || '';

    // Si no tiene entrada Y no tiene salida, el día está vacío (sin horario asignado)
    if (!entrada && !salida) continue;

    return {
      entrada: entrada ? entrada.slice(0, 5) : null,
      salida:  salida  ? salida.slice(0, 5)  : null,
      entrada2: diaData.e2 ? diaData.e2.slice(0, 5) : null,
      salida2:  diaData.s2 ? diaData.s2.slice(0, 5)  : null,
      tipo:    'normal',
    };
  }

  return null; // persona no encontrada o sin horario esta semana
};