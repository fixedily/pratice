/** 检修域 access token；refresh token 仅由后端 HttpOnly Cookie 保存。 */
const KEY = "maintenance_system_token";
const REMEMBER_KEY = "maintenance_system_remember";
export const MAINTENANCE_AUTH_EXPIRED_EVENT = "maintenance-auth-expired";
export const MAINTENANCE_AUTH_CHANGED_EVENT = "maintenance-auth-changed";

function notifyMaintenanceAuthChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MAINTENANCE_AUTH_CHANGED_EVENT));
}

export function getMaintenanceToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(KEY) || sessionStorage.getItem(KEY);
}

export function getMaintenanceRememberPreference(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(REMEMBER_KEY) === "1";
}

export function setMaintenanceRememberPreference(remember: boolean): void {
  if (typeof window === "undefined") return;
  if (remember) {
    localStorage.setItem(REMEMBER_KEY, "1");
  } else {
    localStorage.removeItem(REMEMBER_KEY);
  }
}

export function setMaintenanceToken(token: string, remember = getMaintenanceRememberPreference()): void {
  if (typeof window === "undefined") return;
  setMaintenanceRememberPreference(remember);
  if (remember) {
    localStorage.setItem(KEY, token);
    sessionStorage.removeItem(KEY);
  } else {
    sessionStorage.setItem(KEY, token);
    localStorage.removeItem(KEY);
  }
  notifyMaintenanceAuthChanged();
}

export function clearMaintenanceToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
  sessionStorage.removeItem(KEY);
  localStorage.removeItem(REMEMBER_KEY);
  notifyMaintenanceAuthChanged();
}

export function notifyMaintenanceAuthExpired(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MAINTENANCE_AUTH_EXPIRED_EVENT));
}
