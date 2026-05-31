DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS plans;
DROP TABLE IF EXISTS proxies;

CREATE TABLE users (
    id TEXT PRIMARY KEY,
    first_name TEXT,
    username TEXT,
    balance REAL DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    bandwidth_gb INTEGER NOT NULL,
    price REAL NOT NULL
);

INSERT INTO plans (name, bandwidth_gb, price) VALUES 
('Starter Proxy', 1, 4.99),
('Pro Residential', 5, 19.99),
('Agency Elite', 20, 59.99);

CREATE TABLE proxies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    plan_name TEXT NOT NULL,
    bandwidth_remaining_gb REAL NOT NULL,
    proxy_url TEXT NOT NULL,
    status TEXT DEFAULT 'Active',
    purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
