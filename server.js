const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const root = __dirname;
const dbPath = path.join(root, 'data.json');
const locationsPath = path.join(root, 'locations.json');
const uploadsPath = path.join(root, 'uploads');
const adminKey = process.env.ADMIN_KEY || '';
let databaseCache = null;
let databasePool = null;
const locationCoordinates = {
  'Усть-Каменогорск': [49.9483, 82.6275],
  'Алтай': [50.3004, 83.5146],
  'Риддер': [50.3557, 83.5166],
  'Зайсан': [47.4667, 84.8667],
  'Курчум': [48.5667, 83.65],
  'Улькен Нарын': [49.2, 84.5167],
  'Катон-Карагай': [49.1833, 85.6],
  'Урыль': [49.25, 85.45],
  'Берель': [49.35, 86.1],
  'Жана-Ульга': [49.1, 85.35],
  'Шынгыстай': [49.05, 85.6],
  'Жамбыл': [49.0, 85.2],
  'Аршаты': [49.3, 85.9],
  'Маралды': [50.05, 82.9],
  'Рахмановские Ключи': [49.6, 86.5]
};
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function readFileDb() {
  if (!fs.existsSync(dbPath)) return { users: [], orders: [] };
  return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
}

function writeFileDb(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

function readDb() {
  return databaseCache || { users: [], orders: [], messages: [], reviews: [] };
}

async function persistDatabase(data) {
  if (!databasePool) {
    writeFileDb(data);
    return;
  }
  const client = await databasePool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM app_records');
    for (const [collection, records] of Object.entries(data)) {
      if (!Array.isArray(records)) continue;
      for (const record of records) {
        if (!record.id) continue;
        await client.query('INSERT INTO app_records (collection, id, payload) VALUES ($1, $2, $3)', [collection, record.id, record]);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function writeDb(data) {
  databaseCache = data;
  persistDatabase(data).catch((error) => console.error(`Не удалось сохранить базу: ${error.message}`));
}

async function initializeDatabase() {
  const fileData = readFileDb();
  if (!process.env.DATABASE_URL) {
    databaseCache = fileData;
    return 'data.json';
  }
  const { Pool } = require('pg');
  databasePool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await databasePool.query('CREATE TABLE IF NOT EXISTS app_records (collection TEXT NOT NULL, id TEXT NOT NULL, payload JSONB NOT NULL, PRIMARY KEY (collection, id))');
  const result = await databasePool.query('SELECT collection, payload FROM app_records');
  if (!result.rows.length) {
    databaseCache = fileData;
    await persistDatabase(databaseCache);
  } else {
    databaseCache = { users: [], orders: [], messages: [], reviews: [] };
    for (const row of result.rows) {
      if (!databaseCache[row.collection]) databaseCache[row.collection] = [];
      databaseCache[row.collection].push(row.payload);
    }
  }
  return 'postgresql';
}

function readLocations() {
  if (!fs.existsSync(locationsPath)) return [];
  return JSON.parse(fs.readFileSync(locationsPath, 'utf8'));
}

function distanceBetween(first, second) {
  const start = locationCoordinates[first];
  const end = locationCoordinates[second];
  if (!start || !end) return null;
  const earthRadius = 6371;
  const latDelta = (end[0] - start[0]) * Math.PI / 180;
  const lonDelta = (end[1] - start[1]) * Math.PI / 180;
  const value = Math.sin(latDelta / 2) ** 2 + Math.cos(start[0] * Math.PI / 180) * Math.cos(end[0] * Math.PI / 180) * Math.sin(lonDelta / 2) ** 2;
  return Math.round(earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value)) * 1.18);
}

function requireAdmin(req, res) {
  if (!adminKey || req.headers['x-admin-key'] !== adminKey) {
    send(res, 401, { error: 'Неверный ключ администратора' });
    return false;
  }
  return true;
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function body(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Некорректные данные'));
      }
    });
  });
}

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    try {
      if (url.pathname === '/api/login' && req.method === 'POST') {
        const { name, phone, role } = await body(req);
        if (!name?.trim() || !phone?.trim() || !['passenger', 'driver'].includes(role)) {
          return send(res, 400, { error: 'Заполните имя, телефон и роль' });
        }

        const db = readDb();
        let user = db.users.find((item) => item.phone === phone.trim());

        if (!user) {
          user = {
            id: crypto.randomUUID(),
            name: name.trim(),
            phone: phone.trim(),
            role,
            createdAt: new Date().toISOString()
          };
          db.users.push(user);
        } else {
          user.name = name.trim();
          user.role = role;
        }

        writeDb(db);
        return send(res, 200, { user });
      }

      if (url.pathname === '/api/orders' && req.method === 'GET') {
        const db = readDb();
        const status = url.searchParams.get('status');
        const from = (url.searchParams.get('from') || '').trim().toLowerCase();
        const to = (url.searchParams.get('to') || '').trim().toLowerCase();
        const seats = Number(url.searchParams.get('seats'));
        const minPrice = Number(url.searchParams.get('minPrice'));
        const maxPrice = Number(url.searchParams.get('maxPrice'));
        const orders = db.orders.filter((order) => {
          if (status && order.status !== status) return false;
          if (from && !order.from.toLowerCase().includes(from)) return false;
          if (to && !order.to.toLowerCase().includes(to)) return false;
          if (Number.isFinite(seats) && seats > 0 && Number(order.seats) < seats) return false;
          if (Number.isFinite(minPrice) && minPrice > 0 && Number(order.price) < minPrice) return false;
          if (Number.isFinite(maxPrice) && maxPrice > 0 && Number(order.price) > maxPrice) return false;
          return true;
        });
        return send(res, 200, { orders: orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
      }

      if (url.pathname === '/api/messages' && req.method === 'GET') {
        const db = readDb();
        const orderId = url.searchParams.get('orderId');
        const userId = url.searchParams.get('userId');
        const messages = (db.messages || []).filter((message) => {
          if (orderId && message.orderId !== orderId) return false;
          if (userId && message.senderId !== userId && message.recipientId !== userId) return false;
          return true;
        });
        return send(res, 200, { messages: messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt)) });
      }

      if (url.pathname === '/api/messages' && req.method === 'POST') {
        const { orderId, senderId, recipientId, text } = await body(req);
        const db = readDb();
        const order = db.orders.find((item) => item.id === orderId);
        if (!order || !senderId || !recipientId || !text?.trim()) {
          return send(res, 400, { error: 'Некорректное сообщение' });
        }
        if (![order.passengerId, order.userId, order.driverId].includes(senderId)) {
          return send(res, 403, { error: 'Нет доступа к чату' });
        }
        db.messages = db.messages || [];
        const message = {
          id: crypto.randomUUID(), orderId, senderId, recipientId,
          text: text.trim().slice(0, 1000), createdAt: new Date().toISOString()
        };
        db.messages.push(message);
        writeDb(db);
        return send(res, 201, { message });
      }

      if (url.pathname === '/api/reviews' && req.method === 'GET') {
        const db = readDb();
        const userId = url.searchParams.get('userId');
        return send(res, 200, { reviews: (db.reviews || []).filter((review) => !userId || review.toUserId === userId) });
      }

      if (url.pathname === '/api/reviews' && req.method === 'POST') {
        const { orderId, fromUserId, toUserId, rating, text } = await body(req);
        const db = readDb();
        const order = db.orders.find((item) => item.id === orderId);
        const score = Number(rating);
        if (!order || order.status !== 'completed' || !fromUserId || !toUserId || !Number.isInteger(score) || score < 1 || score > 5) {
          return send(res, 400, { error: 'Оставить отзыв можно после завершения поездки' });
        }
        if (![order.passengerId, order.userId, order.driverId].includes(fromUserId)) {
          return send(res, 403, { error: 'Нет доступа к отзыву' });
        }
        db.reviews = db.reviews || [];
        if (db.reviews.some((review) => review.orderId === orderId && review.fromUserId === fromUserId)) {
          return send(res, 409, { error: 'Вы уже оставили отзыв' });
        }
        const review = { id: crypto.randomUUID(), orderId, fromUserId, toUserId, rating: score, text: (text || '').trim().slice(0, 500), createdAt: new Date().toISOString() };
        db.reviews.push(review);
        writeDb(db);
        return send(res, 201, { review });
      }

      if (url.pathname === '/api/admin/summary' && req.method === 'GET') {
        if (!requireAdmin(req, res)) return;
        const db = readDb();
        return send(res, 200, { users: db.users.length, orders: db.orders.length, openOrders: db.orders.filter((order) => order.status === 'open').length, locations: readLocations().length });
      }

      if (url.pathname === '/api/admin/orders' && req.method === 'GET') {
        if (!requireAdmin(req, res)) return;
        const db = readDb();
        return send(res, 200, { orders: db.orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
      }

      const vehicleMatch = url.pathname.match(/^\/api\/users\/([\w-]+)\/vehicle$/);
      if (vehicleMatch && req.method === 'POST') {
        const { vehicle, photoDataUrl, documentDataUrl } = await body(req);
        const db = readDb();
        const user = db.users.find((item) => item.id === vehicleMatch[1] && item.role === 'driver');
        if (!user || !vehicle?.brand || !vehicle?.model || !vehicle?.plate) return send(res, 400, { error: 'Заполните данные автомобиля' });
        user.vehicle = { brand: vehicle.brand.trim(), model: vehicle.model.trim(), plate: vehicle.plate.trim(), color: (vehicle.color || '').trim() };
        fs.mkdirSync(uploadsPath, { recursive: true });
        const saveDataUrl = (dataUrl, suffix) => {
          if (!dataUrl?.startsWith('data:')) return null;
          const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp|pdf));base64,(.+)$/);
          if (!match) return null;
          const extension = match[1].split('/')[1].replace('jpeg', 'jpg');
          const fileName = `${user.id}-${suffix}.${extension}`;
          fs.writeFileSync(path.join(uploadsPath, fileName), Buffer.from(match[2], 'base64'));
          return `/uploads/${fileName}`;
        };
        user.vehicle.photo = saveDataUrl(photoDataUrl, 'vehicle');
        user.vehicle.document = saveDataUrl(documentDataUrl, 'document');
        writeDb(db);
        return send(res, 200, { user });
      }

      if (url.pathname === '/api/locations' && req.method === 'GET') {
        const query = (url.searchParams.get('q') || '').trim().toLowerCase();
        const type = url.searchParams.get('type');
        const popularOnly = url.searchParams.get('popular') === 'true';
        const locations = readLocations().filter((location) => {
          const matchesQuery = !query || `${location.name} ${location.region}`.toLowerCase().includes(query);
          const matchesType = !type || location.type === type;
          const matchesPopular = !popularOnly || location.popular;
          return matchesQuery && matchesType && matchesPopular;
        });
        return send(res, 200, { locations });
      }

      if (url.pathname === '/api/route' && req.method === 'GET') {
        const from = url.searchParams.get('from');
        const to = url.searchParams.get('to');
        const distance = distanceBetween(from, to);
        if (!distance) return send(res, 400, { error: 'Выберите города или сёла из справочника' });
        const durationHours = Math.max(1, Math.round(distance / 62 * 10) / 10);
        const basePrice = Math.max(1500, Math.round(distance * 42 / 500) * 500);
        return send(res, 200, {
          from,
          to,
          distance,
          durationMinutes: Math.round(durationHours * 60),
          suggestedPrice: basePrice,
          priceRange: { min: Math.round(basePrice * 0.85 / 500) * 500, max: Math.round(basePrice * 1.25 / 500) * 500 }
        });
      }

      const roleMatch = url.pathname.match(/^\/api\/users\/([\w-]+)\/role$/);
      if (roleMatch && req.method === 'POST') {
        const { role } = await body(req);
        const db = readDb();
        const user = db.users.find((item) => item.id === roleMatch[1]);

        if (!user || !['passenger', 'driver'].includes(role)) {
          return send(res, 400, { error: 'Не удалось сменить роль' });
        }

        user.role = role;
        writeDb(db);
        return send(res, 200, { user });
      }

      if (url.pathname === '/api/orders' && req.method === 'POST') {
        const { userId, from, to, seats, when, stop, price } = await body(req);
        const db = readDb();

        if (!db.users.some((user) => user.id === userId) || !from || !to) {
          return send(res, 400, { error: 'Не удалось создать заказ' });
        }

        const order = {
          id: crypto.randomUUID(),
          passengerId: userId,
          from,
          to,
          seats: Number(seats) || 1,
          when,
          stop: stop || null,
          price: Number(price) || 4500,
          status: 'open',
          createdAt: new Date().toISOString()
        };

        db.orders.push(order);
        writeDb(db);
        return send(res, 201, { order });
      }

      const match = url.pathname.match(/^\/api\/orders\/([\w-]+)\/accept$/);
      if (match && req.method === 'POST') {
        const { driverId, driverPrice } = await body(req);
        const db = readDb();
        const driver = db.users.find((user) => user.id === driverId && user.role === 'driver');
        const order = db.orders.find((item) => item.id === match[1]);

        if (!driver || !order) {
          return send(res, 404, { error: 'Заказ или водитель не найден' });
        }

        if (order.status !== 'open') {
          return send(res, 409, { error: 'Этот заказ уже принят' });
        }

        if (!Number(driverPrice) || Number(driverPrice) < 500) {
          return send(res, 400, { error: 'Укажите корректную цену' });
        }

        order.status = 'accepted';
        order.driverId = driverId;
        order.driverPrice = Number(driverPrice);
        order.offeredAt = new Date().toISOString();
        order.acceptedAt = order.offeredAt;
        writeDb(db);
        return send(res, 200, { order });
      }

      const statusMatch = url.pathname.match(/^\/api\/orders\/([\w-]+)\/status$/);
      if (statusMatch && req.method === 'POST') {
        const { status, userId } = await body(req);
        const allowedStatuses = ['accepted', 'in_progress', 'completed', 'cancelled'];
        const db = readDb();
        const order = db.orders.find((item) => item.id === statusMatch[1]);

        if (!order || !allowedStatuses.includes(status)) {
          return send(res, 400, { error: 'Некорректный статус поездки' });
        }

        const canUpdate = userId && [order.passengerId, order.userId, order.driverId].includes(userId);
        if (!canUpdate) return send(res, 403, { error: 'Нет доступа к поездке' });

        const transitions = {
          open: ['cancelled'],
          accepted: ['in_progress', 'cancelled'],
          in_progress: ['completed', 'cancelled'],
          completed: [],
          cancelled: []
        };
        if (!transitions[order.status]?.includes(status)) {
          return send(res, 409, { error: `Нельзя изменить статус с ${order.status} на ${status}` });
        }

        order.status = status;
        order[`${status}At`] = new Date().toISOString();
        writeDb(db);
        return send(res, 200, { order });
      }

      const filePath = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname);
      if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404);
        return res.end('Не найдено');
      }

      res.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    } catch (error) {
      send(res, 500, { error: error.message || 'Ошибка сервера' });
    }
  });
}

async function startServer(port) {
  const storage = await initializeDatabase();
  const server = createServer();

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      const fallbackPort = port + 1;
      console.log(`Порт ${port} занят. Переключаюсь на ${fallbackPort}.`);
      startServer(fallbackPort);
      return;
    }
    throw error;
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`JOL запущен: http://localhost:${port}`);
    console.log(`Хранилище: ${storage}`);
    const addresses = Object.values(os.networkInterfaces())
      .flat()
      .filter((item) => item && item.family === 'IPv4' && !item.internal)
      .map((item) => `http://${item.address}:${port}`);

    addresses.forEach((address) => console.log(`Для телефона: ${address}`));
  });
}

const defaultPort = Number(process.env.PORT || 3007);
startServer(defaultPort).catch((error) => {
  console.error(`Не удалось запустить приложение: ${error.message}`);
  process.exitCode = 1;
});
