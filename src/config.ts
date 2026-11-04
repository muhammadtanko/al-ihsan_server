import dotenv from "dotenv";
import path from "path";

dotenv.config();

const {
  APP_PORT,
  NODE_ENV,
  DATABASE_URL,
  JWT_KEY,
  JWT_EXPIRES_IN,
  CORS_ORIGINS,
  UPLOAD_DIR,
  SEED_PASSWORD,
  PAYMENT_BANK_NAME,
  PAYMENT_ACCOUNT_NUMBER,
  PAYMENT_ACCOUNT_NAME,
} = process.env;

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const config = {
  nodeEnv: NODE_ENV ?? "development",
  isProd: NODE_ENV === "production",
  appPort: Number(APP_PORT ?? 4000),
  databaseUrl: required("DATABASE_URL", DATABASE_URL),
  webToken: {
    secretKey: required("JWT_KEY", JWT_KEY),
    expiresIn: JWT_EXPIRES_IN ?? "8h",
  },
  corsOrigins: (CORS_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  uploadDir: path.resolve(UPLOAD_DIR ?? "uploads"),
  seedPassword: SEED_PASSWORD ?? "Console123!",
  // The one account everyone pays into when they choose bank transfer on the website.
  paymentAccount: {
    bankName: PAYMENT_BANK_NAME ?? "Zenith Bank",
    accountNumber: PAYMENT_ACCOUNT_NUMBER ?? "12345678908",
    accountName: PAYMENT_ACCOUNT_NAME ?? "Alihsan Health Service",
  },
};
