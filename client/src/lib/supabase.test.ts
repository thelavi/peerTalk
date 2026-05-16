import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("lib/supabase", () => {
  it("throws when VITE_SUPABASE_URL missing", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "x");
    await expect(import("./supabase")).rejects.toThrow(/Missing/);
  });

  it("throws when VITE_SUPABASE_ANON_KEY missing", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    await expect(import("./supabase")).rejects.toThrow(/Missing/);
  });

  it("exports a client when env vars are set", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
    const mod = await import("./supabase");
    expect(mod.supabase).toBeDefined();
    expect(typeof mod.supabase.from).toBe("function");
  });
});
