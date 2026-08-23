export function deepMutate<T>(
  root: T,
  path: ReadonlyArray<string | number>,
  value: unknown,
): T {
  if (path.length === 0) {
    return structuredClone(value) as T;
  }
  const clone = (
    Array.isArray(root) ? [...(root as unknown[])] : { ...(root as object) }
  ) as Record<string | number, unknown>;
  const [head, ...rest] = path;
  const key = head as string | number;
  clone[key] = deepMutate(clone[key], rest, value);
  return clone as T;
}
