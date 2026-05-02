// js/dashboard.js — v4 (fix ayer/dia_especifico + top horas extra + filtro persona + detalle personal)
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
    const per     = document.getElementById('dPer').value;
    const area    = document.getElementById('dArea').value;
    const persona = document.getElementById('dPersona')?.value?.toLowerCase() || '';  // ✅ NUEVO
    _lastPer      = per;

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
    let rows=data||[];
    
    // ✅ NUEVO - Filtro por persona
    if(persona){
      rows = rows.filter(r => r.nombre.toLowerCase().includes(persona));
    }
    
    _lastRows = rows;

    // Para horarios semanales: buscar semanas que SE SOLAPEN con el período
    let qH=SB.from('horarios_semanales').select('*');
    if(desde) qH=qH.lte('semana_desde',hasta||desde);
    if(hasta) qH=qH.gte('semana_hasta',desde);
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
    _personasTable(rows);  // ✅ NUEVO - Mostrar tabla de personas
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
      const extra   = calcHsExtra(planSal, salReal);
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
  function _topTard(rows, per){
    const el=document.getElementById('topTard');
    if(!el) return;

    const esDia = per==='hoy'||per==='ayer'||per==='dia_especifico';

    const withTard=rows.filter(r=>{
      if(!r.turno||!r.hora_entrada||r.turno==='Flex'||r.turno==='Guardia')return false;
      const e=r.turno.split('→')[0].trim();
      return e.match(/^\d{2}:\d{2}$/);
    });

    const byPers={};
    withTard.forEach(r=>{
      const planEnt=r.turno.split('→')[0].trim();
      const diff=calcTardVsPlan(planEnt,r.hora_entrada.slice(0,5));
      if(diff===null||diff<=0)return;
      const k=r.nombre;
      if(!byPers[k])byPers[k]={nombre:r.nombre,area:r.area,totalMin:0,veces:0};
      byPers[k].totalMin+=diff;
      byPers[k].veces++;
    });

    const sorted=Object.values(byPers).sort((a,b)=>b.totalMin-a.totalMin).slice(0,3);
    const ACOLOR={
      'ADMINISTRACION':'#6be1e3','COMERCIAL':'#e17bd7','RECURSOS HUMANOS':'#e4c76a',
      'MARKETING':'#f472b6','ACADEMICO / GT':'#a78bfa',
      'INNOVACION Y DESARROLLO':'#34d399','MAESTRANZA':'#fb923c','PASANTIAS':'#60a5fa',
    };

    if(!sorted.length){el.innerHTML='<div style="font-size:12px;color:rgba(198,201,215,.3);">—</div>';return;}
    el.innerHTML=sorted.map((p,i)=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(198,201,215,.06);">
      <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
        <span style="color:${ACOLOR[p.area]||'#9ca3af'};font-weight:800;flex-shrink:0;">${i+1}</span>
        <div style="min-width:0;flex:1;">
          <div style="font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.nombre}</div>
          <div style="font-size:10px;color:rgba(198,201,215,.4);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.area}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;margin-left:8px;">
        <div style="text-align:right;">
          <div style="font-size:13px;font-weight:800;color:#ef4444;">+${p.totalMin}m</div>
          <div style="font-size:10px;color:rgba(198,201,215,.4);">${p.veces}x</div>
        </div>
      </div>
    </div>`).join('');
  }

  // ── TOP HORAS EXTRA POST-SALIDA ──
  function _topExtra(rows, per){
    const el=document.getElementById('topExtra');
    if(!el) return;

    const extraData=_calcExtraData(rows);
    const sorted=extraData.filter(e=>e.totalExtra>0).sort((a,b)=>b.totalExtra-a.totalExtra).slice(0,3);
    const ACOLOR={
      'ADMINISTRACION':'#6be1e3','COMERCIAL':'#e17bd7','RECURSOS HUMANOS':'#e4c76a',
      'MARKETING':'#f472b6','ACADEMICO / GT':'#a78bfa',
      'INNOVACION Y DESARROLLO':'#34d399','MAESTRANZA':'#fb923c','PASANTIAS':'#60a5fa',
    };

    if(!sorted.length){el.innerHTML='<div style="font-size:12px;color:rgba(198,201,215,.3);">—</div>';return;}
    el.innerHTML=sorted.map((p,i)=>{
      const hs=fmtHs(p.totalExtra/60);
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(198,201,215,.06);">
        <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
          <span style="color:${ACOLOR[p.area]||'#9ca3af'};font-weight:800;flex-shrink:0;">${i+1}</span>
          <div style="min-width:0;flex:1;">
            <div style="font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.nombre}</div>
            <div style="font-size:10px;color:rgba(198,201,215,.4);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.area}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;margin-left:8px;">
          <div style="text-align:right;">
            <div style="font-size:13px;font-weight:800;color:var(--one-gold);">+${hs}</div>
            <div style="font-size:10px;color:rgba(198,201,215,.4);">${p.veces}d</div>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  function _areaTable(rows){
    const el=document.getElementById('tbArea');
    if(!el)return;
    const byArea={};
    AREAS.forEach(a=>{
      const ar=rows.filter(r=>r.area===a);
      if(!ar.length)return;
      const withPlan=ar.filter(r=>{
        if(!r.turno||!r.hora_entrada||r.turno==='Flex'||r.turno==='Guardia')return false;
        const e=r.turno.split('→')[0].trim();
        return e.match(/^\d{2}:\d{2}$/);
      });
      if(!withPlan.length)return;
      const diffs=withPlan.map(r=>{
        const e=r.turno.split('→')[0].trim();
        return calcTardVsPlan(e,r.hora_entrada.slice(0,5));
      }).filter(d=>d!==null);
      const prom=Math.round(diffs.reduce((a,b)=>a+b,0)/diffs.length);
      const puntual=diffs.filter(d=>d<=0).length;
      byArea[a]={prom,puntual,total:diffs.length};
    });

    const ACOLOR={
      'ADMINISTRACION':'#6be1e3','COMERCIAL':'#e17bd7','RECURSOS HUMANOS':'#e4c76a',
      'MARKETING':'#f472b6','ACADEMICO / GT':'#a78bfa',
      'INNOVACION Y DESARROLLO':'#34d399','MAESTRANZA':'#fb923c','PASANTIAS':'#60a5fa',
    };

    el.innerHTML=Object.entries(byArea).map(([area,d])=>{
      const col=ACOLOR[area]||'#9ca3af';
      return`<tr><td style="color:${col};font-weight:700;font-size:12px;">${area.split(' ')[0]}</td><td>${d.total}</td><td>${d.prom>0?'+':''}${d.prom}m</td><td>${d.puntual}</td></tr>`;
    }).join('');
  }

  // ✅ NUEVO - Tabla detallada por persona
  function _personasTable(rows){
    const el=document.getElementById('tbPersonas');
    if(!el)return;

    const byPers = {};
    rows.forEach(r => {
      if (!byPers[r.nombre]) {
        byPers[r.nombre] = {
          nombre: r.nombre,
          area: r.area,
          registros: 0,
          puntuales: 0,
          tardanzas: [],
          horasTotal: 0,
          ultimaFecha: r.fecha
        };
      }
      const p = byPers[r.nombre];
      p.registros++;
      if (r.ultimaFecha < r.fecha) p.ultimaFecha = r.fecha;

      // Calcular horas
      const _hs1 = calcHs(r.hora_entrada?.slice(0,5), r.hora_salida?.slice(0,5));
      const _hs2 = calcHs(r.hora_entrada2?.slice(0,5), r.hora_salida2?.slice(0,5));
      const hs = (_hs1 !== null || _hs2 !== null) ? (_hs1 || 0) + (_hs2 || 0) : null;
      if (hs !== null) p.horasTotal += hs;

      // Calcular tardanza
      if (r.turno && !['Flex', 'Guardia'].includes(r.turno) && r.hora_entrada) {
        const planEnt = r.turno.split('→')[0].trim();
        if (planEnt.match(/^\d{2}:\d{2}$/)) {
          const diff = calcTardVsPlan(planEnt, r.hora_entrada.slice(0,5));
          if (diff !== null) {
            if (diff <= 0) {
              p.puntuales++;
            } else {
              p.tardanzas.push(diff);
            }
          }
        }
      }
    });

    const sorted = Object.values(byPers).sort((a, b) => a.nombre.localeCompare(b.nombre));
    const ACOLOR={
      'ADMINISTRACION':'#6be1e3','COMERCIAL':'#e17bd7','RECURSOS HUMANOS':'#e4c76a',
      'MARKETING':'#f472b6','ACADEMICO / GT':'#a78bfa',
      'INNOVACION Y DESARROLLO':'#34d399','MAESTRANZA':'#fb923c','PASANTIAS':'#60a5fa',
    };

    if(!sorted.length){
      el.innerHTML='<tr><td colspan="7" style="text-align:center;padding:30px;color:rgba(198,201,215,.28);">Sin datos</td></tr>';
      return;
    }

    el.innerHTML = sorted.map((p, i) => {
      const col = ACOLOR[p.area] || '#9ca3af';
      const promTard = p.tardanzas.length ? Math.round(p.tardanzas.reduce((a,b)=>a+b,0)/p.tardanzas.length) : 0;
      const puntualidad = (p.puntuales + p.tardanzas.length) > 0 ? Math.round(p.puntuales / (p.puntuales + p.tardanzas.length) * 100) : '—';
      const hsFormatted = p.horasTotal > 0 ? fmtHs(p.horasTotal) : '—';

      return `<tr>
        <td style="color:rgba(198,201,215,.3);font-size:11px;">${i+1}</td>
        <td style="font-weight:700;">${p.nombre}</td>
        <td><span style="color:${col};font-weight:800;font-size:11px;">${p.area.split(' / ')[0]}</span></td>
        <td style="text-align:center;color:rgba(198,201,215,.6);">${p.registros}</td>
        <td style="text-align:center;"><span class="badge badge-cyan">${hsFormatted}</span></td>
        <td style="text-align:center;color:rgba(198,201,215,.6);">${puntualidad === '—' ? '—' : puntualidad + '%'}</td>
        <td style="text-align:center;${p.tardanzas.length > 0 ? 'color:#ef4444;' : 'color:var(--color-success-text);'}font-weight:700;">${p.tardanzas.length > 0 ? '+' + promTard + 'm' : '✓'}</td>
      </tr>`;
    }).join('');
  }

  return { load, _changeDPer };
})();