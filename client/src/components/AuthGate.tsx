import { useState, type ReactNode } from "react";
import { useAuth } from "../hooks/useAuth";
import { LoginForm } from "./LoginForm";
import { SignupForm } from "./SignupForm";

export const AuthGate: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");

  if (loading) {
    return (
      <div className="app auth">
        <p className="muted">loading…</p>
      </div>
    );
  }

  if (user) return <>{children}</>;

  return (
    <div className="app auth">
      <div className="auth__card">
        <h1>peerTalk</h1>
        <p className="muted">
          {mode === "login" ? "Sign in to start a call" : "Create an account"}
        </p>
        {mode === "login" ? <LoginForm /> : <SignupForm />}
        <button
          className="link"
          type="button"
          onClick={() => setMode(mode === "login" ? "signup" : "login")}
        >
          {mode === "login"
            ? "Don't have an account? Sign up"
            : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
};
