// localStorage can be missing or throw (private mode, blocked storage), so every
// access is guarded and falls back to the default. Values are per-browser only.
export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // non-fatal: the value just won't persist
  }
}
