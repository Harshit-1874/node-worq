/**
 * Optional: process jobs from the "demo" queue so active/complete/failed tabs update.
 * Terminal 2: npm run worker
 */
import { Worker } from "bullmq";

const REDIS = process.env.REDIS_URL
  ? process.env.REDIS_URL
  : {
      host: process.env.REDIS_HOST ?? "127.0.0.1",
      port: Number(process.env.REDIS_PORT) || 6379,
      ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
      ...(process.env.REDIS_USERNAME ? { username: process.env.REDIS_USERNAME } : {}),
    };

const worker = new Worker(
  "demo",
  async (job) => {
    console.log("processing", job.id, job.name, job.data);
    if (job.name === "failOnPurpose") {
      throw new Error("Intentional failure for dashboard demo");
    }
    await new Promise((r) => setTimeout(r, 500));
    return { ok: true };
  },
  { connection: REDIS },
);

worker.on("completed", (job) => console.log("completed", job.id));
worker.on("failed", (job, err) => console.log("failed", job?.id, err.message));

console.log("Worker listening on queue: demo");
