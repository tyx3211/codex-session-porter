export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJsonRecord(text: string): JsonRecord | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  return isRecord(parsed) ? parsed : null;
}

export function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function finiteNumberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function nullableFiniteNumberValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return finiteNumberValue(value);
}
