import { open, stat, unlink } from "node:fs/promises";
import { sleep } from "../providers/openai-chat.js";

export class LedgerLockTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerLockTimeoutError";
  }
}

const DEFAULT_STALE_LOCK_MS = 120_000;

async function reclaimStaleLock(lockPath: string, staleMs: number): Promise<boolean> {
  try {
    const info = await stat(lockPath);
    if (Date.now() - info.mtimeMs > staleMs) {
      await unlink(lockPath).catch(() => undefined);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** Cross-process exclusive lock via O_EXCL create (DEV pilot; stale lock reclaim). */
export async function acquireLedgerFileLock(
  ledgerPath: string,
  timeoutMs: number,
  staleLockMs = DEFAULT_STALE_LOCK_MS
): Promise<() => Promise<void>> {
  const lockPath = `${ledgerPath}.lock`;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.close();
      return async () => {
        await unlink(lockPath).catch(() => undefined);
      };
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: string }).code)
          : "";
      if (code !== "EEXIST") throw error;
      await reclaimStaleLock(lockPath, staleLockMs);
      await sleep(25);
    }
  }

  throw new LedgerLockTimeoutError("Timed out waiting for inference cost ledger lock");
}

export async function withLedgerFileLock<T>(
  ledgerPath: string | null,
  timeoutMs: number,
  fn: () => Promise<T>,
  staleLockMs = DEFAULT_STALE_LOCK_MS
): Promise<T> {
  if (!ledgerPath) return fn();
  const release = await acquireLedgerFileLock(ledgerPath, timeoutMs, staleLockMs);
  try {
    return await fn();
  } finally {
    await release();
  }
}
