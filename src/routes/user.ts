import { Hono } from 'hono';
import { Env, Variables } from '../types';

const user = new Hono<{ Bindings: Env; Variables: Variables }>();

user.get('/me', async (c) => {
	const u = c.get('user');
	const db = c.env.DB;

	try {
		// UPSERT User
		await db.prepare(`
			INSERT INTO users (id, telegram_id, first_name, username) 
			VALUES (?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET 
				first_name = excluded.first_name, 
				username = excluded.username
		`).bind(String(u.id), u.id, u.first_name, u.username || null).run();

		// Fetch fresh user data
		const dbUser = await db.prepare('SELECT * FROM users WHERE id = ?').bind(String(u.id)).first();
		
		// Fetch active proxies
		const proxies = await db.prepare('SELECT * FROM proxies WHERE user_id = ? ORDER BY id DESC').bind(String(u.id)).all();

		return c.json({ 
			success: true, 
			user: dbUser, 
			proxies: proxies.results 
		});
	} catch (error) {
		console.error("DB Error in /me:", error);
		throw error; // Let global handler catch it
	}
});

export default user;
