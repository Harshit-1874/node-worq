import type {
  ActionResponse,
  BulkRequest,
  BulkResponse,
  CronJobInfo,
  ErrorBody,
  JobDetailResponse,
  JobStatus,
  MetricsResponse,
  PaginatedResponse,
  QueueInfo,
  ScheduledJob,
  FailedJob,
  JobSummary,
  StatsResponse,
  WorkerInfo,
} from "./types.js";

export interface WorqClientOptions {
  /** Base URL including mount path, e.g. `http://localhost:8000/worq` */
  baseUrl: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

export function createWorqClient(opts: WorqClientOptions) {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const base = opts.baseUrl.replace(/\/$/, "");
  const extra = opts.headers ?? {};

  async function req<T>(
    path: string,
    init?: RequestInit & { parseJson?: boolean },
  ): Promise<T> {
    const { parseJson = true, ...rest } = init ?? {};
    const r = await fetchFn(joinUrl(base, path), {
      ...rest,
      headers: {
        Accept: "application/json",
        ...extra,
        ...(rest.headers as Record<string, string>),
      },
    });
    const text = await r.text();
    if (!parseJson) return text as unknown as T;
    const data = text ? (JSON.parse(text) as unknown) : null;
    if (!r.ok) {
      const err = data as ErrorBody | null;
      throw new Error(err?.detail ?? err?.error ?? r.statusText);
    }
    return data as T;
  }

  return {
    listBackends: () => req<{ backends: string[] }>("/api/backends"),
    listQueues: () => req<QueueInfo[]>("/api/queues"),
    listQueueJobs: (
      queue: string,
      params?: { status?: JobStatus; offset?: number; limit?: number },
    ) => {
      const q = new URLSearchParams();
      if (params?.status) q.set("status", params.status);
      if (params?.offset != null) q.set("offset", String(params.offset));
      if (params?.limit != null) q.set("limit", String(params.limit));
      const qs = q.toString();
      const enc = encodeURIComponent(queue);
      return req<PaginatedResponse<JobSummary>>(
        `/api/queues/${enc}/jobs${qs ? `?${qs}` : ""}`,
      );
    },
    getJob: (jobId: string) =>
      req<JobDetailResponse>(`/api/jobs/${encodeURIComponent(jobId)}`),
    listWorkers: () => req<WorkerInfo[]>("/api/workers"),
    listScheduled: (offset?: number, limit?: number) => {
      const q = new URLSearchParams();
      if (offset != null) q.set("offset", String(offset));
      if (limit != null) q.set("limit", String(limit));
      const qs = q.toString();
      return req<PaginatedResponse<ScheduledJob>>(`/api/scheduled${qs ? `?${qs}` : ""}`);
    },
    listFailed: (offset?: number, limit?: number) => {
      const q = new URLSearchParams();
      if (offset != null) q.set("offset", String(offset));
      if (limit != null) q.set("limit", String(limit));
      const qs = q.toString();
      return req<PaginatedResponse<FailedJob>>(`/api/failed${qs ? `?${qs}` : ""}`);
    },
    getStats: () => req<StatsResponse>("/api/stats"),
    search: (params: {
      q?: string;
      status?: JobStatus;
      queue?: string;
      after?: string;
      before?: string;
      offset?: number;
      limit?: number;
    }) => {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v != null && v !== "") q.set(k === "q" ? "q" : k, String(v));
      }
      const qs = q.toString();
      return req<PaginatedResponse<JobSummary>>(`/api/search${qs ? `?${qs}` : ""}`);
    },
    getMetrics: (hours?: number) => {
      const q = hours != null ? `?hours=${hours}` : "";
      return req<MetricsResponse>(`/api/metrics${q}`);
    },
    listCron: () => req<CronJobInfo[]>("/api/cron"),
    retryJob: (jobId: string) =>
      req<ActionResponse>(`/api/jobs/${encodeURIComponent(jobId)}/retry`, {
        method: "POST",
      }),
    deleteJob: (jobId: string) =>
      req<ActionResponse>(`/api/jobs/${encodeURIComponent(jobId)}`, {
        method: "DELETE",
      }),
    enqueueScheduled: (jobId: string) =>
      req<ActionResponse>(`/api/scheduled/${encodeURIComponent(jobId)}/enqueue`, {
        method: "POST",
      }),
    bulkRetry: (body: BulkRequest) =>
      req<BulkResponse>("/api/bulk/retry", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      }),
    bulkDelete: (body: BulkRequest) =>
      req<BulkResponse>("/api/bulk/delete", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      }),
    bulkEnqueue: (body: BulkRequest) =>
      req<BulkResponse>("/api/bulk/enqueue", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      }),
    triggerCron: (functionName: string) =>
      req<ActionResponse>(
        `/api/cron/${encodeURIComponent(functionName)}/trigger`,
        { method: "POST" },
      ),
    listAudit: (params?: { offset?: number; limit?: number; action?: string; user?: string }) => {
      const q = new URLSearchParams();
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          if (v != null) q.set(k, String(v));
        }
      }
      const qs = q.toString();
      return req<PaginatedResponse<unknown>>(`/api/audit${qs ? `?${qs}` : ""}`);
    },
    listAlerts: () => req<{ alerts: unknown[] }>("/api/alerts"),
  };
}

export type WorqClient = ReturnType<typeof createWorqClient>;
