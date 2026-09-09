import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  renderQualificationHtml,
  renderQualificationMarkdown,
  REPORT_REDUCER_VERSION,
} from '../../core/matrix/report.ts';
import { fixtureQualificationDecision } from '../fixtures/records.ts';

const CANARY = 'tonos-report-secret-canary';

test('markdown report includes comparability, gates, and a no-winner path', () => {
  const decision = fixtureQualificationDecision();
  decision.winnerDeclarationId = null;
  const markdown = renderQualificationMarkdown(decision);
  assert.match(markdown, /no winner/u);
  assert.match(markdown, /Comparable trial sets/u);
  assert.match(markdown, /correctness-floor/u);
  assert.match(markdown, new RegExp(`Reducer: ${REPORT_REDUCER_VERSION}`, 'u'));
  assert.ok(!markdown.includes(CANARY));
});

test('html report is a sanitized derived artifact without secret canaries', () => {
  const decision = fixtureQualificationDecision();
  (decision as { tradeoffsAndLimitations: string }).tradeoffsAndLimitations =
    `safe limitation text; never ${CANARY}`;
  const html = renderQualificationHtml(decision);
  assert.match(html, /<!doctype html>/u);
  assert.ok(!html.includes(CANARY));
});
