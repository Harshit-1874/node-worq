# node-worq

Mountable **job-queue dashboard** for **Node.js** using **Fastify** and **BullMQ**: REST API, server-rendered UI (Nunjucks + HTMX), live stats over **WebSocket** and **SSE**, and a Redis-backed **BullMQ** adapter.

Repository: [github.com/Harshit-1874/node-worq](https://github.com/Harshit-1874/node-worq). Bundled HTML/CSS/JS under `templates/` and `static/` includes third-party UI material used under MIT; see **`THIRD_PARTY_NOTICES.txt`**.

## Install

```bash
npm install node-worq
```

Requires **Node 20+**, **Redis**, and a **Fastify 5** app. Point the adapter at the same Redis and queue names your BullMQ workers use.

## Quick start (Fastify + BullMQ)

```typescript
import Fastify from "fastify";
import { createDashboard, BullMQAdapter } from "node-worq";

const app = Fastify();

const adapter = new BullMQAdapter({
  connection: { host: "127.0.0.1", port: 6379 },
  queueNames: ["email", "reports"],
});

await app.register(createDashboard, {
  prefix: "/worq",
  adapter,
  title: "Worq",
  allowWrite: false,
  basePath: "/worq",
});
```

Set **`basePath`** to the same value as the Fastify **`prefix`** so links, static files, `/api/*`, `/ws/stats`, and HTMX calls resolve correctly.

### Password-protected or remote Redis

`connection` is [ioredis `RedisOptions`](https://github.com/redis/ioredis#connect-to-redis). Use the **same** credentials as your BullMQ workers:

```typescript
const adapter = new BullMQAdapter({
  connection: {
    host: "redis.example.com",
    port: 6379,
    password: process.env.REDIS_PASSWORD,
    username: process.env.REDIS_USERNAME, // Redis 6+ ACL, if required
    // tls: {},                          // managed Redis (e.g. TLS)
  },
  queueNames: ["email"],
});
```

Or a single URL:

```typescript
connection: process.env.REDIS_URL!, // redis://:password@host:6379/0
```

Local dev with env vars:

```bash
REDIS_PASSWORD=secret npm run dev
# or
REDIS_URL='redis://:secret@127.0.0.1:6379' npm run dev
```

If the password is wrong or Redis is unreachable, the dashboard will error when loading queue stats (check server logs).

## Typed HTTP client

Use **`createWorqClient`** against any server that exposes this package’s REST API (same routes and JSON shapes), for example another deployment of this dashboard:

```typescript
import { createWorqClient } from "node-worq";

const client = createWorqClient({
  baseUrl: "https://example.com/worq",
  headers: { Authorization: "Basic ..." },
});

const queues = await client.listQueues();
```

## Scope (v0.1)

- **BullMQ** is the supported queue backend in this package.
- **Metrics**, **search**, and **cron** endpoints exist; the BullMQ adapter may return empty or minimal data until extended.
- **Workers** health is a placeholder where BullMQ does not expose the same signals as other systems.

## Publishing to npm

1. **Account**: [Create an npm account](https://www.npmjs.com/signup) and run `npm login`.
2. **Name**: The package is published as **`node-worq`**. If you ever need an alternate public name, use a scoped package (e.g. `@your-scope/node-worq`) and `npm publish --access public`.
3. **Build**: From this directory, `npm run build` (also runs on `prepublishOnly` before publish).
4. **Dry run**: `npm publish --dry-run` and confirm the pack includes `dist/`, `templates/`, `static/`, `LICENSE`, `README.md`, and `THIRD_PARTY_NOTICES.txt`.
5. **Publish**: `npm publish` (or `npm publish --access public` for a new scoped public package).
6. **Versions**: `npm version patch|minor|major` then `npm publish`.

## License

MIT — see [LICENSE](./LICENSE). Third-party UI notices: [THIRD_PARTY_NOTICES.txt](./THIRD_PARTY_NOTICES.txt).
