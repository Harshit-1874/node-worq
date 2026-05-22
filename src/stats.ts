import type { QueueAdapter } from "./adapter.js";

export const STATS_PUSH_MS = 2000;

export async function pushStatsJson(adapter: QueueAdapter): Promise<string> {
  const stats = await adapter.getStats();
  return JSON.stringify(stats);
}
