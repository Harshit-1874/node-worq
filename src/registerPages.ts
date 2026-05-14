import type { FastifyInstance, FastifyRequest } from "fastify";
import { AdapterError, JobNotFoundError } from "./exceptions.js";
import type { ActiveJob, MetricsBucket } from "./types.js";

function urlPath(request: FastifyRequest, basePath: string): string {
  const raw = request.url.split("?")[0] ?? "/";
  const bp = basePath.replace(/\/$/, "");
  if (!bp) return raw || "/";
  return `${bp}${raw === "/" ? "" : raw}` || "/";
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

export async function registerPageRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/", async (request, reply) => {
    const { adapter, title, allowWrite, basePath } = request.server.worq;
    const rootPath = basePath;
    const up = urlPath(request, basePath);
    let queues: Awaited<ReturnType<typeof adapter.getQueues>> = [];
    let failed_jobs: Awaited<ReturnType<typeof adapter.getFailedJobs>> = [];
    let metrics: Awaited<ReturnType<typeof adapter.getMetrics>> | null = null;
    let active_jobs: ActiveJob[] = [];
    try {
      queues = await adapter.getQueues();
      failed_jobs = await adapter.getFailedJobs(0, 5);
      metrics = await adapter.getMetrics(24);
      const ext = adapter as typeof adapter & { getActiveJobs?: () => Promise<unknown[]> };
      if (typeof ext.getActiveJobs === "function") {
        active_jobs = await ext.getActiveJobs();
      }
    } catch {
      /* empty */
    }
    const { chartBuckets, chartMax } = chartContext(metrics);
    return reply.view("index.html", {
      title,
      page_title: "Dashboard",
      allowWrite,
      rootPath,
      urlPath: up,
      queues,
      failed_jobs,
      metrics,
      active_jobs,
      chartBuckets,
      chartMax,
    });
  });

  fastify.get("/queues", async (request, reply) => {
    const { adapter, title, allowWrite, basePath } = request.server.worq;
    let queues: Awaited<ReturnType<typeof adapter.getQueues>> = [];
    try {
      queues = await adapter.getQueues();
    } catch {
      queues = [];
    }
    return reply.view("queues.html", {
      title,
      page_title: "Queues",
      allowWrite,
      rootPath: basePath,
      urlPath: urlPath(request, basePath),
      queues,
    });
  });

  fastify.get("/workers", async (request, reply) => {
    const { adapter, title, allowWrite, basePath } = request.server.worq;
    let worker_health: unknown[] = [];
    let active_jobs: unknown[] = [];
    try {
      const ext = adapter as typeof adapter & {
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
    return reply.view("workers.html", {
      title,
      page_title: "Workers",
      allowWrite,
      rootPath: basePath,
      urlPath: urlPath(request, basePath),
      worker_health,
      active_jobs,
    });
  });

  fastify.get<{ Querystring: { q?: string; page?: string } }>(
    "/scheduled",
    async (request, reply) => {
      const { adapter, title, allowWrite, basePath } = request.server.worq;
      const page = Math.max(1, Number(request.query.page) || 1);
      const q = request.query.q ?? null;
      const pageSize = 50;
      const offset = (page - 1) * pageSize;
      let scheduled_jobs: Awaited<ReturnType<typeof adapter.getScheduledJobs>> = [];
      let total_count = 0;
      try {
        scheduled_jobs = await adapter.getScheduledJobs(offset, pageSize);
        const ext = adapter as typeof adapter & { countScheduledJobs?: () => Promise<number> };
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
      return reply.view("scheduled.html", {
        title,
        page_title: "Scheduled Jobs",
        allowWrite,
        rootPath: basePath,
        urlPath: urlPath(request, basePath),
        scheduled_jobs,
        q,
        page,
        total_pages,
        total_count,
      });
    },
  );

  fastify.get<{ Querystring: { q?: string; page?: string } }>("/failed", async (request, reply) => {
    const { adapter, title, allowWrite, basePath } = request.server.worq;
    const page = Math.max(1, Number(request.query.page) || 1);
    const q = request.query.q ?? null;
    const pageSize = 50;
    const offset = (page - 1) * pageSize;
    let failed_jobs: Awaited<ReturnType<typeof adapter.getFailedJobs>> = [];
    let total_count = 0;
    try {
      failed_jobs = await adapter.getFailedJobs(offset, pageSize);
      const ext = adapter as typeof adapter & { countFailedJobs?: () => Promise<number> };
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
    return reply.view("failed.html", {
      title,
      page_title: "Failed Jobs",
      allowWrite,
      rootPath: basePath,
      urlPath: urlPath(request, basePath),
      failed_jobs,
      q,
      page,
      total_pages,
      total_count,
    });
  });

  fastify.get("/cron", async (request, reply) => {
    const { adapter, title, allowWrite, basePath } = request.server.worq;
    let cron_jobs: Awaited<ReturnType<typeof adapter.getCronJobs>> = [];
    try {
      cron_jobs = await adapter.getCronJobs();
    } catch {
      cron_jobs = [];
    }
    return reply.view("cron.html", {
      title,
      page_title: "Cron Jobs",
      allowWrite,
      rootPath: basePath,
      urlPath: urlPath(request, basePath),
      cron_jobs,
    });
  });

  fastify.get<{ Params: { job_id: string } }>("/jobs/:job_id", async (request, reply) => {
    const { adapter, title, allowWrite, basePath } = request.server.worq;
    try {
      const job = await adapter.getJobDetail(request.params.job_id);
      return reply.view("job_detail.html", {
        title,
        page_title: `Job ${String(request.params.job_id).slice(0, 12)}...`,
        allowWrite,
        rootPath: basePath,
        urlPath: urlPath(request, basePath),
        job,
      });
    } catch (e) {
      if (e instanceof JobNotFoundError) {
        reply.code(404).send("Job not found");
        return reply;
      }
      if (e instanceof AdapterError) {
        reply.code(500).send("Error loading job");
        return reply;
      }
      reply.code(500).send("Error loading job");
      return reply;
    }
  });
}
