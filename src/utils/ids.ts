import { Prisma } from "@prisma/client";
import { prisma } from "../connections/prisma.conn";

type Tx = Prisma.TransactionClient | typeof prisma;

// Atomically bump and return the next value of a named sequence.
export async function nextSeq(key: string, tx: Tx = prisma): Promise<number> {
  const row = await tx.counter.upsert({
    where: { key },
    create: { key, value: 1 },
    update: { value: { increment: 1 } },
  });
  return row.value;
}

export const pad = (n: number, len: number) => String(n).padStart(len, "0");

const randomDigits = (len: number) =>
  Array.from({ length: len }, () => Math.floor(Math.random() * 10)).join("");

export const generateEnrollmentNumber = () => `AIH-${new Date().getFullYear()}-${randomDigits(6)}`;
export const generateMembershipNumber = () => `KAD-${randomDigits(3)}-${randomDigits(4)}`;
export const generateRef = (prefix: string) => `${prefix}-${randomDigits(5)}`;
