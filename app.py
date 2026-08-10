import sqlite3
import json
import os
from flask import Flask, request, jsonify, render_template, g
from flask_cors import CORS

app = Flask(__name__)
app.secret_key = 'skfu_hackathon_2026'
CORS(app)

DATABASE = 'museum.db'
ADMIN_PASSWORD = 'admin123'

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

# ------------------- ФУНКЦИЯ МИГРАЦИИ (безопасное обновление БД) -------------------
def migrate_db():
    """Создаёт отсутствующие таблицы и добавляет новые поля в существующие."""
    with app.app_context():
        db = get_db()
        cursor = db.cursor()

        # --- 1. Проверяем и создаём основные таблицы, если их нет ---
        # Таблица museums
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS museums (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                address TEXT,
                lat REAL,
                lng REAL,
                description TEXT,
                contacts TEXT,
                website TEXT,
                cover_photo_url TEXT,
                pushkin_card TEXT DEFAULT 'нет'
            )
        ''')
        # Таблица museum_photos
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS museum_photos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                museum_id INTEGER NOT NULL,
                photo_url TEXT NOT NULL,
                sort_order INTEGER DEFAULT 0,
                FOREIGN KEY (museum_id) REFERENCES museums(id) ON DELETE CASCADE
            )
        ''')
        # Таблица exhibits
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS exhibits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                museum_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                photo_url TEXT,
                subject TEXT,
                FOREIGN KEY (museum_id) REFERENCES museums(id) ON DELETE CASCADE
            )
        ''')
        # Таблица events
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                museum_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                date TEXT,
                time TEXT,
                description TEXT,
                photo_url TEXT,
                FOREIGN KEY (museum_id) REFERENCES museums(id) ON DELETE CASCADE
            )
        ''')
        # Таблица subscriptions
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS subscriptions (
                user_id TEXT NOT NULL,
                museum_id INTEGER NOT NULL,
                PRIMARY KEY (user_id, museum_id),
                FOREIGN KEY (museum_id) REFERENCES museums(id) ON DELETE CASCADE
            )
        ''')
        # Таблица user_visits
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS user_visits (
                user_id TEXT NOT NULL,
                museum_id INTEGER NOT NULL,
                visited BOOLEAN DEFAULT 0,
                PRIMARY KEY (user_id, museum_id),
                FOREIGN KEY (museum_id) REFERENCES museums(id) ON DELETE CASCADE
            )
        ''')

        # --- 2. Новые таблицы (если их нет, создаём) ---
        # user_events
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS user_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                event_id INTEGER NOT NULL,
                added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
                UNIQUE(user_id, event_id)
            )
        ''')
        # excursions
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS excursions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        # excursion_items
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS excursion_items (
                excursion_id INTEGER NOT NULL,
                exhibit_id INTEGER NOT NULL,
                added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (excursion_id) REFERENCES excursions(id) ON DELETE CASCADE,
                FOREIGN KEY (exhibit_id) REFERENCES exhibits(id) ON DELETE CASCADE,
                PRIMARY KEY (excursion_id, exhibit_id)
            )
        ''')
        # reviews
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                museum_id INTEGER NOT NULL,
                user_id TEXT NOT NULL,
                rating INTEGER CHECK (rating BETWEEN 1 AND 5),
                text TEXT,
                user_name TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (museum_id) REFERENCES museums(id) ON DELETE CASCADE
            )
        ''')

        # --- 3. Добавление новых полей в существующие таблицы (если их нет) ---
        # Добавляем поле 'time' в events
        cursor.execute("PRAGMA table_info(events)")
        columns = [col[1] for col in cursor.fetchall()]
        if 'time' not in columns:
            cursor.execute('ALTER TABLE events ADD COLUMN time TEXT')
        # Добавляем поле 'subject' в exhibits
        cursor.execute("PRAGMA table_info(exhibits)")
        columns = [col[1] for col in cursor.fetchall()]
        if 'subject' not in columns:
            cursor.execute('ALTER TABLE exhibits ADD COLUMN subject TEXT')

        db.commit()

        # --- 4. Загрузка начальных данных, если таблица музеев пуста ---
        cursor.execute("SELECT COUNT(*) FROM museums")
        if cursor.fetchone()[0] == 0:
            load_seed_data(db)

        db.commit()

def load_seed_data(db):
    with open('seed_data.json', 'r', encoding='utf-8') as f:
        data = json.load(f)
    cursor = db.cursor()
    for museum in data['museums']:
        cursor.execute('''
            INSERT INTO museums (name, address, lat, lng, description, contacts, website, cover_photo_url, pushkin_card)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (museum['name'], museum['address'], museum['lat'], museum['lng'],
              museum['description'], museum.get('contacts'), museum.get('website'),
              museum.get('cover_photo'), museum.get('pushkin_card', 'нет')))
        museum_id = cursor.lastrowid
        for photo_url in museum.get('photos', []):
            cursor.execute('INSERT INTO museum_photos (museum_id, photo_url, sort_order) VALUES (?, ?, ?)',
                           (museum_id, photo_url, 0))
        for ex in museum.get('exhibits', []):
            cursor.execute('''
                INSERT INTO exhibits (museum_id, name, description, photo_url, subject)
                VALUES (?, ?, ?, ?, ?)
            ''', (museum_id, ex['name'], ex['description'], ex.get('photo_url', ''), ex.get('subject', '')))
        for ev in museum.get('events', []):
            cursor.execute('''
                INSERT INTO events (museum_id, title, date, time, description, photo_url)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (museum_id, ev['title'], ev['date'], ev.get('time', ''), ev.get('description', ''), ev.get('photo_url', '')))
    db.commit()

# ------------------- API для посетителей -------------------
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/admin')
def admin_panel():
    return render_template('admin.html')

@app.route('/api/museums')
def get_museums():
    db = get_db()
    museums = db.execute('SELECT * FROM museums').fetchall()
    return jsonify([dict(row) for row in museums])

@app.route('/api/museum_photos/<int:museum_id>')
def get_museum_photos(museum_id):
    db = get_db()
    photos = db.execute('SELECT photo_url FROM museum_photos WHERE museum_id = ? ORDER BY sort_order', (museum_id,)).fetchall()
    return jsonify([p['photo_url'] for p in photos])

@app.route('/api/exhibits/<int:museum_id>')
def get_exhibits(museum_id):
    db = get_db()
    exhibits = db.execute('SELECT * FROM exhibits WHERE museum_id = ?', (museum_id,)).fetchall()
    return jsonify([dict(row) for row in exhibits])

@app.route('/api/events')
def get_events():
    user_id = request.args.get('user_id')
    db = get_db()
    if user_id:
        subs = db.execute('SELECT museum_id FROM subscriptions WHERE user_id = ?', (user_id,)).fetchall()
        if subs:
            museum_ids = [row['museum_id'] for row in subs]
            placeholders = ','.join('?' for _ in museum_ids)
            events = db.execute(f'''
                SELECT events.*, museums.name as museum_name
                FROM events JOIN museums ON events.museum_id = museums.id
                WHERE events.museum_id IN ({placeholders})
                ORDER BY events.date DESC, events.time
            ''', museum_ids).fetchall()
        else:
            events = []
    else:
        events = db.execute('''
            SELECT events.*, museums.name as museum_name
            FROM events JOIN museums ON events.museum_id = museums.id
            ORDER BY events.date DESC, events.time
        ''').fetchall()
    return jsonify([dict(row) for row in events])

@app.route('/api/subscribe', methods=['POST'])
def subscribe():
    data = request.json
    user_id = data.get('user_id')
    museum_id = data.get('museum_id')
    if not user_id or not museum_id:
        return jsonify({'error': 'Missing data'}), 400
    db = get_db()
    db.execute('INSERT OR REPLACE INTO subscriptions (user_id, museum_id) VALUES (?, ?)', (user_id, museum_id))
    db.commit()
    return jsonify({'status': 'subscribed'})

@app.route('/api/unsubscribe', methods=['POST'])
def unsubscribe():
    data = request.json
    user_id = data.get('user_id')
    museum_id = data.get('museum_id')
    db = get_db()
    db.execute('DELETE FROM subscriptions WHERE user_id = ? AND museum_id = ?', (user_id, museum_id))
    db.commit()
    return jsonify({'status': 'unsubscribed'})

@app.route('/api/visits', methods=['GET', 'POST'])
def visits():
    user_id = request.args.get('user_id') if request.method == 'GET' else request.json.get('user_id')
    if not user_id:
        return jsonify({'error': 'No user_id'}), 400
    db = get_db()
    if request.method == 'GET':
        visits = db.execute('SELECT museum_id, visited FROM user_visits WHERE user_id = ?', (user_id,)).fetchall()
        return jsonify([dict(row) for row in visits])
    else:
        data = request.json
        museum_id = data.get('museum_id')
        visited = data.get('visited', 1)
        db.execute('INSERT OR REPLACE INTO user_visits (user_id, museum_id, visited) VALUES (?, ?, ?)',
                   (user_id, museum_id, visited))
        db.commit()
        return jsonify({'status': 'ok'})

@app.route('/api/user/subscriptions')
def get_subscriptions():
    user_id = request.args.get('user_id')
    if not user_id:
        return jsonify([])
    db = get_db()
    subs = db.execute('''
        SELECT museums.id, museums.name FROM subscriptions
        JOIN museums ON subscriptions.museum_id = museums.id
        WHERE subscriptions.user_id = ?
    ''', (user_id,)).fetchall()
    return jsonify([dict(row) for row in subs])

# ------------------- НОВЫЕ ЭНДПОИНТЫ -------------------
@app.route('/api/events/month')
def get_events_month():
    year = request.args.get('year', type=int)
    month = request.args.get('month', type=int)
    if not year or not month:
        return jsonify({'error': 'Missing year or month'}), 400
    db = get_db()
    events = db.execute('''
        SELECT id, title, date, time, museum_id,
               (SELECT name FROM museums WHERE id = events.museum_id) as museum_name
        FROM events
        WHERE strftime('%Y', date) = ? AND strftime('%m', date) = ?
        ORDER BY date, time
    ''', (str(year), f'{month:02d}')).fetchall()
    return jsonify([dict(row) for row in events])

@app.route('/api/events/date')
def get_events_by_date():
    date = request.args.get('date')
    if not date:
        return jsonify({'error': 'Missing date'}), 400
    db = get_db()
    events = db.execute('''
        SELECT events.*, museums.name as museum_name
        FROM events JOIN museums ON events.museum_id = museums.id
        WHERE date = ?
        ORDER BY time
    ''', (date,)).fetchall()
    return jsonify([dict(row) for row in events])

@app.route('/api/user/events/add', methods=['POST'])
def add_user_event():
    data = request.json
    user_id = data.get('user_id')
    event_id = data.get('event_id')
    if not user_id or not event_id:
        return jsonify({'error': 'Missing data'}), 400
    db = get_db()
    try:
        db.execute('INSERT OR IGNORE INTO user_events (user_id, event_id) VALUES (?, ?)', (user_id, event_id))
        db.commit()
        return jsonify({'status': 'added'})
    except:
        return jsonify({'error': 'Already added'}), 400

@app.route('/api/user/events')
def get_user_events():
    user_id = request.args.get('user_id')
    if not user_id:
        return jsonify([])
    db = get_db()
    events = db.execute('''
        SELECT events.*, museums.name as museum_name
        FROM user_events
        JOIN events ON user_events.event_id = events.id
        JOIN museums ON events.museum_id = museums.id
        WHERE user_events.user_id = ?
        ORDER BY events.date, events.time
    ''', (user_id,)).fetchall()
    return jsonify([dict(row) for row in events])

@app.route('/api/exhibits/subject')
def get_exhibits_by_subject():
    subject = request.args.get('subject')
    db = get_db()
    if subject:
        exhibits = db.execute('SELECT * FROM exhibits WHERE subject = ?', (subject,)).fetchall()
    else:
        exhibits = db.execute('SELECT * FROM exhibits').fetchall()
    return jsonify([dict(row) for row in exhibits])

@app.route('/api/excursions/create', methods=['POST'])
def create_excursion():
    data = request.json
    user_id = data.get('user_id')
    name = data.get('name')
    if not user_id or not name:
        return jsonify({'error': 'Missing data'}), 400
    db = get_db()
    cursor = db.execute('INSERT INTO excursions (user_id, name) VALUES (?, ?)', (user_id, name))
    db.commit()
    return jsonify({'id': cursor.lastrowid, 'name': name})

@app.route('/api/excursions/add_item', methods=['POST'])
def add_excursion_item():
    data = request.json
    excursion_id = data.get('excursion_id')
    exhibit_id = data.get('exhibit_id')
    if not excursion_id or not exhibit_id:
        return jsonify({'error': 'Missing data'}), 400
    db = get_db()
    try:
        db.execute('INSERT OR IGNORE INTO excursion_items (excursion_id, exhibit_id) VALUES (?, ?)',
                   (excursion_id, exhibit_id))
        db.commit()
        return jsonify({'status': 'added'})
    except:
        return jsonify({'error': 'Already added'}), 400

@app.route('/api/user/excursions')
def get_user_excursions():
    user_id = request.args.get('user_id')
    if not user_id:
        return jsonify([])
    db = get_db()
    excursions = db.execute('SELECT * FROM excursions WHERE user_id = ?', (user_id,)).fetchall()
    return jsonify([dict(row) for row in excursions])

@app.route('/api/excursions/<int:excursion_id>')
def get_excursion(excursion_id):
    db = get_db()
    items = db.execute('''
        SELECT exhibits.* FROM excursion_items
        JOIN exhibits ON excursion_items.exhibit_id = exhibits.id
        WHERE excursion_items.excursion_id = ?
    ''', (excursion_id,)).fetchall()
    return jsonify([dict(row) for row in items])

@app.route('/api/excursions/<int:excursion_id>/share')
def share_excursion(excursion_id):
    return jsonify({'url': f'/excursion/{excursion_id}'})

@app.route('/excursion/<int:excursion_id>')
def view_excursion(excursion_id):
    db = get_db()
    items = db.execute('''
        SELECT exhibits.*, museums.name as museum_name FROM excursion_items
        JOIN exhibits ON excursion_items.exhibit_id = exhibits.id
        JOIN museums ON exhibits.museum_id = museums.id
        WHERE excursion_items.excursion_id = ?
    ''', (excursion_id,)).fetchall()
    html = '<html><body><h1>Экскурсия</h1><ul>'
    for item in items:
        html += f'<li><strong>{item["name"]}</strong> – {item["museum_name"]}<br>{item["description"]}</li>'
    html += '</ul></body></html>'
    return html

@app.route('/api/museum/<int:museum_id>/reviews')
def get_museum_reviews(museum_id):
    db = get_db()
    reviews = db.execute('''
        SELECT id, user_id, rating, text, user_name, created_at
        FROM reviews WHERE museum_id = ?
        ORDER BY created_at DESC LIMIT 10
    ''', (museum_id,)).fetchall()
    return jsonify([dict(row) for row in reviews])

@app.route('/api/museum/<int:museum_id>/rating')
def get_museum_rating(museum_id):
    db = get_db()
    avg = db.execute('SELECT AVG(rating) as avg FROM reviews WHERE museum_id = ?', (museum_id,)).fetchone()
    return jsonify({'average': avg['avg'] or 0})

@app.route('/api/reviews/add', methods=['POST'])
def add_review():
    data = request.json
    museum_id = data.get('museum_id')
    user_id = data.get('user_id')
    rating = data.get('rating')
    text = data.get('text')
    user_name = data.get('user_name')
    if not museum_id or not user_id or not rating:
        return jsonify({'error': 'Missing data'}), 400
    db = get_db()
    existing = db.execute('SELECT id FROM reviews WHERE museum_id = ? AND user_id = ?', (museum_id, user_id)).fetchone()
    if existing:
        return jsonify({'error': 'Already reviewed'}), 400
    db.execute('''
        INSERT INTO reviews (museum_id, user_id, rating, text, user_name)
        VALUES (?, ?, ?, ?, ?)
    ''', (museum_id, user_id, rating, text, user_name))
    db.commit()
    return jsonify({'status': 'ok'})

# ------------------- АДМИН-ПАНЕЛЬ (API) -------------------
def admin_required(f):
    from functools import wraps
    @wraps(f)
    def decorated(*args, **kwargs):
        pwd = request.headers.get('X-Admin-Password')
        if pwd != ADMIN_PASSWORD:
            return jsonify({'error': 'Unauthorized'}), 403
        return f(*args, **kwargs)
    return decorated

@app.route('/api/admin/museums', methods=['GET', 'POST', 'PUT', 'DELETE'])
@admin_required
def admin_museums():
    db = get_db()
    if request.method == 'GET':
        museums = db.execute('SELECT * FROM museums').fetchall()
        return jsonify([dict(row) for row in museums])
    elif request.method == 'POST':
        data = request.json
        cursor = db.execute('''
            INSERT INTO museums (name, address, lat, lng, description, contacts, website, cover_photo_url, pushkin_card)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (data['name'], data['address'], data['lat'], data['lng'], data['description'],
              data.get('contacts'), data.get('website'), data.get('cover_photo'), data.get('pushkin_card', 'нет')))
        db.commit()
        return jsonify({'status': 'created', 'id': cursor.lastrowid})
    elif request.method == 'PUT':
        data = request.json
        db.execute('''
            UPDATE museums
            SET name=?, address=?, lat=?, lng=?, description=?, contacts=?, website=?, cover_photo_url=?, pushkin_card=?
            WHERE id=?
        ''', (data['name'], data['address'], data['lat'], data['lng'], data['description'],
              data.get('contacts'), data.get('website'), data.get('cover_photo'), data.get('pushkin_card', 'нет'), data['id']))
        db.commit()
        return jsonify({'status': 'updated'})
    elif request.method == 'DELETE':
        museum_id = request.json.get('id')
        db.execute('DELETE FROM museums WHERE id = ?', (museum_id,))
        db.commit()
        return jsonify({'status': 'deleted'})

@app.route('/api/admin/museum_photos/<int:museum_id>', methods=['GET', 'POST', 'DELETE'])
@admin_required
def admin_museum_photos(museum_id):
    db = get_db()
    if request.method == 'GET':
        photos = db.execute('SELECT id, photo_url FROM museum_photos WHERE museum_id = ? ORDER BY sort_order', (museum_id,)).fetchall()
        return jsonify([dict(row) for row in photos])
    elif request.method == 'POST':
        data = request.json
        photo_url = data.get('photo_url')
        if not photo_url:
            return jsonify({'error': 'No photo_url'}), 400
        db.execute('INSERT INTO museum_photos (museum_id, photo_url) VALUES (?, ?)', (museum_id, photo_url))
        db.commit()
        return jsonify({'status': 'added'})
    elif request.method == 'DELETE':
        photo_id = request.json.get('photo_id')
        db.execute('DELETE FROM museum_photos WHERE id = ? AND museum_id = ?', (photo_id, museum_id))
        db.commit()
        return jsonify({'status': 'deleted'})

@app.route('/api/admin/exhibits', methods=['GET', 'POST', 'PUT', 'DELETE'])
@admin_required
def admin_exhibits():
    db = get_db()
    if request.method == 'GET':
        exhibits = db.execute('SELECT * FROM exhibits').fetchall()
        return jsonify([dict(row) for row in exhibits])
    elif request.method == 'POST':
        data = request.json
        cursor = db.execute('''
            INSERT INTO exhibits (museum_id, name, description, photo_url, subject)
            VALUES (?, ?, ?, ?, ?)
        ''', (data['museum_id'], data['name'], data['description'], data.get('photo_url'), data.get('subject', '')))
        db.commit()
        return jsonify({'status': 'created', 'id': cursor.lastrowid})
    elif request.method == 'PUT':
        data = request.json
        db.execute('''
            UPDATE exhibits SET museum_id=?, name=?, description=?, photo_url=?, subject=?
            WHERE id=?
        ''', (data['museum_id'], data['name'], data['description'], data.get('photo_url'), data.get('subject', ''), data['id']))
        db.commit()
        return jsonify({'status': 'updated'})
    elif request.method == 'DELETE':
        exhibit_id = request.json.get('id')
        db.execute('DELETE FROM exhibits WHERE id = ?', (exhibit_id,))
        db.commit()
        return jsonify({'status': 'deleted'})

@app.route('/api/admin/events', methods=['GET', 'POST', 'PUT', 'DELETE'])
@admin_required
def admin_events():
    db = get_db()
    if request.method == 'GET':
        events = db.execute('SELECT * FROM events').fetchall()
        return jsonify([dict(row) for row in events])
    elif request.method == 'POST':
        data = request.json
        cursor = db.execute('''
            INSERT INTO events (museum_id, title, date, time, description, photo_url)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (data['museum_id'], data['title'], data['date'], data.get('time'), data.get('description'), data.get('photo_url')))
        db.commit()
        return jsonify({'status': 'created', 'id': cursor.lastrowid})
    elif request.method == 'PUT':
        data = request.json
        db.execute('''
            UPDATE events SET museum_id=?, title=?, date=?, time=?, description=?, photo_url=?
            WHERE id=?
        ''', (data['museum_id'], data['title'], data['date'], data.get('time'), data.get('description'), data.get('photo_url'), data['id']))
        db.commit()
        return jsonify({'status': 'updated'})
    elif request.method == 'DELETE':
        event_id = request.json.get('id')
        db.execute('DELETE FROM events WHERE id = ?', (event_id,))
        db.commit()
        return jsonify({'status': 'deleted'})

# ------------------- ОБРАБОТЧИК ВЕБХУКА -------------------
@app.route('/webhook', methods=['POST'])
def webhook():
    data = request.json
    if 'message' in data and 'chat' in data['message']:
        chat_id = data['message']['chat']['id']
        reply_text = "Добро пожаловать! Наше приложение для малых музеев Ставрополья доступно по ссылке:\nhttps://max-museums-app.onrender.com\n\nВы можете найти музеи на карте, подписаться на события и отметить посещения."
        return jsonify({
            'method': 'sendMessage',
            'chat_id': chat_id,
            'text': reply_text
        })
    return jsonify({})

# ------------------- ЗАПУСК -------------------
if __name__ == '__main__':
    # При первом запуске выполняем миграцию (создаём таблицы и поля)
    if not os.path.exists(DATABASE):
        # Если базы нет – создаём с миграцией
        migrate_db()
    else:
        # Если база есть – просто применяем миграцию (добавим недостающие таблицы/поля)
        with app.app_context():
            migrate_db()
    app.run(debug=True, host='0.0.0.0', port=5000)
