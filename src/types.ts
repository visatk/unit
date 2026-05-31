export type Env = {
	TELEGRAM_BOT_TOKEN: string;
	APIRONE_ACCOUNT: string;
	WEBHOOK_SECRET: string; // Used to secure payment webhooks
	DB: D1Database;
};

// Custom variables for Hono Context
export type Variables = {
	user: {
		id: number;
		first_name: string;
		username?: string;
		language_code?: string;
	};
};
