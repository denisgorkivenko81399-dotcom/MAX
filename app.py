import sqlite3
import json
import os
import random
from flask import Flask, request, jsonify, render_template, g
from flask_cors import CORS

app = Flask(__name__)
app.secret_key = 'skfu_hackathon_2026'
CORS(app)

# ВАЖНО: Путь к базе данных на постоянном диске Render
DATABASE = '/var/data/museum.db' 
ADMIN_PASSWORD = 'admin123'

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        # Создаем папку, если её нет (для локального тестирования)
        if os.path.dirname(DATABASE):
            os.makedirs(os.path.dirname(DATABASE), exist_ok=True)
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def query_db(query, args=(), one=False):
    cur = get_db().execute(query, args)
    rv = cur.fetchall()
    cur.close()
    return (rv[0] if rv else None) if one else rv

def execute_db(query, args=(), returning=False):
    db = get_db()
    cur = db.execute(query, args)
    db.commit()
    last_id = cur.lastrowid
    cur.close()
    return last_id if returning else None

def migrate_db():
    with app.app_context():
        db = get_db()
        cursor = db.cursor()

        # --- Основные таблицы ---
        cursor.execute('''CREATE TABLE IF NOT EXISTS museums (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, address TEXT, lat REAL, lng REAL, description TEXT, contacts TEXT, website TEXT, cover_photo_url TEXT, pushkin_card TEXT DEFAULT 'нет')''')
        cursor.execute('''CREATE TABLE IF NOT EXISTS museum_photos (id INTEGER PRIMARY KEY AUTOINCREMENT, museum_id INTEGER NOT NULL, photo_url TEXT NOT NULL, sort_order INTEGER DEFAULT 0, FOREIGN KEY (museum_id) REFERENCES museums(id) ON DELETE CASCADE)''')
        cursor.execute('''CREATE TABLE IF NOT EXISTS exhibits (id INTEGER PRIMARY KEY AUTOINCREMENT, museum_id INTEGER NOT NULL, name TEXT NOT NULL, description TEXT, photo_url TEXT, subject TEXT, FOREIGN KEY (museum_id) REFERENCES museums(id) ON DELETE CASCADE)''')
        cursor.execute('''CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, museum_id INTEGER NOT NULL, title TEXT NOT NULL, date TEXT, time TEXT, description TEXT, photo_url TEXT, FOREIGN KEY (museum_id) REFERENCES museums(id) ON DELETE CASCADE)''')
        cursor.execute('''CREATE TABLE IF NOT EXISTS subscriptions (user_id TEXT NOT NULL, museum_id INTEGER NOT NULL, PRIMARY KEY (user_id, museum_id), FOREIGN KEY (museum_id) REFERENCES museums(id) ON DELETE CASCADE)''')
        cursor.execute('''CREATE TABLE IF NOT EXISTS user_visits (user_id TEXT NOT NULL, museum_id INTEGER NOT NULL, visited BOOLEAN DEFAULT 0, PRIMARY KEY (user_id, museum_id), FOREIGN KEY (museum_id) REFERENCES museums(id) ON DELETE CASCADE)''')
        cursor.execute('''CREATE TABLE IF NOT EXISTS user_events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, event_id INTEGER NOT NULL, added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE, UNIQUE(user_id, event_id))''')
        cursor.execute('''CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, museum_id INTEGER NOT NULL, user_id TEXT NOT NULL, rating INTEGER CHECK (rating BETWEEN 1 AND 5), text TEXT, user_name TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (museum_id) REFERENCES museums(id) ON DELETE CASCADE)''')
        cursor.execute('''CREATE TABLE IF NOT EXISTS user_favorites (user_id TEXT NOT NULL, exhibit_id INTEGER NOT NULL, saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_id, exhibit_id), FOREIGN KEY (exhibit_id) REFERENCES exhibits(id) ON DELETE CASCADE)''')
        cursor.execute('''CREATE TABLE IF NOT EXISTS educational_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, content TEXT NOT NULL, photo_url TEXT, museum_id INTEGER, author TEXT DEFAULT 'Сотрудник музея', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (museum_id) REFERENCES museums(id) ON DELETE SET NULL)''')
        cursor.execute('''CREATE TABLE IF NOT EXISTS post_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL, user_id TEXT NOT NULL, user_name TEXT, text TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (post_id) REFERENCES educational_posts(id) ON DELETE CASCADE)''')

        # Проверка полей (на случай обновления со старой версии)
        cursor.execute("PRAGMA table_info(events)")
        if 'time' not in [col[1] for col in cursor.fetchall()]:
            cursor.execute('ALTER TABLE events ADD COLUMN time TEXT')
        cursor.execute("PRAGMA table_info(exhibits)")
        if 'subject' not in [col[1] for col in cursor.fetchall()]:
            cursor.execute('ALTER TABLE exhibits ADD COLUMN subject TEXT')

        db.commit()
        cursor.close()

        # Загрузка seed, если пусто
        count = query_db("SELECT COUNT(*) as cnt FROM museums", one=True)
        if count and count['cnt'] == 0:
            load_seed_data(db)

def load_seed_data(db):
    try:
        with open('seed_data.json', 'r', encoding='utf-8') as f:
            data = json.load(f)
        cursor = db.cursor()
        for museum in data['museums']:
            cursor.execute('''INSERT INTO museums (name, address, lat, lng, description, contacts, website, cover_photo_url, pushkin_card) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''', 
                           (museum['name'], museum['address'], museum['lat'], museum['lng'], museum['description'], museum.get('contacts'), museum.get('website'), museum.get('cover_photo'), museum.get('pushkin_card', 'нет')))
            museum_id = cursor.lastrowid
            
            for photo_url in museum.get('photos', []):
                cursor.execute('INSERT INTO museum_photos (museum_id, photo_url, sort_order) VALUES (?, ?, ?)', (museum_id, photo_url, 0))
            for ex in museum.get('exhibits', []):
                cursor.execute('INSERT INTO exhibits (museum_id, name, description, photo_url, subject) VALUES (?, ?, ?, ?, ?)', (museum_id, ex['name'], ex['description'], ex.get('photo_url', ''), ex.get('subject', '')))
            for ev in museum.get('events', []):
                cursor.execute('INSERT INTO events (museum_id, title, date, time, description, photo_url) VALUES (?, ?, ?, ?, ?, ?)', (museum_id, ev['title'], ev['date'], ev.get('time', ''), ev.get('description', ''), ev.get('photo_url', '')))
        db.commit()
        cursor.close()
    except Exception as e:
        print(f"Ошибка загрузки seed_data.json: {e}")

# ================== API ДЛЯ ПОСЕТИТЕЛЕЙ ==================
@app.route('/')
def index(): return render_template('index.html')

@app.route('/admin')
def admin_panel(): return render_template('admin.html')

@app.route('/api/museums')
def get_museums():
    return jsonify([dict(row) for row in query_db('SELECT * FROM museums ORDER BY id')])

@app.route('/api/museum_photos/<int:museum_id>')
def get_museum_photos(museum_id):
    photos = query_db('SELECT photo_url FROM museum_photos WHERE museum_id = ? ORDER BY sort_order', (museum_id,))
    return jsonify([p['photo_url'] for p in photos])

@app.route('/api/exhibits/<int:museum_id>')
def get_exhibits(museum_id):
    return jsonify([dict(row) for row in query_db('SELECT * FROM exhibits WHERE museum_id = ?', (museum_id,))])

@app.route('/api/exhibits')
def get_all_exhibits():
    return jsonify([dict(row) for row in query_db('SELECT * FROM exhibits')])

@app.route('/api/events')
def get_events():
    user_id = request.args.get('user_id')
    if user_id:
        subs = query_db('SELECT museum_id FROM subscriptions WHERE user_id = ?', (user_id,))
        if subs:
            museum_ids = [s['museum_id'] for s in subs]
            placeholders = ','.join(['?'] * len(museum_ids))
            events = query_db(f'''
                SELECT events.*, museums.name AS museum_name
                FROM events JOIN museums ON events.museum_id = museums.id
                WHERE events.museum_id IN ({placeholders})
                ORDER BY events.date DESC, events.time
            ''', tuple(museum_ids))
        else:
            events = []
    else:
        events = query_db('''
            SELECT events.*, museums.name AS museum_name
            FROM events JOIN museums ON events.museum_id = museums.id
            ORDER BY events.date DESC, events.time
        ''')
    return jsonify([dict(row) for row in events])

@app.route('/api/events/month')
def get_events_month():
    year = request.args.get('year', type=int)
    month = request.args.get('month', type=int)
    if not year or not month:
        return jsonify({'error': 'Missing year or month'}), 400
    pattern = f'{year}-{month:02d}%'
    events = query_db('''
        SELECT id, title, date, time, museum_id,
               (SELECT name FROM museums WHERE id = events.museum_id) AS museum_name
        FROM events WHERE date LIKE ? ORDER BY date, time
    ''', (pattern,))
    return jsonify([dict(row) for row in events])

@app.route('/api/events/date')
def get_events_by_date():
    date = request.args.get('date')
    if not date:
        return jsonify({'error': 'Missing date'}), 400
    events = query_db('''
        SELECT events.*, museums.name AS museum_name
        FROM events JOIN museums ON events.museum_id = museums.id
        WHERE date = ? ORDER BY time
    ''', (date,))
    return jsonify([dict(row) for row in events])

@app.route('/api/subscribe', methods=['POST'])
def subscribe():
    data = request.json
    user_id, museum_id = data.get('user_id'), data.get('museum_id')
    if not user_id or not museum_id:
        return jsonify({'error': 'Missing data'}), 400
    execute_db('INSERT OR REPLACE INTO subscriptions (user_id, museum_id) VALUES (?, ?)', (user_id, museum_id))
    return jsonify({'status': 'subscribed'})

@app.route('/api/unsubscribe', methods=['POST'])
def unsubscribe():
    data = request.json
    execute_db('DELETE FROM subscriptions WHERE user_id = ? AND museum_id = ?', (data.get('user_id'), data.get('museum_id')))
    return jsonify({'status': 'unsubscribed'})

@app.route('/api/visits', methods=['GET', 'POST'])
def visits():
    if request.method == 'GET':
        user_id = request.args.get('user_id')
        if not user_id:
            return jsonify({'error': 'No user_id'}), 400
        return jsonify([dict(row) for row in query_db('SELECT museum_id, visited FROM user_visits WHERE user_id = ?', (user_id,))])
    else:
        data = request.json
        execute_db('INSERT OR REPLACE INTO user_visits (user_id, museum_id, visited) VALUES (?, ?, ?)', (data.get('user_id'), data.get('museum_id'), data.get('visited', 1)))
        return jsonify({'status': 'ok'})

@app.route('/api/user/subscriptions')
def get_subscriptions():
    user_id = request.args.get('user_id')
    if not user_id:
        return jsonify([])
    return jsonify([dict(row) for row in query_db('''
        SELECT museums.id, museums.name FROM subscriptions
        JOIN museums ON subscriptions.museum_id = museums.id
        WHERE subscriptions.user_id = ?
    ''', (user_id,))])

# --- Избранное ---
@app.route('/api/favorites/add', methods=['POST'])
def add_favorite():
    data = request.json
    execute_db('INSERT OR IGNORE INTO user_favorites (user_id, exhibit_id) VALUES (?, ?)', (data.get('user_id'), data.get('exhibit_id')))
    return jsonify({'status': 'added'})

@app.route('/api/favorites/remove', methods=['POST'])
def remove_favorite():
    data = request.json
    execute_db('DELETE FROM user_favorites WHERE user_id = ? AND exhibit_id = ?', (data.get('user_id'), data.get('exhibit_id')))
    return jsonify({'status': 'removed'})

@app.route('/api/favorites')
def get_favorites():
    user_id = request.args.get('user_id')
    if not user_id:
        return jsonify([])
    return jsonify([f['exhibit_id'] for f in query_db('SELECT exhibit_id FROM user_favorites WHERE user_id = ?', (user_id,))])

# --- Образовательные посты и комментарии ---
@app.route('/api/educational/posts')
def get_educational_posts():
    posts = query_db('''
        SELECT educational_posts.*, museums.name AS museum_name,
               (SELECT COUNT(*) FROM post_comments WHERE post_id = educational_posts.id) AS comments_count
        FROM educational_posts
        LEFT JOIN museums ON educational_posts.museum_id = museums.id
        ORDER BY educational_posts.created_at DESC
    ''')
    return jsonify([dict(row) for row in posts])

@app.route('/api/educational/posts/<int:post_id>/comments', methods=['GET'])
def get_post_comments(post_id):
    return jsonify([dict(row) for row in query_db('SELECT * FROM post_comments WHERE post_id = ? ORDER BY created_at ASC', (post_id,))])

@app.route('/api/educational/posts/<int:post_id>/comments', methods=['POST'])
def add_post_comment(post_id):
    data = request.json
    text = (data.get('text') or '').strip()
    user_id = data.get('user_id')
    user_name = (data.get('user_name') or '').strip() or 'Аноним'
    if not user_id or not text:
        return jsonify({'error': 'Missing data'}), 400
    new_id = execute_db('INSERT INTO post_comments (post_id, user_id, user_name, text) VALUES (?, ?, ?, ?)', (post_id, user_id, user_name, text), returning=True)
    return jsonify({'status': 'created', 'id': new_id})

@app.route('/api/exhibit/today')
def get_today_exhibit():
    exhibits = query_db('SELECT * FROM exhibits WHERE description IS NOT NULL AND description != ""')
    if not exhibits:
        exhibits = query_db('SELECT * FROM exhibits')
        if not exhibits:
            return jsonify({})
    exhibit = random.choice(exhibits)
    museum = query_db('SELECT name FROM museums WHERE id = ?', (exhibit['museum_id'],), one=True)
    result = dict(exhibit)
    result['museum_name'] = museum['name'] if museum else ''
    if result.get('description') and len(result['description']) > 200:
        result['description'] = result['description'][:200] + '...'
    return jsonify(result)

# ================== АДМИН-ПАНЕЛЬ ==================
def admin_required(f):
    from functools import wraps
    @wraps(f)
    def decorated(*args, **kwargs):
        if request.headers.get('X-Admin-Password') != ADMIN_PASSWORD:
            return jsonify({'error': 'Unauthorized'}), 403
        return f(*args, **kwargs)
    return decorated

@app.route('/api/admin/museums', methods=['GET', 'POST', 'PUT', 'DELETE'])
@admin_required
def admin_museums():
    if request.method == 'GET':
        return jsonify([dict(row) for row in query_db('SELECT * FROM museums ORDER BY id')])
    elif request.method == 'POST':
        d = request.json
        new_id = execute_db('''
            INSERT INTO museums (name, address, lat, lng, description, contacts, website, cover_photo_url, pushkin_card)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (d['name'], d['address'], d['lat'], d['lng'], d['description'],
              d.get('contacts'), d.get('website'), d.get('cover_photo'), d.get('pushkin_card', 'нет')), returning=True)
        return jsonify({'status': 'created', 'id': new_id})
    elif request.method == 'PUT':
        d = request.json
        execute_db('''
            UPDATE museums SET name=?, address=?, lat=?, lng=?, description=?,
                contacts=?, website=?, cover_photo_url=?, pushkin_card=?
            WHERE id=?
        ''', (d['name'], d['address'], d['lat'], d['lng'], d['description'],
              d.get('contacts'), d.get('website'), d.get('cover_photo'),
              d.get('pushkin_card', 'нет'), d['id']))
        return jsonify({'status': 'updated'})
    elif request.method == 'DELETE':
        execute_db('DELETE FROM museums WHERE id = ?', (request.json.get('id'),))
        return jsonify({'status': 'deleted'})

@app.route('/api/admin/museum_photos/<int:museum_id>', methods=['GET', 'POST', 'DELETE'])
@admin_required
def admin_museum_photos(museum_id):
    if request.method == 'GET':
        return jsonify([dict(row) for row in query_db('SELECT id, photo_url FROM museum_photos WHERE museum_id = ? ORDER BY sort_order', (museum_id,))])
    elif request.method == 'POST':
        p = request.json.get('photo_url')
        if not p:
            return jsonify({'error': 'No photo_url'}), 400
        execute_db('INSERT INTO museum_photos (museum_id, photo_url) VALUES (?, ?)', (museum_id, p))
        return jsonify({'status': 'added'})
    elif request.method == 'DELETE':
        execute_db('DELETE FROM museum_photos WHERE id = ? AND museum_id = ?', (request.json.get('photo_id'), museum_id))
        return jsonify({'status': 'deleted'})

@app.route('/api/admin/exhibits', methods=['GET', 'POST', 'PUT', 'DELETE'])
@admin_required
def admin_exhibits():
    if request.method == 'GET':
        return jsonify([dict(row) for row in query_db('SELECT * FROM exhibits ORDER BY id')])
    elif request.method == 'POST':
        d = request.json
        new_id = execute_db('''
            INSERT INTO exhibits (museum_id, name, description, photo_url, subject)
            VALUES (?, ?, ?, ?, ?)
        ''', (d['museum_id'], d['name'], d['description'], d.get('photo_url'), d.get('subject', '')), returning=True)
        return jsonify({'status': 'created', 'id': new_id})
    elif request.method == 'PUT':
        d = request.json
        execute_db('''UPDATE exhibits SET museum_id=?, name=?, description=?, photo_url=?, subject=? WHERE id=?''',
                   (d['museum_id'], d['name'], d['description'], d.get('photo_url'), d.get('subject', ''), d['id']))
        return jsonify({'status': 'updated'})
    elif request.method == 'DELETE':
        execute_db('DELETE FROM exhibits WHERE id = ?', (request.json.get('id'),))
        return jsonify({'status': 'deleted'})

@app.route('/api/admin/events', methods=['GET', 'POST', 'PUT', 'DELETE'])
@admin_required
def admin_events():
    if request.method == 'GET':
        return jsonify([dict(row) for row in query_db('SELECT * FROM events ORDER BY id')])
    elif request.method == 'POST':
        d = request.json
        new_id = execute_db('''
            INSERT INTO events (museum_id, title, date, time, description, photo_url)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (d['museum_id'], d['title'], d['date'], d.get('time'), d.get('description'), d.get('photo_url')), returning=True)
        return jsonify({'status': 'created', 'id': new_id})
    elif request.method == 'PUT':
        d = request.json
        execute_db('''UPDATE events SET museum_id=?, title=?, date=?, time=?, description=?, photo_url=? WHERE id=?''',
                   (d['museum_id'], d['title'], d['date'], d.get('time'), d.get('description'), d.get('photo_url'), d['id']))
        return jsonify({'status': 'updated'})
    elif request.method == 'DELETE':
        execute_db('DELETE FROM events WHERE id = ?', (request.json.get('id'),))
        return jsonify({'status': 'deleted'})

@app.route('/api/admin/educational_posts', methods=['GET', 'POST', 'PUT', 'DELETE'])
@admin_required
def admin_educational_posts():
    if request.method == 'GET':
        return jsonify([dict(row) for row in query_db('SELECT * FROM educational_posts ORDER BY created_at DESC')])
    elif request.method == 'POST':
        d = request.json
        new_id = execute_db('''
            INSERT INTO educational_posts (title, content, photo_url, museum_id, author)
            VALUES (?, ?, ?, ?, ?)
        ''', (d['title'], d['content'], d.get('photo_url'), d.get('museum_id') or None, d.get('author', 'Сотрудник музея')), returning=True)
        return jsonify({'status': 'created', 'id': new_id})
    elif request.method == 'PUT':
        d = request.json
        execute_db('''UPDATE educational_posts SET title=?, content=?, photo_url=?, museum_id=?, author=? WHERE id=?''',
                   (d['title'], d['content'], d.get('photo_url'), d.get('museum_id') or None, d.get('author', 'Сотрудник музея'), d['id']))
        return jsonify({'status': 'updated'})
    elif request.method == 'DELETE':
        execute_db('DELETE FROM educational_posts WHERE id = ?', (request.json.get('id'),))
        return jsonify({'status': 'deleted'})

# --- Дополнительные обработчики (Отзывы, События пользователя) ---
@app.route('/api/user/events/add', methods=['POST'])
def add_user_event():
    d = request.json
    if not d.get('user_id') or not d.get('event_id'):
        return jsonify({'error': 'Missing data'}), 400
    execute_db('INSERT OR IGNORE INTO user_events (user_id, event_id) VALUES (?, ?)', (d['user_id'], d['event_id']))
    return jsonify({'status': 'added'})

@app.route('/api/user/events')
def get_user_events():
    user_id = request.args.get('user_id')
    if not user_id:
        return jsonify([])
    return jsonify([dict(row) for row in query_db('''
        SELECT events.*, museums.name AS museum_name
        FROM user_events JOIN events ON user_events.event_id = events.id
        JOIN museums ON events.museum_id = museums.id
        WHERE user_events.user_id = ? ORDER BY events.date, events.time
    ''', (user_id,))])

@app.route('/api/museum/<int:museum_id>/reviews')
def get_museum_reviews(museum_id):
    return jsonify([dict(row) for row in query_db('''
        SELECT id, user_id, rating, text, user_name, created_at
        FROM reviews WHERE museum_id = ? ORDER BY created_at DESC LIMIT 10
    ''', (museum_id,))])

@app.route('/api/museum/<int:museum_id>/rating')
def get_museum_rating(museum_id):
    row = query_db('SELECT AVG(rating) AS avg FROM reviews WHERE museum_id = ?', (museum_id,), one=True)
    avg = float(row['avg']) if row and row['avg'] is not None else 0
    return jsonify({'average': avg})

@app.route('/api/reviews/add', methods=['POST'])
def add_review():
    d = request.json
    if not d.get('museum_id') or not d.get('user_id') or not d.get('rating'):
        return jsonify({'error': 'Missing data'}), 400
    existing = query_db('SELECT id FROM reviews WHERE museum_id = ? AND user_id = ?', (d['museum_id'], d['user_id']), one=True)
    if existing:
        return jsonify({'error': 'Already reviewed'}), 400
    execute_db('''INSERT INTO reviews (museum_id, user_id, rating, text, user_name) VALUES (?, ?, ?, ?, ?)''',
               (d['museum_id'], d['user_id'], d['rating'], d.get('text'), d.get('user_name')))
    return jsonify({'status': 'ok'})

@app.route('/webhook', methods=['POST'])
def webhook():
    data = request.json
    if 'message' in data and 'chat' in data['message']:
        return jsonify({'method': 'sendMessage', 'chat_id': data['message']['chat']['id'], 'text': "Приложение доступно по ссылке: https://max-5-qu3i.onrender.com"})
    return jsonify({})

if __name__ == '__main__':
    with app.app_context():
        migrate_db()
    app.run(debug=True, host='0.0.0.0', port=5000)
