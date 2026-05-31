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
	origin: '*', // Adjust for production if necessary
	allowHeaders: ['Content-Type', 'x-telegram-init-data'],
	allowMethods: ['GET', 'POST', 'OPTIONS'],
}));

// Global Error Handler (Prevents the app from crashing and sending raw HTML errors)
app.onError((err, c) => {
	console.error(`[SERVER ERROR]: ${err.message}`);
	return c.json({ 
		success: false, 
		error: 'Internal Server Error. Please try again later.' 
	}, 500);
});

// Protect all /api/ routes EXCEPT webhooks
app.use('/api/user/*', authMiddleware);
app.use('/api/store/*', authMiddleware);
app.use('/api/payments/invoice', authMiddleware); 
// Note: Webhook route is NOT protected by Telegram Auth

// Register Routes
app.route('/api/user', userRoute);
app.route('/api/store', storeRoute);
app.route('/api/payments', paymentsRoute);

// Catch-all 404
app.notFound((c) => c.json({ success: false, error: 'Endpoint not found' }, 404));

export default app;
