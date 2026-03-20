// js/dashboard.js — v2 (fix ayer/dia_especifico + top horas extra con sumatoria)
const Dashboard = (() => {
  let _cA=null,_cP=null,_cD=null;
  const _dest=c=>{if(c){try{c.destroy();}catch(e){}}};

  let _lastRows = [], _lastPer = 'semana';

  function _changeDPer(){
    const p = document.getElementById('dPer').value;
    const isDiaEsp = p === 'dia_especifico';
    const el = document.getElementById('dCDiaEsp');
    if (el) el.style.display = isDiaEsp ? '' : 'none';
    if (!isDiaEsp || document.getElementById('dDiaEsp')?.value) load();
  }

  async function load(){
    const per  = document.getElementById('dPer').value;
    const area = document.getElementById('dArea').value;
    _lastPer   = per;

    let desde, hasta;
    if (per === 'dia_especifico') {
      const dia = document.getElementById('dDiaEsp')?.value || '';
      if (!dia) return;
      desde = dia; hasta = dia;
    } else {
      const r = getDateRange(per);
      desde = r.desde; hasta = r.hasta;
    }

    let q=SB.from('registros').select('*').order('fecha',{ascending:true});
    if(desde)q=q.gte('fecha',desde);
    if(hasta)q=q.lte('fecha',hasta);
    if(area)q=q.eq('area',area);
    const{data,error}=await q;
    if(error){showToast('Error dashboard','err');return;}
    const rows=data||[];
    _lastRows = rows;

    // Para horarios semanales: buscar semanas que SE SOLAPEN con el período
    // No usar semana_hasta <= hasta porque corta la semana actual (sábado > hoy)
    let qH=SB.from('horarios_semanales').select('*');
    if(desde) qH=qH.lte('semana_desde',hasta||desde); // semana empieza antes del fin del período
    if(hasta) qH=qH.gte('semana_hasta',desde);        // semana termina después del inicio del período
    if(area)  qH=qH.eq('area',area);
    const{data:hsData}=await qH;
    const hs=hsData||[];

    _kpis(rows,hs);
    _chartArea(rows);
    _chartPunt(rows);
    _chartDia(rows);
    _topTard(rows, per);
    _topExtra(rows, per);
    _areaTable(rows);
  }

  function _kpis(rows,hs){
    document.getElementById('kT').textContent=rows.length;
    document.getElementById('kP').textContent=new Set(rows.map(r=>r.nombre)).size;

    const withPlan=rows.filter(r=>{
      if(!r.turno||!r.hora_entrada)return false;
      if(r.turno==='Flex'||r.turno==='Guardia')return false;
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

    const conHs=rows.filter(r=>r.hora_entrada&&r.hora_salida&&r.turno!=='Flex'&&r.turno!=='Guardia');
    const tot=conHs.reduce((acc,r)=>{const h=calcHs(r.hora_entrada.slice(0,5),r.hora_salida.slice(0,5));return h?acc+h:acc;},0);
    document.getElementById('kH').textContent=conHs.length?fmtHs(tot/conHs.length):'—';

    const kE=document.getElementById('kExtra');
    if(kE){
      const extraData=_calcExtraData(rows);
      const conExtra=extraData.filter(e=>e.totalExtra>0).length;
      kE.textContent=conExtra||'—';
    }
  }

  // ── Sumatoria de minutos extra post-salida por persona ──
  function _calcExtraData(rows) {
    const byPers = {};
    rows.forEach(r => {
      if (!r.turno||!r.hora_entrada||!r.hora_salida) return;
      if (r.turno==='Flex'||r.turno==='Guardia') return;
      const parts = r.turno.split('→');
      if (parts.length < 2) return;
      const planSal = parts[1].trim().slice(0,5);
      if (!planSal.match(/^\d{2}:\d{2}$/)) return;
      const salReal = r.hora_salida.slice(0,5);
      const extra   = calcHsExtra(planSal, salReal); // mins
      if (extra === null) return;
      const key = r.nombre;
      if (!byPers[key]) byPers[key] = { nombre:r.nombre, area:r.area, totalExtra:0, veces:0, dias:[] };
      byPers[key].totalExtra += extra;
      if (extra > 0) byPers[key].veces++;
      byPers[key].dias.push({ fecha:r.fecha, extra, salReal, planSal });
    });
    return Object.values(byPers).sort((a,b)=>b.totalExtra-a.totalExtra);
  }

  function _chartArea(rows){
    _dest(_cA);
    const counts=AREAS.map(a=>rows.filter(r=>r.area===a).length);
    const ctx=document.getElementById('chartArea')?.getContext('2d');
    if(!ctx) return;
    _cA=new Chart(ctx,{type:'doughnut',data:{labels:AREAS.map(a=>a.split(' ')[0]),datasets:[{data:counts,backgroundColor:AREAS.map(a=>areaColorHex(a)+'55'),borderColor:AREAS.map(a=>areaColorHex(a)),borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'rgba(198,201,215,.75)',font:{size:11},boxWidth:12}}}}});
  }

  function _chartPunt(rows){
    _dest(_cP);
    const areas=AREAS.filter(a=>rows.some(r=>r.area===a));
    const punt=areas.map(a=>{
      const ar=rows.filter(r=>r.area===a&&r.turno&&r.hora_entrada&&r.turno.includes(':')&&r.turno!=='Flex'&&r.turno!=='Guardia');
      if(!ar.length)return 0;
      const p=ar.filter(r=>{const e=r.turno.split('→')[0].trim();return e.match(/^\d{2}:\d{2}$/)&&calcTardVsPlan(e,r.hora_entrada.slice(0,5))<=0;});
      return Math.round(p.length/ar.length*100);
    });
    const ctx=document.getElementById('chartPunt')?.getContext('2d');
    if(!ctx) return;
    _cP=new Chart(ctx,{type:'bar',data:{labels:areas.map(a=>a.split(' ')[0]),datasets:[{label:'% puntualidad',data:punt,backgroundColor:areas.map(a=>areaColorHex(a)+'55'),borderColor:areas.map(a=>areaColorHex(a)),borderWidth:2,borderRadius:6}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{min:0,max:100,ticks:{color:'rgba(198,201,215,.6)',font:{size:10}},grid:{color:'rgba(198,201,215,.07)'}},x:{ticks:{color:'rgba(198,201,215,.6)',font:{size:10}},grid:{display:false}}},plugins:{legend:{display:false}}}});
  }

  function _chartDia(rows){
    _dest(_cD);
    const by={};rows.forEach(r=>{by[r.fecha]=(by[r.fecha]||0)+1;});
    const dates=Object.keys(by).sort();
    const ctx=document.getElementById('chartDia')?.getContext('2d');
    if(!ctx) return;
    _cD=new Chart(ctx,{type:'line',data:{labels:dates.map(d=>fmtDate(d)),datasets:[{label:'Registros',data:dates.map(d=>by[d]),borderColor:'#6be1e3',backgroundColor:'rgba(107,225,227,.10)',fill:true,tension:.35,pointBackgroundColor:'#6be1e3',pointRadius:4,pointHoverRadius:6}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{ticks:{color:'rgba(198,201,215,.6)',font:{size:10},stepSize:1},grid:{color:'rgba(198,201,215,.07)'}},x:{ticks:{color:'rgba(198,201,215,.6)',font:{size:10},maxTicksLimit:8},grid:{display:false}}},plugins:{legend:{display:false}}}});
  }

  // ── TOP TARDANZAS ──
  let _topTardMode = 'sum';
  function _topTard(rows, per){
    const el=document.getElementById('topTard');
    if(!el) return;

    const esDia = per==='hoy'||per==='ayer'||per==='dia_especifico';

    const withTard=rows.filter(r=>{
      if(!r.turno||!r.hora_entrada||r.turno==='Flex'||r.turno==='Guardia')return false;
      const e=r.turno.split('→')[0].trim();
      return e.match(/^\d{2}:\d{2}$/)&&calcTardVsPlan(e,r.hora_entrada.slice(0,5))>0;
    }).map(r=>({...r,diff:calcTardVsPlan(r.turno.split('→')[0].trim(),r.hora_entrada.slice(0,5))}));

    if(!withTard.length){
      el.innerHTML='<div style="color:rgba(198,201,215,.4);font-size:13px;text-align:center;padding:20px;">✓ Sin tardanzas</div>';
      return;
    }

    const modeBar = esDia ? '' : `
      <div style="display:flex;gap:5px;margin-bottom:10px;">
        <button onclick="Dashboard._setTardMode('sum')"   id="btnTardSum"   class="tab-btn ${_topTardMode==='sum'?'active':''}" style="font-size:11px;padding:4px 10px;">Σ Sumatoria</button>
        <button onclick="Dashboard._setTardMode('aisla')" id="btnTardAisla" class="tab-btn ${_topTardMode!=='sum'?'active':''}" style="font-size:11px;padding:4px 10px;">📅 Por registro</button>
      </div>`;

    let html;
    if (esDia || _topTardMode !== 'sum') {
      html = withTard.sort((a,b)=>b.diff-a.diff).slice(0,8).map(r=>`
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
            <span style="color:${areaColor(r.area)};font-size:10px;font-weight:800;white-space:nowrap;">${r.area.split(' ')[0]}</span>
            <span style="font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.nombre}</span>
            <span style="font-size:11px;color:rgba(198,201,215,.5);">${fmtDate(r.fecha)}</span>
          </div>
          <span class="badge badge-red" style="flex-shrink:0;">+${r.diff}m</span>
        </div>`).join('');
    } else {
      const byPers = {};
      withTard.forEach(r=>{
        if(!byPers[r.nombre]) byPers[r.nombre]={nombre:r.nombre,area:r.area,total:0,veces:0};
        byPers[r.nombre].total += r.diff;
        byPers[r.nombre].veces++;
      });
      html = Object.values(byPers).sort((a,b)=>b.total-a.total).slice(0,8).map(p=>`
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
            <span style="color:${areaColor(p.area)};font-size:10px;font-weight:800;white-space:nowrap;">${p.area.split(' ')[0]}</span>
            <span style="font-weight:700;font-size:13px;">${p.nombre}</span>
            <span style="font-size:11px;color:rgba(198,201,215,.4);">${p.veces} vez${p.veces!==1?'es':''}</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
            <span style="font-size:11px;color:rgba(198,201,215,.4);">total</span>
            <span class="badge badge-red">+${p.total}m</span>
          </div>
        </div>`).join('');
    }
    el.innerHTML = modeBar + `<div style="display:flex;flex-direction:column;gap:7px;">${html}</div>`;
  }

  // ── TOP HORAS EXTRA POST-SALIDA ──
  let _topExtraMode = 'sum';
  function _topExtra(rows, per){
    const el=document.getElementById('topExtra');
    if(!el) return;

    const esDia = per==='hoy'||per==='ayer'||per==='dia_especifico';
    const extraData = _calcExtraData(rows).filter(e=>e.totalExtra>0);

    if(!extraData.length){
      el.innerHTML='<div style="color:rgba(198,201,215,.4);font-size:13px;text-align:center;padding:20px;">Sin horas extra post-salida</div>';
      return;
    }

    const modeBar = esDia ? '' : `
      <div style="display:flex;gap:5px;margin-bottom:10px;">
        <button onclick="Dashboard._setExtraMode('sum')"   id="btnExtraSum"   class="tab-btn ${_topExtraMode==='sum'?'active':''}" style="font-size:11px;padding:4px 10px;">Σ Sumatoria</button>
        <button onclick="Dashboard._setExtraMode('aisla')" id="btnExtraAisla" class="tab-btn ${_topExtraMode!=='sum'?'active':''}" style="font-size:11px;padding:4px 10px;">📅 Por registro</button>
      </div>`;

    let html;
    if (esDia || _topExtraMode !== 'sum') {
      const flat = [];
      extraData.forEach(p=>p.dias.filter(d=>d.extra>0).forEach(d=>flat.push({nombre:p.nombre,area:p.area,...d})));
      flat.sort((a,b)=>b.extra-a.extra);
      html = flat.slice(0,8).map(r=>`
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
            <span style="color:${areaColor(r.area)};font-size:10px;font-weight:800;white-space:nowrap;">${r.area.split(' ')[0]}</span>
            <span style="font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.nombre}</span>
            <span style="font-size:11px;color:rgba(198,201,215,.5);">${fmtDate(r.fecha)}</span>
            <span style="font-size:10px;color:rgba(198,201,215,.35);">${r.planSal}→${r.salReal}</span>
          </div>
          <span class="badge badge-gold" style="flex-shrink:0;">+${fmtHs(r.extra/60)}</span>
        </div>`).join('');
    } else {
      html = extraData.slice(0,8).map(p=>`
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
            <span style="color:${areaColor(p.area)};font-size:10px;font-weight:800;white-space:nowrap;">${p.area.split(' ')[0]}</span>
            <span style="font-weight:700;font-size:13px;">${p.nombre}</span>
            <span style="font-size:11px;color:rgba(198,201,215,.4);">${p.veces} día${p.veces!==1?'s':''}</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
            <span style="font-size:11px;color:rgba(198,201,215,.4);">total</span>
            <span class="badge badge-gold">+${fmtHs(p.totalExtra/60)}</span>
          </div>
        </div>`).join('');
    }
    el.innerHTML = modeBar + `<div style="display:flex;flex-direction:column;gap:7px;">${html}</div>`;
  }

  function _setTardMode(m) { _topTardMode=m; load(); }
  function _setExtraMode(m) { _topExtraMode=m; load(); }

  function _areaTable(rows){
    const tbody=document.getElementById('tbArea');
    if(!tbody) return;
    tbody.innerHTML=AREAS.map(a=>{
      const ar=rows.filter(r=>r.area===a);if(!ar.length)return'';
      const withP=ar.filter(r=>r.turno&&r.hora_entrada&&r.turno.includes(':')&&r.turno!=='Flex'&&r.turno!=='Guardia');
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

  return { load, _changeDPer, _setTardMode, _setExtraMode };
})();