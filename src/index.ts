export { default as worqDashboard } from "./dashboard.js";
export { default as createDashboard } from "./dashboard.js";
export type { WorqDashboardOptions } from "./dashboard.js";

export { createWorqClient } from "./client.js";
export type { WorqClient, WorqClientOptions } from "./client.js";

export { BullMQAdapter } from "./adapters/bullmq.js";
export type { BullMQAdapterOptions } from "./adapters/bullmq.js";

export type { QueueAdapter, QueueAdapterExtras } from "./adapter.js";
export { WriteGuard } from "./writeGuard.js";

export * from "./types.js";
export * from "./exceptions.js";

export const version = "0.1.0";
