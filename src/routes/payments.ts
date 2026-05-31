import { Hono } from 'hono';
import { Env, Variables } from '../types';

const payments = new Hono<{ Bindings: Env; Variables: Variables }>();

// Generate Invoice
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

	try {
		// Fetch price safely
		const priceRes = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${crypto.toUpperCase()}USDT`);
		if (!priceRes.ok) throw new Error('Failed to fetch market price');
		
		const priceData = await priceRes.json() as { price: string };
		const currentPrice = parseFloat(priceData.price);
		const cryptoAmount = amountUsd / currentPrice;
		
		// Minor units for Apirone (10^8)
		const minorUnits = Math.floor(cryptoAmount * 100_000_000);

		// Dynamic callback URL + Security Secret
		const origin = new URL(c.req.url).origin;
		const callbackUrl = `${origin}/api/payments/webhook?secret=${c.env.WEBHOOK_SECRET}`;

		// Create Apirone Invoice
		const apironeReq = await fetch('https://apirone.com/api/v2/invoices', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				account: c.env.APIRONE_ACCOUNT,
				amount: minorUnits,
				currency: crypto,
				lifetime: 3600,
				callback_url: callbackUrl,
				user_data: String(user.id) // Ensure string format
			})
		});

		if (!apironeReq.ok) {
			const errText = await apironeReq.text();
			console.error("Apirone Error:", errText);
			return c.json({ success: false, error: 'Payment gateway temporarily unavailable' }, 500);
		}

		const apironeData = await apironeReq.json() as any;

		// Save to DB
		await c.env.DB.prepare(`
			INSERT INTO invoices (invoice_id, user_id, amount_usd, crypto_currency, crypto_amount, status)
			VALUES (?, ?, ?, ?, ?, 'pending')
		`).bind(apironeData.invoice, String(user.id), amountUsd, crypto.toUpperCase(), cryptoAmount).run();

		return c.json({ success: true, invoiceUrl: apironeData.invoice_url });

	} catch (e: any) {
		console.error("Invoice Error:", e);
		return c.json({ success: false, error: 'Failed to create invoice' }, 500);
	}
});

// Apirone Webhook (PUBLIC - No Auth Middleware)
payments.post('/webhook', async (c) => {
	// 1. Verify Secret to prevent fake requests
	const secret = c.req.query('secret');
	if (secret !== c.env.WEBHOOK_SECRET) {
		console.warn("Unauthorized webhook attempt");
		return c.text('Forbidden', 403); 
	}

	try {
		const body = await c.req.json();
		const { invoice, status, user_data } = body;

		const db = c.env.DB;
		
		// Acknowledge these immediately if already processed
		const existingInvoice = await db.prepare('SELECT * FROM invoices WHERE invoice_id = ?').bind(invoice).first<any>();
		
		if (!existingInvoice) return c.text('*ok*'); // Ignore unknown invoices

		if (existingInvoice.status === 'completed' || existingInvoice.status === 'paid') {
			return c.text('*ok*');
		}

		// Process Payment
		if (status === 'completed' || status === 'paid' || status === 'overpaid') {
			await db.batch([
				db.prepare('UPDATE invoices SET status = ? WHERE invoice_id = ?').bind(status, invoice),
				db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').bind(existingInvoice.amount_usd, user_data)
			]);
		}

		// Must reply exactly *ok* to Apirone
		return c.text('*ok*');
	} catch (e) {
		console.error("Webhook processing error:", e);
		return c.text('Error', 500);
	}
});

export default payments;
