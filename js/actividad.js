/* js/actividad.js — ONE Horarios v2
   Sistema de auditoría de cambios manuales.
   Escucha la tabla `actividad_log` via Supabase Realtime.
   No registra marcaciones normales — solo acciones manuales de admins y líderes.
*/

const Actividad = (() => {

  let _channel = null;
  let _log     = [];
  let _filtroTipo = '';
  const MAX = 150;

  // ── Configuración visual por tipo ──
  const TIPOS = {
    personal_nuevo:            { icon:'👤', label:'Persona agregada',          color:'#86efac', bg:'rgba(34,197,94,.10)',   border:'rgba(34,197,94,.24)'   },
    personal_editado:          { icon:'✏️',  label:'Datos de persona editados', color:'#6be1e3', bg:'rgba(107,225,227,.08)', border:'rgba(107,225,227,.20)' },
    personal_traspaso:         { icon:'🔀', label:'Traspaso de área',           color:'#a78bfa', bg:'rgba(167,139,250,.10)', border:'rgba(167,139,250,.24)' },
    personal_eliminado:        { icon:'🗑',  label:'Persona eliminada',         color:'#fca5a5', bg:'rgba(239,68,68,.10)',   border:'rgba(239,68,68,.24)'   },
    lider_nuevo:               { icon:'🔑', label:'Líder creado',               color:'#86efac', bg:'rgba(34,197,94,.10)',   border:'rgba(34,197,94,.24)'   },
    lider_editado:             { icon:'🔑', label:'Líder editado',              color:'#6be1e3', bg:'rgba(107,225,227,.08)', border:'rgba(107,225,227,.20)' },
    lider_eliminado:           { icon:'🔑', label:'Líder eliminado',            color:'#fca5a5', bg:'rgba(239,68,68,.10)',   border:'rgba(239,68,68,.24)'   },
    horario_semanal_guardado:  { icon:'📅', label:'Horario semanal guardado',   color:'#e4c76a', bg:'rgba(228,199,106,.09)', border:'rgba(228,199,106,.24)' },
    horario_semanal_eliminado: { icon:'📅', label:'Horario semanal eliminado',  color:'#fca5a5', bg:'rgba(239,68,68,.10)',   border:'rgba(239,68,68,.24)'   },
    registro_editado:          { icon:'📝', label:'Registro editado',           color:'#f472b6', bg:'rgba(244,114,182,.08)', border:'rgba(244,114,182,.22)' },
    registro_eliminado:        { icon:'🗑',  label:'Registro eliminado',        color:'#fca5a5', bg:'rgba(239,68,68,.10)',   border:'rgba(239,68,68,.24)'   },
  };

  const GRUPOS = {
    personal:  ['personal_nuevo','personal_editado','personal_traspaso','personal_eliminado'],
    lider:     ['lider_nuevo','lider_editado','lider_eliminado'],
    horario:   ['horario_semanal_guardado','horario_semanal_eliminado'],
    registro:  ['registro_editado','registro_eliminado'],
  };

  const fmtTs = iso => {
    if (!iso) return '—';
    const d   = new Date(iso);
    const hoy = new Date();
    const hora = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const mismodia = d.toDateString() === hoy.toDateString();
    if (mismodia) return hora;
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')} ${hora}`;
  };

  // ── INICIAR ──
  function start() {
    if (_channel) { _renderFiltros(); return; }

    _channel = SB
      .channel('one-actividad-log')
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'actividad_log' }, payload => {
        _push(payload.new, false);
        _render();
        _updateBadge();
        const cfg = TIPOS[payload.new.tipo];
        if (cfg) showToast(`${cfg.icon} ${payload.new.usuario} — ${payload.new.descripcion}`);
      })
      .subscribe(status => {
        const dot = document.getElementById('actDot');
        const lbl = document.getElementById('actStatus');
        const ok  = status === 'SUBSCRIBED';
        if (dot) dot.style.background = ok ? '#86efac' : '#fca5a5';
        if (lbl) lbl.textContent       = ok ? 'En vivo' : 'Reconectando...';
      });

    _renderFiltros();
    _loadRecent();
  }

  // ── CARGAR HISTORIAL RECIENTE ──
  async function _loadRecent() {
    const { data } = await SB.from('actividad_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(120);

    if (!data?.length) { _renderEmpty(); return; }
    data.reverse().forEach(r => _push(r, true));
    _render();
  }

  function _push(entry, hist) {
    _log.unshift({ ...entry, _hist: hist });
    if (_log.length > MAX) _log.pop();
  }

  function _updateBadge() {
    const badge = document.getElementById('actBadge');
    if (!badge) return;
    const n = _log.filter(e => !e._hist).length;
    badge.textContent  = n > 0 ? n : '';
    badge.style.display = n > 0 ? '' : 'none';
  }

  // ── FILTROS ──
  function _renderFiltros() {
    const wrap = document.getElementById('actFiltros');
    if (!wrap) return;

    const btns = [
      { v: '',         lbl: 'Todo' },
      { v: 'personal', lbl: '👤 Personal' },
      { v: 'lider',    lbl: '🔑 Líderes' },
      { v: 'horario',  lbl: '📅 Horarios' },
      { v: 'registro', lbl: '📝 Registros' },
      { v: 'fuera',    lbl: '⚠ Fuera de término' },
    ];

    wrap.innerHTML = btns.map(b => `
      <button onclick="Actividad._setFiltro('${b.v}')"
        id="actFBtn-${b.v}"
        style="background:${_filtroTipo===b.v?'rgba(107,225,227,.18)':'rgba(255,255,255,.06)'};
               border:1px solid ${_filtroTipo===b.v?'rgba(107,225,227,.45)':'rgba(198,201,215,.15)'};
               color:${_filtroTipo===b.v?'var(--one-cyan)':'rgba(198,201,215,.7)'};
               padding:5px 13px;border-radius:999px;font-family:var(--font-title);font-size:12px;
               font-weight:700;cursor:pointer;transition:all .15s;white-space:nowrap;">
        ${b.lbl}
      </button>`).join('');
  }

  function _setFiltro(v) {
    _filtroTipo = v;
    _renderFiltros();
    _render();
  }

  // ── RENDER FEED ──
  function _render() {
    const el = document.getElementById('actFeed');
    if (!el) return;

    // Filtrar
    let visible = _log;
    if (_filtroTipo === 'fuera') {
      visible = _log.filter(e => e.fuera_de_termino);
    } else if (_filtroTipo && GRUPOS[_filtroTipo]) {
      visible = _log.filter(e => GRUPOS[_filtroTipo].includes(e.tipo));
    }

    if (!visible.length) { _renderEmpty(true); return; }

    el.innerHTML = visible.map(entry => {
      const cfg = TIPOS[entry.tipo] || { icon:'🔧', label: entry.tipo, color:'#a4a8c0', bg:'rgba(255,255,255,.05)', border:'rgba(198,201,215,.15)' };
      const det = entry.detalle || {};
      const ac  = typeof areaColor === 'function' ? areaColor(entry.area || '') : '#a4a8c0';

      // Tag rol del usuario
      const rolTag = entry.usuario_tipo === 'lider'
        ? `<span style="font-size:9px;padding:1px 6px;border-radius:99px;background:rgba(228,199,106,.15);color:#e4c76a;border:1px solid rgba(228,199,106,.25);">Líder</span>`
        : `<span style="font-size:9px;padding:1px 6px;border-radius:99px;background:rgba(225,123,215,.13);color:#e17bd7;border:1px solid rgba(225,123,215,.25);">Admin</span>`;

      // Tag fuera de término
      const fuerTag = entry.fuera_de_termino
        ? `<span style="font-size:9px;padding:1px 8px;border-radius:99px;background:rgba(239,68,68,.18);color:#fca5a5;border:1px solid rgba(239,68,68,.35);font-weight:800;letter-spacing:.03em;">⚠ Fuera de término</span>`
        : '';

      // Tag hist/ahora
      const histTag = entry._hist
        ? `<span style="font-size:9px;padding:1px 6px;border-radius:99px;background:rgba(198,201,215,.07);color:rgba(198,201,215,.38);border:1px solid rgba(198,201,215,.12);">histórico</span>`
        : `<span style="font-size:9px;padding:1px 6px;border-radius:99px;background:rgba(107,225,227,.12);color:#6be1e3;border:1px solid rgba(107,225,227,.25);">ahora</span>`;

      // Detalle secundario según tipo
      let subDetail = '';
      if (det.area_anterior && det.area_nueva) {
        subDetail = `<div style="display:flex;align-items:center;gap:5px;margin-top:4px;font-size:12px;">
          <span style="color:${areaColor(det.area_anterior)};font-weight:700;">${det.area_anterior.split(' ')[0]}</span>
          <span style="color:rgba(198,201,215,.35);">→</span>
          <span style="color:${areaColor(det.area_nueva)};font-weight:700;">${det.area_nueva.split(' ')[0]}</span>
        </div>`;
      } else if (det.semana) {
        const pers = det.personas ? ` · ${det.personas} persona(s)` : '';
        subDetail = `<div style="font-size:11px;color:rgba(198,201,215,.4);margin-top:3px;">Semana ${det.semana}${pers}</div>`;
      } else if (det.fecha) {
        subDetail = `<div style="font-size:11px;color:rgba(198,201,215,.4);margin-top:3px;">Fecha: ${det.fecha}</div>`;
      } else if (det.campos) {
        subDetail = `<div style="font-size:11px;color:rgba(198,201,215,.38);margin-top:3px;">Campos: ${det.campos}</div>`;
      } else if (det.areas) {
        subDetail = `<div style="font-size:11px;color:rgba(198,201,215,.4);margin-top:3px;">Áreas: ${det.areas}</div>`;
      }

      return `<div style="display:flex;align-items:flex-start;gap:10px;
        background:${cfg.bg};border:1px solid ${cfg.border};
        border-radius:11px;padding:11px 14px;animation:fadeUp .2s ease both;">
        <div style="flex-shrink:0;font-size:17px;margin-top:2px;">${cfg.icon}</div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:5px;">
            <span style="font-size:11px;font-weight:800;color:${cfg.color};">${cfg.label}</span>
            ${histTag}${fuerTag}
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:13px;margin-bottom:2px;">
            <span style="font-weight:800;color:rgba(198,201,215,.95);">${entry.usuario || '—'}</span>
            ${rolTag}
            ${entry.area ? `<span style="color:${ac};font-size:11px;font-weight:700;">${entry.area.split(' / ')[0]}</span>` : ''}
            ${entry.target_nombre ? `<span style="color:rgba(198,201,215,.6);">→ <strong>${entry.target_nombre}</strong></span>` : ''}
          </div>
          <div style="font-size:12px;color:rgba(198,201,215,.48);">${entry.descripcion || ''}</div>
          ${subDetail}
        </div>
        <div style="flex-shrink:0;font-size:10px;color:rgba(198,201,215,.32);white-space:nowrap;margin-top:2px;">${fmtTs(entry.created_at)}</div>
      </div>`;
    }).join('');
  }

  function _renderEmpty(filtrado = false) {
    const el = document.getElementById('actFeed');
    if (!el) return;
    const msg = filtrado ? 'Sin eventos de este tipo en el historial.' : 'Sin cambios manuales registrados todavía.';
    el.innerHTML = `<div style="text-align:center;padding:60px 16px;color:rgba(198,201,215,.28);">
      <div style="font-size:36px;margin-bottom:12px;">🔔</div>
      <div style="font-size:14px;font-weight:700;">${msg}</div>
      <div style="font-size:12px;margin-top:5px;opacity:.6;">Los cambios manuales se registran automáticamente.</div>
    </div>`;
  }

  function clear() {
    _log = [];
    _render();
    const badge = document.getElementById('actBadge');
    if (badge) { badge.textContent = ''; badge.style.display = 'none'; }
  }

  return { start, clear, _setFiltro };
})();