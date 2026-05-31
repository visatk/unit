import { Hono } from 'hono';
import { Env, Variables } from '../types';

const store = new Hono<{ Bindings: Env; Variables: Variables }>();

// Fetch available plans
store.get('/plans', async (c) => {
	try {
		const plans = await c.env.DB.prepare('SELECT * FROM plans WHERE active = 1 ORDER BY price ASC').all();
		return c.json({ success: true, plans: plans.results });
	} catch (error) {
		throw error;
	}
});

// Process Purchase
store.post('/buy', async (c) => {
	const db = c.env.DB;
	const user = c.get('user');
	const { planId } = await c.req.json();

	if (!planId) return c.json({ success: false, error: 'Plan ID is required' }, 400);

	try {
		// 1. Get user from DB to check exact current balance
		const dbUser = await db.prepare('SELECT balance FROM users WHERE id = ?').bind(String(user.id)).first<any>();
		if (!dbUser) return c.json({ success: false, error: 'User not found' }, 404);

		// 2. Get Plan
		const plan = await db.prepare('SELECT * FROM plans WHERE id = ? AND active = 1').bind(planId).first<any>();
		if (!plan) return c.json({ success: false, error: 'Plan not available' }, 404);

		// 3. Verify Balance
		if (dbUser.balance < plan.price) {
			return c.json({ success: false, error: 'Insufficient balance' }, 400);
		}

		// 4. Generate/Assign Proxy (Mocking a real provider allocation)
		const randomId = Math.random().toString(36).substring(2, 10);
		const formattedProxyUrl = `http://usr_${randomId}:pass_${randomId}@node.proxyshop.com:8080`;

		// 5. Execute DB Transaction
		await db.batch([
			db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').bind(plan.price, String(user.id)),
			db.prepare(`
				INSERT INTO proxies (user_id, plan_id, plan_name, proxy_url, bandwidth_gb, bandwidth_remaining_gb, status)
				VALUES (?, ?, ?, ?, ?, ?, 'active')
			`).bind(String(user.id), plan.id, plan.name, formattedProxyUrl, plan.bandwidth_gb, plan.bandwidth_gb)
		]);

		return c.json({ 
			success: true, 
			message: 'Proxy provisioned successfully!',
			proxyUrl: formattedProxyUrl 
		});

	} catch (error) {
		console.error("Purchase Error:", error);
		return c.json({ success: false, error: 'Transaction failed. Please try again.' }, 500);
	}
});

export default store;
