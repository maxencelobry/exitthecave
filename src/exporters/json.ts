export function writeJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}
