import { Hono } from 'hono';
import { Env, Variables } from '../types';

const payments = new Hono<{ Bindings: Env; Variables: Variables }>();

// Helper function to fetch with timeout (Cloudflare Best Practice)
async function fetchWithTimeout(resource: string, options: RequestInit & { timeout?: number } = {}) {
	const { timeout = 8000 } = options;
	const controller = new AbortController();
	const id = setTimeout(() => controller.abort(), timeout);
	try {
		const response = await fetch(resource, { ...options, signal: controller.signal });
		clearTimeout(id);
		return response;
	} catch (error: any) {
		clearTimeout(id);
		if (error.name === 'AbortError') {
			throw new Error('Request timed out. The external API is taking too long to respond.');
		}
		throw error;
	}
}

payments.post('/invoice', async (c) => {
	const user = c.get('user');
	const userId = String(user.id);
	const { amountUsd, currency } = await c.req.json();

	if (!amountUsd || amountUsd < 1) return c.json({ success: false, error: 'Minimum deposit is $1' }, 400);

	const supportedCryptos = ['btc', 'ltc', 'doge'];
	const crypto = currency.toLowerCase();
	if (!supportedCryptos.includes(crypto)) return c.json({ success: false, error: 'Unsupported crypto' }, 400);

	if (!c.env.APIRONE_ACCOUNT) {
		console.error("CRITICAL: APIRONE_ACCOUNT is missing!");
		return c.json({ success: false, error: 'Payment gateway configuration error' }, 500);
	}

	try {
		// Use fetchWithTimeout to prevent Worker from hanging
		const priceRes = await fetchWithTimeout(`https://api.binance.com/api/v3/ticker/price?symbol=${crypto.toUpperCase()}USDT`, { timeout: 4000 });
		if (!priceRes.ok) throw new Error('Failed to fetch market price from Binance');
		
		const priceData = await priceRes.json() as { price: string };
		const cryptoAmount = amountUsd / parseFloat(priceData.price);
		const minorUnits = Math.floor(cryptoAmount * 100_000_000);

		const origin = new URL(c.req.url).origin;
		const isLocal = origin.includes('localhost') || origin.includes('127.0.0.1');
		const callbackUrl = isLocal 
			? `https://example.com/api/payments/webhook?secret=${c.env.WEBHOOK_SECRET || 'dev'}` 
			: `${origin}/api/payments/webhook?secret=${c.env.WEBHOOK_SECRET}`;
		
		const botUsername = "RavenHqBot"; 
		const linkbackUrl = `https://t.me/${botUsername}`;

		const payload = {
			account: c.env.APIRONE_ACCOUNT,
			amount: minorUnits,
			currency: crypto,
			lifetime: 3600,
			callback_url: callbackUrl,
			linkback: linkbackUrl,
			user_data: userId
		};

		const apironeReq = await fetchWithTimeout('https://apirone.com/api/v2/invoices', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
			timeout: 6000
		});

		if (!apironeReq.ok) {
			const errText = await apironeReq.text();
			let errorMsg = 'Payment gateway temporarily unavailable';
			try {
				const parsed = JSON.parse(errText);
				if (parsed.message) errorMsg = `Apirone Error: ${parsed.message}`;
			} catch (e) {}
			return c.json({ success: false, error: errorMsg }, 500);
		}

		const apironeData = await apironeReq.json() as any;

		await c.env.DB.prepare(`
			INSERT INTO invoices (invoice_id, user_id, amount_usd, crypto_currency, crypto_amount, status)
			VALUES (?, ?, ?, ?, ?, 'pending')
		`).bind(apironeData.invoice, userId, amountUsd, crypto.toUpperCase(), cryptoAmount).run();

		return c.json({ success: true, invoiceUrl: apironeData.invoice_url });

	} catch (e: any) {
		console.error("Invoice Error:", e);
		return c.json({ success: false, error: e.message || 'Failed to create invoice' }, 500);
	}
});

payments.post('/webhook', async (c) => {
	const secret = c.req.query('secret');
	if (secret !== c.env.WEBHOOK_SECRET && !c.req.url.includes('example.com')) {
		return c.text('Forbidden', 403); 
	}

	try {
		const body = await c.req.json();
		const { invoice, status, user_data } = body;
		const db = c.env.DB;

		const isSuccessStatus = status === 'completed' || status === 'paid' || status === 'overpaid';

		if (isSuccessStatus) {
			const updateRes = await db.prepare(`
				UPDATE invoices 
				SET status = ? 
				WHERE invoice_id = ? AND status NOT IN ('completed', 'paid', 'overpaid')
				RETURNING amount_usd, user_id
			`).bind(status, invoice).first<{ amount_usd: number, user_id: string }>();

			if (updateRes) {
				await db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?')
						.bind(updateRes.amount_usd, updateRes.user_id)
						.run();
				console.log(`Credited $${updateRes.amount_usd} to user ${updateRes.user_id}`);
			}
		} else if (status === 'expired') {
			await db.prepare("UPDATE invoices SET status = 'expired' WHERE invoice_id = ? AND status = 'pending'")
					.bind(invoice).run();
		}

		return c.text('*ok*');
	} catch (e) {
		console.error("Webhook processing error:", e);
		return c.text('Error', 500);
	}
});

export default payments;
