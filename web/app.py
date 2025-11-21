import os
import uuid
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from datetime import datetime, date, timedelta, timezone
from collections import defaultdict
from functools import wraps
from werkzeug.security import generate_password_hash, check_password_hash

# --- Firebase Initialization ---
try:
    import firebase_admin
    from firebase_admin import credentials, firestore
    FIREBASE_AVAILABLE = True
except ImportError:
    FIREBASE_AVAILABLE = False

app = Flask(__name__,
    template_folder='templates',
    static_folder='static'
)
app.secret_key = os.environ.get('SECRET_KEY', 'a-very-secret-key-for-dev')
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=7)

db = None
if FIREBASE_AVAILABLE:
    try:
        required_env_vars = ['FIREBASE_PROJECT_ID', 'FIREBASE_PRIVATE_KEY', 'FIREBASE_CLIENT_EMAIL']
        if all(os.getenv(key) for key in required_env_vars):
            print("Attempting to initialize Firebase with environment variables...")
            private_key = os.getenv('FIREBASE_PRIVATE_KEY').replace('\\n', '\n')
            firebase_config = {
                "type": "service_account",
                "project_id": os.getenv('FIREBASE_PROJECT_ID'),
                "private_key_id": os.getenv('FIREBASE_PRIVATE_KEY_ID', ''),
                "private_key": private_key,
                "client_email": os.getenv('FIREBASE_CLIENT_EMAIL'),
                "client_id": os.getenv('FIREBASE_CLIENT_ID', ''),
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
            }
            cred = credentials.Certificate(firebase_config)
            print("Firebase credentials loaded from environment.")
        elif os.path.exists('firebase-key.json'):
            print("Attempting to initialize Firebase with firebase-key.json...")
            cred = credentials.Certificate('firebase-key.json')
            print("Firebase credentials loaded from file.")
        else:
            raise Exception("No Firebase configuration found. Set environment variables or provide firebase-key.json.")
        
        if not firebase_admin._apps:
            firebase_admin.initialize_app(cred)
        
        db = firestore.client()
        print("✅ Firebase initialized successfully")
    except Exception as e:
        print(f"❌ Firebase init error: {e}")
        db = None
        FIREBASE_AVAILABLE = False
else:
    print("⚠️ Firebase library not found. Running in offline mode.")

# --- Login Decorator ---
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return jsonify({'error': 'Unauthorized', 'success': False}), 401
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

# --- Admin Decorator ---
def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Unauthorized', 'success': False}), 401
        
        role = session.get('role')
        if role != 'admin':
            return jsonify({'error': 'Forbidden', 'success': False}), 403
            
        return f(*args, **kwargs)
    return decorated_function

# --- Date Helper ---
def dt_now_iso():
    return datetime.now(timezone.utc).isoformat()

# --- Achievement Calculation Function ---
def calculate_achievements(transactions, balance, goal):
    achievements = []
    today = datetime.now(timezone.utc).date()

    # --- 1. Milestone Achievements ---
    if balance >= 1000:
        achievements.append({
            "icon": "💰",
            "name": "Getting Started",
            "desc": "Reach 1,000 coins"
        })
    if balance >= 5000:
        achievements.append({
            "icon": "📈",
            "name": "Serious Saver",
            "desc": "Reach 5,000 coins"
        })
    if balance >= 10000:
        achievements.append({
            "icon": "🏦",
            "name": "Coin Hoarder",
            "desc": "Reach 10,000 coins"
        })
    if balance >= goal:
        achievements.append({
            "icon": "👑",
            "name": "Epic Box Secured!",
            "desc": f"You reached the {goal:,} coin goal!"
        })

    # --- 2. Login Streak Achievement ---
    try:
        # Find all "Login" transactions
        login_transactions = [
            t for t in transactions 
            if t.get('source', '').lower() == 'login' and t.get('amount', 0) > 0
        ]
        
        # Get a set of unique dates (as date objects)
        login_dates = set()
        for t in login_transactions:
            login_dates.add(datetime.fromisoformat(t['date'].replace('Z', '+00:00')).date())

        streak = 0
        if today in login_dates:
            streak = 1
            current_day = today - timedelta(days=1)
            while current_day in login_dates:
                streak += 1
                current_day -= timedelta(days=1)

        if streak >= 3:
            achievements.append({
                "icon": "🔥",
                "name": f"{streak}-Day Streak",
                "desc": f"Logged in {streak} days in a row!"
            })
    except Exception as e:
        print(f"Error calculating streak: {e}") # Don't crash if dates are weird

    # --- 3. No-Spend Streak ---
    try:
        # Sort transactions by date ascending to get first transaction
        sorted_tx = sorted(transactions, key=lambda x: x.get('date', ''))
        
        last_spend_date = None
        for t in reversed(sorted_tx): # Check from newest to oldest
            if t.get('amount', 0) < 0:
                last_spend_date = datetime.fromisoformat(t['date'].replace('Z', '+00:00')).date()
                break
        
        no_spend_days = 0
        if last_spend_date:
            no_spend_days = (today - last_spend_date).days
        else:
            # Never spent? That's a full streak!
            if sorted_tx: # Check if there are any transactions at all
                 first_tx_date = datetime.fromisoformat(sorted_tx[0]['date'].replace('Z', '+00:00')).date()
                 no_spend_days = (today - first_tx_date).days
            
        if no_spend_days >= 7:
            achievements.append({
                "icon": "🛡️",
                "name": "Disciplined",
                "desc": f"No spending for {no_spend_days} days!"
            })
    except Exception as e:
        print(f"Error calculating no-spend streak: {e}")

    return achievements
# --- END NEW FUNCTION ---


# --- Data Access Class ---
class WebCoinTracker:
    def __init__(self, profile_name="Default", user_id="default_user"):
        self.profile_name = profile_name
        self.user_id = user_id
        self.db = db
        self.doc_ref = self.db.collection('user_data').document(self.user_id) if self.db and FIREBASE_AVAILABLE else None

    def get_default_settings(self):
        return {
            'goal': 13500, 'dark_mode': False,
            'quick_actions': [
                {"text": "Event Reward", "value": 50, "is_positive": True},
                {"text": "Ads", "value": 10, "is_positive": True},
                {"text": "Daily Games", "value": 100, "is_positive": True},
                {"text": "Login", "value": 50, "is_positive": True},
                {"text": "Campaign Reward", "value": 50, "is_positive": True},
                {"text": "Box Draw (Single)", "value": 100, "is_positive": False},
                {"text": "Box Draw (10)", "value": 900, "is_positive": False}
            ]
        }

    def get_data(self):
        transactions, settings = [], self.get_default_settings()
        if self.doc_ref:
            try:
                doc = self.doc_ref.get()
                if doc.exists:
                    data = doc.to_dict()

                    if data is None: 
                        data = {}

                    if 'profiles' in data:
                        profile_data = data.get('profiles', {}).get(self.profile_name, {})
                        transactions = profile_data.get('transactions', [])
                        settings.update(profile_data.get('settings', {}))
                    
                    elif 'transactions' in data or 'settings' in data:
                        print(f"NOTE: Found old data structure for user {self.user_id}. Reading data...")
                        transactions = data.get('transactions', [])
                        settings.update(data.get('settings', {}))
                    
            except Exception as e: 
                print(f"Firebase load error for user {self.user_id}: {e}")
        else:
            profile_data = session.get('profiles', {}).get(self.profile_name, {})
            transactions = profile_data.get('transactions', [])
            settings.update(profile_data.get('settings', {}))
        
        return self.validate_data(transactions, settings)

    def get_transactions_paginated(self, page=1, limit=20, filters=None):
        if filters is None:
            filters = {}
            
        transactions, _ = self.get_data()
        
        filtered_transactions = []
        for t in transactions:
            try:
                t_date_str = t.get('date', '')
                if not t_date_str:
                    continue 
                    
                t_date = datetime.fromisoformat(t_date_str.replace('Z', '+00:00')).date()
                
                if filters.get('date_from'):
                    from_date = datetime.fromisoformat(filters['date_from']).date()
                    if t_date < from_date:
                        continue
                if filters.get('date_to'):
                    to_date = datetime.fromisoformat(filters['date_to']).date()
                    if t_date > to_date:
                        continue
            except (ValueError, TypeError) as e:
                print(f"Skipping date filter for transaction {t.get('id')}: {e}")
                pass 

            if filters.get('source') and filters['source'] != t.get('source'):
                continue
            
            search_term = filters.get('search', '').lower()
            if search_term:
                source_match = t.get('source', '').lower().find(search_term) != -1
                amount_match = str(t.get('amount', '')).find(search_term) != -1
                if not source_match and not amount_match:
                    continue
            
            filtered_transactions.append(t)

        sorted_transactions = sorted(filtered_transactions, key=lambda x: x.get('date', ''), reverse=True)
        
        total_earned_in_range = sum(t['amount'] for t in filtered_transactions if t['amount'] > 0)
        total_spent_in_range = sum(t['amount'] for t in filtered_transactions if t['amount'] < 0)

        total_transactions = len(sorted_transactions)
        total_pages = (total_transactions + limit - 1) // limit 
        
        start_index = (page - 1) * limit
        end_index = start_index + limit
        
        paginated_txns = sorted_transactions[start_index:end_index]
        
        return {
            'transactions': paginated_txns,
            'total_pages': total_pages,
            'current_page': page,
            'total_transactions': total_transactions,
            'total_earned': total_earned_in_range,
            'total_spent': total_spent_in_range,
        }


    def validate_data(self, transactions, settings):
        for t in transactions:
            if 'id' not in t or not t['id']: t['id'] = str(uuid.uuid4())
        if 'quick_actions' not in settings: 
            settings['quick_actions'] = self.get_default_settings()['quick_actions']
        return transactions, settings

    def save_data(self, transactions, settings):
        transactions = self.recalculate_balances(transactions)
        if self.doc_ref:
            try:
                doc = self.doc_ref.get()
                data_to_save = {}
                if doc.exists and doc.to_dict() is not None:
                    data_to_save = doc.to_dict()

                profiles_data = data_to_save.get('profiles', {})
                
                profiles_data[self.profile_name] = {
                    'transactions': transactions, 
                    'settings': settings, 
                    'last_updated': dt_now_iso()
                }
                
                final_data = {
                    'profiles': profiles_data,
                    'last_active_profile': self.profile_name
                }
                
                if 'transactions' in data_to_save:
                    final_data['transactions'] = firestore.DELETE_FIELD
                if 'settings' in data_to_save:
                    final_data['settings'] = firestore.DELETE_FIELD
                
                self.doc_ref.set(final_data, merge=True) 
                
                return True
            except Exception as e:
                print(f"Firebase save error: {e}")
                return False
        else:
            profiles = session.get('profiles', {})
            profiles[self.profile_name] = {'transactions': transactions, 'settings': settings, 'last_updated': dt_now_iso()}
            session['profiles'] = profiles
            session.modified = True
            return True
            
    def import_data(self, data):
        print(f"Importing data for user {self.user_id}...")
        transactions = data.get('transactions', [])
        settings = data.get('settings', self.get_default_settings())
        
        valid_transactions, valid_settings = self.validate_data(transactions, settings)
        return self.save_data(valid_transactions, valid_settings)

    def recalculate_balances(self, transactions):
        sorted_transactions = sorted(transactions, key=lambda x: x.get('date', ''))
        balance = 0
        for t in sorted_transactions:
            t['previous_balance'] = balance
            balance += t.get('amount', 0)
        return sorted_transactions

    def add_transaction(self, amount, source, date):
        transactions, settings = self.get_data()
        transactions.append({"id": str(uuid.uuid4()), "date": date or dt_now_iso(), "amount": int(amount), "source": source})
        return self.save_data(transactions, settings)

    def update_transaction(self, transaction_id, new_data):
        transactions, settings = self.get_data()
        for t in transactions:
            if t.get('id') == transaction_id:
                t.update({'amount': int(new_data['amount']), 'source': new_data['source'], 'date': new_data['date']})
                return self.save_data(transactions, settings)
        return False

    def delete_transaction(self, transaction_id):
        transactions, settings = self.get_data()
        initial_len = len(transactions)
        transactions = [t for t in transactions if t.get('id') != transaction_id]
        if len(transactions) < initial_len:
            return self.save_data(transactions, settings)
        return False

    def get_profiles(self):
        profiles = ['Default']
        if self.doc_ref:
            try:
                doc = self.doc_ref.get()
                if doc.exists and doc.to_dict() is not None: 
                    profiles.extend([p for p in doc.to_dict().get('profiles', {}).keys() if p != 'Default'])
            except Exception as e: print(f"Firebase profiles error: {e}")
        profiles.extend([p for p in session.get('profiles', {}).keys() if p not in profiles])
        return sorted(list(set(profiles)))

# --- Auth Routes ---

@app.route('/login')
def login():
    if 'user_id' in session:
        if session.get('role') == 'admin':
            return redirect(url_for('admin_panel'))
        return redirect(url_for('index'))
    return render_template('login.html')

@app.route('/api/register', methods=['POST'])
def register():
    if not db:
        return jsonify({'success': False, 'error': 'Database not available'}), 500
        
    data = request.json
    username = data.get('username')
    password = data.get('password')
    
    if not username or not password:
        return jsonify({'success': False, 'error': 'Username and password required'}), 400

    users_ref = db.collection('users')
    username_lower = username.lower()
    if users_ref.where('username_lower', '==', username_lower).get():
        return jsonify({'success': False, 'error': 'Username already exists'}), 409
        
    user_id = str(uuid.uuid4())
    hashed_password = generate_password_hash(password)
    users_ref.document(user_id).set({
        'username': username,
        'username_lower': username_lower,
        'password_hash': hashed_password,
        'created_at': dt_now_iso(),
        'role': 'user'
    })
    return jsonify({'success': True})

@app.route('/api/login', methods=['POST'])
def handle_login():
    if not db:
        return jsonify({'success': False, 'error': 'Database not available'}), 500

    data = request.json
    username = data.get('username')
    password = data.get('password')
    
    users_ref = db.collection('users')
    
    user_query = users_ref.where('username_lower', '==', username.lower()).limit(1).get()
        
    if not user_query:
        return jsonify({'success': False, 'error': 'Invalid username or password'}), 401
    
    user_doc = user_query[0]
    user_data = user_doc.to_dict()
    
    if check_password_hash(user_data.get('password_hash'), password):
        session.permanent = True
        session['user_id'] = user_doc.id
        session['username'] = user_data.get('username')
        session['role'] = user_data.get('role', 'user')
        
        user_data_doc = db.collection('user_data').document(user_doc.id).get()
        last_profile = 'Default'
        
        if user_data_doc.exists and user_data_doc.to_dict() is not None:
            last_profile = user_data_doc.to_dict().get('last_active_profile', 'Default')
        session['current_profile'] = last_profile
        
        if session['role'] == 'admin':
            return jsonify({'success': True, 'username': session['username'], 'redirect': url_for('admin_panel')})
            
        return jsonify({'success': True, 'username': session['username'], 'redirect': url_for('index')})
    else:
        return jsonify({'success': False, 'error': 'Invalid username or password'}), 401


@app.route('/api/logout', methods=['POST'])
@login_required
def logout():
    session.clear()
    return jsonify({'success': True})

@app.route('/api/user')
@login_required
def get_user():
    return jsonify({
        'username': session.get('username'),
        'role': session.get('role', 'user'),
        'success': True
    })

# --- Main App Route ---

@app.route('/')
@login_required
def index():
    return render_template('index.html')

# --- Main Data API Routes ---

@app.route('/api/data')
@login_required
def get_all_data():
    profile_name = session.get('current_profile', 'Default')
    user_id = session.get('user_id')
    tracker = WebCoinTracker(profile_name, user_id)
    
    transactions, settings = tracker.get_data()
    
    balance = sum(t.get('amount', 0) for t in transactions)
    goal = settings.get('goal', 13500)
    today, week_start, month_start = datetime.now().date(), datetime.now().date() - timedelta(days=datetime.now().weekday()), datetime.now().date().replace(day=1)
    
    today_earn, week_earn, month_earn = 0, 0, 0
    total_earnings = 0
    first_earning_date = None
    
    for t in transactions:
        if t.get('amount', 0) > 0:
            total_earnings += t['amount']
            
            try:
                t_date_obj = datetime.fromisoformat(t['date'].replace('Z', '+00:00'))

                if t_date_obj.tzinfo is None:
                    t_date_obj = t_date_obj.replace(tzinfo=timezone.utc)

                if first_earning_date is None or t_date_obj < first_earning_date:
                    first_earning_date = t_date_obj
                
                t_date_stats = t_date_obj.date()
                if t_date_stats == today: today_earn += t['amount']
                if t_date_stats >= week_start: week_earn += t['amount']
                if t_date_stats >= month_start: month_earn += t['amount']
                
            except (ValueError, TypeError):
                pass

    estimated_days = "N/A"
    if total_earnings > 0 and first_earning_date is not None:
        days_since_start = (datetime.now(timezone.utc) - first_earning_date).days
        if days_since_start == 0:
            days_since_start = 1
        
        avg_daily_earnings = total_earnings / days_since_start
        amount_remaining = goal - balance
        
        if amount_remaining <= 0:
            estimated_days = 0
        elif avg_daily_earnings > 0:
            estimated_days = int(amount_remaining / avg_daily_earnings)
            
    total_spending = abs(sum(t['amount'] for t in transactions if t['amount'] < 0))
    
    earnings_breakdown = defaultdict(int)
    for t in transactions:
        if t['amount'] > 0: earnings_breakdown[t['source']] += t['amount']
        
    spending_breakdown = defaultdict(int)
    for t in transactions:
        if t['amount'] < 0: spending_breakdown[t['source']] += abs(t['amount'])
        
    timeline = [{'date': t['date'], 'balance': t.get('previous_balance', 0) + t.get('amount', 0)} for t in sorted(transactions, key=lambda x: x.get('date', ''))]

    settings['firebase_available'] = FIREBASE_AVAILABLE and db is not None
    
    all_sources = sorted(list(set(t['source'] for t in transactions)))
    settings['all_sources'] = all_sources

    achievements = calculate_achievements(transactions, balance, goal)

    return jsonify({
        'profile': profile_name, 
        'transactions': transactions, 
        'settings': settings, 
        'balance': balance, 
        'goal': goal,
        'progress': min(100, int((balance / goal) * 100)) if goal > 0 else 0,
        'estimated_days': estimated_days,
        'dashboard_stats': {'today': today_earn, 'week': week_earn, 'month': month_earn},
        'analytics': {
            'total_earnings': total_earnings, 
            'total_spending': total_spending, 
            'net_balance': balance,
            'earnings_breakdown': dict(earnings_breakdown), 
            'spending_breakdown': dict(spending_breakdown), 
            'timeline': timeline,
        },
        'achievements': achievements,
        'success': True
    })
    
@app.route('/api/history')
@login_required
def get_history_paginated():
    profile_name = session.get('current_profile', 'Default')
    user_id = session.get('user_id')
    tracker = WebCoinTracker(profile_name, user_id)
    
    try:
        page = int(request.args.get('page', 1))
        limit = int(request.args.get('limit', 20))
    except ValueError:
        page = 1
        limit = 20
        
    filters = {
        'date_from': request.args.get('date_from'),
        'date_to': request.args.get('date_to'),
        'search': request.args.get('search'),
        'source': request.args.get('source')
    }
    filters = {k: v for k, v in filters.items() if v}
        
    data = tracker.get_transactions_paginated(page, limit, filters)
    return jsonify(data)

@app.route('/api/add-transaction', methods=['POST'])
@login_required
def handle_add_transaction():
    tracker = WebCoinTracker(session.get('current_profile', 'Default'), session.get('user_id'))
    data = request.json
    if tracker.add_transaction(data['amount'], data['source'], data['date']):
        return get_all_data()
    return jsonify({'success': False, 'error': 'Failed to save transaction'}), 500

@app.route('/api/update-transaction/<transaction_id>', methods=['POST'])
@login_required
def handle_update_transaction(transaction_id):
    tracker = WebCoinTracker(session.get('current_profile', 'Default'), session.get('user_id'))
    if tracker.update_transaction(transaction_id, request.json):
        return get_all_data()
    return jsonify({'success': False, 'error': 'Failed to update'}), 404

@app.route('/api/delete-transaction/<transaction_id>', methods=['POST'])
@login_required
def handle_delete_transaction(transaction_id):
    tracker = WebCoinTracker(session.get('current_profile', 'Default'), session.get('user_id'))
    if tracker.delete_transaction(transaction_id):
        return get_all_data()
    return jsonify({'success': False, 'error': 'Failed to delete'}), 404

@app.route('/api/update-settings', methods=['POST'])
@login_required
def update_settings():
    tracker = WebCoinTracker(session.get('current_profile', 'Default'), session.get('user_id'))
    transactions, settings = tracker.get_data()
    
    settings.update(request.json)
    
    if tracker.save_data(transactions, settings):
        return get_all_data()
    return jsonify({'success': False, 'error': 'Failed to save settings'}), 500
    
@app.route('/api/import-data', methods=['POST'])
@login_required
def handle_import_data():
    tracker = WebCoinTracker(session.get('current_profile', 'Default'), session.get('user_id'))
    data = request.json
    if tracker.import_data(data):
        return get_all_data()
    return jsonify({'success': False, 'error': 'Failed to import data'}), 500

@app.route('/api/add-quick-action', methods=['POST'])
@login_required
def add_quick_action():
    tracker = WebCoinTracker(session.get('current_profile', 'Default'), session.get('user_id'))
    transactions, settings = tracker.get_data()
    
    new_action = request.json
    if 'text' in new_action and 'value' in new_action and 'is_positive' in new_action:
        settings['quick_actions'].append(new_action)
        if tracker.save_data(transactions, settings):
            return get_all_data()
    
    return jsonify({'success': False, 'error': 'Invalid action data'}), 400

@app.route('/api/delete-quick-action', methods=['POST'])
@login_required
def delete_quick_action():
    tracker = WebCoinTracker(session.get('current_profile', 'Default'), session.get('user_id'))
    transactions, settings = tracker.get_data()
    
    data = request.json
    index_to_delete = data.get('index')
    
    try:
        index_to_delete = int(index_to_delete)
        if 0 <= index_to_delete < len(settings['quick_actions']):
            settings['quick_actions'].pop(index_to_delete)
            if tracker.save_data(transactions, settings):
                return get_all_data()
    except (TypeError, ValueError):
        pass 
    
    return jsonify({'success': False, 'error': 'Invalid index'}), 400

# --- Profile Routes ---
@app.route('/api/profiles')
@login_required
def get_profiles():
    tracker = WebCoinTracker(user_id=session.get('user_id'))
    return jsonify({'profiles': tracker.get_profiles(), 'current_profile': session.get('current_profile', 'Default')})

@app.route('/api/switch-profile', methods=['POST'])
@login_required
def switch_profile():
    profile_name = request.json.get('profile_name')
    user_id = session.get('user_id')
    session['current_profile'] = profile_name
    
    if db and FIREBASE_AVAILABLE:
        try:
            db.collection('user_data').document(user_id).set({'last_active_profile': profile_name}, merge=True)
        except Exception as e: print(f"Error saving last active profile: {e}")
            
    return jsonify({'success': True})

@app.route('/api/create-profile', methods=['POST'])
@login_required
def create_profile():
    profile_name = request.json.get('profile_name')
    user_id = session.get('user_id')
    
    tracker = WebCoinTracker(profile_name, user_id)
    if profile_name in tracker.get_profiles():
        return jsonify({'success': False, 'error': 'Profile already exists'}), 409
        
    if tracker.save_data([], tracker.get_default_settings()):
        session['current_profile'] = profile_name
        if db and FIREBASE_AVAILABLE:
            try:
                db.collection('user_data').document(user_id).set({'last_active_profile': profile_name}, merge=True)
            except Exception as e: print(f"Error saving last active profile: {e}")
        
        return jsonify({
            'success': True, 
            'profiles': tracker.get_profiles(), 
            'current_profile': profile_name
        })
    return jsonify({'success': False, 'error': 'Failed to create profile'}), 500

# --- Admin Routes ---

@app.route('/admin')
@login_required
def admin_panel():
    if session.get('role') != 'admin':
        return redirect(url_for('index'))
    return render_template('admin.html')

@app.route('/api/admin/stats')
@admin_required
def get_admin_stats():
    total_users = len(list(db.collection('users').stream()))
    
    thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
    users_query = db.collection('users').where('created_at', '>=', thirty_days_ago.isoformat()).stream()
    
    signups_by_day = defaultdict(int)
    for user in users_query:
        try:
            created_at_str = user.to_dict().get('created_at')
            if '+' in created_at_str or 'Z' in created_at_str:
                day = datetime.fromisoformat(created_at_str).strftime('%Y-%m-%d')
            else:
                day = datetime.fromisoformat(created_at_str + '+00:00').strftime('%Y-%m-%d')
            signups_by_day[day] += 1
        except Exception:
            pass 

    chart_labels = []
    chart_data = []
    for i in range(30):
        day = (datetime.now(timezone.utc) - timedelta(days=i)).strftime('%Y-%m-%d')
        chart_labels.append(day)
        chart_data.append(signups_by_day[day])
        
    chart_labels.reverse()
    chart_data.reverse()

    total_coins = 0
    total_transactions = 0
    all_user_data = db.collection('user_data').stream()
    for user_data_doc in all_user_data:
        doc_data = user_data_doc.to_dict()
        if doc_data is None:
            continue
            
        profiles = doc_data.get('profiles', {})
        
        if profiles:
            for profile in profiles.values():
                txns = profile.get('transactions', [])
                total_transactions += len(txns)
                for t in txns:
                    total_coins += t.get('amount', 0)
        elif 'transactions' in doc_data:
             txns = doc_data.get('transactions', [])
             total_transactions += len(txns)
             for t in txns:
                total_coins += t.get('amount', 0)
                
    return jsonify({
        'stats': {
            'total_users': total_users,
            'total_coins': total_coins,
            'total_transactions': total_transactions
        },
        'chart_data': {
            'labels': chart_labels,
            'data': chart_data
        },
        'success': True
    })

@app.route('/api/admin/users')
@admin_required
def get_admin_users():
    users_ref = db.collection('users')
    data_ref = db.collection('user_data')
    
    users_query = users_ref.order_by('username_lower').stream()
    users_dict = {}
    for user in users_query:
        user_data = user.to_dict()
        users_dict[user.id] = {
            'user_id': user.id,
            'username': user_data.get('username', 'N/A'),
            'created_at': user_data.get('created_at', 'N/A'),
            'balance': 0,
            'last_updated': 'N/A',
            'txn_count': 0
        }
        
    all_user_data = data_ref.stream()
    for user_data_doc in all_user_data:
        user_id = user_data_doc.id
        if user_id in users_dict:
            doc_data = user_data_doc.to_dict()
            if doc_data is None:
                continue

            user_balance = 0
            user_txn_count = 0
            last_updated = 'N/A'
            
            if 'profiles' in doc_data:
                profiles = doc_data.get('profiles', {})
                for profile in profiles.values():
                    txns = profile.get('transactions', [])
                    user_txn_count += len(txns)
                    for t in txns:
                        user_balance += t.get('amount', 0)
                    
                    profile_last_updated = profile.get('last_updated')
                    if profile_last_updated:
                        if last_updated == 'N/A' or profile_last_updated > last_updated:
                            last_updated = profile_last_updated
            
            elif 'transactions' in doc_data:
                txns = doc_data.get('transactions', [])
                user_txn_count = len(txns)
                for t in txns:
                    user_balance += t.get('amount', 0)

            users_dict[user_id]['balance'] = user_balance
            users_dict[user_id]['txn_count'] = user_txn_count
            users_dict[user_id]['last_updated'] = last_updated

    return jsonify({'users': list(users_dict.values()), 'success': True})


@app.route('/api/admin/delete-user', methods=['POST'])
@admin_required
def delete_admin_user():
    user_id = request.json.get('user_id')
    if not user_id:
        return jsonify({'success': False, 'error': 'User ID required'}), 400
    
    try:
        db.collection('users').document(user_id).delete()
        db.collection('user_data').document(user_id).delete()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# --- Broadcast Routes ---

@app.route('/api/broadcast')
@login_required 
def get_broadcast():
    try:
        doc = db.collection('app_config').document('broadcast').get()
        if doc.exists:
            return jsonify(doc.to_dict())
        return jsonify({'message': ''})
    except Exception:
        return jsonify({'message': ''})

@app.route('/api/admin/broadcast', methods=['POST'])
@admin_required
def set_broadcast():
    message = request.json.get('message', '')
    try:
        db.collection('app_config').document('broadcast').set({
            'message': message,
            'set_by': session.get('username'),
            'set_at': dt_now_iso()
        })
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# --- Main Entry Point ---

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5001)