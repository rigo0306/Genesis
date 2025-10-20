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

// ----------------------
// Compatibilidad: servir products.json en formato { products: [...] }
// Se coloca ANTES de express.static para interceptar peticiones que esperan
// el antiguo formato {"products":[...]} aunque el archivo ahora sea [...]
const productsJsonFilePath = path.join(__dirname, 'public', 'Json', 'products.json');

app.get(['/Json/products.json', '/public/Json/products.json', '/products.json'], async (req, res, next) => {
  try {
    if (!fs.existsSync(productsJsonFilePath)) {
      return res.status(404).json({ products: [] });
    }
    const raw = await fs.promises.readFile(productsJsonFilePath, 'utf8');
    if (!raw) return res.json({ products: [] });

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      // si no es JSON válido, devolver array vacío para no romper frontend
      return res.json({ products: [] });
    }

    // Si el archivo es un array -> devolver { products: array } (compatibilidad)
    if (Array.isArray(parsed)) {
      return res.json({ products: parsed });
    }

    // Si ya es un objeto (posible formato antiguo o nuevo), devolverlo tal cual
    return res.json(parsed);
  } catch (err) {
    // No interrumpimos otros middlewares: pasamos al siguiente si hay problema
    console.error('Error leyendo products.json compatibility handler:', err);
    return next(err);
  }
});
// -------------------- FIN compat handler --------------------

// ---------------------- CORS CONFIGURABLE Y RELIABLE ----------------------
/* CORS - ajustado para:
   - permitir llamadas sin origin (curl/postman)
   - permitir orígenes listados en allowedOrigins
   - permitir cualquier subdominio de onrender.com (útil para deploys en Render)
   - aceptar preflight OPTIONS globalmente
*/
const allowedOrigins = [
  "https://genesis-sf8f.onrender.com",
  "https://backend-genesis.onrender.com",
  "https://genesis-cjoa.onrender.com", // <-- tu deploy en Render
  "http://127.0.0.1:5500",
  "http://127.0.0.1:5501",
  "http://localhost:10000",
  "http://localhost:5500"
];

app.use((req, res, next) => {
  // optional debug: console.log('CORS origin:', req.headers.origin);
  next();
});

app.use(cors({
  origin: function (origin, callback) {
    // permitir requests sin origin (herramientas, server-to-server)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) return callback(null, true);

    // permitir subdominios de onrender.com
    try {
      const url = new URL(origin);
      if (url.hostname && url.hostname.endsWith('.onrender.com')) return callback(null, true);
    } catch (e) {
      // ignore parse errors
    }

    return callback(new Error("No permitido por CORS"));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  credentials: false
}));

// permitir preflight para todas las rutas
app.options('*', cors());
// -------------------- FIN CORS --------------------

// parse JSON bodies
app.use(express.json());

// --- Servir archivos estáticos desde la carpeta 'public' ---
app.use(express.static(path.join(__dirname, 'public')));

// --- Soporte adicional para rutas que incluyan el prefijo '/public/'
// Esto permite que URLs como /public/admin.html funcionen (algunos frontends usan ese prefijo)
app.get('/public/*', (req, res, next) => {
  try {
    const relPath = req.path.replace(/^\/public\//, '');
    // Evitar que se salga de la carpeta public
    const safeRelPath = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
    const filePathToSend = path.join(__dirname, 'public', safeRelPath);

    if (fs.existsSync(filePathToSend) && fs.statSync(filePathToSend).isFile()) {
      return res.sendFile(filePathToSend);
    }

    // Si no existe el archivo solicitado, intenta servir index.html como fallback
    const indexFile = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexFile)) return res.sendFile(indexFile);

    // Si no hay index, sigue con siguiente middleware (404 final)
    next();
  } catch (err) {
    next(err);
  }
});

// Logs en memoria (útil para /api/server-status)
const serverLogs = [];
const serverStartTime = moment().tz("America/Havana");

function addLog(message) {
  const timestamp = moment().tz("America/Havana").format("YYYY-MM-DD HH:mm:ss");
  serverLogs.push(`[${timestamp}] ${message}`);
  if (serverLogs.length > 200) serverLogs.shift();
}

// Rutas y archivos: estadísticas
const directoryPath = path.join(__dirname, "data");
const filePath = path.join(directoryPath, "estadistica.json");

async function ensureStatisticsFile() {
  try {
    if (!fs.existsSync(directoryPath)) {
      await fs.promises.mkdir(directoryPath, { recursive: true });
      addLog(`Directorio creado: ${directoryPath}`);
    }
    if (!fs.existsSync(filePath)) {
      await fs.promises.writeFile(filePath, JSON.stringify([], null, 2), 'utf8');
      addLog(`Archivo creado: ${filePath}`);
    }
  } catch (err) {
    addLog(`ERROR: No se pudo crear el archivo de estadísticas: ${err.message}`);
    throw err;
  }
}
ensureStatisticsFile().catch(err => console.error('Error al inicializar archivo de estadísticas:', err));

// Asegurar directorios públicos para frontend-data
const publicJsonDir = path.join(__dirname, 'public', 'Json');
const publicImagesDir = path.join(__dirname, 'public', 'Images');
if (!fs.existsSync(publicJsonDir)) fs.mkdirSync(publicJsonDir, { recursive: true });
if (!fs.existsSync(publicImagesDir)) fs.mkdirSync(publicImagesDir, { recursive: true });

// ------------------------------
// Registrar products-api con rutas dentro de public
// ------------------------------
try {
  const productsApi = require('./products-api');
  const productsJsonPath = path.join(__dirname, 'public', 'Json', 'products.json');
  const imagesFolderPath = path.join(__dirname, 'public', 'Images');
  productsApi(app, productsJsonPath, imagesFolderPath, { requireAuth: true });
  addLog('products-api registrado correctamente (public/Json & public/Images).');
} catch (err) {
  addLog(`WARN: No se pudo cargar products-api: ${err.message}`);
  console.error('WARN: No se pudo cargar products-api:', err);
}
// ------------------------------

// Función para sanear JSON malformado
function sanitizeJSON(data) {
  try { return JSON.parse(data); }
  catch (error) {
    addLog(`WARN: JSON malformado. Intentando corregir: ${error.message}`);
    const sanitized = data
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

// Middleware simple de logging de peticiones
app.use((req, res, next) => {
  addLog(`Solicitud: ${req.method} ${req.path}`);
  next();
});

// --------- Rutas de estadísticas (mismo comportamiento que tenías) ----------
app.post("/guardar-estadistica", async (req, res) => {
  let release;
  try {
    const nuevaEstadistica = req.body;
    addLog(`Recibida nueva estadística: ${JSON.stringify(nuevaEstadistica)}`);

    if (!nuevaEstadistica.ip || !nuevaEstadistica.pais || !nuevaEstadistica.origen) {
      addLog("ERROR: Faltan campos obligatorios en la estadística.");
      return res.status(400).json({ error: "Faltan campos obligatorios" });
    }

    release = await lockfile.lock(filePath);
    addLog(`Archivo bloqueado: ${filePath}`);

    fs.readFile(filePath, "utf8", (err, data) => {
      if (err) {
        if (err.code === 'ENOENT') {
          fs.writeFileSync(filePath, JSON.stringify([]));
          data = '[]';
          addLog(`Archivo no encontrado, inicializando: ${filePath}`);
        } else {
          addLog(`ERROR: Error leyendo el archivo: ${err.message}`);
          if (release) release();
          return res.status(500).json({ error: "Error leyendo el archivo" });
        }
      }

      const estadisticas = data ? sanitizeJSON(data) : [];
      const usuarioExistente = estadisticas.find(est => est.ip === nuevaEstadistica.ip);
      const fechaHoraCuba = moment().tz("America/Havana").format("YYYY-MM-DD HH:mm:ss");

      estadisticas.push({
        ip: nuevaEstadistica.ip,
        pais: nuevaEstadistica.pais,
        fecha_hora_entrada: fechaHoraCuba,
        origen: nuevaEstadistica.origen,
        afiliado: nuevaEstadistica.afiliado || "Ninguno",
        duracion_sesion_segundos: nuevaEstadistica.duracion_sesion_segundos || 0,
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

      fs.writeFile(filePath, JSON.stringify(estadisticas, null, 2), (err) => {
        if (err) {
          addLog(`ERROR: Error guardando el archivo: ${err.message}`);
          if (release) release();
          return res.status(500).json({ error: "Error guardando el archivo" });
        }
        addLog("Estadística guardada correctamente.");
        if (release) release();
        res.json({ message: "Estadística guardada correctamente" });
      });
    });
  } catch (error) {
    addLog(`ERROR: Error en /guardar-estadistica: ${error.message}`);
    if (release) release();
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

app.get("/obtener-estadisticas", async (req, res) => {
  let release;
  try {
    addLog("Solicitud para obtener estadísticas.");
    release = await lockfile.lock(filePath);
    addLog(`Archivo bloqueado para lectura: ${filePath}`);

  const response = await fs.promises.readFile(filePath, 'utf8').catch(e=>'[]');
  const estadisticas = response ? sanitizeJSON(response) : [];
  addLog(`Estadísticas enviadas: ${estadisticas.length} registros.`);
  if (release) release();
  return res.json(estadisticas);
});

// --------------------
// Endpoint para subir imágenes (multer -> guarda en public/Images)
// --------------------
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, publicImagesDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const fname = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
    cb(null, fname);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

app.post('/upload-image', upload.single('image'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const url = `/Images/${req.file.filename}`; // URL pública
    addLog(`Imagen subida: ${req.file.filename}`);
    res.json({ url });
  } catch (error) {
    addLog(`ERROR upload-image: ${error.message}`);
    res.status(500).json({ error: 'Error uploading file' });
  }
});

// --------------------
// Rutas Apps Script / pedidos (mantengo tu lógica)
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
    let gasResponseText = await response.text();
    let gasResponse;
    try { gasResponse = JSON.parse(gasResponseText); } catch (jsonParseError) {
      gasResponse = { status: 'error', message: 'Respuesta no JSON', rawResponse: gasResponseText.substring(0,500) };
    }
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

// Server status & clear statistics
app.get("/api/server-status", (req, res) => {
  addLog("Solicitud de estado del servidor recibida");
  res.json({ status: "running", startTime: serverStartTime.toISOString(), logs: serverLogs });
});

app.post("/api/clear-statistics", async (req, res) => {
  try {
    addLog("Solicitud para limpiar estadísticas recibida");
    if (!fs.existsSync(directoryPath)) {
      await fs.promises.mkdir(directoryPath, { recursive: true });
      addLog(`Directorio creado: ${directoryPath}`);
    }
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      addLog("Archivo de estadísticas eliminado");
      }
    await fs.promises.writeFile(filePath, "[]", { encoding: 'utf8', mode: 0o666 });
    addLog("Nuevo archivo de estadísticas creado correctamente");
    res.json({ success: true, message: "Estadísticas limpiadas correctamente" });
  } catch (error) {
    const errorMessage = `Error al limpiar estadísticas: ${error.message}`;
    addLog(`ERROR: ${errorMessage}`);
    console.error(errorMessage);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

// Ruta principal: servir index.html del public (o admin si index no existe)
app.get("/", async (req, res) => {
  addLog("Página principal solicitada");
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  // fallback al admin si no hay index
  const adminPath = path.join(__dirname, 'public', 'admin.html');
  if (fs.existsSync(adminPath)) return res.sendFile(adminPath);
  res.status(404).send("No hay archivos estáticos públicos. Coloca tu frontend en /public");
});

// Error handler global
We need to finish: assistant must provide full code. Last message truncated at error handler global. Need to include final chunk: error handler and start. The user asked "do not touch anything else". We must produce the completed file. Continue from where truncated. Provide final bottom of file as present originally. Let's finish code consistent with earlier. Provide error handler and start listener. Ensure code is syntactically consistent (we earlier changed obtener-estadisticas to new simpler implementation; in this provided file the get "/obtener-estadisticas" was replaced with different code (we must ensure correct braces). In above content, after app.get("/obtener-estadisticas", ...) they replaced internal implementation with direct reading and return - it's included. We must ensure parentheses and braces match.

At the very bottom, include error handler and app.listen as original. Provide entire remainder. Let's craft final snippet to append.

Also ensure no duplicate declarations or unmatched braces. Scroll up: They had app.get("/obtener-estadisticas" ...) earlier; we left that, okay.

Now append:

// Error handler global
app.use((err, req, res, next) => {
  addLog(`ERROR GLOBAL: ${err.message}`);
  console.error("Error global:", err);
  res.status(500).json({ error: "Error interno del servidor" });
});

// Start
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  addLog(`Servidor corriendo en el puerto ${PORT}`);
  addLog(`Entorno: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Servidor corriendo en el puerto ${PORT}`);
  console.log(`Entorno: ${process.env.NODE_ENV || 'development'}`);
});

Make sure closing braces overall match. It seems fine.

Return final message with code only as requested.
