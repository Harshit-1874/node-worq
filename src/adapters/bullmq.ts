import { Job, Queue } from "bullmq";
import type { JobType } from "bullmq";
import type { RedisOptions } from "ioredis";
import { Redis } from "ioredis";
import { AdapterError, JobNotFoundError, QueueNotFoundError } from "../exceptions.js";
import type { QueueAdapter } from "../adapter.js";
import type {
  ActiveJob,
  CronJobInfo,
  DashboardStats,
  FailedJob,
  JobDetail,
  JobStatus,
  JobSummary,
  MetricsHistory,
  QueueInfo,
  QueueWorkerHealth,
  ScheduledJob,
  WorkerInfo,
} from "../types.js";

export interface BullMQAdapterOptions {
  connection: RedisOptions;
  queueNames: string[];
}

function statusToTypes(status: JobStatus): JobType[] {
  switch (status) {
    case "queued":
      return ["waiting", "paused"];
    case "active":
      return ["active"];
    case "scheduled":
      return ["delayed"];
    case "failed":
      return ["failed"];
    case "complete":
      return ["completed"];
    default:
      return ["waiting"];
  }
}

function countTypesInCounts(
  counts: Record<string, number | undefined>,
  types: JobType[],
): number {
  let n = 0;
  for (const t of types) {
    n += counts[t] ?? 0;
  }
  return n;
}

function numericDelay(delay: unknown): number | null {
  if (typeof delay === "number" && !Number.isNaN(delay)) return delay;
  return null;
}

function stacktraceString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(String).join("\n");
  return String(v);
}

async function bullStateToJobStatus(job: Job): Promise<JobStatus> {
  const s = (await job.getState()) as string;
  if (s === "waiting" || s === "paused") return "queued";
  if (s === "active") return "active";
  if (s === "delayed") return "scheduled";
  if (s === "failed") return "failed";
  if (s === "completed") return "complete";
  return "queued";
}

export class BullMQAdapter implements QueueAdapter {
  private readonly connection: Redis;
  private readonly queues = new Map<string, Queue>();

  constructor(opts: BullMQAdapterOptions) {
    this.connection = new Redis(opts.connection);
    for (const name of opts.queueNames) {
      this.queues.set(name, new Queue(name, { connection: this.connection.duplicate() }));
    }
  }

  private getQueue(name: string): Queue {
    const q = this.queues.get(name);
    if (!q) throw new QueueNotFoundError(`Unknown queue: ${name}`);
    return q;
  }

  async getQueues(): Promise<QueueInfo[]> {
    const out: QueueInfo[] = [];
    try {
      for (const [name, q] of this.queues) {
        const c = await q.getJobCounts(
          "waiting",
          "paused",
          "active",
          "delayed",
          "failed",
          "completed",
        );
        out.push({
          name,
          queued: (c.waiting ?? 0) + (c.paused ?? 0),
          active: c.active ?? 0,
          scheduled: c.delayed ?? 0,
          failed: c.failed ?? 0,
          complete: c.completed ?? 0,
        });
      }
      return out;
    } catch (e) {
      throw new AdapterError("Failed to read queue stats", { cause: String(e) });
    }
  }

  async getQueueJobs(
    queue: string,
    status: JobStatus,
    offset = 0,
    limit = 50,
  ): Promise<JobSummary[]> {
    const q = this.getQueue(queue);
    const types = statusToTypes(status);
    const asc = status !== "failed" && status !== "complete";
    const end = offset + limit - 1;
    try {
      const jobs = await q.getJobs(types, offset, end, asc);
      const summaries: JobSummary[] = [];
      for (const job of jobs) {
        if (!job.id) continue;
        summaries.push(await this.jobToSummary(job, queue));
      }
      return summaries;
    } catch (e) {
      throw new AdapterError("Failed to list jobs", { cause: String(e) });
    }
  }

  private async jobToSummary(job: Job, _queueName: string): Promise<JobSummary> {
    const st = await bullStateToJobStatus(job);
    const delayMs = numericDelay(job.opts.delay);
    const timestamp = job.timestamp ?? Date.now();
    return {
      job_id: String(job.id),
      function_name: job.name || "(anonymous)",
      status: st,
      enqueue_time: new Date(timestamp).toISOString(),
      score: delayMs != null ? timestamp + delayMs : null,
    };
  }

  private async jobToDetail(job: Job, queueName: string): Promise<JobDetail> {
    const st = await bullStateToJobStatus(job);
    const processedOn = job.processedOn;
    const finishedOn = job.finishedOn;
    const timestamp = job.timestamp ?? Date.now();
    let duration: number | null = null;
    if (processedOn && finishedOn) duration = finishedOn - processedOn;

    const data = job.data as unknown;
    const args: unknown[] = data == null ? [] : [data];
    const kwargs: Record<string, unknown> = {};

    const delayMs = numericDelay(job.opts.delay);
    return {
      job_id: String(job.id),
      function_name: job.name || "(anonymous)",
      status: st,
      enqueue_time: new Date(timestamp).toISOString(),
      score: delayMs != null ? timestamp + delayMs : null,
      args,
      kwargs,
      job_try: job.attemptsMade,
      queue_name: queueName,
      start_time: processedOn ? new Date(processedOn).toISOString() : null,
      finish_time: finishedOn ? new Date(finishedOn).toISOString() : null,
      duration_ms: duration,
      success: finishedOn ? st !== "failed" : null,
      result: job.returnvalue,
      error: job.failedReason ?? null,
      traceback: stacktraceString(job.stacktrace),
    };
  }

  async getJobDetail(jobId: string): Promise<JobDetail> {
    for (const [qName, q] of this.queues) {
      const job = await Job.fromId(q, jobId);
      if (job) return this.jobToDetail(job, qName);
    }
    throw new JobNotFoundError(`No job with id ${jobId}`);
  }

  async countQueueJobs(queue: string, status: JobStatus): Promise<number> {
    const q = this.getQueue(queue);
    const c = await q.getJobCounts(
      "waiting",
      "paused",
      "active",
      "delayed",
      "failed",
      "completed",
    );
    return countTypesInCounts(c, statusToTypes(status));
  }

  async getWorkers(): Promise<WorkerInfo[]> {
    return [];
  }

  async getScheduledJobs(offset = 0, limit = 50): Promise<ScheduledJob[]> {
    const out: ScheduledJob[] = [];
    try {
      for (const [, q] of this.queues) {
        const jobs = await q.getJobs(["delayed"], 0, 9999, true);
        for (const job of jobs) {
          if (!job.id) continue;
          const delay = numericDelay(job.opts.delay) ?? 0;
          const ts = job.timestamp ?? Date.now();
          const scheduledAt = ts + delay;
          const remaining = Math.max(0, (scheduledAt - Date.now()) / 1000);
          const data = job.data as unknown;
          out.push({
            job_id: String(job.id),
            function_name: job.name || "(anonymous)",
            args: data == null ? [] : [data],
            kwargs: {},
            scheduled_at: new Date(scheduledAt).toISOString(),
            remaining_seconds: remaining,
          });
        }
      }
      out.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
      return out.slice(offset, offset + limit);
    } catch (e) {
      throw new AdapterError("Failed to list scheduled jobs", { cause: String(e) });
    }
  }

  async getFailedJobs(offset = 0, limit = 50): Promise<FailedJob[]> {
    const out: FailedJob[] = [];
    try {
      for (const [, q] of this.queues) {
        const jobs = await q.getJobs(["failed"], 0, 9999, false);
        for (const job of jobs) {
          if (!job.id) continue;
          const finishedOn = job.finishedOn ?? Date.now();
          const data = job.data as unknown;
          out.push({
            job_id: String(job.id),
            function_name: job.name || "(anonymous)",
            args: data == null ? [] : [data],
            kwargs: {},
            error: job.failedReason || "Unknown error",
            traceback: stacktraceString(job.stacktrace),
            failed_at: new Date(finishedOn).toISOString(),
            job_try: job.attemptsMade,
          });
        }
      }
      out.sort((a, b) => b.failed_at.localeCompare(a.failed_at));
      return out.slice(offset, offset + limit);
    } catch (e) {
      throw new AdapterError("Failed to list failed jobs", { cause: String(e) });
    }
  }

  async getStats(): Promise<DashboardStats> {
    const queues = await this.getQueues();
    const workers = await this.getWorkers();
    return {
      queues,
      total_workers: workers.length,
      total_active: queues.reduce((s, q) => s + q.active, 0),
      timestamp: new Date().toISOString(),
    };
  }

  async searchJobs(): Promise<[JobSummary[], number]> {
    return [[], 0];
  }

  async getMetrics(_hours = 24): Promise<MetricsHistory> {
    return {
      buckets: [],
      total_processed: 0,
      total_failed: 0,
      failure_rate: 0,
      avg_duration_ms: 0,
    };
  }

  async getCronJobs(): Promise<CronJobInfo[]> {
    return [];
  }

  async triggerCronJob(_functionName: string): Promise<string> {
    throw new AdapterError("Cron jobs are not available for BullMQAdapter.");
  }

  async retryJob(jobId: string): Promise<void> {
    const job = await this.findJob(jobId);
    await job.retry();
  }

  async deleteJob(jobId: string): Promise<void> {
    const job = await this.findJob(jobId);
    await job.remove();
  }

  async enqueueNow(jobId: string): Promise<void> {
    const job = await this.findJob(jobId);
    await job.changeDelay(0);
  }

  async bulkRetry(jobIds: string[]): Promise<number> {
    let n = 0;
    for (const id of jobIds) {
      try {
        await this.retryJob(id);
        n++;
      } catch {
        /* continue */
      }
    }
    return n;
  }

  async bulkDelete(jobIds: string[]): Promise<number> {
    let n = 0;
    for (const id of jobIds) {
      try {
        await this.deleteJob(id);
        n++;
      } catch {
        /* continue */
      }
    }
    return n;
  }

  async bulkEnqueue(jobIds: string[]): Promise<number> {
    let n = 0;
    for (const id of jobIds) {
      try {
        await this.enqueueNow(id);
        n++;
      } catch {
        /* continue */
      }
    }
    return n;
  }

  async countScheduledJobs(): Promise<number> {
    let t = 0;
    for (const [, q] of this.queues) {
      const c = await q.getJobCounts("delayed");
      t += c.delayed ?? 0;
    }
    return t;
  }

  async countFailedJobs(): Promise<number> {
    let t = 0;
    for (const [, q] of this.queues) {
      const c = await q.getJobCounts("failed");
      t += c.failed ?? 0;
    }
    return t;
  }

  async getActiveJobs(): Promise<ActiveJob[]> {
    const out: ActiveJob[] = [];
    const now = Date.now();
    for (const [qName, q] of this.queues) {
      const jobs = await q.getJobs(["active"], 0, 199, true);
      for (const job of jobs) {
        if (!job.id) continue;
        const processedOn = job.processedOn ?? now;
        const data = job.data as unknown;
        out.push({
          job_id: String(job.id),
          function_name: job.name || "(anonymous)",
          queue_name: qName,
          started_at: new Date(processedOn).toISOString(),
          running_for_seconds: (now - processedOn) / 1000,
          args: data == null ? [] : [data],
          kwargs: {},
        });
      }
    }
    return out;
  }

  async getWorkerHealth(): Promise<QueueWorkerHealth[]> {
    return [...this.queues.keys()].map((queue_name) => ({
      queue_name,
      status: "NO_WORKERS",
      last_heartbeat: null,
      seconds_ago: null,
    }));
  }

  async close(): Promise<void> {
    const closers: Promise<void>[] = [];
    for (const q of this.queues.values()) {
      closers.push(q.close());
    }
    await Promise.all(closers);
    this.connection.disconnect();
  }

  private async findJob(jobId: string): Promise<Job> {
    for (const [, q] of this.queues) {
      const job = await Job.fromId(q, jobId);
      if (job) return job;
    }
    throw new JobNotFoundError(`No job with id ${jobId}`);
  }
}
