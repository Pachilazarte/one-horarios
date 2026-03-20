// js/registros.js
const Registros = (() => {
  let allRegs=[];

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
    const { desde, hasta } = getDateRange(per);
    let q = SB.from('registros').select('*').order('fecha',{ascending:false}).order('created_at',{ascending:false});
    if(desde) q=q.gte('fecha',desde);
    if(hasta) q=q.lte('fecha',hasta);
    if(area)  q=q.eq('area',area);
    const{data,error}=await q;
    if(error){showToast('Error al cargar','err');return;}
    allRegs=data||[];
    render();
  }

  function render(){
    const busq=(document.getElementById('fBusq')?.value||'').toLowerCase();
    const rows=allRegs.filter(r=>!busq||r.nombre.toLowerCase().includes(busq)||(r.rol||'').toLowerCase().includes(busq));
    const tbody=document.getElementById('tbR');
    if(!rows.length){tbody.innerHTML=`<tr><td colspan="12" style="text-align:center;padding:40px;color:rgba(198,201,215,.28);">Sin registros</td></tr>`;return;}

    tbody.innerHTML=rows.map((r,i)=>{
      const hs=calcHs(r.hora_entrada?.slice(0,5),r.hora_salida?.slice(0,5));
      let diff=null;
      const turno = r.turno||'';
      // No calculamos tardanza para flex y guardia
      const esFlex    = turno==='Flex';
      const esGuardia = turno==='Guardia';
      if(!esFlex && !esGuardia && turno.includes(':') && r.hora_entrada){
        const planEnt=turno.split('→')[0].trim();
        if(planEnt.match(/^\d{2}:\d{2}$/)) diff=calcTardVsPlan(planEnt,r.hora_entrada.slice(0,5));
      }
      const col=areaColor(r.area);

      // Badge especial para flex/guardia
      let tardCell;
      if(esFlex)    tardCell='<span class="badge badge-purple">🔄 Flex</span>';
      else if(esGuardia) tardCell='<span class="badge badge-gold">🛡 Guardia</span>';
      else          tardCell=tardBadge(diff);

      return`<tr>
        <td style="color:rgba(198,201,215,.3);font-size:11px;">${i+1}</td>
        <td><span style="color:${col};font-weight:800;font-size:11px;">${r.area.split(' / ')[0]}</span></td>
        <td style="font-weight:700;">${r.nombre}</td>
        <td class="hide-mobile" style="color:rgba(198,201,215,.58);font-size:12px;">${r.rol||'—'}</td>
        <td style="white-space:nowrap;">${fmtDate(r.fecha)}</td>
        <td class="hide-mobile" style="font-size:12px;color:rgba(198,201,215,.6);">${turno||'—'}</td>
        <td style="font-weight:700;">${r.hora_entrada?.slice(0,5)||'—'}</td>
        <td style="color:rgba(198,201,215,.62);">${r.hora_salida?.slice(0,5)||'—'}</td>
        <td><span class="badge badge-cyan">${hs!==null?fmtHs(hs):'—'}</span></td>
        <td>${tardCell}</td>
        <td class="hide-mobile" style="color:rgba(198,201,215,.42);font-size:12px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.observaciones||'—'}</td>
        <td class="no-print"><div style="display:flex;gap:4px;">
          <button class="btn btn-ghost" style="padding:4px 8px;font-size:11px;" onclick="Registros.openEdit('${r.id}')">✏</button>
          <button class="btn btn-danger" onclick="Registros.del('${r.id}')">✕</button>
        </div></td>
      </tr>`;
    }).join('');
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
    // Si el nombre actual no está en la lista (baja), lo agrega igual
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
    document.getElementById('mReg').style.display='';
    // Cargar nombres del área
    _cargarNombresModal(r.area||'', r.nombre||'');
  }
  function closeModal(){document.getElementById('mReg').style.display='none';}

  function _onAreaChange(area) {
    _cargarNombresModal(area, '');
  }

  async function save(){
    const id=document.getElementById('erId').value;
    const area=document.getElementById('erA').value;
    const nombre=document.getElementById('erN').value;
    const fecha=document.getElementById('erF').value;
    const t=document.getElementById('erT').value;
    const e=document.getElementById('erE').value;
    const s=document.getElementById('erS').value;
    const o=document.getElementById('erO').value;
    if(!area||!nombre||!fecha){showToast('Área, nombre y fecha son obligatorios','err');return;}
    const{error}=await SB.from('registros').update({
      area,nombre,fecha,
      turno:t||null,hora_entrada:e?e+':00':null,hora_salida:s?s+':00':null,observaciones:o||null
    }).eq('id',id);
    if(error){showToast('Error','err');return;}
    showToast('Actualizado');closeModal();load();
  }

  async function del(id){
    if(!confirm('¿Eliminar?'))return;
    const{error}=await SB.from('registros').delete().eq('id',id);
    if(error){showToast('Error','err');return;}
    showToast('Eliminado');load();
  }

  function exportCSV(){
    if(!allRegs.length){showToast('Sin datos','err');return;}
    const cols=['Área','Nombre','Rol','Fecha','Horario planificado','Hora Entrada','Hora Salida','Hs Trabajadas','Min Tardanza','Puntual','Observaciones'];
    const lines=[cols.join(',')];
    allRegs.forEach(r=>{
      const hs=calcHs(r.hora_entrada?.slice(0,5),r.hora_salida?.slice(0,5));
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
        hs!==null?hs.toFixed(2):'',diff!==null?diff:'',puntual,`"${r.observaciones||''}"`].join(','));
    });
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob(['\uFEFF'+lines.join('\n')],{type:'text/csv;charset=utf-8;'}));
    a.download=`ONE_registros_${today()}.csv`;
    a.click();showToast('CSV descargado ✓');
  }

  return{load,render,changePer,openEdit,closeModal,save,del,exportCSV,_onAreaChange};
})();