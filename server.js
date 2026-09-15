const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const root = __dirname;
const dbPath = path.join(root, 'data.json');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function readDb() {
  if (!fs.existsSync(dbPath)) return { users: [], orders: [] };
  return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
}

function writeDb(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
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
        const orders = status ? db.orders.filter((order) => order.status === status) : db.orders;
        return send(res, 200, { orders: orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
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

        order.status = 'price_offered';
        order.driverId = driverId;
        order.driverPrice = Number(driverPrice);
        order.offeredAt = new Date().toISOString();
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

function startServer(port) {
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
    const addresses = Object.values(os.networkInterfaces())
      .flat()
      .filter((item) => item && item.family === 'IPv4' && !item.internal)
      .map((item) => `http://${item.address}:${port}`);

    addresses.forEach((address) => console.log(`Для телефона: ${address}`));
  });
}

const defaultPort = Number(process.env.PORT || 3007);
startServer(defaultPort);
