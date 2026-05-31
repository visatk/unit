import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { Env, Variables } from './types';
import { authMiddleware } from './middleware/auth';
import userRoute from './routes/user';
import storeRoute from './routes/store';
import paymentsRoute from './routes/payments';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Middlewares
app.use('*', logger());
app.use('/api/*', cors({
	origin: '*', // For Telegram Mini Apps, '*' is usually required or specific TWA domains
	allowHeaders: ['Content-Type', 'x-telegram-init-data'],
	allowMethods: ['GET', 'POST', 'OPTIONS'],
	maxAge: 86400, // Preflight caching for better performance
}));

// Robust Global Error Handler
app.onError((err, c) => {
	console.error(`[Worker Error] Path: ${c.req.path} | Error: ${err.message}`);
	
	// Ensure we don't leak sensitive DB details to the client
	const isDev = c.env.WEBHOOK_SECRET === 'dev'; 
	const errorMessage = isDev ? err.message : 'Internal Server Error. Please try again.';
	
	return c.json({ success: false, error: errorMessage }, 500);
});

// Protect routes
app.use('/api/user/*', authMiddleware);
app.use('/api/store/*', authMiddleware);
app.use('/api/payments/invoice', authMiddleware);

// Webhook route remains unprotected by Telegram Auth
// app.post('/api/payments/webhook', ... ) is handled inside paymentsRoute

// Mount Routes
app.route('/api/user', userRoute);
app.route('/api/store', storeRoute);
app.route('/api/payments', paymentsRoute);

app.notFound((c) => c.json({ success: false, error: 'Endpoint not found' }, 404));

export default app;
