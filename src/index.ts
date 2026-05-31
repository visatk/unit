import { Hono } from 'hono';

type Bindings = {
	TELEGRAM_BOT_TOKEN: string;
	DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();

// 1. Core Logic: Secure Telegram Auto-Login Validation
async function validateTelegramAuth(initDataString: string, botToken: string): Promise<any | null> {
	try {
		const urlParams = new URLSearchParams(initDataString);
		const hash = urlParams.get('hash');
		if (!hash) return null;
		
		urlParams.delete('hash');
		urlParams.sort();
		const checkString = Array.from(urlParams.entries()).map(([k, v]) => `${k}=${v}`).join('\n');
		const encoder = new TextEncoder();
		
		const secretKey = await crypto.subtle.importKey('raw', encoder.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, true, ['sign']);
		const secret = await crypto.subtle.sign('HMAC', secretKey, encoder.encode(botToken));
		
		const signatureKey = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, true, ['sign']);
		const signature = await crypto.subtle.sign('HMAC', signatureKey, encoder.encode(checkString));
		
		const hex = [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');

		if (hex === hash) {
			const userStr = urlParams.get('user');
			return userStr ? JSON.parse(userStr) : null;
		}
		return null;
	} catch (error) {
		console.error("Auth Error:", error);
		return null;
	}
}

// Middleware: Protect all /api/ routes
app.use('/api/*', async (c, next) => {
	const initData = c.req.header('x-telegram-init-data');
	if (!initData) return c.json({ success: false, error: 'Unauthorized Access' }, 401);
	
	const user = await validateTelegramAuth(initData, c.env.TELEGRAM_BOT_TOKEN);
	if (!user) return c.json({ success: false, error: 'Invalid Session' }, 401);
	
	c.set('user', user);
	await next();
});

// Route: Get Profile & Proxies (Auto-registers new users)
app.get('/api/me', async (c) => {
	const user = c.get('user');
	const db = c.env.DB;

	await db.prepare(`
		INSERT INTO users (id, first_name, username) VALUES (?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name, username = excluded.username
	`).bind(String(user.id), user.first_name, user.username || null).run();

	const dbUser = await db.prepare('SELECT * FROM users WHERE id = ?').bind(String(user.id)).first();
	const proxies = await db.prepare('SELECT * FROM proxies WHERE user_id = ? ORDER BY id DESC').bind(String(user.id)).all();

	return c.json({ success: true, user: dbUser, proxies: proxies.results });
});

// Route: List Plans
app.get('/api/plans', async (c) => {
	const plans = await c.env.DB.prepare('SELECT * FROM plans').all();
	return c.json({ success: true, plans: plans.results });
});

// Route: Buy Proxy (Uses Atomic Batch to prevent balance bugs)
app.post('/api/buy', async (c) => {
	const user = c.get('user');
	const { planId } = await c.req.json();
	const db = c.env.DB;

	const plan = await db.prepare('SELECT * FROM plans WHERE id = ?').bind(planId).first<any>();
	if (!plan) return c.json({ success: false, error: 'Plan not found' }, 404);

	const dbUser = await db.prepare('SELECT balance FROM users WHERE id = ?').bind(String(user.id)).first<any>();
	
	if (dbUser.balance < plan.price) {
		return c.json({ success: false, error: 'Insufficient wallet balance.' }, 400);
	}

	const proxyUrl = `http://proxy-${Math.floor(Math.random()*9000)+1000}.residential.shop:8080`;

	try {
		await db.batch([
			db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').bind(plan.price, String(user.id)),
			db.prepare('INSERT INTO proxies (user_id, plan_name, bandwidth_remaining_gb, proxy_url) VALUES (?, ?, ?, ?)')
			  .bind(String(user.id), plan.name, plan.bandwidth_gb, proxyUrl)
		]);
		return c.json({ success: true, message: 'Proxy purchased successfully!' });
	} catch (e) {
		return c.json({ success: false, error: 'Transaction failed' }, 500);
	}
});

// Route: Mock Topup (Replace with actual Crypto/Stripe Webhook later)
app.post('/api/topup', async (c) => {
	const user = c.get('user');
	const { amount } = await c.req.json();
	await c.env.DB.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').bind(amount, String(user.id)).run();
	return c.json({ success: true, message: `$${amount} added to your account.` });
});

app.all('*', (c) => c.notFound());

export default app;
