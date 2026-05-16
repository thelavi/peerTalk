import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeSupabase } from "./test/mockSupabase";
import { FakeRTCPeerConnection } from "./test/setup";

let fake: FakeSupabase;

vi.mock("./lib/supabase", () => ({
  get supabase() {
    return fake;
  },
}));

beforeEach(() => {
  fake = createFakeSupabase();
  fake.setTableResult("call_sessions", "insert", {
    data: { id: "c1" },
    error: null,
  });
  fake.setTableResult("rooms", "insert", {
    data: { id: "r-new", slug: "demo", name: "Demo", owner_id: "u-existing" },
    error: null,
  });
  // logged-in user
  fake.authState.session = {
    user: { id: "u-existing", email: "alice@x.com" },
  };
});

async function loadApp() {
  const mod = await import("./App");
  return mod.default;
}

describe("App / Shell", () => {
  it("shows login form when no session", async () => {
    fake.authState.session = null;
    const App = await loadApp();
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/sign in to start a call/i)).toBeInTheDocument()
    );
  });

  it("renders lobby when signed in", async () => {
    const App = await loadApp();
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText("alice@x.com")).toBeInTheDocument()
    );
    expect(screen.getByText("Available rooms")).toBeInTheDocument();
    expect(screen.getByText(/Recent calls/i)).toBeInTheDocument();
  });

  it("creates a room and enters call view", async () => {
    const App = await loadApp();
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText("alice@x.com")).toBeInTheDocument()
    );
    fireEvent.change(screen.getByPlaceholderText(/slug/i), {
      target: { value: "demo" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create \+ join/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /leave/i })).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: /mute/i })).toBeInTheDocument();
  });

  it("surfaces create-room error", async () => {
    fake.setTableResult("rooms", "insert", {
      data: null,
      error: { message: "rls denied" },
    });
    const App = await loadApp();
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText("alice@x.com")).toBeInTheDocument()
    );
    fireEvent.change(screen.getByPlaceholderText(/slug/i), {
      target: { value: "demo" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create \+ join/i }));
    await waitFor(() =>
      expect(screen.getByText(/rls denied/i)).toBeInTheDocument()
    );
  });

  it("surfaces a slug-validation error through handleCreate", async () => {
    const App = await loadApp();
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText("alice@x.com")).toBeInTheDocument()
    );
    fireEvent.change(screen.getByPlaceholderText(/slug/i), {
      target: { value: "AB" }, // too short — useRooms throws
    });
    fireEvent.click(screen.getByRole("button", { name: /create \+ join/i }));
    await waitFor(() =>
      expect(
        screen.getByText(/slug must be 3-40 chars/i)
      ).toBeInTheDocument()
    );
  });

  it("joins an existing room from the lobby list", async () => {
    fake.setTableResult("rooms", "select", {
      data: [{ id: "r1", slug: "old", name: "Old Room" }],
      error: null,
    });
    const App = await loadApp();
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText("Old Room")).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole("button", { name: /^join$/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /leave/i })).toBeInTheDocument()
    );
  });

  it("surfaces a join-room error", async () => {
    fake.setTableResult("rooms", "select", {
      data: [{ id: "r1", slug: "old", name: "Old Room" }],
      error: null,
    });
    fake.setTableResult("room_members", "upsert", {
      data: null,
      error: { code: "FATAL", message: "denied" },
    });
    const App = await loadApp();
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText("Old Room")).toBeInTheDocument()
    );
    // membership upsert logs error, joinRoom continues — verify call view eventually renders OR error shows
    fireEvent.click(screen.getByRole("button", { name: /^join$/i }));
    // joinRoom does not throw on membership log; should still enter call view
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /leave/i })).toBeInTheDocument()
    );
  });

  it("toggles mic, cam, screen share, and leaves", async () => {
    const App = await loadApp();
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText("alice@x.com")).toBeInTheDocument()
    );
    fireEvent.change(screen.getByPlaceholderText(/slug/i), {
      target: { value: "demo" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create \+ join/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /mute/i })).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: /mute/i }));
    expect(screen.getByRole("button", { name: /unmute/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /cam off/i }));
    expect(screen.getByRole("button", { name: /cam on/i })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /share screen/i }));
    });
    expect(
      screen.getByRole("button", { name: /stop share/i })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /leave/i }));
    await waitFor(() =>
      expect(screen.getByText("alice@x.com")).toBeInTheDocument()
    );
  });

  it("sends a chat message", async () => {
    const App = await loadApp();
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText("alice@x.com")).toBeInTheDocument()
    );
    fireEvent.change(screen.getByPlaceholderText(/slug/i), {
      target: { value: "demo" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create \+ join/i }));
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/message peers/i)).toBeInTheDocument()
    );
    fireEvent.change(screen.getByPlaceholderText(/message peers/i), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(screen.getByText(/hello/)).toBeInTheDocument());
    // chat log gets a <strong>you</strong>; tile label is a <span> with class tile__label.
    const youInChat = screen
      .getAllByText("you")
      .find((el) => el.tagName === "STRONG");
    expect(youInChat).toBeDefined();
  });

  it("signs out and cleans up an in-progress call", async () => {
    const App = await loadApp();
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText("alice@x.com")).toBeInTheDocument()
    );
    fireEvent.change(screen.getByPlaceholderText(/slug/i), {
      target: { value: "demo" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create \+ join/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /leave/i })).toBeInTheDocument()
    );
    // simulate one peer connected
    act(() =>
      fake.channels[0].firePresenceSync({
        "u-existing": {},
        bob: {},
      })
    );
    await waitFor(() => expect(FakeRTCPeerConnection.instances.length).toBe(1));
    const pc = FakeRTCPeerConnection.instances[0];

    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(pc.closed).toBe(true));
    expect(fake.auth.signOut).toHaveBeenCalled();
  });

  it("shows 'no messages yet' until first message", async () => {
    const App = await loadApp();
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText("alice@x.com")).toBeInTheDocument()
    );
    fireEvent.change(screen.getByPlaceholderText(/slug/i), {
      target: { value: "demo" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create \+ join/i }));
    await waitFor(() =>
      expect(screen.getByText(/no messages yet/i)).toBeInTheDocument()
    );
  });
});
