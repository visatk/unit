-- Users Table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    telegram_id INTEGER UNIQUE NOT NULL,
    username TEXT,
    first_name TEXT,
    balance REAL DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Plans (Store items)
CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    bandwidth_gb REAL NOT NULL,
    price REAL NOT NULL,
    active INTEGER DEFAULT 1
);

-- Proxies (User's purchased proxies)
CREATE TABLE IF NOT EXISTS proxies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    plan_id INTEGER,
    plan_name TEXT,
    proxy_url TEXT NOT NULL,
    bandwidth_gb REAL NOT NULL,
    bandwidth_remaining_gb REAL NOT NULL,
    status TEXT DEFAULT 'active', -- active, exhausted, expired
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Invoices (Apirone Payments)
CREATE TABLE IF NOT EXISTS invoices (
    invoice_id TEXT PRIMARY KEY, -- Apirone Invoice ID
    user_id TEXT NOT NULL,
    amount_usd REAL NOT NULL,
    crypto_currency TEXT NOT NULL,
    crypto_amount REAL NOT NULL,
    status TEXT DEFAULT 'pending', -- pending, paid, completed, expired
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Insert Default Plan for testing
INSERT OR IGNORE INTO plans (id, name, bandwidth_gb, price, active) VALUES 
(1, '2GB Residential', 2.0, 5.00, 1),
(2, '5GB Residential', 5.0, 11.00, 1),
(3, '10GB Premium', 10.0, 20.00, 1);
