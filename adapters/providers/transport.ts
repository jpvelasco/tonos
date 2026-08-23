// Shared request transport for provider protocol adapters.
//
// A transient pre-response transport death (connection reset, pooled-socket
// eviction race under load) must not surface as a cancelled exchange: one
// transparent reconnect covers it. Failures after response headers remain
// honest evidence and are never retried here.

export type Connected =
  | { response: Response; cause?: undefined }
  | { response?: undefined; cause: Error };

export async function connectWithOneRetry(
  url: string,
  init: RequestInit,
): Promise<Connected> {
  const first = await fetch(url, init).catch((cause: unknown) => cause);
  if (first instanceof Response) return { response: first };
  // one transparent reconnect for pre-response transport failures
  const second = await fetch(url, init).catch(() => undefined);
  if (second instanceof Response) return { response: second };
  return {
    cause: first instanceof Error ? first : new Error('transport failed'),
  };
}

/** True when a thrown cause represents an aborted/timed-out request. */
export function isTimeoutCause(cause: unknown): boolean {
  return (
    cause instanceof Error &&
    (cause.name === 'AbortError' || cause.name === 'TimeoutError')
  );
}

/** Outer fetch failures wrap the real reason; surface both, bounded. */
export function describeTransportCause(cause: unknown, max = 256): string {
  const text = String(cause);
  const nested = (cause as { cause?: { message?: string } | undefined })
    ?.cause?.message;
  const described = nested !== undefined && !text.includes(nested)
    ? `${text} (${nested})`
    : text;
  return described.slice(0, max);
}
