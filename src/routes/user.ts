import { Hono } from 'hono';
import { Env } from '../types';
const user = new Hono<{ Bindings: Env }>();

user.get('/me', async (c) => {
	const u = c.get('user');
	const db = c.env.DB;

	await db.prepare(`
		INSERT INTO users (id, first_name, username) VALUES (?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name, username = excluded.username
	`).bind(String(u.id), u.first_name, u.username || null).run();

	const dbUser = await db.prepare('SELECT * FROM users WHERE id = ?').bind(String(u.id)).first();
	const proxies = await db.prepare('SELECT * FROM proxies WHERE user_id = ? ORDER BY id DESC').bind(String(u.id)).all();

	return c.json({ success: true, user: dbUser, proxies: proxies.results });
});
export default user;
