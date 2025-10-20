// products-api.js
const fs = require('fs');
const path = require('path');
const lockfile = require('proper-lockfile');
const express = require('express');
const multer = require('multer');

module.exports = function initProductsApi(app, productsJsonPath, imagesFolderPath, options = {}) {
  const router = express.Router();
  const ADMIN_USER = process.env.ADMIN_USER || 'admin';
  const ADMIN_PASS = process.env.ADMIN_PASS || 'changeme';

  // Basic auth middleware (simple)
  function basicAuth(req, res, next) {
    if (!options.requireAuth) return next();
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm=\"Admin\"');
      return res.status(401).send('Authentication required');
    }
    const creds = Buffer.from(auth.split(' ')[1], 'base64').toString().split(':');
    const [user, pass] = creds;
    if (user === ADMIN_USER && pass === ADMIN_PASS) return next();
    res.setHeader('WWW-Authenticate', 'Basic realm=\"Admin\"');
    return res.status(401).send('Invalid credentials');
  }

  // Ensure files/folders exist
  fs.mkdirSync(path.dirname(productsJsonPath), { recursive: true });
  if (!fs.existsSync(productsJsonPath)) fs.writeFileSync(productsJsonPath, '[]', 'utf8');
  fs.mkdirSync(imagesFolderPath, { recursive: true });

  // Multer for image uploads
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, imagesFolderPath),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const name = Date.now() + '-' + Math.random().toString(36).slice(2,9) + ext;
      cb(null, name);
    }
  });
  const upload = multer({ storage });

  async function readProducts() {
    try {
      const raw = await fs.promises.readFile(productsJsonPath, 'utf8');
      return JSON.parse(raw || '[]');
    } catch (e) {
      return [];
    }
  }

  async function writeProducts(arr) {
    // use lock to avoid races
    const release = await lockfile.lock(productsJsonPath).catch(()=>null);
    try {
      await fs.promises.writeFile(productsJsonPath, JSON.stringify(arr, null, 2), 'utf8');
    } finally {
      if (release) await release();
    }
  }

  // GET /api/products
  router.get('/products', async (req, res) => {
    const products = await readProducts();
    res.json(products);
  });

  // GET single
  router.get('/products/:id', async (req, res) => {
    const products = await readProducts();
    const p = products.find(x => String(x.id) === String(req.params.id));
    if (!p) return res.status(404).json({ error: 'No encontrado' });
    res.json(p);
  });

  // POST /api/products - crear producto
  router.post('/products', basicAuth, express.json(), async (req, res) => {
    const body = req.body || {};
    const products = await readProducts();
    // id simple: timestamp
    const id = Date.now().toString();
    const newProd = {
      id,
      nombre: body.nombre || 'Nuevo producto',
      descripcion: body.descripcion || '',
      precio: Number(body.precio || 0),
      oferta: !!body.oferta,
      descuento: Number(body.descuento || 0),
      imagen: body.imagen || null,
      stock: Number(body.stock || 0),
      isPack: !!body.isPack,
      productos: body.productos || []
    };
    products.push(newProd);
    await writeProducts(products);
    res.json({ success: true, producto: newProd });
  });

  // PUT /api/products/:id - actualizar
  router.put('/products/:id', basicAuth, express.json(), async (req, res) => {
    const id = String(req.params.id);
    const update = req.body || {};
    const products = await readProducts();
    const idx = products.findIndex(x => String(x.id) === id);
    if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
    products[idx] = { ...products[idx], ...update };
    await writeProducts(products);
    res.json({ success: true, producto: products[idx] });
  });

  // DELETE
  router.delete('/products/:id', basicAuth, async (req, res) => {
    const id = String(req.params.id);
    let products = await readProducts();
    const exists = products.some(x => String(x.id) === id);
    if (!exists) return res.status(404).json({ error: 'No encontrado' });
    products = products.filter(x => String(x.id) !== id);
    await writeProducts(products);
    res.json({ success: true });
  });

  // Upload image -> returns path usable by frontend (/Images/<name>)
  router.post('/upload-image', basicAuth, upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const publicPath = '/Images/' + req.file.filename; // Genesis-main serves /Images/
    res.json({ success: true, url: publicPath });
  });

  // Mount router with prefix /api
  app.use('/api', router);

  // Return for tests
  return router;
};
