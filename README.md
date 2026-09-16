# JOL Taxi

Мобильное приложение для пассажиров и водителей Восточного Казахстана.

## Локальный запуск

```powershell
npm install
npm start
```

Если порт занят, сервер автоматически выберет следующий свободный порт.

## PostgreSQL на Render

1. Создайте PostgreSQL database в Render.
2. Создайте Web Service из GitHub-репозитория.
3. Build Command: `npm install`.
4. Start Command: `npm start`.
5. Добавьте переменную `DATABASE_URL` и вставьте Internal Database URL из Render.
6. Добавьте `ADMIN_KEY` для доступа к `/admin.html`.

При первом запуске с `DATABASE_URL` приложение создаст таблицу `app_records` и перенесёт существующие записи из `data.json`. Без `DATABASE_URL` локально используется `data.json`.

## Основные API

- `GET /api/locations?q=...` — поиск городов и сёл.
- `GET /api/route?from=...&to=...` — расстояние, время и цена.
- `GET/POST /api/orders` — поездки.
- `POST /api/orders/:id/status` — изменение статуса.
- `GET/POST /api/messages` — чат поездки.
- `GET/POST /api/reviews` — отзывы.
- `GET /admin.html` — админ-панель с ключом `ADMIN_KEY`.
