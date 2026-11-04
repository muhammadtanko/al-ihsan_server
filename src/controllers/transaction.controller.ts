import { prisma } from "../connections/prisma.conn";
import { recordTransactionSchema } from "../models/transaction.model";
import { created, ok } from "../utils/http";
import { generateRef } from "../utils/ids";
import { transactionDto } from "../utils/mappers";

class TransactionController {
  async list() {
    const rows = await prisma.transaction.findMany({ orderBy: { date: "desc" } });
    return ok(rows.map(transactionDto));
  }

  // Manual admin entry — gateway payments arrive on their own.
  async record(body: unknown) {
    const input = recordTransactionSchema.parse(body);
    const row = await prisma.transaction.create({
      data: { ref: generateRef("MAN"), who: input.who, type: input.type, amount: input.amount, status: "Confirmed" },
    });
    return created(transactionDto(row));
  }
}

export default new TransactionController();
