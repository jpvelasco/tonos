import type { QualificationDecision } from '../records/matrix.ts';

export const REPORT_REDUCER_VERSION = '1';

const SECRET_SHAPED = /sk-[A-Za-z0-9]+|ghp_[A-Za-z0-9]+|tonos-[a-z0-9-]*canary[a-z0-9-]*/gu;

function sanitize(text: string): string {
  return text.replace(SECRET_SHAPED, '[redacted]');
}

export function renderQualificationMarkdown(
  decision: QualificationDecision,
): string {
  const winner =
    decision.winnerDeclarationId === null
      ? 'no winner'
      : `\`${decision.winnerDeclarationId}\``;
  const gates = decision.gates
    .map((gate) => `- ${gate.gateId}: ${gate.passed ? 'passed' : 'failed'}`)
    .join('\n');
  const exclusions =
    decision.exclusions.length === 0
      ? '- none'
      : decision.exclusions
          .map((exclusion) => `- ${exclusion.reasonClass}: \`${exclusion.declarationId}\``)
          .join('\n');
  return [
    `# Qualification report`,
    ``,
    `Reducer: ${REPORT_REDUCER_VERSION}`,
    `Matrix: \`${decision.matrixId}\``,
    `Policy: \`${decision.policyRevision}\``,
    `Comparable trial sets: ${decision.comparableTrialCount}`,
    `Outcome: ${winner}`,
    ``,
    `## Gates`,
    gates || '- none',
    ``,
    `## Exclusions`,
    exclusions,
    ``,
    `## Limitations`,
    sanitize(decision.tradeoffsAndLimitations),
    ``,
  ].join('\n');
}

export function renderQualificationHtml(decision: QualificationDecision): string {
  const markdown = renderQualificationMarkdown(decision);
  const escaped = markdown
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Qualification report</title></head><body><pre>${escaped}</pre></body></html>\n`;
}
