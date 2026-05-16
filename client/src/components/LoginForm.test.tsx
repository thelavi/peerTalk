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

describe("LoginForm", () => {
  it("submits credentials to supabase", async () => {
    const { LoginForm } = await import("./LoginForm");
    render(<LoginForm />);
    fireEvent.change(screen.getByPlaceholderText("email"), {
      target: { value: "a@x.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("password"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() =>
      expect(fake.auth.signInWithPassword).toHaveBeenCalledWith({
        email: "a@x.com",
        password: "secret",
      })
    );
  });

  it("shows the error message from supabase on failure", async () => {
    fake.authState.signInResult = { data: null, error: new Error("bad creds") };
    const { LoginForm } = await import("./LoginForm");
    render(<LoginForm />);
    fireEvent.change(screen.getByPlaceholderText("email"), {
      target: { value: "x@x.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("password"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByText(/bad creds/i)).toBeInTheDocument();
  });

  it("shows generic error when thrown value is not an Error", async () => {
    fake.auth.signInWithPassword.mockImplementationOnce(() => {
      throw "string-thrown";
    });
    const { LoginForm } = await import("./LoginForm");
    render(<LoginForm />);
    fireEvent.change(screen.getByPlaceholderText("email"), {
      target: { value: "x@x.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("password"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByText(/login failed/i)).toBeInTheDocument();
  });
});
