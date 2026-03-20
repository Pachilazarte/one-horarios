// js/dashboard-report-pro.js  ·  ONE Horarios — Informe PDF v5 FINAL
// A4 portrait = 794px @ 96dpi. Con scale:2 html2canvas captura a 1588px → jsPDF escala a 210mm.
// El ancho del documento HTML debe ser exactamente 794px.
const DashboardReportPro = (() => {

  const W = 794; // ancho exacto A4 en px a 96dpi

  const AREAS = [
    'ADMINISTRACION','COMERCIAL','RECURSOS HUMANOS','MARKETING',
    'ACADEMICO / GT','INNOVACION Y DESARROLLO','MAESTRANZA',
  ];
  const DIAS = ['lunes','martes','miercoles','jueves','viernes','sabado'];

  // ── COLORES DE ÁREA ──────────────────────────────────────────────
  const AREA_COLORS = {
    'ADMINISTRACION':         '#6be1e3',
    'COMERCIAL':              '#e17bd7',
    'RECURSOS HUMANOS':       '#e4c76a',
    'MARKETING':              '#f472b6',
    'ACADEMICO / GT':         '#a78bfa',
    'INNOVACION Y DESARROLLO':'#34d399',
    'MAESTRANZA':             '#fb923c',
  };
  const aHex = a => AREA_COLORS[a] || '#a4a8c0';

  // ────────────────────────────────────────────────────────────────
  //  ENTRADA PÚBLICA
  // ────────────────────────────────────────────────────────────────
  async function print() {
    const btn  = document.querySelector('.btn-print');
    const prev = btn?.innerHTML || '';

    try {
      if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Generando...'; }

      // Cargar html2pdf si no está
      if (!window.html2pdf) {
        await new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js';
          s.onload = res; s.onerror = rej;
          document.head.appendChild(s);
        });
      }

      const filters = _readFilters();
      const { registros, horarios, personal, error } = await _fetchData(filters);
      if (error) { showToast('Error al cargar datos','err'); return; }

      const report = _buildReport(registros, horarios, personal, filters);

      // ── IFRAME OCULTO en posición (0,0) para que html2canvas no recorte ──
      const iframe = document.createElement('iframe');
      Object.assign(iframe.style, {
        position:      'fixed',
        left:          '0',
        top:           '0',
        width:         W + 'px',
        height:        '10px',
        border:        'none',
        opacity:       '0.01',
        pointerEvents: 'none',
        zIndex:        '-1',
      });
      document.body.appendChild(iframe);

      const doc = iframe.contentDocument;
      doc.open();
      doc.write(_buildHtml(report));
      doc.close();

      // Esperar que cargue completamente
      await _waitReady(iframe);
      await _wait(400);

      // Pintar gráficos
      if (iframe.contentWindow.Chart) {
        await _paintCharts(iframe, report);
        await _wait(600);
      }

      const root = doc.getElementById('rpt');
      if (!root) throw new Error('No se encontró #rpt');

      await window.html2pdf()
        .set({
          margin:  0,
          filename: _filename(report),
          image:   { type: 'jpeg', quality: 0.96 },
          html2canvas: {
            scale:           2,
            useCORS:         true,
            backgroundColor: '#ffffff',
            windowWidth:     W,
            x:               0,
            y:               0,
            scrollX:         0,
            scrollY:         0,
            logging:         false,
          },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true },
          pagebreak: {
            mode:   ['css','legacy'],
            before: '.pb',
            avoid:  ['.nb', 'tr'],
          },
        })
        .from(root)
        .save();

      iframe.remove();
      showToast('PDF descargado ✓','ok');

    } catch(e) {
      console.error(e);
      showToast('Error: ' + e.message, 'err');
    } finally {
      document.querySelectorAll('iframe[style*="opacity: 0.01"]').forEach(f => f.remove());
      if (btn) { btn.disabled = false; btn.innerHTML = prev || '🖨 Informe'; }
    }
  }

  // ────────────────────────────────────────────────────────────────
  //  HELPERS
  // ────────────────────────────────────────────────────────────────
  function _readFilters() {
    const per   = document.getElementById('dPer')?.value  || 'semana';
    const area  = document.getElementById('dArea')?.value || '';
    const range = getDateRange(per) || {};
    return { per, area, desde: range.desde||'', hasta: range.hasta||'' };
  }

  async function _fetchData({ desde, hasta, area }) {
    let qR = SB.from('registros').select('*').order('fecha',{ascending:true}).order('created_at',{ascending:true});
    if (desde) qR = qR.gte('fecha', desde);
    if (hasta) qR = qR.lte('fecha', hasta);
    if (area)  qR = qR.eq('area',  area);

    let qH = SB.from('horarios_semanales').select('*').order('semana_desde',{ascending:true}).order('area',{ascending:true});
    if (desde) qH = qH.lte('semana_desde', hasta||desde);
    if (hasta) qH = qH.gte('semana_hasta', desde||hasta);
    if (area)  qH = qH.eq('area', area);

    let qP = SB.from('personal').select('*').order('area',{ascending:true}).order('nombre',{ascending:true});
    if (area) qP = qP.eq('area', area);

    const [{ data: registros, error: eR }, { data: horarios, error: eH }, { data: personal, error: eP }]
      = await Promise.all([qR, qH, qP]);

    return { registros:registros||[], horarios:horarios||[], personal:personal||[], error: eR||eH||eP||null };
  }

  function _buildReport(registros, horarios, personal, filters) {
    const planRows  = _normPlan(horarios);
    const pMap      = _buildPMap(registros, planRows, personal);

    const tards     = registros.map(_tard).filter(v => v !== null);
    const puntuales = tards.filter(v => v <= 0).length;
    const tardes    = tards.filter(v => v > 0).length;
    const punt      = tards.length ? Math.round(puntuales/tards.length*100) : 0;
    const promT     = tards.length ? Math.round(tards.reduce((a,b)=>a+b,0)/tards.length) : 0;

    const completos  = registros.filter(r => r.hora_entrada && r.hora_salida);
    const hsReales   = completos.reduce((a,r) => { const h=calcHs(_hm(r.hora_entrada),_hm(r.hora_salida)); return h?a+h:a; }, 0);
    const hsPlan     = [...pMap.values()].reduce((a,p) => a+p.planH, 0);
    const desvio     = hsReales - hsPlan;

    const aStats = AREAS.map(area => {
      const rr = registros.filter(r => r.area === area);
      const pp = [...pMap.values()].filter(p => p.area === area);
      if (!rr.length && !pp.length) return null;
      const ds = rr.map(_tard).filter(v => v!==null);
      const pu = ds.filter(v=>v<=0).length, ta=ds.filter(v=>v>0).length;
      const pc = ds.length ? Math.round(pu/ds.length*100) : 0;
      const av = ds.length ? Math.round(ds.reduce((a,b)=>a+b,0)/ds.length) : null;
      const hr = rr.reduce((a,r)=>{const h=calcHs(_hm(r.hora_entrada),_hm(r.hora_salida));return h?a+h:a;},0);
      const hp = pp.reduce((a,p)=>a+p.planH,0);
      const pr = new Set([...rr.map(x=>x.nombre),...pp.map(x=>x.nombre)].filter(Boolean)).size;
      return { area, color:aHex(area), personas:pr, registros:rr.length, punt:pc, promTard:av, puntuales:pu, tardes:ta, hp, hr, dif:hr-hp };
    }).filter(Boolean);

    const people = [...pMap.values()].sort((a,b)=>a.area!==b.area?a.area.localeCompare(b.area):a.nombre.localeCompare(b.nombre));

    const topT = registros.map(r=>{const d=_tard(r);if(d===null||d<=0)return null;return{area:r.area||'',nombre:r.nombre||'',fecha:r.fecha||'',turno:r.turno||'',entrada:_hm(r.hora_entrada),salida:_hm(r.hora_salida),tardanza:d};}).filter(Boolean).sort((a,b)=>b.tardanza-a.tardanza).slice(0,10);
    const obs   = registros.filter(r=>(r.observaciones||'').trim()).map(r=>({fecha:r.fecha||'',area:r.area||'',nombre:r.nombre||'',texto:(r.observaciones||'').trim()})).slice(0,20);
    const inc   = registros.filter(r=>(r.hora_entrada&&!r.hora_salida)||(!r.hora_entrada&&r.hora_salida)).map(r=>({fecha:r.fecha||'',area:r.area||'',nombre:r.nombre||'',ent:_hm(r.hora_entrada),sal:_hm(r.hora_salida)})).slice(0,20);
    const desf  = people.filter(p=>Math.abs(p.dif)>0.05||p.tard>0||p.inc>0).sort((a,b)=>{const aw=Math.abs(a.dif)+(a.promT&&a.promT>0?a.promT/60:0);const bw=Math.abs(b.dif)+(b.promT&&b.promT>0?b.promT/60:0);return bw-aw;}).slice(0,16);
    const sinP  = people.filter(p=>p.regs>0&&p.planH<=0).slice(0,14);
    const sinR  = people.filter(p=>p.planH>0&&p.regs<=0).slice(0,14);

    const mejorA = [...aStats].filter(a=>a.registros>0).sort((a,b)=>b.punt-a.punt)[0]||null;
    const peorA  = [...aStats].filter(a=>a.registros>0).sort((a,b)=>a.punt-b.punt)[0]||null;
    const masC   = [...aStats].sort((a,b)=>b.registros-a.registros)[0]||null;
    const topTa  = topT[0]||null;

    const conc = _conclusion({punt,promT,desvio,inc,sinP,sinR,mejorA,peorA});

    return {
      at: new Date(), filters,
      registros, aStats, people, topT, obs, inc, desf, sinP, sinR,
      tabChunks: _chunk(people.filter(p=>p.regs>0||p.planH>0).sort((a,b)=>{const ax=Math.abs(a.dif)+Math.max(a.promT||0,0)/60+a.inc;const bx=Math.abs(b.dif)+Math.max(b.promT||0,0)/60+b.inc;return bx-ax;}), 18),
      kpis: { total:registros.length, personas:new Set([...registros.map(r=>`${r.area}||${r.nombre}`),...planRows.map(r=>`${r.area}||${r.nombre}`)].filter(Boolean)).size, punt, puntuales, tardes, promT, hsReales, hsPlan, promHR:completos.length?hsReales/completos.length:null, desvio },
      conc, meta: { mejorA, peorA, masC, topTa },
    };
  }

  function _conclusion({punt,promT,desvio,inc,sinP,sinR,mejorA,peorA}) {
    const fp = punt>=90?'alto':punt>=75?'aceptable':'sensible';
    const ct = promT<=3?'controlado':promT<=10?'moderado':'crítico';
    const cs = (!inc.length&&!sinP.length&&!sinR.length)?'alta':(inc.length+sinP.length+sinR.length)<=6?'media':'baja';
    const fort=[], aler=[], acc=[];
    if(mejorA) fort.push(`${mejorA.area} lidera con ${mejorA.punt}% de puntualidad.`);
    if(punt>=85) fort.push(`Puntualidad global en franja positiva (${punt}%).`);
    if(Math.abs(desvio)<=2) fort.push('Diferencia planificación/ejecución es reducida.');
    if(!fort.length) fort.push('El período ofrece base útil de medición.');
    if(peorA&&peorA.punt<75) aler.push(`${peorA.area} requiere revisión (${peorA.punt}%).`);
    if(promT>8) aler.push('Tardanza promedio supera franja saludable.');
    if(inc.length) aler.push(`${inc.length} registro(s) incompleto(s).`);
    if(sinP.length) aler.push(`${sinP.length} persona(s) sin planificación visible.`);
    if(sinR.length) aler.push(`${sinR.length} planificada(s) sin actividad registrada.`);
    acc.push('Controlar semanalmente áreas con menor puntualidad.');
    acc.push('Cruzar hs planificadas vs reales para detectar desvíos.');
    acc.push('Corregir registros incompletos antes del cierre semanal.');
    acc.push('Seguimiento individual de eventos de tardanza extrema.');
    return {fp,ct,cs,fort,aler,acc};
  }

  function _normPlan(rows) {
    const out=[];
    (rows||[]).forEach(row=>{
      (Array.isArray(row?.horarios)?row.horarios:[]).forEach(p=>{
        let h=0;
        const item={area:row.area||'',nombre:p?.nombre||'',rol:p?.rol||'',planH:0};
        DIAS.forEach(d=>{const e=p?.[d]?.e||'',s=p?.[d]?.s||'',e2=p?.[d]?.e2||'',s2=p?.[d]?.s2||'';item[`${d}_e`]=e;item[`${d}_s`]=s;const h1=calcHs(e,s),h2=calcHs(e2,s2);if(h1)h+=h1;if(h2)h+=h2;});
        item.planH=h; out.push(item);
      });
    });
    return out;
  }

  function _buildPMap(registros, planRows, personal) {
    const map=new Map();
    const touch=(area,nombre,rol='')=>{const k=`${area||''}||${nombre||''}`;if(!nombre)return null;if(!map.has(k))map.set(k,{k,area:area||'',nombre:nombre||'',rol:rol||'',regs:0,planH:0,realH:0,dif:0,pun:0,tard:0,promT:null,inc:0});const it=map.get(k);if(!it.rol&&rol)it.rol=rol;return it;};
    (personal||[]).forEach(p=>touch(p.area,p.nombre,p.rol));
    (planRows||[]).forEach(p=>touch(p.area,p.nombre,p.rol));
    (registros||[]).forEach(r=>touch(r.area,r.nombre,r.rol));
    (planRows||[]).forEach(p=>{const it=touch(p.area,p.nombre,p.rol);if(it)it.planH+=p.planH||0;});
    const tb=new Map();
    (registros||[]).forEach(r=>{
      const it=touch(r.area,r.nombre,r.rol);if(!it)return;
      it.regs++;
      if((r.hora_entrada&&!r.hora_salida)||(!r.hora_entrada&&r.hora_salida))it.inc++;
      const h=calcHs(_hm(r.hora_entrada),_hm(r.hora_salida));if(h)it.realH+=h;
      const d=_tard(r);
      if(d!==null){if(!tb.has(it.k))tb.set(it.k,[]);tb.get(it.k).push(d);if(d<=0)it.pun++;else it.tard++;}
    });
    for(const it of map.values()){it.dif=it.realH-it.planH;const a=tb.get(it.k)||[];it.promT=a.length?Math.round(a.reduce((x,y)=>x+y,0)/a.length):null;}
    return map;
  }

  function _tard(r) {
    if(!r?.turno||!r?.hora_entrada)return null;
    const pe=String(r.turno).split('→')[0].trim();
    if(!/^\d{2}:\d{2}$/.test(pe))return null;
    const re=_hm(r.hora_entrada);if(!re)return null;
    return calcTardVsPlan(pe,re);
  }

  const _hm = v => v ? String(v).slice(0,5) : '';
  const _wait = ms => new Promise(r => setTimeout(r, ms));
  const _waitReady = iframe => new Promise(res => {
    const check = () => { if(iframe.contentDocument?.readyState==='complete'){res();}else{setTimeout(check,80);} };
    check();
  });
  const _chunk = (arr, n) => { const o=[]; for(let i=0;i<arr.length;i+=n)o.push(arr.slice(i,i+n)); return o.length?o:[[]]; };
  const _fdt = d => { const dt=d instanceof Date?d:new Date(d), p=n=>String(n).padStart(2,'0'); return `${p(dt.getDate())}/${p(dt.getMonth()+1)}/${dt.getFullYear()} ${p(dt.getHours())}:${p(dt.getMinutes())}`; };
  const _filename = r => { const a=(r.filters.area||'todas').toLowerCase().replace(/\s+/g,'-').replace(/[^\w-]/g,''); return `informe-ONE-${a}-${r.filters.desde||'nd'}-${r.filters.hasta||'nd'}.pdf`; };
  const _pl = per => ({'hoy':'Hoy','semana':'Esta semana','semana_ant':'Semana anterior','mes':'Este mes','mes_ant':'Mes anterior','anio':'Este año','todos':'Histórico','custom':'Personalizado'}[per]||per||'—');
  const _e = v => String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const _fd = d => { if(!d)return'—'; const [y,m,day]=d.split('-'); return `${day}/${m}/${y}`; };

  // ────────────────────────────────────────────────────────────────
  //  HTML COMPLETO DEL INFORME
  // ────────────────────────────────────────────────────────────────
  function _buildHtml(r) {
    return `<!DOCTYPE html><html lang="es"><head>
<meta charset="UTF-8"/>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js" crossorigin="anonymous"><\/script>
<style>
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;margin:0;padding:0;}
body{font-family:Arial,Helvetica,sans-serif;background:#fff;color:#111827;width:${W}px;}
#rpt{width:${W}px;background:#fff;}

/* page control */
.pb{page-break-before:always;break-before:page;height:0;display:block;}
.nb{break-inside:avoid;page-break-inside:avoid;}

/* COVER */
.cover{width:${W}px;min-height:1122px;background:#0d1426;color:#fff;display:flex;flex-direction:column;justify-content:space-between;padding:44px 48px;}
.cover-logo{display:flex;align-items:center;gap:13px;}
.cover-icon{width:50px;height:50px;border-radius:50%;background:rgba(107,225,227,.15);border:2px solid rgba(107,225,227,.4);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;}
.cover-brand{font-size:13px;font-weight:800;color:#6be1e3;letter-spacing:.12em;text-transform:uppercase;}
.cover-sub{font-size:10px;color:rgba(198,201,215,.5);margin-top:2px;letter-spacing:.08em;}
.cover-date{text-align:right;}
.cover-date-lbl{font-size:10px;color:rgba(198,201,215,.4);text-transform:uppercase;letter-spacing:.1em;}
.cover-date-val{font-size:14px;font-weight:800;color:rgba(255,255,255,.9);margin-top:3px;}
.cover-body{flex:1;display:flex;flex-direction:column;justify-content:center;padding:56px 0 36px;}
.cover-pill{display:inline-block;background:rgba(107,225,227,.08);border:1px solid rgba(107,225,227,.22);border-radius:999px;padding:8px 18px;margin-bottom:28px;}
.cover-pill span{font-size:11px;font-weight:800;color:#6be1e3;letter-spacing:.14em;text-transform:uppercase;}
.cover-title{font-size:76px;font-weight:900;line-height:.88;letter-spacing:-.04em;color:#fff;margin-bottom:16px;}
.cover-title-grad{background:linear-gradient(90deg,#6be1e3,#e17bd7,#e4c76a);-webkit-background-clip:text;background-clip:text;color:transparent;}
.cover-desc{font-size:15px;line-height:1.7;color:rgba(255,255,255,.55);max-width:520px;margin-bottom:36px;}
.cover-meta{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;}
.cover-meta-item{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:14px 15px;}
.cover-meta-lbl{font-size:9px;font-weight:800;color:rgba(198,201,215,.5);letter-spacing:.1em;text-transform:uppercase;margin-bottom:7px;}
.cover-meta-val{font-size:15px;font-weight:800;color:#fff;line-height:1.2;}
.cover-kpis{border-top:1px solid rgba(255,255,255,.1);padding-top:28px;}
.cover-kpis-ttl{font-size:9px;font-weight:800;color:rgba(198,201,215,.4);letter-spacing:.12em;text-transform:uppercase;margin-bottom:14px;}
.cover-kpis-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;}
.cover-kpi{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09);border-radius:12px;padding:12px 13px;}
.cover-kpi-lbl{font-size:8px;color:rgba(198,201,215,.45);font-weight:700;text-transform:uppercase;letter-spacing:.09em;margin-bottom:7px;}
.cover-kpi-val{font-size:24px;font-weight:800;line-height:1;}

/* INDEX PAGE */
.index-page{width:${W}px;min-height:1122px;background:#fff;padding:52px 56px;}
.index-header{display:flex;align-items:center;gap:14px;margin-bottom:44px;}
.index-bar{width:5px;height:50px;border-radius:3px;background:linear-gradient(180deg,#6be1e3,#e17bd7);flex-shrink:0;}
.index-supra{font-size:11px;font-weight:800;color:#94a3b8;letter-spacing:.12em;text-transform:uppercase;margin-bottom:4px;}
.index-title{font-size:38px;font-weight:900;color:#0f172a;letter-spacing:-.03em;}
.index-item{display:flex;align-items:center;padding:14px 0;border-bottom:1px solid #f1f5f9;}
.index-num{width:44px;height:44px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.index-num.hl{background:linear-gradient(135deg,rgba(107,225,227,.18),rgba(225,123,215,.12));border-color:rgba(107,225,227,.28);}
.index-num span{font-size:13px;font-weight:900;color:#64748b;}
.index-num.hl span{color:#0d1426;}
.index-text{flex:1;margin:0 18px;font-size:14px;font-weight:700;color:#1e293b;}
.index-dots{width:100px;height:1px;background:repeating-linear-gradient(90deg,#cbd5e1 0,#cbd5e1 4px,transparent 4px,transparent 8px);}
.index-pg{font-size:12px;font-weight:800;color:#94a3b8;min-width:32px;text-align:right;}
.index-note{margin-top:40px;padding:18px 22px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;font-size:11px;line-height:1.7;color:#475569;}

/* CONTENT PAGES */
.pg{width:${W}px;background:#fff;padding:26px 30px 22px;}
.pg-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding-bottom:11px;border-bottom:2px solid #f1f5f9;}
.pg-header-left{display:flex;align-items:center;gap:9px;}
.pg-bar{width:4px;height:28px;border-radius:2px;flex-shrink:0;}
.pg-title{font-size:16px;font-weight:900;color:#0f172a;}
.pg-sub{font-size:9px;color:#64748b;margin-top:1px;}
.pg-right{font-size:9px;color:#94a3b8;font-weight:600;}

/* GRID LAYOUTS */
.g4{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:8px;}
.g6{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:10px;}
.g2{display:grid;grid-template-columns:1.3fr .7fr;gap:10px;margin-bottom:10px;}
.g2eq{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px;}
.g-charts{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;}
.g-areas{display:grid;grid-template-columns:1fr 1fr;gap:8px;}

/* CARDS */
.card{border:1px solid #e2e8f0;border-radius:12px;background:#fff;overflow:hidden;}
.card-p{padding:11px 12px;}
.lbl{font-size:8px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#64748b;margin-bottom:5px;}
.val-sm{font-size:20px;font-weight:900;line-height:1;}
.val-lg{font-size:13px;font-weight:900;line-height:1.2;}
.foot{font-size:8px;color:#94a3b8;margin-top:3px;}
.kpi-top::before{content:"";display:block;height:3px;background:linear-gradient(90deg,#6be1e3,#e17bd7,#e4c76a);border-radius:2px 2px 0 0;margin:-11px -12px 10px;}

/* NARRATIVE */
.narr p{font-size:10.5px;line-height:1.65;color:#374151;margin-bottom:6px;}
.synth-badges{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:9px;}
.sb{border:1px solid #e2e8f0;border-radius:10px;padding:8px;background:#fafcff;}
.sb-lbl{font-size:8px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-weight:800;margin-bottom:4px;}
.sb-val{font-size:13px;font-weight:800;color:#0f172a;}
.notes{display:flex;flex-direction:column;gap:4px;}
.note{display:flex;align-items:flex-start;gap:6px;border:1px solid #e2e8f0;border-radius:9px;padding:6px 8px;background:#fff;}
.dot{width:6px;height:6px;border-radius:50%;flex-shrink:0;margin-top:4px;}
.note-txt{font-size:10px;line-height:1.5;color:#1f2937;}

/* CHARTS */
.chart-card{border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:12px;}
.chart-ttl{font-size:11px;font-weight:800;color:#111827;margin-bottom:1px;}
.chart-dsc{font-size:8px;color:#64748b;margin-bottom:8px;}
.chart-wrap{height:200px;position:relative;}

/* AREA CARDS */
.area-card{border:1px solid #e2e8f0;border-radius:12px;background:#fff;overflow:hidden;}
.area-bar{height:4px;}
.area-body{padding:9px 11px;}
.area-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px;}
.area-name{font-size:12px;font-weight:800;color:#111827;}
.area-tag{padding:3px 8px;border-radius:999px;font-size:8px;font-weight:800;border:1px solid;white-space:nowrap;}
.area-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;}
.am{border:1px solid #f1f5f9;border-radius:8px;padding:5px;background:#fafcff;}
.am-l{font-size:7px;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;margin-bottom:3px;font-weight:800;}
.am-v{font-size:11px;font-weight:800;color:#111827;}

/* TABLES */
.tbl-wrap{border:1px solid #e2e8f0;border-radius:11px;overflow:hidden;}
.tbl{width:100%;border-collapse:collapse;}
.tbl th{background:#f1f5f9;font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#64748b;padding:6px 7px;text-align:left;border-bottom:1px solid #e2e8f0;}
.tbl td{font-size:10px;color:#1e293b;padding:6px 7px;border-bottom:1px solid #f1f5f9;vertical-align:top;line-height:1.4;}
.tbl tr:last-child td{border-bottom:none;}
.txt-ok{color:#166534;font-weight:800;}
.txt-warn{color:#92400e;font-weight:800;}
.txt-bad{color:#991b1b;font-weight:800;}
.txt-gray{color:#64748b;}
.fw{font-weight:700;}

/* INSIGHT PANELS */
.ins-panel{border:1px solid #e2e8f0;border-radius:11px;background:#fff;padding:11px 13px;}
.ins-ttl{font-size:11px;font-weight:800;color:#111827;margin-bottom:7px;}
.ins-ul{padding-left:13px;}
.ins-ul li{margin-bottom:5px;font-size:10px;color:#1f2937;line-height:1.5;}

/* CONCLUSION */
.conc{border-radius:16px;padding:16px 20px;background:linear-gradient(135deg,rgba(107,225,227,.07),rgba(225,123,215,.05),rgba(228,199,106,.05));border:1px solid #e2e8f0;}
.conc-ttl{font-size:14px;font-weight:800;color:#0f172a;margin-bottom:9px;}
.conc-ul{padding-left:16px;}
.conc-ul li{font-size:10.5px;line-height:1.6;color:#1f2937;margin-bottom:5px;}

/* SEC TITLE */
.sec{font-size:12px;font-weight:800;color:#0f172a;margin-bottom:2px;}
.sec-sub{font-size:8px;color:#64748b;margin-bottom:7px;}
</style>
</head><body>
<div id="rpt">
${_cover(r)}
${_index(r)}
${_page3(r)}
${_page4(r)}
${_annexPages(r)}
</div>
</body></html>`;
  }

  // ────────────────────────────────────────────────────────────────
  //  PORTADA
  // ────────────────────────────────────────────────────────────────
  function _cover(r) {
    const k=r.kpis, f=r.filters;
    const rng=f.desde||f.hasta?`${f.desde?_fd(f.desde):'—'}${f.hasta?' → '+_fd(f.hasta):''}`:'Sin límite';
    return `
<div class="cover">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;">
    <div class="cover-logo">
      <div class="cover-icon">🕐</div>
      <div>
        <div class="cover-brand">ONE · Sistema de Horarios</div>
        <div class="cover-sub">ESCENCIAL CONSULTORA</div>
      </div>
    </div>
    <div class="cover-date">
      <div class="cover-date-lbl">Generado el</div>
      <div class="cover-date-val">${_e(_fdt(r.at))}</div>
    </div>
  </div>

  <div class="cover-body">
    <div class="cover-pill"><span>Informe ejecutivo · Dashboard operativo</span></div>
    <div class="cover-title">
      ONE<br><span class="cover-title-grad">Horarios</span>
    </div>
    <div class="cover-desc">Informe integral con lectura cuantitativa y cualitativa del período. Integra puntualidad, planificación vs ejecución, consistencia de registros y focos por área.</div>
    <div class="cover-meta">
      ${[['Período',_e(_pl(f.per))],['Rango',_e(rng)],['Área',_e(f.area||'Todas las áreas')],['Registros',String(k.total)]].map(([l,v])=>`
        <div class="cover-meta-item">
          <div class="cover-meta-lbl">${l}</div>
          <div class="cover-meta-val">${v}</div>
        </div>`).join('')}
    </div>
  </div>

  <div class="cover-kpis">
    <div class="cover-kpis-ttl">Indicadores clave del período</div>
    <div class="cover-kpis-grid">
      ${[
        ['Puntualidad', k.punt+'%',  k.punt>=85?'#34d399':k.punt>=70?'#e4c76a':'#ef4444'],
        ['Personas',    String(k.personas), '#6be1e3'],
        ['Hs planif.',  fmtHs(k.hsPlan),   '#e4c76a'],
        ['Hs reales',   fmtHs(k.hsReales), '#6be1e3'],
        ['Prom tarda.', k.promT+'m',        k.promT<=3?'#34d399':k.promT<=10?'#e4c76a':'#ef4444'],
        ['Incompletos', String(r.inc.length),r.inc.length?'#e4c76a':'#34d399'],
      ].map(([l,v,col])=>`
        <div class="cover-kpi">
          <div class="cover-kpi-lbl">${l}</div>
          <div class="cover-kpi-val" style="color:${col}">${_e(v)}</div>
        </div>`).join('')}
    </div>
  </div>
</div>`;
  }

  // ────────────────────────────────────────────────────────────────
  //  ÍNDICE
  // ────────────────────────────────────────────────────────────────
  function _index(r) {
    const f=r.filters;
    const rng=f.desde||f.hasta?`${f.desde?_fd(f.desde):'—'}${f.hasta?' → '+_fd(f.hasta):''}`:'Sin límite';
    const items=[
      ['01','Indicadores clave del período','3'],
      ['02','Lectura cualitativa y síntesis ejecutiva','3'],
      ['03','Visuales de gestión — 4 gráficos','3'],
      ['04','Resumen por área','3–4'],
      ['05','Tardanzas más relevantes','4'],
      ['06','Fortalezas · Alertas · Focos','4'],
      ['07','Desvíos prioritarios por persona','4'],
      ['08','Conclusión y acciones sugeridas','4'],
      ['09','Anexo — planificación y ejecución','5+'],
      ['10','Observaciones · Incompletos · Sin plan/registros','5+'],
    ];
    return `
<div class="pb"></div>
<div class="index-page">
  <div class="index-header">
    <div class="index-bar"></div>
    <div>
      <div class="index-supra">ONE Horarios · Escencial Consultora</div>
      <div class="index-title">Contenido del informe</div>
    </div>
  </div>
  ${items.map(([n,t,p],i)=>`
    <div class="index-item nb" style="${i===items.length-1?'border-bottom:none':''}">
      <div class="index-num ${i<4?'hl':''}"><span>${n}</span></div>
      <div class="index-text">${t}</div>
      <div class="index-dots"></div>
      <div class="index-pg">p.${p}</div>
    </div>`).join('')}
  <div class="index-note">
    Informe generado automáticamente por <strong>ONE Horarios</strong>.
    Período: <strong>${_e(_pl(f.per))}</strong> ·
    Área: <strong>${_e(f.area||'Todas las áreas')}</strong> ·
    Rango: <strong>${_e(rng)}</strong> ·
    Generado: <strong>${_e(_fdt(r.at))}</strong>.
  </div>
</div>`;
  }

  // ────────────────────────────────────────────────────────────────
  //  PÁGINA 3: KPIs + NARRATIVA + GRÁFICOS + ÁREAS
  // ────────────────────────────────────────────────────────────────
  function _page3(r) {
    const k=r.kpis, c=r.conc, f=r.filters;
    const rng=f.desde||f.hasta?`${_fd(f.desde)} → ${_fd(f.hasta)}`:'—';
    const pC=k.punt>=85?'#166534':k.punt>=70?'#92400e':'#991b1b';
    const tC=k.promT<=3?'#166534':k.promT<=10?'#92400e':'#991b1b';
    const dC=Math.abs(k.desvio)<=2?'#166534':k.desvio>0?'#92400e':'#991b1b';

    const narr=[
      `Durante ${_pl(f.per).toLowerCase()}, se relevaron ${r.registros.length} registros. Puntualidad: ${k.punt}%. Tardanza promedio: ${k.promT} min.`,
      r.meta.masC?`${r.meta.masC.area} concentró mayor volumen: ${r.meta.masC.registros} registros y ${r.meta.masC.personas} persona(s).`:'Sin concentración dominante por área.',
      r.meta.mejorA&&r.meta.peorA?`${r.meta.mejorA.area} lideró puntualidad (${r.meta.mejorA.punt}%); ${r.meta.peorA.area} fue el punto más sensible (${r.meta.peorA.punt}%).`:'Sin base suficiente para comparar áreas.',
      `${fmtHs(k.hsPlan)} planificadas vs ${fmtHs(k.hsReales)} reales. Desvío: ${k.desvio>0?'+':k.desvio<0?'−':''}${fmtHs(Math.abs(k.desvio))}.`,
      r.meta.topTa?`Tardanza máxima: ${r.meta.topTa.tardanza} min — ${r.meta.topTa.nombre} el ${_fd(r.meta.topTa.fecha)}.`:'Sin tardanzas significativas.',
      `${r.inc.length} registro(s) incompleto(s) · ${r.sinP.length} sin planificación · ${r.sinR.length} planificados sin registro.`,
    ];

    return `
<div class="pb"></div>
<div class="pg">

  <div class="pg-header nb">
    <div class="pg-header-left">
      <div class="pg-bar" style="background:linear-gradient(180deg,#6be1e3,#e17bd7)"></div>
      <div>
        <div class="pg-title">Indicadores del período</div>
        <div class="pg-sub">Métricas consolidadas · ${_e(_pl(f.per))}</div>
      </div>
    </div>
    <div class="pg-right">ONE Horarios · ${_e(rng)}</div>
  </div>

  <div class="g4">
    ${[['Total registros',String(k.total),'#0e7490'],['Personas involucradas',String(k.personas),'#7c3aed'],['Hs planificadas',fmtHs(k.hsPlan),'#92400e'],['Hs reales registradas',fmtHs(k.hsReales),'#065f46']].map(([l,v,col])=>`
      <div class="card nb"><div class="card-p">
        <div class="lbl">${l}</div>
        <div class="val-sm" style="color:${col}">${_e(v)}</div>
      </div></div>`).join('')}
  </div>

  <div class="g6">
    ${[
      ['Puntualidad',k.punt+'%',pC,`${k.puntuales} puntual · ${k.tardes} tarde`],
      ['Prom. tardanza',k.promT+'m',tC,'Registros comparables'],
      ['Prom. hs/reg.',k.promHR!==null?fmtHs(k.promHR):'—','#0e7490','Con entrada y salida'],
      ['Desvío global',`${k.desvio>0?'+':k.desvio<0?'−':''}${fmtHs(Math.abs(k.desvio))}`,dC,'Ejecución vs plan'],
      ['Incompletos',String(r.inc.length),r.inc.length?'#92400e':'#166534','Sin entrada o salida'],
      ['Consistencia',c.cs,c.cs==='alta'?'#166534':c.cs==='media'?'#92400e':'#991b1b','Plan + regs + completitud'],
    ].map(([l,v,col,ft])=>`
      <div class="card kpi-top nb"><div class="card-p">
        <div class="lbl">${l}</div>
        <div class="val-sm" style="color:${col}">${_e(v)}</div>
        <div class="foot">${ft}</div>
      </div></div>`).join('')}
  </div>

  <div class="g2">
    <div class="card nb"><div class="card-p">
      <div class="lbl" style="font-size:11px;font-weight:800;color:#0f172a;text-transform:none;letter-spacing:0;margin-bottom:3px;">Lectura cualitativa del período</div>
      <div class="sec-sub">Resumen construido sobre los indicadores del tablero.</div>
      <div class="narr">${narr.map(p=>`<p>${_e(p)}</p>`).join('')}</div>
    </div></div>
    <div class="card nb"><div class="card-p" style="background:linear-gradient(180deg,#fff,#fffdf5);">
      <div class="lbl" style="font-size:11px;font-weight:800;color:#0f172a;text-transform:none;letter-spacing:0;margin-bottom:3px;">Síntesis ejecutiva</div>
      <div class="sec-sub">Semáforo gerencial del período.</div>
      <div class="synth-badges">
        ${[['Puntualidad',c.fp],['Tardanza',c.ct],['Consistencia',c.cs]].map(([l,v])=>`
          <div class="sb"><div class="sb-lbl">${l}</div><div class="sb-val">${_e(v)}</div></div>`).join('')}
      </div>
      <div class="notes">
        ${c.fort.map(t=>`<div class="note nb"><div class="dot" style="background:#34d399"></div><div class="note-txt">${_e(t)}</div></div>`).join('')}
        ${(c.aler.length?c.aler:['Sin alertas críticas.']).map(t=>`<div class="note nb"><div class="dot" style="background:${c.aler.length?'#e4c76a':'#34d399'}"></div><div class="note-txt">${_e(t)}</div></div>`).join('')}
      </div>
    </div></div>
  </div>

  <div class="sec">Visuales de gestión</div>
  <div class="sec-sub">Distribución, puntualidad, horas y consistencia por área.</div>
  <div class="g-charts">
    ${[['rptC1','Distribución por área','Volumen relativo de registros.'],['rptC2','Puntualidad por área','Cumplimiento comparado.'],['rptC3','Planificación vs ejecución','Hs planificadas frente a hs reales.'],['rptC4','Consistencia administrativa','Casos a revisar para mejorar calidad.']].map(([id,t,d])=>`
      <div class="chart-card nb">
        <div class="chart-ttl">${t}</div>
        <div class="chart-dsc">${d}</div>
        <div class="chart-wrap"><canvas id="${id}"></canvas></div>
      </div>`).join('')}
  </div>

  <div class="sec">Resumen por área</div>
  <div class="sec-sub">Estado operativo compacto de cada sector.</div>
  <div class="g-areas">
    ${r.aStats.map(a=>`
      <div class="area-card nb">
        <div class="area-bar" style="background:${_e(a.color)}"></div>
        <div class="area-body">
          <div class="area-head">
            <div class="area-name">${_e(a.area)}</div>
            <div class="area-tag" style="background:${_e(a.color)}22;border-color:${_e(a.color)}55;color:${_e(a.color)}">${a.punt}% puntual</div>
          </div>
          <div class="area-grid">
            ${[['Personas',String(a.personas)],['Registros',String(a.registros)],['Hs plan.',fmtHs(a.hp)],['Hs reales',fmtHs(a.hr)],['Prom tard.',a.promTard===null?'—':`${a.promTard>0?'+':''}${a.promTard}m`],['Puntuales',String(a.puntuales)],['Tardes',String(a.tardes)],['Desvío',`${a.dif>0?'+':a.dif<0?'−':''}${fmtHs(Math.abs(a.dif))}`]].map(([ml,mv],i)=>`
              <div class="am">
                <div class="am-l">${ml}</div>
                <div class="am-v" style="${i===7?`color:${Math.abs(a.dif)<=1?'#166534':a.dif>0?'#92400e':'#991b1b'}`:''}">${_e(mv)}</div>
              </div>`).join('')}
          </div>
        </div>
      </div>`).join('')}
  </div>

</div>`;
  }

  // ────────────────────────────────────────────────────────────────
  //  PÁGINA 4: TARDANZAS + INSIGHTS + DESVÍOS + CONCLUSIÓN
  // ────────────────────────────────────────────────────────────────
  function _page4(r) {
    const c=r.conc, f=r.filters;
    return `
<div class="pb"></div>
<div class="pg">

  <div class="pg-header nb">
    <div class="pg-header-left">
      <div class="pg-bar" style="background:linear-gradient(180deg,#e17bd7,#e4c76a)"></div>
      <div>
        <div class="pg-title">Análisis detallado</div>
        <div class="pg-sub">Tardanzas · Insights · Desvíos · Conclusión</div>
      </div>
    </div>
    <div class="pg-right">ONE Horarios · ${_e(_pl(f.per))}</div>
  </div>

  <div class="sec">Tardanzas más relevantes</div>
  <div class="sec-sub">Eventos con mayor impacto sobre el período analizado.</div>
  <div class="tbl-wrap nb" style="margin-bottom:10px;">
    <table class="tbl">
      <thead><tr><th>#</th><th>Área</th><th>Nombre</th><th>Fecha</th><th>Turno plan.</th><th>Entrada</th><th>Salida</th><th>Tardanza</th></tr></thead>
      <tbody>
        ${r.topT.length?r.topT.map((t,i)=>`
          <tr>
            <td class="txt-gray">${i+1}</td>
            <td><span style="font-weight:800;color:${_e(aHex(t.area))};font-size:8px;">${_e(t.area)}</span></td>
            <td class="fw">${_e(t.nombre)}</td>
            <td>${_e(_fd(t.fecha))}</td>
            <td class="txt-gray">${_e(t.turno||'—')}</td>
            <td>${_e(t.entrada||'—')}</td>
            <td>${_e(t.salida||'—')}</td>
            <td class="txt-bad">+${t.tardanza}m</td>
          </tr>`).join(''):`<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:12px;">Sin tardanzas relevantes.</td></tr>`}
      </tbody>
    </table>
  </div>

  <div class="g3">
    <div class="ins-panel nb">
      <div class="ins-ttl">✅ Fortalezas</div>
      <ul class="ins-ul">${c.fort.map(x=>`<li>${_e(x)}</li>`).join('')}</ul>
    </div>
    <div class="ins-panel nb">
      <div class="ins-ttl">⚠️ Alertas</div>
      <ul class="ins-ul">${(c.aler.length?c.aler:['Sin alertas críticas.']).map(x=>`<li>${_e(x)}</li>`).join('')}</ul>
    </div>
    <div class="ins-panel nb">
      <div class="ins-ttl">🎯 Focos</div>
      <ul class="ins-ul">
        <li>${_e(r.meta.mejorA?`Mejor: ${r.meta.mejorA.area} (${r.meta.mejorA.punt}%).`:'Sin mejor área.')}</li>
        <li>${_e(r.meta.peorA?`Sensible: ${r.meta.peorA.area} (${r.meta.peorA.punt}%).`:'Sin área crítica.')}</li>
        <li>${_e(r.meta.masC?`Mayor carga: ${r.meta.masC.area} (${r.meta.masC.registros} reg.).`:'Sin carga dominante.')}</li>
        <li>${_e(r.meta.topTa?`Tardanza máx.: ${r.meta.topTa.tardanza}m — ${r.meta.topTa.nombre}.`:'Sin tardanza crítica.')}</li>
      </ul>
    </div>
  </div>

  <div class="sec">Desvíos prioritarios por persona</div>
  <div class="sec-sub">Diferencia horaria, tardanza o registros incompletos.</div>
  <div class="tbl-wrap nb" style="margin-bottom:10px;">
    <table class="tbl">
      <thead><tr><th>Área</th><th>Nombre</th><th>Rol</th><th>Reg.</th><th>Hs plan.</th><th>Hs reales</th><th>Desvío</th><th>Prom tard.</th><th>Inc.</th></tr></thead>
      <tbody>
        ${r.desf.length?r.desf.map(p=>`
          <tr>
            <td><span style="font-weight:800;color:${_e(aHex(p.area))};font-size:8px;">${_e(p.area)}</span></td>
            <td class="fw">${_e(p.nombre)}</td>
            <td class="txt-gray">${_e(p.rol||'—')}</td>
            <td>${p.regs}</td>
            <td>${p.planH>0?_e(fmtHs(p.planH)):'—'}</td>
            <td>${p.realH>0?_e(fmtHs(p.realH)):'—'}</td>
            <td class="${Math.abs(p.dif)<=1?'txt-ok':p.dif>0?'txt-warn':'txt-bad'}">${Math.abs(p.dif)>0.05?`${p.dif>0?'+':'−'}${_e(fmtHs(Math.abs(p.dif)))}`:'—'}</td>
            <td>${p.promT===null?'—':`${p.promT>0?'+':''}${p.promT}m`}</td>
            <td>${p.inc}</td>
          </tr>`).join(''):`<tr><td colspan="9" style="text-align:center;color:#94a3b8;padding:12px;">Sin desvíos relevantes.</td></tr>`}
      </tbody>
    </table>
  </div>

  <div class="conc nb">
    <div class="conc-ttl">📋 Conclusión y acciones sugeridas</div>
    <ul class="conc-ul">${c.acc.map(x=>`<li>${_e(x)}</li>`).join('')}</ul>
  </div>

</div>`;
  }

  // ────────────────────────────────────────────────────────────────
  //  PÁGINAS ANEXO
  // ────────────────────────────────────────────────────────────────
  function _annexPages(r) {
    return r.tabChunks.map((chunk, idx) => `
<div class="pb"></div>
<div class="pg">

  <div class="pg-header nb">
    <div class="pg-header-left">
      <div class="pg-bar" style="background:linear-gradient(180deg,#6be1e3,#34d399)"></div>
      <div>
        <div class="pg-title">Anexo de personas · ${idx+1} / ${r.tabChunks.length}</div>
        <div class="pg-sub">Detalle de planificación y ejecución por persona.</div>
      </div>
    </div>
    <div class="pg-right">ONE Horarios</div>
  </div>

  <div class="tbl-wrap nb" style="margin-bottom:${idx===r.tabChunks.length-1?'10px':'0'};">
    <table class="tbl">
      <thead><tr><th>Área</th><th>Nombre</th><th>Rol</th><th>Reg.</th><th>Hs plan.</th><th>Hs reales</th><th>Desvío</th><th>Prom tard.</th><th>Inc.</th></tr></thead>
      <tbody>
        ${chunk.map(p=>`
          <tr>
            <td><span style="font-weight:800;color:${_e(aHex(p.area))};font-size:8px;">${_e(p.area)}</span></td>
            <td class="fw">${_e(p.nombre)}</td>
            <td class="txt-gray">${_e(p.rol||'—')}</td>
            <td>${p.regs}</td>
            <td>${p.planH>0?_e(fmtHs(p.planH)):'—'}</td>
            <td>${p.realH>0?_e(fmtHs(p.realH)):'—'}</td>
            <td class="${Math.abs(p.dif)<=1?'txt-ok':p.dif>0?'txt-warn':'txt-bad'}">${Math.abs(p.dif)>0.05?`${p.dif>0?'+':'−'}${_e(fmtHs(Math.abs(p.dif)))}`:'—'}</td>
            <td>${p.promT===null?'—':`${p.promT>0?'+':''}${p.promT}m`}</td>
            <td>${p.inc}</td>
          </tr>`).join('')}
      </tbody>
    </table>
  </div>

  ${idx === r.tabChunks.length-1 ? `
  <div class="g2eq">
    <div class="tbl-wrap nb">
      <div style="padding:9px 10px;border-bottom:1px solid #e2e8f0;font-size:11px;font-weight:800;color:#111827;">Observaciones registradas</div>
      <table class="tbl">
        <thead><tr><th>Fecha</th><th>Área</th><th>Nombre</th><th>Observación</th></tr></thead>
        <tbody>
          ${r.obs.length?r.obs.map(o=>`
            <tr>
              <td>${_e(_fd(o.fecha))}</td>
              <td><span style="font-weight:800;color:${_e(aHex(o.area))};font-size:8px;">${_e(o.area)}</span></td>
              <td class="fw">${_e(o.nombre)}</td>
              <td style="color:#475569;">${_e(o.texto)}</td>
            </tr>`).join(''):`<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:10px;">Sin observaciones.</td></tr>`}
        </tbody>
      </table>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;">
      <div class="tbl-wrap nb">
        <div style="padding:9px 10px;border-bottom:1px solid #e2e8f0;font-size:11px;font-weight:800;color:#111827;">Registros incompletos</div>
        <table class="tbl">
          <thead><tr><th>Fecha</th><th>Área</th><th>Nombre</th><th>Entrada</th><th>Salida</th></tr></thead>
          <tbody>${r.inc.length?r.inc.map(x=>`<tr><td>${_e(_fd(x.fecha))}</td><td>${_e(x.area)}</td><td class="fw">${_e(x.nombre)}</td><td>${_e(x.ent||'—')}</td><td>${_e(x.sal||'—')}</td></tr>`).join(''):`<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:8px;">Sin casos.</td></tr>`}</tbody>
        </table>
      </div>
      <div class="tbl-wrap nb">
        <div style="padding:9px 10px;border-bottom:1px solid #e2e8f0;font-size:11px;font-weight:800;color:#111827;">Actividad sin planificación</div>
        <table class="tbl">
          <thead><tr><th>Área</th><th>Nombre</th><th>Regs</th><th>Hs reales</th></tr></thead>
          <tbody>${r.sinP.length?r.sinP.map(p=>`<tr><td>${_e(p.area)}</td><td class="fw">${_e(p.nombre)}</td><td>${p.regs}</td><td>${_e(fmtHs(p.realH))}</td></tr>`).join(''):`<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:8px;">Sin casos.</td></tr>`}</tbody>
        </table>
      </div>
      <div class="tbl-wrap nb">
        <div style="padding:9px 10px;border-bottom:1px solid #e2e8f0;font-size:11px;font-weight:800;color:#111827;">Planificación sin registros</div>
        <table class="tbl">
          <thead><tr><th>Área</th><th>Nombre</th><th>Rol</th><th>Hs plan.</th></tr></thead>
          <tbody>${r.sinR.length?r.sinR.map(p=>`<tr><td>${_e(p.area)}</td><td class="fw">${_e(p.nombre)}</td><td class="txt-gray">${_e(p.rol||'—')}</td><td>${_e(fmtHs(p.planH))}</td></tr>`).join(''):`<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:8px;">Sin casos.</td></tr>`}</tbody>
        </table>
      </div>
    </div>
  </div>
  ` : ''}

</div>`).join('');
  }

  // ────────────────────────────────────────────────────────────────
  //  GRÁFICOS
  // ────────────────────────────────────────────────────────────────
  async function _paintCharts(iframe, r) {
    const Chart = iframe.contentWindow.Chart;
    const doc   = iframe.contentDocument;
    if (!Chart) return;

    const labels = r.aStats.map(a => a.area);
    const colors = r.aStats.map(a => a.color);
    const font   = 'Arial,Helvetica,sans-serif';
    const ax     = '#667085';
    const gr     = '#e7ecf3';
    const tip    = { backgroundColor:'#0f172a', titleColor:'#fff', bodyColor:'#e5e7eb', padding:8 };
    const tick   = { color:ax, font:{ family:font, size:8, weight:'700' } };
    const nog    = { display:false };

    const mk = (id, cfg) => { const el=doc.getElementById(id); if(!el)return null; return new Chart(el.getContext('2d'),cfg); };

    mk('rptC1',{type:'doughnut',data:{labels,datasets:[{data:r.aStats.map(a=>a.registros),backgroundColor:colors.map(c=>`${c}CC`),borderColor:colors,borderWidth:2,hoverOffset:4}]},options:{responsive:true,maintainAspectRatio:false,cutout:'56%',plugins:{tooltip:{...tip},legend:{position:'bottom',labels:{color:ax,font:{family:font,size:8,weight:'700'},boxWidth:9,padding:7}}}}});
    mk('rptC2',{type:'bar',data:{labels,datasets:[{label:'% puntualidad',data:r.aStats.map(a=>a.punt),backgroundColor:colors.map(c=>`${c}55`),borderColor:colors,borderWidth:2,borderRadius:6,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{tooltip:{...tip},legend:{display:false}},scales:{x:{ticks:tick,grid:nog},y:{ticks:tick,grid:{color:gr},min:0,max:100}}}});
    mk('rptC3',{type:'bar',data:{labels,datasets:[{label:'Hs planif.',data:r.aStats.map(a=>+a.hp.toFixed(2)),backgroundColor:'#e4c76a55',borderColor:'#e4c76a',borderWidth:2,borderRadius:6,borderSkipped:false},{label:'Hs reales',data:r.aStats.map(a=>+a.hr.toFixed(2)),backgroundColor:'#6be1e355',borderColor:'#6be1e3',borderWidth:2,borderRadius:6,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{tooltip:{...tip},legend:{labels:{color:ax,font:{family:font,size:9,weight:'700'},boxWidth:10,padding:8}}},scales:{x:{ticks:tick,grid:nog},y:{ticks:tick,grid:{color:gr}}}}});
    mk('rptC4',{type:'polarArea',data:{labels:['Incompletos','Sin plan','Sin regs','Top tardanzas'],datasets:[{data:[r.inc.length,r.sinP.length,r.sinR.length,r.topT.length],backgroundColor:['#e4c76a66','#e17bd766','#a78bfa66','#6be1e366'],borderColor:['#e4c76a','#e17bd7','#a78bfa','#6be1e3'],borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{tooltip:{...tip},legend:{position:'bottom',labels:{color:ax,font:{family:font,size:8,weight:'700'},boxWidth:9,padding:7}}},scales:{r:{grid:{color:gr},angleLines:{color:gr},pointLabels:{color:ax,font:{family:font,size:8,weight:'700'}},ticks:{color:ax,backdropColor:'#fff',font:{family:font,size:7,weight:'700'}}}}}});

    await _wait(400);
  }

  return { print };
})();