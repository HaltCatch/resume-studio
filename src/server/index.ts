import path from "node:path";
import { buildApp } from "./app.ts";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";
const storageDir = path.resolve(process.env.RESUME_DATA_DIR ?? path.join(process.cwd(), "data", "resumes"));
const staticDir = path.resolve(process.env.STATIC_DIR ?? path.join(process.cwd(), "dist"));
const versionInterval = Number(process.env.RESUME_VERSION_INTERVAL_MS ?? "");
const app = await buildApp({
  storageDir,
  staticDir,
  logger: true,
  versionIntervalMs: Number.isFinite(versionInterval) && versionInterval >= 0 ? versionInterval : undefined,
});

await app.listen({ port, host });
