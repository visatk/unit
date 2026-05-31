export type Env = {
	TELEGRAM_BOT_TOKEN: string;
	APIRONE_ACCOUNT: string;
	WEBHOOK_SECRET: string;
	DB: D1Database;
};

export type Variables = {
	user: {
		id: number;
		first_name: string;
		username?: string;
		language_code?: string;
	};
};
