import { useState } from "react";
import { useAuth } from "../lib/auth-context";
import { ApiError } from "../lib/api";

export function LoginPage() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignup = auth.setupRequired;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isSignup) {
        // Client-side validation
        if (password.length < 8) {
          setError("Password must be at least 8 characters");
          setLoading(false);
          return;
        }
        if (password !== confirmPassword) {
          setError("Passwords do not match");
          setLoading(false);
          return;
        }
        await auth.signup(email, password);
      } else {
        await auth.login(email, password);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unexpected error occurred");
      }
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-app px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-lg font-bold text-2xl text-white"
              style={{
                background: "var(--accent-blue-gradient)",
              }}
            >
              C
            </div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Cap5
          </h1>
          <p className="mt-2 text-sm text-secondary">
            {isSignup ? "Create your account" : "Sign in to your account"}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border border-border-default bg-surface p-6 shadow-soft"
        >
          {error && (
            <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1.5">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              disabled={loading}
              className="input-control w-full px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1.5">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              disabled={loading}
              className="input-control w-full px-3 py-2 text-sm"
            />
            {isSignup && (
              <p className="mt-1.5 text-xs text-secondary">
                Minimum 8 characters
                {password.length > 0 && password.length < 8 && (
                  <span className="ml-2 text-red-400">({password.length}/8)</span>
                )}
              </p>
            )}
          </div>

          {isSignup && (
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground mb-1.5">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
                disabled={loading}
                className="input-control w-full px-3 py-2 text-sm"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full py-2.5 text-sm font-medium"
          >
            {loading ? (
              <>
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                {isSignup ? "Creating account..." : "Signing in..."}
              </>
            ) : (
              isSignup ? "Create Account" : "Sign In"
            )}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-muted">
          {isSignup
            ? "Already have an account? Sign in instead."
            : "First time? Your account will be created automatically."}
        </p>
      </div>
    </div>
  );
}
