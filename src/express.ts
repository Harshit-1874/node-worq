import express, {
  type NextFunction,
  type Request,
  type Response,
  type Router,
} from "express";
import type { Server } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import type { JobStatus } from "./types.js";
import { JobNotFoundError, WriteNotAllowedError } from "./exceptions.js";
import { htmxError, htmxSuccess, isHtmxRequest } from "./htmx.js";
import type { WorqDashboardOptions } from "./options.js";
import { renderTemplate } from "./render.js";
import { createWorqState, type WorqState } from "./state.js";
import { pushStatsJson, STATS_PUSH_MS } from "./stats.js";
import { urlPathFromParts } from "./url.js";
import type { ActiveJob, MetricsBucket } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
const staticRoot = join(here, "..", "static");

const JOB_STATUSES: JobStatus[] = ["queued", "active", "scheduled", "failed", "complete"];
const MAX_BULK = 500;

function parseStatus(s: string | undefined): JobStatus {
  if (s && JOB_STATUSES.includes(s as JobStatus)) return s as JobStatus;
  return "queued";
}

function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
}

function urlPath(req: Request, basePath: string): string {
  return urlPathFromParts(req.baseUrl ?? "", req.path ?? "/", basePath);
}

function chartContext(metrics: { buckets?: MetricsBucket[] } | null): {
  chartBuckets: Array<MetricsBucket & { tsLabel: string }>;
  chartMax: number;
} {
  const buckets = (metrics?.buckets ?? []).slice(-30);
  const chartBuckets = buckets.map((b) => {
    const ts = typeof b.timestamp === "string" ? b.timestamp : String(b.timestamp);
    const tsLabel = ts.length >= 16 ? ts.slice(11, 16) : ts;
    return { ...b, tsLabel };
  });
  const chartMax = Math.max(0, ...chartBuckets.map((b) => b.processed));
  return { chartBuckets, chartMax };
}

function sendHtml(res: Response, status: number, html: string): void {
  res.status(status).type("text/html; charset=utf-8").send(html);
}

function sendJson(res: Response, status: number, body: unknown): void {
  res.status(status).json(body);
}

export interface WorqExpressMount {
  router: Router;
  state: WorqState;
  /** Call once with your HTTP server so live stats WebSocket works. */
  attachWebSocket: (server: Server) => void;
  close: () => Promise<void>;
}

/**
 * Create an Express router for the Worq dashboard.
 *
 * ```ts
 * const { router, attachWebSocket } = createWorqRouter({ adapter, basePath: "/worq" });
 * app.use("/worq", router);
 * attachWebSocket(app.listen(...)); // pass http.Server
 * ```
 */
export function createWorqRouter(opts: WorqDashboardOptions): WorqExpressMount {
  const state = createWorqState(opts);
  const router = express.Router();

  router.use(securityHeaders);
  router.use((req, _res, next) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      const ct = req.headers["content-type"];
      if (!ct || !String(ct).trim()) {
        req.headers["content-type"] = "application/json";
      }
    }
    next();
  });
  router.use(express.json({ limit: "1mb" }));
  router.use((req, _res, next) => {
    if (req.body === undefined || req.body === null) {
      req.body = {};
    }
    next();
  });
  router.use(
    "/static",
    express.static(staticRoot, {
      maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
    }),
  );

  const api = express.Router();

  api.get("/backends", (_req, res) => {
    sendJson(res, 200, { backends: [] });
  });

  api.get("/queues", async (_req, res) => {
    try {
      sendJson(res, 200, await state.adapter.getQueues());
    } catch (e) {
      sendJson(res, 500, { error: "adapter_error", detail: String(e) });
    }
  });

  api.get("/queues/:queue/jobs", async (req, res) => {
    const queue = decodeURIComponent(req.params.queue);
    const status = parseStatus(req.query.status as string | undefined);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    try {
      const items = await state.adapter.getQueueJobs(queue, status, offset, limit);
      let total = items.length;
      if (typeof state.adapter.countQueueJobs === "function") {
        total = await state.adapter.countQueueJobs(queue, status);
      }
      sendJson(res, 200, { items, total, offset, limit, has_more: offset + limit < total });
    } catch (e) {
      sendJson(res, 500, { error: "adapter_error", detail: String(e) });
    }
  });

  api.get("/jobs/:job_id", async (req, res) => {
    try {
      const data = await state.adapter.getJobDetail(req.params.job_id);
      sendJson(res, 200, { data });
    } catch (e) {
      if (e instanceof JobNotFoundError) {
        sendJson(res, 404, { error: "not_found", detail: String(e) });
        return;
      }
      sendJson(res, 500, { error: "adapter_error", detail: String(e) });
    }
  });

  api.get("/workers", async (_req, res) => {
    try {
      sendJson(res, 200, await state.adapter.getWorkers());
    } catch (e) {
      sendJson(res, 500, { error: "adapter_error", detail: String(e) });
    }
  });

  api.get("/scheduled", async (req, res) => {
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    try {
      const items = await state.adapter.getScheduledJobs(offset, limit);
      let total = items.length;
      const a = state.adapter as typeof state.adapter & {
        countScheduledJobs?: () => Promise<number>;
      };
      if (typeof a.countScheduledJobs === "function") {
        total = await a.countScheduledJobs();
      }
      sendJson(res, 200, { items, total, offset, limit, has_more: offset + limit < total });
    } catch (e) {
      sendJson(res, 500, { error: "adapter_error", detail: String(e) });
    }
  });

  api.get("/failed", async (req, res) => {
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    try {
      const items = await state.adapter.getFailedJobs(offset, limit);
      let total = items.length;
      const a = state.adapter as typeof state.adapter & {
        countFailedJobs?: () => Promise<number>;
      };
      if (typeof a.countFailedJobs === "function") {
        total = await a.countFailedJobs();
      }
      sendJson(res, 200, { items, total, offset, limit, has_more: offset + limit < total });
    } catch (e) {
      sendJson(res, 500, { error: "adapter_error", detail: String(e) });
    }
  });

  api.get("/stats", async (_req, res) => {
    try {
      const data = await state.adapter.getStats();
      sendJson(res, 200, { data });
    } catch (e) {
      sendJson(res, 500, { error: "adapter_error", detail: String(e) });
    }
  });

  api.get("/search", async (req, res) => {
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const status = req.query.status ? parseStatus(String(req.query.status)) : null;
    const startTime = req.query.after ? new Date(String(req.query.after)) : null;
    const endTime = req.query.before ? new Date(String(req.query.before)) : null;
    try {
      const [items, total] = await state.adapter.searchJobs(
        (req.query.q as string) ?? null,
        status,
        (req.query.queue as string) ?? null,
        startTime,
        endTime,
        offset,
        limit,
      );
      sendJson(res, 200, { items, total, offset, limit, has_more: offset + limit < total });
    } catch (e) {
      sendJson(res, 500, { error: "adapter_error", detail: String(e) });
    }
  });

  api.get("/metrics", async (req, res) => {
    const hours = Math.min(168, Math.max(1, Number(req.query.hours) || 24));
    try {
      const data = await state.adapter.getMetrics(hours);
      sendJson(res, 200, { data });
    } catch (e) {
      sendJson(res, 500, { error: "adapter_error", detail: String(e) });
    }
  });

  api.post("/jobs/:job_id/retry", async (req, res) => {
    try {
      await state.adapter.retryJob(req.params.job_id);
      if (isHtmxRequest(req.headers)) {
        res.status(200).type("text/html; charset=utf-8").send(htmxSuccess("Retried"));
        return;
      }
      sendJson(res, 200, { success: true, message: `Job '${req.params.job_id}' re-enqueued.` });
    } catch (e) {
      handleWriteError(res, req, e);
    }
  });

  api.delete("/jobs/:job_id", async (req, res) => {
    try {
      await state.adapter.deleteJob(req.params.job_id);
      if (isHtmxRequest(req.headers)) {
        res.status(200).type("text/html; charset=utf-8").send(htmxSuccess("Deleted"));
        return;
      }
      sendJson(res, 200, { success: true, message: `Job '${req.params.job_id}' deleted.` });
    } catch (e) {
      handleWriteError(res, req, e);
    }
  });

  api.post("/scheduled/:job_id/enqueue", async (req, res) => {
    try {
      await state.adapter.enqueueNow(req.params.job_id);
      if (isHtmxRequest(req.headers)) {
        res.status(200).type("text/html; charset=utf-8").send(htmxSuccess("Enqueued"));
        return;
      }
      sendJson(res, 200, {
        success: true,
        message: `Job '${req.params.job_id}' enqueued for immediate execution.`,
      });
    } catch (e) {
      handleWriteError(res, req, e, true);
    }
  });

  api.post("/bulk/retry", async (req, res) => {
    const ids = (req.body as { job_ids?: string[] })?.job_ids ?? [];
    if (ids.length < 1 || ids.length > MAX_BULK) {
      sendJson(res, 400, { error: "bad_request", detail: "job_ids length 1-500" });
      return;
    }
    try {
      const count = await state.adapter.bulkRetry(ids);
      sendJson(res, 200, {
        success: true,
        count,
        message: `Retried ${count} of ${ids.length} jobs.`,
      });
    } catch (e) {
      if (e instanceof WriteNotAllowedError) {
        sendJson(res, 403, { error: "forbidden", detail: String(e) });
        return;
      }
      sendJson(res, 500, { error: "adapter_error", detail: String(e) });
    }
  });

  api.post("/bulk/delete", async (req, res) => {
    const ids = (req.body as { job_ids?: string[] })?.job_ids ?? [];
    if (ids.length < 1 || ids.length > MAX_BULK) {
      sendJson(res, 400, { error: "bad_request", detail: "job_ids length 1-500" });
      return;
    }
    try {
      const count = await state.adapter.bulkDelete(ids);
      sendJson(res, 200, {
        success: true,
        count,
        message: `Deleted ${count} of ${ids.length} jobs.`,
      });
    } catch (e) {
      if (e instanceof WriteNotAllowedError) {
        sendJson(res, 403, { error: "forbidden", detail: String(e) });
        return;
      }
      sendJson(res, 500, { error: "adapter_error", detail: String(e) });
    }
  });

  api.post("/bulk/enqueue", async (req, res) => {
    const ids = (req.body as { job_ids?: string[] })?.job_ids ?? [];
    if (ids.length < 1 || ids.length > MAX_BULK) {
      sendJson(res, 400, { error: "bad_request", detail: "job_ids length 1-500" });
      return;
    }
    try {
      const count = await state.adapter.bulkEnqueue(ids);
      sendJson(res, 200, {
        success: true,
        count,
        message: `Enqueued ${count} of ${ids.length} jobs.`,
      });
    } catch (e) {
      if (e instanceof WriteNotAllowedError) {
        sendJson(res, 403, { error: "forbidden", detail: String(e) });
        return;
      }
      sendJson(res, 500, { error: "adapter_error", detail: String(e) });
    }
  });

  api.get("/cron", async (_req, res) => {
    try {
      sendJson(res, 200, await state.adapter.getCronJobs());
    } catch (e) {
      sendJson(res, 500, { error: "adapter_error", detail: String(e) });
    }
  });

  api.post("/cron/:function_name/trigger", async (req, res) => {
    const name = decodeURIComponent(req.params.function_name);
    try {
      const jobId = await state.adapter.triggerCronJob(name);
      if (isHtmxRequest(req.headers)) {
        res.status(200).type("text/html; charset=utf-8").send(htmxSuccess("Triggered"));
        return;
      }
      sendJson(res, 200, { success: true, message: `Cron job '${name}' triggered as '${jobId}'.` });
    } catch (e) {
      handleWriteError(res, req, e, true);
    }
  });

  api.get("/audit", (req, res) => {
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 100));
    sendJson(res, 200, { items: [], total: 0, offset, limit, has_more: false });
  });

  api.get("/alerts", (_req, res) => {
    sendJson(res, 200, { alerts: [] });
  });

  router.use("/api", api);

  router.get("/api/sse/stats", async (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    const run = async (): Promise<void> => {
      try {
        while (!res.writableEnded) {
          res.write(`data: ${await pushStatsJson(state.adapter)}\n\n`);
          await new Promise((r) => setTimeout(r, STATS_PUSH_MS));
        }
      } catch {
        /* client gone */
      }
    };
    void run();
    res.on("close", () => res.end());
  });

  router.get("/", async (req, res) => {
    const up = urlPath(req, state.basePath);
    let queues: Awaited<ReturnType<typeof state.adapter.getQueues>> = [];
    let failed_jobs: Awaited<ReturnType<typeof state.adapter.getFailedJobs>> = [];
    let metrics: Awaited<ReturnType<typeof state.adapter.getMetrics>> | null = null;
    let active_jobs: ActiveJob[] = [];
    try {
      queues = await state.adapter.getQueues();
      failed_jobs = await state.adapter.getFailedJobs(0, 5);
      metrics = await state.adapter.getMetrics(24);
      const ext = state.adapter as typeof state.adapter & {
        getActiveJobs?: () => Promise<ActiveJob[]>;
      };
      if (typeof ext.getActiveJobs === "function") {
        active_jobs = await ext.getActiveJobs();
      }
    } catch {
      /* */
    }
    const { chartBuckets, chartMax } = chartContext(metrics);
    sendHtml(
      res,
      200,
      renderTemplate("index.html", {
        title: state.title,
        page_title: "Dashboard",
        allowWrite: state.allowWrite,
        rootPath: state.basePath,
        urlPath: up,
        queues,
        failed_jobs,
        metrics,
        active_jobs,
        chartBuckets,
        chartMax,
      }),
    );
  });

  router.get("/queues", async (req, res) => {
    let queues: Awaited<ReturnType<typeof state.adapter.getQueues>> = [];
    try {
      queues = await state.adapter.getQueues();
    } catch {
      queues = [];
    }
    sendHtml(
      res,
      200,
      renderTemplate("queues.html", {
        title: state.title,
        page_title: "Queues",
        allowWrite: state.allowWrite,
        rootPath: state.basePath,
        urlPath: urlPath(req, state.basePath),
        queues,
      }),
    );
  });

  router.get("/workers", async (req, res) => {
    let worker_health: unknown[] = [];
    let active_jobs: unknown[] = [];
    try {
      const ext = state.adapter as typeof state.adapter & {
        getWorkerHealth?: () => Promise<unknown[]>;
        getActiveJobs?: () => Promise<unknown[]>;
      };
      if (typeof ext.getWorkerHealth === "function") {
        worker_health = await ext.getWorkerHealth();
      }
      if (typeof ext.getActiveJobs === "function") {
        active_jobs = await ext.getActiveJobs();
      }
    } catch {
      /* */
    }
    sendHtml(
      res,
      200,
      renderTemplate("workers.html", {
        title: state.title,
        page_title: "Workers",
        allowWrite: state.allowWrite,
        rootPath: state.basePath,
        urlPath: urlPath(req, state.basePath),
        worker_health,
        active_jobs,
      }),
    );
  });

  router.get("/scheduled", async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const q = (req.query.q as string) || null;
    const pageSize = 50;
    const offset = (page - 1) * pageSize;
    let scheduled_jobs: Awaited<ReturnType<typeof state.adapter.getScheduledJobs>> = [];
    let total_count = 0;
    try {
      scheduled_jobs = await state.adapter.getScheduledJobs(offset, pageSize);
      const ext = state.adapter as typeof state.adapter & {
        countScheduledJobs?: () => Promise<number>;
      };
      if (typeof ext.countScheduledJobs === "function") {
        total_count = await ext.countScheduledJobs();
      } else {
        total_count = scheduled_jobs.length;
      }
      if (q) {
        const ql = q.toLowerCase();
        scheduled_jobs = scheduled_jobs.filter((j) =>
          j.function_name.toLowerCase().includes(ql),
        );
        total_count = scheduled_jobs.length;
      }
    } catch {
      scheduled_jobs = [];
    }
    const total_pages = Math.max(Math.ceil(total_count / pageSize) || 1, 1);
    sendHtml(
      res,
      200,
      renderTemplate("scheduled.html", {
        title: state.title,
        page_title: "Scheduled Jobs",
        allowWrite: state.allowWrite,
        rootPath: state.basePath,
        urlPath: urlPath(req, state.basePath),
        scheduled_jobs,
        q,
        page,
        total_pages,
        total_count,
      }),
    );
  });

  router.get("/failed", async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const q = (req.query.q as string) || null;
    const pageSize = 50;
    const offset = (page - 1) * pageSize;
    let failed_jobs: Awaited<ReturnType<typeof state.adapter.getFailedJobs>> = [];
    let total_count = 0;
    try {
      failed_jobs = await state.adapter.getFailedJobs(offset, pageSize);
      const ext = state.adapter as typeof state.adapter & {
        countFailedJobs?: () => Promise<number>;
      };
      if (typeof ext.countFailedJobs === "function") {
        total_count = await ext.countFailedJobs();
      } else {
        total_count = failed_jobs.length;
      }
      if (q) {
        const ql = q.toLowerCase();
        failed_jobs = failed_jobs.filter((j) => j.function_name.toLowerCase().includes(ql));
        total_count = failed_jobs.length;
      }
    } catch {
      failed_jobs = [];
    }
    const total_pages = Math.max(Math.ceil(total_count / pageSize) || 1, 1);
    sendHtml(
      res,
      200,
      renderTemplate("failed.html", {
        title: state.title,
        page_title: "Failed Jobs",
        allowWrite: state.allowWrite,
        rootPath: state.basePath,
        urlPath: urlPath(req, state.basePath),
        failed_jobs,
        q,
        page,
        total_pages,
        total_count,
      }),
    );
  });

  router.get("/cron", async (req, res) => {
    let cron_jobs: Awaited<ReturnType<typeof state.adapter.getCronJobs>> = [];
    try {
      cron_jobs = await state.adapter.getCronJobs();
    } catch {
      cron_jobs = [];
    }
    sendHtml(
      res,
      200,
      renderTemplate("cron.html", {
        title: state.title,
        page_title: "Cron Jobs",
        allowWrite: state.allowWrite,
        rootPath: state.basePath,
        urlPath: urlPath(req, state.basePath),
        cron_jobs,
      }),
    );
  });

  router.get("/jobs/:job_id", async (req, res) => {
    try {
      const job = await state.adapter.getJobDetail(req.params.job_id);
      sendHtml(
        res,
        200,
        renderTemplate("job_detail.html", {
          title: state.title,
          page_title: `Job ${String(req.params.job_id).slice(0, 12)}...`,
          allowWrite: state.allowWrite,
          rootPath: state.basePath,
          urlPath: urlPath(req, state.basePath),
          job,
        }),
      );
    } catch (e) {
      if (e instanceof JobNotFoundError) {
        res.status(404).send("Job not found");
        return;
      }
      res.status(500).send("Error loading job");
    }
  });

  const wsPath = `${state.basePath || ""}/ws/stats`.replace(/\/+/g, "/") || "/ws/stats";

  function attachWebSocket(server: Server): void {
    const wss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (request, socket, head) => {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      if (pathname !== wsPath && pathname !== wsPath.replace(/\/$/, "")) {
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    });
    wss.on("connection", (ws) => {
      const id = setInterval(() => {
        void (async () => {
          try {
            ws.send(await pushStatsJson(state.adapter));
          } catch {
            ws.close();
          }
        })();
      }, STATS_PUSH_MS);
      ws.on("close", () => clearInterval(id));
    });
  }

  return {
    router,
    state,
    attachWebSocket,
    close: () => state.adapter.close(),
  };
}

function handleWriteError(
  res: Response,
  req: Request,
  e: unknown,
  includeNotFound = false,
): void {
  if (e instanceof WriteNotAllowedError) {
    if (isHtmxRequest(req.headers)) {
      res.status(200).type("text/html; charset=utf-8").send(htmxError("Write disabled"));
      return;
    }
    sendJson(res, 403, { error: "forbidden", detail: String(e) });
    return;
  }
  if (includeNotFound && e instanceof JobNotFoundError) {
    if (isHtmxRequest(req.headers)) {
      res.status(200).type("text/html; charset=utf-8").send(htmxError("Not found"));
      return;
    }
    sendJson(res, 404, { error: "not_found", detail: String(e) });
    return;
  }
  if (isHtmxRequest(req.headers)) {
    res.status(200).type("text/html; charset=utf-8").send(htmxError("Error"));
    return;
  }
  sendJson(res, 500, { error: "adapter_error", detail: String(e) });
}
