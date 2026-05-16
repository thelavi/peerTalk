import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeSupabase } from "../test/mockSupabase";

let fake: FakeSupabase;

vi.mock("../lib/supabase", () => ({
  get supabase() {
    return fake;
  },
}));

beforeEach(() => {
  fake = createFakeSupabase();
});

describe("useRooms", () => {
  it("does nothing when userId is null", async () => {
    const { useRooms } = await import("./useRooms");
    const { result } = renderHook(() => useRooms(null));
    expect(result.current.rooms).toEqual([]);
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("loads rooms via select on mount", async () => {
    fake.setTableResult("rooms", "select", {
      data: [{ id: "r1", slug: "demo", name: "Demo" }],
      error: null,
    });
    const { useRooms } = await import("./useRooms");
    const { result } = renderHook(() => useRooms("u1"));
    await waitFor(() => expect(result.current.rooms.length).toBe(1));
    expect(result.current.rooms[0].slug).toBe("demo");
  });

  it("rejects invalid slug", async () => {
    const { useRooms } = await import("./useRooms");
    const { result } = renderHook(() => useRooms("u1"));
    await expect(result.current.createRoom("AB", "name")).rejects.toThrow(
      /slug/
    );
    await expect(
      result.current.createRoom("Invalid Slug!", "name")
    ).rejects.toThrow(/slug/);
  });

  it("rejects createRoom when not authenticated", async () => {
    const { useRooms } = await import("./useRooms");
    const { result } = renderHook(() => useRooms(null));
    await expect(result.current.createRoom("valid-slug", "n")).rejects.toThrow(
      /authenticated/
    );
  });

  it("createRoom inserts and returns room", async () => {
    fake.setTableResult("rooms", "insert", {
      data: { id: "r2", slug: "demo2", name: "Demo2", owner_id: "u1" },
      error: null,
    });
    const { useRooms } = await import("./useRooms");
    const { result } = renderHook(() => useRooms("u1"));
    let created: unknown;
    await act(async () => {
      created = await result.current.createRoom("demo2", "Demo2");
    });
    expect((created as { slug: string }).slug).toBe("demo2");
  });

  it("createRoom propagates DB error", async () => {
    fake.setTableResult("rooms", "insert", {
      data: null,
      error: { message: "boom" },
    });
    const { useRooms } = await import("./useRooms");
    const { result } = renderHook(() => useRooms("u1"));
    await expect(result.current.createRoom("good-slug", "")).rejects.toBeDefined();
  });

  it("joinRoomMembership throws if not authed", async () => {
    const { useRooms } = await import("./useRooms");
    const { result } = renderHook(() => useRooms(null));
    await expect(result.current.joinRoomMembership("r1")).rejects.toThrow(
      /authenticated/
    );
  });

  it("joinRoomMembership upserts membership", async () => {
    const { useRooms } = await import("./useRooms");
    const { result } = renderHook(() => useRooms("u1"));
    await act(async () => {
      await result.current.joinRoomMembership("r1");
    });
    expect(fake.from).toHaveBeenCalledWith("room_members");
  });

  it("joinRoomMembership ignores duplicate (23505)", async () => {
    fake.setTableResult("room_members", "upsert", {
      data: null,
      error: { code: "23505", message: "duplicate" },
    });
    const { useRooms } = await import("./useRooms");
    const { result } = renderHook(() => useRooms("u1"));
    await act(async () => {
      await result.current.joinRoomMembership("r1");
    });
    // no throw
  });

  it("joinRoomMembership logs other errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    fake.setTableResult("room_members", "upsert", {
      data: null,
      error: { code: "other", message: "bad" },
    });
    const { useRooms } = await import("./useRooms");
    const { result } = renderHook(() => useRooms("u1"));
    await act(async () => {
      await result.current.joinRoomMembership("r1");
    });
    expect(spy).toHaveBeenCalled();
  });

  it("refresh logs on select error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    fake.setTableResult("rooms", "select", {
      data: null,
      error: { message: "rls denied" },
    });
    const { useRooms } = await import("./useRooms");
    renderHook(() => useRooms("u1"));
    await waitFor(() => expect(spy).toHaveBeenCalled());
  });
});
