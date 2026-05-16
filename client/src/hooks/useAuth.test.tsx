import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeSupabase } from "../test/mockSupabase";
import { createFakeSupabase } from "../test/mockSupabase";

let fake: FakeSupabase;

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return fake;
  },
}));

beforeEach(() => {
  fake = createFakeSupabase();
});

describe("useAuth", () => {
  it("starts loading, then resolves session to null", async () => {
    const { useAuth } = await import("./useAuth");
    const { result } = renderHook(() => useAuth());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();
    expect(result.current.session).toBeNull();
  });

  it("hydrates session from getSession", async () => {
    fake.authState.session = { user: { id: "u1" } };
    const { useAuth } = await import("./useAuth");
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toEqual({ id: "u1" });
  });

  it("updates state on onAuthStateChange", async () => {
    const { useAuth } = await import("./useAuth");
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      fake.fireAuthChange("SIGNED_IN", { user: { id: "u2" } });
    });
    await waitFor(() => expect(result.current.user).toEqual({ id: "u2" }));
  });

  it("signUp passes email, password, username metadata", async () => {
    const { useAuth } = await import("./useAuth");
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.signUp("a@x.com", "secret123", "alice");
    });
    expect(fake.auth.signUp).toHaveBeenCalledWith({
      email: "a@x.com",
      password: "secret123",
      options: { data: { username: "alice", display_name: "alice" } },
    });
  });

  it("signUp throws when supabase returns error", async () => {
    fake.authState.signUpResult = {
      data: null,
      error: new Error("boom"),
    };
    const { useAuth } = await import("./useAuth");
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await expect(
      result.current.signUp("a@x.com", "pw", "u")
    ).rejects.toThrow("boom");
  });

  it("signIn passes email + password", async () => {
    const { useAuth } = await import("./useAuth");
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.signIn("a@x.com", "pw");
    });
    expect(fake.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "a@x.com",
      password: "pw",
    });
  });

  it("signIn throws when supabase returns error", async () => {
    fake.authState.signInResult = { data: null, error: new Error("nope") };
    const { useAuth } = await import("./useAuth");
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await expect(result.current.signIn("a", "b")).rejects.toThrow("nope");
  });

  it("signOut calls supabase signOut", async () => {
    const { useAuth } = await import("./useAuth");
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.signOut();
    });
    expect(fake.auth.signOut).toHaveBeenCalled();
  });

  it("signOut throws on error", async () => {
    fake.authState.signOutResult = { error: new Error("net") };
    const { useAuth } = await import("./useAuth");
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await expect(result.current.signOut()).rejects.toThrow("net");
  });

  it("unsubscribes listener on unmount", async () => {
    const { useAuth } = await import("./useAuth");
    const { unmount } = renderHook(() => useAuth());
    const sub = fake.auth.onAuthStateChange.mock.results[0]
      ?.value as { data: { subscription: { unsubscribe: ReturnType<typeof vi.fn> } } };
    unmount();
    expect(sub.data.subscription.unsubscribe).toHaveBeenCalled();
  });
});
