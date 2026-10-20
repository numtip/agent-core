import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CostLedger } from "./cost-guard.js";

export class InferenceLedgerCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InferenceLedgerCorruptError";
  }
}

export class InferenceLedgerRolloverError extends Error {
  constructor(
    message: string,
    public readonly previousMonth: string,
    public readonly archivedPath: string
  ) {
    super(message);
    this.name = "InferenceLedgerRolloverError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseCostLedger(raw: unknown, expectedMonth: string): CostLedger {
  if (!isRecord(raw)) {
    throw new InferenceLedgerCorruptError("Ledger file is not a JSON object");
  }
  const month = raw.month;
  if (typeof month !== "string" || month !== expectedMonth) {
    throw new InferenceLedgerCorruptError("Ledger month mismatch or missing");
  }
  const spent = finiteNumber(raw.spent_usd);
  const reserved = finiteNumber(raw.reserved_usd);
  const requests = finiteNumber(raw.requests);
  const tokens = raw.tokens;
  if (spent === null || reserved === null || requests === null || !isRecord(tokens)) {
    throw new InferenceLedgerCorruptError("Ledger numeric fields are invalid");
  }
  const prompt = finiteNumber(tokens.prompt);
  const completion = finiteNumber(tokens.completion);
  const total = finiteNumber(tokens.total);
  if (prompt === null || completion === null || total === null) {
    throw new InferenceLedgerCorruptError("Ledger token fields are invalid");
  }
  if (spent < 0 || reserved < 0 || requests < 0 || prompt < 0 || completion < 0 || total < 0) {
    throw new InferenceLedgerCorruptError("Ledger contains negative values");
  }
  return {
    month,
    spent_usd: spent,
    reserved_usd: reserved,
    requests,
    tokens: { prompt, completion, total }
  };
}

export function emptyCostLedger(month: string): CostLedger {
  return {
    month,
    spent_usd: 0,
    reserved_usd: 0,
    requests: 0,
    tokens: { prompt: 0, completion: 0, total: 0 }
  };
}

export async function atomicWriteLedger(path: string, ledger: CostLedger): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  const body = JSON.stringify(ledger, null, 2) + "\n";
  await writeFile(tmp, body, "utf8");
  await rename(tmp, path);
}

export async function archiveLedgerFile(path: string, month: string): Promise<string> {
  const archivePath = `${path}.archive.${month}.json`;
  await rename(path, archivePath);
  return archivePath;
}

type ReadLedgerOptions = {
  expectedMonth: string;
  /** When true, missing file yields a fresh ledger (first init only). */
  allowInitialize: boolean;
};

export async function readLedgerFile(
  path: string,
  options: ReadLedgerOptions
): Promise<{ ledger: CostLedger; initialized: boolean; archivedPath?: string }> {
  const { expectedMonth, allowInitialize } = options;
  let rawText: string;
  try {
    rawText = await readFile(path, "utf8");
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code)
        : "";
    if (code === "ENOENT") {
      if (!allowInitialize) {
        throw new InferenceLedgerCorruptError("Ledger file is missing");
      }
      return { ledger: emptyCostLedger(expectedMonth), initialized: true };
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new InferenceLedgerCorruptError("Ledger file contains invalid JSON");
  }

  if (!isRecord(parsed) || typeof parsed.month !== "string") {
    throw new InferenceLedgerCorruptError("Ledger file is missing month metadata");
  }

  if (parsed.month !== expectedMonth) {
    const archivedPath = await archiveLedgerFile(path, parsed.month);
    const fresh = emptyCostLedger(expectedMonth);
    await atomicWriteLedger(path, fresh);
    return {
      ledger: fresh,
      initialized: true,
      archivedPath
    };
  }

  return {
    ledger: parseCostLedger(parsed, expectedMonth),
    initialized: false
  };
}

export async function ledgerFileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function removeFileIfExists(path: string): Promise<void> {
  await unlink(path).catch(() => undefined);
}
