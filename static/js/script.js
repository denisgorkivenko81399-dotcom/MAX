// Глобальные переменные
let currentUserId = null;
let isAdmin = false;
let museums = [];
let events = [];
let subscriptions = [];   // теперь массив объектов {id, name}
let visits = [];
let ymapsReady = false;

// Получение user_id
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
    const span = document.getElementById('userIdDisplay');
    if (span) span.innerText = uid.slice(0, 8);
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

// Получение фотографий галереи
async function getMuseumPhotos(museumId) {
    return await api(`/api/museum_photos/${museumId}`);
}

// Показать детальную карточку музея с обложкой и галереей
async function showMuseumDetails(museumId) {
    const museum = museums.find(m => m.id === museumId);
    if (!museum) return;
    const photos = await getMuseumPhotos(museumId);
    const isSubscribed = subscriptions.some(s => s.id === museum.id);
    const isVisited = visits.some(v => v.museum_id === museum.id && v.visited === 1);
    
    const modal = document.getElementById('museumModal');
    const container = document.getElementById('museumDetailContent');
    if (!modal || !container) return;
    
    // Обложка (cover_photo) или первое фото из галереи как fallback
    let coverHtml = '';
    if (museum.cover_photo_url) {
        coverHtml = `<img src="${museum.cover_photo_url}" style="width:100%; max-height:300px; object-fit:cover; border-radius:20px; margin:10px 0;">`;
    } else if (photos.length) {
        coverHtml = `<img src="${photos[0]}" style="width:100%; max-height:300px; object-fit:cover; border-radius:20px; margin:10px 0;">`;
    } else {
        coverHtml = `<div style="background: #f0e3d4; height:200px; display:flex; align-items:center; justify-content:center; border-radius:20px; margin:10px 0;">Нет фото</div>`;
    }
    
    // Галерея (все фото, кроме обложки, если обложка совпадает с первым фото галереи – можно показать все)
    let galleryHtml = '';
    if (photos.length) {
        galleryHtml = `<div style="display: flex; overflow-x: auto; gap: 10px; margin: 10px 0;">
            ${photos.map(p => `<img src="${p}" style="height: 120px; object-fit: cover; border-radius: 12px;">`).join('')}
        </div>`;
    }
    
    container.innerHTML = `
        <h2>${escapeHtml(museum.name)}</h2>
        ${coverHtml}
        ${galleryHtml}
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
    
    document.getElementById('detailExhibitsBtn')?.addEventListener('click', () => {
        modal.classList.add('hidden');
        showExhibits(museum.id);
    });
    document.getElementById('detailSubscribeBtn')?.addEventListener('click', async () => {
        const isSub = subscriptions.some(s => s.id === museum.id);
        if (isSub) {
            await api('/api/unsubscribe', { method: 'POST', body: JSON.stringify({ user_id: currentUserId, museum_id: museum.id }) });
        } else {
            await api('/api/subscribe', { method: 'POST', body: JSON.stringify({ user_id: currentUserId, museum_id: museum.id }) });
        }
        await loadSubscriptions();
        renderMain();
        renderPassport();
        const filter = document.getElementById('showOnlySubscribedEvents');
        if (filter && filter.checked) renderEvents();
        showMuseumDetails(museum.id);
    });
    document.getElementById('detailVisitBtn')?.addEventListener('click', async () => {
        const btn = document.getElementById('detailVisitBtn');
        const currentlyVisited = btn.dataset.visited === 'true';
        await setVisit(museum.id, !currentlyVisited);
        renderMain();
        renderPassport();
        showMuseumDetails(museum.id);
    });
}

// Показать экспонаты
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
    modal.querySelector('.close').onclick = () => modal.classList.add('hidden');
}

// Рендер главной (карточки музеев с обложкой)
async function renderMain() {
    const container = document.getElementById('museums-list');
    if (!container) return;
    container.innerHTML = '';
    for (const m of museums) {
        // Получаем фото галереи (для fallback, если нет обложки)
        const photos = await getMuseumPhotos(m.id);
        const coverPhoto = m.cover_photo_url || (photos.length ? photos[0] : '');
        const isSubscribed = subscriptions.some(s => s.id === m.id);
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
            ${coverPhoto ? `<img src="${coverPhoto}" alt="фото музея" style="max-height:180px; object-fit:cover;">` : '<div style="height:120px; background:#f0e3d4; display:flex; align-items:center; justify-content:center;">Нет фото</div>'}
            <p>${escapeHtml(m.description || '').substring(0, 100)}${(m.description || '').length > 100 ? '...' : ''}</p>
            <p><i class="fas fa-map-marker-alt"></i> ${escapeHtml(m.address)}</p>
            <div>
                <button class="exhibits-btn" data-id="${m.id}"><i class="fas fa-search"></i> Экспонаты</button>
                <button class="subscribe-btn" data-id="${m.id}">${isSubscribed ? '<i class="fas fa-bell-slash"></i> Отписаться' : '<i class="fas fa-bell"></i> Подписаться'}</button>
                <button class="visit-btn" data-id="${m.id}" data-visited="${isVisited}">${isVisited ? '<i class="fas fa-check-circle"></i> Посещён' : '<i class="fas fa-circle"></i> Отметить посещение'}</button>
            </div>
        `;
        container.appendChild(card);
    }
    // Обработчики кнопок
    document.querySelectorAll('.exhibits-btn').forEach(btn => {
        btn.addEventListener('click', (e) => { e.stopPropagation(); showExhibits(parseInt(btn.dataset.id)); });
    });
    document.querySelectorAll('.subscribe-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const museumId = parseInt(btn.dataset.id);
            const isSub = subscriptions.some(s => s.id === museumId);
            if (isSub) {
                await api('/api/unsubscribe', { method: 'POST', body: JSON.stringify({ user_id: currentUserId, museum_id: museumId }) });
            } else {
                await api('/api/subscribe', { method: 'POST', body: JSON.stringify({ user_id: currentUserId, museum_id: museumId }) });
            }
            await loadSubscriptions();
            renderMain();
            renderPassport();
            const filter = document.getElementById('showOnlySubscribedEvents');
            if (filter && filter.checked) renderEvents();
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

// Яндекс.Карты (без изменений)
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
                balloonContentBody: `<p>${escapeHtml(m.address)}</p><button onclick="window.showExhibitsFromMap(${m.id})">Экспонаты</button>`
            });
            map.geoObjects.add(placemark);
        }
    });
}
window.showExhibitsFromMap = function(museumId) {
    showExhibits(museumId);
};

// Рендер событий (с фото)
async function renderEvents() {
    await loadEvents();
    const container = document.getElementById('events-list');
    if (!container) return;
    if (events.length) {
        container.innerHTML = events.map(ev => `
            <div class="card">
                ${ev.photo_url ? `<img src="${ev.photo_url}" style="max-height:150px; object-fit:cover; border-radius:20px;">` : ''}
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

// Паспорт: статистика + список подписок
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
        <div class="card">
            <h3><i class="fas fa-bell"></i> Мои подписки</h3>
            <div id="subscriptionsList"></div>
        </div>
    `;
    const subsDiv = document.getElementById('subscriptionsList');
    if (subscriptions.length) {
        subsDiv.innerHTML = subscriptions.map(sub => `
            <div style="display: flex; justify-content: space-between; align-items: center; margin: 8px 0;">
                <span>${escapeHtml(sub.name)}</span>
                <button class="unsubscribe-from-passport" data-id="${sub.id}" style="background: #c27e5c;">Отписаться</button>
            </div>
        `).join('');
        document.querySelectorAll('.unsubscribe-from-passport').forEach(btn => {
            btn.addEventListener('click', async () => {
                const museumId = parseInt(btn.dataset.id);
                await api('/api/unsubscribe', { method: 'POST', body: JSON.stringify({ user_id: currentUserId, museum_id: museumId }) });
                await loadSubscriptions();
                renderPassport();
                renderMain();
                const filter = document.getElementById('showOnlySubscribedEvents');
                if (filter && filter.checked) renderEvents();
            });
        });
    } else {
        subsDiv.innerHTML = '<p>Вы не подписаны ни на один музей.</p>';
    }
}

// ------------------- Админ-панель (добавлено поле cover_photo) -------------------
async function initAdmin() {
    const loginBtn = document.getElementById('adminLoginBtn');
    if (loginBtn) loginBtn.addEventListener('click', () => {
        const form = document.getElementById('adminLoginForm');
        if (form) form.classList.toggle('hidden');
    });
    const doLogin = document.getElementById('doAdminLogin');
    if (doLogin) {
        doLogin.addEventListener('click', async () => {
            const pwdInput = document.getElementById('adminPassword');
            if (pwdInput && pwdInput.value === 'admin123') {
                isAdmin = true;
                document.getElementById('adminControls').classList.remove('hidden');
                document.getElementById('adminLoginForm').classList.add('hidden');
                await loadAdminData();
            } else alert('Неверный пароль');
        });
    }
    document.getElementById('addMuseumBtn')?.addEventListener('click', () => showMuseumForm());
    document.getElementById('addExhibitBtn')?.addEventListener('click', () => showExhibitForm());
    document.getElementById('addEventBtn')?.addEventListener('click', () => showEventForm());
}

async function loadAdminData() {
    // Музеи
    const museumsData = await api('/api/admin/museums');
    const museumsDiv = document.getElementById('museumsAdminList');
    if (museumsDiv) {
        museumsDiv.innerHTML = museumsData.map(m => `
            <div class="admin-item">
                <span><strong>${escapeHtml(m.name)}</strong></span>
                <div>
                    <button class="edit-museum" data-id="${m.id}"><i class="fas fa-edit"></i></button>
                    <button class="photos-museum" data-id="${m.id}"><i class="fas fa-images"></i> Фото</button>
                    <button class="delete-museum" data-id="${m.id}"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `).join('');
        document.querySelectorAll('.edit-museum').forEach(btn => btn.addEventListener('click', () => showMuseumForm(parseInt(btn.dataset.id))));
        document.querySelectorAll('.photos-museum').forEach(btn => btn.addEventListener('click', () => manageMuseumPhotos(parseInt(btn.dataset.id))));
        document.querySelectorAll('.delete-museum').forEach(btn => btn.addEventListener('click', async () => {
            if (confirm('Удалить музей?')) {
                await api('/api/admin/museums', { method: 'DELETE', body: JSON.stringify({ id: parseInt(btn.dataset.id) }) });
                await loadAdminData();
                await loadMuseums();
                renderMain();
                renderPassport();
                if (window.ymaps && ymapsReady) initYandexMap();
            }
        }));
    }
    // Экспонаты
    const exhibitsData = await api('/api/admin/exhibits');
    const exhibitsDiv = document.getElementById('exhibitsAdminList');
    if (exhibitsDiv) {
        exhibitsDiv.innerHTML = exhibitsData.map(ex => `
            <div class="admin-item">
                <span><strong>${escapeHtml(ex.name)}</strong> (музей ${ex.museum_id})</span>
                <div>
                    <button class="edit-exhibit" data-id="${ex.id}"><i class="fas fa-edit"></i></button>
                    <button class="delete-exhibit" data-id="${ex.id}"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `).join('');
        document.querySelectorAll('.edit-exhibit').forEach(btn => btn.addEventListener('click', () => showExhibitForm(parseInt(btn.dataset.id))));
        document.querySelectorAll('.delete-exhibit').forEach(btn => btn.addEventListener('click', async () => {
            if (confirm('Удалить экспонат?')) {
                await api('/api/admin/exhibits', { method: 'DELETE', body: JSON.stringify({ id: parseInt(btn.dataset.id) }) });
                await loadAdminData();
            }
        }));
    }
    // События
    const eventsData = await api('/api/admin/events');
    const eventsDiv = document.getElementById('eventsAdminList');
    if (eventsDiv) {
        eventsDiv.innerHTML = eventsData.map(ev => `
            <div class="admin-item">
                <span><strong>${escapeHtml(ev.title)}</strong> (музей ${ev.museum_id})</span>
                <div>
                    <button class="edit-event" data-id="${ev.id}"><i class="fas fa-edit"></i></button>
                    <button class="delete-event" data-id="${ev.id}"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `).join('');
        document.querySelectorAll('.edit-event').forEach(btn => btn.addEventListener('click', () => showEventForm(parseInt(btn.dataset.id))));
        document.querySelectorAll('.delete-event').forEach(btn => btn.addEventListener('click', async () => {
            if (confirm('Удалить событие?')) {
                await api('/api/admin/events', { method: 'DELETE', body: JSON.stringify({ id: parseInt(btn.dataset.id) }) });
                await loadAdminData();
                renderEvents();
            }
        }));
    }
}

async function manageMuseumPhotos(museumId) {
    const photos = await api(`/api/admin/museum_photos/${museumId}`);
    let newUrl = prompt('Введите URL нового фото (или оставьте пустым для выхода):');
    if (newUrl) {
        await api(`/api/admin/museum_photos/${museumId}`, { method: 'POST', body: JSON.stringify({ photo_url: newUrl }) });
        alert('Фото добавлено');
    } else {
        if (photos.length) {
            let msg = 'Текущие фото:\n';
            photos.forEach((p, idx) => { msg += `${idx+1}. ${p.photo_url}\n`; });
            msg += '\nВведите номер фото для удаления или 0 для отмены:';
            let num = prompt(msg);
            if (num && !isNaN(num) && num > 0 && num <= photos.length) {
                const photoId = photos[num-1].id;
                await api(`/api/admin/museum_photos/${museumId}`, { method: 'DELETE', body: JSON.stringify({ photo_id: photoId }) });
                alert('Фото удалено');
            }
        } else {
            alert('Нет фото для удаления');
        }
    }
    await loadAdminData();
    await loadMuseums();
    renderMain();
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
    const coverPhoto = prompt('Ссылка на главное фото (обложка)', museum?.cover_photo_url || '');
    const data = { name, address, lat, lng, description: desc, contacts, website, cover_photo: coverPhoto };
    if (id) {
        data.id = id;
        api('/api/admin/museums', { method: 'PUT', body: JSON.stringify(data) }).then(() => {
            loadAdminData();
            loadMuseums().then(() => { renderMain(); renderPassport(); if(window.ymaps) initYandexMap(); });
        });
    } else {
        api('/api/admin/museums', { method: 'POST', body: JSON.stringify(data) }).then(() => {
            loadAdminData();
            loadMuseums().then(() => { renderMain(); renderPassport(); if(window.ymaps) initYandexMap(); });
        });
    }
}

function showExhibitForm(id = null) {
    const museumId = prompt('ID музея (посмотрите в админке список музеев)');
    if (!museumId) return;
    const name = prompt('Название экспоната');
    if (!name) return;
    const desc = prompt('Описание');
    const photoUrl = prompt('Фото URL');
    const data = { museum_id: parseInt(museumId), name, description: desc, photo_url: photoUrl };
    if (id) {
        data.id = id;
        api('/api/admin/exhibits', { method: 'PUT', body: JSON.stringify(data) }).then(() => loadAdminData());
    } else {
        api('/api/admin/exhibits', { method: 'POST', body: JSON.stringify(data) }).then(() => loadAdminData());
    }
}

function showEventForm(id = null) {
    const museumId = prompt('ID музея');
    if (!museumId) return;
    const title = prompt('Название события');
    if (!title) return;
    const date = prompt('Дата (YYYY-MM-DD)');
    const desc = prompt('Описание');
    const photoUrl = prompt('Фото URL');
    const data = { museum_id: parseInt(museumId), title, date, description: desc, photo_url: photoUrl };
    if (id) {
        data.id = id;
        api('/api/admin/events', { method: 'PUT', body: JSON.stringify(data) }).then(() => { loadAdminData(); renderEvents(); });
    } else {
        api('/api/admin/events', { method: 'POST', body: JSON.stringify(data) }).then(() => { loadAdminData(); renderEvents(); });
    }
}

// Вспомогательные функции
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tab = btn.dataset.tab;
            document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
            const activePane = document.getElementById(`${tab}-tab`);
            if (activePane) activePane.classList.add('active');
            if (tab === 'map' && window.ymaps) setTimeout(() => window.ymaps.geolocation, 100);
            if (tab === 'events') renderEvents();
            if (tab === 'passport') renderPassport();
        });
    });
}

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
    if (filterCheckbox) filterCheckbox.addEventListener('change', () => renderEvents());
    if (typeof ymaps !== 'undefined') {
        ymaps.ready(() => { ymapsReady = true; initYandexMap(); });
    }
});
