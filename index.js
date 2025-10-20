// Backend-Genesis-main/index.js
const express = require("express");
const fs = require("fs");
const cors = require("cors");
const lockfile = require("proper-lockfile");
const moment = require("moment-timezone");
const fetch = require("node-fetch");
const path = require('path');
const multer = require('multer');

exports.fetch = fetch;
const app = express();
exports.app = app;

/* ---------- Paths y directorios ---------- */
const PUBLIC_DIR = path.join(__dirname, 'public');
const publicJsonDir = path.join(PUBLIC_DIR, 'Json');
const publicImagesDir = path.join(PUBLIC_DIR, 'Images');
const productsJsonFilePath = path.join(publicJsonDir, 'products.json');
const directoryPath = path.join(__dirname, "data");
const estadisticaFilePath = path.join(directoryPath, "estadistica.json");

/* ---------- Helpers iniciales: asegurar dirs y archivos ---------- */
function ensureSyncDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
ensureSyncDir(PUBLIC_DIR);
ensureSyncDir(publicJsonDir);
ensureSyncDir(publicImagesDir);
ensureSyncDir(directoryPath);

// inicializar products.json si no existe
if (!fs.existsSync(productsJsonFilePath)) {
  try { fs.writeFileSync(productsJsonFilePath, '[]', 'utf8'); }
  catch (e) { console.error('No se pudo crear products.json:', e); }
}
// inicializar estadistica.json si no existe
if (!fs.existsSync(estadisticaFilePath)) {
  try { fs.writeFileSync(estadisticaFilePath, '[]', 'utf8'); }
  catch (e) { console.error('No se pudo crear estadistica.json:', e); }
}

/* ---------- Logs en memoria ---------- */
const serverLogs = [];
const serverStartTime = moment().tz("America/Havana");
function addLog(message) {
  const timestamp = moment().tz("America/Havana").format("YYYY-MM-DD HH:mm:ss");
  serverLogs.push(`[${timestamp}] ${message}`);
  if (serverLogs.length > 200) serverLogs.shift();
}

/* ---------- Compat handler para products.json (antes de static) ----------
   Normaliza siempre a: { products: [ ... ] }
   Esto cubre todos los formatos: array, objeto { products: [...] }, etc.
*/
app.get(['/Json/products.json', '/public/Json/products.json', '/products.json'], async (req, res, next) => {
  try {
    if (!fs.existsSync(productsJsonFilePath)) {
      return res.status(200).json({ products: [] });
    }
    const raw = await fs.promises.readFile(productsJsonFilePath, 'utf8').catch(()=> '');
    if (!raw) return res.json({ products: [] });

    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return res.json({ products: [] }); }

    let productsArray = [];
    if (Array.isArray(parsed)) {
      productsArray = parsed;
    } else if (parsed && Array.isArray(parsed.products)) {
      productsArray = parsed.products;
    } else if (parsed && Array.isArray(parsed.data)) {
      // en caso de formatos alternativos que usen "data"
      productsArray = parsed.data;
    } else {
      // intentar detectar si el objeto es un map de id->producto
      const values = Object.values(parsed || {}).filter(v => v && typeof v === 'object' && (v.nombre || v.id || v.price || v.precio));
      if (values.length) productsArray = values;
    }

    return res.json({ products: productsArray });
  } catch (err) {
    console.error('Error reading products.json compatibility handler:', err);
    next(err);
  }
});
// -------------------- FIN compat handler --------------------

/* ---------- CORS (flexible para Render y herramientas) ---------- */
const allowedOrigins = [
  "https://genesis-sf8f.onrender.com",
  "https://backend-genesis.onrender.com",
  "https://genesis-cjoa.onrender.com",
  "http://127.0.0.1:5500",
  "http://127.0.0.1:5501",
  "http://localhost:10000",
  "http://localhost:5500"
];

app.use((req, res, next) => {
  // console.log('CORS origin:', req.headers.origin);
  next();
});

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // allow tools/server-to-server
    if (allowedOrigins.includes(origin)) return callback(null, true);
    try {
      const url = new URL(origin);
      if (url.hostname && url.hostname.endsWith('.onrender.com')) return callback(null, true);
    } catch (e) { /* ignore */ }
    return callback(new Error("No permitido por CORS"));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  credentials: false
}));
app.options('*', cors());

/* ---------- Middleware JSON ---------- */
app.use(express.json());

/* ---------- Servir estáticos ---------- */
app.use(express.static(PUBLIC_DIR));
// asegurar que /Images también esté explícitamente servido
app.use('/Images', express.static(publicImagesDir));

/* ---------- products-api (se monta en /api) ---------- */
try {
  const productsApi = require('./products-api');
  productsApi(app, productsJsonFilePath, publicImagesDir, { requireAuth: true });
  addLog('products-api registrado correctamente (public/Json & public/Images).');
} catch (err) {
  addLog(`WARN: No se pudo cargar products-api: ${err.message}`);
  console.error('WARN: No se pudo cargar products-api:', err);
}

/* ---------- Funciones utilitarias ---------- */
function sanitizeJSON(data) {
  try { return JSON.parse(data); }
  catch (error) {
    addLog(`WARN: JSON malformado. Intentando corregir: ${error.message}`);
    const sanitized = String(data)
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
      .replace(/\\'/g, "'").replace(/\\"/g, '"')
      .replace(/\\n/g, "").replace(/\\t/g, "").replace(/\\r/g, "");
    try { return JSON.parse(sanitized); }
    catch (finalError) {
      addLog(`ERROR: No se pudo corregir JSON: ${finalError.message}`);
      return [];
    }
  }
}

/* ---------- Estadísticas endpoints (async/await + locks) ---------- */
app.post("/guardar-estadistica", async (req, res) => {
  let release = null;
  try {
    const nuevaEstadistica = req.body || {};
    addLog(`Recibida nueva estadística: ${JSON.stringify(nuevaEstadistica)}`);

    if (!nuevaEstadistica.ip || !nuevaEstadistica.pais || !nuevaEstadistica.origen) {
      addLog("ERROR: Faltan campos obligatorios en la estadística.");
      return res.status(400).json({ error: "Faltan campos obligatorios" });
    }

    try { release = await lockfile.lock(estadisticaFilePath); addLog(`Archivo bloqueado: ${estadisticaFilePath}`); } catch (e) { addLog('WARN: no se pudo bloquear archivo de estadisticas: ' + e.message); }

    const raw = await fs.promises.readFile(estadisticaFilePath, 'utf8').catch(()=> '[]');
    const estadisticas = Array.isArray(sanitizeJSON(raw)) ? sanitizeJSON(raw) : [];
    const usuarioExistente = estadisticas.find(est => est.ip === nuevaEstadistica.ip);
    const fechaHoraCuba = moment().tz("America/Havana").format("YYYY-MM-DD HH:mm:ss");

    estadisticas.push({
      ip: nuevaEstadistica.ip,
      pais: nuevaEstadistica.pais,
      fecha_hora_entrada: fechaHoraCuba,
      origen: nuevaEstadistica.origen,
      afiliado: nuevaEstadistica.afiliado || "Ninguno",
      duracion_sesion_segundos: nuevaEstadistica.duracion_sesionundos || nuevaEstadistica.duracion_sesion_segundos || 0,
      tiempo_carga_pagina_ms: nuevaEstadistica.tiempo_carga_pagina_ms || 0,
      nombre_comprador: nuevaEstadistica.nombre_comprador || "N/A",
      telefono_comprador: nuevaEstadistica.telefono_comprador || "N/A",
      correo_comprador: nuevaEstadistica.correo_comprador || "N/A",
      direccion_envio: nuevaEstadistica.direccion_envio || "N/A",
      compras: nuevaEstadistica.compras || [],
      precio_compra_total: nuevaEstadistica.precio_compra_total || 0,
      navegador: nuevaEstadistica.navegador || "Desconocido",
      sistema_operativo: nuevaEstadistica.sistema_operativo || "Desconocido",
      tipo_usuario: usuarioExistente ? "Recurrente" : "Único",
      tiempo_promedio_pagina: nuevaEstadistica.tiempo_promedio_pagina || 0,
      fuente_trafico: nuevaEstadistica.fuente_trafico || "Desconocido",
    });

    await fs.promises.writeFile(estadisticaFilePath, JSON.stringify(estadisticas, null, 2), 'utf8');
    addLog("Estadística guardada correctamente.");
    res.json({ message: "Estadística guardada correctamente" });
  } catch (error) {
    addLog(`ERROR: Error en /guardar-estadistica: ${error.message}`);
    console.error('ERROR /guardar-estadistica', error);
    res.status(500).json({ error: "Error interno del servidor" });
  } finally {
    if (release) {
      try { await release(); addLog('lock release en guardar-estadistica'); } catch (e) { /* ignore */ }
    }
  }
});

app.get("/obtener-estadisticas", async (req, res) => {
  let release = null;
  try {
    addLog("Solicitud para obtener estadísticas.");
    try { release = await lockfile.lock(estadisticaFilePath); addLog(`Archivo bloqueado para lectura: ${estadisticaFilePath}`); } catch (e) { addLog('WARN: no se pudo bloquear para lectura: ' + e.message); }
    const raw = await fs.promises.readFile(estadisticaFilePath, 'utf8').catch(()=> '[]');
    const estadisticas = Array.isArray(sanitizeJSON(raw)) ? sanitizeJSON(raw) : [];
    addLog(`Estadísticas enviadas: ${estadisticas.length} registros.`);
    res.json(estadisticas);
  } catch (error) {
    addLog(`ERROR: Error en /obtener-estadisticas: ${error.message}`);
    console.error('ERROR /obtener-estadisticas', error);
    res.status(500).json({ error: "Error interno del servidor" });
  } finally {
    if (release) {
      try { await release(); addLog('lock release en obtener-estadisticas'); } catch (e) { /* ignore */ }
    }
  }
});

/* ---------- Multer upload config (Images) ---------- */
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, publicImagesDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || '';
    const fname = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
    cb(null, fname);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

app.post('/upload-image', (req, res) => {
  upload.single('image')(req, res, async (err) => {
    if (err) {
      console.error('Multer error on /upload-image:', err);
      return res.status(500).json({ error: 'Error interno al subir imagen', details: err.message || String(err) });
    }
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const url = `/Images/${req.file.filename}`;
      addLog(`Imagen subida: ${req.file.filename}`);
      return res.json({ success: true, url });
    } catch (error) {
      console.error('Error in /upload-image handler:', error);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }
  });
});

/* ---------- Apps Script / pedidos ---------- */
const GOOGLE_APPS_SCRIPT_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbyHiqpoBmJD9mDqvPRe5diRBPTY-hGVdO0-7wNlrbTpDsGgUrgB7Q4IBU9QMvRGBzeehQ/exec";

app.post('/send-pedido', async (req, res) => {
  console.log('📦 Recibida solicitud de pedido desde el frontend.');
  const orderData = req.body;
  if (!orderData || Object.keys(orderData).length === 0) {
    console.error('Error: Datos de pedido vacíos o inválidos');
    return res.status(400).json({ success: false, message: 'Datos de pedido no proporcionados o inválidos.' });
  }
  try {
    console.log('Enviando datos a Google Apps Script...', orderData);
    const response = await fetch(GOOGLE_APPS_SCRIPT_WEB_APP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(orderData),
      redirect: 'follow',
      mode: 'cors'
    });
    const gasResponseText = await response.text();
    let gasResponse;
    try { gasResponse = JSON.parse(gasResponseText); } catch (e) { gasResponse = { status: 'error', message: 'Respuesta no JSON', rawResponse: gasResponseText.substring(0,500) }; }
    if (response.ok && gasResponse.status === "success") {
      res.status(200).json({ success: true, message: 'Pedido enviado a Google Apps Script correctamente.', gasResponse });
    } else {
      res.status(response.status || 500).json({ success: false, message: gasResponse.message || response.statusText || 'Error desconocido', gasResponse });
    }
  } catch (error) {
    console.error('❌ Error en el backend al procesar el pedido:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor al procesar el pedido.', error: error.message });
  }
});

/* ---------- Server status & clear statistics ---------- */
app.get("/api/server-status", (req, res) => {
  addLog("Solicitud de estado del servidor recibida");
  res.json({ status: "running", startTime: serverStartTime.toISOString(), logs: serverLogs });
});

app.post("/api/clear-statistics", async (req, res) => {
  try {
    addLog("Solicitud para limpiar estadísticas recibida");
    if (fs.existsSync(estadisticaFilePath)) {
      await fs.promises.unlink(estadisticaFilePath).catch(()=>{});
      addLog("Archivo de estadísticas eliminado");
    }
    await fs.promises.writeFile(estadisticaFilePath, "[]", { encoding: 'utf8', mode: 0o666 });
    addLog("Nuevo archivo de estadísticas creado correctamente");
    res.json({ success: true, message: "Estadísticas limpiadas correctamente" });
  } catch (error) {
    const errorMessage = `Error al limpiar estadísticas: ${error.message}`;
    addLog(`ERROR: ${errorMessage}`);
    console.error(errorMessage);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/* ---------- Ruta principal ---------- */
app.get("/", async (req, res) => {
  addLog("Página principal solicitada");
  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  const adminPath = path.join(PUBLIC_DIR, 'admin.html');
  if (fs.existsSync(adminPath)) return res.sendFile(adminPath);
  res.status(404).send("No hay archivos estáticos públicos. Coloca tu frontend en /public");
});

/* ---------- Error handler global ---------- */
app.use((err, req, res, next) => {
  addLog(`ERROR GLOBAL: ${err && err.message ? err.message : String(err)}`);
  console.error("Error global:", err);
  if (err && err.message && err.message.includes('CORS')) {
    return res.status(403).json({ error: "No permitido por CORS", details: err.message });
  }
  res.status(500).json({ error: "Error interno del servidor" });
});

/* ---------- Start server ---------- */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  addLog(`Servidor corriendo en el puerto ${PORT}`);
  addLog(`Entorno: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Servidor corriendo en el puerto ${PORT}`);
  console.log(`Entorno: ${process.env.NODE_ENV || 'development'}`);
});
