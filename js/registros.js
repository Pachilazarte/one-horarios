// js/registros.js — CON PAGINACIÓN (10 registros por página)
const Registros = (() => {
  let allRegs = [];
  let currentPage = 1;
  const regsPerPage = 10; // 10 registros por página

  function changePer(){
    const p=document.getElementById('fPer').value;
    const isCustom      = p==='custom';
    const isDiaEsp      = p==='dia_especifico';
    document.getElementById('fCDes').style.display    = isCustom ? '' : 'none';
    document.getElementById('fCHas').style.display    = isCustom ? '' : 'none';
    document.getElementById('fCDiaEsp').style.display = isDiaEsp ? '' : 'none';
    load();
  }

  async function load(){
    const per  = document.getElementById('fPer').value;
    const area = document.getElementById('fArea').value;
    
    // ✅ Manejar períodos especiales correctamente
    let desde, hasta;
    if (per === 'custom') {
      desde = document.getElementById('fDes')?.value || '';
      hasta = document.getElementById('fHas')?.value || '';
    } else if (per === 'dia_especifico') {
      const dia = document.getElementById('fDiaEsp')?.value || '';
      desde = dia;
      hasta = dia;
    } else {
      const range = getDateRange(per);
      desde = range.desde;
      hasta = range.hasta;
    }
    
    let q = SB.from('registros').select('*').order('fecha',{ascending:false}).order('created_at',{ascending:false});
    if(desde) q=q.gte('fecha',desde);
    if(hasta) q=q.lte('fecha',hasta);
    if(area)  q=q.eq('area',area);
    const{data,error}=await q;
    if(error){showToast('Error al cargar','err');return;}
    allRegs=data||[];
    currentPage = 1; // Resetear a página 1 al cambiar filtros
    render();
  }

function render(){
    const per = document.getElementById('fPer').value;
    const persona = (document.getElementById('fPersona')?.value||'').toLowerCase();
    let rows = allRegs.filter(r=>{
      if(persona && !r.nombre.toLowerCase().includes(persona)) return false;
      return true;
    });
    
    // ✅ NUEVO: Verificar si el filtro es "día específico"
    const isDiaEspecifico = per === 'dia_especifico';
    
    let paginatedRows, totalPages;

    if (isDiaEspecifico || rows.length <= 100) {
      // SIN PAGINACIÓN: Mostrar todo (día específico o menos de 100 registros)
      paginatedRows = rows;
      totalPages = 1;
      currentPage = 1;
    } else {
      // CON PAGINACIÓN: Más de 100 registros y no es día específico
      totalPages = Math.ceil(rows.length / regsPerPage);
      const startIdx = (currentPage - 1) * regsPerPage;
      const endIdx = startIdx + regsPerPage;
      paginatedRows = rows.slice(startIdx, endIdx);
    }
    
    const tbody=document.getElementById('tbR');
    if(!rows.length){
      tbody.innerHTML=`<tr><td colspan="12" style="text-align:center;padding:40px;color:rgba(198,201,215,.28);">Sin registros</td></tr>`;
      _renderPagination(0);
      return;
    }

    tbody.innerHTML=paginatedRows.map((r,i)=>{
      // CALCULAR HORAS REALES
      const _hs1 = calcHs(r.hora_entrada?.slice(0,5), r.hora_salida?.slice(0,5));
      const _hs2 = calcHs(r.hora_entrada2?.slice(0,5), r.hora_salida2?.slice(0,5));
      const hs = (_hs1 !== null || _hs2 !== null) ? (_hs1 || 0) + (_hs2 || 0) : null;
      
      const turno=r.turno||'';
      const col=areaColor(r.area);
      const esFlex=turno==='Flex';
      const esGuardia=turno==='Guardia';
      let diff=null;
      if(!esFlex&&!esGuardia&&turno.includes(':')&&r.hora_entrada){
        const planEnt=turno.split('→')[0].trim();
        if(planEnt.match(/^\d{2}:\d{2}$/)) diff=calcTardVsPlan(planEnt,r.hora_entrada.slice(0,5));
      }
      let tardCell;
      if(esFlex)         tardCell='<span class="badge badge-purple">🔄 Flex</span>';
      else if(esGuardia) tardCell='<span class="badge badge-gold">🛡 Guardia</span>';
      else               tardCell=tardBadge(diff);

      // OBSERVACIONES
      let obsCell;
      if(r.observaciones){
        const preview=r.observaciones.length>22?r.observaciones.slice(0,22)+'…':r.observaciones;
        const safeObs=r.observaciones.replace(/\\/g,'\\\\').replace(/`/g,'\\`');
        obsCell=`<div style="display:flex;align-items:center;gap:5px;">
          <span style="color:rgba(198,201,215,.55);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:80px;">${preview}</span>
          <button onclick="Registros.showObs(\`${safeObs}\`)" title="Ver completo"
            style="flex-shrink:0;background:rgba(107,225,227,.12);border:1px solid rgba(107,225,227,.25);color:#6be1e3;border-radius:6px;padding:2px 6px;font-size:10px;cursor:pointer;font-weight:700;line-height:1.4;">👁</button>
        </div>`;
      } else {
        obsCell=`<span style="color:rgba(198,201,215,.25);">—</span>`;
      }

      // ✅ Calcular índice correcto para la tabla
      let rowNumber;
      if (paginatedRows.length === rows.length) {
        // SIN PAGINACIÓN: Usar índice directo
        rowNumber = rows.indexOf(r) + 1;
      } else {
        // CON PAGINACIÓN: Usar índice de la página actual
        const startIdx = (currentPage - 1) * regsPerPage;
        rowNumber = startIdx + i + 1;
      }

      return`<tr>
        <td style="color:rgba(198,201,215,.3);font-size:11px;">${rowNumber}</td>
        <td><span style="color:${col};font-weight:800;font-size:11px;">${r.area.split(' / ')[0]}</span></td>
        <td style="font-weight:700;">${r.nombre}</td>
        <td class="hide-mobile" style="color:rgba(198,201,215,.58);font-size:12px;">${r.rol||'—'}</td>
        <td style="white-space:nowrap;">${fmtDate(r.fecha)}</td>
        <td class="hide-mobile" style="font-size:12px;color:rgba(198,201,215,.6);">${turno||'—'}</td>
        <td style="font-weight:700;">${r.hora_entrada?.slice(0,5)||'—'}</td>
        <td style="color:rgba(198,201,215,.62);">${r.hora_salida?.slice(0,5)||'—'}</td>
        <td><span class="badge badge-cyan">${hs!==null?fmtHs(hs):'—'}</span></td>
        <td>${tardCell}</td>
        <td class="hide-mobile">${obsCell}</td>
        <td class="no-print"><div style="display:flex;gap:4px;">
          <button class="btn btn-ghost" style="padding:4px 8px;font-size:11px;" onclick="Registros.openEdit('${r.id}')">✏</button>
          <button class="btn btn-danger" onclick="Registros.del('${r.id}')">✕</button>
        </div></td>
      </tr>`;
    }).join('');
    
    _renderPagination(totalPages);
  }

  // ✅ PAGINACIÓN: Renderizar números de página
  function _renderPagination(totalPages){
    const paginationEl = document.getElementById('paginacion');
    if(!paginationEl) return;
    
    if(totalPages <= 1){
      paginationEl.innerHTML = '';
      return;
    }

    let html = '';
    
    // Botón anterior
    if(currentPage > 1){
      html += `<button class="btn btn-ghost" style="padding:6px 12px;font-size:12px;" onclick="Registros.goToPage(${currentPage-1})">← Anterior</button>`;
    }

    // Números de página
    for(let i=1; i<=totalPages; i++){
      if(i === currentPage){
        html += `<button class="btn btn-primary" style="padding:6px 12px;font-size:12px;min-width:40px;background:rgba(107,225,227,.25);border-color:#6be1e3;color:#6be1e3;font-weight:700;">${i}</button>`;
      } else {
        html += `<button class="btn btn-ghost" style="padding:6px 12px;font-size:12px;min-width:40px;" onclick="Registros.goToPage(${i})">${i}</button>`;
      }
    }

    // Botón siguiente
    if(currentPage < totalPages){
      html += `<button class="btn btn-ghost" style="padding:6px 12px;font-size:12px;" onclick="Registros.goToPage(${currentPage+1})">Siguiente →</button>`;
    }

    paginationEl.innerHTML = html;
  }

  // ✅ NUEVA FUNCIÓN: Ir a página específica
  function goToPage(page){
    currentPage = page;
    render();
    // Scroll a la tabla
    document.querySelector('.glass.tbl-wrap')?.scrollIntoView({behavior:'smooth'});
  }

  // POPUP OBSERVACIÓN
  function showObs(text){
    document.getElementById('obsPopup')?.remove();
    const overlay=document.createElement('div');
    overlay.id='obsPopup';
    overlay.style.cssText='position:fixed;inset:0;z-index:500;background:rgba(0,0,0,.7);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.innerHTML=`
      <div style="background:#13111c;border:1px solid rgba(107,225,227,.22);border-radius:16px;padding:24px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.6);animation:fu .2s ease both;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px;">
          <div style="font-size:12px;font-weight:700;color:rgba(107,225,227,.7);text-transform:uppercase;letter-spacing:.07em;">💬 Observación completa</div>
          <button onclick="document.getElementById('obsPopup').remove()" style="background:none;border:none;color:rgba(198,201,215,.5);font-size:20px;cursor:pointer;line-height:1;">✕</button>
        </div>
        <div style="background:rgba(255,255,255,.05);border:1px solid rgba(198,201,215,.1);border-radius:10px;padding:14px 16px;font-size:14px;line-height:1.6;color:rgba(255,255,255,.88);word-break:break-word;">${text}</div>
        <button onclick="document.getElementById('obsPopup').remove()" style="margin-top:16px;width:100%;padding:10px;border-radius:10px;background:rgba(107,225,227,.12);border:1px solid rgba(107,225,227,.28);color:#6be1e3;font-weight:700;font-size:13px;cursor:pointer;">Cerrar</button>
      </div>`;
    overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
    document.body.appendChild(overlay);
  }

  async function _cargarNombresModal(area, nombreActual='') {
    const sel = document.getElementById('erN');
    if (!sel) return;
    sel.innerHTML = '<option value="">Cargando...</option>';
    const { data } = await SB.from('personal')
      .select('nombre').eq('area', area).eq('activo', true).order('nombre');
    sel.innerHTML = '<option value="">Seleccionar...</option>';
    (data || []).forEach(p => {
      const o = document.createElement('option');
      o.value = p.nombre;
      o.textContent = p.nombre;
      if (p.nombre === nombreActual) o.selected = true;
      sel.appendChild(o);
    });
    if (nombreActual && !(data || []).find(p => p.nombre === nombreActual)) {
      const o = document.createElement('option');
      o.value = nombreActual; o.textContent = nombreActual + ' (inactivo)'; o.selected = true;
      sel.insertBefore(o, sel.children[1]);
    }
  }

  function openEdit(id){
    const r=allRegs.find(x=>x.id===id);if(!r)return;
    document.getElementById('erId').value=id;
    document.getElementById('erA').value=r.area||'';
    document.getElementById('erF').value=r.fecha||'';
    document.getElementById('erT').value=r.turno||'';
    document.getElementById('erE').value=r.hora_entrada?.slice(0,5)||'';
    document.getElementById('erS').value=r.hora_salida?.slice(0,5)||'';
    document.getElementById('erO').value=r.observaciones||'';
    document.getElementById('erE2').value = r.hora_entrada2?.slice(0,5) || '';
    document.getElementById('erS2').value = r.hora_salida2?.slice(0,5) || '';
    document.getElementById('mReg').style.display='';
    _cargarNombresModal(r.area||'', r.nombre||'');
  }
  function closeModal(){document.getElementById('mReg').style.display='none';}

  function _onAreaChange(area) {
    _cargarNombresModal(area, '');
  }

  async function save(){
    const id    = document.getElementById('erId').value;
    const area  = document.getElementById('erA').value;
    const nombre= document.getElementById('erN').value;
    const fecha = document.getElementById('erF').value;
    const t     = document.getElementById('erT').value;
    const e     = document.getElementById('erE').value;
    const s     = document.getElementById('erS').value;
    const e2    = document.getElementById('erE2').value;
    const s2    = document.getElementById('erS2').value;
    const o     = document.getElementById('erO').value.trim();
    if(!area||!nombre||!fecha){showToast('Área, nombre y fecha son obligatorios','err');return;}

    const original = allRegs.find(x=>x.id===id);

    const{error}=await SB.from('registros').update({
      area,nombre,fecha,
      turno:t||null,
      hora_entrada:e?e+':00':null,
      hora_salida:s?s+':00':null,
      hora_entrada2:e2?e2+':00':null,
      hora_salida2:s2?s2+':00':null,
      observaciones:o||null
    }).eq('id',id);
    
    if(error){showToast('Error','err');return;}
    showToast('Actualizado');
    closeModal();

    const hoy = today();
    const fueraDeTerm = fecha < hoy;
    const cambios = [];
    if (original) {
      if (original.hora_entrada?.slice(0,5) !== e) cambios.push(`entrada: ${original.hora_entrada?.slice(0,5)||'—'} → ${e||'—'}`);
      if (original.hora_salida?.slice(0,5)  !== s) cambios.push(`salida: ${original.hora_salida?.slice(0,5)||'—'} → ${s||'—'}`);
      if (original.fecha !== fecha)                cambios.push(`fecha: ${original.fecha} → ${fecha}`);
      if (original.turno !== t)                    cambios.push(`turno: ${original.turno||'—'} → ${t||'—'}`);
    }
    await logActividad(
      'registro_editado', area, nombre,
      `Registro del ${fecha} editado para ${nombre}`,
      {
        fecha,
        turno: t,
        entrada: e, salida: s,
        cambios: cambios.length ? cambios.join(' | ') : 'campos actualizados',
      },
      fueraDeTerm
    );

    load();
  }

  async function del(id){
    const r = allRegs.find(x=>x.id===id);
    if(!confirm(`¿Eliminar registro de ${r?.nombre||'?'} del ${r?.fecha||'?'}?`))return;
    const{error}=await SB.from('registros').delete().eq('id',id);
    if(error){showToast('Error','err');return;}
    showToast('Eliminado');

    if (r) {
      const hoy = today();
      await logActividad(
        'registro_eliminado', r.area, r.nombre,
        `Registro del ${r.fecha} eliminado (${r.hora_entrada?.slice(0,5)||'—'} → ${r.hora_salida?.slice(0,5)||'—'})`,
        { fecha: r.fecha, turno: r.turno, entrada: r.hora_entrada?.slice(0,5), salida: r.hora_salida?.slice(0,5) },
        r.fecha < hoy
      );
    }

    load();
  }

  function exportCSV(){
    if(!allRegs.length){showToast('Sin datos','err');return;}
    const cols=['Área','Nombre','Rol','Fecha','Horario planificado','Hora Entrada','Hora Salida', 'Hora Entrada 2', 'Hora Salida 2', 'Hs Trabajadas','Min Tardanza','Puntual','Observaciones'];
    const lines=[cols.join(',')];
    allRegs.forEach(r=>{
      const _hs1 = calcHs(r.hora_entrada?.slice(0,5), r.hora_salida?.slice(0,5));
      const _hs2 = calcHs(r.hora_entrada2?.slice(0,5), r.hora_salida2?.slice(0,5));
      const hs = (_hs1 !== null || _hs2 !== null) ? (_hs1 || 0) + (_hs2 || 0) : null;
      
      const turno=r.turno||'';
      const esFlex=turno==='Flex', esGuardia=turno==='Guardia';
      let diff=null;
      if(!esFlex&&!esGuardia&&turno.includes(':')&&r.hora_entrada){
        const planEnt=turno.split('→')[0].trim();
        if(planEnt.match(/^\d{2}:\d{2}$/)) diff=calcTardVsPlan(planEnt,r.hora_entrada.slice(0,5));
      }
      const puntual = esFlex||esGuardia ? 'N/A' : (diff!==null?(diff<=0?'SÍ':'NO'):'');
      lines.push([`"${r.area}"`,`"${r.nombre}"`,`"${r.rol||''}"`,`"${r.fecha}"`,`"${turno}"`,
        `"${r.hora_entrada?.slice(0,5)||''}"`,`"${r.hora_salida?.slice(0,5)||''}"`,
        `"${r.hora_entrada2?.slice(0,5)||''}"`,`"${r.hora_salida2?.slice(0,5)||''}"`,
        hs!==null?hs.toFixed(2):'',diff!==null?diff:'',puntual,`"${r.observaciones||''}"`].join(','));
    });
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob(['\uFEFF'+lines.join('\n')],{type:'text/csv;charset=utf-8;'}));
    a.download=`ONE_registros_${today()}.csv`;
    a.click();showToast('CSV descargado ✓');
  }

  return{load,render,changePer,openEdit,closeModal,save,del,exportCSV,_onAreaChange,showObs,goToPage};
})();