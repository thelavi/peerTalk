import { useState } from "react";
import { useAuth } from "../hooks/useAuth";

export const SignupForm: React.FC = () => {
  const { signUp } = useAuth();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^[a-z0-9_]{3,32}$/i.test(username)) {
      setError("username: 3-32 chars, letters/digits/underscore only");
      return;
    }
    if (password.length < 6) {
      setError("password: min 6 chars");
      return;
    }
    setBusy(true);
    try {
      await signUp(email, password, username.toLowerCase());
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Signup failed";
      // Surface known conflicts in plain language. The trigger inserts a
      // profiles row inside the same transaction as auth.users; a username
      // collision bubbles up as Postgres code 23505 (unique_violation).
      let friendly = raw;
      if (/already registered|already exists/i.test(raw)) {
        friendly = "Email already registered — try signing in.";
      } else if (/23505|profiles_username_key/.test(raw)) {
        friendly = "Username already taken — pick another.";
      }
      setError(friendly);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="auth__form" onSubmit={submit}>
      <input
        type="email"
        placeholder="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        autoComplete="email"
      />
      <input
        type="text"
        placeholder="username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        required
        minLength={3}
        maxLength={32}
        autoComplete="username"
      />
      <input
        type="password"
        placeholder="password (min 6)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        minLength={6}
        autoComplete="new-password"
      />
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? "…" : "Sign up"}
      </button>
    </form>
  );
};
