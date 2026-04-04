import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { getAuthMe, getAuthStatus, authLogin as apiLogin, authLogout as apiLogout, authSetup as apiSetup } from "./api";

type User = { userId: string; email: string };

type AuthContextValue = {
  checked: boolean;
  authenticated: boolean;
  setupRequired: boolean;
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [checked, setChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const me = await getAuthMe();
        setUser({ userId: me.userId, email: me.email });
        setAuthenticated(true);
      } catch (err) {
        // Not authenticated — check if setup is needed
        try {
          const status = await getAuthStatus();
          setSetupRequired(status.setupRequired);
        } catch (statusErr) {
          // Can't reach server, log for debugging
          console.warn('Failed to check auth status:', statusErr);
        }
        setAuthenticated(false);
      } finally {
        // Always mark as checked, even if there was an error
        setChecked(true);
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    await apiLogin(email, password);
    const me = await getAuthMe();
    setUser({ userId: me.userId, email: me.email });
    setAuthenticated(true);
    setSetupRequired(false);
  }, []);

  const signup = useCallback(async (email: string, password: string) => {
    await apiSetup(email, password);
    await apiLogin(email, password);
    const me = await getAuthMe();
    setUser({ userId: me.userId, email: me.email });
    setAuthenticated(true);
    setSetupRequired(false);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } catch (err) {
      // Log the error but proceed with local logout anyway
      console.warn('Logout API call failed:', err);
    } finally {
      // Always clear local state regardless of API success
      setUser(null);
      setAuthenticated(false);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ checked, authenticated, setupRequired, user, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
