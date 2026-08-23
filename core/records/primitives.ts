import { z } from 'zod';

export const Slug = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]{0,63}$/u,
    'slugs are lowercase kebab identifiers (max 64)',
  );
export const Version = z
  .string()
  .regex(/^[0-9A-Za-z][0-9A-Za-z.+-~]{0,31}$/u, 'bounded version string');
export const Hex64 = z.string().regex(/^[0-9a-f]{64}$/u, 'lowercase sha256 hex');
export const Hex16 = z.string().regex(/^[0-9a-f]{16}$/u, 'hex seed');
export const Iso8601 = z
  .string()
  .refine(
    (value) =>
      !Number.isNaN(Date.parse(value)) &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
        value,
      ),
    'ISO-8601 timestamp with timezone',
  );
export const SecretRef = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9:_.-]{0,63}$/u,
    'secret references are bounded store addresses like credman:lmstudio-key; never values',
  );
export const BoundedText = (max: number) =>
  z.string().max(max).refine((v) => v === v.trim(), 'no leading/trailing space');

const FORBIDDEN_COMMAND_CHARS = /[&|;<>()$`\\"'!?*[\]{}]/u;

export const Command = z
  .string()
  .min(1)
  .max(256)
  .superRefine((value, context) => {
    const bad = [...value].find((ch) => FORBIDDEN_COMMAND_CHARS.test(ch));
    if (bad !== undefined) {
      context.addIssue({
        code: 'custom',
        message: `command '${value}' contains forbidden character '${bad}'; allowlisted commands are argv-style tokens without shell metacharacters`,
      });
    }
  });

export const RelativePath = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9/_.-]{0,127}$/u,
    'artifact paths are repo-relative forward-slash paths',
  );

export type Slug = z.output<typeof Slug>;
export type Command = z.output<typeof Command>;
