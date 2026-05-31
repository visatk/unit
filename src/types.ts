export type Env = {
	TELEGRAM_BOT_TOKEN: string;
	APIRONE_ACCOUNT: string; // Your Apirone Account ID
	WEBHOOK_SECRET: string;  // Secret to secure your webhooks
	APP_URL: string;         // e.g., https://your-worker.workers.dev
	DB: D1Database;
};
