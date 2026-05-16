import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("AuthGate", () => {
  it("shows loading then login form when no user", async () => {
    const { AuthGate } = await import("./AuthGate");
    render(
      <AuthGate>
        <div>protected</div>
      </AuthGate>
    );
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText(/Sign in to start a call/i)).toBeInTheDocument()
    );
    expect(screen.queryByText("protected")).not.toBeInTheDocument();
  });

  it("toggles to signup view", async () => {
    const { AuthGate } = await import("./AuthGate");
    render(
      <AuthGate>
        <div>protected</div>
      </AuthGate>
    );
    await waitFor(() =>
      expect(screen.getByText(/sign in to start a call/i)).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole("button", { name: /sign up/i }));
    expect(screen.getByText(/create an account/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(screen.getByText(/sign in to start a call/i)).toBeInTheDocument();
  });

  it("renders children when session present", async () => {
    fake.authState.session = { user: { id: "u1", email: "a@x.com" } };
    const { AuthGate } = await import("./AuthGate");
    render(
      <AuthGate>
        <div>protected</div>
      </AuthGate>
    );
    await waitFor(() =>
      expect(screen.getByText("protected")).toBeInTheDocument()
    );
  });
});
