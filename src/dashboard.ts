import fastifyPlugin from "fastify-plugin";
import fastifyStatic from "@fastify/static";
import fastifyView from "@fastify/view";
import websocket from "@fastify/websocket";
import nunjucks from "nunjucks";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { QueueAdapter } from "./adapter.js";
import { installWorqFilters, templatesRoot } from "./nunjucksEnv.js";
import { registerApiRoutes } from "./registerApi.js";
import { registerPageRoutes } from "./registerPages.js";
import { WriteGuard } from "./writeGuard.js";

const here = dirname(fileURLToPath(import.meta.url));
const staticRoot = join(here, "..", "static");
const PUSH_MS = 2000;

export interface WorqDashboardOptions {
  adapter: QueueAdapter;
  title?: string;
  allowWrite?: boolean;
  basePath?: string;
}

async function pushStatsJson(adapter: QueueAdapter): Promise<string> {
  const stats = await adapter.getStats();
  return JSON.stringify(stats);
}

export default fastifyPlugin<WorqDashboardOptions>(
  async (fastify, opts) => {
    const allowWrite = opts.allowWrite ?? false;
    const basePath = (opts.basePath ?? "").replace(/\/$/, "") || "";
    const title = opts.title ?? "Worq";
    const guarded = new WriteGuard(opts.adapter, allowWrite);

    fastify.decorate("worq", {
      adapter: guarded,
      title,
      allowWrite,
      basePath,
    });

    // HTMX POST/DELETE with no body often omit Content-Type; Fastify would return 415.
    fastify.removeContentTypeParser("application/json");
    fastify.addContentTypeParser(
      "application/json",
      { parseAs: "string" },
      (_req, body, done) => {
        try {
          const text = typeof body === "string" ? body : body.toString();
          done(null, text.length > 0 ? JSON.parse(text) : {});
        } catch (err) {
          done(err as Error, undefined);
        }
      },
    );
    fastify.addHook("onRequest", async (request) => {
      if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return;
      const ct = request.headers["content-type"];
      if (!ct || !String(ct).trim()) {
        request.headers["content-type"] = "application/json";
      }
    });

    await fastify.register(fastifyView, {
      root: templatesRoot(),
      engine: { nunjucks },
      options: {
        noCache: process.env.NODE_ENV !== "production",
        onConfigure: (env: nunjucks.Environment) => {
          installWorqFilters(env);
        },
      },
      includeViewExtension: false,
      viewExt: "html",
    });

    await fastify.register(fastifyStatic, {
      root: staticRoot,
      prefix: "/static/",
    });

    await registerApiRoutes(fastify);
    await registerPageRoutes(fastify);

    fastify.get("/api/sse/stats", async (request, reply) => {
      const adapter = request.server.worq.adapter;
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const run = async (): Promise<void> => {
        try {
          while (!reply.raw.destroyed) {
            reply.raw.write(`data: ${await pushStatsJson(adapter)}\n\n`);
            await new Promise((r) => setTimeout(r, PUSH_MS));
          }
        } catch {
          /* */
        }
      };
      void run();
      return reply;
    });

    await fastify.register(websocket);
    fastify.get("/ws/stats", { websocket: true }, (socket, request) => {
      const adapter = request.server.worq.adapter;
      const id = setInterval(() => {
        void (async () => {
          try {
            socket.send(await pushStatsJson(adapter));
          } catch {
            socket.close();
          }
        })();
      }, PUSH_MS);
      socket.on("close", () => clearInterval(id));
    });

    fastify.addHook("onSend", async (_req, reply) => {
      reply.header("X-Frame-Options", "DENY");
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    });

    fastify.addHook("onClose", async () => {
      await guarded.close();
    });
  },
  {
    name: "node-worq",
    fastify: "5.x",
    encapsulate: true,
  },
);
