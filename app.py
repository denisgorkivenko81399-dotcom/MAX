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

def init_db():
    with app.app_context():
        db = get_db()
        cursor = db.cursor()
        # Таблица музеев
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
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS museum_photos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                museum_id INTEGER NOT NULL,
                photo_url TEXT NOT NULL,
                sort_order INTEGER DEFAULT 0,
                FOREIGN KEY (museum_id) REFERENCES museums(id) ON DELETE CASCADE
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS exhibits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                museum_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                photo_url TEXT,
                FOREIGN KEY (museum_id) REFERENCES museums(id) ON DELETE CASCADE
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                museum_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                date TEXT,
                description TEXT,
                photo_url TEXT,
                FOREIGN KEY (museum_id) REFERENCES museums(id) ON DELETE CASCADE
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS subscriptions (
                user_id TEXT NOT NULL,
                museum_id INTEGER NOT NULL,
                PRIMARY KEY (user_id, museum_id),
                FOREIGN KEY (museum_id) REFERENCES museums(id) ON DELETE CASCADE
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS user_visits (
                user_id TEXT NOT NULL,
                museum_id INTEGER NOT NULL,
                visited BOOLEAN DEFAULT 0,
                PRIMARY KEY (user_id, museum_id),
                FOREIGN KEY (museum_id) REFERENCES museums(id) ON DELETE CASCADE
            )
        ''')
        db.commit()

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
              museum['description'], museum.get('contacts'), museum.get('website'), museum.get('cover_photo'), museum.get('pushkin_card', 'нет')))
        museum_id = cursor.lastrowid
        for photo_url in museum.get('photos', []):
            cursor.execute('INSERT INTO museum_photos (museum_id, photo_url, sort_order) VALUES (?, ?, ?)',
                           (museum_id, photo_url, 0))
        for ex in museum.get('exhibits', []):
            cursor.execute('''
                INSERT INTO exhibits (museum_id, name, description, photo_url)
                VALUES (?, ?, ?, ?)
            ''', (museum_id, ex['name'], ex['description'], ex.get('photo_url', '')))
        for ev in museum.get('events', []):
            cursor.execute('''
                INSERT INTO events (museum_id, title, date, description, photo_url)
                VALUES (?, ?, ?, ?, ?)
            ''', (museum_id, ev['title'], ev['date'], ev['description'], ev.get('photo_url', '')))
    db.commit()

# ------------------- API для посетителей -------------------
@app.route('/')
def index():
    return render_template('index.html')

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
                ORDER BY events.date DESC
            ''', museum_ids).fetchall()
        else:
            events = []
    else:
        events = db.execute('''
            SELECT events.*, museums.name as museum_name
            FROM events JOIN museums ON events.museum_id = museums.id
            ORDER BY events.date DESC
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

# ------------------- Админ API -------------------
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
            INSERT INTO exhibits (museum_id, name, description, photo_url)
            VALUES (?, ?, ?, ?)
        ''', (data['museum_id'], data['name'], data['description'], data.get('photo_url')))
        db.commit()
        return jsonify({'status': 'created', 'id': cursor.lastrowid})
    elif request.method == 'PUT':
        data = request.json
        db.execute('''
            UPDATE exhibits SET museum_id=?, name=?, description=?, photo_url=?
            WHERE id=?
        ''', (data['museum_id'], data['name'], data['description'], data.get('photo_url'), data['id']))
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
            INSERT INTO events (museum_id, title, date, description, photo_url)
            VALUES (?, ?, ?, ?, ?)
        ''', (data['museum_id'], data['title'], data['date'], data['description'], data.get('photo_url')))
        db.commit()
        return jsonify({'status': 'created', 'id': cursor.lastrowid})
    elif request.method == 'PUT':
        data = request.json
        db.execute('''
            UPDATE events SET museum_id=?, title=?, date=?, description=?, photo_url=?
            WHERE id=?
        ''', (data['museum_id'], data['title'], data['date'], data['description'], data.get('photo_url'), data['id']))
        db.commit()
        return jsonify({'status': 'updated'})
    elif request.method == 'DELETE':
        event_id = request.json.get('id')
        db.execute('DELETE FROM events WHERE id = ?', (event_id,))
        db.commit()
        return jsonify({'status': 'deleted'})

# ---------- НОВЫЙ ОБРАБОТЧИК ДЛЯ БОТА ----------
@app.route('/webhook', methods=['POST'])
def webhook():
    data = request.json
    # Проверяем, что есть сообщение
    if 'message' in data and 'chat' in data['message']:
        chat_id = data['message']['chat']['id']
        # Ответное сообщение
        reply_text = "Добро пожаловать! Наше приложение для малых музеев Ставрополья доступно по ссылке:\nhttps://max-museums-app.onrender.com\n\nВы можете найти музеи на карте, подписаться на события и отметить посещения."
        return jsonify({
            'method': 'sendMessage',
            'chat_id': chat_id,
            'text': reply_text
        })
    else:
        # Если что-то не так, просто ничего не отвечаем
        return jsonify({})

if __name__ == '__main__':
    if not os.path.exists(DATABASE):
        init_db()
    app.run(debug=True, host='0.0.0.0', port=5000)
