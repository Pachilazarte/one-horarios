// js/dashboard.js
const Dashboard = (() => {
  let _cA=null,_cP=null,_cD=null;
  const _dest=c=>{if(c){try{c.destroy();}catch(e){}}};

  async function load(){
    const per=document.getElementById('dPer').value;
    const area=document.getElementById('dArea').value;
    const{desde,hasta}=getDateRange(per);

    let q=SB.from('registros').select('*').order('fecha',{ascending:true});
    if(desde)q=q.gte('fecha',desde);
    if(hasta)q=q.lte('fecha',hasta);
    if(area)q=q.eq('area',area);
    const{data,error}=await q;
    if(error){showToast('Error dashboard','err');return;}
    const rows=data||[];

    // Cargar horarios semanales del período para horas extra
    let qH=SB.from('horarios_semanales').select('*');
    if(desde)qH=qH.gte('semana_desde',desde);
    if(hasta)qH=qH.lte('semana_hasta',hasta);
    if(area)qH=qH.eq('area',area);
    const{data:hsData}=await qH;
    const hs=hsData||[];

    _kpis(rows,hs);
    _chartArea(rows);
    _chartPunt(rows);
    _chartDia(rows);
    _topTard(rows);
    _areaTable(rows);
    _extraTable(rows,hs);
  }

  function _kpis(rows,hs){
    document.getElementById('kT').textContent=rows.length;
    document.getElementById('kP').textContent=new Set(rows.map(r=>r.nombre)).size;

    // Tardanza: usa el horario planificado guardado en el campo turno
    const withPlan=rows.filter(r=>{
      if(!r.turno||!r.hora_entrada)return false;
      const planEnt=r.turno.split('→')[0].trim();
      return planEnt.match(/^\d{2}:\d{2}$/);
    });
    const diffs=withPlan.map(r=>{
      const planEnt=r.turno.split('→')[0].trim();
      return calcTardVsPlan(planEnt,r.hora_entrada.slice(0,5));
    }).filter(d=>d!==null);

    const puntuales=diffs.filter(d=>d<=0).length;
    const tardes=diffs.filter(d=>d>0).length;
    const prom=diffs.length?Math.round(diffs.reduce((a,b)=>a+b,0)/diffs.length):0;

    const kTd=document.getElementById('kTd');
    kTd.textContent=(prom>0?'+':'')+prom+' min';
    kTd.style.color=prom>5?'var(--color-danger-text)':'var(--color-success-text)';
    const sub=document.getElementById('kTdSub');
    if(sub)sub.textContent=diffs.length?`sobre ${diffs.length} registros`:'';

    document.getElementById('kPunt').textContent=puntuales;
    document.getElementById('kTarde').textContent=tardes;

    const conHs=rows.filter(r=>r.hora_entrada&&r.hora_salida);
    const tot=conHs.reduce((acc,r)=>{const h=calcHs(r.hora_entrada.slice(0,5),r.hora_salida.slice(0,5));return h?acc+h:acc;},0);
    document.getElementById('kH').textContent=conHs.length?fmtHs(tot/conHs.length):'—';

    // Horas extra
    const kE=document.getElementById('kExtra');
    if(kE&&hs.length){
      const dias=['lunes','martes','miercoles','jueves','viernes','sabado'];
      const personas=[...new Set(hs.map(h=>h.nombre))];
      let count=0;
      personas.forEach(nombre=>{
        const plans=hs.filter(h=>h.nombre===nombre);
        let plan=0;
        plans.forEach(p=>{dias.forEach(d=>{const h=calcHs(p[d+'_entrada']?.slice(0,5),p[d+'_salida']?.slice(0,5));if(h)plan+=h;});});
        const real=rows.filter(r=>r.nombre===nombre&&r.hora_entrada&&r.hora_salida)
          .reduce((acc,r)=>{const h=calcHs(r.hora_entrada.slice(0,5),r.hora_salida.slice(0,5));return h?acc+h:acc;},0);
        if(real>plan&&plan>0)count++;
      });
      kE.textContent=count;
    }
  }

  function _chartArea(rows){
    _dest(_cA);
    const counts=AREAS.map(a=>rows.filter(r=>r.area===a).length);
    const ctx=document.getElementById('chartArea').getContext('2d');
    _cA=new Chart(ctx,{type:'doughnut',data:{labels:AREAS.map(a=>a.split(' ')[0]),datasets:[{data:counts,backgroundColor:AREAS.map(a=>areaColorHex(a)+'55'),borderColor:AREAS.map(a=>areaColorHex(a)),borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'rgba(198,201,215,.75)',font:{size:11},boxWidth:12}}}}});
  }

  function _chartPunt(rows){
    _dest(_cP);
    const areas=AREAS.filter(a=>rows.some(r=>r.area===a));
    const punt=areas.map(a=>{
      const ar=rows.filter(r=>r.area===a&&r.turno&&r.hora_entrada&&r.turno.includes(':'));
      if(!ar.length)return 0;
      const p=ar.filter(r=>{const e=r.turno.split('→')[0].trim();return e.match(/^\d{2}:\d{2}$/)&&calcTardVsPlan(e,r.hora_entrada.slice(0,5))<=0;});
      return Math.round(p.length/ar.length*100);
    });
    const ctx=document.getElementById('chartPunt').getContext('2d');
    _cP=new Chart(ctx,{type:'bar',data:{labels:areas.map(a=>a.split(' ')[0]),datasets:[{label:'% puntualidad',data:punt,backgroundColor:areas.map(a=>areaColorHex(a)+'55'),borderColor:areas.map(a=>areaColorHex(a)),borderWidth:2,borderRadius:6}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{min:0,max:100,ticks:{color:'rgba(198,201,215,.6)',font:{size:10}},grid:{color:'rgba(198,201,215,.07)'}},x:{ticks:{color:'rgba(198,201,215,.6)',font:{size:10}},grid:{display:false}}},plugins:{legend:{display:false}}}});
  }

  function _chartDia(rows){
    _dest(_cD);
    const by={};rows.forEach(r=>{by[r.fecha]=(by[r.fecha]||0)+1;});
    const dates=Object.keys(by).sort();
    const ctx=document.getElementById('chartDia').getContext('2d');
    _cD=new Chart(ctx,{type:'line',data:{labels:dates.map(d=>fmtDate(d)),datasets:[{label:'Registros',data:dates.map(d=>by[d]),borderColor:'#6be1e3',backgroundColor:'rgba(107,225,227,.10)',fill:true,tension:.35,pointBackgroundColor:'#6be1e3',pointRadius:4,pointHoverRadius:6}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{ticks:{color:'rgba(198,201,215,.6)',font:{size:10},stepSize:1},grid:{color:'rgba(198,201,215,.07)'}},x:{ticks:{color:'rgba(198,201,215,.6)',font:{size:10},maxTicksLimit:8},grid:{display:false}}},plugins:{legend:{display:false}}}});
  }

  function _topTard(rows){
    const withTard=rows.filter(r=>{
      if(!r.turno||!r.hora_entrada)return false;
      const e=r.turno.split('→')[0].trim();
      return e.match(/^\d{2}:\d{2}$/)&&calcTardVsPlan(e,r.hora_entrada.slice(0,5))>0;
    }).map(r=>({...r,diff:calcTardVsPlan(r.turno.split('→')[0].trim(),r.hora_entrada.slice(0,5))}))
    .sort((a,b)=>b.diff-a.diff).slice(0,8);
    const el=document.getElementById('topTard');
    if(!withTard.length){el.innerHTML='<div style="color:rgba(198,201,215,.4);font-size:13px;text-align:center;padding:20px;">✓ Sin tardanzas</div>';return;}
    el.innerHTML=withTard.map(r=>`<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
      <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
        <span style="color:${areaColor(r.area)};font-size:10px;font-weight:800;white-space:nowrap;">${r.area.split(' ')[0]}</span>
        <span style="font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.nombre}</span>
        <span style="font-size:11px;color:rgba(198,201,215,.5);">${fmtDate(r.fecha)}</span>
      </div>
      <span class="badge badge-red" style="flex-shrink:0;">+${r.diff}m</span>
    </div>`).join('');
  }

  function _areaTable(rows){
    const tbody=document.getElementById('tbArea');
    tbody.innerHTML=AREAS.map(a=>{
      const ar=rows.filter(r=>r.area===a);if(!ar.length)return'';
      const withP=ar.filter(r=>r.turno&&r.hora_entrada&&r.turno.includes(':'));
      const diffs=withP.map(r=>{const e=r.turno.split('→')[0].trim();return e.match(/^\d{2}:\d{2}$/)?calcTardVsPlan(e,r.hora_entrada.slice(0,5)):null;}).filter(d=>d!==null);
      const prom=diffs.length?Math.round(diffs.reduce((x,y)=>x+y,0)/diffs.length):null;
      const punt=diffs.filter(d=>d<=0).length;
      return`<tr>
        <td style="color:${areaColor(a)};font-weight:800;font-size:11px;">${a.split(' ')[0]}</td>
        <td style="font-weight:700;">${ar.length}</td>
        <td>${prom===null?'—':`<span class="badge ${prom>5?'badge-red':'badge-green'}">${prom>0?'+':''}${prom}m</span>`}</td>
        <td>${diffs.length?`<span class="badge badge-green">${punt}/${diffs.length}</span>`:'—'}</td>
      </tr>`;
    }).join('');
  }

  function _extraTable(regs,hs){
    const el=document.getElementById('tbExtra');if(!el)return;
    const dias=['lunes','martes','miercoles','jueves','viernes','sabado'];
    const personas=[...new Set(hs.map(h=>h.nombre))];
    const resultados=personas.map(nombre=>{
      const plans=hs.filter(h=>h.nombre===nombre);
      const area=plans[0]?.area||'';
      let plan=0;
      plans.forEach(p=>{dias.forEach(d=>{const h=calcHs(p[d+'_entrada']?.slice(0,5),p[d+'_salida']?.slice(0,5));if(h)plan+=h;});});
      const real=regs.filter(r=>r.nombre===nombre&&r.hora_entrada&&r.hora_salida)
        .reduce((acc,r)=>{const h=calcHs(r.hora_entrada.slice(0,5),r.hora_salida.slice(0,5));return h?acc+h:acc;},0);
      return{nombre,area,plan,real,extra:real-plan};
    }).filter(r=>Math.abs(r.extra)>0.05).sort((a,b)=>b.extra-a.extra);

    if(!resultados.length){el.innerHTML='<tr><td colspan="5" style="text-align:center;padding:24px;color:rgba(198,201,215,.3);">Sin datos de horas extra</td></tr>';return;}
    el.innerHTML=resultados.map(r=>`<tr>
      <td><span style="color:${areaColor(r.area)};font-weight:800;font-size:11px;">${r.area.split(' ')[0]}</span></td>
      <td style="font-weight:700;">${r.nombre}</td>
      <td><span class="badge badge-cyan">${fmtHs(r.plan)}</span></td>
      <td><span class="badge badge-cyan">${fmtHs(r.real)}</span></td>
      <td><span class="badge ${r.extra>0?'badge-gold':'badge-green'}">${r.extra>0?'+':''}${fmtHs(Math.abs(r.extra))} ${r.extra>0?'extra':'menos'}</span></td>
    </tr>`).join('');
  }

  return{load};
})();
