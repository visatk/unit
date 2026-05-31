import { Hono } from 'hono';
import { Env } from '../types';

const payments = new Hono<{ Bindings: Env }>();

// 1. Generate Apirone Invoice
payments.post('/invoice', async (c) => {
	const user = c.get('user');
	const { amountUsd, currency } = await c.req.json(); // e.g. amountUsd: 10, currency: 'ltc'

	if (!amountUsd || amountUsd < 1) return c.json({ success: false, error: 'Minimum $1 required' }, 400);

	// Apirone expects minor units (e.g., satoshis). For MVP, we estimate the crypto amount.
	// In production, fetch live rates using Apirone's /v1/ticker
	const mockCryptoRate: Record<string, number> = { 'ltc': 80, 'btc': 65000, 'doge': 0.15 }; 
	const cryptoPrice = mockCryptoRate[currency] || 1;
	const cryptoAmount = amountUsd / cryptoPrice;
	
	// Convert to smallest unit (assuming 8 decimals for standard crypto)
	const minorUnitAmount = Math.floor(cryptoAmount * 100000000);

	const callbackUrl = `${c.env.APP_URL}/api/webhook/apirone?secret=${c.env.WEBHOOK_SECRET}`;

	try {
		// Call Apirone Invoices API
		const response = await fetch('https://apirone.com/api/v2/invoices', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				account: c.env.APIRONE_ACCOUNT,
				amount: minorUnitAmount,
				currency: currency,
				lifetime: 3600, // 1 hour expiration
				callback_url: callbackUrl
			})
		});

		const invoiceData = await response.json();
		
		if (!invoiceData.invoice) {
			return c.json({ success: false, error: 'Failed to generate invoice from Apirone' }, 500);
		}

		// Save Invoice to D1 Database (Pending Status)
		await c.env.DB.prepare(
			'INSERT INTO invoices (id, user_id, amount_usd, currency) VALUES (?, ?, ?, ?)'
		).bind(invoiceData.invoice, String(user.id), amountUsd, currency).run();

		// Return Apirone's Hosted Invoice URL to the Frontend
		return c.json({ 
			success: true, 
			invoiceUrl: invoiceData.invoice_url 
		});

	} catch (error) {
		return c.json({ success: false, error: 'Payment gateway error' }, 500);
	}
});

export default payments;
