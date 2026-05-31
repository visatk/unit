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

	try {
		// Fetch real-time market price
		const priceRes = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${crypto.toUpperCase()}USDT`);
		if (!priceRes.ok) throw new Error('Failed to fetch market price');
		
		const priceData = await priceRes.json() as { price: string };
		const currentPrice = parseFloat(priceData.price);
		const cryptoAmount = amountUsd / currentPrice;
		
		// Apirone uses minor units (10^8 for BTC, LTC, DOGE)
		const minorUnits = Math.floor(cryptoAmount * 100_000_000);

		const origin = new URL(c.req.url).origin;
		const callbackUrl = `${origin}/api/payments/webhook?secret=${c.env.WEBHOOK_SECRET}`;
		
		// Linkback redirects user to your bot after payment
		const botUsername = "RavenHqBot"; // TODO: Replace with your actual bot username
		const linkbackUrl = `https://t.me/${botUsername}`;

		// Call Apirone API
		const apironeReq = await fetch('https://apirone.com/api/v2/invoices', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				account: c.env.APIRONE_ACCOUNT,
				amount: minorUnits,
				currency: crypto,
				lifetime: 3600, // 1 Hour Expiry
				callback_url: callbackUrl,
				linkback: linkbackUrl,
				user_data: String(user.id)
			})
		});

		if (!apironeReq.ok) {
			console.error("Apirone Error:", await apironeReq.text());
			return c.json({ success: false, error: 'Payment gateway temporarily unavailable' }, 500);
		}

		const apironeData = await apironeReq.json() as any;

		// Store pending invoice in D1
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

// 2. Apirone Webhook (Double-Spend Protected)
payments.post('/webhook', async (c) => {
	const secret = c.req.query('secret');
	if (secret !== c.env.WEBHOOK_SECRET) {
		return c.text('Forbidden', 403); 
	}

	try {
		const body = await c.req.json();
		const { invoice, status, user_data } = body;
		const db = c.env.DB;

		// We only care about statuses that mean we should credit the user
		// Note: 'paid' means unconfirmed but detected, 'completed' means fully confirmed.
		// For digital goods like proxies, 'paid' (1 confirmation) is usually safe enough.
		const isSuccessStatus = status === 'completed' || status === 'paid' || status === 'overpaid';

		if (isSuccessStatus) {
			// ATOMIC UPDATE: Prevent Double Crediting
			// This query only updates if the status is NOT already completed/paid, 
			// and returns the row ONLY if it was actually updated in this transaction.
			const updateRes = await db.prepare(`
				UPDATE invoices 
				SET status = ? 
				WHERE invoice_id = ? AND status NOT IN ('completed', 'paid', 'overpaid')
				RETURNING amount_usd, user_id
			`).bind(status, invoice).first<{ amount_usd: number, user_id: string }>();

			// If updateRes exists, it means THIS exact request changed the status.
			// Now it is 100% safe to credit the user.
			if (updateRes) {
				await db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?')
						.bind(updateRes.amount_usd, updateRes.user_id)
						.run();
				console.log(`Credited $${updateRes.amount_usd} to user ${updateRes.user_id}`);
			}
		} else if (status === 'expired') {
			// Just update status to expired
			await db.prepare("UPDATE invoices SET status = 'expired' WHERE invoice_id = ? AND status = 'pending'")
					.bind(invoice).run();
		}

		// Apirone MUST receive '*ok*' to stop retrying
		return c.text('*ok*');
	} catch (e) {
		console.error("Webhook processing error:", e);
		// Still return *ok* to apirone if it's our internal DB error, or maybe 500 so they retry. 
		// Usually returning 500 is better so Apirone tries again later when DB is up.
		return c.text('Error', 500);
	}
});

export default payments;
