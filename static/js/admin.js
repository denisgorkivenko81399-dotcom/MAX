// Глобальная переменная для хранения ID редактируемого элемента
let editId = null;
let editType = null; // 'museum', 'exhibit', 'event', 'photo', 'edu-post'
let currentAdminTab = 'museums';

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    initAdminTabs();
    loadMuseumsList();
});

// Переключение вкладок
function initAdminTabs() {
    document.querySelectorAll('.admin-container .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.admin-container .tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tab = btn.dataset.tab;
            currentAdminTab = tab;
            document.querySelectorAll('.admin-section').forEach(s => s.classList.add('hidden'));
            const sectionMap = {
                'museums': 'museums-section',
                'exhibits': 'exhibits-section',
                'events': 'events-section',
                'photos': 'photos-section',
                'edu-posts': 'edu-posts-section'
            };
            const sectionId = sectionMap[tab];
            if (sectionId) {
                document.getElementById(sectionId).classList.remove('hidden');
            }
            if (tab === 'museums') loadMuseumsList();
            else if (tab === 'exhibits') loadExhibitsList();
            else if (tab === 'events') loadEventsList();
            else if (tab === 'photos') loadMuseumsForPhotos();
            else if (tab === 'edu-posts') loadEduPostsList();
        });
    });
}

// Вспомогательная функция для API с паролем
async function adminApi(url, options = {}) {
    const pwd = localStorage.getItem('admin_password');
    if (!pwd) {
        const entered = prompt('Введите пароль администратора:');
        if (entered) localStorage.setItem('admin_password', entered);
        else throw new Error('Пароль обязателен');
    }
    const headers = {
        'Content-Type': 'application/json',
        'X-Admin-Password': localStorage.getItem('admin_password')
    };
    const res = await fetch(url, { ...options, headers });
    if (res.status === 403) {
        localStorage.removeItem('admin_password');
        alert('Неверный пароль. Попробуйте снова.');
        throw new Error('Unauthorized');
    }
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, m => {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// ------------------- УПРАВЛЕНИЕ МУЗЕЯМИ -------------------
async function loadMuseumsList() {
    const container = document.getElementById('museums-list-admin');
    if (!container) return;
    try {
        const museums = await adminApi('/api/admin/museums');
        let html = `<table class="admin-table">
            <thead><tr><th>ID</th><th>Название</th><th>Адрес</th><th>Пушкинская</th><th>Действия</th></tr></thead><tbody>`;
        museums.forEach(m => {
            html += `<tr>
                <td>${m.id}</td>
                <td>${escapeHtml(m.name)}</td>
                <td>${escapeHtml(m.address || '')}</td>
                <td>${m.pushkin_card === 'да' ? '✅' : '❌'}</td>
                <td class="admin-actions">
                    <button class="edit" data-id="${m.id}" data-type="museum"><i class="fas fa-edit"></i></button>
                    <button class="delete" data-id="${m.id}" data-type="museum"><i class="fas fa-trash"></i></button>
                </td>
            </tr>`;
        });
        html += `</tbody></table>`;
        container.innerHTML = html;
        container.querySelectorAll('.edit').forEach(btn => {
            btn.addEventListener('click', () => editMuseum(parseInt(btn.dataset.id)));
        });
        container.querySelectorAll('.delete').forEach(btn => {
            btn.addEventListener('click', () => deleteMuseum(parseInt(btn.dataset.id)));
        });
    } catch (e) {
        container.innerHTML = '<p>Ошибка загрузки музеев: ' + e.message + '</p>';
    }
}

async function editMuseum(id) {
    editType = 'museum';
    const museums = await adminApi('/api/admin/museums');
    const museum = museums.find(m => m.id === id);
    if (!museum) return;
    const fields = [
        { name: 'name', label: 'Название', required: true },
        { name: 'address', label: 'Адрес', required: true },
        { name: 'lat', label: 'Широта', type: 'number', required: true },
        { name: 'lng', label: 'Долгота', type: 'number', required: true },
        { name: 'description', label: 'Описание', type: 'textarea' },
        { name: 'contacts', label: 'Контакты' },
        { name: 'website', label: 'Сайт' },
        { name: 'cover_photo_url', label: 'Ссылка на главное фото' },
        { name: 'pushkin_card', label: 'Пушкинская карта', type: 'checkbox' }
    ];
    showForm('Редактировать музей', fields, museum);
}

async function deleteMuseum(id) {
    if (!confirm('Удалить музей и все связанные данные?')) return;
    try {
        await adminApi('/api/admin/museums', { method: 'DELETE', body: JSON.stringify({ id }) });
        alert('Удалено');
        loadMuseumsList();
    } catch (e) {
        alert('Ошибка удаления: ' + e.message);
    }
}

document.getElementById('addMuseumBtn')?.addEventListener('click', () => {
    editType = 'museum';
    editId = null;
    const fields = [
        { name: 'name', label: 'Название', required: true },
        { name: 'address', label: 'Адрес', required: true },
        { name: 'lat', label: 'Широта', type: 'number', required: true },
        { name: 'lng', label: 'Долгота', type: 'number', required: true },
        { name: 'description', label: 'Описание', type: 'textarea' },
        { name: 'contacts', label: 'Контакты' },
        { name: 'website', label: 'Сайт' },
        { name: 'cover_photo_url', label: 'Ссылка на главное фото' },
        { name: 'pushkin_card', label: 'Пушкинская карта', type: 'checkbox' }
    ];
    showForm('Добавить музей', fields);
});

// ------------------- УПРАВЛЕНИЕ ЭКСПОНАТАМИ -------------------
async function loadExhibitsList() {
    const container = document.getElementById('exhibits-list-admin');
    if (!container) return;
    try {
        const exhibits = await adminApi('/api/admin/exhibits');
        const museums = await adminApi('/api/admin/museums');
        const museumMap = {};
        museums.forEach(m => museumMap[m.id] = m.name);
        let html = `<table class="admin-table">
            <thead><tr><th>ID</th><th>Название</th><th>Музей</th><th>Тема</th><th>Действия</th></tr></thead><tbody>`;
        exhibits.forEach(ex => {
            html += `<tr>
                <td>${ex.id}</td>
                <td>${escapeHtml(ex.name)}</td>
                <td>${escapeHtml(museumMap[ex.museum_id] || 'Неизвестно')}</td>
                <td>${escapeHtml(ex.subject || '')}</td>
                <td class="admin-actions">
                    <button class="edit" data-id="${ex.id}" data-type="exhibit"><i class="fas fa-edit"></i></button>
                    <button class="delete" data-id="${ex.id}" data-type="exhibit"><i class="fas fa-trash"></i></button>
                </td>
            </tr>`;
        });
        html += `</tbody></table>`;
        container.innerHTML = html;
        container.querySelectorAll('.edit').forEach(btn => {
            btn.addEventListener('click', () => editExhibit(parseInt(btn.dataset.id)));
        });
        container.querySelectorAll('.delete').forEach(btn => {
            btn.addEventListener('click', () => deleteExhibit(parseInt(btn.dataset.id)));
        });
    } catch (e) {
        container.innerHTML = '<p>Ошибка загрузки экспонатов: ' + e.message + '</p>';
    }
}

async function editExhibit(id) {
    editType = 'exhibit';
    const exhibits = await adminApi('/api/admin/exhibits');
    const ex = exhibits.find(e => e.id === id);
    if (!ex) return;
    const museums = await adminApi('/api/admin/museums');
    const options = museums.map(m => ({ value: m.id, label: m.name }));
    const fields = [
        { name: 'museum_id', label: 'Музей', type: 'select', options, required: true },
        { name: 'name', label: 'Название', required: true },
        { name: 'description', label: 'Описание', type: 'textarea' },
        { name: 'photo_url', label: 'Фото URL' },
        { name: 'subject', label: 'Учебная тема' }
    ];
    showForm('Редактировать экспонат', fields, ex);
}

async function deleteExhibit(id) {
    if (!confirm('Удалить экспонат?')) return;
    try {
        await adminApi('/api/admin/exhibits', { method: 'DELETE', body: JSON.stringify({ id }) });
        alert('Удалено');
        loadExhibitsList();
    } catch (e) {
        alert('Ошибка удаления: ' + e.message);
    }
}

document.getElementById('addExhibitBtn')?.addEventListener('click', async () => {
    editType = 'exhibit';
    editId = null;
    const museums = await adminApi('/api/admin/museums');
    const options = museums.map(m => ({ value: m.id, label: m.name }));
    const fields = [
        { name: 'museum_id', label: 'Музей', type: 'select', options, required: true },
        { name: 'name', label: 'Название', required: true },
        { name: 'description', label: 'Описание', type: 'textarea' },
        { name: 'photo_url', label: 'Фото URL' },
        { name: 'subject', label: 'Учебная тема' }
    ];
    showForm('Добавить экспонат', fields);
});

// ------------------- УПРАВЛЕНИЕ СОБЫТИЯМИ -------------------
async function loadEventsList() {
    const container = document.getElementById('events-list-admin');
    if (!container) return;
    try {
        const events = await adminApi('/api/admin/events');
        const museums = await adminApi('/api/admin/museums');
        const museumMap = {};
        museums.forEach(m => museumMap[m.id] = m.name);
        let html = `<table class="admin-table">
            <thead><tr><th>ID</th><th>Название</th><th>Музей</th><th>Дата</th><th>Действия</th></tr></thead><tbody>`;
        events.forEach(ev => {
            html += `<tr>
                <td>${ev.id}</td>
                <td>${escapeHtml(ev.title)}</td>
                <td>${escapeHtml(museumMap[ev.museum_id] || 'Неизвестно')}</td>
                <td>${escapeHtml(ev.date || '')}</td>
                <td class="admin-actions">
                    <button class="edit" data-id="${ev.id}" data-type="event"><i class="fas fa-edit"></i></button>
                    <button class="delete" data-id="${ev.id}" data-type="event"><i class="fas fa-trash"></i></button>
                </td>
            </tr>`;
        });
        html += `</tbody></table>`;
        container.innerHTML = html;
        container.querySelectorAll('.edit').forEach(btn => {
            btn.addEventListener('click', () => editEvent(parseInt(btn.dataset.id)));
        });
        container.querySelectorAll('.delete').forEach(btn => {
            btn.addEventListener('click', () => deleteEvent(parseInt(btn.dataset.id)));
        });
    } catch (e) {
        container.innerHTML = '<p>Ошибка загрузки событий: ' + e.message + '</p>';
    }
}

async function editEvent(id) {
    editType = 'event';
    const events = await adminApi('/api/admin/events');
    const ev = events.find(e => e.id === id);
    if (!ev) return;
    const museums = await adminApi('/api/admin/museums');
    const options = museums.map(m => ({ value: m.id, label: m.name }));
    const fields = [
        { name: 'museum_id', label: 'Музей', type: 'select', options, required: true },
        { name: 'title', label: 'Название', required: true },
        { name: 'date', label: 'Дата (YYYY-MM-DD)', required: true },
        { name: 'time', label: 'Время (HH:MM)' },
        { name: 'description', label: 'Описание', type: 'textarea' },
        { name: 'photo_url', label: 'Фото URL' }
    ];
    showForm('Редактировать событие', fields, ev);
}

async function deleteEvent(id) {
    if (!confirm('Удалить событие?')) return;
    try {
        await adminApi('/api/admin/events', { method: 'DELETE', body: JSON.stringify({ id }) });
        alert('Удалено');
        loadEventsList();
    } catch (e) {
        alert('Ошибка удаления: ' + e.message);
    }
}

document.getElementById('addEventBtn')?.addEventListener('click', async () => {
    editType = 'event';
    editId = null;
    const museums = await adminApi('/api/admin/museums');
    const options = museums.map(m => ({ value: m.id, label: m.name }));
    const fields = [
        { name: 'museum_id', label: 'Музей', type: 'select', options, required: true },
        { name: 'title', label: 'Название', required: true },
        { name: 'date', label: 'Дата (YYYY-MM-DD)', required: true },
        { name: 'time', label: 'Время (HH:MM)' },
        { name: 'description', label: 'Описание', type: 'textarea' },
        { name: 'photo_url', label: 'Фото URL' }
    ];
    showForm('Добавить событие', fields);
});

// ------------------- УПРАВЛЕНИЕ ФОТОГРАФИЯМИ -------------------
async function loadMuseumsForPhotos() {
    const select = document.getElementById('museumSelectPhotos');
    if (!select) return;
    try {
        const museums = await adminApi('/api/admin/museums');
        select.innerHTML = '<option value="">Выберите музей</option>';
        museums.forEach(m => {
            const option = document.createElement('option');
            option.value = m.id;
            option.textContent = m.name;
            select.appendChild(option);
        });
        select.onchange = () => {
            const id = select.value;
            if (id) loadPhotosForMuseum(id);
            else document.getElementById('photos-list-admin').innerHTML = '';
        };
    } catch (e) {
        alert('Ошибка загрузки музеев для фото');
    }
}

async function loadPhotosForMuseum(museumId) {
    if (!museumId) return;
    const container = document.getElementById('photos-list-admin');
    try {
        const photos = await adminApi(`/api/admin/museum_photos/${museumId}`);
        let html = `<table class="admin-table">
            <thead><tr><th>ID</th><th>Фото URL</th><th>Действия</th></tr></thead><tbody>`;
        photos.forEach(p => {
            html += `<tr>
                <td>${p.id}</td>
                <td><a href="${p.photo_url}" target="_blank">${escapeHtml(p.photo_url)}</a></td>
                <td class="admin-actions">
                    <button class="delete-photo" data-id="${p.id}" data-museum="${museumId}"><i class="fas fa-trash"></i></button>
                </td>
            </tr>`;
        });
        html += `</tbody></table>`;
        container.innerHTML = html;
        container.querySelectorAll('.delete-photo').forEach(btn => {
            btn.addEventListener('click', () => deletePhoto(parseInt(btn.dataset.id), parseInt(btn.dataset.museum)));
        });
    } catch (e) {
        container.innerHTML = '<p>Ошибка загрузки фото: ' + e.message + '</p>';
    }
}

async function deletePhoto(photoId, museumId) {
    if (!confirm('Удалить фото?')) return;
    try {
        await adminApi(`/api/admin/museum_photos/${museumId}`, {
            method: 'DELETE',
            body: JSON.stringify({ photo_id: photoId })
        });
        alert('Фото удалено');
        loadPhotosForMuseum(museumId);
    } catch (e) {
        alert('Ошибка удаления: ' + e.message);
    }
}

document.getElementById('addPhotoBtn')?.addEventListener('click', () => {
    const museumId = document.getElementById('museumSelectPhotos').value;
    if (!museumId) {
        alert('Сначала выберите музей');
        return;
    }
    const url = prompt('Введите URL нового фото:');
    if (url) {
        adminApi(`/api/admin/museum_photos/${museumId}`, {
            method: 'POST',
            body: JSON.stringify({ photo_url: url })
        }).then(() => {
            alert('Фото добавлено');
            loadPhotosForMuseum(museumId);
        }).catch(e => alert('Ошибка: ' + e.message));
    }
});

// ------------------- УПРАВЛЕНИЕ ОБРАЗОВАТЕЛЬНЫМИ ПОСТАМИ -------------------
async function loadEduPostsList() {
    const container = document.getElementById('edu-posts-list-admin');
    if (!container) return;
    try {
        const posts = await adminApi('/api/admin/educational_posts');
        let html = `<table class="admin-table">
            <thead><tr><th>ID</th><th>Название</th><th>Автор</th><th>Дата</th><th>Действия</th></tr></thead><tbody>`;
        posts.forEach(p => {
            html += `<tr>
                <td>${p.id}</td>
                <td>${escapeHtml(p.title)}</td>
                <td>${escapeHtml(p.author || '')}</td>
                <td>${p.created_at.slice(0,10)}</td>
                <td class="admin-actions">
                    <button class="edit" data-id="${p.id}" data-type="edu-post"><i class="fas fa-edit"></i></button>
                    <button class="delete" data-id="${p.id}" data-type="edu-post"><i class="fas fa-trash"></i></button>
                </td>
            </tr>`;
        });
        html += `</tbody></table>`;
        container.innerHTML = html;
        container.querySelectorAll('.edit').forEach(btn => {
            btn.addEventListener('click', () => editEduPost(parseInt(btn.dataset.id)));
        });
        container.querySelectorAll('.delete').forEach(btn => {
            btn.addEventListener('click', () => deleteEduPost(parseInt(btn.dataset.id)));
        });
    } catch (e) {
        container.innerHTML = '<p>Ошибка загрузки постов: ' + e.message + '</p>';
    }
}

async function editEduPost(id) {
    editType = 'edu-post';
    const posts = await adminApi('/api/admin/educational_posts');
    const post = posts.find(p => p.id === id);
    if (!post) return;
    const museums = await adminApi('/api/admin/museums');
    const options = museums.map(m => ({ value: m.id, label: m.name }));
    const fields = [
        { name: 'title', label: 'Заголовок', required: true },
        { name: 'content', label: 'Содержание', type: 'textarea', required: true },
        { name: 'photo_url', label: 'Ссылка на фото' },
        { name: 'museum_id', label: 'Музей (необязательно)', type: 'select', options: [{ value: '', label: 'Не привязан' }, ...options] },
        { name: 'author', label: 'Автор', required: true }
    ];
    showForm('Редактировать пост', fields, post);
}

async function deleteEduPost(id) {
    if (!confirm('Удалить пост?')) return;
    try {
        await adminApi('/api/admin/educational_posts', { method: 'DELETE', body: JSON.stringify({ id }) });
        alert('Удалено');
        loadEduPostsList();
    } catch (e) {
        alert('Ошибка удаления: ' + e.message);
    }
}

document.getElementById('addEduPostBtn')?.addEventListener('click', async () => {
    editType = 'edu-post';
    editId = null;
    const museums = await adminApi('/api/admin/museums');
    const options = museums.map(m => ({ value: m.id, label: m.name }));
    const fields = [
        { name: 'title', label: 'Заголовок', required: true },
        { name: 'content', label: 'Содержание', type: 'textarea', required: true },
        { name: 'photo_url', label: 'Ссылка на фото' },
        { name: 'museum_id', label: 'Музей (необязательно)', type: 'select', options: [{ value: '', label: 'Не привязан' }, ...options] },
        { name: 'author', label: 'Автор', required: true }
    ];
    showForm('Добавить пост', fields);
});

// ------------------- ОБЩАЯ ФУНКЦИЯ ДЛЯ ФОРМ -------------------
function showForm(title, fields, data = null) {
    const modal = document.getElementById('adminModal');
    const form = document.getElementById('adminForm');
    const titleEl = document.getElementById('adminModalTitle');
    const container = document.getElementById('formFields');
    container.innerHTML = '';
    editId = data ? data.id : null;
    titleEl.textContent = title;
    fields.forEach(f => {
        const div = document.createElement('div');
        div.className = 'form-group';
        const label = document.createElement('label');
        label.textContent = f.label + (f.required ? ' *' : '');
        label.htmlFor = `field_${f.name}`;
        div.appendChild(label);
        let input;
        if (f.type === 'select') {
            input = document.createElement('select');
            input.id = `field_${f.name}`;
            f.options.forEach(opt => {
                const option = document.createElement('option');
                option.value = opt.value;
                option.textContent = opt.label;
                if (data && data[f.name] == opt.value) option.selected = true;
                input.appendChild(option);
            });
        } else if (f.type === 'textarea') {
            input = document.createElement('textarea');
            input.id = `field_${f.name}`;
            input.rows = 4;
            if (data && data[f.name]) input.value = data[f.name];
        } else if (f.type === 'checkbox') {
            input = document.createElement('input');
            input.type = 'checkbox';
            input.id = `field_${f.name}`;
            if (data && data[f.name] === 'да') input.checked = true;
        } else {
            input = document.createElement('input');
            input.type = f.type || 'text';
            input.id = `field_${f.name}`;
            if (data && data[f.name] !== undefined) input.value = data[f.name];
            else if (f.default) input.value = f.default;
        }
        input.name = f.name;
        if (f.required) input.required = true;
        div.appendChild(input);
        container.appendChild(div);
    });
    modal.classList.remove('hidden');
    modal.querySelector('.close').onclick = () => modal.classList.add('hidden');
    document.getElementById('cancelFormBtn').onclick = () => modal.classList.add('hidden');
    form.onsubmit = async (e) => {
        e.preventDefault();
        await submitForm();
    };
}

async function submitForm() {
    const form = document.getElementById('adminForm');
    const formData = new FormData(form);
    const data = {};
    for (let [key, value] of formData.entries()) {
        if (key === 'pushkin_card' || key === 'visited') {
            data[key] = value === 'on' ? 'да' : 'нет';
        } else {
            data[key] = value;
        }
    }
    if (data.lat) data.lat = parseFloat(data.lat);
    if (data.lng) data.lng = parseFloat(data.lng);
    if (data.museum_id) data.museum_id = parseInt(data.museum_id) || null;
    if (data.rating) data.rating = parseInt(data.rating);

    let url, method;
    let entity = editType;
    if (editId) {
        method = 'PUT';
        url = `/api/admin/${entity}s`;
        data.id = editId;
    } else {
        method = 'POST';
        url = `/api/admin/${entity}s`;
    }
    try {
        await adminApi(url, { method, body: JSON.stringify(data) });
        alert('Сохранено!');
        document.getElementById('adminModal').classList.add('hidden');
        if (entity === 'museum') loadMuseumsList();
        else if (entity === 'exhibit') loadExhibitsList();
        else if (entity === 'event') loadEventsList();
        else if (entity === 'photo') loadPhotosForMuseum(document.getElementById('museumSelectPhotos').value);
        else if (entity === 'edu-post') loadEduPostsList();
    } catch (e) {
        alert('Ошибка: ' + e.message);
    }
}
