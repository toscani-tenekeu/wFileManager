import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { wfilemanagerApi, type AuthUser, type SetupPayload } from "./wfilemanager-api";
import { setupWFileManager } from "./setup-api";

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  configured: boolean | null;
  refresh: () => Promise<void>;
  login: (login: string, password: string, remember: boolean) => Promise<void>;
  setup: (payload: SetupPayload) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function enrichUser(user: AuthUser) {
  try {
    const access = await wfilemanagerApi.rolePermissions();
    return { ...user, roleId: access.roleId ?? user.roleId, roleName: access.roleName, permissions: access.permissions };
  } catch {
    return { ...user, permissions: user.isAdmin ? [
      "browse", "view", "preview", "read", "create_files", "create_directories", "edit", "rename",
      "copy", "move", "upload", "download", "compress", "extract", "delete", "restore",
      "permanently_delete", "change_permissions", "change_owner", "change_group", "create_symlinks",
      "calculate_checksums", "use_terminal", "manage_users", "manage_roles",
    ] : user.permissions || [] };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const status = await wfilemanagerApi.status();
      setConfigured(status.configured);
      if (status.configured && wfilemanagerApi.getToken()) {
        const me = await wfilemanagerApi.me();
        setUser(await enrichUser(me.user));
      } else {
        setUser(null);
      }
    } catch {
      wfilemanagerApi.clearToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    configured,
    refresh,
    async login(login, password, remember) {
      const result = await wfilemanagerApi.login(login, password, remember);
      wfilemanagerApi.setToken(result.token);
      setUser(await enrichUser(result.user));
      setConfigured(true);
    },
    async setup(payload) {
      await setupWFileManager(payload);
      const result = await wfilemanagerApi.login(payload.username, payload.password, true);
      wfilemanagerApi.setToken(result.token);
      setUser(await enrichUser(result.user));
      setConfigured(true);
    },
    async logout() {
      try { await wfilemanagerApi.logout(); } catch { /* local logout still applies */ }
      wfilemanagerApi.clearToken();
      setUser(null);
    },
  }), [user, loading, configured, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
