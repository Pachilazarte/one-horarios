# -*- coding: utf-8 -*-
"""
Servidor ADMS local v4 — lector ZKTeco MB10-VL → one-horarios
=============================================================
v4 = panel de CONTROL TOTAL del lector, todo local (fase de pruebas antes de
integrar a one-horarios).

Además de recibir/guardar todo (v3), ahora el panel permite:
  - Cargar personal de one-horarios al lector (crea el usuario con nombre real
    y PIN automático desde 100 — nace ya vinculado, sin matcheo posterior).
  - Enrolar huella por orden remota (la pantalla del lector salta sola).
  - Sincronizar la hora del equipo con la de esta PC.
  - Mandar mensajes de texto a la pantalla (SMS internos).
  - Borrar usuarios del lector, restaurar huellas desde el backup local,
    reiniciar el equipo, y mandar comandos manuales para experimentar.

Todos los comandos quedan ENCOLADOS y el lector los toma cuando está conectado
(pollea cada ~10 s). El resultado se ve en la sección Comandos del panel.

Panel: http://localhost:8081/  ·  JSON: /api/todo  ·  CSV: /export/*.csv
Sin dependencias externas: solo stdlib.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, quote
import urllib.request as urlreq
from contextlib import contextmanager
import sqlite3, datetime, socket, os, threading, html, csv, io, sys, json, re, time

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# En Linux (la X270 corre en UTC) forzamos la zona horaria argentina para este
# proceso — sin tocar la configuración del sistema. En Windows no hace falta.
if os.name == "posix":
    os.environ.setdefault("TZ", "America/Argentina/Buenos_Aires")
    try:
        time.tzset()
    except Exception:
        pass

BASE = os.path.dirname(os.path.abspath(__file__))
DB   = os.path.join(BASE, "lector.db")
LOGF = os.path.join(BASE, "lector.log")
FOTOS = os.path.join(BASE, "fotos")
PUERTO = 8081
TZ_HORAS = -3  # Argentina

_lock = threading.Lock()

def log(msg):
    line = f"[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    try:
        print(line, flush=True)
    except Exception:
        pass
    with _lock:
        with open(LOGF, "a", encoding="utf-8") as f:
            f.write(line + "\n")

@contextmanager
def db():
    """Conexión que SIEMPRE se cierra (y commitea si no hubo error)."""
    c = sqlite3.connect(DB, timeout=10)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=10000")
    try:
        yield c
        c.commit()
    finally:
        c.close()

def init_db():
    os.makedirs(FOTOS, exist_ok=True)
    with db() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS eventos_raw(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT, sn TEXT, tipo TEXT, contenido TEXT);
        CREATE TABLE IF NOT EXISTS fichajes(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sn TEXT, pin TEXT, fecha_hora TEXT, status TEXT, verify TEXT,
            recibido TEXT,
            UNIQUE(sn, pin, fecha_hora));
        CREATE TABLE IF NOT EXISTS usuarios(
            pin TEXT PRIMARY KEY, nombre TEXT, privilegio TEXT,
            card TEXT, grupo TEXT, raw TEXT, actualizado TEXT);
        CREATE TABLE IF NOT EXISTS plantillas(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sn TEXT, pin TEXT, tipo TEXT, fid TEXT, size TEXT,
            raw TEXT, recibido TEXT,
            UNIQUE(sn, tipo, pin, fid));
        CREATE TABLE IF NOT EXISTS mapeo(
            pin TEXT PRIMARY KEY, nombre_personal TEXT, area TEXT, actualizado TEXT);
        CREATE TABLE IF NOT EXISTS dispositivo(
            sn TEXT PRIMARY KEY, primera_vez TEXT, ultima_vez TEXT, info TEXT);
        CREATE TABLE IF NOT EXISTS comandos(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sn TEXT, cmd TEXT, estado TEXT DEFAULT 'pendiente',
            respuesta TEXT, creado TEXT, respondido TEXT);
        """)
        c.execute("""CREATE TABLE IF NOT EXISTS workcodes(
            code TEXT PRIMARY KEY, nombre TEXT, actualizado TEXT)""")
        c.execute("""CREATE TABLE IF NOT EXISTS config(
            k TEXT PRIMARY KEY, v TEXT)""")
        c.execute("""CREATE TABLE IF NOT EXISTS avisos_marcas(
            pin TEXT, fecha TEXT, tipo TEXT,
            PRIMARY KEY(pin, fecha, tipo))""")
        try:
            c.execute("ALTER TABLE fichajes ADD COLUMN workcode TEXT")
        except Exception:
            pass  # la columna ya existe

def ahora():
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def ip_local():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80)); ip = s.getsockname()[0]; s.close()
        return ip
    except Exception:
        return "?"

def decodificar(b):
    for enc in ("utf-8", "gb18030"):
        try: return b.decode(enc)
        except Exception: pass
    return b.decode("utf-8", "replace")

def supabase_cfg():
    """URL y anon key de Supabase. Primero intenta ../js/supabase.js (cuando el
    server corre dentro del proyecto); si no existe (ej. en la X270), lee el
    supabase.json que viaja junto al server."""
    try:
        with open(os.path.join(BASE, "..", "js", "supabase.js"), encoding="utf-8") as f:
            t = f.read()
        url = re.search(r"SUPA_URL\s*=\s*'([^']+)'", t).group(1)
        key = re.search(r"SUPA_KEY\s*=\s*'([^']+)'", t).group(1)
        return {"url": url, "key": key}
    except Exception:
        pass
    try:
        with open(os.path.join(BASE, "supabase.json"), encoding="utf-8") as f:
            d = json.load(f)
        if d.get("url") and d.get("key"):
            return {"url": d["url"], "key": d["key"]}
    except Exception:
        pass
    return None

def zk_datetime(dt):
    """Codificación de fecha/hora del protocolo ZK para SET OPTION DateTime."""
    return (((dt.year - 2000) * 12 * 31 + (dt.month - 1) * 31 + (dt.day - 1)) * 86400
            + dt.hour * 3600 + dt.minute * 60 + dt.second)

def sn_principal():
    """SN del lector real (el primero que no sea simulador/test)."""
    with db() as c:
        for (sn,) in c.execute("SELECT sn FROM dispositivo ORDER BY ultima_vez DESC"):
            if sn and "simulador" not in sn.lower() and "test" not in sn.lower():
                return sn
    return None

def encolar(cmd, sn=None, unico=False):
    """Mete un comando en la cola. Devuelve el id o None si no hay lector.
    unico=True: si ya hay uno idéntico pendiente, no duplica."""
    sn = sn or sn_principal()
    if not sn:
        return None
    with db() as c:
        if unico:
            ya = c.execute("SELECT id FROM comandos WHERE sn=? AND cmd=? AND estado='pendiente'",
                           (sn, cmd)).fetchone()
            if ya:
                return ya[0]
        c.execute("INSERT INTO comandos(sn, cmd, creado) VALUES(?,?,?)", (sn, cmd, ahora()))
        cid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
    log(f"ENCOLADO cmd {cid}: {cmd[:120]}")
    return cid

def siguiente_pin():
    """PIN automático para personal nuevo: arranca en 100, sigue del máximo."""
    usados = set()
    with db() as c:
        for (p,) in c.execute("SELECT pin FROM usuarios"): usados.add(p)
        for (p,) in c.execute("SELECT pin FROM mapeo"): usados.add(p)
    nums = [int(p) for p in usados if p and p.isdigit()]
    return str(max([99] + nums) + 1)

# ── TODO lo que el protocolo PUSH permite pedir ──────────────────────────────
SEMILLA = [
    "INFO", "CHECK",
    "DATA QUERY USERINFO", "DATA QUERY FINGERTMP", "DATA QUERY FACE",
    "DATA QUERY BIODATA", "DATA QUERY USERPIC", "DATA QUERY ATTLOG",
    "DATA QUERY ATTPHOTO", "DATA QUERY WORKCODE", "DATA QUERY SMS",
]

def encolar_semilla(sn):
    with db() as c:
        for cmd in SEMILLA:
            c.execute("INSERT INTO comandos(sn, cmd, creado) VALUES(?,?,?)",
                      (sn, cmd, ahora()))

def registrar_dispositivo(sn):
    nuevo = False
    with db() as c:
        fila = c.execute("SELECT sn FROM dispositivo WHERE sn=?", (sn,)).fetchone()
        if fila:
            c.execute("UPDATE dispositivo SET ultima_vez=? WHERE sn=?", (ahora(), sn))
        else:
            c.execute("INSERT INTO dispositivo(sn, primera_vez, ultima_vez) VALUES(?,?,?)",
                      (sn, ahora(), ahora()))
            nuevo = True
    if nuevo:
        encolar_semilla(sn)
        log(f"** NUEVO DISPOSITIVO: {sn} — volcado completo encolado ({len(SEMILLA)} comandos)")

def guardar_raw(sn, tipo, contenido):
    with db() as c:
        c.execute("INSERT INTO eventos_raw(ts, sn, tipo, contenido) VALUES(?,?,?,?)",
                  (ahora(), sn, tipo, contenido[:5000]))

STATUS = {"0": "Entrada", "1": "Salida", "2": "Pausa-sale", "3": "Pausa-vuelve",
          "4": "HExtra-in", "5": "HExtra-out", "255": "—"}
VERIFY = {"0": "Clave", "1": "Huella", "3": "Clave", "4": "Tarjeta",
          "15": "Cara", "25": "Palma"}
# códigos de trabajo cargados al lector = nuestras áreas (2026-08-27)
AREAS_WORKCODE = {"1": "ADMINISTRACION", "2": "COMERCIAL", "3": "RECURSOS HUMANOS",
                  "4": "MARKETING", "5": "ACADEMICO / GT", "6": "INNOVACION Y DESARROLLO",
                  "7": "MAESTRANZA", "8": "PASANTIAS"}
TIPO_A_TABLA = {"FP": "FINGERTMP", "FACE": "FACE", "BIODATA": "BIODATA",
                "BIOPHOTO": "BIOPHOTO", "USERPIC": "USERPIC"}

def _kv(linea, corte):
    campos = {}
    for kv in linea[corte:].split("\t"):
        if "=" in kv:
            k, v = kv.split("=", 1)
            campos[k.strip().lower()] = v.strip()
    return campos

def guardar_usuario(sn, linea):
    campos = _kv(linea, 5)
    pin = campos.get("pin", "")
    if not pin: return
    with db() as c:
        c.execute("""INSERT INTO usuarios(pin,nombre,privilegio,card,grupo,raw,actualizado)
                     VALUES(?,?,?,?,?,?,?)
                     ON CONFLICT(pin) DO UPDATE SET
                       nombre=excluded.nombre, privilegio=excluded.privilegio,
                       card=excluded.card, grupo=excluded.grupo,
                       raw=excluded.raw, actualizado=excluded.actualizado""",
                  (pin, campos.get("name",""), campos.get("pri",""),
                   campos.get("card",""), campos.get("grp",""), linea[:2000], ahora()))
    log(f"  USUARIO: PIN {pin} — {campos.get('name','(sin nombre)')}")

def guardar_plantilla(sn, tipo, linea):
    campos = _kv(linea, len(tipo) + 1)
    pin = campos.get("pin", "")
    if not pin: return
    fid = campos.get("fid", campos.get("no", ""))
    size = campos.get("size", str(len(linea)))
    with db() as c:
        c.execute("""INSERT INTO plantillas(sn,pin,tipo,fid,size,raw,recibido)
                     VALUES(?,?,?,?,?,?,?)
                     ON CONFLICT(sn,tipo,pin,fid) DO UPDATE SET
                       size=excluded.size, raw=excluded.raw, recibido=excluded.recibido""",
                  (sn, pin, tipo, fid, size, linea[:100000], ahora()))
    log(f"  {tipo}: PIN {pin} fid={fid or '-'} ({size} bytes)")

PREFIJOS_PLANTILLA = ("FP", "FACE", "BIODATA", "USERPIC", "BIOPHOTO")

def procesar_lineas(sn, texto):
    lineas = [l.strip() for l in texto.strip().splitlines() if l.strip()]
    for l in lineas:
        u = l.upper()
        if u.startswith("USER "):
            guardar_usuario(sn, l)
        else:
            for pref in PREFIJOS_PLANTILLA:
                if u.startswith(pref + " "):
                    guardar_plantilla(sn, pref, l)
                    break
    return len(lineas)

def procesar_attlog(sn, texto):
    lineas = [l for l in texto.strip().splitlines() if l.strip()]
    nuevos = 0
    marcas_nuevas = []
    with db() as c:
        for linea in lineas:
            p = linea.strip().split("\t")
            if len(p) < 2: continue
            pin, fh = p[0].strip(), p[1].strip()
            st = p[2].strip() if len(p) > 2 else ""
            vf = p[3].strip() if len(p) > 3 else ""
            wc = p[4].strip() if len(p) > 4 else ""
            antes = c.total_changes
            c.execute("INSERT OR IGNORE INTO fichajes(sn,pin,fecha_hora,status,verify,recibido,workcode) VALUES(?,?,?,?,?,?,?)",
                      (sn, pin, fh, st, vf, ahora(), wc))
            if c.total_changes - antes:
                nuevos += 1
                marcas_nuevas.append((pin, fh))
        total = c.execute("SELECT COUNT(*) FROM fichajes WHERE sn=?", (sn,)).fetchone()[0]
    log(f"  ATTLOG: {len(lineas)} líneas, {nuevos} nuevas (total en DB: {total})")
    # avisos + sync a registros en hilo aparte: no demoran la respuesta al lector
    for pin, fh in marcas_nuevas:
        threading.Thread(target=_post_marca, args=(pin, fh), daemon=True).start()
    return len(lineas)

def cfg_get(k, defecto=""):
    with db() as c:
        fila = c.execute("SELECT v FROM config WHERE k=?", (k,)).fetchone()
    return fila[0] if fila else defecto

def cfg_set(k, v):
    with db() as c:
        c.execute("INSERT OR REPLACE INTO config(k, v) VALUES(?,?)", (k, str(v)))

# ── Saludo diario automático (mensaje público en la pantalla del lector) ─────
# Sin tildes a propósito: la fuente del firmware puede no renderizarlas.
# Para cambiar los textos: editá esta lista y reiniciá el server (o pedíselo a Claude).
SALUDOS = {
    0: "Buen lunes! Arrancamos con todo",
    1: "Feliz martes! Buena jornada",
    2: "Feliz miercoles para todos!",
    3: "Buen jueves! Ya casi...",
    4: "Feliz viernes! Buen finde",
    5: "Buen sabado! Gracias por estar",
    6: "Buen domingo!",
}
SALUDO_HORA_DESDE = 6    # no manda antes de las 6:00
SALUDO_HORA_HASTA = 20   # el mensaje queda visible hasta las 20:00

def enviar_saludo_si_toca():
    """Una vez por dia, a la mañana, renueva el mensaje publico del lector."""
    if cfg_get("saludo_auto", "1") != "1":
        return
    ahora_dt = datetime.datetime.now()
    hoy = ahora_dt.strftime("%Y-%m-%d")
    if cfg_get("saludo_fecha") == hoy:
        return
    if not (SALUDO_HORA_DESDE <= ahora_dt.hour < SALUDO_HORA_HASTA):
        return
    if not sn_principal():
        return
    msg = SALUDOS.get(ahora_dt.weekday(), "Bienvenidos a Escencial")
    minutos = max(60, (SALUDO_HORA_HASTA - ahora_dt.hour) * 60 - ahora_dt.minute)
    uid = int(time.time()) % 100000
    inicio = ahora_dt.strftime("%Y-%m-%d %H:%M:%S")
    encolar(f"DATA UPDATE SMS MSG={msg}\tTAG=253\tUID={uid}\tMIN={minutos}\tStartTime={inicio}")
    cfg_set("saludo_fecha", hoy)
    log(f"SALUDO DIARIO encolado: \"{msg}\" ({minutos} min en pantalla)")

def bucle_saludo():
    while True:
        try:
            enviar_saludo_si_toca()
        except Exception as e:
            log(f"! error saludo diario: {e}")
        time.sleep(600)  # chequea cada 10 min

# ── Avisos de entrada/salida vs horario planificado ──────────────────────────
def fetch_horario(nombre, fecha):
    """Horario planificado de una persona para una fecha, leyendo
    horarios_semanales de Supabase (solo lectura). Replica getHorarioPlanificado
    de js/utils.js. Devuelve {tipo, entrada, salida} o None."""
    supa = supabase_cfg()
    if not supa:
        return None
    d = datetime.date.fromisoformat(fecha)
    lunes = (d - datetime.timedelta(days=d.weekday())).isoformat()
    daykey = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"][d.weekday()]
    try:
        req = urlreq.Request(
            f"{supa['url']}/rest/v1/horarios_semanales?semana_desde=eq.{lunes}&select=horarios",
            headers={"apikey": supa["key"], "Authorization": "Bearer " + supa["key"]})
        rows = json.loads(urlreq.urlopen(req, timeout=8).read())
    except Exception as e:
        log(f"! no pude leer horarios_semanales: {e}")
        return None
    for row in rows:
        for p in (row.get("horarios") or []):
            if p.get("nombre") != nombre:
                continue
            dd = p.get(daykey)
            if not dd:
                continue
            tipo = dd.get("tipo") or "normal"
            if tipo != "normal":
                return {"tipo": tipo}
            e = (dd.get("e") or "")[:5]
            s = (dd.get("s") or "")[:5]
            e2 = (dd.get("e2") or "")[:5]
            s2 = (dd.get("s2") or "")[:5]
            if not e and not s:
                continue
            return {"tipo": "normal", "entrada": e or None, "salida": s or None,
                    "entrada2": e2 or None, "salida2": s2 or None}
    return None

def generar_aviso_marca(pin, fecha_hora):
    """Mensaje personal 'entraste/saliste X min tarde/temprano' tras cada marca.
    1ª marca del dia = entrada, 2ª = salida. Solo marcas en tiempo real
    (no el histórico re-subido) y solo personas vinculadas con horario normal."""
    try:
        if cfg_get("msgs_marcas", "1") != "1":
            return
        dt = datetime.datetime.strptime(fecha_hora, "%Y-%m-%d %H:%M:%S")
        if abs((datetime.datetime.now() - dt).total_seconds()) > 900:
            return  # marca vieja (re-subida del histórico)
        fecha = dt.strftime("%Y-%m-%d")
        with db() as c:
            fila = c.execute("SELECT nombre_personal FROM mapeo WHERE pin=?", (pin,)).fetchone()
            n_marcas = c.execute("SELECT COUNT(*) FROM fichajes WHERE pin=? AND date(fecha_hora)=?",
                                 (pin, fecha)).fetchone()[0]
        if not fila or not fila[0]:
            return
        nombre = fila[0]
        tipo_marca = "entrada" if n_marcas <= 1 else "salida"
        with db() as c:
            ya = c.execute("SELECT 1 FROM avisos_marcas WHERE pin=? AND fecha=? AND tipo=?",
                           (pin, fecha, tipo_marca)).fetchone()
        if ya:
            return
        plan = fetch_horario(nombre, fecha)
        if not plan or plan.get("tipo") != "normal":
            return  # sin horario, flex, guardia o licencia: sin aviso
        # con horario cortado, la salida real del dia es la del segundo turno
        objetivo = plan.get("entrada") if tipo_marca == "entrada" else (plan.get("salida2") or plan.get("salida"))
        if not objetivo:
            return
        plan_dt = dt.replace(hour=int(objetivo[:2]), minute=int(objetivo[3:5]), second=0)
        diff = round((dt - plan_dt).total_seconds() / 60)
        hhmm = dt.strftime("%H:%M")
        if tipo_marca == "entrada":
            if diff > 0:   msg = f"Entraste {hhmm}, {diff} min tarde"
            elif diff < 0: msg = f"Entraste {hhmm}, {abs(diff)} min temprano"
            else:          msg = f"Entraste {hhmm}, justo a horario!"
            minutos = 720   # visible hasta que marque la salida
        else:
            if diff > 0:   msg = f"Saliste {hhmm}, {diff} min despues de tu horario"
            elif diff < 0: msg = f"Saliste {hhmm}, {abs(diff)} min antes de tu horario"
            else:          msg = f"Saliste {hhmm}, justo a horario!"
            minutos = 1080  # visible hasta la marca de la mañana siguiente
        uid = int(time.time()) % 100000
        inicio = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        encolar(f"DATA UPDATE SMS MSG={msg}\tTAG=254\tUID={uid}\tMIN={minutos}\tStartTime={inicio}")
        encolar(f"DATA UPDATE USER_SMS PIN={pin}\tUID={uid}")
        with db() as c:
            c.execute("INSERT OR IGNORE INTO avisos_marcas(pin, fecha, tipo) VALUES(?,?,?)",
                      (pin, fecha, tipo_marca))
        log(f"AVISO {tipo_marca} a {nombre} (PIN {pin}): \"{msg}\"")
    except Exception as e:
        log(f"! error aviso marca: {e}")

# ── Sincronización reloj → tabla `registros` de Supabase ────────────────────
# Reglas de convivencia con la carga manual (NO se negocian):
#  1. Si el registro del día lo creó una PERSONA (sin marca RELOJ), no se toca.
#  2. El reloj solo crea/actualiza registros propios (observaciones="RELOJ (auto)").
#  3. Si alguien edita a mano un registro del reloj, pierde la marca y el reloj
#     deja de tocarlo: la corrección manual siempre gana.
# Interruptor maestro: config sync_registros (default APAGADO = modo simulación:
# calcula y loguea lo que subiría, sin escribir en Supabase).
MARCA_RELOJ = "RELOJ (auto)"

def supa_rest(metodo, ruta, payload=None):
    """Llamada REST a Supabase con la anon key de la página. None si falla."""
    supa = supabase_cfg()
    if not supa:
        return None
    datos = json.dumps(payload).encode() if payload is not None else None
    req = urlreq.Request(supa["url"] + "/rest/v1/" + ruta, data=datos, method=metodo,
                         headers={"apikey": supa["key"],
                                  "Authorization": "Bearer " + supa["key"],
                                  "Content-Type": "application/json",
                                  "Prefer": "return=representation"})
    try:
        cuerpo = urlreq.urlopen(req, timeout=10).read()
        return json.loads(cuerpo) if cuerpo else []
    except Exception as e:
        log(f"! supabase {metodo} {ruta[:60]}: {e}")
        return None

def _punto_medio(hhmm_a, hhmm_b):
    """'13:00','14:30' -> '13:45:00' (para partir marcas de horario cortado)."""
    a = int(hhmm_a[:2]) * 60 + int(hhmm_a[3:5])
    b = int(hhmm_b[:2]) * 60 + int(hhmm_b[3:5])
    m = (a + b) // 2
    return f"{m // 60:02d}:{m % 60:02d}:00"

def calcular_dia(pin, fecha):
    """Registro diario en formato de la tabla `registros` de one-horarios.
    Horario normal: 1ª marca = entrada, última = salida.
    Horario CORTADO (el plan tiene e2): las marcas se parten en el punto medio
    entre el fin del turno 1 y el inicio del turno 2, llenando los 4 campos."""
    with db() as c:
        horas = [r[0][11:19] for r in c.execute(
            "SELECT fecha_hora FROM fichajes WHERE pin=? AND date(fecha_hora)=? AND fecha_hora>=? ORDER BY fecha_hora",
            (pin, fecha, cfg_get("datos_desde", "")))]
        m = c.execute("SELECT nombre_personal, area FROM mapeo WHERE pin=?", (pin,)).fetchone()
    if not horas or not m or not m[0]:
        return None
    reg = {"nombre": m[0], "area": m[1] or "", "fecha": fecha,
           "hora_entrada": None, "hora_salida": None,
           "hora_entrada2": None, "hora_salida2": None}
    plan = fetch_horario(m[0], fecha)
    if plan and plan.get("tipo") == "normal" and plan.get("entrada2") and plan.get("salida"):
        # horario CORTADO: partir en el punto medio entre fin T1 e inicio T2
        corte = _punto_medio(plan["salida"], plan["entrada2"])
        t1 = [h for h in horas if h <= corte]
        t2 = [h for h in horas if h > corte]
        if t1:
            reg["hora_entrada"] = t1[0]
            if len(t1) > 1: reg["hora_salida"] = t1[-1]
        if t2:
            reg["hora_entrada2"] = t2[0]
            if len(t2) > 1: reg["hora_salida2"] = t2[-1]
    elif plan and plan.get("tipo") == "normal" and plan.get("entrada") and plan.get("salida"):
        # turno SIMPLE con horario fijo: clasificar por franja — las marcas de la
        # primera mitad del turno son entrada, las de la segunda mitad salida.
        # (una marca antes del turno cuenta como entrada; después, como salida)
        corte = _punto_medio(plan["entrada"], plan["salida"])
        t1 = [h for h in horas if h <= corte]
        t2 = [h for h in horas if h > corte]
        if t1:
            reg["hora_entrada"] = t1[0]
        if t2:
            reg["hora_salida"] = t2[-1]
        if not t1 and len(t2) > 1:      # todas tarde: al menos separar en dos
            reg["hora_entrada"] = t2[0]
        if not t2 and len(t1) > 1:      # todas temprano: idem
            reg["hora_salida"] = t1[-1]
    else:
        # sin plan (o flex/guardia): primera marca = entrada, última = salida
        reg["hora_entrada"] = horas[0]
        if len(horas) > 1: reg["hora_salida"] = horas[-1]
    # turno = etiqueta del horario planificado, igual que la carga manual
    if plan and plan.get("tipo") == "normal" and plan.get("entrada"):
        reg["turno"] = f"{plan['entrada']} → {plan.get('salida2') or plan.get('salida') or '?'}"
    else:
        fin = reg["hora_salida2"] or reg["hora_salida"] or reg["hora_entrada2"] or reg["hora_entrada"]
        reg["turno"] = f"{(reg['hora_entrada'] or fin)[:5]} → {fin[:5]}"
    return reg

def sincronizar_registro(pin, fecha):
    """Sube (o simula subir) el registro diario calculado a Supabase."""
    try:
        reg = calcular_dia(pin, fecha)
        if not reg or not any([reg["hora_entrada"], reg["hora_salida"],
                               reg["hora_entrada2"], reg["hora_salida2"]]):
            return "sin datos"
        resumen = (f"E {reg['hora_entrada'] or '-'} S {reg['hora_salida'] or '-'}"
                   + (f" | T2: E {reg['hora_entrada2'] or '-'} S {reg['hora_salida2'] or '-'}"
                      if reg["hora_entrada2"] or reg["hora_salida2"] else ""))
        if cfg_get("sync_registros", "0") != "1":
            log(f"  SYNC SIMULADO (apagado, no sube): {reg['nombre']} {fecha} -> {resumen}")
            return "simulado: " + resumen
        filtro = (f"registros?nombre=eq.{quote(reg['nombre'])}&fecha=eq.{fecha}"
                  f"&select=id,observaciones")
        filas = supa_rest("GET", filtro)
        if filas is None:
            return "error supabase"
        # rol viene de personal (columna NOT NULL en registros)
        rol = "Personal"
        per = supa_rest("GET", f"personal?nombre=eq.{quote(reg['nombre'])}&select=rol")
        if per and per[0].get("rol"):
            rol = per[0]["rol"]
        payload = {"area": reg["area"], "nombre": reg["nombre"], "rol": rol,
                   "turno": reg["turno"], "fecha": fecha,
                   "hora_entrada": reg["hora_entrada"], "hora_salida": reg["hora_salida"],
                   "hora_entrada2": reg["hora_entrada2"], "hora_salida2": reg["hora_salida2"],
                   "observaciones": MARCA_RELOJ}
        if filas:
            obs = (filas[0].get("observaciones") or "")
            if not obs.startswith("RELOJ"):
                log(f"  SYNC: {reg['nombre']} {fecha} tiene registro MANUAL -> se respeta, no se toca")
                return "manual, respetado"
            r = supa_rest("PATCH", f"registros?id=eq.{filas[0]['id']}", payload)
            estado = "actualizado" if r is not None else "error"
        else:
            r = supa_rest("POST", "registros", payload)
            estado = "creado" if r is not None else "error"
        log(f"  SYNC registros: {reg['nombre']} {fecha} -> {estado} ({resumen})")
        return estado
    except Exception as e:
        log(f"! error sync registro: {e}")
        return "error"

def _post_marca(pin, fh):
    """Trabajo posterior a cada marca en tiempo real: aviso + sync del día."""
    generar_aviso_marca(pin, fh)
    try:
        dt = datetime.datetime.strptime(fh, "%Y-%m-%d %H:%M:%S")
        if abs((datetime.datetime.now() - dt).total_seconds()) <= 900:
            sincronizar_registro(pin, dt.strftime("%Y-%m-%d"))
    except Exception as e:
        log(f"! error post-marca: {e}")

def procesar_workcodes(sn, texto):
    """El lector manda su lista completa de códigos de trabajo (= áreas):
    la reemplazamos entera en la tabla local."""
    lineas = [l.strip() for l in texto.strip().splitlines() if l.strip().upper().startswith("WORKCODE ")]
    with db() as c:
        c.execute("DELETE FROM workcodes")
        for l in lineas:
            campos = _kv(l, 9)
            code = campos.get("code", "")
            if code:
                c.execute("INSERT OR REPLACE INTO workcodes(code, nombre, actualizado) VALUES(?,?,?)",
                          (code, campos.get("name", ""), ahora()))
    log(f"  WORKCODES: lista del lector actualizada ({len(lineas)} áreas)")
    return len(lineas)

def guardar_foto(sn, cuerpo_bytes):
    try:
        inicio = cuerpo_bytes.find(b"\xff\xd8")
        cab = decodificar(cuerpo_bytes[:inicio if inicio > 0 else 200])[:200]
        m = re.search(r"PIN=([^&\s]+)", cab)
        nombre = re.sub(r"[^0-9A-Za-z_-]", "_", m.group(1) if m else "foto")
        archivo = os.path.join(FOTOS, f"{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}_{nombre}.jpg")
        if inicio >= 0:
            with open(archivo, "wb") as f:
                f.write(cuerpo_bytes[inicio:])
            log(f"  ATTPHOTO guardada: {os.path.basename(archivo)} ({len(cuerpo_bytes)-inicio} bytes)")
        else:
            log(f"  ATTPHOTO sin JPEG reconocible ({len(cuerpo_bytes)} bytes)")
        guardar_raw(sn, "ATTPHOTO", cab)
    except Exception as e:
        log(f"  ! error guardando foto: {e}")

def guardar_info(sn, cuerpo):
    with db() as c:
        c.execute("UPDATE dispositivo SET info=?, ultima_vez=? WHERE sn=?", (cuerpo, ahora(), sn))

def registros_diarios():
    with db() as c:
        filas = c.execute("""
            SELECT f.pin,
                   COALESCE(NULLIF(m.nombre_personal,''), NULLIF(u.nombre,''), 'PIN ' || f.pin) AS nombre,
                   COALESCE(m.area, '') AS area,
                   date(f.fecha_hora) AS fecha,
                   MIN(time(f.fecha_hora)) AS entrada,
                   MAX(time(f.fecha_hora)) AS salida,
                   COUNT(*) AS marcas,
                   CASE WHEN m.pin IS NULL THEN 0 ELSE 1 END AS matcheado
            FROM fichajes f
            LEFT JOIN usuarios u ON u.pin = f.pin
            LEFT JOIN mapeo m ON m.pin = f.pin
            WHERE f.fecha_hora >= ?
            GROUP BY f.pin, date(f.fecha_hora)
            ORDER BY fecha DESC, nombre""", (cfg_get("datos_desde", ""),)).fetchall()
    return [{"pin": p, "nombre": n, "area": a, "fecha": fe,
             "hora_entrada": en, "hora_salida": sa if ma > 1 else None,
             "marcas": ma, "matcheado": bool(mt)}
            for p, n, a, fe, en, sa, ma, mt in filas]

def todo_json():
    out = {}
    with db() as c:
        c.row_factory = sqlite3.Row
        out["dispositivos"] = [dict(r) for r in c.execute("SELECT * FROM dispositivo")]
        out["usuarios"]     = [dict(r) for r in c.execute("SELECT * FROM usuarios ORDER BY CAST(pin AS INTEGER)")]
        out["plantillas"]   = [dict(r) for r in c.execute("SELECT id,sn,pin,tipo,fid,size,recibido,length(raw) AS raw_len FROM plantillas")]
        out["mapeo"]        = [dict(r) for r in c.execute("SELECT * FROM mapeo")]
        out["fichajes"]     = [dict(r) for r in c.execute("SELECT * FROM fichajes ORDER BY fecha_hora")]
        out["comandos"]     = [dict(r) for r in c.execute("SELECT * FROM comandos ORDER BY id")]
        out["eventos_raw"]  = [dict(r) for r in c.execute("SELECT * FROM eventos_raw ORDER BY id DESC LIMIT 200")]
    out["registros_diarios"] = registros_diarios()
    try:
        out["fotos"] = sorted(os.listdir(FOTOS))
    except Exception:
        out["fotos"] = []
    return out

# ── HTTP ─────────────────────────────────────────────────────────────────────
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def _resp(self, cuerpo, ctype="text/plain"):
        b = cuerpo if isinstance(cuerpo, bytes) else cuerpo.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", f"{ctype}; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        # CORS: permite que las páginas de one-horarios consuman esta API
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(b)

    def _json(self, obj):
        self._resp(json.dumps(obj, ensure_ascii=False), "application/json")

    def _body(self):
        n = int(self.headers.get("Content-Length", 0) or 0)
        return self.rfile.read(n) if n else b""

    # ── GET ──
    def do_GET(self):
        try:
            u = urlparse(self.path)
            q = {k: v[0] for k, v in parse_qs(u.query).items()}
            sn = q.get("SN", "")

            if u.path == "/favicon.ico":
                self._resp(b"")                        # sin ruido en el log
            elif u.path == "/iclock/cdata":            # handshake del lector
                registrar_dispositivo(sn or "(sin SN)")
                guardar_raw(sn, "handshake", self.path)
                log(f"HANDSHAKE de {sn} — {self.path[:200]}")
                self._resp(self._handshake(sn, "pushver" in q))
            elif u.path == "/iclock/getrequest":       # el lector pide comandos
                if sn: registrar_dispositivo(sn)
                cmd = self._proximo_comando(sn)
                if cmd:
                    cid, texto = cmd
                    log(f"-> COMANDO {cid} a {sn}: {texto[:150]}")
                    self._resp(f"C:{cid}:{texto}")
                else:
                    self._resp("OK")
            elif u.path in ("/", "/panel"):
                self._resp(self._panel(), "text/html")
            elif u.path == "/api/todo":
                self._resp(json.dumps(todo_json(), ensure_ascii=False, indent=1), "application/json")
            elif u.path == "/api/mapeo":
                with db() as c:
                    c.row_factory = sqlite3.Row
                    filas = [dict(r) for r in c.execute("SELECT * FROM mapeo")]
                self._json(filas)
            elif u.path == "/api/estado":
                # estado liviano para que el panel se actualice sin recargar
                with db() as c:
                    fila = c.execute("SELECT sn, ultima_vez FROM dispositivo ORDER BY ultima_vez DESC LIMIT 1").fetchone()
                    usrs = [{"pin": r[0], "nombre": r[1]} for r in c.execute("SELECT pin, nombre FROM usuarios")]
                    fp = sorted({r[0] for r in c.execute("SELECT pin FROM plantillas WHERE tipo IN ('FP','BIODATA')")})
                    mapeo = {r[0]: {"nombre": r[1], "area": r[2]} for r in c.execute("SELECT pin, nombre_personal, area FROM mapeo")}
                    pend = c.execute("SELECT COUNT(*) FROM comandos WHERE estado='pendiente'").fetchone()[0]
                    nfich = c.execute("SELECT COUNT(*) FROM fichajes").fetchone()[0]
                online, ult = False, None
                if fila:
                    ult = fila[1]
                    try:
                        online = (datetime.datetime.now() - datetime.datetime.strptime(ult, "%Y-%m-%d %H:%M:%S")).total_seconds() < 45
                    except Exception:
                        pass
                self._json({"online": online, "ultima_vez": ult, "pendientes": pend,
                            "usuarios": usrs, "fp_pins": fp, "mapeo": mapeo, "fichajes": nfich})
            elif u.path == "/api/fichajes":
                # log de tipeos con nombre resuelto (para la página de one-horarios)
                try:
                    lim = max(1, min(int(q.get("limit", "200") or 200), 2000))
                except Exception:
                    lim = 200
                with db() as c:
                    filas = c.execute("""SELECT f.fecha_hora, f.pin,
                                COALESCE(NULLIF(m.nombre_personal,''), NULLIF(u2.nombre,''), 'PIN ' || f.pin),
                                COALESCE(m.area,''), f.status, f.verify,
                                CASE WHEN m.pin IS NULL THEN 0 ELSE 1 END,
                                COALESCE(f.workcode,'')
                             FROM fichajes f
                             LEFT JOIN usuarios u2 ON u2.pin=f.pin
                             LEFT JOIN mapeo m ON m.pin=f.pin
                             WHERE f.fecha_hora >= ?
                             ORDER BY f.fecha_hora DESC LIMIT ?""",
                        (cfg_get("datos_desde", ""), lim)).fetchall()
                with db() as c:
                    mapa_wc = dict(AREAS_WORKCODE)
                    mapa_wc.update({r[0]: r[1] for r in c.execute("SELECT code, nombre FROM workcodes")})
                self._json([{"fecha_hora": r[0], "pin": r[1], "nombre": r[2], "area": r[3],
                             "status": STATUS.get(r[4], r[4] or "—"),
                             "verify": VERIFY.get(r[5], r[5] or "—"),
                             "matcheado": bool(r[6]),
                             "area_marcada": mapa_wc.get(r[7], "")} for r in filas])
            elif u.path == "/api/registros":
                self._json(registros_diarios())
            elif u.path == "/api/workcodes":
                # áreas cargadas en el reloj (códigos de trabajo)
                with db() as c:
                    filas = c.execute("SELECT code, nombre FROM workcodes ORDER BY CAST(code AS INTEGER)").fetchall()
                self._json([{"code": r[0], "nombre": r[1]} for r in filas])
            elif u.path == "/api/saludo_auto":
                self._json({"on": cfg_get("saludo_auto", "1") == "1",
                            "ultimo": cfg_get("saludo_fecha", ""),
                            "hoy": SALUDOS.get(datetime.datetime.now().weekday(), "")})
            elif u.path == "/api/msgs_marcas":
                self._json({"on": cfg_get("msgs_marcas", "1") == "1"})
            elif u.path == "/api/sync_registros":
                self._json({"on": cfg_get("sync_registros", "0") == "1"})
            elif u.path == "/api/preview_dia":
                # vista previa: cómo quedaría el día en la tabla registros (sin subir)
                fecha = q.get("fecha") or datetime.datetime.now().strftime("%Y-%m-%d")
                with db() as c:
                    pins = [r[0] for r in c.execute(
                        "SELECT DISTINCT pin FROM fichajes WHERE date(fecha_hora)=? AND fecha_hora>=?",
                        (fecha, cfg_get("datos_desde", "")))]
                filas = []
                for pin in pins:
                    reg = calcular_dia(pin, fecha)
                    if reg and any([reg["hora_entrada"], reg["hora_salida"],
                                    reg["hora_entrada2"], reg["hora_salida2"]]):
                        reg["observaciones"] = MARCA_RELOJ
                        filas.append(reg)
                filas.sort(key=lambda r: r["nombre"])
                self._json({"fecha": fecha, "registros": filas})
            elif u.path == "/api/reloj_usuarios":
                # ficha completa de cada persona registrada en el reloj:
                # métodos que tiene cargados + su vínculo con el personal
                with db() as c:
                    usrs = c.execute("SELECT pin, nombre, privilegio, card FROM usuarios ORDER BY CAST(pin AS INTEGER)").fetchall()
                    tp = {}
                    for pin, tipo in c.execute("SELECT pin, tipo FROM plantillas"):
                        tp.setdefault(pin, set()).add(tipo)
                    mapeo = {r[0]: {"nombre": r[1], "area": r[2]} for r in c.execute("SELECT pin, nombre_personal, area FROM mapeo")}
                out = []
                for pin, nombre, pri, card in usrs:
                    t = tp.get(pin, set())
                    out.append({"pin": pin, "nombre": nombre, "privilegio": pri,
                                "card": card or "",
                                "huella": "FP" in t,
                                "cara": bool(t & {"BIODATA", "FACE"}),
                                "foto": bool(t & {"BIOPHOTO", "USERPIC"}),
                                "mapeo": mapeo.get(pin)})
                self._json(out)
            elif u.path == "/api/repedir":
                with db() as c:
                    sns = [r[0] for r in c.execute("SELECT sn FROM dispositivo").fetchall()]
                for s in sns:
                    encolar_semilla(s)
                log(f"Re-pedido total encolado para {len(sns)} dispositivo(s)")
                self._json({"ok": True, "dispositivos": len(sns)})
            elif u.path == "/export/fichajes.csv":
                self._resp(self._csv_fichajes(), "text/csv")
            elif u.path == "/export/registros.csv":
                self._resp(self._csv_registros(), "text/csv")
            elif u.path.startswith("/fotos/"):
                ruta = os.path.join(FOTOS, os.path.basename(u.path))
                if os.path.isfile(ruta):
                    with open(ruta, "rb") as f:
                        self._resp(f.read(), "image/jpeg")
                else:
                    self._resp("no existe")
            else:
                guardar_raw(sn, "get_otro", self.path)
                log(f"GET {self.path[:200]}")
                self._resp("OK")
        except Exception as e:
            log(f"!! ERROR GET {self.path[:100]}: {e}")
            try: self._resp("OK")
            except Exception: pass

    # ── POST ──
    def do_POST(self):
        try:
            u = urlparse(self.path)
            q = {k: v[0] for k, v in parse_qs(u.query).items()}
            sn = q.get("SN", "")
            tabla = q.get("table", "").upper()
            crudo = self._body()
            if sn: registrar_dispositivo(sn)

            if u.path == "/iclock/cdata":
                if tabla == "ATTPHOTO":
                    guardar_foto(sn, crudo)
                    self._resp("OK")
                    return
                cuerpo = decodificar(crudo)
                guardar_raw(sn, f"POST {tabla or '(sin tabla)'}", cuerpo)
                if tabla == "ATTLOG":
                    self._resp(f"OK: {procesar_attlog(sn, cuerpo)}")
                elif tabla == "WORKCODE":
                    self._resp(f"OK: {procesar_workcodes(sn, cuerpo)}")
                elif tabla in ("OPERLOG", "USERINFO", "FINGERTMP", "FACE", "BIODATA", "USERPIC", "BIOPHOTO"):
                    self._resp(f"OK: {procesar_lineas(sn, cuerpo)}")
                elif tabla == "OPTIONS":
                    guardar_info(sn, cuerpo)
                    log(f"  OPTIONS del equipo guardadas ({len(cuerpo)} bytes)")
                    self._resp("OK")
                else:
                    log(f"POST tabla={tabla or '?'} ({len(cuerpo)} bytes): {cuerpo[:300]}")
                    self._resp("OK")

            elif u.path == "/iclock/devicecmd":
                cuerpo = decodificar(crudo)
                guardar_raw(sn, "devicecmd", cuerpo)
                log(f"<- RESPUESTA de {sn}: {cuerpo[:400]}")
                self._guardar_respuesta(sn, cuerpo)
                self._resp("OK")

            # ── API del panel ──
            elif u.path == "/api/mapeo":
                d = json.loads(decodificar(crudo) or "{}")
                pin = str(d.get("pin", "")).strip()
                nombre = (d.get("nombre") or "").strip()
                area = (d.get("area") or "").strip()
                if not pin:
                    self._json({"ok": False, "error": "falta pin"}); return
                with db() as c:
                    if nombre:
                        c.execute("""INSERT INTO mapeo(pin, nombre_personal, area, actualizado)
                                     VALUES(?,?,?,?)
                                     ON CONFLICT(pin) DO UPDATE SET
                                       nombre_personal=excluded.nombre_personal,
                                       area=excluded.area, actualizado=excluded.actualizado""",
                                  (pin, nombre, area, ahora()))
                    else:
                        c.execute("DELETE FROM mapeo WHERE pin=?", (pin,))
                log(f"MAPEO: PIN {pin} -> {nombre or '(quitado)'}")
                self._json({"ok": True})

            elif u.path == "/api/cargar":
                # crear persona de one-horarios como usuario del lector, PIN auto
                d = json.loads(decodificar(crudo) or "{}")
                nombre = (d.get("nombre") or "").strip().replace("\t", " ")
                area = (d.get("area") or "").strip()
                if not nombre:
                    self._json({"ok": False, "error": "falta nombre"}); return
                pin = siguiente_pin()
                cid = encolar(f"DATA UPDATE USERINFO PIN={pin}\tName={nombre[:24]}\tPri=0\tGrp=1")
                if cid is None:
                    self._json({"ok": False, "error": "no hay lector registrado"}); return
                with db() as c:
                    c.execute("""INSERT INTO mapeo(pin, nombre_personal, area, actualizado)
                                 VALUES(?,?,?,?)""", (pin, nombre, area, ahora()))
                log(f"CARGAR: {nombre} -> PIN {pin} (cmd {cid})")
                self._json({"ok": True, "pin": pin, "cmd": cid})

            elif u.path == "/api/cargar_enrolar":
                # alta + enrolamiento en un solo paso: crea el usuario con su
                # nombre real y acto seguido la pantalla pide la huella
                d = json.loads(decodificar(crudo) or "{}")
                nombre = (d.get("nombre") or "").strip().replace("\t", " ")
                area = (d.get("area") or "").strip()
                if not nombre:
                    self._json({"ok": False, "error": "falta nombre"}); return
                pin = siguiente_pin()
                cid = encolar(f"DATA UPDATE USERINFO PIN={pin}\tName={nombre[:24]}\tPri=0\tGrp=1")
                if cid is None:
                    self._json({"ok": False, "error": "no hay lector registrado"}); return
                encolar(f"ENROLL_FP PIN={pin}\tFID=6\tRETRY=3\tOVERWRITE=1")
                with db() as c:
                    c.execute("""INSERT INTO mapeo(pin, nombre_personal, area, actualizado)
                                 VALUES(?,?,?,?)""", (pin, nombre, area, ahora()))
                log(f"CARGAR+ENROLAR: {nombre} -> PIN {pin}")
                self._json({"ok": True, "pin": pin})

            elif u.path == "/api/cargar_todos":
                # carga masiva: todo el personal que falte, con nombre real y
                # PIN automático — nacen vinculados, sin matcheo posterior
                d = json.loads(decodificar(crudo) or "{}")
                personas = d.get("personas") or []
                if not sn_principal():
                    self._json({"ok": False, "error": "no hay lector registrado"}); return
                ya_mapeados = set()
                with db() as c:
                    for (n,) in c.execute("SELECT nombre_personal FROM mapeo"):
                        ya_mapeados.add(n)
                asignados = []
                for p in personas:
                    nombre = (p.get("nombre") or "").strip().replace("\t", " ")
                    area = (p.get("area") or "").strip()
                    if not nombre or nombre in ya_mapeados:
                        continue
                    pin = siguiente_pin()
                    encolar(f"DATA UPDATE USERINFO PIN={pin}\tName={nombre[:24]}\tPri=0\tGrp=1")
                    with db() as c:
                        c.execute("INSERT INTO mapeo(pin, nombre_personal, area, actualizado) VALUES(?,?,?,?)",
                                  (pin, nombre, area, ahora()))
                    ya_mapeados.add(nombre)
                    asignados.append({"nombre": nombre, "pin": pin})
                log(f"CARGA MASIVA: {len(asignados)} personas encoladas")
                self._json({"ok": True, "cargados": len(asignados), "asignados": asignados})

            elif u.path == "/api/enrolar":
                d = json.loads(decodificar(crudo) or "{}")
                pin = str(d.get("pin", "")).strip()
                tipo = (d.get("tipo") or "huella").strip()
                if not pin:
                    self._json({"ok": False, "error": "falta pin"}); return
                if tipo == "cara":
                    # ENROLL_BIO TYPE=9 = rostro (según MultiBioDataSupport del equipo)
                    cid = encolar(f"ENROLL_BIO TYPE=9\tPIN={pin}\tNO=0\tRETRY=3\tOVERWRITE=1")
                else:
                    cid = encolar(f"ENROLL_FP PIN={pin}\tFID=6\tRETRY=3\tOVERWRITE=1")
                self._json({"ok": cid is not None, "cmd": cid})

            elif u.path == "/api/borrar_usuario":
                d = json.loads(decodificar(crudo) or "{}")
                pin = str(d.get("pin", "")).strip()
                if not pin:
                    self._json({"ok": False, "error": "falta pin"}); return
                cid = encolar(f"DATA DELETE USERINFO PIN={pin}")
                with db() as c:
                    c.execute("DELETE FROM usuarios WHERE pin=?", (pin,))
                    c.execute("DELETE FROM mapeo WHERE pin=?", (pin,))
                log(f"BORRAR usuario PIN {pin} (cmd {cid})")
                self._json({"ok": cid is not None, "cmd": cid})

            elif u.path == "/api/hora":
                dt = datetime.datetime.now()
                cid = encolar(f"SET OPTION DateTime={zk_datetime(dt)}")
                self._json({"ok": cid is not None, "cmd": cid,
                            "hora_pc": dt.strftime("%Y-%m-%d %H:%M:%S")})

            elif u.path == "/api/reboot":
                cid = encolar("REBOOT")
                self._json({"ok": cid is not None, "cmd": cid})

            elif u.path == "/api/sms":
                d = json.loads(decodificar(crudo) or "{}")
                msg = (d.get("msg") or "").strip().replace("\t", " ")
                minutos = int(d.get("min") or 60)
                if not msg:
                    self._json({"ok": False, "error": "falta msg"}); return
                uid = int(time.time()) % 100000
                inicio = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                cid = encolar(f"DATA UPDATE SMS MSG={msg[:120]}\tTAG=253\tUID={uid}\tMIN={minutos}\tStartTime={inicio}")
                self._json({"ok": cid is not None, "cmd": cid})

            elif u.path == "/api/sms_personal":
                # mensaje que aparece cuando ESA persona marca (TAG=254 + USER_SMS)
                d = json.loads(decodificar(crudo) or "{}")
                pin = str(d.get("pin", "")).strip()
                msg = (d.get("msg") or "").strip().replace("\t", " ")
                minutos = int(d.get("min") or 720)
                if not pin or not msg:
                    self._json({"ok": False, "error": "falta pin o msg"}); return
                uid = int(time.time()) % 100000
                inicio = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                cid = encolar(f"DATA UPDATE SMS MSG={msg[:120]}\tTAG=254\tUID={uid}\tMIN={minutos}\tStartTime={inicio}")
                encolar(f"DATA UPDATE USER_SMS PIN={pin}\tUID={uid}")
                self._json({"ok": cid is not None, "cmd": cid})

            elif u.path == "/api/saludo_auto":
                d = json.loads(decodificar(crudo) or "{}")
                cfg_set("saludo_auto", "1" if d.get("on") else "0")
                if d.get("on"):
                    cfg_set("saludo_fecha", "")   # fuerza reenvio hoy mismo
                    enviar_saludo_si_toca()
                log(f"Saludo diario automatico: {'ON' if d.get('on') else 'OFF'}")
                self._json({"ok": True, "on": bool(d.get("on"))})

            elif u.path == "/api/msgs_marcas":
                d = json.loads(decodificar(crudo) or "{}")
                cfg_set("msgs_marcas", "1" if d.get("on") else "0")
                log(f"Avisos de entrada/salida: {'ON' if d.get('on') else 'OFF'}")
                self._json({"ok": True, "on": bool(d.get("on"))})

            elif u.path == "/api/sync_registros":
                d = json.loads(decodificar(crudo) or "{}")
                cfg_set("sync_registros", "1" if d.get("on") else "0")
                log(f"Subida a registros (Supabase): {'ACTIVADA' if d.get('on') else 'apagada (simulacion)'}")
                self._json({"ok": True, "on": bool(d.get("on"))})

            elif u.path == "/api/borrar_pruebas":
                # borra las marcas de prueba acumuladas y fija el punto de corte:
                # cualquier marca anterior que el reloj re-suba queda excluida
                # de los cálculos para siempre. Vínculos y usuarios NO se tocan.
                corte = ahora()
                with db() as c:
                    nf = c.execute("SELECT COUNT(*) FROM fichajes").fetchone()[0]
                    c.execute("DELETE FROM fichajes")
                    c.execute("DELETE FROM avisos_marcas")
                cfg_set("datos_desde", corte)
                cid = encolar("CLEAR LOG")   # también borrar la memoria de marcas del reloj
                log(f"BORRADO DE PRUEBAS: {nf} marcas locales eliminadas · corte={corte} · CLEAR LOG cmd {cid}")
                self._json({"ok": True, "borrados": nf, "desde": corte})

            elif u.path == "/api/sync_dia":
                # sincroniza (o simula) el dia completo, persona por persona
                d = json.loads(decodificar(crudo) or "{}")
                fecha = (d.get("fecha") or datetime.datetime.now().strftime("%Y-%m-%d")).strip()
                with db() as c:
                    pins = [r[0] for r in c.execute(
                        "SELECT DISTINCT pin FROM fichajes WHERE date(fecha_hora)=? AND fecha_hora>=?",
                        (fecha, cfg_get("datos_desde", "")))]
                resultados = {}
                for pin in pins:
                    with db() as c:
                        m = c.execute("SELECT nombre_personal FROM mapeo WHERE pin=?", (pin,)).fetchone()
                    etiqueta = (m[0] if m and m[0] else f"PIN {pin}")
                    resultados[etiqueta] = sincronizar_registro(pin, fecha)
                self._json({"ok": True, "fecha": fecha,
                            "modo": "REAL" if cfg_get("sync_registros", "0") == "1" else "SIMULACION",
                            "resultados": resultados})

            elif u.path == "/api/areas_sync":
                # reemplaza la lista de áreas del reloj por las del sistema
                d = json.loads(decodificar(crudo) or "{}")
                areas = [a.strip().replace("\t", " ")[:23] for a in (d.get("areas") or []) if a and a.strip()]
                if not areas:
                    self._json({"ok": False, "error": "faltan areas"}); return
                if not sn_principal():
                    self._json({"ok": False, "error": "no hay lector registrado"}); return
                with db() as c:
                    actuales = {r[0] for r in c.execute("SELECT code FROM workcodes")}
                nuevos = {str(i) for i in range(1, len(areas) + 1)}
                for code in sorted(actuales - nuevos, key=lambda x: (len(x), x)):
                    encolar(f"DATA DELETE WORKCODE CODE={code}")
                for i, a in enumerate(areas, 1):
                    encolar(f"DATA UPDATE WORKCODE CODE={i}\tNAME={a}")
                encolar("DATA QUERY WORKCODE", unico=True)
                log(f"AREAS SYNC: {len(areas)} áreas encoladas al lector")
                self._json({"ok": True, "areas": len(areas), "borradas": len(actuales - nuevos)})

            elif u.path == "/api/restaurar":
                # re-subir una plantilla guardada (backup → lector)
                d = json.loads(decodificar(crudo) or "{}")
                pid = d.get("id")
                with db() as c:
                    fila = c.execute("SELECT tipo, raw FROM plantillas WHERE id=?", (pid,)).fetchone()
                if not fila:
                    self._json({"ok": False, "error": "plantilla no encontrada"}); return
                tipo, raw = fila
                tabla_dest = TIPO_A_TABLA.get(tipo, tipo)
                datos = raw[len(tipo) + 1:] if raw.upper().startswith(tipo + " ") else raw
                cid = encolar(f"DATA UPDATE {tabla_dest} {datos}")
                self._json({"ok": cid is not None, "cmd": cid})

            elif u.path == "/api/comando":
                d = json.loads(decodificar(crudo) or "{}")
                cmd = (d.get("cmd") or "").strip()
                if not cmd:
                    self._json({"ok": False, "error": "falta cmd"}); return
                cid = encolar(cmd)
                self._json({"ok": cid is not None, "cmd": cid})

            else:
                cuerpo = decodificar(crudo)
                guardar_raw(sn, "post_otro", f"{self.path}\n{cuerpo[:2000]}")
                log(f"POST {self.path[:200]} ({len(cuerpo)} bytes)")
                self._resp("OK")
        except Exception as e:
            log(f"!! ERROR POST {self.path[:100]}: {e}")
            try: self._resp("OK")
            except Exception: pass

    # ── protocolo ──
    def _handshake(self, sn, nuevo_push):
        if nuevo_push:
            return ("GET OPTION FROM: {sn}\r\n"
                    "ATTLOGStamp=0\r\nOPERLOGStamp=0\r\nATTPHOTOStamp=0\r\n"
                    "ErrorDelay=30\r\nDelay=10\r\n"
                    "TransTimes=00:00;14:05\r\nTransInterval=1\r\n"
                    "TransFlag=TransData AttLog OpLog AttPhoto EnrollUser ChgUser EnrollFP ChgFP UserPic\r\n"
                    f"TimeZone={TZ_HORAS}\r\nRealtime=1\r\nEncrypt=None\r\n").format(sn=sn)
        return ("GET OPTION FROM: {sn}\r\n"
                "Stamp=0\r\nOpStamp=0\r\nPhotoStamp=0\r\n"
                "ErrorDelay=30\r\nDelay=10\r\n"
                "TransTimes=00:00;14:05\r\nTransInterval=1\r\n"
                "TransFlag=1111000000\r\n"
                f"TimeZone={TZ_HORAS}\r\nRealtime=1\r\nEncrypt=0\r\n").format(sn=sn)

    def _proximo_comando(self, sn):
        with db() as c:
            fila = c.execute("""SELECT id, cmd FROM comandos
                                WHERE estado='pendiente' AND (sn=? OR sn='')
                                ORDER BY id LIMIT 1""", (sn,)).fetchone()
            if fila:
                cid, cmd = fila
                # la hora se recalcula al ENTREGAR el comando, no al encolarlo:
                # si esperó en cola, mandaría una hora vieja al equipo
                if cmd.startswith("SET OPTION DateTime="):
                    cmd = f"SET OPTION DateTime={zk_datetime(datetime.datetime.now())}"
                    c.execute("UPDATE comandos SET cmd=? WHERE id=?", (cmd, cid))
                c.execute("UPDATE comandos SET estado='enviado' WHERE id=?", (cid,))
                fila = (cid, cmd)
        return fila

    def _guardar_respuesta(self, sn, cuerpo):
        cid = None
        for parte in cuerpo.replace("\n", "&").split("&"):
            if parte.startswith("ID="):
                cid = parte[3:].strip(); break
        with db() as c:
            if cid:
                c.execute("UPDATE comandos SET estado='respondido', respuesta=?, respondido=? WHERE id=?",
                          (cuerpo[:5000], ahora(), cid))
        if "FWVersion" in cuerpo or "CMD=INFO" in cuerpo:
            guardar_info(sn, cuerpo)
        if "USER PIN=" in cuerpo or "FP PIN=" in cuerpo or "FACE PIN=" in cuerpo:
            procesar_lineas(sn, cuerpo)
        # verificación automática: si un alta o un enrolamiento terminó OK,
        # le re-pedimos al lector sus datos para confirmar y actualizar estados
        m = re.search(r"Return=(-?\d+)", cuerpo)
        if cid and m and m.group(1) == "0":
            with db() as c:
                fila = c.execute("SELECT cmd FROM comandos WHERE id=?", (cid,)).fetchone()
            origen = fila[0] if fila else ""
            if origen.startswith("ENROLL_"):
                encolar("DATA QUERY USERINFO", sn, unico=True)
                encolar("DATA QUERY FINGERTMP", sn, unico=True)
                log("  enrolamiento OK -> verifico usuarios y huellas")
            elif origen.startswith("DATA UPDATE USERINFO"):
                encolar("DATA QUERY USERINFO", sn, unico=True)

    # ── panel ──
    def _tabla(self, headers, filas, vacio, crudo_html=False):
        e = (lambda x: x) if crudo_html else html.escape
        if not filas:
            return f"<p class='vacio'>{vacio}</p>"
        h = "".join(f"<th>{x}</th>" for x in headers)
        b = "".join("<tr>" + "".join(f"<td>{e(str(x if x is not None and x != '' else '—'))}</td>" for x in f) + "</tr>" for f in filas)
        return f"<div class='scroll'><table><thead><tr>{h}</tr></thead><tbody>{b}</tbody></table></div>"

    def _panel(self):
        with db() as c:
            disp = c.execute("SELECT sn, primera_vez, ultima_vez, info FROM dispositivo ORDER BY ultima_vez DESC").fetchall()
            usrs = c.execute("SELECT pin, nombre, privilegio, card, grupo, actualizado FROM usuarios ORDER BY CAST(pin AS INTEGER)").fetchall()
            plnt = c.execute("SELECT id, pin, tipo, fid, size, recibido FROM plantillas ORDER BY CAST(pin AS INTEGER), tipo").fetchall()
            fich = c.execute("""SELECT f.fecha_hora, f.pin,
                                       COALESCE(NULLIF(m.nombre_personal,''), NULLIF(u.nombre,''), ''),
                                       f.status, f.verify
                                FROM fichajes f
                                LEFT JOIN usuarios u ON u.pin=f.pin
                                LEFT JOIN mapeo m ON m.pin=f.pin
                                ORDER BY f.fecha_hora DESC LIMIT 200""").fetchall()
            nfich = c.execute("SELECT COUNT(*) FROM fichajes").fetchone()[0]
            cmds = c.execute("""SELECT id, substr(cmd,1,80), estado, substr(COALESCE(respuesta,''),1,200)
                                FROM comandos ORDER BY id DESC LIMIT 60""").fetchall()
            npend = c.execute("SELECT COUNT(*) FROM comandos WHERE estado='pendiente'").fetchone()[0]
            raws = c.execute("SELECT ts, tipo, substr(contenido,1,200) FROM eventos_raw ORDER BY id DESC LIMIT 50").fetchall()
            mapeo = {r[0]: {"nombre": r[1], "area": r[2]} for r in c.execute("SELECT pin, nombre_personal, area FROM mapeo")}
        regs = registros_diarios()
        ip = ip_local()
        supa = supabase_cfg()
        try:
            fotos = sorted(os.listdir(FOTOS))[-24:]
        except Exception:
            fotos = []

        sn_real = sn_principal()
        ultima = disp[0][2] if disp else None
        conectado = False
        if ultima:
            try:
                dt = datetime.datetime.strptime(ultima, "%Y-%m-%d %H:%M:%S")
                conectado = (datetime.datetime.now() - dt).total_seconds() < 60
            except Exception:
                pass

        if not sn_real:
            banner = (f"<div class='banner'>⚠️ El lector todavía no se conectó nunca. En el equipo: "
                      f"<b>Menú → Comunicación → Conf. Srvr. de Nube</b> → Dirección <b>{ip}</b> · "
                      f"Puerto <b>{PUERTO}</b> · HTTPS <b>OFF</b>. Después reiniciarlo.</div>")
        elif not conectado:
            banner = (f"<div class='banner'>🔌 Lector <b>{sn_real}</b> FUERA DE LÍNEA "
                      f"(última señal: {ultima}). Los comandos quedan encolados ({npend} pendientes) "
                      f"y se ejecutan solos cuando vuelva.</div>")
        else:
            banner = (f"<div class='banner ok-banner'>🟢 Lector <b>{sn_real}</b> EN LÍNEA "
                      f"(última señal: {ultima}). Comandos pendientes: {npend}.</div>")

        fich_fmt = [(f[0], f[1], f[2] or "—", STATUS.get(f[3], f[3] or "—"), VERIFY.get(f[4], f[4] or "—")) for f in fich]
        regs_fmt = [(r["fecha"], ("✔ " if r["matcheado"] else "") + r["nombre"], r["area"] or "—",
                     r["hora_entrada"], r["hora_salida"] or "(sin salida)", r["marcas"]) for r in regs]
        disp_fmt = [(d[0], d[1], d[2], (d[3] or "")[:300]) for d in disp]
        e = html.escape
        plnt_fmt = [(p[1], p[2], p[3], p[4], p[5],
                     f"<button class='sec' onclick=\"restaurar({p[0]},'{e(str(p[1]))}','{e(str(p[2]))}')\">Restaurar al lector</button>")
                    for p in plnt]
        usuarios_json = json.dumps(
            [{"pin": u[0], "nombre": u[1], "privilegio": u[2], "card": u[3], "grupo": u[4]} for u in usrs],
            ensure_ascii=False)
        fp_pins = sorted({p[1] for p in plnt if p[2] in ("FP", "BIODATA")})
        fotos_html = "".join(f"<a href='/fotos/{f}' target='_blank'><img src='/fotos/{f}' title='{f}'></a>" for f in fotos) \
                     or "<p class='vacio'>Sin fotos de fichaje todavía.</p>"

        tpl = PANEL_TPL
        for token, valor in [
            ("%%IP%%", f"{ip}:{PUERTO}"),
            ("%%BANNER%%", banner),
            ("%%N_DISP%%", str(len(disp))),
            ("%%N_USR%%", str(len(usrs))),
            ("%%N_FICH%%", str(nfich)),
            ("%%N_PLNT%%", str(len(plnt))),
            ("%%N_PEND%%", str(npend)),
            ("%%T_DISP%%", self._tabla(["SN", "Primera vez", "Última señal", "Info"], disp_fmt, "Ninguno todavía.")),
            ("%%T_PLNT%%", self._tabla(["PIN", "Tipo", "FID", "Tamaño", "Recibido", "Backup"], plnt_fmt,
                                       "Sin plantillas biométricas todavía.", crudo_html=True)),
            ("%%T_REGS%%", self._tabla(["Fecha", "Nombre (✔=matcheado)", "Área", "Entrada (1ª)", "Salida (últ.)", "Marcas"], regs_fmt, "Sin fichajes todavía.")),
            ("%%T_FICH%%", self._tabla(["Fecha y hora", "PIN", "Nombre", "Tipo", "Verificación"], fich_fmt, "Sin fichajes todavía.")),
            ("%%T_CMDS%%", self._tabla(["ID", "Comando", "Estado", "Respuesta"], cmds, "Nada mandado todavía.")),
            ("%%T_RAWS%%", self._tabla(["Cuándo", "Tipo", "Contenido"], raws, "Nada todavía.")),
            ("%%FOTOS%%", fotos_html),
            ("%%USUARIOS_JSON%%", usuarios_json),
            ("%%MAPEO_JSON%%", json.dumps(mapeo, ensure_ascii=False)),
            ("%%FP_PINS_JSON%%", json.dumps(fp_pins)),
            ("%%SUPA_JSON%%", json.dumps(supa)),
        ]:
            tpl = tpl.replace(token, valor)
        return tpl

    def _csv_fichajes(self):
        with db() as c:
            filas = c.execute("""SELECT f.fecha_hora, f.pin,
                                        COALESCE(NULLIF(m.nombre_personal,''), NULLIF(u.nombre,''), ''),
                                        f.status, f.verify, f.sn
                                 FROM fichajes f
                                 LEFT JOIN usuarios u ON u.pin=f.pin
                                 LEFT JOIN mapeo m ON m.pin=f.pin
                                 ORDER BY f.fecha_hora""").fetchall()
        buf = io.StringIO(); w = csv.writer(buf)
        w.writerow(["fecha_hora", "pin", "nombre", "status", "verify", "sn"])
        w.writerows(filas)
        return buf.getvalue()

    def _csv_registros(self):
        buf = io.StringIO(); w = csv.writer(buf)
        w.writerow(["fecha", "nombre", "area", "pin", "hora_entrada", "hora_salida", "marcas", "matcheado"])
        for r in registros_diarios():
            w.writerow([r["fecha"], r["nombre"], r["area"], r["pin"],
                        r["hora_entrada"], r["hora_salida"] or "", r["marcas"], "si" if r["matcheado"] else "no"])
        return buf.getvalue()

# ── HTML del panel (string normal, NO f-string: el JS usa llaves libremente) ─
PANEL_TPL = """<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lector de Huella — Local</title>
<style>
 body{background:#0e0f14;color:#c6c9d7;font:14px/1.5 'Segoe UI',system-ui,sans-serif;margin:0;padding:24px;max-width:1150px;margin-inline:auto}
 h1{color:#fff;font-size:20px} h1 span{color:#8b7cf6}
 h2{color:#8b7cf6;font-size:14px;text-transform:uppercase;letter-spacing:.08em;margin:28px 0 8px}
 .banner{background:#2a1f0a;border:1px solid #b8860b;border-radius:10px;padding:12px 16px;margin:14px 0;color:#ffd88a}
 .ok-banner{background:#0e2314;border-color:#2e7d4f;color:#8fd8a8}
 .kpis{display:flex;gap:12px;flex-wrap:wrap;margin:14px 0}
 .kpi{background:#171923;border:1px solid #262a3a;border-radius:10px;padding:10px 18px}
 .kpi b{display:block;font-size:22px;color:#fff}
 table{border-collapse:collapse;width:100%;font-size:13px}
 th{text-align:left;color:#8b7cf6;font-weight:600;padding:6px 10px;border-bottom:1px solid #262a3a;position:sticky;top:0;background:#12141c}
 td{padding:5px 10px;border-bottom:1px solid #1a1d29;vertical-align:top}
 .scroll{overflow:auto;max-height:420px;background:#12141c;border:1px solid #262a3a;border-radius:10px}
 .vacio{color:#555a70;font-style:italic}
 a{color:#8b7cf6}
 .pie{margin-top:30px;color:#555a70;font-size:12px}
 .nota{color:#8a8fa3;font-size:13px;margin:4px 0 8px}
 select,input[type=text]{background:#0e0f14;color:#c6c9d7;border:1px solid #262a3a;border-radius:6px;padding:4px 8px;font-size:13px;min-width:180px}
 button{background:#8b7cf6;color:#fff;border:0;border-radius:6px;padding:5px 12px;cursor:pointer;font-size:13px}
 button.sec{background:#262a3a} button.rojo{background:#7d2e2e}
 .ok{color:#6fd08c} .err{color:#e07070} .pend{color:#d8b45a}
 .acciones{display:flex;gap:10px;flex-wrap:wrap;align-items:center;background:#12141c;border:1px solid #262a3a;border-radius:10px;padding:12px}
 #fotos img{height:70px;border-radius:6px;margin:3px;border:1px solid #262a3a}
 @media (max-width:700px){
  body{padding:10px}
  h1{font-size:17px}
  .kpi{padding:7px 11px} .kpi b{font-size:17px}
  button{padding:10px 14px;font-size:14px}
  select,input[type=text]{min-width:120px;font-size:14px;padding:8px}
  table{font-size:12px} td,th{padding:5px 6px}
  .scroll{max-height:330px}
 }
</style></head><body>
<h1>Lector de Huella <span>· control total local</span></h1>
<div class="kpis">
 <div class="kpi"><b>%%N_USR%%</b>personas en el lector</div>
 <div class="kpi"><b>%%N_FICH%%</b>fichajes guardados</div>
 <div class="kpi"><b>%%N_PLNT%%</b>plantillas (backup)</div>
 <div class="kpi"><b>%%N_PEND%%</b>comandos en cola</div>
 <div class="kpi"><b>%%IP%%</b>esta PC</div>
</div>
<div id="bannerBox">%%BANNER%%</div>

<h2>Acciones sobre el lector</h2>
<p class="nota">Todo queda en cola y el lector lo ejecuta cuando está en línea (tarda ~10-20 s). El resultado aparece en "Comandos".</p>
<div class="acciones">
 <button onclick="hora()">🕐 Sincronizar hora con esta PC</button>
 <button class="sec" onclick="reboot()">↻ Reiniciar lector</button>
 <input type="text" id="smsTxt" placeholder="mensaje para la pantalla..." onfocus="dirty(1)" oninput="dirty(1)">
 <button class="sec" onclick="sms()">📺 Mandar a pantalla</button>
 <input type="text" id="cmdTxt" placeholder="comando manual (avanzado)..." onfocus="dirty(1)" oninput="dirty(1)">
 <button class="sec" onclick="cmdLibre()">⚡ Enviar</button>
 <span id="accMsg"></span>
</div>

<h2>Personal de one-horarios → cargar al lector</h2>
<p class="nota">Un solo botón por persona: <b>"Cargar y enrolar ya"</b> la crea en el lector con su nombre real
 (PIN automático, nace vinculada) y al toque la pantalla del equipo pide su huella. Estados en vivo.</p>
<p style="margin:6px 0">
 <input type="text" id="buscar" placeholder="🔍 buscar persona..." oninput="buscar(this.value)">
 <button class="sec" onclick="cargarTodos()">⬆ Cargar TODOS los que faltan</button>
</p>
<div id="cargarTabla"></div>
<p class="nota" id="cargarMsg"></p>

<h2>Matcheo: PIN existente del lector ↔ Personal</h2>
<p class="nota">Para los usuarios que YA estaban en el lector (ej. Admin). Los cargados desde arriba se vinculan solos.</p>
<div id="match"></div>

<h2>Entrada / Salida por día (formato registros de one-horarios)</h2>
%%T_REGS%%
<h2>Últimos 200 fichajes crudos</h2>
%%T_FICH%%
<h2>Plantillas biométricas (backup local de huellas/caras)</h2>
%%T_PLNT%%
<h2>Fotos de fichaje (ATTPHOTO)</h2>
<div id="fotos">%%FOTOS%%</div>
<h2>Dispositivos e info del equipo</h2>
%%T_DISP%%
<h2>Comandos al lector (últimos 60)</h2>
<p class="nota"><button class="sec" onclick="repedir()">↻ Volver a pedir TODO al lector</button>
 <span id="repMsg"></span> — Return=0 es éxito; otro número = el firmware no soporta ese comando.</p>
%%T_CMDS%%
<h2>Tráfico crudo (últimos 50)</h2>
%%T_RAWS%%
<p class="pie">Exportar: <a href="/export/fichajes.csv">fichajes.csv</a> · <a href="/export/registros.csv">registros.csv</a>
 · JSON completo: <a href="/api/todo">/api/todo</a> · DB: lector.db
 · La página se recarga sola cada 15 s (se pausa mientras escribís).</p>

<script>
const SUPA = %%SUPA_JSON%%;
let EST = { usuarios: %%USUARIOS_JSON%%, mapeo: %%MAPEO_JSON%%, fp_pins: %%FP_PINS_JSON%%,
            online: null, pendientes: null, ultima_vez: null, fichajes: null };
let personal = null;
let LISTA = [];
let filtro = '';

function dirty(v) { document.body.dataset.dirty = v ? '1' : ''; }
async function api(path, data) {
  const r = await fetch(path, data ? { method: 'POST', body: JSON.stringify(data) } : {});
  return await r.json();
}

async function cargarPersonal() {
  if (!SUPA) return null;
  try {
    const r = await fetch(SUPA.url + '/rest/v1/personal?select=nombre,area,rol,activo&order=nombre', {
      headers: { apikey: SUPA.key, Authorization: 'Bearer ' + SUPA.key }
    });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch (e) { return null; }
}

function pinDe(nombre) {
  for (const [pin, m] of Object.entries(EST.mapeo)) if (m && m.nombre === nombre) return pin;
  return null;
}

function estadoDe(p) {
  const pin = pinDe(p.nombre);
  if (!pin) return { pin: null, cod: 0, txt: '<span class="vacio">sin cargar</span>' };
  if (EST.fp_pins.includes(pin)) return { pin, cod: 3, txt: '<span class="ok">✔ PIN ' + pin + ' · huella registrada</span>' };
  if (EST.usuarios.some(u => u.pin === pin)) return { pin, cod: 2, txt: '<span class="ok">PIN ' + pin + ' · en el lector, falta huella</span>' };
  return { pin, cod: 1, txt: '<span class="pend">PIN ' + pin + ' · encolado, esperando al lector…</span>' };
}

function renderBanner() {
  if (EST.online === null) return;
  document.getElementById('bannerBox').innerHTML = EST.online
    ? `<div class="banner ok-banner">🟢 Lector EN LÍNEA (última señal: ${EST.ultima_vez}) · ${EST.pendientes} comando(s) en cola · ${EST.fichajes} fichajes</div>`
    : `<div class="banner">🔌 Lector FUERA DE LÍNEA (última señal: ${EST.ultima_vez}). Los comandos quedan en cola (${EST.pendientes}) y se ejecutan solos cuando vuelva.</div>`;
}

function renderCargar() {
  const cont = document.getElementById('cargarTabla');
  if (!personal || !personal.length) { cont.innerHTML = '<p class="vacio">No se pudo leer la tabla personal de Supabase.</p>'; return; }
  LISTA = personal.filter(p => p.activo !== false)
    .filter(p => !filtro || (p.nombre + ' ' + (p.area || '')).toLowerCase().includes(filtro));
  const filas = LISTA.map((p, i) => {
    const st = estadoDe(p);
    let acc = '';
    if (st.cod === 0) acc = `<button onclick="cargarYEnrolar(${i})">➕ Cargar y enrolar ya</button>`;
    else if (st.cod === 1) acc = '<span class="pend">…</span>';
    else if (st.cod === 2) acc = `<button onclick="enrolarIdx(${i},'huella')">👆 Huella</button> <button onclick="enrolarIdx(${i},'cara')">😀 Cara</button>`;
    else acc = `<button class="sec" onclick="enrolarIdx(${i},'huella')">👆 Re-huella</button> <button onclick="enrolarIdx(${i},'cara')">😀 Cara</button>`;
    return `<tr><td><b>${p.nombre}</b></td><td>${p.area || '—'}</td><td>${p.rol || '—'}</td><td>${st.txt}</td><td>${acc}</td></tr>`;
  }).join('');
  cont.innerHTML = '<div class="scroll"><table><thead><tr><th>Persona</th><th>Área</th><th>Rol</th><th>Estado en el lector</th><th>Acción</th></tr></thead><tbody>'
    + (filas || '<tr><td colspan="5" class="vacio">sin resultados</td></tr>') + '</tbody></table></div>';
}

function buscar(v) { filtro = v.toLowerCase(); renderCargar(); }

async function cargarYEnrolar(i) {
  const p = LISTA[i];
  if (!confirm('Se crea "' + p.nombre + '" en el lector y la pantalla va a pedir su huella.\\n¿Dale?')) return;
  const j = await api('/api/cargar_enrolar', { nombre: p.nombre, area: p.area || '' });
  const m = document.getElementById('cargarMsg');
  if (j.ok) {
    EST.mapeo[j.pin] = { nombre: p.nombre, area: p.area || '' };
    m.innerHTML = '<span class="ok">✔ ' + p.nombre + ' → PIN ' + j.pin +
      '. En ~20 segundos la pantalla del lector pide la huella: que apoye el dedo 3 veces.</span>';
    renderCargar();
  } else {
    m.innerHTML = '<span class="err">Error: ' + (j.error || '?') + '</span>';
  }
}

async function cargarTodos() {
  if (!personal) return;
  const faltan = personal.filter(p => p.activo !== false && !pinDe(p.nombre));
  if (!faltan.length) { document.getElementById('cargarMsg').innerHTML = '<span class="ok">No falta nadie — ya están todos cargados.</span>'; return; }
  if (!confirm('Se van a cargar ' + faltan.length + ' personas al lector, con su nombre real y PIN automático.\\n¿Dale?')) return;
  const j = await api('/api/cargar_todos', { personas: faltan.map(p => ({ nombre: p.nombre, area: p.area || '' })) });
  if (j.ok) {
    j.asignados.forEach(a => { EST.mapeo[a.pin] = { nombre: a.nombre, area: '' }; });
    document.getElementById('cargarMsg').innerHTML = '<span class="ok">✔ ' + j.cargados +
      ' personas encoladas — el lector las va creando una por una (tarda ~10 s por persona). Mirá los estados avanzar solos.</span>';
    renderCargar();
  } else {
    document.getElementById('cargarMsg').innerHTML = '<span class="err">Error: ' + (j.error || '?') + '</span>';
  }
}

async function enrolarIdx(i, tipo) {
  const p = LISTA[i];
  const pin = pinDe(p.nombre);
  if (!pin) return;
  const que = (tipo === 'cara') ? 'la CARA' : 'la HUELLA';
  if (!confirm('Enrolar ' + que + ' de ' + p.nombre + ' (PIN ' + pin + '): la pantalla del lector salta al registro. ¿Dale?')) return;
  const j = await api('/api/enrolar', { pin, tipo });
  document.getElementById('cargarMsg').innerHTML = j.ok
    ? '<span class="ok">Encolado — en ~20 segundos la pantalla pide ' + que + ' de ' + p.nombre + '. Que se quede frente al equipo.</span>'
    : '<span class="err">Error</span>';
}

/* ── matcheo de PINs ya existentes en el lector ── */
function renderMatch() {
  const cont = document.getElementById('match');
  if (!EST.usuarios.length) { cont.innerHTML = '<p class="vacio">Sin usuarios del lector todavía.</p>'; return; }
  const t = document.createElement('table');
  t.innerHTML = '<thead><tr><th>PIN</th><th>Nombre en el lector</th><th>Persona en one-horarios</th><th></th><th>Estado</th><th>Acciones</th></tr></thead>';
  const tb = document.createElement('tbody');
  EST.usuarios.forEach((u, i) => {
    const m = EST.mapeo[u.pin] || {};
    const tr = document.createElement('tr');
    let selector;
    if (personal && personal.length) {
      const ops = personal.map(p => {
        const sel = (m.nombre === p.nombre) ? ' selected' : '';
        return `<option value='${encodeURIComponent(JSON.stringify({ n: p.nombre, a: p.area || '' }))}'${sel}>${p.nombre}${p.area ? ' — ' + p.area : ''}</option>`;
      }).join('');
      selector = `<select id="sel_${u.pin}" onfocus="dirty(1)" onchange="dirty(1)"><option value="">— sin matchear —</option>${ops}</select>`;
    } else {
      selector = `<input type="text" id="txt_${u.pin}" value="${m.nombre || ''}" placeholder="nombre exacto" onfocus="dirty(1)" oninput="dirty(1)">`;
    }
    tr.innerHTML = `<td><b>${u.pin}</b></td><td>${u.nombre || '—'}</td><td>${selector}</td>
      <td><button onclick="guardarMatch('${u.pin}')">Guardar</button></td>
      <td id="st_${u.pin}">${m.nombre ? '<span class="ok">✔ ' + m.nombre + '</span>' : '<span class="vacio">sin matchear</span>'}</td>
      <td><button class="sec" onclick="enrolarPin(${i},'huella')">👆 Huella</button>
          <button class="sec" onclick="enrolarPin(${i},'cara')">😀 Cara</button>
          <button class="rojo" onclick="borrarUsr(${i})">Borrar del lector</button></td>`;
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  const wrap = document.createElement('div'); wrap.className = 'scroll'; wrap.appendChild(t);
  cont.innerHTML = ''; cont.appendChild(wrap);
}

async function guardarMatch(pin) {
  let nombre = '', area = '';
  const sel = document.getElementById('sel_' + pin);
  const txt = document.getElementById('txt_' + pin);
  if (sel && sel.value) {
    const v = JSON.parse(decodeURIComponent(sel.value));
    nombre = v.n; area = v.a;
  } else if (txt) { nombre = txt.value.trim(); }
  const st = document.getElementById('st_' + pin);
  const j = await api('/api/mapeo', { pin, nombre, area });
  st.innerHTML = j.ok
    ? (nombre ? '<span class="ok">✔ guardado: ' + nombre + '</span>' : '<span class="vacio">matcheo quitado</span>')
    : '<span class="err">error</span>';
  if (j.ok && nombre) EST.mapeo[pin] = { nombre, area };
  if (j.ok && !nombre) delete EST.mapeo[pin];
  dirty(0);
}

async function enrolarPin(i, tipo) {
  const u = EST.usuarios[i];
  const que = (tipo === 'cara') ? 'CARA' : 'HUELLA';
  if (!confirm('Enrolar ' + que + ' para PIN ' + u.pin + (u.nombre ? ' (' + u.nombre + ')' : '') + '. ¿Dale?')) return;
  const j = await api('/api/enrolar', { pin: u.pin, tipo });
  alert(j.ok ? 'Encolado — mirá la pantalla del lector en ~20 segundos.' : 'Error');
}

async function borrarUsr(i) {
  const u = EST.usuarios[i];
  if (!confirm('¿Borrar del LECTOR al PIN ' + u.pin + ' (' + (u.nombre || 'sin nombre') + ')?\\nSe borra el usuario y sus huellas del equipo (el backup local queda).')) return;
  const j = await api('/api/borrar_usuario', { pin: u.pin });
  alert(j.ok ? 'Encolado — se borra cuando el lector lo tome.' : 'Error');
}

/* ── acciones ── */
async function hora() {
  const j = await api('/api/hora', {});
  msg(j.ok ? 'encolado — se pone en hora con esta PC (' + j.hora_pc + ')' : 'error: ¿hay lector registrado?');
}
async function reboot() {
  if (!confirm('¿Reiniciar el lector? Tarda ~1 minuto en volver.')) return;
  const j = await api('/api/reboot', {});
  msg(j.ok ? 'reinicio encolado' : 'error');
}
async function sms() {
  const t = document.getElementById('smsTxt').value.trim();
  if (!t) { msg('escribí el mensaje primero'); return; }
  const j = await api('/api/sms', { msg: t });
  msg(j.ok ? 'mensaje encolado (experimental — mirá Return en Comandos)' : 'error');
  dirty(0);
}
async function cmdLibre() {
  const t = document.getElementById('cmdTxt').value.trim();
  if (!t) { msg('escribí el comando primero'); return; }
  const j = await api('/api/comando', { cmd: t });
  msg(j.ok ? 'comando ' + j.cmd + ' encolado' : 'error');
  dirty(0);
}
async function restaurar(id, pin, tipo) {
  if (!confirm('¿Re-subir al lector la plantilla ' + tipo + ' del PIN ' + pin + ' desde el backup local?')) return;
  const j = await api('/api/restaurar', { id });
  alert(j.ok ? 'Encolado.' : 'Error: ' + (j.error || '?'));
}
async function repedir() {
  const j = await api('/api/repedir');
  document.getElementById('repMsg').innerHTML = j.ok ? '<span class="ok">encolado</span>' : '<span class="err">error</span>';
}
function msg(t) { document.getElementById('accMsg').innerHTML = '<span class="pend">' + t + '</span>'; }

/* ── actualización en vivo (sin recargar la página, sin cortar el scroll) ── */
let lastTouch = 0, lastData = '', lastFich = null;
['touchstart', 'touchmove', 'wheel', 'mousedown', 'scroll'].forEach(ev =>
  document.addEventListener(ev, () => { lastTouch = Date.now(); }, { capture: true, passive: true }));

function conScroll(fn) {
  const pos = [...document.querySelectorAll('.scroll')].map(c => c.scrollTop);
  fn();
  document.querySelectorAll('.scroll').forEach((c, i) => { if (pos[i]) c.scrollTop = pos[i]; });
}

async function poll() {
  try { EST = await api('/api/estado'); } catch (e) { return; }
  renderBanner();
  // no tocar la pantalla si el usuario está scrolleando/editando (últimos 6 s)
  const ocupado = document.body.dataset.dirty || (Date.now() - lastTouch < 6000);
  const clave = JSON.stringify([EST.usuarios, EST.fp_pins, EST.mapeo]);
  if (!ocupado && clave !== lastData) {       // re-dibujar SOLO si cambió algo
    lastData = clave;
    conScroll(() => { renderCargar(); renderMatch(); });
  }
  // si llegó un fichaje nuevo, refrescar la página entera (tablas de abajo)
  if (lastFich !== null && EST.fichajes !== lastFich && !ocupado) { location.reload(); return; }
  lastFich = EST.fichajes;
}

(async () => {
  personal = await cargarPersonal();
  lastData = JSON.stringify([EST.usuarios, EST.fp_pins, EST.mapeo]);
  renderCargar(); renderMatch();
  poll();
  setInterval(poll, 5000);
})();
</script>
</body></html>"""

if __name__ == "__main__":
    init_db()
    ip = ip_local()
    log("=" * 60)
    log(f"Servidor ADMS v4 en 0.0.0.0:{PUERTO} — panel: http://localhost:{PUERTO}/")
    log(f"Configurar en el lector: Dirección {ip} · Puerto {PUERTO} · HTTPS OFF")
    log("=" * 60)
    threading.Thread(target=bucle_saludo, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", PUERTO), H).serve_forever()
