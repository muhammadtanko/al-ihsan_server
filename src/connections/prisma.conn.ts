import { PrismaClient } from "@prisma/client";

// Single shared client (the Postgres counterpart of the sample's mongo.conn).
export const prisma = new PrismaClient();

export async function connectDb(): Promise<void> {
  await prisma.$connect();
  console.log("Connected to PostgreSQL");
}

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
  console.log("Disconnected from PostgreSQL");
}
