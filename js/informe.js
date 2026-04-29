// js/informe-pdf.js — ONE Horarios · Informe corporativo v3
// Abre una ventana nueva con el informe HTML completo (gráficos, logos, tablas).
// El usuario usa Ctrl+P → "Guardar como PDF" para exportar.

const InformePDF = (() => {

const ACOLOR = {
  'ADMINISTRACION':'#6be1e3',
  'COMERCIAL':'#e17bd7',
  'RECURSOS HUMANOS':'#e4c76a',
  'MARKETING':'#f472b6',
  'ACADEMICO / GT':'#a78bfa',
  'INNOVACION Y DESARROLLO':'#34d399',
  'MAESTRANZA':'#fb923c',
  'PASANTIAS':'#60a5fa'  // ← Sin coma al final si es el último
};

  const PERIOD_LABEL = {
    hoy:'HOY', ayer:'AYER', semana:'SEMANA EN CURSO',
    semana_ant:'SEMANA ANTERIOR', mes:'MES EN CURSO',
    mes_ant:'MES ANTERIOR', anio:'AÑO EN CURSO',
    dia_especifico:'DÍA ESPECÍFICO', todos:'PERÍODO COMPLETO',
  };

  // ─── Fetch data ───
  async function _fetch() {
    const per  = document.getElementById('dPer')?.value  || 'semana';
    const area = document.getElementById('dArea')?.value || '';
    let desde, hasta;
    if (per === 'dia_especifico') {
      const d = document.getElementById('dDiaEsp')?.value || '';
      desde = d; hasta = d;
    } else {
      const r = getDateRange(per);
      desde = r.desde; hasta = r.hasta;
    }
    let q = SB.from('registros').select('*').order('fecha', { ascending: true });
    if (desde) q = q.gte('fecha', desde);
    if (hasta) q = q.lte('fecha', hasta);
    if (area)  q = q.eq('area', area);
    const { data: rows } = await q;

    let qH = SB.from('horarios_semanales').select('*');
    if (desde) qH = qH.gte('semana_desde', desde);
    if (hasta) qH = qH.lte('semana_hasta', hasta);
    if (area)  qH = qH.eq('area', area);
    const { data: hsData } = await qH;

    return { rows: rows||[], hs: hsData||[], per, desde, hasta, area };
  }

  // ─── Calc stats ───
  function _calc(rows, hs) {
    const withPlan = rows.filter(r => {
      if (!r.turno || !r.hora_entrada || r.turno==='Flex' || r.turno==='Guardia') return false;
      return r.turno.split('\u2192')[0].trim().match(/^\d{2}:\d{2}$/);
    });

    const allDiffs = withPlan.map(r => ({
      r, d: calcTardVsPlan(r.turno.split('\u2192')[0].trim(), r.hora_entrada.slice(0,5))
    })).filter(x => x.d !== null);

    const diffs    = allDiffs.map(x => x.d);
    const puntual  = diffs.filter(d => d <= 0).length;
    const tarde    = diffs.filter(d => d > 0).length;
    const promTard = diffs.length ? Math.round(diffs.reduce((a,b)=>a+b,0)/diffs.length) : 0;

    const conHs = rows.filter(r => r.hora_entrada && r.hora_salida && r.turno!=='Flex' && r.turno!=='Guardia');
    const totHs = conHs.reduce((acc,r)=>{
      const h = calcHs(r.hora_entrada.slice(0,5), r.hora_salida.slice(0,5));
      return h ? acc+h : acc;
    }, 0);
    const promHs = conHs.length ? totHs/conHs.length : 0;

    // Extra post-salida por persona
    const em = {};
    rows.forEach(r => {
      if (!r.turno||!r.hora_entrada||!r.hora_salida||r.turno==='Flex'||r.turno==='Guardia') return;
      const pts = r.turno.split('\u2192');
      if (pts.length < 2) return;
      const ps = pts[1].trim().slice(0,5);
      if (!ps.match(/^\d{2}:\d{2}$/)) return;
      const ex = calcHsExtra(ps, r.hora_salida.slice(0,5));
      if (!ex || ex <= 0) return;
      if (!em[r.nombre]) em[r.nombre] = { nombre:r.nombre, area:r.area, totalMin:0, veces:0 };
      em[r.nombre].totalMin += ex;
      em[r.nombre].veces++;
    });
    const topExtra = Object.values(em).sort((a,b)=>b.totalMin-a.totalMin).slice(0,8);

    // Tardanzas acumuladas por persona
    const tm = {};
    allDiffs.filter(x=>x.d>0).forEach(x => {
      const r = x.r;
      if (!tm[r.nombre]) tm[r.nombre] = { nombre:r.nombre, area:r.area, totalMin:0, veces:0 };
      tm[r.nombre].totalMin += x.d;
      tm[r.nombre].veces++;
    });
    const topTard = Object.values(tm).sort((a,b)=>b.totalMin-a.totalMin).slice(0,8);

    // Por área
    const AREAS = Object.keys(ACOLOR);
    const byArea = AREAS.map(a => {
      const ar = rows.filter(r=>r.area===a);
      if (!ar.length) return null;
      const ad = ar.filter(r=>r.turno&&r.hora_entrada&&r.turno.includes(':')&&r.turno!=='Flex'&&r.turno!=='Guardia')
        .map(r => {
          const e = r.turno.split('\u2192')[0].trim();
          return e.match(/^\d{2}:\d{2}$/) ? calcTardVsPlan(e, r.hora_entrada.slice(0,5)) : null;
        }).filter(d=>d!==null);
      const hsA = ar.filter(r=>r.hora_entrada&&r.hora_salida&&r.turno!=='Flex'&&r.turno!=='Guardia');
      const totA = hsA.reduce((acc,r)=>{const h=calcHs(r.hora_entrada.slice(0,5),r.hora_salida.slice(0,5));return h?acc+h:acc;},0);
      return {
        area: a, registros: ar.length,
        punt: ad.filter(d=>d<=0).length,
        conTard: ad.filter(d=>d>0).length,
        totalDiffs: ad.length,
        prom: ad.length ? Math.round(ad.reduce((x,y)=>x+y,0)/ad.length) : null,
        promHs: hsA.length ? totA/hsA.length : 0,
      };
    }).filter(Boolean);

    // Por día
    const byDay = {};
    rows.forEach(r=>{ byDay[r.fecha]=(byDay[r.fecha]||0)+1; });

    const pct = Math.round(puntual/Math.max(puntual+tarde,1)*100);
    return { puntual, tarde, promTard, promHs, totHs, topExtra, topTard,
             byArea, byDay, total:rows.length,
             personas: new Set(rows.map(r=>r.nombre)).size, pct };
  }

  // ─── Analysis text ───
  function _anlz(s, data) {
    const { total, personas, puntual, tarde, promTard, promHs, topExtra, topTard, byArea, pct } = s;
    const PL2 = {
      hoy:'hoy', ayer:'ayer', semana:'esta semana', semana_ant:'la semana anterior',
      mes:'este mes', mes_ant:'el mes anterior', anio:'este año',
      dia_especifico:'el día seleccionado', todos:'todo el período'
    };
    const pl = PL2[data.per] || 'el período';
    if (!total) return { resumen:'Sin registros.', puntualidad:'', extra:'', areas:'', recs:['Verificar que haya registros cargados.'] };

    const resumen = 'Durante ' + pl + ', el sistema ONE Horarios registró ' + total + ' marcaci' + (total!==1?'ones':'ón') + ' de ' + personas + ' colaborador' + (personas!==1?'es':'')+'. El promedio de jornada fue de ' + fmtHs(promHs) + ' por persona.';

    const puntTxt = pct>=90
      ? 'El equipo demostró una puntualidad sobresaliente del ' + pct + '%, con apenas ' + tarde + ' registro' + (tarde!==1?'s':'') + ' con demora. Este resultado refleja un alto compromiso organizacional.'
      : pct>=75
      ? 'La puntualidad del período fue del ' + pct + '%, resultado satisfactorio. El promedio de tardanza fue de ' + (promTard>0?'+':'')+promTard + ' min, con oportunidades de mejora puntuales.'
      : pct>=50
      ? 'Se registró un ' + pct + '% de puntualidad, con ' + tarde + ' marcaciones demoradas. El promedio de ' + (promTard>0?'+':'')+promTard + ' min sugiere revisar causas recurrentes.'
      : 'La puntualidad del ' + pct + '% requiere atención. Con ' + tarde + ' tardanzas y promedio de +' + promTard + ' min, se recomienda un plan de mejora urgente.';

    const extraTxt = topExtra.length > 0
      ? 'Se detectaron horas extra post-salida en ' + topExtra.length + ' persona' + (topExtra.length!==1?'s':'') + '. ' + topExtra[0].nombre + ' acumuló ' + fmtHs(topExtra[0].totalMin/60) + ' en ' + topExtra[0].veces + ' jornada' + (topExtra[0].veces!==1?'s':'') + '. Se recomienda evaluar la carga de trabajo y reconocer el compromiso.'
      : 'No se registraron horas extra post-salida. El equipo respetó los tiempos planificados de finalización.';

    let areasTxt = '';
    if (byArea.length > 0) {
      const mr = byArea.reduce((a,b)=>a.registros>=b.registros?a:b);
      areasTxt = mr.area + ' fue el área con mayor actividad (' + mr.registros + ' registros). ';
      const mp = byArea.filter(a=>a.totalDiffs>0).sort((a,b)=>(b.punt/b.totalDiffs)-(a.punt/a.totalDiffs))[0];
      if (mp) areasTxt += mp.area + ' lideró en puntualidad con un ' + Math.round(mp.punt/mp.totalDiffs*100) + '%.';
    }

    const recs = [];
    if (pct < 85 && topTard.length > 0) {
      recs.push('SEGUIMIENTO DE PUNTUALIDAD: ' + topTard.slice(0,3).map(p=>p.nombre).join(', ') + ' concentran la mayor acumulación de tardanzas. Se recomienda un diálogo individual y acuerdos de mejora concretos.');
    }
    if (topExtra.length > 3) {
      recs.push('GESTIÓN DE CARGA LABORAL: ' + topExtra.length + ' personas registran horas extra recurrentes. Evaluar redistribución de tareas o reconocimiento formal del tiempo aportado.');
    }
    if (byArea.some(a=>a.prom!==null && a.prom>10)) {
      recs.push('REVISIÓN DE HORARIOS: Las áreas con mayor promedio de tardanza podrían beneficiarse de revisar sus horarios de ingreso planificados para ajustar las expectativas.');
    }
    if (pct >= 90) {
      recs.push('RECONOCIMIENTO DEL EQUIPO: La excelente puntualidad del período merece ser comunicada al equipo como refuerzo positivo de la cultura organizacional.');
    }
    if (recs.length === 0) {
      recs.push('CONTINUIDAD: Mantener las buenas prácticas actuales y continuar el monitoreo semanal para sostener los resultados obtenidos.');
    }

    return { resumen, puntualidad: puntTxt, extra: extraTxt, areas: areasTxt, recs };
  }

  // ─── Build HTML using DOM (no template literals) ───
  function _buildHTML(data, s, an) {
    const ds   = new Date().toLocaleDateString('es-AR',{day:'2-digit',month:'long',year:'numeric'});
    const pl   = PERIOD_LABEL[data.per] || data.per.toUpperCase();
    const plLow = pl.charAt(0) + pl.slice(1).toLowerCase();
    const fechaRango = data.desde
      ? (data.desde === data.hasta ? fmtDate(data.desde) : fmtDate(data.desde) + ' — ' + fmtDate(data.hasta))
      : '';

    // Chart data (computed in admin context, passed as JSON into the popup)
    const AREAS = Object.keys(ACOLOR);
    const cAreaL = JSON.stringify(AREAS.map(a=>a.split(' ')[0]));
    const cAreaD = JSON.stringify(AREAS.map(a=>data.rows.filter(r=>r.area===a).length));
    const cAreaC = JSON.stringify(Object.values(ACOLOR));
    const cPuntL = JSON.stringify(s.byArea.map(a=>a.area.split(' ')[0]));
    const cPuntD = JSON.stringify(s.byArea.map(a=>a.totalDiffs>0?Math.round(a.punt/a.totalDiffs*100):0));
    const cPuntC = JSON.stringify(s.byArea.map(a=>ACOLOR[a.area]||'#a4a8c0'));
    const days   = Object.keys(s.byDay).sort();
    const cDayL  = JSON.stringify(days.map(d=>fmtDate(d)));
    const cDayD  = JSON.stringify(days.map(d=>s.byDay[d]));

    // Last 40 records
    const recs40 = [...data.rows].sort((a,b)=>b.fecha.localeCompare(a.fecha)).slice(0,40);

    // Build rows for top lists
    function hbarRows(list, valFn, colorOk, maxValFn) {
      if (!list.length) return '<p style="color:#999;font-size:12px;padding:16px 0;text-align:center;">Sin datos en el período</p>';
      const maxV = maxValFn(list[0]);
      return list.map((p,i) => {
        const col = ACOLOR[p.area] || '#a4a8c0';
        const val = valFn(p);
        const pct = Math.round(val/maxV*100);
        const fillColor = i===0 ? colorOk : colorOk+'99';
        return '<div style="margin-bottom:12px;">'
          + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;">'
          + '<div style="display:flex;align-items:center;gap:7px;">'
          + '<div style="width:8px;height:8px;border-radius:50%;background:' + col + ';flex-shrink:0;"></div>'
          + '<span style="font-size:12px;font-weight:700;color:#111;">' + (i+1) + '. ' + p.nombre + '</span>'
          + '</div>'
          + '<span style="font-size:12px;font-weight:800;color:' + colorOk + ';">' + val + '</span>'
          + '</div>'
          + '<div style="height:7px;background:#f0f0f5;border-radius:4px;overflow:hidden;">'
          + '<div style="height:100%;width:' + pct + '%;background:' + fillColor + ';border-radius:4px;"></div>'
          + '</div>'
          + '<div style="font-size:10px;color:#999;margin-top:2px;">'
          + p.veces + ' ocurrencia' + (p.veces!==1?'s':'') + ' · ' + p.area.split(' ')[0]
          + '</div>'
          + '</div>';
      }).join('');
    }

    function areaTableRows() {
      if (!s.byArea.length) return '<tr><td colspan="7" style="text-align:center;color:#999;padding:20px;">Sin datos</td></tr>';
      return s.byArea.map((a,i) => {
        const col = ACOLOR[a.area] || '#a4a8c0';
        const pctA = a.totalDiffs>0 ? Math.round(a.punt/a.totalDiffs*100) : 0;
        const promColor = a.prom===null ? '#999' : a.prom>10 ? '#991b1b' : a.prom>0 ? '#854d0e' : '#166534';
        const promText  = a.prom===null ? '—' : (a.prom>0?'+':'')+a.prom+'m';
        const barColor  = pctA>=80 ? '#34d399' : pctA>=60 ? '#e4c76a' : '#ef4444';
        return '<tr style="background:' + (i%2===0?'#fff':'#fafafa') + ';">'
          + '<td style="padding:9px 10px;">'
          + '<div style="display:flex;align-items:center;gap:7px;">'
          + '<div style="width:8px;height:8px;border-radius:50%;background:' + col + ';flex-shrink:0;"></div>'
          + '<strong style="font-size:11px;color:' + col + ';">' + a.area + '</strong>'
          + '</div></td>'
          + '<td style="padding:9px 10px;font-weight:700;text-align:center;">' + a.registros + '</td>'
          + '<td style="padding:9px 10px;text-align:center;"><span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:800;">' + a.punt + '</span></td>'
          + '<td style="padding:9px 10px;text-align:center;"><span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:800;">' + a.conTard + '</span></td>'
          + '<td style="padding:9px 10px;text-align:center;font-weight:700;color:' + promColor + ';">' + promText + '</td>'
          + '<td style="padding:9px 10px;text-align:center;">' + (a.promHs>0?fmtHs(a.promHs):'—') + '</td>'
          + '<td style="padding:9px 10px;">'
          + '<div style="display:flex;align-items:center;gap:6px;">'
          + '<span style="font-weight:800;color:' + barColor + ';font-size:12px;">' + pctA + '%</span>'
          + '<div style="flex:1;height:6px;background:#f0f0f5;border-radius:3px;overflow:hidden;">'
          + '<div style="height:100%;width:' + pctA + '%;background:' + barColor + ';border-radius:3px;"></div>'
          + '</div></div></td>'
          + '</tr>';
      }).join('');
    }

    function recRows() {
      const colors = ['#6be1e3','#e4c76a','#ef4444','#34d399','#a78bfa'];
      return an.recs.map((r,i) => {
        const parts = r.split(':');
        const title = parts.length>1 ? parts[0] : 'Acción ' + (i+1);
        const body  = parts.length>1 ? parts.slice(1).join(':').trim() : r;
        return '<div style="border-left:4px solid ' + colors[i%5] + ';background:#f8f8fc;border-radius:0 12px 12px 0;padding:14px 16px;margin-bottom:12px;">'
          + '<div style="font-size:9px;font-weight:800;letter-spacing:.1em;color:#999;text-transform:uppercase;margin-bottom:4px;">' + title + '</div>'
          + '<div style="font-size:12px;line-height:1.65;color:#333;">' + body + '</div>'
          + '</div>';
      }).join('');
    }

    function regTableRows() {
      return recs40.map(r => {
        const col = ACOLOR[r.area] || '#a4a8c0';
        const hs  = calcHs(r.hora_entrada?.slice(0,5), r.hora_salida?.slice(0,5));
        const turno = r.turno || '';
        let tardHtml = '<span style="background:#f4f4f8;color:#666;padding:2px 7px;border-radius:99px;font-size:10px;font-weight:800;">—</span>';
        if (turno === 'Flex')    tardHtml = '<span style="background:#dbeafe;color:#1e40af;padding:2px 7px;border-radius:99px;font-size:10px;font-weight:800;">Flex</span>';
        else if (turno === 'Guardia') tardHtml = '<span style="background:#fef9c3;color:#854d0e;padding:2px 7px;border-radius:99px;font-size:10px;font-weight:800;">Guardia</span>';
        else if (turno.includes(':') && r.hora_entrada) {
          const pe = turno.split('\u2192')[0].trim();
          if (pe.match(/^\d{2}:\d{2}$/)) {
            const diff = calcTardVsPlan(pe, r.hora_entrada.slice(0,5));
            if (diff !== null) {
              tardHtml = diff <= 0
                ? '<span style="background:#dcfce7;color:#166534;padding:2px 7px;border-radius:99px;font-size:10px;font-weight:800;">' + (diff<0?diff+'m ant.':'Exacto') + '</span>'
                : '<span style="background:#fee2e2;color:#991b1b;padding:2px 7px;border-radius:99px;font-size:10px;font-weight:800;">+' + diff + 'm</span>';
            }
          }
        }
        return '<tr>'
          + '<td style="padding:7px 9px;">'
          + '<div style="display:flex;align-items:center;gap:5px;">'
          + '<div style="width:7px;height:7px;border-radius:50%;background:' + col + ';flex-shrink:0;"></div>'
          + '<span style="font-size:10px;font-weight:800;color:' + col + ';">' + r.area.split(' ')[0] + '</span>'
          + '</div></td>'
          + '<td style="padding:7px 9px;font-weight:700;font-size:11px;">' + r.nombre + '</td>'
          + '<td style="padding:7px 9px;font-size:11px;">' + fmtDate(r.fecha) + '</td>'
          + '<td style="padding:7px 9px;font-weight:700;font-size:11px;">' + (r.hora_entrada?.slice(0,5)||'—') + '</td>'
          + '<td style="padding:7px 9px;font-size:11px;">' + (r.hora_salida?.slice(0,5)||'—') + '</td>'
          + '<td style="padding:7px 9px;">' + (hs!==null ? '<span style="background:#dbeafe;color:#1e40af;padding:2px 7px;border-radius:99px;font-size:10px;font-weight:800;">' + fmtHs(hs) + '</span>' : '—') + '</td>'
          + '<td style="padding:7px 9px;">' + tardHtml + '</td>'
          + '</tr>';
      }).join('');
    }

    // Extra stats text
    const totalTardMin = s.topTard.reduce((a,p)=>a+p.totalMin,0);
    const extraImpact = s.tarde > 0
      ? 'Se acumularon un total de ' + totalTardMin + ' minutos de tardanza en el período, distribuidos en ' + s.tarde + ' registros. Convertido a horas, representa ' + fmtHs(totalTardMin/60) + ' de tiempo no productivo planificado.' + (s.topTard.length>0 ? ' ' + s.topTard[0].nombre + ' concentra la mayor demora acumulada con +' + s.topTard[0].totalMin + ' min en ' + s.topTard[0].veces + ' jornada' + (s.topTard[0].veces!==1?'s':'')+'.':'')
      : 'No se registraron tardanzas. El equipo demostró un compromiso excepcional con los horarios planificados.';

    const sectorAnalysis = s.byArea.length > 0
      ? (()=>{
          const best  = s.byArea.filter(a=>a.totalDiffs>0).sort((a,b)=>(b.punt/b.totalDiffs)-(a.punt/a.totalDiffs))[0];
          const worst = s.byArea.filter(a=>a.prom!==null&&a.prom>0).sort((a,b)=>b.prom-a.prom)[0];
          let t = 'Los datos reflejan diferencias de desempeño entre áreas. ';
          if (best)  t += best.area + ' lidera con un ' + Math.round(best.punt/best.totalDiffs*100) + '% de puntualidad. ';
          if (worst) t += worst.area + ' presenta el mayor promedio de tardanza (+' + worst.prom + ' min), requiriendo atención especial.';
          return t;
        })()
      : 'Sin datos suficientes para análisis sectorial en este período.';

    // ── Assemble full HTML as concatenated string (no backticks) ──
    const imgBase = 'img/';
    const chartJS = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
    const fontURL = 'https://fonts.googleapis.com/css2?family=Exo+2:wght@400;600;700;800;900&display=swap';

    const css = [
      '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}',
      'body{font-family:"Exo 2",system-ui,sans-serif;background:#fff;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact;}',
      '.cover{min-height:100vh;background:linear-gradient(160deg,#0a0816 0%,#16121f 45%,#0f0c1a 100%);display:flex;flex-direction:column;position:relative;overflow:hidden;page-break-after:always;}',
      '.cl{position:absolute;top:0;left:0;width:8px;height:100%;background:linear-gradient(180deg,#6be1e3,#e17bd7);}',
      '.cr{position:absolute;top:0;right:0;width:8px;height:100%;background:linear-gradient(180deg,#e17bd7,#6be1e3);}',
      '.cd1{position:absolute;top:-80px;right:-80px;width:400px;height:400px;border-radius:50%;background:radial-gradient(circle,rgba(107,225,227,.14) 0%,transparent 70%);}',
      '.cd2{position:absolute;bottom:-100px;left:-60px;width:350px;height:350px;border-radius:50%;background:radial-gradient(circle,rgba(225,123,215,.1) 0%,transparent 70%);}',
      '.ch{padding:44px 56px 0;display:flex;align-items:center;justify-content:space-between;}',
      '.cb{flex:1;display:flex;flex-direction:column;justify-content:center;padding:0 56px;}',
      '.eyebrow{font-size:11px;font-weight:800;letter-spacing:.2em;color:#6be1e3;text-transform:uppercase;margin-bottom:14px;}',
      '.ctitle{font-size:50px;font-weight:900;line-height:1.05;color:#fff;margin-bottom:8px;}',
      '.ctitle span{background:linear-gradient(90deg,#6be1e3,#e17bd7);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;}',
      '.csub{font-size:16px;color:rgba(198,201,215,.6);margin-bottom:32px;}',
      '.cpills{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:40px;}',
      '.pill{padding:5px 15px;border-radius:999px;font-size:11px;font-weight:700;}',
      '.pill-c{background:rgba(107,225,227,.15);border:1px solid rgba(107,225,227,.35);color:#6be1e3;}',
      '.pill-p{background:rgba(167,139,250,.15);border:1px solid rgba(167,139,250,.35);color:#a78bfa;}',
      '.pill-d{background:rgba(198,201,215,.08);border:1px solid rgba(198,201,215,.2);color:rgba(198,201,215,.7);}',
      '.ckpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px;}',
      '.ckpi{background:rgba(255,255,255,.05);border:1px solid rgba(198,201,215,.1);border-radius:14px;padding:18px 14px;text-align:center;position:relative;overflow:hidden;}',
      '.ckpi::before{content:"";position:absolute;top:0;left:0;right:0;height:3px;}',
      '.ck-cy::before{background:linear-gradient(90deg,#6be1e3,#a8f1f1);}',
      '.ck-pp::before{background:linear-gradient(90deg,#a78bfa,#c4b5fd);}',
      '.ck-gn::before{background:linear-gradient(90deg,#34d399,#86efac);}',
      '.ck-rd::before{background:linear-gradient(90deg,#ef4444,#fca5a5);}',
      '.ck-go::before{background:linear-gradient(90deg,#e4c76a,#fde68a);}',
      '.ckv{font-size:34px;font-weight:900;line-height:1;}',
      '.ckl{font-size:8.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:rgba(198,201,215,.5);margin-top:5px;}',
      '.cfoot{padding:24px 56px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid rgba(198,201,215,.1);}',
      '.cft{font-size:11px;color:rgba(198,201,215,.35);}',
      '.page{background:#fff;padding:50px 50px 40px;page-break-after:always;position:relative;}',
      '.page:last-child{page-break-after:auto;}',
      '.ph{display:flex;align-items:center;justify-content:space-between;padding-bottom:16px;margin-bottom:28px;border-bottom:2px solid #f0f0f5;}',
      '.phn{font-size:13px;font-weight:800;color:#111;}',
      '.phn span{color:#6be1e3;}',
      '.phm{font-size:10px;color:#999;text-align:right;}',
      '.pnum{position:absolute;bottom:24px;right:50px;font-size:10px;color:#ccc;}',
      '.sec{margin-bottom:32px;}',
      '.sel{font-size:9px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#bbb;margin-bottom:5px;}',
      '.sti{font-size:20px;font-weight:900;color:#111;margin-bottom:4px;display:flex;align-items:center;gap:10px;}',
      '.sta{width:4px;height:26px;border-radius:2px;flex-shrink:0;}',
      '.sdiv{height:1px;background:#f0f0f5;margin:14px 0;}',
      '.sbody{font-size:12.5px;line-height:1.75;color:#444;}',
      '.krow{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:22px;}',
      '.kcard{background:#f8f8fc;border:1px solid #eeeef5;border-radius:12px;padding:16px 14px;text-align:center;}',
      '.kv{font-size:28px;font-weight:900;line-height:1;}',
      '.kl{font-size:8px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#999;margin-top:4px;}',
      '.ks{font-size:10px;color:#bbb;margin-top:2px;}',
      '.charts3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:18px;margin-bottom:22px;}',
      '.charts2{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-bottom:22px;}',
      '.cc{background:#f8f8fc;border:1px solid #eeeef5;border-radius:14px;padding:16px 14px;}',
      '.cct{font-size:9.5px;font-weight:800;color:#888;letter-spacing:.07em;text-transform:uppercase;margin-bottom:12px;}',
      '.cw{position:relative;height:155px;}',
      '.cwt{position:relative;height:210px;}',
      '.ins{border-radius:14px;padding:18px 20px;margin-bottom:14px;display:flex;gap:12px;}',
      '.ins-g{background:#f0fdf4;border:1px solid #bbf7d0;}',
      '.ins-r{background:#fef2f2;border:1px solid #fecaca;}',
      '.ins-y{background:#fffbeb;border:1px solid #fde68a;}',
      '.ins-b{background:#f0fdfe;border:1px solid #a5f3fc;}',
      '.ins-p{background:#faf5ff;border:1px solid #e9d5ff;}',
      '.ini{font-size:22px;flex-shrink:0;line-height:1.2;}',
      '.int{font-size:11.5px;font-weight:800;color:#111;margin-bottom:3px;}',
      '.inb{font-size:11.5px;line-height:1.65;color:#444;}',
      '.atbl{width:100%;border-collapse:collapse;}',
      '.atbl th{padding:9px 10px;text-align:left;font-size:9px;font-weight:800;color:#999;text-transform:uppercase;letter-spacing:.06em;background:#fafafa;border-bottom:2px solid #eee;}',
      '.atbl td{font-size:11px;}',
      '.dtbl{width:100%;border-collapse:collapse;}',
      '.dtbl th{padding:7px 9px;text-align:left;font-size:9px;font-weight:800;color:#999;text-transform:uppercase;letter-spacing:.06em;background:#fafafa;border-bottom:2px solid #eee;}',
      '.clos{background:linear-gradient(135deg,#0a0816,#16121f);border-radius:18px;padding:32px 36px;color:#fff;text-align:center;margin-top:28px;}',
      '.clot{font-size:17px;font-weight:900;margin-bottom:5px;}',
      '.clot span{background:linear-gradient(90deg,#6be1e3,#e17bd7);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;}',
      '.clos2{font-size:10px;color:rgba(198,201,215,.45);}',
      '.pbtn{position:fixed;top:20px;right:20px;z-index:9999;background:linear-gradient(135deg,#6be1e3,#a78bfa);color:#fff;border:none;padding:12px 22px;border-radius:999px;font-family:"Exo 2",sans-serif;font-size:14px;font-weight:800;cursor:pointer;box-shadow:0 4px 20px rgba(107,225,227,.35);}',
      '.pbtn:hover{transform:translateY(-1px);box-shadow:0 6px 24px rgba(107,225,227,.45);}',
      '@media print{.pbtn{display:none!important;} *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;} body{margin:0;} .cover{min-height:100vh;} .page{page-break-after:always;} .page:last-child{page-break-after:auto;} @page{margin:0;size:A4;}}',
    ].join('\n');

    const chartScript = [
      '(function(){',
      'var def={responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}}};',
      'var AL=' + cAreaL + ',AD=' + cAreaD + ',AC=' + cAreaC + ';',
      'var PL=' + cPuntL + ',PD=' + cPuntD + ',PC=' + cPuntC + ';',
      'var DL=' + cDayL  + ',DD=' + cDayD  + ';',
      'var ca=document.getElementById("cArea");',
      'if(ca){new Chart(ca.getContext("2d"),{type:"doughnut",data:{labels:AL,datasets:[{data:AD,backgroundColor:AC.map(function(c){return c+"88";}),borderColor:AC,borderWidth:2}]},options:Object.assign({},def,{plugins:{legend:{display:true,position:"bottom",labels:{color:"#666",font:{size:9},boxWidth:10,padding:5}}}})});}',
      'var cp=document.getElementById("cPunt");',
      'if(cp){new Chart(cp.getContext("2d"),{type:"bar",data:{labels:PL,datasets:[{data:PD,backgroundColor:PC.map(function(c){return c+"66";}),borderColor:PC,borderWidth:2,borderRadius:4}]},options:Object.assign({},def,{scales:{y:{min:0,max:100,ticks:{color:"#aaa",font:{size:9}},grid:{color:"#f0f0f5"}},x:{ticks:{color:"#888",font:{size:8}},grid:{display:false}}}})});}',
      'var cd=document.getElementById("cDia");',
      'if(cd){new Chart(cd.getContext("2d"),{type:"line",data:{labels:DL,datasets:[{data:DD,borderColor:"#6be1e3",backgroundColor:"rgba(107,225,227,.12)",fill:true,tension:.35,pointBackgroundColor:"#6be1e3",pointRadius:4}]},options:Object.assign({},def,{scales:{y:{ticks:{color:"#aaa",font:{size:9},stepSize:1},grid:{color:"#f0f0f5"}},x:{ticks:{color:"#888",font:{size:8},maxTicksLimit:6},grid:{display:false}}}})});}',
      'var cp2=document.getElementById("cPunt2");',
      'if(cp2){new Chart(cp2.getContext("2d"),{type:"bar",data:{labels:PL,datasets:[{data:PD,backgroundColor:PC.map(function(c){return c+"55";}),borderColor:PC,borderWidth:2,borderRadius:6}]},options:Object.assign({},def,{plugins:{legend:{display:false}},scales:{y:{min:0,max:100,ticks:{color:"#aaa",font:{size:10}},grid:{color:"#f0f0f5"}},x:{ticks:{color:"#444",font:{size:11,weight:"bold"}},grid:{display:false}}}})});}',
      '})();',
    ].join('\n');

    // ── Assemble pages ──
    const pIco  = s.pct>=90?'🏆':s.pct>=80?'✅':s.pct>=60?'⚠️':'🚨';
    const pCls  = s.pct>=80?'ins-g':'ins-r';

    const html = '<!DOCTYPE html>'
      + '<html lang="es"><head>'
      + '<meta charset="UTF-8"/>'
      + '<meta name="viewport" content="width=device-width"/>'
      + '<title>ONE Informe ' + plLow + ' ' + fechaRango + '</title>'
      + '<link href="' + fontURL + '" rel="stylesheet">'
      + '<script src="' + chartJS + '"><' + '/script>'
      + '<style>' + css + '</style>'
      + '</head><body>'

      // Btn imprimir
      + '<button class="pbtn" onclick="window.print()">🖨 Guardar como PDF</button>'

      // ═══ PORTADA ═══
      + '<div class="cover">'
      + '<div class="cl"></div><div class="cr"></div>'
      + '<div class="cd1"></div><div class="cd2"></div>'
      + '<div class="ch">'
      + '<div style="display:flex;align-items:center;gap:12px;">'
      + '<img src="' + imgBase + 'one-logocolor.png" style="height:42px;" onerror="this.style.display=\'none\'"/>'
      + '<div style="font-size:22px;font-weight:900;letter-spacing:.04em;color:#fff;">ONE <span style="background:linear-gradient(90deg,#6be1e3,#a8f1f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">Horarios</span></div>'
      + '</div>'
      + '<img src="' + imgBase + 'escencial-logoblanco.png" style="height:26px;filter:brightness(0) invert(1);opacity:.65;" onerror="this.style.display=\'none\'"/>'
      + '</div>'
      + '<div class="cb">'
      + '<div class="eyebrow">Sistema de Gestión de Asistencia y Horarios</div>'
      + '<div class="ctitle">Informe de<br><span>Asistencia</span></div>'
      + '<div class="csub">Puntualidad · Jornadas · Horas extra · Desempeño por área</div>'
      + '<div class="cpills">'
      + '<span class="pill pill-c">📅 ' + plLow + '</span>'
      + (fechaRango ? '<span class="pill pill-d">' + fechaRango + '</span>' : '')
      + '<span class="pill pill-p">' + (data.area||'Todas las áreas') + '</span>'
      + '</div>'
      + '<div class="ckpis">'
      + '<div class="ckpi ck-cy"><div class="ckv" style="color:#6be1e3;">' + s.total + '</div><div class="ckl">Marcaciones</div></div>'
      + '<div class="ckpi ck-pp"><div class="ckv" style="color:#a78bfa;">' + s.personas + '</div><div class="ckl">Personas</div></div>'
      + '<div class="ckpi ' + (s.pct>=80?'ck-gn':'ck-rd') + '"><div class="ckv" style="color:' + (s.pct>=80?'#34d399':'#ef4444') + ';">' + s.pct + '%</div><div class="ckl">Puntualidad</div></div>'
      + '<div class="ckpi ck-go"><div class="ckv" style="color:#e4c76a;">' + fmtHs(s.promHs) + '</div><div class="ckl">Prom. Jornada</div></div>'
      + '</div>'
      + '</div>'
      + '<div class="cfoot"><span class="cft">Generado el ' + ds + ' · ONE Horarios v3</span>'
      + '<img src="' + imgBase + 'one-icononegro.png" style="height:22px;opacity:.25;" onerror="this.style.display=\'none\'"/>'
      + '</div>'
      + '</div>'  // /cover

      // ═══ PÁG 2: Resumen ejecutivo + gráficos ═══
      + '<div class="page">'
      + '<div class="ph">'
      + '<div class="phn"><img src="' + imgBase + 'one-logocolor.png" style="height:22px;vertical-align:middle;margin-right:8px;" onerror="this.style.display=\'none\'"/>ONE <span>Horarios</span> · Informe de Asistencia</div>'
      + '<div class="phm">' + plLow + ' · ' + (fechaRango||ds) + '<br>' + (data.area||'Todas las áreas') + '</div>'
      + '</div>'
      + '<div class="sec">'
      + '<div class="sel">01 — Resumen Ejecutivo</div>'
      + '<div class="sti"><div class="sta" style="background:#6be1e3;"></div>Panorama General del Período</div>'
      + '<div class="sdiv"></div>'
      + '<div class="sbody">' + an.resumen + '</div>'
      + '</div>'
      + '<div class="krow">'
      + '<div class="kcard"><div class="kv" style="color:#34d399;">' + s.puntual + '</div><div class="kl">Puntuales</div></div>'
      + '<div class="kcard"><div class="kv" style="color:#ef4444;">' + s.tarde + '</div><div class="kl">Con tardanza</div><div class="ks">' + (s.total>0?Math.round(s.tarde/s.total*100):0) + '% del total</div></div>'
      + '<div class="kcard"><div class="kv" style="color:' + (s.promTard>5?'#ef4444':'#34d399') + ';">' + (s.promTard>0?'+':'') + s.promTard + 'm</div><div class="kl">Prom. tardanza</div></div>'
      + '<div class="kcard"><div class="kv" style="color:#e4c76a;">' + s.topExtra.length + '</div><div class="kl">Con hs extra</div></div>'
      + '</div>'
      + '<div class="charts3">'
      + '<div class="cc"><div class="cct">Registros por área</div><div class="cw"><canvas id="cArea"></canvas></div></div>'
      + '<div class="cc"><div class="cct">Puntualidad por área (%)</div><div class="cw"><canvas id="cPunt"></canvas></div></div>'
      + '<div class="cc"><div class="cct">Actividad diaria</div><div class="cw"><canvas id="cDia"></canvas></div></div>'
      + '</div>'
      + '<div class="ins ' + pCls + '"><div class="ini">' + pIco + '</div><div><div class="int">Análisis de Puntualidad</div><div class="inb">' + an.puntualidad + '</div></div></div>'
      + '<div class="pnum">2</div>'
      + '</div>'  // /page2

      // ═══ PÁG 3: Tardanzas y horas extra ═══
      + '<div class="page">'
      + '<div class="ph">'
      + '<div class="phn"><img src="' + imgBase + 'one-logocolor.png" style="height:22px;vertical-align:middle;margin-right:8px;" onerror="this.style.display=\'none\'"/>ONE <span>Horarios</span> · Tardanzas y Horas Extra</div>'
      + '<div class="phm">' + plLow + ' · ' + (fechaRango||ds) + '</div>'
      + '</div>'
      + '<div class="charts2">'
      + '<div class="sec"><div class="sel">02 — Indicadores de Demora</div>'
      + '<div class="sti"><div class="sta" style="background:#ef4444;"></div>Top Tardanzas Acumuladas</div>'
      + '<div class="sdiv"></div>'
      + hbarRows(s.topTard, p=>'+'+p.totalMin+'m', '#ef4444', p=>p.totalMin)
      + '</div>'
      + '<div class="sec"><div class="sel">03 — Compromiso Extra</div>'
      + '<div class="sti"><div class="sta" style="background:#e4c76a;"></div>Top Horas Extra Post-Salida</div>'
      + '<div class="sdiv"></div>'
      + hbarRows(s.topExtra, p=>'+'+fmtHs(p.totalMin/60), '#e4c76a', p=>p.totalMin)
      + '</div>'
      + '</div>'
      + '<div class="ins ' + (s.tarde>0?'ins-r':'ins-g') + '"><div class="ini">' + (s.tarde>0?'⏰':'✅') + '</div><div><div class="int">Impacto Total de Tardanzas</div><div class="inb">' + extraImpact + '</div></div></div>'
      + '<div class="ins ins-y"><div class="ini">⏱️</div><div><div class="int">Horas Extra Post-Salida</div><div class="inb">' + an.extra + '</div></div></div>'
      + '<div class="pnum">3</div>'
      + '</div>'  // /page3

      // ═══ PÁG 4: Desempeño por área ═══
      + '<div class="page">'
      + '<div class="ph">'
      + '<div class="phn"><img src="' + imgBase + 'one-logocolor.png" style="height:22px;vertical-align:middle;margin-right:8px;" onerror="this.style.display=\'none\'"/>ONE <span>Horarios</span> · Desempeño por Área</div>'
      + '<div class="phm">' + plLow + ' · ' + (fechaRango||ds) + '</div>'
      + '</div>'
      + '<div class="sec"><div class="sel">04 — Análisis Sectorial</div>'
      + '<div class="sti"><div class="sta" style="background:#a78bfa;"></div>Resumen por Área de Trabajo</div>'
      + '<div class="sdiv"></div>'
      + '<div class="sbody" style="margin-bottom:18px;">' + an.areas + '</div>'
      + '<table class="atbl"><thead><tr>'
      + '<th>Área</th><th style="text-align:center;">Reg.</th><th style="text-align:center;">Puntuales</th>'
      + '<th style="text-align:center;">Con tard.</th><th style="text-align:center;">Prom. tard.</th>'
      + '<th style="text-align:center;">Prom. jorn.</th><th>Puntualidad %</th>'
      + '</tr></thead><tbody>' + areaTableRows() + '</tbody></table>'
      + '</div>'
      + '<div class="cc" style="margin-bottom:18px;"><div class="cct">Comparativa de puntualidad por área (%)</div><div class="cwt"><canvas id="cPunt2"></canvas></div></div>'
      + '<div class="ins ins-p"><div class="ini">📊</div><div><div class="int">Lectura del Desempeño Sectorial</div><div class="inb">' + sectorAnalysis + '</div></div></div>'
      + '<div class="pnum">4</div>'
      + '</div>'  // /page4

      // ═══ PÁG 5: Recomendaciones + tabla ═══
      + '<div class="page">'
      + '<div class="ph">'
      + '<div class="phn"><img src="' + imgBase + 'one-logocolor.png" style="height:22px;vertical-align:middle;margin-right:8px;" onerror="this.style.display=\'none\'"/>ONE <span>Horarios</span> · Recomendaciones y Registros</div>'
      + '<div class="phm">' + plLow + ' · ' + (fechaRango||ds) + '</div>'
      + '</div>'
      + '<div class="sec"><div class="sel">05 — Plan de Acción</div>'
      + '<div class="sti"><div class="sta" style="background:#34d399;"></div>Recomendaciones Estratégicas</div>'
      + '<div class="sdiv"></div>'
      + recRows()
      + '</div>'
      + '<div class="sec"><div class="sel">06 — Detalle de Registros</div>'
      + '<div class="sti"><div class="sta" style="background:#78809a;"></div>Últimos ' + recs40.length + ' Registros del Período</div>'
      + '<div class="sdiv"></div>'
      + '<table class="dtbl"><thead><tr>'
      + '<th>Área</th><th>Nombre</th><th>Fecha</th><th>Entrada</th><th>Salida</th><th>Horas</th><th>Tardanza</th>'
      + '</tr></thead><tbody>' + regTableRows() + '</tbody></table>'
      + '</div>'
      + '<div class="clos">'
      + '<img src="' + imgBase + 'escencial-logoblanco.png" style="height:28px;filter:brightness(0) invert(1);opacity:.7;margin:0 auto 10px;display:block;" onerror="this.style.display=\'none\'"/>'
      + '<div class="clot">ONE <span>Horarios</span></div>'
      + '<div class="clos2">Sistema de Gestión de Asistencia y Horarios · Escencial Consultora<br>Informe generado automáticamente el ' + ds + '</div>'
      + '</div>'
      + '<div class="pnum">5</div>'
      + '</div>'  // /page5

      + '<script>' + chartScript + '<' + '/script>'
      + '</body></html>';

    return html;
  }

  // ─── Entry point ───
  async function generar() {
    const modal = document.getElementById('mPdfGen');
    const msg   = document.getElementById('pdfGenMsg');
    const bar   = document.getElementById('pdfGenBar');
    const prog  = (p,t) => { if(bar) bar.style.width=p+'%'; if(msg) msg.textContent=t; };
    if (modal) modal.style.display = 'flex';
    try {
      prog(10, 'Consultando datos...');
      const data  = await _fetch();
      prog(35, 'Calculando estadísticas...');
      const stats = _calc(data.rows, data.hs);
      prog(60, 'Generando análisis cualitativo...');
      const an    = _anlz(stats, data);
      prog(82, 'Renderizando informe...');
      const html  = _buildHTML(data, stats, an);

      // Open in new window via Blob (avoids popup blockers on some browsers)
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url  = URL.createObjectURL(blob);
      const w    = window.open(url, '_blank');
      if (!w) {
        // Fallback: direct write
        const w2 = window.open('', '_blank');
        if (w2) { w2.document.write(html); w2.document.close(); }
        else { showToast('Activá los popups para este sitio', 'err'); if(modal) modal.style.display='none'; return; }
      }

      prog(100, '¡Listo! Usá el botón "Guardar como PDF" o Ctrl+P.');
      setTimeout(() => {
        if (modal) modal.style.display = 'none';
        showToast('✓ Informe abierto — presioná Ctrl+P para guardar como PDF');
      }, 700);
    } catch(e) {
      console.error('InformePDF error:', e);
      if (modal) modal.style.display = 'none';
      showToast('Error generando informe: ' + e.message, 'err');
    }
  }

  return { generar };
})();