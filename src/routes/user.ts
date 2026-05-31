import { Hono } from 'hono';
import { Env, Variables } from '../types';

const user = new Hono<{ Bindings: Env; Variables: Variables }>();

user.get('/me', async (c) => {
	const u = c.get('user');
	const db = c.env.DB;
	const userId = String(u.id);

	try {
		// Single query to UPSERT and return the fresh user data
		// Saves one database roundtrip!
		const dbUser = await db.prepare(`
			INSERT INTO users (id, telegram_id, first_name, username) 
			VALUES (?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET 
				first_name = excluded.first_name, 
				username = excluded.username
			RETURNING *
		`).bind(userId, u.id, u.first_name, u.username || null).first();

		const proxies = await db.prepare(
			'SELECT * FROM proxies WHERE user_id = ? ORDER BY id DESC'
		).bind(userId).all();
		
		const pendingInvoices = await db.prepare(
			"SELECT 1 FROM invoices WHERE user_id = ? AND status = 'pending' LIMIT 1"
		).bind(userId).first();

		return c.json({ 
			success: true, 
			user: dbUser, 
			proxies: proxies.results,
			hasPendingPayments: !!pendingInvoices
		});
	} catch (error) {
		console.error("DB Error in /me:", error);
		throw error; 
	}
});

export default user;
