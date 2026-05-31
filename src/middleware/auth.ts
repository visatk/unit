import { Context, Next } from 'hono';
import { Env, Variables } from '../types';

export async function validateTelegramAuth(initDataString: string, botToken: string) {
	try {
		const urlParams = new URLSearchParams(initDataString);
		const hash = urlParams.get('hash');
		if (!hash) return null;
		
		urlParams.delete('hash');
		urlParams.sort();
		
		const checkString = Array.from(urlParams.entries())
			.map(([k, v]) => `${k}=${v}`)
			.join('\n');
			
		const encoder = new TextEncoder();
		const secretKey = await crypto.subtle.importKey(
			'raw', 
			encoder.encode('WebAppData'), 
			{ name: 'HMAC', hash: 'SHA-256' }, 
			true, 
			['sign']
		);
		const secret = await crypto.subtle.sign('HMAC', secretKey, encoder.encode(botToken));
		const signatureKey = await crypto.subtle.importKey(
			'raw', 
			secret, 
			{ name: 'HMAC', hash: 'SHA-256' }, 
			true, 
			['sign']
		);
		const signature = await crypto.subtle.sign('HMAC', signatureKey, encoder.encode(checkString));
		const hex = [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');

		if (hex === hash) {
			const userStr = urlParams.get('user');
			return userStr ? JSON.parse(userStr) : null;
		}
		return null;
	} catch (error) {
		console.error("Auth validation failed:", error);
		return null;
	}
}

export const authMiddleware = async (c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) => {
	const initData = c.req.header('x-telegram-init-data');
	
	if (!initData) {
		return c.json({ success: false, error: 'Unauthorized: Missing Telegram Data' }, 401);
	}
	
	const botToken = c.env.TELEGRAM_BOT_TOKEN;
	if (!botToken) {
		console.error("CRITICAL: TELEGRAM_BOT_TOKEN is not set in environment!");
		return c.json({ success: false, error: 'Server configuration error' }, 500);
	}

	const user = await validateTelegramAuth(initData, botToken);
	if (!user) {
		return c.json({ success: false, error: 'Invalid or Expired Session' }, 401);
	}
	
	c.set('user', user);
	await next();
};
