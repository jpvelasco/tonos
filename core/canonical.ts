import { createHash } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map(serialize).join(',')}]`;
  }
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number': {
      assertFiniteNumber(value);
      return serializeNumber(value);
    }
    case 'object': {
      const entries = Object.entries(value as Record<string, unknown>).sort(
        ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
      );
      return `{${entries
        .map(([key, val]) => `${JSON.stringify(key)}:${serialize(val)}`)
        .join(',')}}`;
    }
    default:
      throw new TypeError(
        `canonicalJson cannot serialize ${typeof value}; use null, booleans, finite numbers, strings, arrays, or plain objects`,
      );
  }
}

function assertFiniteNumber(value: number): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(
      `canonicalJson cannot serialize ${value}; numbers must be finite`,
    );
  }
}

function serializeNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return JSON.stringify(value);
}

export function sha256Hex(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

export function contentId(prefix: string, payload: unknown): string {
  if (!/^[a-z][a-z0-9_]*_$/.test(prefix)) {
    throw new TypeError(
      `contentId prefix '${prefix}' must match [a-z][a-z0-9]*_ so ids stay greppable and collision-free`,
    );
  }
  return `${prefix}${sha256Hex(canonicalJson(payload))}`;
}
