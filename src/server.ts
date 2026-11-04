import { createApp } from "./app";
import { config } from "./config";
import { connectDb, disconnectDb } from "./connections/prisma.conn";

async function main() {
  await connectDb();
  const server = createApp().listen(config.appPort, () => {
    console.log(`AL-IHSAN API listening on port ${config.appPort}`);
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down…`);
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
