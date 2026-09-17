import psycopg
from psycopg.rows import dict_row
import json
import os
import random
from flask import Flask, request, jsonify, render_template, g
from flask_cors import CORS

app = Flask(__name__)
app.secret_key = 'skfu_hackathon_2026'
CORS(app)

DATABASE_URL = os.environ.get(
    'DATABASE_URL',
    'postgresql://postgres:bXM-8HX-ugU-DPb@db.sbhddpypsqkxxdooipbf.supabase.co:5432/postgres?sslmode=require'
)
ADMIN_PASSWORD = 'admin123'


def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = psycopg.connect(DATABASE_URL)
    return db


@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()


def query_db(query, args=(), one=False):
    conn = get_db()
    cur = conn.cursor(row_factory=dict_row)
    cur.execute(query, args)
    rv = cur.fetchall()
    cur.close()
    if one:
        return rv[0] if rv else None
    return rv


def execute_db(query, args=(), returning=False):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(query, args)
    conn.commit()
    result = None
    if returning:
        try:
            result = cur.fetchone()
        except Exception:
            result = None
    cur.close()
    return result


def migrate_db():
    conn = get_db()
    cur = conn.cursor()
    cur.execute('''
        CREATE TABLE IF NOT EXISTS post_comments (
            id SERIAL PRIMARY KEY,
            post_id INTEGER NOT NULL REFERENCES educational_posts(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL,
            user_name TEXT,
            text TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    cur.close()

    row = query_db("SELECT COUNT(*) as cnt FROM museums", one=True)
    if row and row['cnt'] == 0:
        load_seed_data(conn)


def load_seed_data(conn):
    with open('seed_data.json', 'r', encoding='utf-8') as f:
        data = json.load(f)
    cur = conn.cursor()
    for museum in data['museums']:
        cur.execute('''
            INSERT INTO museums (name, address, lat, lng, description, contacts, website, cover_photo_url, pushkin_card)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
        ''', (museum['name'], museum['address'], museum['lat'], museum['lng'],
              museum['description'], museum.get('contacts'), museum.get('website'),
              museum.get('cover_photo'), museum.get('pushkin_card', 'нет')))
        museum_id = cur.fetchone()[0]
        for photo_url in museum.get('photos', []):
            cur.execute(
                'INSERT INTO museum_photos (museum_id, photo_url, sort_order) VALUES (%s, %s, %s)',
                (museum_id, photo_url, 0)
            )
        for ex in museum.get('exhibits', []):
            cur.execute('''
                INSERT INTO exhibits (museum_id, name, description, photo_url, subject)
                VALUES (%s, %s, %s, %s, %s)
            ''', (museum_id, ex['name'], ex['description'], ex.get('photo_url', ''), ex.get('subject', '')))
        for ev in museum.get('events', []):
            cur.execute('''
                INSERT INTO events (museum_id, title, date, time, description, photo_url)
                VALUES (%s, %s, %s, %s, %s, %s)
            ''', (museum_id, ev['title'], ev['date'], ev.get('time', ''), ev.get('description', ''), ev.get('photo_url', '')))
    conn.commit()
    cur.close()


# ---------------- ПОСЕТИТЕЛИ ----------------

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/admin')
def admin_panel():
    return render_template('admin.html')


@app.route('/api/museums')
def get_museums():
    return jsonify(query_db('SELECT * FROM museums ORDER BY id'))


@app.route('/api/museum_photos/<int:museum_id>')
def get_museum_photos(museum_id):
    photos = query_db('SELECT photo_url FROM museum_photos WHERE museum_id = %s ORDER BY sort_order', (museum_id,))
    return jsonify([p['photo_url'] for p in photos])


@app.route('/api/exhibits/<int:museum_id>')
def get_exhibits(museum_id):
    return jsonify(query_db('SELECT * FROM exhibits WHERE museum_id = %s', (museum_id,)))


@app.route('/api/exhibits')
def get_all_exhibits():
    return jsonify(query_db('SELECT * FROM exhibits'))


@app.route('/api/events')
def get_events():
    user_id = request.args.get('user_id')
    if user_id:
        subs = query_db('SELECT museum_id FROM subscriptions WHERE user_id = %s', (user_id,))
        if subs:
            museum_ids = [s['museum_id'] for s in subs]
            placeholders = ','.join(['%s'] * len(museum_ids))
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
    return jsonify(events)


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
        FROM events WHERE date LIKE %s ORDER BY date, time
    ''', (pattern,))
    return jsonify(events)


@app.route('/api/events/date')
def get_events_by_date():
    date = request.args.get('date')
    if not date:
        return jsonify({'error': 'Missing date'}), 400
    events = query_db('''
        SELECT events.*, museums.name AS museum_name
        FROM events JOIN museums ON events.museum_id = museums.id
        WHERE date = %s ORDER BY time
    ''', (date,))
    return jsonify(events)


@app.route('/api/subscribe', methods=['POST'])
def subscribe():
    data = request.json
    user_id, museum_id = data.get('user_id'), data.get('museum_id')
    if not user_id or not museum_id:
        return jsonify({'error': 'Missing data'}), 400
    execute_db('INSERT INTO subscriptions (user_id, museum_id) VALUES (%s, %s) ON CONFLICT DO NOTHING',
               (user_id, museum_id))
    return jsonify({'status': 'subscribed'})


@app.route('/api/unsubscribe', methods=['POST'])
def unsubscribe():
    data = request.json
    execute_db('DELETE FROM subscriptions WHERE user_id = %s AND museum_id = %s',
               (data.get('user_id'), data.get('museum_id')))
    return jsonify({'status': 'unsubscribed'})


@app.route('/api/visits', methods=['GET', 'POST'])
def visits():
    if request.method == 'GET':
        user_id = request.args.get('user_id')
        if not user_id:
            return jsonify({'error': 'No user_id'}), 400
        return jsonify(query_db('SELECT museum_id, visited FROM user_visits WHERE user_id = %s', (user_id,)))
    else:
        data = request.json
        execute_db('''
            INSERT INTO user_visits (user_id, museum_id, visited)
            VALUES (%s, %s, %s)
            ON CONFLICT (user_id, museum_id) DO UPDATE SET visited = EXCLUDED.visited
        ''', (data.get('user_id'), data.get('museum_id'), bool(data.get('visited', 1))))
        return jsonify({'status': 'ok'})


@app.route('/api/user/subscriptions')
def get_subscriptions():
    user_id = request.args.get('user_id')
    if not user_id:
        return jsonify([])
    return jsonify(query_db('''
        SELECT museums.id, museums.name FROM subscriptions
        JOIN museums ON subscriptions.museum_id = museums.id
        WHERE subscriptions.user_id = %s
    ''', (user_id,)))


# ---------------- ИЗБРАННОЕ ----------------

@app.route('/api/favorites/add', methods=['POST'])
def add_favorite():
    data = request.json
    execute_db('INSERT INTO user_favorites (user_id, exhibit_id) VALUES (%s, %s) ON CONFLICT DO NOTHING',
               (data.get('user_id'), data.get('exhibit_id')))
    return jsonify({'status': 'added'})


@app.route('/api/favorites/remove', methods=['POST'])
def remove_favorite():
    data = request.json
    execute_db('DELETE FROM user_favorites WHERE user_id = %s AND exhibit_id = %s',
               (data.get('user_id'), data.get('exhibit_id')))
    return jsonify({'status': 'removed'})


@app.route('/api/favorites')
def get_favorites():
    user_id = request.args.get('user_id')
    if not user_id:
        return jsonify([])
    return jsonify([f['exhibit_id'] for f in query_db(
        'SELECT exhibit_id FROM user_favorites WHERE user_id = %s', (user_id,))])


# ---------------- ОБРАЗОВАТЕЛЬНЫЕ ПОСТЫ ----------------

@app.route('/api/educational/posts')
def get_educational_posts():
    posts = query_db('''
        SELECT educational_posts.*, museums.name AS museum_name,
               (SELECT COUNT(*) FROM post_comments WHERE post_id = educational_posts.id) AS comments_count
        FROM educational_posts
        LEFT JOIN museums ON educational_posts.museum_id = museums.id
        ORDER BY educational_posts.created_at DESC
    ''')
    return jsonify(posts)


@app.route('/api/educational/posts/<int:post_id>/comments', methods=['GET'])
def get_post_comments(post_id):
    return jsonify(query_db(
        'SELECT * FROM post_comments WHERE post_id = %s ORDER BY created_at ASC', (post_id,)))


@app.route('/api/educational/posts/<int:post_id>/comments', methods=['POST'])
def add_post_comment(post_id):
    data = request.json
    text = (data.get('text') or '').strip()
    user_id = data.get('user_id')
    user_name = (data.get('user_name') or '').strip() or 'Аноним'
    if not user_id or not text:
        return jsonify({'error': 'Missing data'}), 400
    row = execute_db('''
        INSERT INTO post_comments (post_id, user_id, user_name, text)
        VALUES (%s, %s, %s, %s) RETURNING id
    ''', (post_id, user_id, user_name, text), returning=True)
    return jsonify({'status': 'created', 'id': row[0] if row else None})


@app.route('/api/exhibit/today')
def get_today_exhibit():
    exhibits = query_db('SELECT * FROM exhibits WHERE description IS NOT NULL AND description != %s', ('',))
    if not exhibits:
        exhibits = query_db('SELECT * FROM exhibits')
        if not exhibits:
            return jsonify({})
    exhibit = random.choice(exhibits)
    museum = query_db('SELECT name FROM museums WHERE id = %s', (exhibit['museum_id'],), one=True)
    result = dict(exhibit)
    result['museum_name'] = museum['name'] if museum else ''
    if result.get('description') and len(result['description']) > 200:
        result['description'] = result['description'][:200] + '...'
    return jsonify(result)


# ---------------- АДМИН ----------------

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
        return jsonify(query_db('SELECT * FROM museums ORDER BY id'))
    elif request.method == 'POST':
        d = request.json
        row = execute_db('''
            INSERT INTO museums (name, address, lat, lng, description, contacts, website, cover_photo_url, pushkin_card)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
        ''', (d['name'], d['address'], d['lat'], d['lng'], d['description'],
              d.get('contacts'), d.get('website'), d.get('cover_photo'), d.get('pushkin_card', 'нет')),
            returning=True)
        return jsonify({'status': 'created', 'id': row[0] if row else None})
    elif request.method == 'PUT':
        d = request.json
        execute_db('''
            UPDATE museums SET name=%s, address=%s, lat=%s, lng=%s, description=%s,
                contacts=%s, website=%s, cover_photo_url=%s, pushkin_card=%s
            WHERE id=%s
        ''', (d['name'], d['address'], d['lat'], d['lng'], d['description'],
              d.get('contacts'), d.get('website'), d.get('cover_photo'),
              d.get('pushkin_card', 'нет'), d['id']))
        return jsonify({'status': 'updated'})
    elif request.method == 'DELETE':
        execute_db('DELETE FROM museums WHERE id = %s', (request.json.get('id'),))
        return jsonify({'status': 'deleted'})


@app.route('/api/admin/museum_photos/<int:museum_id>', methods=['GET', 'POST', 'DELETE'])
@admin_required
def admin_museum_photos(museum_id):
    if request.method == 'GET':
        return jsonify(query_db(
            'SELECT id, photo_url FROM museum_photos WHERE museum_id = %s ORDER BY sort_order',
            (museum_id,)))
    elif request.method == 'POST':
        p = request.json.get('photo_url')
        if not p:
            return jsonify({'error': 'No photo_url'}), 400
        execute_db('INSERT INTO museum_photos (museum_id, photo_url) VALUES (%s, %s)', (museum_id, p))
        return jsonify({'status': 'added'})
    elif request.method == 'DELETE':
        execute_db('DELETE FROM museum_photos WHERE id = %s AND museum_id = %s',
                   (request.json.get('photo_id'), museum_id))
        return jsonify({'status': 'deleted'})


@app.route('/api/admin/exhibits', methods=['GET', 'POST', 'PUT', 'DELETE'])
@admin_required
def admin_exhibits():
    if request.method == 'GET':
        return jsonify(query_db('SELECT * FROM exhibits ORDER BY id'))
    elif request.method == 'POST':
        d = request.json
        row = execute_db('''
            INSERT INTO exhibits (museum_id, name, description, photo_url, subject)
            VALUES (%s, %s, %s, %s, %s) RETURNING id
        ''', (d['museum_id'], d['name'], d['description'],
              d.get('photo_url'), d.get('subject', '')), returning=True)
        return jsonify({'status': 'created', 'id': row[0] if row else None})
    elif request.method == 'PUT':
        d = request.json
        execute_db('''UPDATE exhibits SET museum_id=%s, name=%s, description=%s, photo_url=%s, subject=%s
                      WHERE id=%s''',
                   (d['museum_id'], d['name'], d['description'],
                    d.get('photo_url'), d.get('subject', ''), d['id']))
        return jsonify({'status': 'updated'})
    elif request.method == 'DELETE':
        execute_db('DELETE FROM exhibits WHERE id = %s', (request.json.get('id'),))
        return jsonify({'status': 'deleted'})


@app.route('/api/admin/events', methods=['GET', 'POST', 'PUT', 'DELETE'])
@admin_required
def admin_events():
    if request.method == 'GET':
        return jsonify(query_db('SELECT * FROM events ORDER BY id'))
    elif request.method == 'POST':
        d = request.json
        row = execute_db('''
            INSERT INTO events (museum_id, title, date, time, description, photo_url)
            VALUES (%s, %s, %s, %s, %s, %s) RETURNING id
        ''', (d['museum_id'], d['title'], d['date'], d.get('time'),
              d.get('description'), d.get('photo_url')), returning=True)
        return jsonify({'status': 'created', 'id': row[0] if row else None})
    elif request.method == 'PUT':
        d = request.json
        execute_db('''UPDATE events SET museum_id=%s, title=%s, date=%s, time=%s, description=%s, photo_url=%s
                      WHERE id=%s''',
                   (d['museum_id'], d['title'], d['date'], d.get('time'),
                    d.get('description'), d.get('photo_url'), d['id']))
        return jsonify({'status': 'updated'})
    elif request.method == 'DELETE':
        execute_db('DELETE FROM events WHERE id = %s', (request.json.get('id'),))
        return jsonify({'status': 'deleted'})


@app.route('/api/admin/educational_posts', methods=['GET', 'POST', 'PUT', 'DELETE'])
@admin_required
def admin_educational_posts():
    if request.method == 'GET':
        return jsonify(query_db('SELECT * FROM educational_posts ORDER BY created_at DESC'))
    elif request.method == 'POST':
        d = request.json
        row = execute_db('''
            INSERT INTO educational_posts (title, content, photo_url, museum_id, author)
            VALUES (%s, %s, %s, %s, %s) RETURNING id
        ''', (d['title'], d['content'], d.get('photo_url'),
              d.get('museum_id'), d.get('author', 'Сотрудник музея')), returning=True)
        return jsonify({'status': 'created', 'id': row[0] if row else None})
    elif request.method == 'PUT':
        d = request.json
        execute_db('''UPDATE educational_posts
                      SET title=%s, content=%s, photo_url=%s, museum_id=%s, author=%s
                      WHERE id=%s''',
                   (d['title'], d['content'], d.get('photo_url'),
                    d.get('museum_id'), d.get('author', 'Сотрудник музея'), d['id']))
        return jsonify({'status': 'updated'})
    elif request.method == 'DELETE':
        execute_db('DELETE FROM educational_posts WHERE id = %s', (request.json.get('id'),))
        return jsonify({'status': 'deleted'})


@app.route('/api/user/events/add', methods=['POST'])
def add_user_event():
    d = request.json
    if not d.get('user_id') or not d.get('event_id'):
        return jsonify({'error': 'Missing data'}), 400
    execute_db('INSERT INTO user_events (user_id, event_id) VALUES (%s, %s) ON CONFLICT DO NOTHING',
               (d['user_id'], d['event_id']))
    return jsonify({'status': 'added'})


@app.route('/api/user/events')
def get_user_events():
    user_id = request.args.get('user_id')
    if not user_id:
        return jsonify([])
    return jsonify(query_db('''
        SELECT events.*, museums.name AS museum_name
        FROM user_events
        JOIN events ON user_events.event_id = events.id
        JOIN museums ON events.museum_id = museums.id
        WHERE user_events.user_id = %s
        ORDER BY events.date, events.time
    ''', (user_id,)))


@app.route('/api/museum/<int:museum_id>/reviews')
def get_museum_reviews(museum_id):
    return jsonify(query_db('''
        SELECT id, user_id, rating, text, user_name, created_at
        FROM reviews WHERE museum_id = %s ORDER BY created_at DESC LIMIT 10
    ''', (museum_id,)))


@app.route('/api/museum/<int:museum_id>/rating')
def get_museum_rating(museum_id):
    row = query_db('SELECT AVG(rating) AS avg FROM reviews WHERE museum_id = %s', (museum_id,), one=True)
    avg = float(row['avg']) if row and row['avg'] is not None else 0
    return jsonify({'average': avg})


@app.route('/api/reviews/add', methods=['POST'])
def add_review():
    d = request.json
    if not d.get('museum_id') or not d.get('user_id') or not d.get('rating'):
        return jsonify({'error': 'Missing data'}), 400
    existing = query_db('SELECT id FROM reviews WHERE museum_id = %s AND user_id = %s',
                        (d['museum_id'], d['user_id']), one=True)
    if existing:
        return jsonify({'error': 'Already reviewed'}), 400
    execute_db('''INSERT INTO reviews (museum_id, user_id, rating, text, user_name)
                  VALUES (%s, %s, %s, %s, %s)''',
               (d['museum_id'], d['user_id'], d['rating'], d.get('text'), d.get('user_name')))
    return jsonify({'status': 'ok'})


@app.route('/webhook', methods=['POST'])
def webhook():
    data = request.json
    if 'message' in data and 'chat' in data['message']:
        return jsonify({
            'method': 'sendMessage',
            'chat_id': data['message']['chat']['id'],
            'text': "Добро пожаловать! Наше приложение: https://max-5-qu3i.onrender.com"
        })
    return jsonify({})


if __name__ == '__main__':
    with app.app_context():
        migrate_db()
    app.run(debug=True, host='0.0.0.0', port=5000)
