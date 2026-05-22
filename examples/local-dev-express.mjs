/**
 * Local smoke test — Express mount.
 * Open http://127.0.0.1:3334/worq
 */
import http from "node:http";
import express from "express";
import { createWorqRouter, BullMQAdapter } from "../dist/index.js";

const PORT = Number(process.env.PORT) || 3334;

const REDIS = process.env.REDIS_URL
  ? process.env.REDIS_URL
  : {
      host: process.env.REDIS_HOST ?? "127.0.0.1",
      port: Number(process.env.REDIS_PORT) || 6379,
      ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
    };

const adapter = new BullMQAdapter({
  connection: REDIS,
  queueNames: (process.env.QUEUES ?? "demo").split(",").map((s) => s.trim()).filter(Boolean),
});

const { router, attachWebSocket } = createWorqRouter({
  adapter,
  title: "Worq (Express)",
  allowWrite: true,
  basePath: "/worq",
});

const app = express();
app.get("/", (_req, res) => res.redirect("/worq/"));
app.use("/worq", router);

const server = http.createServer(app);
attachWebSocket(server);

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Dashboard: http://127.0.0.1:${PORT}/worq`);
});
