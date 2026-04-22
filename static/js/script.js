// Глобальные переменные
let currentUserId = null;
let isAdmin = false;
let museums = [];
let events = [];
let subscriptions = [];
let visits = [];
let ymapsReady = false;

// Получение user_id (из URL или localStorage)
function getUserId() {
    const urlParams = new URLSearchParams(window.location.search);
    let uid = urlParams.get('userId') || urlParams.get('user_id');
    if (!uid) {
        uid = localStorage.getItem('demo_user_id');
        if (!uid) {
            uid = 'user_' + Math.random().toString(36).substr(2, 8);
            localStorage.setItem('demo_user_id', uid);
        }
    }
    const userIdSpan = document.getElementById('userIdDisplay');
    if (userIdSpan) userIdSpan.innerText = uid.slice(0, 8);
    return uid;
}

// API вызовы
async function api(url, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (isAdmin) headers['X-Admin-Password'] = 'admin123';
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

// Загрузка данных
async function loadMuseums() {
    museums = await api('/api/museums');
    return museums;
}
async function loadEvents() {
    const params = new URLSearchParams();
    const filterCheckbox = document.getElementById('showOnlySubscribedEvents');
    if (filterCheckbox && filterCheckbox.checked && subscriptions.length) {
        params.append('user_id', currentUserId);
    }
    events = await api('/api/events?' + params.toString());
    return events;
}
async function loadSubscriptions() {
    subscriptions = await api(`/api/user/subscriptions?user_id=${currentUserId}`);
    return subscriptions;
}
async function loadVisits() {
    const data = await api(`/api/visits?user_id=${currentUserId}`);
    visits = data;
    return visits;
}
async function setVisit(museumId, visited) {
    await api('/api/visits', {
        method: 'POST',
        body: JSON.stringify({ user_id: currentUserId, museum_id: museumId, visited: visited ? 1 : 0 })
    });
    await loadVisits();
}

// Показать детальную карточку музея в модалке
async function showMuseumDetails(museumId) {
    const museum = museums.find(m => m.id === museumId);
    if (!museum) return;
    const isSubscribed = subscriptions.includes(museum.id);
    const isVisited = visits.some(v => v.museum_id === museum.id && v.visited === 1);
    
    const modal = document.getElementById('museumModal');
    const container = document.getElementById('museumDetailContent');
    if (!modal || !container) return;
    
    container.innerHTML = `
        <h2>${escapeHtml(museum.name)}</h2>
        ${museum.photo_url ? `<img src="${museum.photo_url}" style="width:100%; max-height:300px; object-fit:cover; border-radius:20px; margin:10px 0;" onerror="this.src='https://placehold.co/600x400?text=Нет+фото'">` : ''}
        <p><i class="fas fa-map-marker-alt"></i> <strong>Адрес:</strong> ${escapeHtml(museum.address)}</p>
        <p><i class="fas fa-info-circle"></i> <strong>Описание:</strong><br>${escapeHtml(museum.description || '')}</p>
        <p><i class="fas fa-phone"></i> <strong>Контакты:</strong> ${escapeHtml(museum.contacts || 'не указаны')}</p>
        ${museum.website ? `<p><i class="fas fa-globe"></i> <strong>Сайт:</strong> <a href="${museum.website}" target="_blank">${escapeHtml(museum.website)}</a></p>` : ''}
        <hr>
        <div style="display: flex; flex-wrap: wrap; gap: 10px; margin-top: 15px;">
            <button id="detailExhibitsBtn" data-id="${museum.id}"><i class="fas fa-search"></i> Экспонаты</button>
            <button id="detailSubscribeBtn" data-id="${museum.id}">${isSubscribed ? '<i class="fas fa-bell-slash"></i> Отписаться' : '<i class="fas fa-bell"></i> Подписаться'}</button>
            <button id="detailVisitBtn" data-id="${museum.id}" data-visited="${isVisited}">${isVisited ? '<i class="fas fa-check-circle"></i> Посещён' : '<i class="fas fa-circle"></i> Отметить посещение'}</button>
        </div>
    `;
    
    modal.classList.remove('hidden');
    const closeSpan = modal.querySelector('.close');
    if (closeSpan) closeSpan.onclick = () => modal.classList.add('hidden');
    
    // Обработчики кнопок внутри модалки
    const exhibitsBtn = document.getElementById('detailExhibitsBtn');
    if (exhibitsBtn) {
        exhibitsBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
            showExhibits(museum.id);
        });
    }
    const subscribeBtn = document.getElementById('detailSubscribeBtn');
    if (subscribeBtn) {
        subscribeBtn.addEventListener('click', async () => {
            const isSub = subscriptions.includes(museum.id);
            if (isSub) {
                await api('/api/unsubscribe', { method: 'POST', body: JSON.stringify({ user_id: currentUserId, museum_id: museum.id }) });
            } else {
                await api('/api/subscribe', { method: 'POST', body: JSON.stringify({ user_id: currentUserId, museum_id: museum.id }) });
            }
            await loadSubscriptions();
            renderMain();
            const filterCheckbox = document.getElementById('showOnlySubscribedEvents');
            if (filterCheckbox && filterCheckbox.checked) renderEvents();
            showMuseumDetails(museum.id);
        });
    }
    const visitBtn = document.getElementById('detailVisitBtn');
    if (visitBtn) {
        visitBtn.addEventListener('click', async () => {
            const currentlyVisited = visitBtn.dataset.visited === 'true';
            await setVisit(museum.id, !currentlyVisited);
            renderMain();
            renderPassport();
            showMuseumDetails(museum.id);
        });
    }
}

// Показать экспонаты в модалке
async function showExhibits(museumId) {
    const exhibits = await api(`/api/exhibits/${museumId}`);
    const modal = document.getElementById('exhibitsModal');
    const container = document.getElementById('exhibitsListModal');
    if (!modal || !container) return;
    if (exhibits.length) {
        container.innerHTML = exhibits.map(ex => `
            <div class="card">
                <h4>${escapeHtml(ex.name)}</h4>
                <p>${escapeHtml(ex.description || '')}</p>
                ${ex.photo_url ? `<img src="${ex.photo_url}" style="max-height:150px">` : ''}
            </div>
        `).join('');
    } else {
        container.innerHTML = '<p>Экспонатов пока нет.</p>';
    }
    modal.classList.remove('hidden');
    const closeSpan = modal.querySelector('.close');
    if (closeSpan) closeSpan.onclick = () => modal.classList.add('hidden');
}

// Рендер главной (карточки музеев) с кликом по карточке
async function renderMain() {
    const container = document.getElementById('museums-list');
    if (!container) return;
    container.innerHTML = '';
    for (const m of museums) {
        const isSubscribed = subscriptions.includes(m.id);
        const isVisited = visits.some(v => v.museum_id === m.id && v.visited === 1);
        const card = document.createElement('div');
        card.className = 'card';
        card.style.cursor = 'pointer';
        card.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
            showMuseumDetails(m.id);
        });
        card.innerHTML = `
            <h3>${escapeHtml(m.name)}</h3>
            ${m.photo_url ? `<img src="${m.photo_url}" alt="фото музея" onerror="this.src='https://placehold.co/600x400?text=Нет+фото'">` : ''}
            <p>${escapeHtml(m.description || '')}</p>
            <p><i class="fas fa-map-marker-alt"></i> ${escapeHtml(m.address)}</p>
            ${m.website ? `<p><i class="fas fa-globe"></i> <a href="${m.website}" target="_blank">Сайт музея</a></p>` : ''}
            <div>
                <button class="exhibits-btn" data-id="${m.id}"><i class="fas fa-search"></i> Экспонаты</button>
                <button class="subscribe-btn" data-id="${m.id}">${isSubscribed ? '<i class="fas fa-bell-slash"></i> Отписаться' : '<i class="fas fa-bell"></i> Подписаться'}</button>
                <button class="visit-btn" data-id="${m.id}" data-visited="${isVisited}">${isVisited ? '<i class="fas fa-check-circle"></i> Посещён' : '<i class="fas fa-circle"></i> Отметить посещение'}</button>
            </div>
        `;
        container.appendChild(card);
    }
    // Навешиваем обработчики на кнопки
    document.querySelectorAll('.exhibits-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            showExhibits(parseInt(btn.dataset.id));
        });
    });
    document.querySelectorAll('.subscribe-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const museumId = parseInt(btn.dataset.id);
            const isSub = subscriptions.includes(museumId);
            if (isSub) {
                await api('/api/unsubscribe', { method: 'POST', body: JSON.stringify({ user_id: currentUserId, museum_id: museumId }) });
            } else {
                await api('/api/subscribe', { method: 'POST', body: JSON.stringify({ user_id: currentUserId, museum_id: museumId }) });
            }
            await loadSubscriptions();
            renderMain();
            const filterCheckbox = document.getElementById('showOnlySubscribedEvents');
            if (filterCheckbox && filterCheckbox.checked) renderEvents();
        });
    });
    document.querySelectorAll('.visit-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const museumId = parseInt(btn.dataset.id);
            const currentlyVisited = btn.dataset.visited === 'true';
            await setVisit(museumId, !currentlyVisited);
            renderMain();
            renderPassport();
        });
    });
}

// Яндекс.Карты
function initYandexMap() {
    if (!ymapsReady || !window.ymaps) return;
    const mapElement = document.getElementById('map');
    if (!mapElement) return;
    const map = new ymaps.Map('map', {
        center: [45.04, 41.97],
        zoom: 8,
        controls: ['zoomControl', 'fullscreenControl']
    });
    museums.forEach(m => {
        if (m.lat && m.lng) {
            const placemark = new ymaps.Placemark([m.lat, m.lng], {
                balloonContentHeader: `<b>${escapeHtml(m.name)}</b>`,
                balloonContentBody: `<p>${escapeHtml(m.address)}</p><a href="${m.website || '#'}" target="_blank">Сайт</a><br><button onclick="window.showExhibitsFromMap(${m.id})">Экспонаты</button>`
            });
            map.geoObjects.add(placemark);
        }
    });
}
window.showExhibitsFromMap = function(museumId) {
    showExhibits(museumId);
};

// Рендер событий
async function renderEvents() {
    await loadEvents();
    const container = document.getElementById('events-list');
    if (!container) return;
    if (events.length) {
        container.innerHTML = events.map(ev => `
            <div class="card">
                <h3>${escapeHtml(ev.title)}</h3>
                <p><i class="fas fa-calendar-day"></i> ${ev.date || 'Дата не указана'}</p>
                <p><i class="fas fa-landmark"></i> ${escapeHtml(ev.museum_name)}</p>
                <p>${escapeHtml(ev.description || '')}</p>
            </div>
        `).join('');
    } else {
        container.innerHTML = '<p>Событий пока нет.</p>';
    }
}

// Паспорт: список музеев с чекбоксами, прогресс-бар
async function renderPassport() {
    await loadVisits();
    const total = museums.length;
    const visitedCount = visits.filter(v => v.visited === 1).length;
    const percent = total ? (visitedCount / total * 100) : 0;
    const container = document.getElementById('passport-info');
    if (!container) return;
    container.innerHTML = `
        <div class="card">
            <h3><i class="fas fa-passport"></i> Мои посещения</h3>
            <p>Посещено музеев: ${visitedCount} из ${total}</p>
            <div style="background:#ddd; border-radius:10px;"><div style="width:${percent}%; background:#7b4a2e; height:20px; border-radius:10px;"></div></div>
        </div>
        <div id="museumsChecklist"></div>
    `;
    const checklistDiv = document.getElementById('museumsChecklist');
    if (checklistDiv) {
        checklistDiv.innerHTML = museums.map(m => {
            const isChecked = visits.some(v => v.museum_id === m.id && v.visited === 1);
            return `
                <div class="card">
                    <label style="display:flex; align-items:center; gap:10px;">
                        <input type="checkbox" class="museum-visit-checkbox" data-id="${m.id}" ${isChecked ? 'checked' : ''}>
                        <strong>${escapeHtml(m.name)}</strong>
                    </label>
                </div>
            `;
        }).join('');
        document.querySelectorAll('.museum-visit-checkbox').forEach(cb => {
            cb.addEventListener('change', async (e) => {
                const museumId = parseInt(cb.dataset.id);
                await setVisit(museumId, cb.checked);
                renderPassport();
                renderMain();
            });
        });
    }
}

// Админ-панель (CRUD музеев и событий)
async function initAdmin() {
    const loginBtn = document.getElementById('adminLoginBtn');
    if (loginBtn) {
        loginBtn.addEventListener('click', () => {
            const form = document.getElementById('adminLoginForm');
            if (form) form.classList.toggle('hidden');
        });
    }
    const doLogin = document.getElementById('doAdminLogin');
    if (doLogin) {
        doLogin.addEventListener('click', async () => {
            const pwdInput = document.getElementById('adminPassword');
            if (pwdInput && pwdInput.value === 'admin123') {
                isAdmin = true;
                const controls = document.getElementById('adminControls');
                if (controls) controls.classList.remove('hidden');
                const form = document.getElementById('adminLoginForm');
                if (form) form.classList.add('hidden');
                loadAdminData();
            } else {
                alert('Неверный пароль');
            }
        });
    }
    const addMuseum = document.getElementById('addMuseumBtn');
    if (addMuseum) addMuseum.addEventListener('click', () => showMuseumForm());
    const addEvent = document.getElementById('addEventBtn');
    if (addEvent) addEvent.addEventListener('click', () => showEventForm());
}
async function loadAdminData() {
    const museumsData = await api('/api/admin/museums');
    const eventsData = await api('/api/events');
    const museumsDiv = document.getElementById('museumsAdminList');
    if (museumsDiv) {
        museumsDiv.innerHTML = museumsData.map(m => `
            <div class="admin-item">
                <span><strong>${escapeHtml(m.name)}</strong></span>
                <div>
                    <button class="edit-museum" data-id="${m.id}"><i class="fas fa-edit"></i></button>
                    <button class="delete-museum" data-id="${m.id}"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `).join('');
        document.querySelectorAll('.edit-museum').forEach(btn => {
            btn.addEventListener('click', () => showMuseumForm(parseInt(btn.dataset.id)));
        });
        document.querySelectorAll('.delete-museum').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (confirm('Удалить музей?')) {
                    await api('/api/admin/museums', { method: 'DELETE', body: JSON.stringify({ id: parseInt(btn.dataset.id) }) });
                    await loadAdminData();
                    await loadMuseums();
                    renderMain();
                    renderPassport();
                    if (window.ymaps && ymapsReady) initYandexMap();
                }
            });
        });
    }
    const eventsDiv = document.getElementById('eventsAdminList');
    if (eventsDiv) {
        eventsDiv.innerHTML = eventsData.map(e => `
            <div class="admin-item">
                <span><strong>${escapeHtml(e.title)}</strong> (${e.museum_name})</span>
                <div>
                    <button class="edit-event" data-id="${e.id}"><i class="fas fa-edit"></i></button>
                    <button class="delete-event" data-id="${e.id}"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `).join('');
        document.querySelectorAll('.edit-event').forEach(btn => {
            btn.addEventListener('click', () => showEventForm(parseInt(btn.dataset.id)));
        });
        document.querySelectorAll('.delete-event').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (confirm('Удалить событие?')) {
                    await api('/api/admin/events', { method: 'DELETE', body: JSON.stringify({ id: parseInt(btn.dataset.id) }) });
                    await loadAdminData();
                    renderEvents();
                }
            });
        });
    }
}
function showMuseumForm(id = null) {
    const museum = id ? museums.find(m => m.id === id) : null;
    const name = prompt('Название музея', museum?.name || '');
    if (!name) return;
    const address = prompt('Адрес', museum?.address || '');
    const lat = parseFloat(prompt('Широта', museum?.lat || '45.0'));
    const lng = parseFloat(prompt('Долгота', museum?.lng || '41.97'));
    const desc = prompt('Описание', museum?.description || '');
    const contacts = prompt('Контакты', museum?.contacts || '');
    const website = prompt('Сайт', museum?.website || '');
    const photo = prompt('Фото URL', museum?.photo_url || '');
    const data = { name, address, lat, lng, description: desc, contacts, website, photo_url: photo };
    if (id) {
        data.id = id;
        api('/api/admin/museums', { method: 'PUT', body: JSON.stringify(data) }).then(() => {
            loadAdminData();
            loadMuseums().then(() => {
                renderMain();
                renderPassport();
                if (window.ymaps && ymapsReady) initYandexMap();
            });
        });
    } else {
        api('/api/admin/museums', { method: 'POST', body: JSON.stringify(data) }).then(() => {
            loadAdminData();
            loadMuseums().then(() => {
                renderMain();
                renderPassport();
                if (window.ymaps && ymapsReady) initYandexMap();
            });
        });
    }
}
function showEventForm(id = null) {
    const event = id ? events.find(e => e.id === id) : null;
    const museumId = prompt('ID музея (посмотрите в админке списке музеев)', event?.museum_id || '');
    if (!museumId) return;
    const title = prompt('Название события', event?.title || '');
    const date = prompt('Дата (YYYY-MM-DD)', event?.date || '');
    const desc = prompt('Описание', event?.description || '');
    const data = { museum_id: parseInt(museumId), title, date, description: desc };
    if (id) {
        data.id = id;
        api('/api/admin/events', { method: 'PUT', body: JSON.stringify(data) }).then(() => {
            loadAdminData();
            renderEvents();
        });
    } else {
        api('/api/admin/events', { method: 'POST', body: JSON.stringify(data) }).then(() => {
            loadAdminData();
            renderEvents();
        });
    }
}

// Вспомогательная функция для защиты от XSS
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// Переключение вкладок
function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tab = btn.dataset.tab;
            document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
            const activePane = document.getElementById(`${tab}-tab`);
            if (activePane) activePane.classList.add('active');
            if (tab === 'map') {
                if (window.ymaps && ymapsReady) {
                    setTimeout(() => {
                        if (window.ymaps && window.ymaps.geolocation) {
                            // просто обновить карту
                        }
                    }, 100);
                }
            }
            if (tab === 'events') renderEvents();
            if (tab === 'passport') renderPassport();
        });
    });
}

// Инициализация при загрузке страницы
window.addEventListener('DOMContentLoaded', async () => {
    currentUserId = getUserId();
    await loadMuseums();
    await loadSubscriptions();
    await loadVisits();
    renderMain();
    renderPassport();
    initTabs();
    initAdmin();
    const filterCheckbox = document.getElementById('showOnlySubscribedEvents');
    if (filterCheckbox) {
        filterCheckbox.addEventListener('change', () => renderEvents());
    }
    if (typeof ymaps !== 'undefined') {
        ymaps.ready(() => {
            ymapsReady = true;
            initYandexMap();
        });
    }
});
