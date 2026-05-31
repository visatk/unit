import { Hono } from 'hono';
import { Env } from './types';
import { authMiddleware } from './middleware/auth';
import userRoute from './routes/user';
import storeRoute from './routes/store';
import paymentsRoute from './routes/payments';

const app = new Hono<{ Bindings: Env }>();

// --- PUBLIC WEBHOOK ROUTE (No Auth) ---
app.post('/api/webhook/apirone', async (c) => {
	const secret = c.req.query('secret');
	if (secret !== c.env.WEBHOOK_SECRET) {
		return c.json({ error: 'Forbidden' }, 403);
	}

	const body = await c.req.json();
	const { invoice, status } = body; 
	const db = c.env.DB;
	const existingInvoice = await db.prepare('SELECT * FROM invoices WHERE id = ?').bind(invoice).first<any>();

	if (!existingInvoice || existingInvoice.status === 'completed' || existingInvoice.status === 'paid') {
		return c.text('OK'); 
	}

	if (status === 'paid' || status === 'completed') {
		try {
			await db.batch([
				db.prepare("UPDATE invoices SET status = 'completed' WHERE id = ?").bind(invoice),
				db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").bind(existingInvoice.amount_usd, existingInvoice.user_id)
			]);
		} catch (error) {
			console.error("Webhook DB Error:", error);
		}
	}
	return c.text('*ok*'); // Standard Apirone acknowledge format
});


// --- PROTECTED API ROUTES ---
app.use('/api/*', authMiddleware);

// Map exactly how Frontend calls them
app.route('/api/user', userRoute);
app.route('/api/store', storeRoute);
app.route('/api/payments', paymentsRoute);

app.all('*', (c) => c.notFound());

export default app;
