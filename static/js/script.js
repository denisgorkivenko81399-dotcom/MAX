// Глобальные переменные
let currentUserId = null;
let isAdmin = false;
let museums = [];
let events = [];
let subscriptions = [];   // массив объектов {id, name}
let visits = [];
let ymapsReady = false;
let museumPhotosCache = {}; // кэш фото для каждого музея

// Переменные для календаря
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth() + 1; // 1-12
let selectedDate = getTodayDate(); // строка YYYY-MM-DD

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

// Получение фотографий галереи с кэшированием
async function getMuseumPhotos(museumId) {
    if (museumPhotosCache[museumId]) return museumPhotosCache[museumId];
    const photos = await api(`/api/museum_photos/${museumId}`);
    museumPhotosCache[museumId] = photos;
    return photos;
}

// Предзагрузка фото для всех музеев
async function preloadAllPhotos() {
    const promises = museums.map(m => getMuseumPhotos(m.id));
    await Promise.all(promises);
}

// Показать детальную карточку музея с маршрутом, отзывами и кнопками поделиться
async function showMuseumDetails(museumId) {
    const museum = museums.find(m => m.id === museumId);
    if (!museum) return;
    const photos = await getMuseumPhotos(museumId);
    const isSubscribed = subscriptions.some(s => s.id === museum.id);
    const isVisited = visits.some(v => v.museum_id === museum.id && v.visited === 1);
    const routeLink = `https://yandex.ru/maps/?rtext=~${museum.lat},${museum.lng}&rtt=auto`;
    
    const modal = document.getElementById('museumModal');
    const container = document.getElementById('museumDetailContent');
    if (!modal || !container) return;
    
    // Получаем отзывы и рейтинг
    const reviews = await api(`/api/museum/${museum.id}/reviews`);
    const ratingData = await api(`/api/museum/${museum.id}/rating`);
    const avgRating = ratingData.average || 0;
    
    // Формируем блок отзывов
    let reviewsHtml = `<div class="reviews-section">
        <h4>Отзывы (средний рейтинг: ${avgRating.toFixed(1)} ⭐)</h4>
        <div id="reviews-list">`;
    if (reviews.length) {
        reviews.forEach(r => {
            const name = r.user_name || 'Аноним';
            reviewsHtml += `
                <div class="review-item">
                    <strong>${escapeHtml(name)}</strong> (${r.rating}⭐)
                    <p>${escapeHtml(r.text || '')}</p>
                    <small>${r.created_at}</small>
                </div>
            `;
        });
    } else {
        reviewsHtml += '<p>Пока нет отзывов. Будьте первым!</p>';
    }
    reviewsHtml += `</div>
        <button id="write-review-btn" class="review-btn">Написать отзыв</button>
    </div>`;
    
    // Формируем HTML
    let coverHtml = '';
    if (museum.cover_photo_url) {
        coverHtml = `<img src="${museum.cover_photo_url}" class="museum-cover" alt="обложка">`;
    } else if (photos.length) {
        coverHtml = `<img src="${photos[0]}" class="museum-cover" alt="обложка">`;
    } else {
        coverHtml = `<div style="background: #f0e3d4; height:200px; display:flex; align-items:center; justify-content:center; border-radius:20px; margin:10px 0;">Нет фото</div>`;
    }
    
    let galleryHtml = '';
    if (photos.length) {
        galleryHtml = `<div style="display: flex; overflow-x: auto; gap: 10px; margin: 10px 0;">
            ${photos.map(p => `<img src="${p}" style="height: 120px; object-fit: cover; border-radius: 12px;">`).join('')}
        </div>`;
    }
    
    // Кнопки поделиться
    const shareButtons = `
        <div class="share-buttons" style="margin-top: 15px;">
            <button id="share-vk"><i class="fab fa-vk"></i> ВКонтакте</button>
            <button id="share-max"><i class="fas fa-share-alt"></i> МАХ</button>
            <button id="share-ok"><i class="fab fa-odnoklassniki"></i> Одноклассники</button>
            <button id="copy-link"><i class="fas fa-copy"></i> Копировать ссылку</button>
        </div>
    `;
    
    container.innerHTML = `
        <h2>${escapeHtml(museum.name)}</h2>
        ${coverHtml}
        ${galleryHtml}
        <p><i class="fas fa-map-marker-alt"></i> <strong>Адрес:</strong> ${escapeHtml(museum.address)}</p>
        <p><i class="fas fa-info-circle"></i> <strong>Описание:</strong><br>${escapeHtml(museum.description || '')}</p>
        <p><i class="fas fa-phone"></i> <strong>Контакты:</strong> ${escapeHtml(museum.contacts || 'не указаны')}</p>
        ${museum.website ? `<p><i class="fas fa-globe"></i> <strong>Сайт:</strong> <a href="${museum.website}" target="_blank">${escapeHtml(museum.website)}</a></p>` : ''}
        ${museum.pushkin_card === 'да' ? '<p><i class="fas fa-id-card"></i> <strong>Пушкинская карта:</strong> доступно</p>' : ''}
        <p><i class="fas fa-directions"></i> <strong>Как добраться:</strong> <a href="${routeLink}" target="_blank" style="color:#7b4a2e;">Проложить маршрут в Яндекс.Картах</a></p>
        <hr>
        <div style="display: flex; flex-wrap: wrap; gap: 10px; margin-top: 15px;">
            <button id="detailExhibitsBtn" data-id="${museum.id}"><i class="fas fa-search"></i> Экспонаты</button>
            <button id="detailSubscribeBtn" data-id="${museum.id}">${isSubscribed ? '<i class="fas fa-bell-slash"></i> Отписаться' : '<i class="fas fa-bell"></i> Подписаться'}</button>
            <button id="detailVisitBtn" data-id="${museum.id}" data-visited="${isVisited}">${isVisited ? '<i class="fas fa-check-circle"></i> Посещён' : '<i class="fas fa-circle"></i> Отметить посещение'}</button>
        </div>
        ${shareButtons}
        <hr>
        ${reviewsHtml}
    `;
    
    modal.classList.remove('hidden');
    const closeSpan = modal.querySelector('.close');
    if (closeSpan) closeSpan.onclick = () => modal.classList.add('hidden');
    
    // --- Обработчики кнопок ---
    // Экспонаты
    document.getElementById('detailExhibitsBtn')?.addEventListener('click', () => {
        modal.classList.add('hidden');
        showExhibits(museum.id);
    });
    
    // Подписка
    document.getElementById('detailSubscribeBtn')?.addEventListener('click', async () => {
        const isSub = subscriptions.some(s => s.id === museum.id);
        if (isSub) {
            await api('/api/unsubscribe', { method: 'POST', body: JSON.stringify({ user_id: currentUserId, museum_id: museum.id }) });
            subscriptions = subscriptions.filter(s => s.id !== museum.id);
        } else {
            await api('/api/subscribe', { method: 'POST', body: JSON.stringify({ user_id: currentUserId, museum_id: museum.id }) });
            subscriptions.push({ id: museum.id, name: museum.name });
        }
        const subBtn = document.getElementById('detailSubscribeBtn');
        if (subBtn) {
            const isNowSub = subscriptions.some(s => s.id === museum.id);
            subBtn.innerHTML = isNowSub ? '<i class="fas fa-bell-slash"></i> Отписаться' : '<i class="fas fa-bell"></i> Подписаться';
        }
        const mainCardSubscribeBtn = document.querySelector(`.subscribe-btn[data-id="${museum.id}"]`);
        if (mainCardSubscribeBtn) {
            const isNowSub = subscriptions.some(s => s.id === museum.id);
            mainCardSubscribeBtn.innerHTML = isNowSub ? '<i class="fas fa-bell-slash"></i> Отписаться' : '<i class="fas fa-bell"></i> Подписаться';
        }
        renderPassport();
        const filter = document.getElementById('showOnlySubscribedEvents');
        if (filter && filter.checked) renderEvents();
        renderCalendar(currentYear, currentMonth); // обновить календарь (подписки влияют на события)
    });
    
    // Отметка посещения
    document.getElementById('detailVisitBtn')?.addEventListener('click', async () => {
        const btn = document.getElementById('detailVisitBtn');
        const currentlyVisited = btn.dataset.visited === 'true';
        await setVisit(museum.id, !currentlyVisited);
        const newVisited = !currentlyVisited;
        btn.dataset.visited = newVisited;
        btn.innerHTML = newVisited ? '<i class="fas fa-check-circle"></i> Посещён' : '<i class="fas fa-circle"></i> Отметить посещение';
        const mainCardVisitBtn = document.querySelector(`.visit-btn[data-id="${museum.id}"]`);
        if (mainCardVisitBtn) {
            mainCardVisitBtn.dataset.visited = newVisited;
            mainCardVisitBtn.innerHTML = newVisited ? '<i class="fas fa-check-circle"></i> Посещён' : '<i class="fas fa-circle"></i> Отметить посещение';
        }
        renderPassport();
    });
    
    // --- Обработчики кнопок "Поделиться" ---
    document.getElementById('share-vk')?.addEventListener('click', () => {
        const url = encodeURIComponent(window.location.origin + '/?museum=' + museum.id);
        const text = encodeURIComponent(`Я нашёл интересный музей "${museum.name}" в Ставропольском крае! Посмотрите экспонаты и запланируйте визит:`);
        window.open(`https://vk.com/share.php?url=${url}&title=${text}`, '_blank');
    });
    document.getElementById('share-max')?.addEventListener('click', () => {
        copyShareLink(museum.id);
    });
    document.getElementById('share-ok')?.addEventListener('click', () => {
        const url = encodeURIComponent(window.location.origin + '/?museum=' + museum.id);
        window.open(`https://connect.ok.ru/dk?st.cmd=WidgetShare&st.shareUrl=${url}`, '_blank');
    });
    document.getElementById('copy-link')?.addEventListener('click', () => {
        copyShareLink(museum.id);
    });
    
    // --- Обработчик кнопки "Написать отзыв" ---
    document.getElementById('write-review-btn')?.addEventListener('click', () => {
        const rating = prompt('Оцените музей (1-5 звёзд):');
        if (rating && rating >= 1 && rating <= 5) {
            const text = prompt('Ваш комментарий (необязательно):');
            const name = prompt('Ваше имя (или оставьте пустым для анонима):') || null;
            api('/api/reviews/add', {
                method: 'POST',
                body: JSON.stringify({
                    museum_id: museum.id,
                    user_id: currentUserId,
                    rating: parseInt(rating),
                    text: text,
                    user_name: name
                })
            }).then(() => {
                alert('Спасибо за отзыв!');
                showMuseumDetails(museum.id); // обновить модалку
            }).catch(() => alert('Вы уже оставили отзыв!'));
        }
    });
}

// Функция копирования ссылки для поделиться
function copyShareLink(museumId) {
    const url = window.location.origin + '/?museum=' + museumId;
    navigator.clipboard.writeText(url);
    alert('Ссылка скопирована в буфер обмена!');
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
                ${ex.subject ? `<p><strong>Тема:</strong> ${escapeHtml(ex.subject)}</p>` : ''}
            </div>
        `).join('');
    } else {
        container.innerHTML = '<p>Экспонатов пока нет.</p>';
    }
    modal.classList.remove('hidden');
    modal.querySelector('.close').onclick = () => modal.classList.add('hidden');
}

// Рендер главной
async function renderMain() {
    const container = document.getElementById('museums-list');
    if (!container) return;
    container.innerHTML = '';
    for (const m of museums) {
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
            ${m.pushkin_card === 'да' ? '<p><i class="fas fa-id-card"></i> <strong>Пушкинская карта</strong> ✓</p>' : ''}
            <div>
                <button class="exhibits-btn" data-id="${m.id}"><i class="fas fa-search"></i> Экспонаты</button>
                <button class="subscribe-btn" data-id="${m.id}">${isSubscribed ? '<i class="fas fa-bell-slash"></i> Отписаться' : '<i class="fas fa-bell"></i> Подписаться'}</button>
                <button class="visit-btn" data-id="${m.id}" data-visited="${isVisited}">${isVisited ? '<i class="fas fa-check-circle"></i> Посещён' : '<i class="fas fa-circle"></i> Отметить посещение'}</button>
            </div>
        `;
        container.appendChild(card);
    }
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
                subscriptions = subscriptions.filter(s => s.id !== museumId);
                btn.innerHTML = '<i class="fas fa-bell"></i> Подписаться';
            } else {
                await api('/api/subscribe', { method: 'POST', body: JSON.stringify({ user_id: currentUserId, museum_id: museumId }) });
                const museum = museums.find(m => m.id === museumId);
                subscriptions.push({ id: museumId, name: museum.name });
                btn.innerHTML = '<i class="fas fa-bell-slash"></i> Отписаться';
            }
            renderPassport();
            const filter = document.getElementById('showOnlySubscribedEvents');
            if (filter && filter.checked) renderEvents();
            renderCalendar(currentYear, currentMonth);
        });
    });
    document.querySelectorAll('.visit-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const museumId = parseInt(btn.dataset.id);
            const currentlyVisited = btn.dataset.visited === 'true';
            await setVisit(museumId, !currentlyVisited);
            const newVisited = !currentlyVisited;
            btn.dataset.visited = newVisited;
            btn.innerHTML = newVisited ? '<i class="fas fa-check-circle"></i> Посещён' : '<i class="fas fa-circle"></i> Отметить посещение';
            renderPassport();
        });
    });
}

// Яндекс.Карты с маршрутом в балуне
function initYandexMap() {
    if (!ymapsReady || !window.ymaps) return;
    const map = new ymaps.Map('map', {
        center: [45.04, 41.97],
        zoom: 8,
        controls: ['zoomControl', 'fullscreenControl']
    });
    museums.forEach(m => {
        if (m.lat && m.lng) {
            const routeLink = `https://yandex.ru/maps/?rtext=~${m.lat},${m.lng}&rtt=auto`;
            const placemark = new ymaps.Placemark([m.lat, m.lng], {
                balloonContentHeader: `<b>${escapeHtml(m.name)}</b>`,
                balloonContentBody: `<p>${escapeHtml(m.address)}</p>
                                     <a href="${routeLink}" target="_blank">🚗 Проложить маршрут</a><br>
                                     <button onclick="window.showExhibitsFromMap(${m.id})">Экспонаты</button>`
            });
            map.geoObjects.add(placemark);
        }
    });
}
window.showExhibitsFromMap = function(museumId) {
    showExhibits(museumId);
};

// ------------------- КАЛЕНДАРЬ СОБЫТИЙ -------------------
function getTodayDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

async function renderCalendar(year, month) {
    const container = document.getElementById('calendar-grid');
    if (!container) return;
    // Загружаем события за месяц
    const monthEvents = await api(`/api/events/month?year=${year}&month=${month}`);
    // Строим календарь
    const firstDay = new Date(year, month-1, 1).getDay(); // 0-6 (воскресенье-суббота)
    const daysInMonth = new Date(year, month, 0).getDate();
    let html = `<div class="calendar-header">
                  <button id="prevMonth"><i class="fas fa-chevron-left"></i></button>
                  <span>${month}.${year}</span>
                  <button id="nextMonth"><i class="fas fa-chevron-right"></i></button>
                </div>
                <table class="calendar-table">
                  <tr><th>Пн</th><th>Вт</th><th>Ср</th><th>Чт</th><th>Пт</th><th>Сб</th><th>Вс</th></tr><tr>`;
    // Смещение для понедельника как первого дня
    let startOffset = (firstDay === 0) ? 6 : firstDay - 1;
    for (let i = 0; i < startOffset; i++) {
        html += '<td></td>';
    }
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const hasEvent = monthEvents.some(e => e.date === dateStr);
        const isToday = (dateStr === getTodayDate());
        html += `<td data-date="${dateStr}" class="${hasEvent ? 'has-event' : ''} ${isToday ? 'today' : ''}">${d}</td>`;
        if ((d + startOffset) % 7 === 0 && d < daysInMonth) {
            html += '</tr><tr>';
        }
    }
    html += '</tr></table>';
    container.innerHTML = html;

    // Обработчики переключения месяцев
    document.getElementById('prevMonth').addEventListener('click', () => {
        if (currentMonth === 1) { currentMonth = 12; currentYear--; } else { currentMonth--; }
        renderCalendar(currentYear, currentMonth);
        // Загружаем события для сохранённой даты (если она есть в этом месяце, иначе сбрасываем на сегодня)
        const selectedDateObj = new Date(selectedDate);
        if (selectedDateObj.getFullYear() === currentYear && selectedDateObj.getMonth()+1 === currentMonth) {
            loadEventsForDate(selectedDate);
        } else {
            selectedDate = getTodayDate();
            loadEventsForDate(selectedDate);
        }
    });
    document.getElementById('nextMonth').addEventListener('click', () => {
        if (currentMonth === 12) { currentMonth = 1; currentYear++; } else { currentMonth++; }
        renderCalendar(currentYear, currentMonth);
        const selectedDateObj = new Date(selectedDate);
        if (selectedDateObj.getFullYear() === currentYear && selectedDateObj.getMonth()+1 === currentMonth) {
            loadEventsForDate(selectedDate);
        } else {
            selectedDate = getTodayDate();
            loadEventsForDate(selectedDate);
        }
    });

    // При клике на дату загружаем события для этой даты
    document.querySelectorAll('.calendar-table td[data-date]').forEach(td => {
        td.addEventListener('click', () => {
            const date = td.dataset.date;
            selectedDate = date;
            loadEventsForDate(date);
        });
    });

    // Загружаем события для выбранной даты (по умолчанию сегодня)
    if (!selectedDate) {
        selectedDate = getTodayDate();
    }
    loadEventsForDate(selectedDate);
}

async function loadEventsForDate(date) {
    const container = document.getElementById('events-by-date');
    if (!container) return;
    const eventsForDate = await api(`/api/events/date?date=${date}`);
    // Также получаем список сохранённых событий пользователя
    const userEvents = await api(`/api/user/events?user_id=${currentUserId}`);
    const userEventIds = userEvents.map(e => e.id);
    
    if (eventsForDate.length === 0) {
        container.innerHTML = '<p>На эту дату событий нет.</p>';
        return;
    }
    let html = '';
    for (const ev of eventsForDate) {
        const isAdded = userEventIds.includes(ev.id);
        html += `
            <div class="event-card">
                <h4>${escapeHtml(ev.title)}</h4>
                <p>${escapeHtml(ev.museum_name)} | ${ev.time ? escapeHtml(ev.time) : 'время не указано'}</p>
                <p>${escapeHtml(ev.description || '')}</p>
                <button class="add-event-btn" data-event-id="${ev.id}" ${isAdded ? 'disabled' : ''}>
                    ${isAdded ? 'Уже добавлено' : 'Напомнить'}
                </button>
            </div>
        `;
    }
    container.innerHTML = html;
    // Обработчики кнопок "Напомнить"
    document.querySelectorAll('.add-event-btn:not([disabled])').forEach(btn => {
        btn.addEventListener('click', async () => {
            const eventId = parseInt(btn.dataset.eventId);
            try {
                await api('/api/user/events/add', {
                    method: 'POST',
                    body: JSON.stringify({ user_id: currentUserId, event_id: eventId })
                });
                btn.disabled = true;
                btn.textContent = 'Уже добавлено';
                renderPassport(); // обновить паспорт (раздел "Мои события")
            } catch (e) {
                alert('Не удалось добавить событие. Возможно, оно уже в списке.');
            }
        });
    });
}

// ------------------- ОБРАЗОВАТЕЛЬНЫЙ МОДУЛЬ -------------------
async function renderEducational() {
    const container = document.getElementById('educational-content');
    if (!container) return;
    // Получаем все экспонаты и уникальные темы
    const allExhibits = await api('/api/exhibits');
    const subjects = [...new Set(allExhibits.map(e => e.subject).filter(Boolean))];
    let html = `<h3>Выберите тему:</h3>
                <select id="subject-select">
                    <option value="">Все темы</option>
                    ${subjects.map(s => `<option value="${s}">${escapeHtml(s)}</option>`).join('')}
                </select>
                <div id="exhibits-by-subject"></div>
                <h3>Мои экскурсии</h3>
                <button id="create-excursion-btn" class="primary-btn"><i class="fas fa-plus"></i> Создать новую экскурсию</button>
                <div id="my-excursions-list"></div>`;
    container.innerHTML = html;

    // Обработчик выбора темы
    document.getElementById('subject-select').addEventListener('change', async (e) => {
        const subject = e.target.value;
        const list = await api(`/api/exhibits/subject?subject=${subject}`);
        const div = document.getElementById('exhibits-by-subject');
        if (list.length === 0) {
            div.innerHTML = '<p>Экспонатов по этой теме пока нет.</p>';
            return;
        }
        // Получаем экскурсии пользователя для выбора
        const userExcursions = await api(`/api/user/excursions?user_id=${currentUserId}`);
        div.innerHTML = list.map(ex => `
            <div class="exhibit-item">
                <span><strong>${escapeHtml(ex.name)}</strong> (музей ${ex.museum_id})</span>
                ${ex.subject ? `<span class="subject-tag">${escapeHtml(ex.subject)}</span>` : ''}
                <button class="add-to-excursion-btn" data-exhibit-id="${ex.id}">Добавить в экскурсию</button>
            </div>
        `).join('');
        // Обработчики кнопок "Добавить в экскурсию"
        document.querySelectorAll('.add-to-excursion-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const exhibitId = parseInt(btn.dataset.exhibitId);
                // Проверяем, есть ли у пользователя экскурсии
                const userExcursions = await api(`/api/user/excursions?user_id=${currentUserId}`);
                if (userExcursions.length === 0) {
                    const create = confirm('У вас ещё нет экскурсий. Создать новую?');
                    if (create) {
                        const name = prompt('Введите название экскурсии:');
                        if (name) {
                            const newEx = await api('/api/excursions/create', {
                                method: 'POST',
                                body: JSON.stringify({ user_id: currentUserId, name })
                            });
                            // Добавляем экспонат в новую экскурсию
                            await api('/api/excursions/add_item', {
                                method: 'POST',
                                body: JSON.stringify({ excursion_id: newEx.id, exhibit_id: exhibitId })
                            });
                            alert('Экспонат добавлен в новую экскурсию!');
                            renderEducational(); // обновить раздел
                        }
                    }
                    return;
                }
                // Если есть экскурсии, показываем список для выбора
                const names = userExcursions.map(e => `${e.id}: ${e.name}`).join('\n');
                const choice = prompt(`Введите ID экскурсии, куда добавить экспонат:\n${names}`);
                if (choice) {
                    const excursionId = parseInt(choice);
                    const excursion = userExcursions.find(e => e.id === excursionId);
                    if (!excursion) {
                        alert('Неверный ID');
                        return;
                    }
                    await api('/api/excursions/add_item', {
                        method: 'POST',
                        body: JSON.stringify({ excursion_id: excursionId, exhibit_id: exhibitId })
                    });
                    alert('Экспонат добавлен в экскурсию!');
                    renderEducational(); // обновить список экскурсий
                }
            });
        });
    });

    // Загрузка моих экскурсий
    await renderExcursionList();

    // Кнопка создания новой экскурсии
    document.getElementById('create-excursion-btn').addEventListener('click', async () => {
        const name = prompt('Введите название экскурсии:');
        if (name) {
            await api('/api/excursions/create', {
                method: 'POST',
                body: JSON.stringify({ user_id: currentUserId, name })
            });
            renderEducational();
        }
    });
}

async function renderExcursionList() {
    const container = document.getElementById('my-excursions-list');
    if (!container) return;
    const myExcursions = await api(`/api/user/excursions?user_id=${currentUserId}`);
    if (myExcursions.length === 0) {
        container.innerHTML = '<p>У вас пока нет экскурсий. Создайте первую!</p>';
        return;
    }
    let html = '';
    for (const ex of myExcursions) {
        const items = await api(`/api/excursions/${ex.id}`);
        html += `
            <div class="excursion-card">
                <h4>${escapeHtml(ex.name)}</h4>
                <p>Количество экспонатов: ${items.length}</p>
                <p>Создана: ${ex.created_at}</p>
                <button class="view-excursion-btn" data-excursion-id="${ex.id}">Посмотреть</button>
                <button class="share-excursion-btn" data-excursion-id="${ex.id}">Поделиться</button>
            </div>
        `;
    }
    container.innerHTML = html;

    document.querySelectorAll('.view-excursion-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = parseInt(btn.dataset.excursionId);
            const items = await api(`/api/excursions/${id}`);
            if (items.length === 0) {
                alert('В этой экскурсии пока нет экспонатов.');
                return;
            }
            const names = items.map((item, idx) => `${idx+1}. ${item.name} (${item.description || 'без описания'})`).join('\n');
            alert(`Экспонаты в экскурсии:\n${names}`);
        });
    });

    document.querySelectorAll('.share-excursion-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = parseInt(btn.dataset.excursionId);
            const data = await api(`/api/excursions/${id}/share`);
            const url = window.location.origin + data.url;
            navigator.clipboard.writeText(url);
            alert('Ссылка на экскурсию скопирована в буфер обмена!');
        });
    });
}

// ------------------- РЕНДЕР СОБЫТИЙ (обновлён) -------------------
async function renderEvents() {
    await loadEvents();
    const container = document.getElementById('events-list');
    if (!container) return;
    if (events.length) {
        container.innerHTML = events.map(ev => `
            <div class="card">
                ${ev.photo_url ? `<img src="${ev.photo_url}" style="max-height:150px; object-fit:cover; border-radius:20px;">` : ''}
                <h3>${escapeHtml(ev.title)}</h3>
                <p><i class="fas fa-calendar-day"></i> ${ev.date || 'Дата не указана'} ${ev.time ? 'в ' + escapeHtml(ev.time) : ''}</p>
                <p><i class="fas fa-landmark"></i> ${escapeHtml(ev.museum_name)}</p>
                <p>${escapeHtml(ev.description || '')}</p>
            </div>
        `).join('');
    } else {
        container.innerHTML = '<p>Событий пока нет.</p>';
    }
}

// ------------------- РЕНДЕР ПАСПОРТА (обновлён) -------------------
async function renderPassport() {
    await loadVisits();
    const total = museums.length;
    const visitedCount = visits.filter(v => v.visited === 1).length;
    const percent = total ? (visitedCount / total * 100) : 0;
    const container = document.getElementById('passport-info');
    if (!container) return;
    
    // Получаем список сохранённых событий пользователя
    const userEvents = await api(`/api/user/events?user_id=${currentUserId}`);
    
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
        <div class="card">
            <h3><i class="fas fa-calendar-check"></i> Мои события (напоминания)</h3>
            <div id="user-events-list">
                ${userEvents.length ? userEvents.map(ev => `
                    <div class="user-event-item">
                        <strong>${escapeHtml(ev.title)}</strong> – ${escapeHtml(ev.museum_name)} (${ev.date} ${ev.time || ''})
                    </div>
                `).join('') : '<p>Вы пока не добавили ни одного события.</p>'}
            </div>
        </div>
        <div class="card">
            <h3><i class="fas fa-graduation-cap"></i> Мои экскурсии</h3>
            <div id="passport-excursions-list"></div>
        </div>
    `;
    
    // Список подписок (как было)
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
                subscriptions = subscriptions.filter(s => s.id !== museumId);
                renderPassport();
                const mainCardSubscribeBtn = document.querySelector(`.subscribe-btn[data-id="${museumId}"]`);
                if (mainCardSubscribeBtn) {
                    mainCardSubscribeBtn.innerHTML = '<i class="fas fa-bell"></i> Подписаться';
                }
                const filter = document.getElementById('showOnlySubscribedEvents');
                if (filter && filter.checked) renderEvents();
                renderCalendar(currentYear, currentMonth);
            });
        });
    } else {
        subsDiv.innerHTML = '<p>Вы не подписаны ни на один музей.</p>';
    }

    // Список экскурсий в паспорте (коротко)
    const excursionsDiv = document.getElementById('passport-excursions-list');
    const myExcursions = await api(`/api/user/excursions?user_id=${currentUserId}`);
    if (myExcursions.length) {
        excursionsDiv.innerHTML = myExcursions.map(ex => `
            <div style="margin: 5px 0;">
                <strong>${escapeHtml(ex.name)}</strong> (${ex.created_at.slice(0,10)})
            </div>
        `).join('');
    } else {
        excursionsDiv.innerHTML = '<p>У вас пока нет экскурсий.</p>';
    }
}

// ------------------- АДМИН-ПАНЕЛЬ (существующая, без изменений) -------------------
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
                museumPhotosCache = {};
                await preloadAllPhotos();
                renderMain();
                renderPassport();
                if (window.ymaps && ymapsReady) initYandexMap();
            }
        }));
    }
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
                renderCalendar(currentYear, currentMonth);
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
        delete museumPhotosCache[museumId];
        await getMuseumPhotos(museumId);
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
                delete museumPhotosCache[museumId];
                await getMuseumPhotos(museumId);
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
    const pushkinCard = prompt('Посещение по Пушкинской карте? (да/нет)', museum?.pushkin_card || 'нет');
    const data = { name, address, lat, lng, description: desc, contacts, website, cover_photo: coverPhoto, pushkin_card: pushkinCard };
    if (id) {
        data.id = id;
        api('/api/admin/museums', { method: 'PUT', body: JSON.stringify(data) }).then(() => {
            loadAdminData();
            loadMuseums().then(async () => {
                museumPhotosCache = {};
                await preloadAllPhotos();
                renderMain();
                renderPassport();
                if(window.ymaps) initYandexMap();
            });
        });
    } else {
        api('/api/admin/museums', { method: 'POST', body: JSON.stringify(data) }).then(() => {
            loadAdminData();
            loadMuseums().then(async () => {
                museumPhotosCache = {};
                await preloadAllPhotos();
                renderMain();
                renderPassport();
                if(window.ymaps) initYandexMap();
            });
        });
    }
}

async function selectMuseumFromList() {
    const museumsList = await api('/api/museums');
    let message = "Список музеев:\n";
    museumsList.forEach(m => {
        message += `${m.id} - ${m.name}\n`;
    });
    message += "\nВведите ID музея:";
    const id = prompt(message);
    if (id && !isNaN(parseInt(id))) {
        return parseInt(id);
    } else {
        alert("Неверный ID");
        return null;
    }
}

async function showExhibitForm(id = null) {
    let museumId;
    if (id === null) {
        museumId = await selectMuseumFromList();
        if (!museumId) return;
    } else {
        museumId = await selectMuseumFromList();
        if (!museumId) return;
    }
    const name = prompt('Название экспоната');
    if (!name) return;
    const desc = prompt('Описание');
    const photoUrl = prompt('Фото URL');
    const subject = prompt('Учебная тема (например, История, Краеведение, Литература и т.п.)');
    const data = { museum_id: museumId, name, description: desc, photo_url: photoUrl, subject: subject || '' };
    if (id) {
        data.id = id;
        await api('/api/admin/exhibits', { method: 'PUT', body: JSON.stringify(data) });
    } else {
        await api('/api/admin/exhibits', { method: 'POST', body: JSON.stringify(data) });
    }
    await loadAdminData();
}

async function showEventForm(id = null) {
    let museumId;
    if (id === null) {
        museumId = await selectMuseumFromList();
        if (!museumId) return;
    } else {
        museumId = await selectMuseumFromList();
        if (!museumId) return;
    }
    const title = prompt('Название события');
    if (!title) return;
    const date = prompt('Дата (YYYY-MM-DD)');
    const time = prompt('Время (HH:MM)');
    const desc = prompt('Описание');
    const photoUrl = prompt('Фото URL');
    const data = { museum_id: museumId, title, date, time: time || '', description: desc, photo_url: photoUrl };
    if (id) {
        data.id = id;
        await api('/api/admin/events', { method: 'PUT', body: JSON.stringify(data) });
    } else {
        await api('/api/admin/events', { method: 'POST', body: JSON.stringify(data) });
    }
    await loadAdminData();
    await renderEvents();
    renderCalendar(currentYear, currentMonth);
}

// Вспомогательная функция
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// Переключение вкладок (обновлено)
function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tab = btn.dataset.tab;
            document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
            const activePane = document.getElementById(`${tab}-tab`);
            if (activePane) activePane.classList.add('active');
            // Действия при переключении
            if (tab === 'map' && window.ymaps) setTimeout(() => window.ymaps.geolocation, 100);
            if (tab === 'events') {
                renderEvents();
                renderCalendar(currentYear, currentMonth);
            }
            if (tab === 'passport') renderPassport();
            if (tab === 'educational') renderEducational();
        });
    });
}

// Инициализация
window.addEventListener('DOMContentLoaded', async () => {
    currentUserId = getUserId();
    await loadMuseums();
    await loadSubscriptions();
    await loadVisits();
    await preloadAllPhotos();
    renderMain();
    renderPassport();
    initTabs();
    initAdmin();
    
    const filterCheckbox = document.getElementById('showOnlySubscribedEvents');
    if (filterCheckbox) filterCheckbox.addEventListener('change', () => {
        renderEvents();
        renderCalendar(currentYear, currentMonth);
    });
    
    if (typeof ymaps !== 'undefined') {
        ymaps.ready(() => { ymapsReady = true; initYandexMap(); });
    }
    
    // Если в URL есть параметр museum, открыть модалку с этим музеем
    const urlParams = new URLSearchParams(window.location.search);
    const museumId = urlParams.get('museum');
    if (museumId) {
        setTimeout(() => showMuseumDetails(parseInt(museumId)), 500);
    }
});
