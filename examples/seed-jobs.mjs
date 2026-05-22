/**
 * Enqueue sample jobs so the local dashboard has data to show.
 * Run after Redis is up: npm run seed
 */
import { Queue } from "bullmq";

const REDIS = process.env.REDIS_URL
  ? process.env.REDIS_URL
  : {
      host: process.env.REDIS_HOST ?? "127.0.0.1",
      port: Number(process.env.REDIS_PORT) || 6379,
      ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
      ...(process.env.REDIS_USERNAME ? { username: process.env.REDIS_USERNAME } : {}),
    };

const queue = new Queue("demo", { connection: REDIS });

const jobs = [
  { name: "sendWelcomeEmail", data: { to: "user@example.com" } },
  { name: "generateReport", data: { reportId: "r-42" } },
  { name: "syncInventory", data: { sku: "ABC-123" } },
];

for (const j of jobs) {
  const added = await queue.add(j.name, j.data);
  console.log("enqueued", added.id, j.name);
}

// One delayed job (shows on Scheduled)
const delayed = await queue.add(
  "nightlyCleanup",
  { scope: "all" },
  { delay: 60_000 },
);
console.log("enqueued delayed", delayed.id, "nightlyCleanup (60s)");

// One job that will fail if you run the worker below with failing handler
const fail = await queue.add("failOnPurpose", { reason: "demo" });
console.log("enqueued (for failed tab after worker runs)", fail.id);

await queue.close();
console.log("Done. Start dashboard: npm run dev");
