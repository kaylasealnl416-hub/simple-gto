export function backupKeyFor(key, timestamp = Date.now()) {
  return `${key}.corrupt.${timestamp}`;
}

export function isValidSessionSnapshot(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      Array.isArray(value.seats) &&
      value.seats.length === 8 &&
      Number.isFinite(value.handNumber) &&
      typeof value.phase === "string"
  );
}

export function readJsonStorage(storage, key, options = {}) {
  const { fallback = null, validate = () => true, backupCorrupt = true } = options;
  let raw = null;
  try {
    raw = storage.getItem(key);
    if (!raw) {
      return { value: fallback, status: "empty" };
    }
    const parsed = JSON.parse(raw);
    if (!validate(parsed)) {
      throw new Error("invalid-storage-shape");
    }
    return { value: parsed, status: "ok" };
  } catch (error) {
    if (backupCorrupt && raw) {
      try {
        storage.setItem(backupKeyFor(key), raw);
      } catch {
        // If backup fails, still clear the broken key so the app can boot.
      }
    }
    try {
      storage.removeItem(key);
    } catch {
      // Ignore storage removal failures; the caller will continue with fallback.
    }
    return { value: fallback, status: "recovered", error: error?.message ?? "storage-error" };
  }
}

export function writeJsonStorage(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message ?? "storage-write-error" };
  }
}
