/**
 * Deep snake_case <-> camelCase key mapping between PostgREST rows and the
 * camelCase shapes the app has always used.
 */

const snakeToCamelKey = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const camelToSnakeKey = (k: string) => k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());

function mapKeysDeep(value: unknown, mapKey: (k: string) => string): unknown {
  if (Array.isArray(value)) return value.map((v) => mapKeysDeep(v, mapKey));
  if (value !== null && typeof value === 'object' && value.constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[mapKey(k)] = mapKeysDeep(v, mapKey);
    }
    return out;
  }
  return value;
}

/** PostgREST row(s) -> app shape */
export function toCamel<T>(value: unknown): T {
  return mapKeysDeep(value, snakeToCamelKey) as T;
}

/** App payload -> PostgREST column names */
export function toSnake(value: unknown): Record<string, unknown> {
  return mapKeysDeep(value, camelToSnakeKey) as Record<string, unknown>;
}
