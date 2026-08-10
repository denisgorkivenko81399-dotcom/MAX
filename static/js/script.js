// Глобальные переменные
let currentUserId = null;
let museums = [];
let events = [];
let subscriptions = [];   // массив объектов {id, name}
let visits = [];
let ymapsReady = false;
let museumPhotosCache = {};
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth() + 1;
let selectedDate = null;
let favorites = []; // массив ID избранных экспонатов
let allExhibits = []; // для фильтрации

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

// Фото
async function getMuseumPhotos(museumId) {
    if (museumPhotosCache[museumId]) return museumPhotosCache[museumId];
    const photos = await api(`/api/museum_photos/${museumId}`);
    museumPhotosCache[museumId] = photos;
    return photos;
}

// Предзагрузка фото
async function preloadAllPhotos() {
    const promises = museums.map(m => getMuseumPhotos(m.id));
    await Promise.all(promises);
}

// Избранное
async function loadFavorites() {
    favorites = await api(`/api/favorites?user_id=${currentUserId}`);
    return favorites;
}
async function toggleFavorite(exhibitId) {
    const isFav = favorites.includes(exhibitId);
    if (isFav) {
        await api('/api/favorites/remove', {
            method: 'POST',
            body: JSON.stringify({ user_id: currentUserId, exhibit_id: exhibitId })
        });
        favorites = favorites.filter(id => id !== exhibitId);
    } else {
        await api('/api/favorites/add', {
            method: 'POST',
            body: JSON.stringify({ user_id: currentUserId, exhibit_id: exhibitId })
        });
        favorites.push(exhibitId);
    }
    return !isFav;
}

// ----- Показ деталей музея (без изменений, уже есть) -----
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
    
    const reviews = await api(`/api/museum/${museum.id}/reviews`);
    const ratingData = await api(`/api/museum/${museum.id}/rating`);
    const avgRating = ratingData.average || 0;
    
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
    
    document.getElementById('detailExhibitsBtn')?.addEventListener('click', () => {
        modal.classList.add('hidden');
        showExhibits(museum.id);
    });
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
        renderCalendar(currentYear, currentMonth);
    });
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
                showMuseumDetails(museum.id);
            }).catch(() => alert('Вы уже оставили отзыв!'));
        }
    });
}

function copyShareLink(museumId) {
    const url = window.location.origin + '/?museum=' + museumId;
    navigator.clipboard.writeText(url);
    alert('Ссылка скопирована в буфер обмена!');
}

// ----- Экспонаты (с кнопкой избранное) -----
async function showExhibits(museumId) {
    const exhibits = await api(`/api/exhibits/${museumId}`);
    const modal = document.getElementById('exhibitsModal');
    const container = document.getElementById('exhibitsListModal');
    if (!modal || !container) return;
    if (exhibits.length) {
        container.innerHTML = exhibits.map(ex => {
            const isFav = favorites.includes(ex.id);
            return `
            <div class="card">
                <h4>${escapeHtml(ex.name)}</h4>
                <p>${escapeHtml(ex.description || '')}</p>
                ${ex.photo_url ? `<img src="${ex.photo_url}" style="max-height:150px">` : ''}
                ${ex.subject ? `<p><strong>Тема:</strong> ${escapeHtml(ex.subject)}</p>` : ''}
                <button class="fav-btn" data-exhibit-id="${ex.id}">${isFav ? '❤️ В избранном' : '🤍 В избранное'}</button>
            </div>
        `}).join('');
        // Обработчики кнопок избранного
        document.querySelectorAll('.fav-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const exhibitId = parseInt(btn.dataset.exhibitId);
                const newState = await toggleFavorite(exhibitId);
                btn.textContent = newState ? '❤️ В избранном' : '🤍 В избранное';
            });
        });
    } else {
        container.innerHTML = '<p>Экспонатов пока нет.</p>';
    }
    modal.classList.remove('hidden');
    modal.querySelector('.close').onclick = () => modal.classList.add('hidden');
}

// ----- Главная с фильтром по теме и фактом дня -----
async function renderMain() {
    const container = document.getElementById('museums-list');
    if (!container) return;
    // Загружаем все экспонаты для фильтрации
    allExhibits = await api('/api/exhibits');
    // Получаем уникальные темы
    const subjects = [...new Set(allExhibits.map(e => e.subject).filter(Boolean))];
    // Создаём фильтр, если его нет
    let filterHtml = `<div class="filter-bar">
        <label>Тема: <select id="subjectFilter">
            <option value="">Все темы</option>
            ${subjects.map(s => `<option value="${s}">${escapeHtml(s)}</option>`).join('')}
        </select></label>
    </div>`;
    // Вставляем фильтр перед карточками, если его ещё нет
    if (!document.getElementById('subjectFilter')) {
        container.parentNode.insertBefore(createFilterElement(filterHtml), container);
    }
    // Функция фильтрации
    const filterSelect = document.getElementById('subjectFilter');
    if (filterSelect) {
        filterSelect.onchange = () => renderFilteredMuseums();
    }
    // Также отображаем факт дня
    renderFactOfDay();
    // Рендерим все музеи
    renderFilteredMuseums();
}

function createFilterElement(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.firstElementChild;
}

async function renderFilteredMuseums() {
    const container = document.getElementById('museums-list');
    if (!container) return;
    const filterSelect = document.getElementById('subjectFilter');
    const selectedSubject = filterSelect ? filterSelect.value : '';
    let filteredMuseums = museums;
    if (selectedSubject) {
        // Находим музеи, у которых есть экспонаты с выбранной темой
        const exhibitMuseumIds = allExhibits.filter(e => e.subject === selectedSubject).map(e => e.museum_id);
        filteredMuseums = museums.filter(m => exhibitMuseumIds.includes(m.id));
    }
    container.innerHTML = '';
    for (const m of filteredMuseums) {
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

// ----- Факт дня -----
async function renderFactOfDay() {
    const container = document.getElementById('today-exhibit-content');
    if (!container) return;
    try {
        const exhibit = await api('/api/exhibit/today');
        if (!exhibit || !exhibit.name) {
            container.innerHTML = '<p>Сегодня фактов нет, загляните завтра!</p>';
            return;
        }
        container.innerHTML = `
            <h4>${escapeHtml(exhibit.name)}</h4>
            <p>${escapeHtml(exhibit.description || '')}</p>
            <p><small>🏛️ ${escapeHtml(exhibit.museum_name || '')}</small></p>
            <button onclick="showMuseumDetails(${exhibit.museum_id})">Узнать больше</button>
        `;
    } catch (e) {
        container.innerHTML = '<p>Не удалось загрузить факт дня</p>';
    }
}

// ----- Карта (без изменений) -----
function initYandexMap() { /* как было, оставляем */ }

// ----- Календарь и события (без изменений) -----
function getTodayDate() { /* ... */ }
async function renderCalendar(year, month) { /* ... */ }
async function renderEvents() { /* ... */ }

// ----- Вкладка "Школьникам" – лента образовательных постов -----
async function renderEducationalPosts() {
    const container = document.getElementById('educational-posts');
    if (!container) return;
    try {
        const posts = await api('/api/educational/posts');
        if (posts.length === 0) {
            container.innerHTML = '<p>Пока нет образовательных материалов. Загляните позже!</p>';
            return;
        }
        container.innerHTML = posts.map(post => `
            <div class="card educational-post">
                ${post.photo_url ? `<img src="${post.photo_url}" alt="иллюстрация" style="max-height:200px; object-fit:cover;">` : ''}
                <h3>${escapeHtml(post.title)}</h3>
                <p class="post-meta">${escapeHtml(post.author)} • ${new Date(post.created_at).toLocaleDateString('ru-RU')}</p>
                ${post.museum_name ? `<p class="post-museum">🏛️ ${escapeHtml(post.museum_name)}</p>` : ''}
                <div class="post-content">${escapeHtml(post.content)}</div>
            </div>
        `).join('');
    } catch (e) {
        container.innerHTML = '<p>Ошибка загрузки постов</p>';
    }
}

// ----- Паспорт (добавим избранное) -----
async function renderPassport() {
    await loadVisits();
    const total = museums.length;
    const visitedCount = visits.filter(v => v.visited === 1).length;
    const percent = total ? (visitedCount / total * 100) : 0;
    const container = document.getElementById('passport-info');
    if (!container) return;

    const userEvents = await api(`/api/user/events?user_id=${currentUserId}`);
    // Получаем избранные экспонаты с названиями
    const favExhibits = await Promise.all(favorites.map(async (id) => {
        const all = await api('/api/exhibits');
        return all.find(e => e.id === id);
    }));
    const favNames = favExhibits.filter(Boolean).map(e => e.name);

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
            <h3><i class="fas fa-star"></i> Мои избранные экспонаты</h3>
            <div id="favorites-list">
                ${favNames.length ? favNames.map(name => `<div>⭐ ${escapeHtml(name)}</div>`).join('') : '<p>Нет избранных экспонатов.</p>'}
            </div>
        </div>
    `;
    // Обработчики подписок (как было)
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
                if (mainCardSubscribeBtn) mainCardSubscribeBtn.innerHTML = '<i class="fas fa-bell"></i> Подписаться';
                const filter = document.getElementById('showOnlySubscribedEvents');
                if (filter && filter.checked) renderEvents();
                renderCalendar(currentYear, currentMonth);
            });
        });
    } else {
        subsDiv.innerHTML = '<p>Вы не подписаны ни на один музей.</p>';
    }
}

// ----- Вспомогательные функции (escapeHtml, initTabs, selectMuseumFromList) -----
function escapeHtml(str) { /* как было */ }

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
            if (tab === 'events') {
                renderEvents();
                renderCalendar(currentYear, currentMonth);
            }
            if (tab === 'passport') renderPassport();
            if (tab === 'educational') renderEducationalPosts();
        });
    });
}

async function selectMuseumFromList() { /* как было */ }

// ----- Инициализация -----
window.addEventListener('DOMContentLoaded', async () => {
    currentUserId = getUserId();
    await loadMuseums();
    await loadSubscriptions();
    await loadVisits();
    await loadFavorites();
    await preloadAllPhotos();
    renderMain();
    renderPassport();
    initTabs();
    const filterCheckbox = document.getElementById('showOnlySubscribedEvents');
    if (filterCheckbox) filterCheckbox.addEventListener('change', () => renderEvents());
    renderCalendar(currentYear, currentMonth);
    if (typeof ymaps !== 'undefined') {
        ymaps.ready(() => { ymapsReady = true; initYandexMap(); });
    }
    const urlParams = new URLSearchParams(window.location.search);
    const museumId = urlParams.get('museum');
    if (museumId) {
        setTimeout(() => showMuseumDetails(parseInt(museumId)), 500);
    }
});
