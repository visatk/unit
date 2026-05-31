import { Hono } from 'hono';
import { Env } from '../types';

const payments = new Hono<{ Bindings: Env }>();

// MVP Mock Topup (Remove in production!)
payments.post('/topup', async (c) => {
	const user = c.get('user');
	const { amount } = await c.req.json();
	
	if (!amount || amount <= 0) return c.json({ success: false, error: 'Invalid amount' }, 400);

	await c.env.DB.prepare('UPDATE users SET balance = balance + ? WHERE id = ?')
		.bind(amount, String(user.id)).run();

	return c.json({ success: true, message: `$${amount} added for testing.` });
});

// Generate Apirone Invoice
payments.post('/invoice', async (c) => {
	const user = c.get('user');
	const { amountUsd, currency } = await c.req.json(); 

	if (!amountUsd || amountUsd < 1) return c.json({ success: false, error: 'Minimum $1 required' }, 400);

	// Production Recommendation: Fetch live rates from Apirone ticker
	const mockCryptoRate: Record<string, number> = { 'ltc': 80, 'btc': 65000, 'doge': 0.15 }; 
	const cryptoPrice = mockCryptoRate[currency] || 1;
	const cryptoAmount = amountUsd / cryptoPrice;
	
	const minorUnitAmount = Math.floor(cryptoAmount * 100000000); // Satoshis
	const callbackUrl = `${c.env.APP_URL}/api/webhook/apirone?secret=${c.env.WEBHOOK_SECRET}`;

	try {
		const response = await fetch('https://apirone.com/api/v2/invoices', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				account: c.env.APIRONE_ACCOUNT,
				amount: minorUnitAmount,
				currency: currency,
				lifetime: 3600,
				callback_url: callbackUrl
			})
		});

		const invoiceData = await response.json();
		
		if (!invoiceData.invoice) {
			return c.json({ success: false, error: 'Failed to generate invoice from Apirone' }, 500);
		}

		await c.env.DB.prepare(
			'INSERT INTO invoices (id, user_id, amount_usd, currency) VALUES (?, ?, ?, ?)'
		).bind(invoiceData.invoice, String(user.id), amountUsd, currency).run();

		return c.json({ success: true, invoiceUrl: invoiceData.invoice_url });

	} catch (error) {
		return c.json({ success: false, error: 'Payment gateway error' }, 500);
	}
});

export default payments;
