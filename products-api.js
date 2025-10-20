// products-api.js
const fs = require('fs');
const path = require('path');
const lockfile = require('proper-lockfile');
const express = require('express');
const multer = require('multer');

module.exports = function initProductsApi(app, productsJsonPath, imagesFolderPath, options = {}) {
  const router = express.Router();

  // Asegura que existan directorios y archivo
  fs.mkdirSync(path.dirname(productsJsonPath), { recursive: true });
  fs.mkdirSync(imagesFolderPath, { recursive: true });

  // Si no existe el archivo, inicializar con array vacío
  if (!fs.existsSync(productsJsonPath)) {
    fs.writeFileSync(productsJsonPath, '[]', 'utf8');
  } else {
    // Si existe y es un objeto con "products", normalizamos a array y guardamos
    try {
      const raw = fs.readFileSync(productsJsonPath, 'utf8').trim();
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray(parsed.products)) {
          fs.writeFileSync(productsJsonPath, JSON.stringify(parsed.products, null, 2), 'utf8');
        }
      }
    } catch (e) {
      // si algo falla dejamos el archivo como está (no romper startup)
      console.warn('Warning normalizing products.json:', e.message);
    }
  }

  // Multer para subir imágenes (guarda en imagesFolderPath)
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, imagesFolderPath),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '';
      const name = Date.now() + '-' + Math.random().toString(36).slice(2,9) + ext;
      cb(null, name);
    }
  });
  const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

  // Lectura segura de productos -> siempre devuelve un array
  async function readProducts() {
    try {
      const raw = await fs.promises.readFile(productsJsonPath, 'utf8');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.products)) return parsed.products;
      return [];
    } catch (e) {
      // si hay error, intenta recuperarse devolviendo array vacío
      console.error('readProducts error:', e.message);
      return [];
    }
  }

  // Escritura segura (con lock) -> escribe siempre un array JSON
  async function writeProducts(arr) {
    let release = null;
    try {
      release = await lockfile.lock(productsJsonPath).catch(()=>null);
      await fs.promises.writeFile(productsJsonPath, JSON.stringify(Array.isArray(arr) ? arr : [], null, 2), 'utf8');
    } finally {
      if (release) {
        try { await release(); } catch (e) { /* ignore */ }
      }
    }
  }

  // GET /api/products -> lista
  router.get('/products', async (req, res) => {
    const products = await readProducts();
    res.json(products);
  });

  // GET /api/products/:id -> uno
  router.get('/products/:id', async (req, res) => {
    const products = await readProducts();
    const p = products.find(x => String(x.id) === String(req.params.id));
    if (!p) return res.status(404).json({ error: 'No encontrado' });
    res.json(p);
  });

  // POST /api/products -> crear (sin auth para admin local; si quieres auth lo activamos)
  router.post('/products', express.json(), async (req, res) => {
    try {
      const body = req.body || {};
      const products = await readProducts();
      const id = Date.now().toString();
      const newProd = {
        id,
        nombre: body.nombre || 'Nuevo producto',
        descripcion: body.descripcion || '',
        precio: Number(body.precio || 0),
        oferta: !!body.oferta,
        descuento: Number(body.descuento || 0),
        imagen: body.imagen || '', // path público (/Images/...)
        stock: Number(body.stock || 0),
        isPack: !!body.isPack,
        productos: Array.isArray(body.productos) ? body.productos : []
      };
      products.push(newProd);
      await writeProducts(products);
      res.json({ success: true, producto: newProd });
    } catch (err) {
      console.error('ERROR POST /products:', err);
      res.status(500).json({ error: 'Error interno al crear producto', details: err.message });
    }
  });

  // PUT /api/products/:id -> actualizar
  router.put('/products/:id', express.json(), async (req, res) => {
    try {
      const id = String(req.params.id);
      const update = req.body || {};
      const products = await readProducts();
      const idx = products.findIndex(x => String(x.id) === id);
      if (idx === -1) return res.status(404).json({ error: 'No encontrado' });

      // merge con valores esperados
      products[idx] = {
        ...products[idx],
        nombre: update.nombre !== undefined ? update.nombre : products[idx].nombre,
        descripcion: update.descripcion !== undefined ? update.descripcion : products[idx].descripcion,
        precio: update.precio !== undefined ? Number(update.precio) : products[idx].precio,
        oferta: update.oferta !== undefined ? !!update.oferta : products[idx].oferta,
        descuento: update.descuento !== undefined ? Number(update.descuento) : products[idx].descuento,
        imagen: update.imagen !== undefined ? update.imagen : products[idx].imagen,
        stock: update.stock !== undefined ? Number(update.stock) : products[idx].stock,
        isPack: update.isPack !== undefined ? !!update.isPack : products[idx].isPack,
        productos: Array.isArray(update.productos) ? update.productos : products[idx].productos
      };

      await writeProducts(products);
      res.json({ success: true, producto: products[idx] });
    } catch (err) {
      console.error('ERROR PUT /products/:id:', err);
      res.status(500).json({ error: 'Error interno al actualizar producto', details: err.message });
    }
  });

  // DELETE /api/products/:id
  router.delete('/products/:id', async (req, res) => {
    try {
      const id = String(req.params.id);
      let products = await readProducts();
      const exists = products.some(x => String(x.id) === id);
      if (!exists) return res.status(404).json({ error: 'No encontrado' });
      products = products.filter(x => String(x.id) !== id);
      await writeProducts(products);
      res.json({ success: true });
    } catch (err) {
      console.error('ERROR DELETE /products/:id', err);
      res.status(500).json({ error: 'Error interno al eliminar', details: err.message });
    }
  });

  // POST /api/upload-image -> subir imagen y devolver url pública (/Images/xxx)
  router.post('/upload-image', upload.single('image'), (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file' });
      const publicPath = '/Images/' + req.file.filename;
      return res.json({ success: true, url: publicPath });
    } catch (err) {
      console.error('ERROR /api/upload-image:', err);
      return res.status(500).json({ error: 'Error interno al subir imagen', details: err.message });
    }
  });

  // Montar router en /api
  app.use('/api', router);

  return router;
};
