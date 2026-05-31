import { Hono } from 'hono';
import { Env, Variables } from '../types';

const payments = new Hono<{ Bindings: Env; Variables: Variables }>();

// 1. Generate Secure Invoice
payments.post('/invoice', async (c) => {
	const user = c.get('user');
	const { amountUsd, currency } = await c.req.json();

	if (!amountUsd || amountUsd < 1) {
		return c.json({ success: false, error: 'Minimum deposit is $1' }, 400);
	}

	const supportedCryptos = ['btc', 'ltc', 'doge'];
	const crypto = currency.toLowerCase();
	if (!supportedCryptos.includes(crypto)) {
		return c.json({ success: false, error: 'Unsupported cryptocurrency' }, 400);
	}

	// 🚨 Safety Check: Ensure Apirone Account is configured
	if (!c.env.APIRONE_ACCOUNT) {
		console.error("CRITICAL: APIRONE_ACCOUNT is missing in Cloudflare Secrets!");
		return c.json({ success: false, error: 'Server misconfiguration: Apirone Account missing' }, 500);
	}

	try {
		// Fetch real-time market price safely
		const priceRes = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${crypto.toUpperCase()}USDT`);
		if (!priceRes.ok) throw new Error('Failed to fetch market price from Binance');
		
		const priceData = await priceRes.json() as { price: string };
		const currentPrice = parseFloat(priceData.price);
		const cryptoAmount = amountUsd / currentPrice;
		
		// Apirone uses minor units (10^8 for BTC, LTC, DOGE)
		const minorUnits = Math.floor(cryptoAmount * 100_000_000);

		const origin = new URL(c.req.url).origin;
		
		// 🛠️ SMART LOCAL DETECTION: Apirone rejects localhost URLs
		const isLocal = origin.includes('localhost') || origin.includes('127.0.0.1');
		const callbackUrl = isLocal 
			? `https://example.com/api/payments/webhook?secret=${c.env.WEBHOOK_SECRET || 'dev'}` 
			: `${origin}/api/payments/webhook?secret=${c.env.WEBHOOK_SECRET}`;
		
		const botUsername = "RavenHqBot"; 
		const linkbackUrl = `https://t.me/${botUsername}`;

		// Construct payload for logging & debugging
		const payload = {
			account: c.env.APIRONE_ACCOUNT,
			amount: minorUnits,
			currency: crypto,
			lifetime: 3600,
			callback_url: callbackUrl,
			linkback: linkbackUrl,
			user_data: String(user.id)
		};

		// Call Apirone API
		const apironeReq = await fetch('https://apirone.com/api/v2/invoices', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});

		if (!apironeReq.ok) {
			const errText = await apironeReq.text();
			console.error("Apirone Payload:", payload);
			console.error("Apirone Error Response:", errText);
			
			// 💡 UX Upgrade: Surface exact Apirone API errors to the Frontend
			let errorMsg = 'Payment gateway temporarily unavailable';
			try {
				const parsed = JSON.parse(errText);
				if (parsed.message) errorMsg = `Apirone Error: ${parsed.message}`;
			} catch (parseErr) {}

			return c.json({ success: false, error: errorMsg }, 500);
		}

		const apironeData = await apironeReq.json() as any;

		// Store pending invoice in D1 Database
		await c.env.DB.prepare(`
			INSERT INTO invoices (invoice_id, user_id, amount_usd, crypto_currency, crypto_amount, status)
			VALUES (?, ?, ?, ?, ?, 'pending')
		`).bind(apironeData.invoice, String(user.id), amountUsd, crypto.toUpperCase(), cryptoAmount).run();

		return c.json({ success: true, invoiceUrl: apironeData.invoice_url });

	} catch (e: any) {
		console.error("Invoice Error:", e);
		return c.json({ success: false, error: e.message || 'Failed to create invoice' }, 500);
	}
});

// 2. Apirone Webhook (Double-Spend Protected)
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
			// ATOMIC UPDATE: Prevent Double Crediting
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
