const $ = (selector) => document.querySelector(selector);
const getElement = (...selectors) => selectors.map((selector) => document.querySelector(selector)).find(Boolean) || null;
const routeStops = ['Алтай', 'Улькен Нарын', 'Катон-Карагай', 'Жана-Ульга', 'Шынгыстай', 'Урыль', 'Жамбыл', 'Берель', 'Аршаты'];
const locationOptions = ['Усть-Каменогорск', ...routeStops, 'Риддер', 'Зайсан', 'Курчум', 'Маралды', 'Рахмановские Ключи'];
const locationTypeLabels = { city: 'Город', village: 'Село' };

const seedState = {
  users: [],
  orders: [
    {
      id: 'ord-1',
      userId: 'u-1',
      from: 'Усть-Каменогорск',
      to: 'Урыль, Катон-Карагай',
      seats: 1,
      when: 'Сегодня, сейчас',
      price: 35000,
      status: 'open',
      createdAt: new Date().toISOString()
    },
    {
      id: 'ord-2',
      userId: 'u-2',
      from: 'Усть-Каменогорск',
      to: 'Берель',
      seats: 2,
      when: 'Сегодня, сейчас',
      price: 22000,
      status: 'open',
      createdAt: new Date().toISOString()
    }
  ]
};

let user = JSON.parse(localStorage.getItem('jol-user') || 'null');
let passengerStop = '';
let activeLocationInput = null;
let driverOnline = true;
let routeEstimateRequest = 0;
let notificationSnapshot = '';

function ensureStorage() {
  if (!localStorage.getItem('jol-state')) {
    localStorage.setItem('jol-state', JSON.stringify(seedState));
  }
}

function getState() {
  ensureStorage();
  return JSON.parse(localStorage.getItem('jol-state') || JSON.stringify(seedState));
}

function saveState(data) {
  localStorage.setItem('jol-state', JSON.stringify(data));
}

function showToast(message) {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2600);
}

async function pollNotifications() {
  if (!user) return;
  try {
    const data = await api('/orders');
    const relevant = (data.orders || []).filter((order) => [order.passengerId, order.userId, order.driverId].includes(user.id));
    const snapshot = relevant.map((order) => `${order.id}:${order.status}:${order.updatedAt || order.createdAt}`).join('|');
    if (notificationSnapshot && snapshot !== notificationSnapshot) {
      showToast('Обновились ваши поездки');
      if ('Notification' in window && Notification.permission === 'granted') new Notification('JOL', { body: 'Обновился статус поездки' });
    }
    notificationSnapshot = snapshot;
  } catch {
    // Notifications are optional and should not interrupt the ride flow.
  }
}

async function updateRouteEstimate() {
  const fromInput = getElement('#from');
  const toInput = getElement('#to');
  const distanceLabel = getElement('#routeDistance');
  const durationLabel = getElement('#routeDuration');
  const priceHint = getElement('#routePriceHint');
  const priceInput = getElement('#passengerPrice');
  if (!fromInput || !toInput || !distanceLabel || !durationLabel || !priceHint) return;

  const requestId = ++routeEstimateRequest;
  try {
    const data = await api(`/route?from=${encodeURIComponent(fromInput.value.trim())}&to=${encodeURIComponent(toInput.value.trim())}`);
    if (requestId !== routeEstimateRequest) return;
    const hours = Math.floor(data.durationMinutes / 60);
    const minutes = data.durationMinutes % 60;
    distanceLabel.textContent = `≈ ${data.distance} км`;
    durationLabel.textContent = `${hours ? `${hours} ч ` : ''}${minutes} мин`;
    priceHint.textContent = `Ориентировочная цена: ${data.priceRange.min.toLocaleString('ru-RU')}–${data.priceRange.max.toLocaleString('ru-RU')} ₸`;
    if (priceInput && (!priceInput.value || priceInput.dataset.autoPrice === 'true')) {
      priceInput.value = data.suggestedPrice;
      priceInput.dataset.autoPrice = 'true';
    }
  } catch {
    distanceLabel.textContent = 'Выберите маршрут';
    durationLabel.textContent = 'Расчёт времени';
    priceHint.textContent = 'Выберите город или село из списка';
  }
}

function api(path, options = {}) {
  if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
    return fetch(`/api${path}`, options).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Ошибка сервера');
      return data;
    });
  }

  const state = getState();
  const payload = options.body ? JSON.parse(options.body) : {};

  if (path === '/login' && options.method === 'POST') {
    let found = state.users.find((item) => item.phone === payload.phone);
    if (!found) {
      found = {
        id: `u-${Date.now()}`,
        name: payload.name,
        phone: payload.phone,
        role: payload.role,
        rating: 4.9
      };
      state.users.push(found);
    } else {
      found.name = payload.name;
      found.role = payload.role;
    }
    saveState(state);
    return Promise.resolve({ user: found });
  }

  if (path.startsWith('/users/') && path.endsWith('/role')) {
    const id = path.split('/')[2];
    const item = state.users.find((entry) => entry.id === id);
    if (!item) return Promise.reject(new Error('Пользователь не найден'));
    item.role = payload.role;
    saveState(state);
    return Promise.resolve({ user: item });
  }

  if (path === '/orders' && options.method === 'POST') {
    const order = {
      id: `ord-${Date.now()}`,
      userId: payload.userId,
      from: payload.from,
      to: payload.to,
      seats: Number(payload.seats) || 1,
      when: payload.when,
      stop: payload.stop || null,
      price: Number(payload.price) || 4500,
      status: 'open',
      createdAt: new Date().toISOString()
    };
    state.orders.unshift(order);
    saveState(state);
    return Promise.resolve({ order });
  }

  if (path.startsWith('/locations')) {
    const params = new URLSearchParams(path.split('?')[1] || '');
    const query = (params.get('q') || '').toLowerCase();
    const type = params.get('type');
    const locations = locationOptions
      .map((name) => ({ name, type: name === 'Усть-Каменогорск' || ['Алтай', 'Риддер', 'Зайсан'].includes(name) ? 'city' : 'village', region: 'Восточно-Казахстанская область' }))
      .filter((location) => (!query || location.name.toLowerCase().includes(query)) && (!type || location.type === type));
    return Promise.resolve({ locations });
  }

  if (path.includes('/accept') && options.method === 'POST') {
    const orderId = path.split('/')[2];
    const order = state.orders.find((entry) => entry.id === orderId);
    if (!order) return Promise.reject(new Error('Заказ не найден'));
    order.status = 'accepted';
    order.driverId = payload.driverId;
    order.driverPrice = Number(payload.driverPrice || order.price);
    saveState(state);
    return Promise.resolve({ order });
  }

  return Promise.reject(new Error('Неизвестный запрос'));
}

function setUser(newUser) {
  user = newUser;
  localStorage.setItem('jol-user', JSON.stringify(newUser));
  renderProfile();
  renderHomeRole();
  renderRoleToggle();
}

async function syncUserSession() {
  if (!user?.name || !user?.phone || !user?.role) return;
  try {
    const data = await api('/login', {
      method: 'POST',
      body: JSON.stringify({ name: user.name, phone: user.phone, role: user.role })
    });
    user = data.user;
    localStorage.setItem('jol-user', JSON.stringify(user));
  } catch {
    localStorage.removeItem('jol-user');
    user = null;
  }
}

function renderRoleToggle() {
  const toggle = getElement('#roleToggle', '.role-toggle');
  if (!toggle) return;
  toggle.textContent = user?.role === 'driver' ? 'Пассажир' : 'Водитель';
}

function renderHomeRole() {
  const isDriver = user?.role === 'driver';
  const passengerHome = getElement('#passengerHome', '#passengerScreen');
  const driverHome = getElement('#driverHome', '#driverScreen');
  if (passengerHome) {
    passengerHome.classList.toggle('hidden', isDriver);
    passengerHome.classList.toggle('active', !isDriver);
  }
  if (driverHome) {
    driverHome.classList.toggle('hidden', !isDriver);
    driverHome.classList.toggle('active', isDriver);
  }

  const driverName = getElement('#driverName');
  const profileName = getElement('#profileName');
  const profilePhone = getElement('#profilePhone');
  if (user && driverName) driverName.textContent = `Добрый день, ${user.name}!`;
  if (user && profileName) profileName.textContent = user.name || 'Пользователь';
  if (user && profilePhone) profilePhone.textContent = user.phone || '+7 000 000 00 00';
}

function renderProfile() {
  if (!user) return;
  const profileName = getElement('#profileName');
  const profilePhone = getElement('#profilePhone');
  const profileRoleToggle = getElement('#profileRoleToggle');

  if (profileName) profileName.textContent = user.name;
  if (profilePhone) profilePhone.textContent = user.phone;
  if (profileRoleToggle) profileRoleToggle.textContent = user.role === 'driver' ? 'Пассажир' : 'Водитель';
}

const statusLabels = { open: 'Ищем водителя', accepted: 'Водитель найден', in_progress: 'В пути', completed: 'Завершена', cancelled: 'Отменена' };

function openMapForOrder(order) {
  const query = encodeURIComponent(`${order.from} до ${order.to}`);
  window.open(`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(order.from)}&destination=${encodeURIComponent(order.to)}&travelmode=driving`, '_blank', 'noopener');
}

async function submitReview(orderId, toUserId, rating, text) {
  try {
    await api('/reviews', { method: 'POST', body: JSON.stringify({ orderId, fromUserId: user.id, toUserId, rating, text }) });
    showToast('Спасибо за отзыв');
    await renderRidesHistory();
  } catch (error) {
    showToast(error.message || 'Не удалось сохранить отзыв');
  }
}

async function updateOrderStatus(orderId, status) {
  try {
    await api(`/orders/${orderId}/status`, { method: 'POST', body: JSON.stringify({ status, userId: user.id }) });
    showToast(`Статус: ${statusLabels[status]}`);
    await renderRidesHistory();
  } catch (error) {
    showToast(error.message || 'Не удалось изменить статус');
  }
}

function getOrderParticipant(order) {
  return user?.id === (order.passengerId || order.userId) ? order.driverId : (order.passengerId || order.userId);
}

async function loadMessages(orderId) {
  const list = getElement('#messageList');
  if (!list || !orderId || !user) return;
  try {
    const data = await api(`/messages?orderId=${encodeURIComponent(orderId)}&userId=${encodeURIComponent(user.id)}`);
    list.innerHTML = data.messages?.length ? data.messages.map((message) => `<div class="message-bubble ${message.senderId === user.id ? 'mine' : ''}">${message.text}<small>${new Date(message.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</small></div>`).join('') : '<div class="empty-state">Сообщений пока нет</div>';
    list.scrollTop = list.scrollHeight;
  } catch (error) {
    showToast(error.message || 'Не удалось загрузить чат');
  }
}

async function loadMessageOrders() {
  const select = getElement('#messageOrderSelect');
  if (!select || !user) return;
  try {
    const data = await api('/orders');
    const orders = (data.orders || []).filter((order) => [order.passengerId, order.userId, order.driverId].includes(user.id) && order.driverId);
    select.innerHTML = orders.length ? orders.map((order) => `<option value="${order.id}">${order.from} → ${order.to} · ${statusLabels[order.status] || order.status}</option>`).join('') : '<option value="">Нет доступных чатов</option>';
    await loadMessages(select.value);
  } catch (error) {
    showToast(error.message || 'Не удалось загрузить поездки');
  }
}

async function handleMessageSubmit(event) {
  event.preventDefault();
  const select = getElement('#messageOrderSelect');
  const input = getElement('#messageText');
  const orderId = select?.value;
  if (!orderId || !input?.value.trim()) return;
  try {
    const orders = await api('/orders');
    const order = (orders.orders || []).find((item) => item.id === orderId);
    const recipientId = getOrderParticipant(order || {});
    await api('/messages', { method: 'POST', body: JSON.stringify({ orderId, senderId: user.id, recipientId, text: input.value }) });
    input.value = '';
    await loadMessages(orderId);
  } catch (error) {
    showToast(error.message || 'Не удалось отправить сообщение');
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve) => {
    if (!file) return resolve(null);
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

async function handleVehicleSubmit(event) {
  event.preventDefault();
  if (!user) return;
  const value = (selector) => getElement(selector)?.value.trim() || '';
  try {
    await api(`/users/${user.id}/vehicle`, {
      method: 'POST',
      body: JSON.stringify({
        vehicle: { brand: value('#vehicleBrand'), model: value('#vehicleModel'), plate: value('#vehiclePlate'), color: value('#vehicleColor') },
        photoDataUrl: await readFileAsDataUrl(getElement('#vehiclePhoto')?.files[0]),
        documentDataUrl: await readFileAsDataUrl(getElement('#vehicleDocument')?.files[0])
      })
    });
    showToast('Данные автомобиля сохранены');
  } catch (error) {
    showToast(error.message || 'Не удалось сохранить автомобиль');
  }
}

function ensureScreens() {
  const content = getElement('.content', '.app');
  const navigation = getElement('.bottom-nav');
  if (!content || !navigation) return;

  if (!getElement('#ridesScreen')) {
    const ridesScreen = document.createElement('section');
    ridesScreen.id = 'ridesScreen';
    ridesScreen.className = 'screen';
    ridesScreen.innerHTML = '<div class="panel-header"><h2>Поездки</h2><button class="ghost-button" type="button">История</button></div><div id="ridesList" class="list-panel"></div>';
    content.insertBefore(ridesScreen, navigation);
  }

  if (!getElement('#messagesScreen')) {
    const messagesScreen = document.createElement('section');
    messagesScreen.id = 'messagesScreen';
    messagesScreen.className = 'screen';
    messagesScreen.innerHTML = '<div class="panel-header"><h2>Сообщения</h2><span class="badge soft">3</span></div><div class="message-list"><div class="message-item"><div class="avatar small accent">Д</div><div><b>Доставка маршрута</b><p>Новый заказ рядом с вами</p></div><time>2 мин</time></div><div class="message-item"><div class="avatar small blue">П</div><div><b>Пассажир</b><p>Ваше предложение отправлено</p></div><time>14:05</time></div></div>';
    content.insertBefore(messagesScreen, navigation);
  }

  if (!getElement('#profileScreen')) {
    const profileScreen = document.createElement('section');
    profileScreen.id = 'profileScreen';
    profileScreen.className = 'screen';
    profileScreen.innerHTML = '<div class="profile-card"><div class="profile-top"><div class="avatar large">А</div><div><h2 id="profileName">Пользователь</h2><p id="profilePhone">+7 000 000 00 00</p></div><button id="logoutButton" class="mini-button danger" type="button">Выйти</button></div><div class="rating-row"><span>⭐ 4.9</span><span>Рейтинг</span></div></div><div class="settings-card"><div class="settings-row"><div><b>Статус</b><p>Переключить режим пассажира и водителя</p></div><button id="profileRoleToggle" class="toggle-button" type="button">Переключить</button></div><div class="settings-row"><div><b>Уведомления</b><p>Получать новые заказы</p></div><button class="toggle-button active" type="button">Вкл</button></div><div class="settings-row"><div><b>Геолокация</b><p>Показывать маршрут на карте</p></div><button class="toggle-button active" type="button">Вкл</button></div><div class="settings-row"><div><b>Звук</b><p>Уведомления и сигналы</p></div><button class="toggle-button" type="button">Выкл</button></div></div>';
    content.insertBefore(profileScreen, navigation);
  }
}

function switchTab(tabName) {
  document.querySelectorAll('.screen').forEach((screen) => {
    screen.classList.toggle('active', screen.id === `${tabName}Screen`);
  });

  const homeScreen = getElement('#homeScreen', '#passengerScreen');
  const ridesScreen = getElement('#ridesScreen');
  const messagesScreen = getElement('#messagesScreen');
  const profileScreen = getElement('#profileScreen');

  if (homeScreen) homeScreen.classList.toggle('active', tabName === 'home');
  if (ridesScreen) ridesScreen.classList.toggle('active', tabName === 'rides');
  if (messagesScreen) messagesScreen.classList.toggle('active', tabName === 'messages');
  if (profileScreen) profileScreen.classList.toggle('active', tabName === 'profile');

  if (tabName === 'home') renderHomeRole();

  document.querySelectorAll('.nav-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tabName);
  });

  if (tabName === 'home' && user?.role === 'driver') {
    loadDriverOrders();
  }
}

function renderStops() {
  const passengerStops = getElement('#passengerStops');
  const driverStops = getElement('#driverStops');

  if (!passengerStops && !driverStops) return;

  routeStops.forEach((stop) => {
    if (passengerStops) {
      const passengerChip = document.createElement('button');
      passengerChip.type = 'button';
      passengerChip.className = 'stop-chip';
      passengerChip.textContent = stop;
      passengerChip.addEventListener('click', () => {
        document.querySelectorAll('.stop-chip').forEach((chip) => chip.classList.remove('selected'));
        passengerChip.classList.add('selected');
        passengerStop = stop;
        const toInput = getElement('#to');
        if (toInput) toInput.value = stop;
      });
      passengerStops.appendChild(passengerChip);
    }

    if (driverStops) {
      const driverChip = document.createElement('button');
      driverChip.type = 'button';
      driverChip.className = 'driver-stop';
      driverChip.textContent = stop;
      driverChip.addEventListener('click', () => {
        driverChip.classList.toggle('selected');
        const count = document.querySelectorAll('.driver-stop.selected').length;
        const detourCount = getElement('#detourCount');
        if (detourCount) detourCount.textContent = count ? `Заездов: ${count}` : 'Без заездов';
      });
      driverStops.appendChild(driverChip);
    }
  });
}

function placePassengerStops() {
  const picker = getElement('.route-stop-picker', '.chip-block');
  const fields = document.querySelectorAll('.place-field');
  const destination = fields[1];
  if (!picker || !destination || !destination.parentElement) return;

  const title = picker.querySelector('.section-label');
  if (title) title.textContent = 'Выберите село или остановку';
  destination.parentElement.insertBefore(picker, destination.nextElementSibling);
}

async function showLocationMenu(input, filter = false) {
  if (!input || !input.value) return;
  activeLocationInput = input;
  const menu = getElement('#locationMenu');
  if (!menu) return;
  const query = input.value.trim().toLowerCase();
  let locations = locationOptions.map((name) => ({
    name,
    type: name === 'Усть-Каменогорск' || ['Алтай', 'Риддер', 'Зайсан'].includes(name) ? 'city' : 'village'
  }));

  try {
    const data = await api(`/locations?q=${encodeURIComponent(filter ? query : '')}`);
    if (data.locations?.length) locations = data.locations;
  } catch {
    locations = locations.filter((location) => !filter || location.name.toLowerCase().includes(query) || query.length < 2);
  }

  menu.innerHTML = `<p>Выберите город или село</p>${locations.map((location) => `<button type="button" role="option"><span>${location.name}</span><small>${locationTypeLabels[location.type] || 'Место'}</small></button>`).join('')}`;
  menu.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => {
      const selectedName = button.querySelector('span')?.textContent || button.textContent;
      activeLocationInput.value = selectedName;
      if (activeLocationInput.id === 'to') passengerStop = selectedName;
      menu.classList.add('hidden');
      activeLocationInput.focus();
    });
  });
  menu.classList.remove('hidden');
}

async function renderRidesHistory() {
  const list = getElement('#ridesList');
  if (!list) return;

  let myOrders = [];
  try {
    const data = await api('/orders');
    myOrders = (data.orders || []).filter((order) => order.userId === user?.id || order.passengerId === user?.id || order.driverId === user?.id);
  } catch (error) {
    showToast(error.message || 'Не удалось загрузить поездки');
  }

  if (!myOrders.length) {
    list.innerHTML = '<div class="ride-history-item"><div><b>Пока нет поездок</b><small>Когда появятся маршруты, они отобразятся здесь</small></div></div>';
    return;
  }

    list.innerHTML = myOrders.slice(0, 8).map((order) => `
    <div class="ride-history-item">
      <div>
        <b>${order.from} → ${order.to}</b>
        <small>${order.when} · ${statusLabels[order.status] || order.status}</small>
      </div>
      <div class="ride-actions">
        <span class="status-pill">${statusLabels[order.status] || order.status}</span>
        ${order.status === 'accepted' && order.driverId === user.id ? `<button class="mini-button ride-status-button" data-order-id="${order.id}" data-next-status="in_progress" type="button">Начать</button>` : ''}
        ${order.status === 'in_progress' && order.driverId === user.id ? `<button class="mini-button ride-status-button" data-order-id="${order.id}" data-next-status="completed" type="button">Завершить</button>` : ''}
        ${order.status !== 'open' ? `<button class="mini-button map-button" data-order-id="${order.id}" type="button">Карта</button>` : ''}
        ${order.status === 'completed' ? `<button class="mini-button review-button" data-order-id="${order.id}" data-to-user="${user.id === order.driverId ? (order.passengerId || order.userId) : order.driverId}" type="button">Оценить</button>` : ''}
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.ride-status-button').forEach((button) => button.addEventListener('click', () => updateOrderStatus(button.dataset.orderId, button.dataset.nextStatus)));
  list.querySelectorAll('.map-button').forEach((button) => button.addEventListener('click', () => {
    const order = myOrders.find((item) => item.id === button.dataset.orderId);
    if (order) openMapForOrder(order);
  }));
  list.querySelectorAll('.review-button').forEach((button) => button.addEventListener('click', async () => {
    const rating = Number(window.prompt('Оценка от 1 до 5', '5'));
    if (!rating) return;
    const text = window.prompt('Комментарий (необязательно)', '') || '';
    await submitReview(button.dataset.orderId, button.dataset.toUser, rating, text);
  }));
}

async function loadDriverOrders() {
  let openOrders = [];
  try {
    const routeFilter = getElement('#driverRouteFilter');
    const seatsFilter = getElement('#driverSeatsFilter');
    const priceFilter = getElement('#driverPriceFilter');
    const params = new URLSearchParams({ status: 'open' });
    if (routeFilter?.value.trim()) {
      params.set('from', routeFilter.value.trim());
      params.set('to', routeFilter.value.trim());
    }
    if (seatsFilter?.value) params.set('seats', seatsFilter.value);
    if (priceFilter?.value) params.set('minPrice', priceFilter.value);
    const data = await api(`/orders?${params.toString()}`);
    openOrders = data.orders || [];
  } catch (error) {
    showToast(error.message || 'Не удалось загрузить заказы');
  }
  const ordersCount = getElement('#ordersCount');
  const availableOrder = getElement('#availableOrder');
  const emptyOrders = getElement('#emptyOrders');

  if (!ordersCount || !availableOrder || !emptyOrders) return;

  ordersCount.textContent = openOrders.length ? `${openOrders.length} ${openOrders.length === 1 ? 'заказ' : 'заказа'}` : 'Нет заказов';

  if (!openOrders.length) {
    availableOrder.classList.add('hidden');
    emptyOrders.classList.remove('hidden');
    return;
  }

  const order = openOrders[0];
  const rideFrom = getElement('#rideFrom');
  const rideTo = getElement('#rideTo');
  const rideSeats = getElement('#rideSeats');
  const ridePrice = getElement('#ridePrice');
  const driverPrice = getElement('#driverPrice');

  if (rideFrom) rideFrom.textContent = order.from;
  if (rideTo) rideTo.textContent = order.to;
  if (rideSeats) rideSeats.textContent = order.seats;
  if (ridePrice) ridePrice.textContent = `${Number(order.price).toLocaleString('ru-RU')} ₸`;
  if (driverPrice) driverPrice.value = order.price;
  availableOrder.dataset.orderId = order.id;
  availableOrder.classList.remove('hidden');
  emptyOrders.classList.add('hidden');
}

async function handleLogin(event) {
  event.preventDefault();
  const nameInput = getElement('#authName');
  const phoneInput = getElement('#authPhone');
  const name = nameInput ? nameInput.value.trim() : '';
  const phone = phoneInput ? phoneInput.value.trim() : '';
  const role = document.querySelector('input[name="authRole"]:checked')?.value || 'passenger';

  if (!name || !phone) {
    showToast('Введите имя и телефон');
    return;
  }

  try {
    const data = await api('/login', {
      method: 'POST',
      body: JSON.stringify({ name, phone, role })
    });

    setUser(data.user);
    const authModal = getElement('#authModal', '#authOverlay');
    if (authModal) authModal.classList.add('hidden');
    const authForm = getElement('#authForm');
    if (authForm) authForm.reset();
    renderRidesHistory();
    showToast(`Здравствуйте, ${data.user.name}!`);
  } catch (error) {
    showToast(error.message || 'Ошибка входа');
  }
}

async function handleCreateOrder(event) {
  event.preventDefault();
  if (!user) {
    showToast('Сначала войдите в приложение');
    return;
  }

  const fromInput = getElement('#from');
  const toInput = getElement('#to');
  const priceInput = getElement('#passengerPrice');
  const from = fromInput ? fromInput.value.trim() : '';
  const to = toInput ? toInput.value.trim() : '';
  const price = priceInput ? Number(priceInput.value) : NaN;

  if (!from || !to) {
    showToast('Укажите маршрут');
    return;
  }

  if (!Number.isFinite(price) || price < 500) {
    showToast('Укажите цену не меньше 500 ₸');
    return;
  }

  try {
    const whenSelect = getElement('#when');
    const rideDate = getElement('#rideDate');
    const when = whenSelect && whenSelect.selectedIndex === 2 ? (rideDate ? rideDate.value : '') : (whenSelect ? whenSelect.value : 'Сегодня, сейчас');
    await api('/orders', {
      method: 'POST',
      body: JSON.stringify({
        userId: user.id,
        from,
        to,
        seats: getElement('#seats') ? getElement('#seats').value : 1,
        when,
        stop: passengerStop,
        price
      })
    });

    const modalMessage = getElement('#modalMessage');
    const offerModal = getElement('#offerModal');
    if (modalMessage) modalMessage.innerHTML = `Ваша цена — <b>${price.toLocaleString('ru-RU')} ₸</b>. Мы отправили заказ водителям; они смогут предложить свою сумму.`;
    if (offerModal) offerModal.classList.remove('hidden');
    renderRidesHistory();
  } catch (error) {
    showToast(error.message || 'Не удалось создать заказ');
  }
}

async function handleSwitchRole() {
  if (!user) return;
  const nextRole = user.role === 'driver' ? 'passenger' : 'driver';

  try {
    const data = await api(`/users/${user.id}/role`, {
      method: 'POST',
      body: JSON.stringify({ role: nextRole })
    });
    setUser(data.user);
    showToast(`Режим: ${data.user.role === 'driver' ? 'водитель' : 'пассажир'}`);
  } catch (error) {
    showToast(error.message || 'Не удалось сменить роль');
  }
}

async function handleAcceptOrder() {
  const availableOrder = getElement('#availableOrder');
  const orderId = availableOrder ? availableOrder.dataset.orderId : '';
  if (!orderId || !user) return;

  const driverPriceInput = getElement('#driverPrice');
  const driverPrice = driverPriceInput ? Number(driverPriceInput.value) : NaN;
  if (!Number.isFinite(driverPrice) || driverPrice < 500) {
    showToast('Укажите цену не меньше 500 ₸');
    return;
  }

  try {
    await api(`/orders/${orderId}/accept`, {
      method: 'POST',
      body: JSON.stringify({ driverId: user.id, driverPrice })
    });
    showToast('Ваша цена отправлена пассажиру');
    loadDriverOrders();
    renderRidesHistory();
  } catch (error) {
    showToast(error.message || 'Не удалось принять заказ');
  }
}

function bindEvents() {
  const authForm = getElement('#authForm');
  const roleToggle = getElement('#roleToggle', '.role-toggle');
  const avatarButton = getElement('#avatarButton', '.profile-button');
  const logoutButton = getElement('#logoutButton');
  const orderForm = getElement('#orderForm');
  const showStopsButton = getElement('#showStops');
  const whenSelect = getElement('#when');
  const acceptOrderButton = getElement('#acceptOrder');
  const closeModalButton = getElement('#closeModal');
  const doneButton = getElement('#doneButton');
  const profileRoleToggle = getElement('#profileRoleToggle');
  const onlineToggle = getElement('#onlineToggle', '.online-toggle');
  const driverFilters = getElement('#driverFilters');

  if (authForm) authForm.addEventListener('submit', handleLogin);
  if (roleToggle) roleToggle.addEventListener('click', handleSwitchRole);
  if (avatarButton) avatarButton.addEventListener('click', () => switchTab('profile'));
  if (logoutButton) logoutButton.addEventListener('click', () => {
    localStorage.removeItem('jol-user');
    user = null;
    const authModal = getElement('#authModal', '#authOverlay');
    if (authModal) authModal.classList.remove('hidden');
    const profileName = getElement('#profileName');
    const profilePhone = getElement('#profilePhone');
    if (profileName) profileName.textContent = 'Пользователь';
    if (profilePhone) profilePhone.textContent = '+7 000 000 00 00';
  });

  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => {
      switchTab(button.dataset.tab);
      if (button.dataset.tab === 'messages') loadMessageOrders();
    });
  });

  getElement('#messageForm')?.addEventListener('submit', handleMessageSubmit);
  getElement('#messageOrderSelect')?.addEventListener('change', (event) => loadMessages(event.target.value));
  getElement('#vehicleForm')?.addEventListener('submit', handleVehicleSubmit);

  if (orderForm) orderForm.addEventListener('submit', handleCreateOrder);
  if (showStopsButton) showStopsButton.addEventListener('click', () => showLocationMenu(getElement('#to')));
  if (whenSelect) whenSelect.addEventListener('change', () => {
    const dateWrap = getElement('#dateWrap', '#datePickerWrap');
    const rideDate = getElement('#rideDate');
    const isCustom = whenSelect.selectedIndex === 2;
    if (dateWrap) dateWrap.classList.toggle('hidden', !isCustom);
    if (isCustom && rideDate && !rideDate.value) {
      rideDate.value = new Date().toISOString().slice(0, 10);
    }
  });
  if (acceptOrderButton) acceptOrderButton.addEventListener('click', handleAcceptOrder);
  driverFilters?.querySelectorAll('input, select').forEach((input) => {
    input.addEventListener('input', () => loadDriverOrders());
    input.addEventListener('change', () => loadDriverOrders());
  });
  if (closeModalButton) closeModalButton.addEventListener('click', () => {
    const offerModal = getElement('#offerModal');
    if (offerModal) offerModal.classList.add('hidden');
  });
  if (doneButton) doneButton.addEventListener('click', () => {
    const offerModal = getElement('#offerModal');
    if (offerModal) offerModal.classList.add('hidden');
  });
  if (profileRoleToggle) profileRoleToggle.addEventListener('click', handleSwitchRole);

  if (onlineToggle) onlineToggle.addEventListener('click', () => {
    driverOnline = !driverOnline;
    onlineToggle.classList.toggle('off', !driverOnline);
    const toggleText = onlineToggle.querySelector('span');
    if (toggleText) toggleText.textContent = driverOnline ? 'На линии' : 'Не в сети';
  });

  document.querySelectorAll('.toggle-button').forEach((button) => {
    button.addEventListener('click', () => {
      const active = button.classList.toggle('active');
      button.textContent = active ? 'Вкл' : 'Выкл';
      if (button.dataset.setting === 'notifications' && active && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    });
  });

  ['#from', '#to'].forEach((selector) => {
    const input = $(selector);
    if (!input) return;
    input.addEventListener('focus', () => showLocationMenu(input));
    input.addEventListener('input', () => showLocationMenu(input, true));
    input.addEventListener('change', updateRouteEstimate);
    input.addEventListener('blur', updateRouteEstimate);
  });

  const priceInput = getElement('#passengerPrice');
  priceInput?.addEventListener('input', () => { priceInput.dataset.autoPrice = 'false'; });

  document.addEventListener('click', (event) => {
    const menu = getElement('#locationMenu');
    if (!menu) return;
    if (!event.target.closest('.field') && !event.target.closest('#locationMenu')) {
      menu.classList.add('hidden');
    }
  });
}

async function init() {
  ensureStorage();
  ensureScreens();
  bindEvents();
  renderStops();
  placePassengerStops();
  updateRouteEstimate();

  const authModal = getElement('#authModal', '#authOverlay');

  if (user) {
    await syncUserSession();
  }

  if (user) {
    if (authModal) authModal.classList.add('hidden');
    renderProfile();
    renderHomeRole();
    renderRidesHistory();
    loadMessageOrders();
    if (user.role === 'driver') loadDriverOrders();
  } else {
    if (authModal) authModal.classList.remove('hidden');
  }

  renderRoleToggle();
  switchTab('home');
  pollNotifications();
  window.setInterval(pollNotifications, 15000);
}

init();
