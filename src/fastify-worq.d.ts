import "fastify";
import type { QueueAdapter } from "./adapter.js";

declare module "fastify" {
  interface FastifyInstance {
    worq: {
      adapter: QueueAdapter;
      title: string;
      allowWrite: boolean;
      basePath: string;
    };
  }
}
