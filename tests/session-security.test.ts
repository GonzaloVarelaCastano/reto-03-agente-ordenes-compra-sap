import { describe, expect, it } from "vitest";
import { SessionStore } from "../src/agent/sessions.js";
import { createServer } from "../src/server.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("seguridad de sesiones", () => {
  it("expira sesiones y limita su cantidad", async () => {
    const directory = await mkdtemp(join(tmpdir(), "reto-session-"));
    const store = new SessionStore(directory, 1, 1);
    store.get("one"); await new Promise((resolve) => setTimeout(resolve, 5));
    expect(store.find("one")).toBeNull();
    store.get("two"); store.get("three");
    expect(store.find("two")).toBeNull();
    expect(store.find("three")?.id).toBe("three");
    await rm(directory, { recursive: true, force: true });
  });

  it("rechaza Gemini en producción sin token de aplicación", () => {
    const previous = { node: process.env.NODE_ENV, key: process.env.GEMINI_API_KEY, token: process.env.APP_ACCESS_TOKEN };
    process.env.NODE_ENV = "production"; process.env.GEMINI_API_KEY = "configured"; delete process.env.APP_ACCESS_TOKEN;
    expect(() => createServer(process.cwd())).toThrow("APP_ACCESS_TOKEN");
    process.env.NODE_ENV = previous.node; process.env.GEMINI_API_KEY = previous.key; process.env.APP_ACCESS_TOKEN = previous.token;
  });
});
