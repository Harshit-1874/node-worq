import type { QueueAdapter } from "./adapter.js";

export interface WorqDashboardOptions {
  adapter: QueueAdapter;
  title?: string;
  allowWrite?: boolean;
  /** URL prefix for links and meta (e.g. `/worq`). Match your mount path. */
  basePath?: string;
}
