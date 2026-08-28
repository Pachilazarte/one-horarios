// js/reloj.js — panel del reloj biométrico (lee el servidor ADMS local)
// ⚙ El servidor del reloj corre en la X270 (backend fijo de Escencial).
// El dominio se auto-corrige solo si la IP de la X270 cambia (cron en la X270).
const RELOJ_API = 'http://reloj.escencialconsultora.com:8081';

const $ = id => document.getElementById(id);
let ultimoTotal = null;

document.addEventListener('DOMContentLoaded', () => {
  $('linkPanel').href = RELOJ_API + '/';
  refrescar();
  setInterval(refrescar, 5000);
});

async function refrescar() {
  try {
    const [estado, fichajes, registros] = await Promise.all([
      fetch(RELOJ_API + '/api/estado').then(r => r.json()),
      fetch(RELOJ_API + '/api/fichajes?limit=200').then(r => r.json()),
      fetch(RELOJ_API + '/api/registros').then(r => r.json()),
    ]);
    pintarEstado(estado);
    pintarFichajes(fichajes);
    pintarRegistros(registros);
  } catch (e) {
    // el servidor del reloj no responde (PC apagada o fuera de la red)
    const pill = $('estadoPill');
    pill.className = 'estado-pill estado-offline';
    pill.textContent = '⚠ sin conexión al servidor';
    const av = $('avisoOffline');
    av.style.display = 'block';
    av.textContent = 'No se pudo conectar al servidor del reloj (' + RELOJ_API + '). ' +
      'Verificá que la PC del servidor esté prendida y en la misma red.';
  }
}

function pintarEstado(e) {
  const pill = $('estadoPill');
  if (e.online) {
    pill.className = 'estado-pill estado-online';
    pill.textContent = '🟢 Reloj en línea';
    $('avisoOffline').style.display = 'none';
  } else {
    pill.className = 'estado-pill estado-offline';
    pill.textContent = '🔌 Reloj fuera de línea';
    const av = $('avisoOffline');
    av.style.display = 'block';
    av.textContent = 'El reloj no habla con el servidor desde: ' + (e.ultima_vez || 'nunca') +
      '. Las marcas que se hagan igual quedan guardadas en el equipo y suben solas cuando vuelva.';
  }
  $('kFichajes').textContent = e.fichajes ?? '—';
  $('kPersonas').textContent = (e.usuarios || []).length;
  $('kUltima').textContent = e.ultima_vez ? e.ultima_vez.slice(11, 16) : '—';
}

function pintarFichajes(lista) {
  const tb = $('tbodyFichajes');
  if (!lista.length) {
    tb.innerHTML = '<tr><td colspan="6" class="vacio">Sin marcas todavía — cuando alguien apoye el dedo, aparece acá.</td></tr>';
    return;
  }
  const hoy = new Date().toISOString().slice(0, 10);
  $('kMarcasHoy').textContent = lista.filter(f => f.fecha_hora.startsWith(hoy)).length;

  // resaltar filas nuevas cuando cambia el total
  const esNuevo = ultimoTotal !== null && lista.length !== ultimoTotal;
  ultimoTotal = lista.length;

  tb.innerHTML = lista.map((f, i) => `
    <tr class="${esNuevo && i === 0 ? 'fila-nueva' : ''}">
      <td>${f.fecha_hora}</td>
      <td><b>${f.nombre}</b></td>
      <td class="muted">${f.area || '—'}</td>
      <td class="muted">${f.pin}</td>
      <td><span class="badge-verify">${f.verify}</span></td>
      <td>${f.matcheado ? '<span class="badge-match">✔ vinculado</span>' : '<span class="badge-nomatch">sin matchear</span>'}</td>
    </tr>`).join('');
}

function pintarRegistros(lista) {
  const tb = $('tbodyRegistros');
  if (!lista.length) {
    tb.innerHTML = '<tr><td colspan="6" class="vacio">Sin registros todavía.</td></tr>';
    return;
  }
  tb.innerHTML = lista.map(r => `
    <tr>
      <td>${r.fecha}</td>
      <td><b>${r.nombre}</b>${r.matcheado ? '' : ' <span class="badge-nomatch">sin matchear</span>'}</td>
      <td class="muted">${r.area || '—'}</td>
      <td>${r.hora_entrada || '—'}</td>
      <td>${r.hora_salida || '<span class="muted">(sin salida)</span>'}</td>
      <td class="muted">${r.marcas}</td>
    </tr>`).join('');
}
