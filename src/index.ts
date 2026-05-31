import { Hono } from 'hono';

type Bindings = {
	TELEGRAM_BOT_TOKEN: string;
	DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();

async function validateTelegramData(initDataString: string, botToken: string): Promise<boolean> {
	try {
		const urlParams = new URLSearchParams(initDataString);
		const hash = urlParams.get('hash');
		if (!hash) return false;

		urlParams.delete('hash');
		urlParams.sort();

		const checkString = Array.from(urlParams.entries())
			.map(([key, value]) => `${key}=${value}`)
			.join('\n');

		const encoder = new TextEncoder();
		const secretKey = await crypto.subtle.importKey(
			'raw',
			encoder.encode('WebAppData'),
			{ name: 'HMAC', hash: 'SHA-256' },
			true,
			['sign']
		);
		const secret = await crypto.subtle.sign('HMAC', secretKey, encoder.encode(botToken));

		const signatureKey = await crypto.subtle.importKey(
			'raw',
			secret,
			{ name: 'HMAC', hash: 'SHA-256' },
			true,
			['sign']
		);
		const signature = await crypto.subtle.sign('HMAC', signatureKey, encoder.encode(checkString));

		const hex = [...new Uint8Array(signature)]
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');

		return hex === hash;
	} catch (error) {
		console.error('Validation error:', error);
		return false;
	}
}

app.post('/api/auth', async (c) => {
	const body = await c.req.json();
	const { initData } = body;

	if (!initData) {
		return c.json({ success: false, error: 'Missing initData' }, 400);
	}

	const isValid = await validateTelegramData(initData, c.env.TELEGRAM_BOT_TOKEN);
	if (!isValid) {
		return c.json({ success: false, error: 'Invalid authentication signature' }, 401);
	}

	const urlParams = new URLSearchParams(initData);
	const userString = urlParams.get('user');
	
	if (!userString) return c.json({ success: false, error: 'User data not found' }, 400);

	const user = JSON.parse(userString);

	// Upsert User into D1 Database
	try {
		await c.env.DB.prepare(`
			INSERT INTO users (id, first_name, last_name, username, photo_url, language_code) 
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET 
				first_name = excluded.first_name, 
				last_name = excluded.last_name, 
				username = excluded.username, 
				photo_url = excluded.photo_url, 
				language_code = excluded.language_code,
				last_login = CURRENT_TIMESTAMP
		`).bind(
			user.id, 
			user.first_name, 
			user.last_name || null, 
			user.username || null, 
			user.photo_url || null, 
			user.language_code || 'en'
		).run();
	} catch (dbError) {
		console.error('Database error:', dbError);
		return c.json({ success: false, error: 'Database operation failed' }, 500);
	}

	return c.json({
		success: true,
		user: {
			id: user.id,
			first_name: user.first_name,
			last_name: user.last_name,
			username: user.username,
			photo_url: user.photo_url
		}
	});
});

app.all('/api/*', (c) => c.notFound());

export default app;
