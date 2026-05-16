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

function fill(email = "a@x.com", username = "alice", password = "secret1") {
  fireEvent.change(screen.getByPlaceholderText("email"), {
    target: { value: email },
  });
  fireEvent.change(screen.getByPlaceholderText("username"), {
    target: { value: username },
  });
  fireEvent.change(screen.getByPlaceholderText("password (min 6)"), {
    target: { value: password },
  });
}

describe("SignupForm", () => {
  it("rejects invalid username format", async () => {
    const { SignupForm } = await import("./SignupForm");
    render(<SignupForm />);
    fill("a@x.com", "ab", "secret1"); // too short
    fireEvent.click(screen.getByRole("button", { name: /sign up/i }));
    expect(await screen.findByText(/3-32 chars/i)).toBeInTheDocument();
  });

  it("rejects short password", async () => {
    const { SignupForm } = await import("./SignupForm");
    render(<SignupForm />);
    fill("a@x.com", "alice", "abc");
    fireEvent.click(screen.getByRole("button", { name: /sign up/i }));
    expect(await screen.findByText(/min 6/i)).toBeInTheDocument();
  });

  it("submits valid signup to supabase with lowercased username", async () => {
    const { SignupForm } = await import("./SignupForm");
    render(<SignupForm />);
    fill("a@x.com", "Alice", "secret1");
    fireEvent.click(screen.getByRole("button", { name: /sign up/i }));
    await waitFor(() =>
      expect(fake.auth.signUp).toHaveBeenCalledWith({
        email: "a@x.com",
        password: "secret1",
        options: { data: { username: "alice", display_name: "alice" } },
      })
    );
  });

  it("maps already-registered errors to friendly text", async () => {
    fake.authState.signUpResult = {
      data: null,
      error: new Error("User already registered"),
    };
    const { SignupForm } = await import("./SignupForm");
    render(<SignupForm />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /sign up/i }));
    expect(await screen.findByText(/try signing in/i)).toBeInTheDocument();
  });

  it("maps username unique-violation to friendly text", async () => {
    fake.authState.signUpResult = {
      data: null,
      error: new Error("duplicate key value violates unique constraint profiles_username_key"),
    };
    const { SignupForm } = await import("./SignupForm");
    render(<SignupForm />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /sign up/i }));
    expect(await screen.findByText(/username already taken/i)).toBeInTheDocument();
  });

  it("shows raw message for unknown errors", async () => {
    fake.authState.signUpResult = {
      data: null,
      error: new Error("some weird db failure"),
    };
    const { SignupForm } = await import("./SignupForm");
    render(<SignupForm />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /sign up/i }));
    expect(await screen.findByText(/weird db failure/i)).toBeInTheDocument();
  });

  it("shows generic message when thrown value is not an Error", async () => {
    fake.auth.signUp.mockImplementationOnce(() => {
      throw "boom";
    });
    const { SignupForm } = await import("./SignupForm");
    render(<SignupForm />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /sign up/i }));
    expect(await screen.findByText(/signup failed/i)).toBeInTheDocument();
  });
});
