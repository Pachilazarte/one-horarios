// js/reloj-admin.js — pestaña "⏰ Reloj" del panel admin (v3, versión final)
// Registrados en el reloj + vínculos en lote, sincronización a Registros con
// vista previa en vivo, carga de personal, hora y reinicio remotos.
// Lecturas de Supabase (personal) solamente; el vínculo se guarda LOCAL en el
// servidor del reloj — esta base no se toca hasta activar la sincronización.
// ⚙ El servidor del reloj corre en la X270, expuesto vía Tailscale Funnel
// (HTTPS real — necesario porque esta página se sirve por HTTPS y el
// navegador bloquea llamadas a http:// desde una página https, "mixed
// content"). El dominio taild45448 es el tailnet de Santiago; si algún día
// cambia, actualizar solo esta línea.
const RELOJ_API = 'https://x270-server.taild45448.ts.net';
// Clave solo exigida cuando el pedido llega desde fuera de la red local
// (o sea, siempre que se accede vía este dominio público) — en LAN directa
// (el panel técnico en http://reloj...:8081/) nunca hace falta.
const RELOJ_HEADERS = { 'X-Reloj-Key': 'one2026reloj' };

const RelojAdmin = (() => {
  let _timer = null;
  let _personal = null;
  let _usuarios = [];
  let _syncOn = false;
  let _previewAbierta = false;
  let _cambios = {};          // pin -> true (vínculos elegidos sin guardar)

  const PRIV = { '0': 'Usuario', '2': 'Admin', '6': 'Admin', '14': 'Admin' };

  async function api(path, data) {
    const opts = data
      ? { method: 'POST', headers: { ...RELOJ_HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify(data) }
      : { headers: RELOJ_HEADERS };
    const r = await fetch(RELOJ_API + path, opts);
    return await r.json();
  }

  async function start() {
    if (!_personal) {
      const { data } = await SB.from('personal').select('nombre,area,rol,activo').order('nombre');
      _personal = (data || []).filter(p => p.activo !== false);
    }
    await load();
    clearInterval(_timer);
    _timer = setInterval(() => {
      const visible = document.getElementById('tab-reloj').style.display !== 'none';
      const act = document.activeElement;
      const editando = act && (act.id || '').startsWith('rjSel_');
      if (visible && !editando) load();
    }, 10000);
  }

  async function load() {
    const est = document.getElementById('relojEstado');
    try {
      const [estado, usuarios, sync] = await Promise.all([
        api('/api/estado'), api('/api/reloj_usuarios'), api('/api/sync_registros'),
      ]);
      _usuarios = usuarios;
      _syncOn = sync.on;
      est.className = estado.online ? 'rj-badge-ok' : 'rj-badge-warn';
      est.textContent = estado.online
        ? '🟢 Reloj en línea'
        : '🔌 Fuera de línea (últ.: ' + (estado.ultima_vez || 'nunca') + ') · ' + estado.pendientes + ' en cola';
      const sy = document.getElementById('rjSyncEstado');
      sy.className = sync.on ? 'rj-badge-ok' : 'rj-badge-warn';
      sy.textContent = sync.on ? 'ACTIVADA — sube de verdad' : 'APAGADA — solo el manual computa';
      document.getElementById('rjSyncInfo').textContent = sync.on
        ? 'Cada marca crea/actualiza el registro del día en la página. Los registros cargados a mano SIEMPRE se respetan.'
        : 'El reloj junta y calcula todo, pero NO escribe en la página. Cuando todos estén registrados: "cambiar" y queda conectado (reloj + manual conviven).';
      // no re-dibujar la tabla si hay vínculos elegidos sin guardar
      if (!Object.keys(_cambios).length) renderUsuarios(usuarios);
      renderSinCargar(usuarios);
      if (_previewAbierta) renderPreview();
      iconos();
    } catch (e) {
      est.className = 'rj-badge-warn';
      est.textContent = '⚠ Sin conexión al servidor del reloj';
      document.getElementById('relojTbody').innerHTML =
        '<tr><td colspan="11" style="padding:22px;color:rgba(198,201,215,.45);">No se pudo conectar a <b>' +
        RELOJ_API + '</b>. Verificá que el servidor del reloj esté corriendo y en la misma red.</td></tr>';
    }
  }

  /* ── selector de personas agrupado por área ── */
  function opcionesPersonal(nombreActual) {
    const porArea = {};
    _personal.forEach(p => {
      const a = p.area || 'SIN ÁREA';
      (porArea[a] = porArea[a] || []).push(p);
    });
    return Object.keys(porArea).sort().map(area => {
      const ops = porArea[area].map(p => {
        const sel = (nombreActual === p.nombre) ? ' selected' : '';
        const val = encodeURIComponent(JSON.stringify({ n: p.nombre, a: p.area || '' }));
        return `<option value="${val}"${sel}>${p.nombre}</option>`;
      }).join('');
      return `<optgroup label="${area}">${ops}</optgroup>`;
    }).join('');
  }

  /* ── registrados en el reloj + vínculos en lote ── */
  function renderUsuarios(usuarios) {
    const tb = document.getElementById('relojTbody');
    if (!usuarios.length) {
      tb.innerHTML = '<tr><td colspan="11" style="padding:22px;color:rgba(198,201,215,.4);">' +
        'El reloj todavía no informó usuarios.</td></tr>';
      return;
    }
    const si = '<span class="rj-si">✔</span>', no = '<span class="rj-no">—</span>';
    tb.innerHTML = usuarios.map((u, i) => {
      const m = u.mapeo || null;
      return `<tr>
        <td><b>${u.pin}</b></td>
        <td>${u.nombre || '<span class="rj-no">(sin nombre)</span>'}</td>
        <td>${PRIV[u.privilegio] || u.privilegio || '—'}</td>
        <td>${u.card ? '💳 ' + u.card : no}</td>
        <td>${u.huella ? si : no}</td>
        <td>${u.cara ? si : no}</td>
        <td>${u.foto ? si : no}</td>
        <td><select id="rjSel_${u.pin}" class="inp" style="min-width:190px;padding:7px 10px;font-size:13px;"
              onchange="RelojAdmin.marcarCambio('${u.pin}')">
          <option value="">— sin vincular —</option>${opcionesPersonal(m ? m.nombre : null)}</select></td>
        <td id="rjArea_${u.pin}" style="color:rgba(198,201,215,.6);font-size:12px;">${m && m.area ? m.area : '—'}</td>
        <td><button class="btn btn-danger" onclick="RelojAdmin.borrar(${i})">Borrar</button></td>
        <td id="rjSt_${u.pin}">${m
          ? '<span class="rj-badge-ok">✔ ' + m.nombre + '</span>'
          : '<span class="rj-badge-warn">sin vincular</span>'}</td>
      </tr>`;
    }).join('');
  }

  function marcarCambio(pin) {
    _cambios[pin] = true;
    const st = document.getElementById('rjSt_' + pin);
    if (st) st.innerHTML = '<span class="rj-badge-warn">● sin guardar</span>';
    actualizarContador();
  }

  function actualizarContador() {
    const n = Object.keys(_cambios).length;
    const btn = document.getElementById('rjBtnGuardarTodos');
    document.getElementById('rjCantCambios').textContent = n;
    btn.style.display = n ? '' : 'none';
  }

  async function guardarTodos() {
    const pins = Object.keys(_cambios);
    if (!pins.length) return;
    let ok = 0, err = 0;
    for (const pin of pins) {
      const sel = document.getElementById('rjSel_' + pin);
      let nombre = '', area = '';
      if (sel && sel.value) {
        const v = JSON.parse(decodeURIComponent(sel.value));
        nombre = v.n; area = v.a;
      }
      try {
        const j = await api('/api/mapeo', { pin, nombre, area });
        if (j.ok) {
          ok++;
          delete _cambios[pin];
          const st = document.getElementById('rjSt_' + pin);
          if (st) st.innerHTML = nombre
            ? '<span class="rj-badge-ok">✔ ' + nombre + '</span>'
            : '<span class="rj-badge-warn">sin vincular</span>';
          const ar = document.getElementById('rjArea_' + pin);
          if (ar) ar.textContent = area || '—';
        } else err++;
      } catch (e) { err++; }
    }
    actualizarContador();
    showToast(err ? ok + ' guardados, ' + err + ' con error' : '✔ ' + ok + ' vínculo(s) guardados juntos', err ? 'err' : undefined);
    load();
  }

  async function borrar(i) {
    const u = _usuarios[i];
    if (!u) return;
    if (!confirm('¿Borrar del RELOJ a "' + (u.nombre || 'PIN ' + u.pin) + '" (PIN ' + u.pin + ')?\n' +
      'Se elimina el usuario y su biometría del aparato (el backup local queda).')) return;
    const j = await api('/api/borrar_usuario', { pin: u.pin });
    showToast(j.ok ? 'Borrado encolado — se aplica cuando el reloj lo tome' : 'Error', j.ok ? undefined : 'err');
    setTimeout(load, 1500);
  }

  /* ── personal sin cargar al reloj ── */
  function renderSinCargar(usuarios) {
    const cont = document.getElementById('rjSinCargar');
    const vinculados = new Set(usuarios.filter(u => u.mapeo).map(u => u.mapeo.nombre));
    const faltan = _personal.filter(p => !vinculados.has(p.nombre));
    if (!faltan.length) {
      cont.innerHTML = '<span class="rj-badge-ok">✔ Todo el personal activo está en el reloj</span>';
      return;
    }
    cont.innerHTML = faltan.map(p =>
      `<button class="btn btn-ghost" style="font-size:12px;padding:7px 13px;"
        onclick="RelojAdmin.cargar('${p.nombre.replace(/'/g, "\\'")}','${(p.area || '').replace(/'/g, "\\'")}')"
        title="${p.area || ''}"><i data-lucide="user-plus" style="width:12px;height:12px;"></i> ${p.nombre}</button>`).join('');
    iconos();
  }

  async function cargar(nombre, area) {
    if (!confirm('Se crea "' + nombre + '" en el reloj, con su nombre real y ya vinculado.\n¿Dale?')) return;
    const j = await api('/api/cargar', { nombre, area });
    showToast(j.ok ? nombre + ' → PIN ' + j.pin + ' (se crea cuando el reloj lo tome)' : 'Error: ' + (j.error || '?'), j.ok ? undefined : 'err');
    setTimeout(load, 1500);
  }

  /* ── sincronización a Registros ── */
  async function toggleSync() {
    if (!_syncOn && !confirm('¿ACTIVAR la subida real a la tabla registros de Supabase?\n' +
      'A partir de acá, cada marca crea/actualiza el registro del día en la página.\n' +
      'Los registros cargados a mano SIEMPRE se respetan.')) return;
    const j = await api('/api/sync_registros', { on: !_syncOn });
    showToast(j.on ? 'Subida a registros ACTIVADA — el reloj ya computa de verdad' : 'Subida apagada — vuelve a solo-manual');
    load();
  }

  async function borrarPruebas() {
    if (!confirm('¿Borrar TODAS las marcas de prueba acumuladas hasta ahora?\n\n' +
      '• Los vínculos y usuarios NO se tocan — solo las marcas.\n' +
      '• También se le pide al reloj borrar su memoria de marcaciones.\n' +
      '• Ideal hacerlo justo ANTES de activar el switch, para arrancar limpio.')) return;
    if (!confirm('Última confirmación: esto no se puede deshacer. ¿Borrar?')) return;
    const j = await api('/api/borrar_pruebas', {});
    showToast(j.ok ? '✔ ' + j.borrados + ' marcas de prueba borradas — arranque limpio' : 'Error', j.ok ? undefined : 'err');
    _previewAbierta = true;
    renderPreview();
    load();
  }

  async function syncHoy() {
    _previewAbierta = true;
    await renderPreview();
    if (_syncOn) {
      const j = await api('/api/sync_dia', {});
      showToast(j.ok ? 'Día subido a Registros de verdad' : 'Error al subir', j.ok ? undefined : 'err');
    }
  }

  async function renderPreview() {
    const p = await api('/api/preview_dia');
    const cont = document.getElementById('rjPreview');
    if (!p.registros || !p.registros.length) {
      cont.innerHTML = '<span style="color:rgba(198,201,215,.45);font-size:12px;">Sin marcas hoy todavía.</span>';
      return;
    }
    const filas = p.registros.map(r => `<tr>
      <td>${r.fecha}</td><td><b>${r.nombre}</b></td>
      <td style="font-size:11px;color:rgba(198,201,215,.6);">${r.area || '—'}</td>
      <td style="font-size:11px;">${r.turno || '—'}</td>
      <td>${(r.hora_entrada || '—').slice(0, 5)}</td>
      <td>${(r.hora_salida || '—').slice(0, 5)}</td>
      <td>${(r.hora_entrada2 || '—').slice(0, 5)}</td>
      <td>${(r.hora_salida2 || '—').slice(0, 5)}</td>
      <td style="font-size:11px;color:var(--one-gold);">${r.observaciones}</td>
    </tr>`).join('');
    cont.innerHTML = `
      <div style="font-family:var(--font-title);font-weight:800;font-size:12px;margin-bottom:5px;">
        Así queda HOY (${p.fecha}) — se actualiza solo con cada marca
        ${_syncOn ? '<span class="rj-badge-ok">SUBIENDO de verdad</span>' : '<span class="rj-badge-warn">vista previa — nada sube</span>'}
      </div>
      <div style="overflow:auto;border-radius:10px;border:1px solid rgba(198,201,215,.09);">
        <table class="reloj-tbl" style="border-collapse:collapse;width:100%;font-size:12px;">
          <thead><tr><th>Fecha</th><th>Nombre</th><th>Área</th><th>Turno</th>
            <th>Entrada</th><th>Salida</th><th>Ent. 2</th><th>Sal. 2</th><th>Obs</th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>`;
  }

  /* ── acciones chicas ── */
  async function hora() {
    const j = await api('/api/hora', {});
    msg(j.ok ? 'hora encolada (' + j.hora_pc + ')' : 'error');
  }

  async function reboot() {
    if (!confirm('¿Reiniciar el reloj? Tarda ~1 minuto en volver.')) return;
    const j = await api('/api/reboot', {});
    msg(j.ok ? 'reinicio encolado' : 'error');
  }

  function msg(t) { document.getElementById('rjAccMsg').textContent = t; }

  function iconos() { if (window.lucide) lucide.createIcons(); }

  return { start, marcarCambio, guardarTodos, borrar, cargar, toggleSync, syncHoy, borrarPruebas, hora, reboot };
})();
