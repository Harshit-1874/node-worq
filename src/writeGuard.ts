import { WriteNotAllowedError } from "./exceptions.js";
import type { QueueAdapter } from "./adapter.js";
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

/** Wraps an adapter and blocks write operations when allowWrite is false. */
export class WriteGuard implements QueueAdapter {
  countQueueJobs?: (queue: string, status: JobStatus) => Promise<number>;

  constructor(
    private readonly inner: QueueAdapter,
    private readonly allowWrite: boolean,
  ) {
    if (inner.countQueueJobs) {
      this.countQueueJobs = (queue, status) => inner.countQueueJobs!.call(inner, queue, status);
    }
  }

  private checkWrite(): void {
    if (!this.allowWrite) {
      throw new WriteNotAllowedError(
        "Write actions are disabled. Pass allowWrite: true to createDashboard().",
      );
    }
  }

  getQueues(): Promise<QueueInfo[]> {
    return this.inner.getQueues();
  }
  getQueueJobs(
    queue: string,
    status: JobStatus,
    offset?: number,
    limit?: number,
  ): Promise<JobSummary[]> {
    return this.inner.getQueueJobs(queue, status, offset, limit);
  }
  getJobDetail(jobId: string): Promise<JobDetail> {
    return this.inner.getJobDetail(jobId);
  }
  getWorkers(): Promise<WorkerInfo[]> {
    return this.inner.getWorkers();
  }
  getScheduledJobs(offset?: number, limit?: number): Promise<ScheduledJob[]> {
    return this.inner.getScheduledJobs(offset, limit);
  }
  getFailedJobs(offset?: number, limit?: number): Promise<FailedJob[]> {
    return this.inner.getFailedJobs(offset, limit);
  }
  getStats(): Promise<DashboardStats> {
    return this.inner.getStats();
  }
  searchJobs(
    query?: string | null,
    status?: JobStatus | null,
    queue?: string | null,
    startTime?: Date | null,
    endTime?: Date | null,
    offset?: number,
    limit?: number,
  ): Promise<[JobSummary[], number]> {
    return this.inner.searchJobs(query, status, queue, startTime, endTime, offset, limit);
  }
  getMetrics(hours?: number): Promise<MetricsHistory> {
    return this.inner.getMetrics(hours);
  }
  getCronJobs(): Promise<CronJobInfo[]> {
    return this.inner.getCronJobs();
  }
  async triggerCronJob(functionName: string): Promise<string> {
    this.checkWrite();
    return this.inner.triggerCronJob(functionName);
  }
  async retryJob(jobId: string): Promise<void> {
    this.checkWrite();
    return this.inner.retryJob(jobId);
  }
  async deleteJob(jobId: string): Promise<void> {
    this.checkWrite();
    return this.inner.deleteJob(jobId);
  }
  async enqueueNow(jobId: string): Promise<void> {
    this.checkWrite();
    return this.inner.enqueueNow(jobId);
  }
  async bulkRetry(jobIds: string[]): Promise<number> {
    this.checkWrite();
    return this.inner.bulkRetry(jobIds);
  }
  async bulkDelete(jobIds: string[]): Promise<number> {
    this.checkWrite();
    return this.inner.bulkDelete(jobIds);
  }
  async bulkEnqueue(jobIds: string[]): Promise<number> {
    this.checkWrite();
    return this.inner.bulkEnqueue(jobIds);
  }
  close(): Promise<void> {
    return this.inner.close();
  }
}
