export type Rec = Record<string, unknown>;

export function asRecord(value: unknown): Rec | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Rec) : undefined;
}
