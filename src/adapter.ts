import type {
  CronJobInfo,
  DashboardStats,
  FailedJob,
  JobDetail,
  JobStatus,
  JobSummary,
  MetricsHistory,
  QueueInfo,
  ScheduledJob,
  WorkerInfo,
} from "./types.js";

/** Contract implemented by queue backends for the dashboard. */
export interface QueueAdapter {
  getQueues(): Promise<QueueInfo[]>;
  getQueueJobs(
    queue: string,
    status: JobStatus,
    offset?: number,
    limit?: number,
  ): Promise<JobSummary[]>;
  getJobDetail(jobId: string): Promise<JobDetail>;
  getWorkers(): Promise<WorkerInfo[]>;
  getScheduledJobs(offset?: number, limit?: number): Promise<ScheduledJob[]>;
  getFailedJobs(offset?: number, limit?: number): Promise<FailedJob[]>;
  getStats(): Promise<DashboardStats>;
  searchJobs(
    query?: string | null,
    status?: JobStatus | null,
    queue?: string | null,
    startTime?: Date | null,
    endTime?: Date | null,
    offset?: number,
    limit?: number,
  ): Promise<[JobSummary[], number]>;
  getMetrics(hours?: number): Promise<MetricsHistory>;
  getCronJobs(): Promise<CronJobInfo[]>;
  triggerCronJob(functionName: string): Promise<string>;
  retryJob(jobId: string): Promise<void>;
  deleteJob(jobId: string): Promise<void>;
  enqueueNow(jobId: string): Promise<void>;
  bulkRetry(jobIds: string[]): Promise<number>;
  bulkDelete(jobIds: string[]): Promise<number>;
  bulkEnqueue(jobIds: string[]): Promise<number>;
  close(): Promise<void>;
  /** Optional exact total for job list pagination (implemented by BullMQAdapter). */
  countQueueJobs?(queue: string, status: JobStatus): Promise<number>;
}

/** Optional extensions used by HTML pages (counts, active jobs, worker health). */
export interface QueueAdapterExtras {
  countScheduledJobs?(): Promise<number>;
  countFailedJobs?(): Promise<number>;
  getActiveJobs?(): Promise<import("./types.js").ActiveJob[]>;
  getWorkerHealth?(): Promise<import("./types.js").QueueWorkerHealth[]>;
}
