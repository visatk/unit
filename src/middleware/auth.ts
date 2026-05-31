import { Context, Next } from 'hono';
import { Env } from '../types';

export async function validateTelegramAuth(initDataString: string, botToken: string): Promise<any | null> {
	try {
		const urlParams = new URLSearchParams(initDataString);
		const hash = urlParams.get('hash');
		if (!hash) return null;
		
		urlParams.delete('hash');
		urlParams.sort();
		const checkString = Array.from(urlParams.entries()).map(([k, v]) => `${k}=${v}`).join('\n');
		const encoder = new TextEncoder();
		
		const secretKey = await crypto.subtle.importKey('raw', encoder.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, true, ['sign']);
		const secret = await crypto.subtle.sign('HMAC', secretKey, encoder.encode(botToken));
		const signatureKey = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, true, ['sign']);
		const signature = await crypto.subtle.sign('HMAC', signatureKey, encoder.encode(checkString));
		
		const hex = [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');

		if (hex === hash) {
			const userStr = urlParams.get('user');
			return userStr ? JSON.parse(userStr) : null;
		}
		return null;
	} catch (error) {
		return null;
	}
}

export const authMiddleware = async (c: Context<{ Bindings: Env }>, next: Next) => {
	const initData = c.req.header('x-telegram-init-data');
	if (!initData) return c.json({ success: false, error: 'Unauthorized Access' }, 401);
	
	const user = await validateTelegramAuth(initData, c.env.TELEGRAM_BOT_TOKEN);
	if (!user) return c.json({ success: false, error: 'Invalid Session' }, 401);
	
	c.set('user', user);
	await next();
};
