# node-worq

Mountable **BullMQ job-queue dashboard** for Node.js — a Sidekiq-style UI you embed in your **Fastify** app. No separate process: one Redis connection, your queue names, live stats in the browser.

## Features

- **Dashboard UI** — queues, workers, scheduled & failed jobs, job detail, dark mode
- **Live updates** — WebSocket with SSE fallback
- **REST API** — same routes whether you use the UI or call it programmatically
- **Write actions** (optional) — retry, delete, run scheduled jobs now, bulk ops
- **BullMQ adapter** — reads the same Redis keys your workers use

## Requirements

- Node **20+**
- **Redis** (same instance as BullMQ)
- **Fastify 5** host app
- **BullMQ** workers on the queues you configure

## Install

```bash
npm install node-worq
```

## Quick start

```typescript
import Fastify from "fastify";
import { createDashboard, BullMQAdapter } from "node-worq";

const app = Fastify();

const adapter = new BullMQAdapter({
  connection: {
    host: process.env.REDIS_HOST ?? "127.0.0.1",
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD, // omit if not used
  },
  queueNames: ["email", "reports"], // must match your BullMQ queue names
});

await app.register(createDashboard, {
  prefix: "/worq",
  adapter,
  title: "Worq",
  allowWrite: false, // set true to enable retry / delete / run-now in the UI
  basePath: "/worq", // must match prefix
});

await app.listen({ port: 3000 });
```

Open **http://localhost:3000/worq**.

### Redis URL or TLS

```typescript
// URL (password in the string)
connection: process.env.REDIS_URL!, // redis://:password@host:6379/0

// Or full ioredis options — username for Redis ACL, tls for managed Redis
connection: {
  host: "redis.example.com",
  port: 6379,
  password: process.env.REDIS_PASSWORD,
  username: process.env.REDIS_USERNAME,
  tls: {},
},
```

Use the **same** Redis settings as your BullMQ workers.

## Configuration

| Option | Description |
|--------|-------------|
| `prefix` | URL path where the dashboard is mounted (e.g. `/worq`) |
| `basePath` | Same as `prefix` — used for links, static assets, and HTMX |
| `adapter` | `BullMQAdapter` instance |
| `title` | Header title in the UI |
| `allowWrite` | `false` by default; enable for retry/delete/enqueue actions |

## REST API (programmatic)

```typescript
import { createWorqClient } from "node-worq";

const client = createWorqClient({
  baseUrl: "https://api.example.com/worq",
});

const queues = await client.listQueues();
const stats = await client.getStats();
await client.retryJob("job-id");
```

Main routes: `/api/queues`, `/api/jobs/:id`, `/api/failed`, `/api/scheduled`, `/api/stats`, `/api/bulk/retry`, `/ws/stats`, `/api/sse/stats`.

## Current limitations (v0.1)

- **BullMQ only** — no Celery/RQ adapters
- **Search, metrics, cron** — API and UI exist; BullMQ adapter returns minimal/empty data for now
- **Worker health** — per-queue status is a best-effort placeholder (not full BullMQ worker registry)
- **Auth, audit, alerts** — not included yet

## Development (this repo)

```bash
git clone https://github.com/Harshit-1874/node-worq.git
cd node-worq
npm install
npm run dev          # http://127.0.0.1:3333/worq
npm run seed         # sample jobs (optional)
npm run worker       # process demo queue (optional)
```

## License

MIT — see [LICENSE](./LICENSE). UI assets under `templates/` and `static/` include third-party material; see [THIRD_PARTY_NOTICES.txt](./THIRD_PARTY_NOTICES.txt).
