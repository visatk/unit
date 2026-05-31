import { Hono } from 'hono';
import { Env } from '../types';

const store = new Hono<{ Bindings: Env; Variables: { user: any } }>();

// 1. Fetch available plans from DB
store.get('/plans', async (c) => {
	const db = c.env.DB;
	try {
		const plans = await db.prepare('SELECT * FROM plans WHERE active = 1 ORDER BY price ASC').all();
		return c.json({ success: true, plans: plans.results });
	} catch (e) {
		return c.json({ success: false, error: 'Database error' }, 500);
	}
});

// 2. Real Provisioning Logic: Buy Plan
store.post('/buy', async (c) => {
	const db = c.env.DB;
	const user = c.get('user');
	const body = await c.req.json();
	const planId = body.planId;

	if (!planId) return c.json({ success: false, error: 'Plan ID is required' }, 400);

	try {
		// Fetch Plan details
		const plan = await db.prepare('SELECT * FROM plans WHERE id = ? AND active = 1').bind(planId).first();
		if (!plan) return c.json({ success: false, error: 'Plan not found or inactive' }, 404);

		// Check User Balance
		if (user.balance < plan.price) {
			return c.json({ success: false, error: 'Insufficient balance' }, 400);
		}

		// --- REAL PROXY INJECTION ---
		// Your exact proxy string: host:port:username:password
		const rawProxy = "rp.scrapegw.com:6060:1vy19z24czmvh6e:fbol4he13tbf837";
		
		// Parse it to standard HTTP proxy URL format: http://username:password@host:port
		const [host, port, username, password] = rawProxy.split(':');
		const formattedProxyUrl = `http://${username}:${password}@${host}:${port}`;

		// Execute DB Transaction (Deduct balance & Insert Proxy)
		await db.batch([
			db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').bind(plan.price, user.id),
			db.prepare(`
				INSERT INTO proxies (user_id, plan_id, plan_name, proxy_url, bandwidth_gb, bandwidth_remaining_gb, status)
				VALUES (?, ?, ?, ?, ?, ?, 'active')
			`).bind(user.id, plan.id, plan.name, formattedProxyUrl, plan.bandwidth_gb, plan.bandwidth_gb)
		]);

		return c.json({ 
			success: true, 
			message: 'Proxy provisioned successfully!',
			proxyUrl: formattedProxyUrl 
		});

	} catch (e: any) {
		console.error("Purchase Error:", e.message);
		return c.json({ success: false, error: 'Transaction failed. Please try again.' }, 500);
	}
});

export default store;
