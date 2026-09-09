import { failedOutcome } from '../../core/providers/canonical.ts';
import type {
  ExchangeOutcome,
  ExchangeRequest,
} from '../../core/providers/types.ts';

export type PreparedCredentials =
  | { ok: true; secrets: readonly string[] }
  | { ok: false; outcome: ExchangeOutcome };

/** Resolve declared secret refs or fail closed before any network send. */
export function failClosedIfUnresolved(
  request: ExchangeRequest & { profileId?: string },
  protocolAdapterKind: string,
  started: number,
): PreparedCredentials {
  const secrets: string[] = [];
  for (const ref of request.secretRefs ?? []) {
    let value: string | undefined;
    try {
      value = request.resolveSecret?.(ref);
    } catch {
      value = undefined;
    }
    if (value === undefined || value === '') {
      return {
        ok: false,
        outcome: failedOutcome(request, protocolAdapterKind, started, {
          terminalReason: 'configuration-error',
          httpStatus: null,
          errorDetail: `secret reference '${ref}' is unresolved`,
        }),
      };
    }
    secrets.push(value);
  }
  return { ok: true, secrets };
}

export function bearerHeaders(
  secrets: readonly string[],
): Record<string, string> {
  const token = secrets[0];
  return token === undefined ? {} : { authorization: `Bearer ${token}` };
}

export function redactSecrets(text: string, secrets: readonly string[]): string {
  let redacted = text;
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    redacted = redacted.split(secret).join('[redacted]');
  }
  return redacted;
}


