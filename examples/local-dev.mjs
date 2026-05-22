/**
 * Local smoke test for node-worq.
 *
 * Prerequisites:
 *   - Redis on localhost:6379 (e.g. docker run -d -p 6379:6379 redis:7-alpine)
 *   - npm run build
 *   - Optional: npm run seed (adds sample BullMQ jobs)
 *
 * Open http://127.0.0.1:3333/worq
 */
import Fastify from "fastify";
import { createDashboard, BullMQAdapter } from "../dist/index.js";

const PORT = Number(process.env.PORT) || 3333;
/** ioredis options — set REDIS_URL or host/port/password (and username for ACL). */
const REDIS = process.env.REDIS_URL
  ? process.env.REDIS_URL
  : {
      host: process.env.REDIS_HOST ?? "127.0.0.1",
      port: Number(process.env.REDIS_PORT) || 6379,
      ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
      ...(process.env.REDIS_USERNAME ? { username: process.env.REDIS_USERNAME } : {}),
      ...(process.env.REDIS_TLS === "1" ? { tls: {} } : {}),
    };

const QUEUE_NAMES = (process.env.QUEUES ?? "demo")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const adapter = new BullMQAdapter({
  connection: REDIS,
  queueNames: QUEUE_NAMES,
});

const app = Fastify({ logger: true });

await app.register(createDashboard, {
  prefix: "/worq",
  adapter,
  title: "Worq (local)",
  allowWrite: true,
  basePath: "/worq",
});

app.get("/", async (_req, reply) => {
  return reply.redirect("/worq/");
});

try {
  await app.listen({ port: PORT, host: "127.0.0.1" });
  console.log(`Dashboard: http://127.0.0.1:${PORT}/worq`);
  const redisLabel =
    typeof REDIS === "string" ? REDIS.replace(/:[^:@/]+@/, ":***@") : `${REDIS.host}:${REDIS.port}`;
  console.log(`Queues: ${QUEUE_NAMES.join(", ")} | Redis: ${redisLabel}`);
} catch (err) {
  console.error(err);
  process.exit(1);
}
