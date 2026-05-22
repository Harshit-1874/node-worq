import type { QueueAdapter } from "./adapter.js";
import type { WorqDashboardOptions } from "./options.js";
import { WriteGuard } from "./writeGuard.js";

export interface WorqState {
  adapter: QueueAdapter;
  title: string;
  allowWrite: boolean;
  basePath: string;
}

export function createWorqState(opts: WorqDashboardOptions): WorqState {
  const allowWrite = opts.allowWrite ?? false;
  return {
    adapter: new WriteGuard(opts.adapter, allowWrite),
    title: opts.title ?? "Worq",
    allowWrite,
    basePath: (opts.basePath ?? "").replace(/\/$/, "") || "",
  };
}
