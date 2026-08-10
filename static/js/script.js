// Глобальные переменные (оставляем как есть)
let currentUserId = null;
let museums = [];
let events = [];
let subscriptions = [];
let visits = [];
let ymapsReady = false;
let museumPhotosCache = {};
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth() + 1;
let selectedDate = null; // если null – показываем все события

// Получение user_id (без изменений)
function getUserId() { /* ... */ }

// API вызовы (без изменений)
async function api(url, options = {}) { /* ... */ }

// Загрузка данных (без изменений)
async function loadMuseums() { /* ... */ }
async function loadEvents() { /* ... */ }
async function loadSubscriptions() { /* ... */ }
async function loadVisits() { /* ... */ }
async function setVisit(museumId, visited) { /* ... */ }

// Фото (без изменений)
async function getMuseumPhotos(museumId) { /* ... */ }
async function preloadAllPhotos() { /* ... */ }

// Модальное окно музея (без изменений, уже есть всё)
async function showMuseumDetails(museumId) { /* ... */ }

// Экспонаты
async function showExhibits(museumId) { /* ... */ }

// Главная
async function renderMain() { /* ... */ }

// Карта
function initYandexMap() { /* ... */ }
window.showExhibitsFromMap = function(museumId) { /* ... */ };

// ------------------- КАЛЕНДАРЬ + ЛЕНТА СОБЫТИЙ -------------------
function getTodayDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

async function renderCalendar(year, month) {
    const container = document.getElementById('calendar-grid');
    if (!container) return;
    const monthEvents = await api(`/api/events/month?year=${year}&month=${month}`);
    const firstDay = new Date(year, month-1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    let html = `<div class="calendar-header">
                  <button id="prevMonth"><i class="fas fa-chevron-left"></i></button>
                  <span>${month}.${year}</span>
                  <button id="nextMonth"><i class="fas fa-chevron-right"></i></button>
                </div>
                <table class="calendar-table">
                  <tr><th>Пн</th><th>Вт</th><th>Ср</th><th>Чт</th><th>Пт</th><th>Сб</th><th>Вс</th></tr><tr>`;
    let startOffset = (firstDay === 0) ? 6 : firstDay - 1;
    for (let i = 0; i < startOffset; i++) html += '<td></td>';
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const hasEvent = monthEvents.some(e => e.date === dateStr);
        const isToday = (dateStr === getTodayDate());
        html += `<td data-date="${dateStr}" class="${hasEvent ? 'has-event' : ''} ${isToday ? 'today' : ''}">${d}</td>`;
        if ((d + startOffset) % 7 === 0 && d < daysInMonth) html += '</tr><tr>';
    }
    html += '</tr></table>';
    container.innerHTML = html;

    document.getElementById('prevMonth').addEventListener('click', () => {
        if (currentMonth === 1) { currentMonth = 12; currentYear--; } else { currentMonth--; }
        renderCalendar(currentYear, currentMonth);
        // Если была выбрана дата в другом месяце – сбросим фильтр
        if (selectedDate) {
            const d = new Date(selectedDate);
            if (d.getFullYear() !== currentYear || d.getMonth()+1 !== currentMonth) {
                selectedDate = null;
            }
        }
        renderEvents(); // обновить ленту
    });
    document.getElementById('nextMonth').addEventListener('click', () => {
        if (currentMonth === 12) { currentMonth = 1; currentYear++; } else { currentMonth++; }
        renderCalendar(currentYear, currentMonth);
        if (selectedDate) {
            const d = new Date(selectedDate);
            if (d.getFullYear() !== currentYear || d.getMonth()+1 !== currentMonth) {
                selectedDate = null;
            }
        }
        renderEvents();
    });

    document.querySelectorAll('.calendar-table td[data-date]').forEach(td => {
        td.addEventListener('click', () => {
            const date = td.dataset.date;
            selectedDate = date;
            renderEvents(); // фильтруем ленту по этой дате
        });
    });

    // Если нет выбранной даты, показываем все
    if (!selectedDate) {
        renderEvents();
    }
}

// Рендер ленты событий (с учётом фильтра по дате и подпискам)
async function renderEvents() {
    await loadEvents(); // загружаем все события
    const container = document.getElementById('events-list');
    if (!container) return;
    let filteredEvents = events;
    // Фильтр по дате, если выбрана
    if (selectedDate) {
        filteredEvents = events.filter(ev => ev.date === selectedDate);
    }
    // Фильтр по подпискам (чекбокс)
    const filterCheckbox = document.getElementById('showOnlySubscribedEvents');
    if (filterCheckbox && filterCheckbox.checked && subscriptions.length) {
        const subIds = subscriptions.map(s => s.id);
        filteredEvents = filteredEvents.filter(ev => subIds.includes(ev.museum_id));
    }

    if (filteredEvents.length === 0) {
        container.innerHTML = '<p>Событий не найдено.</p>';
        return;
    }
    container.innerHTML = filteredEvents.map(ev => `
        <div class="card">
            ${ev.photo_url ? `<img src="${ev.photo_url}" style="max-height:150px; object-fit:cover; border-radius:20px;">` : ''}
            <h3>${escapeHtml(ev.title)}</h3>
            <p><i class="fas fa-calendar-day"></i> ${ev.date || 'Дата не указана'} ${ev.time ? 'в ' + escapeHtml(ev.time) : ''}</p>
            <p><i class="fas fa-landmark"></i> ${escapeHtml(ev.museum_name)}</p>
            <p>${escapeHtml(ev.description || '')}</p>
        </div>
    `).join('');
}

// ------------------- ОБРАЗОВАТЕЛЬНЫЙ МОДУЛЬ (исправлен) -------------------
async function renderEducational() {
    const container = document.getElementById('educational-content');
    if (!container) return;
    const allExhibits = await api('/api/exhibits');
    // Собираем уникальные темы, игнорируем пустые
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

    document.getElementById('subject-select').addEventListener('change', async (e) => {
        const subject = e.target.value;
        const list = await api(`/api/exhibits/subject?subject=${subject}`);
        const div = document.getElementById('exhibits-by-subject');
        if (list.length === 0) {
            div.innerHTML = '<p>Экспонатов по этой теме пока нет.</p>';
            return;
        }
        const userExcursions = await api(`/api/user/excursions?user_id=${currentUserId}`);
        div.innerHTML = list.map(ex => `
            <div class="exhibit-item">
                <span><strong>${escapeHtml(ex.name)}</strong> (музей ${ex.museum_id})</span>
                ${ex.subject ? `<span class="subject-tag">${escapeHtml(ex.subject)}</span>` : '<span class="subject-tag">Без темы</span>'}
                <button class="add-to-excursion-btn" data-exhibit-id="${ex.id}">Добавить в экскурсию</button>
            </div>
        `).join('');
        // Обработчики кнопок (как было)
        document.querySelectorAll('.add-to-excursion-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const exhibitId = parseInt(btn.dataset.exhibitId);
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
                            await api('/api/excursions/add_item', {
                                method: 'POST',
                                body: JSON.stringify({ excursion_id: newEx.id, exhibit_id: exhibitId })
                            });
                            alert('Экспонат добавлен в новую экскурсию!');
                            renderEducational();
                        }
                    }
                    return;
                }
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
                    renderEducational();
                }
            });
        });
    });

    // Загрузка моих экскурсий
    await renderExcursionList();

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

// ------------------- ПАСПОРТ (без старой админки) -------------------
async function renderPassport() {
    await loadVisits();
    const total = museums.length;
    const visitedCount = visits.filter(v => v.visited === 1).length;
    const percent = total ? (visitedCount / total * 100) : 0;
    const container = document.getElementById('passport-info');
    if (!container) return;

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

    // Подписки
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

    // Экскурсии в паспорте
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

// ------------------- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (без старой админки) -------------------
// Оставляем только escapeHtml, initTabs, и selectMuseumFromList (нужен для админ-панели)
function escapeHtml(str) { /* ... */ }
function initTabs() { /* ... */ }

// Функция для выбора музея из списка (используется в admin.js)
async function selectMuseumFromList() { /* ... */ }

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
    // Фильтр подписок
    const filterCheckbox = document.getElementById('showOnlySubscribedEvents');
    if (filterCheckbox) filterCheckbox.addEventListener('change', () => renderEvents());
    // Календарь и события
    renderCalendar(currentYear, currentMonth);
    // Карта
    if (typeof ymaps !== 'undefined') {
        ymaps.ready(() => { ymapsReady = true; initYandexMap(); });
    }
    // Если в URL есть museum – открыть модалку
    const urlParams = new URLSearchParams(window.location.search);
    const museumId = urlParams.get('museum');
    if (museumId) {
        setTimeout(() => showMuseumDetails(parseInt(museumId)), 500);
    }
});
