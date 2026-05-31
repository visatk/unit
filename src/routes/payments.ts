import { Hono } from 'hono';
import { Env } from '../types';

const payments = new Hono<{ Bindings: Env; Variables: { user: any } }>();

// 1. Generate Real Apirone Invoice
payments.post('/invoice', async (c) => {
	const user = c.get('user');
	const { amountUsd, currency } = await c.req.json(); // e.g., amountUsd: 10, currency: 'ltc'

	if (!amountUsd || amountUsd < 1) {
		return c.json({ success: false, error: 'Minimum deposit is $1' }, 400);
	}
	if (!['btc', 'ltc', 'doge'].includes(currency.toLowerCase())) {
		return c.json({ success: false, error: 'Unsupported cryptocurrency' }, 400);
	}

	try {
		// Step A: Fetch real-time Crypto price from Binance API
		const priceRes = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${currency.toUpperCase()}USDT`);
		if (!priceRes.ok) throw new Error('Failed to fetch market price');
		
		const priceData = await priceRes.json() as { price: string };
		const currentPrice = parseFloat(priceData.price);
		
		// Calculate how much crypto is needed for the USD amount
		const cryptoAmount = amountUsd / currentPrice;
		
		// Apirone expects the amount in minor units (Satoshis / Litoshi) -> 10^8
		const minorUnits = Math.floor(cryptoAmount * 100_000_000);

		// Dynamic callback URL based on current worker request origin
		const origin = new URL(c.req.url).origin;
		const callbackUrl = `${origin}/api/payments/webhook`;

		// Step B: Create Invoice via Apirone API
		const apironeReq = await fetch('https://apirone.com/api/v2/invoices', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				account: c.env.APIRONE_ACCOUNT, // Set this in your wrangler.toml or cloudflare secrets
				amount: minorUnits,
				currency: currency.toLowerCase(),
				lifetime: 3600, // 1 hour expiry
				callback_url: callbackUrl,
				user_data: user.id.toString() // We pass the user ID so we know who to credit in the webhook
			})
		});

		if (!apironeReq.ok) {
			const errText = await apironeReq.text();
			console.error("Apirone API Error:", errText);
			return c.json({ success: false, error: 'Payment gateway error' }, 500);
		}

		const apironeData = await apironeReq.json() as any;

		// Step C: Save pending invoice to our Database
		await c.env.DB.prepare(`
			INSERT INTO invoices (invoice_id, user_id, amount_usd, crypto_currency, crypto_amount, status)
			VALUES (?, ?, ?, ?, ?, 'pending')
		`).bind(
			apironeData.invoice, 
			user.id, 
			amountUsd, 
			currency.toUpperCase(), 
			cryptoAmount
		).run();

		return c.json({ success: true, invoiceUrl: apironeData.invoice_url });

	} catch (e: any) {
		console.error("Invoice Gen Error:", e.message);
		return c.json({ success: false, error: 'Internal server error' }, 500);
	}
});

// 2. Real Apirone Webhook (No auth middleware here, Apirone calls this publicly)
payments.post('/webhook', async (c) => {
	try {
		const body = await c.req.json();
		const { invoice, status, user_data } = body;

		// Apirone sends various statuses: created, paid, partpaid, completed, expired
		// We credit the user when the status is 'completed' or 'paid' (at least 1 confirmation)
		if (status === 'completed' || status === 'paid' || status === 'overpaid') {
			const db = c.env.DB;
			
			// Find the pending invoice
			const dbInvoice = await db.prepare('SELECT * FROM invoices WHERE invoice_id = ? AND status = ?').bind(invoice, 'pending').first();
			
			if (dbInvoice) {
				// Credit the exact USD amount to the user's balance and mark invoice as paid
				await db.batch([
					db.prepare('UPDATE invoices SET status = ? WHERE invoice_id = ?').bind(status, invoice),
					db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').bind(dbInvoice.amount_usd, user_data)
				]);
				console.log(`Successfully credited $${dbInvoice.amount_usd} to user ${user_data}`);
			}
		}

		// Apirone requires exactly "*ok*" as response to acknowledge receipt
		return c.text('*ok*');
	} catch (e) {
		return c.text('Error processing webhook', 500);
	}
});

export default payments;
