import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AdapterError, JobNotFoundError, WriteNotAllowedError } from "./exceptions.js";
import type { JobStatus } from "./types.js";

const JOB_STATUSES: JobStatus[] = ["queued", "active", "scheduled", "failed", "complete"];
const MAX_BULK = 500;

function parseStatus(s: string | undefined): JobStatus {
  if (s && JOB_STATUSES.includes(s as JobStatus)) return s as JobStatus;
  return "queued";
}

function isHtmx(request: FastifyRequest): boolean {
  return request.headers["hx-request"] === "true";
}

function htmxSuccess(message: string): string {
  const safe = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  return `<span class="badge badge-complete" style="animation: fadeIn 0.3s">${safe}</span>`;
}

function htmxError(message: string): string {
  const safe = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  return `<span class="badge badge-failed" style="animation: fadeIn 0.3s">${safe}</span>`;
}

export async function registerApiRoutes(fastify: FastifyInstance): Promise<void> {
  await fastify.register(
    async (f) => {
      f.get("/backends", async () => ({ backends: [] as string[] }));

      f.get("/queues", async (request, reply) => {
        try {
          return await request.server.worq.adapter.getQueues();
        } catch (e) {
          reply.code(500).send({ error: "adapter_error", detail: String(e) });
          return reply;
        }
      });

      f.get<{
        Params: { queue: string };
        Querystring: { status?: string; offset?: string; limit?: string };
      }>("/queues/:queue/jobs", async (request, reply) => {
        const queue = decodeURIComponent(request.params.queue);
        const status = parseStatus(request.query.status);
        const offset = Math.max(0, Number(request.query.offset) || 0);
        const limit = Math.min(200, Math.max(1, Number(request.query.limit) || 50));
        try {
          const adapter = request.server.worq.adapter;
          const items = await adapter.getQueueJobs(queue, status, offset, limit);
          let total = items.length;
          if (typeof adapter.countQueueJobs === "function") {
            total = await adapter.countQueueJobs(queue, status);
          }
          return {
            items,
            total,
            offset,
            limit,
            has_more: offset + limit < total,
          };
        } catch (e) {
          reply.code(500).send({ error: "adapter_error", detail: String(e) });
          return reply;
        }
      });

      f.get<{ Params: { job_id: string } }>("/jobs/:job_id", async (request, reply) => {
        try {
          const data = await request.server.worq.adapter.getJobDetail(request.params.job_id);
          return { data };
        } catch (e) {
          if (e instanceof JobNotFoundError) {
            reply.code(404).send({ error: "not_found", detail: String(e) });
            return reply;
          }
          reply.code(500).send({ error: "adapter_error", detail: String(e) });
          return reply;
        }
      });

      f.get("/workers", async (request, reply) => {
        try {
          return await request.server.worq.adapter.getWorkers();
        } catch (e) {
          reply.code(500).send({ error: "adapter_error", detail: String(e) });
          return reply;
        }
      });

      f.get<{ Querystring: { offset?: string; limit?: string } }>(
        "/scheduled",
        async (request, reply) => {
          const offset = Math.max(0, Number(request.query.offset) || 0);
          const limit = Math.min(200, Math.max(1, Number(request.query.limit) || 50));
          try {
            const items = await request.server.worq.adapter.getScheduledJobs(offset, limit);
            let total = items.length;
            const a = request.server.worq.adapter as QueueAdapterWithCounts;
            if (typeof a.countScheduledJobs === "function") {
              total = await a.countScheduledJobs();
            }
            return {
              items,
              total,
              offset,
              limit,
              has_more: offset + limit < total,
            };
          } catch (e) {
            reply.code(500).send({ error: "adapter_error", detail: String(e) });
            return reply;
          }
        },
      );

      f.get<{ Querystring: { offset?: string; limit?: string } }>("/failed", async (request, reply) => {
        const offset = Math.max(0, Number(request.query.offset) || 0);
        const limit = Math.min(200, Math.max(1, Number(request.query.limit) || 50));
        try {
          const items = await request.server.worq.adapter.getFailedJobs(offset, limit);
          let total = items.length;
          const a = request.server.worq.adapter as QueueAdapterWithCounts;
          if (typeof a.countFailedJobs === "function") {
            total = await a.countFailedJobs();
          }
          return {
            items,
            total,
            offset,
            limit,
            has_more: offset + limit < total,
          };
        } catch (e) {
          reply.code(500).send({ error: "adapter_error", detail: String(e) });
          return reply;
        }
      });

      f.get("/stats", async (request, reply) => {
        try {
          const data = await request.server.worq.adapter.getStats();
          return { data };
        } catch (e) {
          reply.code(500).send({ error: "adapter_error", detail: String(e) });
          return reply;
        }
      });

      f.get<{
        Querystring: {
          q?: string;
          status?: string;
          queue?: string;
          after?: string;
          before?: string;
          offset?: string;
          limit?: string;
        };
      }>("/search", async (request, reply) => {
        const offset = Math.max(0, Number(request.query.offset) || 0);
        const limit = Math.min(200, Math.max(1, Number(request.query.limit) || 50));
        const status = request.query.status ? parseStatus(request.query.status) : null;
        const startTime = request.query.after ? new Date(request.query.after) : null;
        const endTime = request.query.before ? new Date(request.query.before) : null;
        try {
          const [items, total] = await request.server.worq.adapter.searchJobs(
            request.query.q ?? null,
            status,
            request.query.queue ?? null,
            startTime,
            endTime,
            offset,
            limit,
          );
          return {
            items,
            total,
            offset,
            limit,
            has_more: offset + limit < total,
          };
        } catch (e) {
          reply.code(500).send({ error: "adapter_error", detail: String(e) });
          return reply;
        }
      });

      f.get<{ Querystring: { hours?: string } }>("/metrics", async (request, reply) => {
        const hours = Math.min(168, Math.max(1, Number(request.query.hours) || 24));
        try {
          const data = await request.server.worq.adapter.getMetrics(hours);
          return { data };
        } catch (e) {
          reply.code(500).send({ error: "adapter_error", detail: String(e) });
          return reply;
        }
      });

      f.post<{ Params: { job_id: string } }>("/jobs/:job_id/retry", async (request, reply) => {
        try {
          await request.server.worq.adapter.retryJob(request.params.job_id);
          if (isHtmx(request)) {
            reply.type("text/html; charset=utf-8").send(htmxSuccess("Retried"));
            return reply;
          }
          return { success: true, message: `Job '${request.params.job_id}' re-enqueued.` };
        } catch (e) {
          if (e instanceof WriteNotAllowedError) {
            if (isHtmx(request)) {
              reply.type("text/html; charset=utf-8").send(htmxError("Write disabled"));
              return reply;
            }
            reply.code(403).send({ error: "forbidden", detail: String(e) });
            return reply;
          }
          if (e instanceof JobNotFoundError) {
            if (isHtmx(request)) {
              reply.type("text/html; charset=utf-8").send(htmxError("Not found"));
              return reply;
            }
            reply.code(404).send({ error: "not_found", detail: String(e) });
            return reply;
          }
          reply.code(500).send({ error: "adapter_error", detail: String(e) });
          return reply;
        }
      });

      f.delete<{ Params: { job_id: string } }>("/jobs/:job_id", async (request, reply) => {
        try {
          await request.server.worq.adapter.deleteJob(request.params.job_id);
          if (isHtmx(request)) {
            reply.type("text/html; charset=utf-8").send(htmxSuccess("Deleted"));
            return reply;
          }
          return { success: true, message: `Job '${request.params.job_id}' deleted.` };
        } catch (e) {
          if (e instanceof WriteNotAllowedError) {
            if (isHtmx(request)) {
              reply.type("text/html; charset=utf-8").send(htmxError("Write disabled"));
              return reply;
            }
            reply.code(403).send({ error: "forbidden", detail: String(e) });
            return reply;
          }
          reply.code(500).send({ error: "adapter_error", detail: String(e) });
          return reply;
        }
      });

      f.post<{ Params: { job_id: string } }>(
        "/scheduled/:job_id/enqueue",
        async (request, reply) => {
          try {
            await request.server.worq.adapter.enqueueNow(request.params.job_id);
            if (isHtmx(request)) {
              reply.type("text/html; charset=utf-8").send(htmxSuccess("Enqueued"));
              return reply;
            }
            return {
              success: true,
              message: `Job '${request.params.job_id}' enqueued for immediate execution.`,
            };
          } catch (e) {
            if (e instanceof WriteNotAllowedError) {
              if (isHtmx(request)) {
                reply.type("text/html; charset=utf-8").send(htmxError("Write disabled"));
                return reply;
              }
              reply.code(403).send({ error: "forbidden", detail: String(e) });
              return reply;
            }
            if (e instanceof JobNotFoundError) {
              if (isHtmx(request)) {
                reply.type("text/html; charset=utf-8").send(htmxError("Not found"));
                return reply;
              }
              reply.code(404).send({ error: "not_found", detail: String(e) });
              return reply;
            }
            reply.code(500).send({ error: "adapter_error", detail: String(e) });
            return reply;
          }
        },
      );

      f.post<{ Body: { job_ids?: string[] } }>("/bulk/retry", async (request, reply) => {
        const ids = request.body?.job_ids ?? [];
        if (ids.length < 1 || ids.length > MAX_BULK) {
          reply.code(400).send({ error: "bad_request", detail: "job_ids length 1-500" });
          return reply;
        }
        try {
          const count = await request.server.worq.adapter.bulkRetry(ids);
          return {
            success: true,
            count,
            message: `Retried ${count} of ${ids.length} jobs.`,
          };
        } catch (e) {
          if (e instanceof WriteNotAllowedError) {
            reply.code(403).send({ error: "forbidden", detail: String(e) });
            return reply;
          }
          reply.code(500).send({ error: "adapter_error", detail: String(e) });
          return reply;
        }
      });

      f.post<{ Body: { job_ids?: string[] } }>("/bulk/delete", async (request, reply) => {
        const ids = request.body?.job_ids ?? [];
        if (ids.length < 1 || ids.length > MAX_BULK) {
          reply.code(400).send({ error: "bad_request", detail: "job_ids length 1-500" });
          return reply;
        }
        try {
          const count = await request.server.worq.adapter.bulkDelete(ids);
          return {
            success: true,
            count,
            message: `Deleted ${count} of ${ids.length} jobs.`,
          };
        } catch (e) {
          if (e instanceof WriteNotAllowedError) {
            reply.code(403).send({ error: "forbidden", detail: String(e) });
            return reply;
          }
          reply.code(500).send({ error: "adapter_error", detail: String(e) });
          return reply;
        }
      });

      f.post<{ Body: { job_ids?: string[] } }>("/bulk/enqueue", async (request, reply) => {
        const ids = request.body?.job_ids ?? [];
        if (ids.length < 1 || ids.length > MAX_BULK) {
          reply.code(400).send({ error: "bad_request", detail: "job_ids length 1-500" });
          return reply;
        }
        try {
          const count = await request.server.worq.adapter.bulkEnqueue(ids);
          return {
            success: true,
            count,
            message: `Enqueued ${count} of ${ids.length} jobs.`,
          };
        } catch (e) {
          if (e instanceof WriteNotAllowedError) {
            reply.code(403).send({ error: "forbidden", detail: String(e) });
            return reply;
          }
          reply.code(500).send({ error: "adapter_error", detail: String(e) });
          return reply;
        }
      });

      f.get("/cron", async (request, reply) => {
        try {
          return await request.server.worq.adapter.getCronJobs();
        } catch (e) {
          reply.code(500).send({ error: "adapter_error", detail: String(e) });
          return reply;
        }
      });

      f.post<{ Params: { function_name: string } }>(
        "/cron/:function_name/trigger",
        async (request, reply) => {
          const name = decodeURIComponent(request.params.function_name);
          try {
            const jobId = await request.server.worq.adapter.triggerCronJob(name);
            if (isHtmx(request)) {
              reply.type("text/html; charset=utf-8").send(htmxSuccess("Triggered"));
              return reply;
            }
            return {
              success: true,
              message: `Cron job '${name}' triggered as '${jobId}'.`,
            };
          } catch (e) {
            if (e instanceof WriteNotAllowedError) {
              if (isHtmx(request)) {
                reply.type("text/html; charset=utf-8").send(htmxError("Write disabled"));
                return reply;
              }
              reply.code(403).send({ error: "forbidden", detail: String(e) });
              return reply;
            }
            if (isHtmx(request)) {
              reply.type("text/html; charset=utf-8").send(htmxError("Error"));
              return reply;
            }
            reply.code(500).send({ error: "adapter_error", detail: String(e) });
            return reply;
          }
        },
      );

      f.get<{
        Querystring: { offset?: string; limit?: string; action?: string; user?: string };
      }>("/audit", async (request, reply) => {
        const offset = Math.max(0, Number(request.query.offset) || 0);
        const limit = Math.min(1000, Math.max(1, Number(request.query.limit) || 100));
        return {
          items: [],
          total: 0,
          offset,
          limit,
          has_more: false,
        };
      });

      f.get("/alerts", async () => ({ alerts: [] as unknown[] }));
    },
    { prefix: "/api" },
  );
}

type QueueAdapterWithCounts = {
  countScheduledJobs?(): Promise<number>;
  countFailedJobs?(): Promise<number>;
};
