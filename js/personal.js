// js/personal.js
const Personal = (() => {
  let all=[], filtArea='';

  async function load() {
    const {data}=await SB.from('personal').select('*').order('area').order('nombre');
    all=data||[];
    const el=document.getElementById('pCnt');
    if(el) el.textContent=`${all.length} personas en total`;
    render();
  }

  function filterArea(area) {
    filtArea=area;
    document.querySelectorAll('[id^="pb-"]').forEach(b=>b.classList.remove('active'));
    document.getElementById('pb-'+area)?.classList.add('active');
    render();
  }

  function render() {
    const rows=filtArea?all.filter(p=>p.area===filtArea):all;
    const tb=document.getElementById('tbP');
    if(!rows.length){tb.innerHTML=`<tr><td colspan="6" style="text-align:center;padding:40px;color:rgba(198,201,215,.3);">Sin personal</td></tr>`;return;}
    tb.innerHTML=rows.map((p,i)=>`<tr>
      <td><span class="num-badge">${i+1}</span></td>
      <td style="font-weight:700;">${p.nombre}</td>
      <td style="color:rgba(198,201,215,.58);font-size:13px;">${p.rol||'—'}</td>
      <td><span style="color:${areaColor(p.area)};font-weight:800;font-size:11px;">${p.area}</span></td>
      <td><span class="badge ${p.activo?'badge-green':'badge-red'}">${p.activo?'Activo':'Inactivo'}</span></td>
      <td class="no-print"><div style="display:flex;gap:4px;">
        <button class="btn btn-ghost" style="padding:4px 8px;font-size:11px;" onclick="Personal.openEdit('${p.id}')">✏</button>
        <button class="btn btn-danger" onclick="Personal.del('${p.id}')">✕</button>
      </div></td>
    </tr>`).join('');
  }

  function openNew(){
    document.getElementById('mpId').value='';document.getElementById('mpN').value='';
    document.getElementById('mpR').value='';document.getElementById('mpA').value='';
    document.getElementById('mpAc').checked=true;
    document.getElementById('mPT').textContent='Agregar Persona';
    document.getElementById('btnSP').textContent='Guardar';
    document.getElementById('mPers').style.display='';
  }

  function openEdit(id){
    const p=all.find(x=>x.id===id);if(!p)return;
    document.getElementById('mpId').value=id;document.getElementById('mpN').value=p.nombre;
    document.getElementById('mpR').value=p.rol||'';document.getElementById('mpA').value=p.area;
    document.getElementById('mpAc').checked=p.activo;
    document.getElementById('mPT').textContent='Editar Persona';
    document.getElementById('btnSP').textContent='Actualizar';
    document.getElementById('mPers').style.display='';
  }

  function closeModal(){document.getElementById('mPers').style.display='none';}

  async function save(){
    const id=document.getElementById('mpId').value;
    const nombre=document.getElementById('mpN').value.trim();
    const rol=document.getElementById('mpR').value.trim();
    const area=document.getElementById('mpA').value;
    const activo=document.getElementById('mpAc').checked;
    if(!nombre||!area){showToast('Nombre y área obligatorios','err');return;}
    let err;
    if(id)({error:err}=await SB.from('personal').update({nombre,rol,area,activo}).eq('id',id));
    else  ({error:err}=await SB.from('personal').insert({nombre,rol,area,activo}));
    if(err){showToast('Error: '+err.message,'err');return;}
    showToast(id?'Actualizado':'Persona agregada');
    closeModal();load();
  }

  async function del(id){
    if(!confirm('¿Eliminar esta persona?'))return;
    const{error}=await SB.from('personal').delete().eq('id',id);
    if(error){showToast('Error','err');return;}
    showToast('Eliminado');load();
  }

  return{load,filterArea,render,openNew,openEdit,closeModal,save,del};
})();
window.filtPA=area=>Personal.filterArea(area);
