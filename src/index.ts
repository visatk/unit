import { Hono } from 'hono';

type Bindings = {
	TELEGRAM_BOT_TOKEN: string;
};

const app = new Hono<{ Bindings: Bindings }>();

/**
 * Validate Telegram Web App initData using Web Crypto API
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
async function validateTelegramData(initDataString: string, botToken: string): Promise<boolean> {
	try {
		const urlParams = new URLSearchParams(initDataString);
		const hash = urlParams.get('hash');
		if (!hash) return false;

		// Remove hash before building the check string
		urlParams.delete('hash');
		urlParams.sort();

		const checkString = Array.from(urlParams.entries())
			.map(([key, value]) => `${key}=${value}`)
			.join('\n');

		const encoder = new TextEncoder();

		// HMAC-SHA-256 of botToken using "WebAppData" as key
		const secretKey = await crypto.subtle.importKey(
			'raw',
			encoder.encode('WebAppData'),
			{ name: 'HMAC', hash: 'SHA-256' },
			true,
			['sign']
		);
		const secret = await crypto.subtle.sign('HMAC', secretKey, encoder.encode(botToken));

		// HMAC-SHA-256 of checkString using the generated secret
		const signatureKey = await crypto.subtle.importKey(
			'raw',
			secret,
			{ name: 'HMAC', hash: 'SHA-256' },
			true,
			['sign']
		);
		const signature = await crypto.subtle.sign('HMAC', signatureKey, encoder.encode(checkString));

		// Convert byte array to Hex string
		const hex = [...new Uint8Array(signature)]
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');

		return hex === hash;
	} catch (error) {
		console.error('Validation error:', error);
		return false;
	}
}

// Auto-Login API Endpoint
app.post('/api/auth', async (c) => {
	const body = await c.req.json();
	const { initData } = body;

	if (!initData) {
		return c.json({ success: false, error: 'Missing initData from Telegram' }, 400);
	}

	const isValid = await validateTelegramData(initData, c.env.TELEGRAM_BOT_TOKEN);

	if (!isValid) {
		return c.json({ success: false, error: 'Invalid authentication signature' }, 401);
	}

	// Safely parse user data
	const urlParams = new URLSearchParams(initData);
	const userString = urlParams.get('user');
	
	if (!userString) {
		return c.json({ success: false, error: 'User data not found in initData' }, 400);
	}

	const user = JSON.parse(userString);

	// TODO: In the future, you can insert/update this user in D1 Database here 
	// and generate a custom JWT for external web sessions if needed.

	return c.json({
		success: true,
		user: {
			id: user.id,
			first_name: user.first_name,
			last_name: user.last_name,
			username: user.username,
			photo_url: user.photo_url,
			language_code: user.language_code
		},
		message: 'Authentication successful',
	});
});

// For any undefined API routes, return 404
app.all('/api/*', (c) => c.notFound());

export default app;
