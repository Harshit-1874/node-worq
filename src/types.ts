/** JSON-serializable shapes for the dashboard REST API and UI. */

export type JobStatus = "queued" | "active" | "scheduled" | "failed" | "complete";

export interface QueueInfo {
  name: string;
  queued: number;
  active: number;
  scheduled: number;
  failed: number;
  complete: number;
}

export interface JobSummary {
  job_id: string;
  function_name: string;
  status: JobStatus;
  enqueue_time: string;
  score?: number | null;
}

export interface JobDetail {
  job_id: string;
  function_name: string;
  status: JobStatus;
  enqueue_time: string;
  score?: number | null;
  args: unknown[];
  kwargs: Record<string, unknown>;
  job_try?: number | null;
  queue_name: string;
  start_time?: string | null;
  finish_time?: string | null;
  duration_ms?: number | null;
  success?: boolean | null;
  result?: unknown;
  error?: string | null;
  traceback?: string | null;
}

export interface WorkerInfo {
  worker_id: string;
  queue_name: string;
  jobs_complete: number;
  jobs_failed: number;
  jobs_retried: number;
  jobs_ongoing: number;
  queued: number;
  last_heartbeat: string;
  current_job: JobSummary | null;
}

export interface ScheduledJob {
  job_id: string;
  function_name: string;
  args: unknown[];
  kwargs: Record<string, unknown>;
  scheduled_at: string;
  remaining_seconds: number;
}

export interface FailedJob {
  job_id: string;
  function_name: string;
  args: unknown[];
  kwargs: Record<string, unknown>;
  error: string;
  traceback?: string | null;
  failed_at: string;
  job_try: number;
}

export interface ActiveJob {
  job_id: string;
  function_name: string;
  queue_name: string;
  started_at?: string | null;
  running_for_seconds: number;
  args: unknown[];
  kwargs: Record<string, unknown>;
}

export interface QueueWorkerHealth {
  queue_name: string;
  status: string;
  last_heartbeat?: string | null;
  seconds_ago?: number | null;
}

export interface DashboardStats {
  queues: QueueInfo[];
  total_workers: number;
  total_active: number;
  timestamp: string;
}

export interface MetricsBucket {
  timestamp: string;
  processed: number;
  failed: number;
  avg_duration_ms: number;
}

export interface MetricsHistory {
  buckets: MetricsBucket[];
  total_processed: number;
  total_failed: number;
  failure_rate: number;
  avg_duration_ms: number;
}

export interface CronJobInfo {
  function_name: string;
  schedule: string;
  last_run?: string | null;
  next_run?: string | null;
  last_result?: string | null;
  is_running: boolean;
}

export interface AuditEntry {
  timestamp: string;
  action: string;
  job_ids: string[];
  user?: string | null;
  ip_address: string;
  tenant: string;
  backend: string;
  success: boolean;
  detail?: string | null;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
}

export interface StatsResponse {
  data: DashboardStats;
}

export interface JobDetailResponse {
  data: JobDetail;
}

export interface ActionResponse {
  success: boolean;
  message: string;
}

export interface BulkRequest {
  job_ids: string[];
}

export interface BulkResponse {
  success: boolean;
  count: number;
  message: string;
}

export interface MetricsResponse {
  data: MetricsHistory;
}

export interface ErrorBody {
  error: string;
  detail?: string | null;
}
