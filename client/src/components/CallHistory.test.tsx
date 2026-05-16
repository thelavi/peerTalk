import { render, screen, waitFor } from "@testing-library/react";
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

describe("CallHistory", () => {
  it("shows loading then empty state", async () => {
    fake.setTableResult("call_participants", "select", { data: [], error: null });
    const { CallHistory } = await import("./CallHistory");
    render(<CallHistory userId="u1" />);
    expect(screen.getByText(/loading history/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText(/no calls yet/i)).toBeInTheDocument()
    );
  });

  it("renders rows with formatted duration", async () => {
    fake.setTableResult("call_participants", "select", {
      data: [
        {
          call_id: "c1",
          joined_at: "2026-05-15T10:00:00Z",
          left_at: "2026-05-15T10:01:30Z",
          duration_seconds: 90,
          call_sessions: {
            id: "c1",
            started_at: "2026-05-15T10:00:00Z",
            ended_at: "2026-05-15T10:01:30Z",
            room_id: "r1",
            rooms: { slug: "demo", name: "Demo Room" },
          },
        },
        {
          call_id: "c2",
          joined_at: "2026-05-15T11:00:00Z",
          left_at: null,
          duration_seconds: null,
          call_sessions: {
            id: "c2",
            started_at: "2026-05-15T11:00:00Z",
            ended_at: null,
            room_id: "r2",
            rooms: null,
          },
        },
      ],
      error: null,
    });
    const { CallHistory } = await import("./CallHistory");
    render(<CallHistory userId="u1" />);
    await waitFor(() =>
      expect(screen.getByText("Demo Room")).toBeInTheDocument()
    );
    expect(screen.getByText(/1m 30s/)).toBeInTheDocument();
    expect(screen.getByText(/deleted room/)).toBeInTheDocument();
  });

  it("logs error from supabase", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    fake.setTableResult("call_participants", "select", {
      data: null,
      error: { message: "rls" },
    });
    const { CallHistory } = await import("./CallHistory");
    render(<CallHistory userId="u1" />);
    await waitFor(() => expect(spy).toHaveBeenCalled());
  });
});
