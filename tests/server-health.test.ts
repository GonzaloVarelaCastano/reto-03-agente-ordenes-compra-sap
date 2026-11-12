import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const servers: Array<{ close: (callback: () => void) => void }> = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(resolve)))); delete process.env.APP_ACCESS_TOKEN; });

describe("health check y token", () => {
  it("expone healthz sin token y protege casos", async () => {
    const directory = await mkdtemp(join(tmpdir(), "reto-health-")); await cp(join(fileURLToPath(new URL("..", import.meta.url)), "fixtures"), join(directory, "fixtures"), { recursive: true }); process.env.APP_ACCESS_TOKEN = "token-test";
    const server = createServer(directory).listen(0, "127.0.0.1"); servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve)); const address = server.address(); const port = typeof address === "object" && address !== null ? address.port : 0;
    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/api/casos`)).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${port}/api/casos`, { headers: { "x-app-token": "token-test" } })).status).toBe(200);
    await rm(directory, { recursive: true, force: true });
  });
});
