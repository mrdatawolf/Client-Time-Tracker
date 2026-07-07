/**
 * Deep snake_case <-> camelCase key mapping between PostgREST rows and the
 * camelCase shapes the app has always used.
 */

const snakeToCamelKey = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const camelToSnakeKey = (k: string) => k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());

function mapKeysDeep(value: unknown, mapKey: (k: string) => string, stringifyNumbers: boolean): unknown {
  if (Array.isArray(value)) return value.map((v) => mapKeysDeep(v, mapKey, stringifyNumbers));
  if (value !== null && typeof value === 'object' && value.constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[mapKey(k)] = mapKeysDeep(v, mapKey, stringifyNumbers);
    }
    return out;
  }
  // The legacy API served Postgres numerics as strings (node-postgres text
  // protocol), and the UI was written against that — .trim(), .replace(),
  // etc. PostgREST sends JSON numbers, so restore the legacy shape here.
  if (stringifyNumbers && typeof value === 'number') return String(value);
  return value;
}

/** PostgREST row(s) -> app shape */
export function toCamel<T>(value: unknown): T {
  return mapKeysDeep(value, snakeToCamelKey, true) as T;
}

/** App payload -> PostgREST column names */
export function toSnake(value: unknown): Record<string, unknown> {
  return mapKeysDeep(value, camelToSnakeKey, false) as Record<string, unknown>;
}
