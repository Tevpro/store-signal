export const invalid = (message: string): never => {
  throw new Error(`Invalid /v1 contract: ${message}`);
};
export function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return invalid("expected object");
  return input as Record<string, unknown>;
}
export function text(value: unknown, name: string, max = 256): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > max ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    return invalid(name);
  return value;
}
export function optionalText(value: unknown, name: string, max = 256): void {
  if (value !== undefined) text(value, name, max);
}
export function list(value: unknown, name: string, max = 50): string[] {
  if (!Array.isArray(value) || value.length > max) return invalid(name);
  const result: string[] = value.map((entry: unknown) => text(entry, name));
  if (new Set(result).size !== result.length)
    return invalid(`duplicate ${name}`);
  return result;
}
export function enumValue<T extends string>(
  value: unknown,
  values: readonly T[],
  name: string,
): T {
  if (typeof value !== "string" || !values.includes(value as T))
    return invalid(name);
  return value as T;
}
export function date(value: unknown, name: string): string {
  const str = text(value, name);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(str) ||
    !Number.isFinite(Date.parse(str)) ||
    new Date(str).toISOString() !==
      (str.includes(".")
        ? str.replace(
            /\.(\d{1,3})Z$/,
            (_, digits: string) => `.${digits.padEnd(3, "0")}Z`,
          )
        : str.replace("Z", ".000Z"))
  )
    return invalid(name);
  return str;
}
export function version(value: Record<string, unknown>): void {
  if (value.schemaVersion !== 1) invalid("schemaVersion");
}
export function storeId(value: unknown): string {
  const str = text(value, "storeId");
  if (!/^(?:domain|tenant):[a-z0-9.-]+$/.test(str)) invalid("storeId");
  return str;
}
