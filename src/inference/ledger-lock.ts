import { open, unlink } from "node:fs/promises";
import { sleep } from "../providers/openai-chat.js";

export class LedgerLockTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerLockTimeoutError";
  }
}

/** Cross-process exclusive lock via O_EXCL create (best-effort; DEV pilot). */
export async function acquireLedgerFileLock(
  ledgerPath: string,
  timeoutMs: number
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
      await sleep(25);
    }
  }

  throw new LedgerLockTimeoutError("Timed out waiting for inference cost ledger lock");
}

export async function withLedgerFileLock<T>(
  ledgerPath: string | null,
  timeoutMs: number,
  fn: () => Promise<T>
): Promise<T> {
  if (!ledgerPath) return fn();
  const release = await acquireLedgerFileLock(ledgerPath, timeoutMs);
  try {
    return await fn();
  } finally {
    await release();
  }
}
