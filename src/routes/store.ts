import { Hono } from 'hono';
import { Env } from '../types';
const store = new Hono<{ Bindings: Env }>();

store.get('/plans', async (c) => {
	const plans = await c.env.DB.prepare('SELECT * FROM plans').all();
	return c.json({ success: true, plans: plans.results });
});

store.post('/buy', async (c) => {
	const user = c.get('user');
	const { planId } = await c.req.json();
	const db = c.env.DB;

	const plan = await db.prepare('SELECT * FROM plans WHERE id = ?').bind(planId).first<any>();
	if (!plan) return c.json({ success: false, error: 'Plan not found' }, 404);

	const dbUser = await db.prepare('SELECT balance FROM users WHERE id = ?').bind(String(user.id)).first<any>();
	if (dbUser.balance < plan.price) return c.json({ success: false, error: 'Insufficient wallet balance.' }, 400);

	// Mocking a real residential proxy generation logic
	const proxyUrl = `http://us-${Math.floor(Math.random()*9000)+1000}.residential.shop:8080`;

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

export default store;
