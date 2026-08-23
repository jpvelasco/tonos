# Matrix Runner Design Note

Status: design note for issue #23 item 4; no code ships in this change.
Scope: execution of a `TrialMatrix` with bounded concurrency,
checkpoint/resume, and cancellation, on top of the T2 `TrialRunner` and the
T6 pure comparison engine.

## 1. Purpose and non-goals

T6 delivered pure comparison logic (`core/comparison/engine.ts`) over recorded
trials; nothing executes a declared matrix yet. This note designs the missing
runner loop. It is written before code because the hard part is not
concurrency — it is guaranteeing that checkpoint state never becomes
fabricated evidence.

Non-goals:

- no redefinition of trial identity or result schemas;
- no distributed/multi-host execution (single process per matrix run);
- no retry of failed units at the runner level (retries are a harness
  configuration concern, already declared per declaration);
- no qualification policy logic beyond feeding the existing pure engine.

## 2. Unit model

A matrix run decomposes into **units**:

```text
unit = (declarationId, repetitionIndex)
```

- `declarationId` is the content-derived trial id of one declaration in
  `matrix.declarations`;
- `repetitionIndex` enumerates `repetition.total` from the declaration.

The set of units is fully derived from the matrix document. The unit key is
therefore stable across resume sessions without any extra state.

## 3. Lifecycle

```text
pending -> running -> done(resultDigest)   | unit completed, result persisted
                    -> incomplete(reasonClass) | harness ran but did not complete
                       (timed-out | cancelled | invalid | unsupported)
                    -> schedule-failed(reason) | workspace/config/process error
```

Rules:

- every terminal state persists an immutable artifact or an explicit
  schedule-failed record; nothing disappears silently;
- `incomplete` units are evidence (PRODUCT_SPECIFICATION §3.6) but are never
  eligible winners (the T6 policy already excludes failures);
- `schedule-failed` records carry the adapter error class and count as
  missing evidence for the affected unit only.

## 4. Bounded concurrency

- effective concurrency =
  `min(matrix-declared limit if present, min(suite.limits.maxConcurrentTrials) across participating suites, operator flag)`;
- suites declare `maxConcurrentTrials` (1..64) today; until the matrix record
  grows its own field, the suite minimum governs;
- units are dispatched in declaration order, repetition-major within a
  declaration, so partial runs leave a deterministic prefix of completed work
  (friendly to resume and to humans reading checkpoints);
- the scheduling loop is pure: given `(units, state, limits)` it returns the
  next dispatchable units; the process adapter executes it. This keeps the
  loop testable without spawning anything.

## 5. Cancellation

- an explicit operator cancel stops *dispatch* immediately;
- running trials receive the cooperative cancel path first:
  `cancelGraceMs` (declared per declaration) to flush and exit; after the
  grace window the tree stop fires (POSIX group kill / Windows `taskkill`,
  see ARCHITECTURE §5);
- cancelled units persist honest `'cancelled'` results — they are evidence,
  never winners;
- resume after a cancelled run treats cancelled units like any other
  incomplete unit: they are *not* silently re-run; resuming re-runs them only
  under an explicit operator instruction that names the replacement policy,
  because silently replacing a cancelled sample would fabricate a different
  experiment.

## 6. Checkpoint format and resume protocol

The central rule:

> A checkpoint is a schedule index, not evidence. It may claim nothing about
> outcomes; it only points at outcome artifacts.

Layout under the ignored owned artifacts root:

```text
artifacts/matrices/<matrixId>-<matrixDigest>/
  results/trn_trial_<...>/rep-<n>.json     # canonical TrialResult documents
  schedule-failures/<unitKey>.json         # explicit non-evidence failure records
  checkpoint.json                          # {version, matrixDigest, units:{unitKey:{state, artifactDigest?}}}
```

- `matrixDigest` = content digest of the sorted declarations + repetition
  policy + policyRevision. Any edit to the matrix invalidates old checkpoints
  by construction (different directory).
- Result documents are written once via temp-file + atomic rename and are
  never rewritten. Their canonical encoding digest is stored in the
  checkpoint.
- **Resume protocol:** for each unit marked done in the checkpoint, reload the
  referenced artifact and verify it decodes AND its digest matches the
  checkpoint entry. Any mismatch/absence demotes the unit to pending before
  dispatch. The comparison phase therefore always recomputes from artifacts,
  never from checkpoint claims.
- **Unclaimed artifacts are never trusted:** an artifact sitting at a unit's
  canonical path without a valid digest-bearing checkpoint claim is evidence
  of nothing (it may be tampered bytes); the unit re-runs and atomically
  replaces it. A crashed session loses nothing durable because every state
  transition saves the last-good checkpoint atomically; only externally
  corrupted metadata costs re-execution.
- Consequence: corrupting the checkpoint cannot corrupt evidence — worst case
  it causes redundant re-runs; corrupting artifacts is detected by digest and
  demoted to re-run rather than trusted.
- Cross-process locking is out of scope for v1: two concurrent runs sharing a
  directory is operator error; the atomic-rename discipline makes the
  resulting state detectable (digest mismatch), not silently wrong.

## 7. Comparison hand-off

When all units reach a terminal state (or the operator forces early analysis):

1. load all result artifacts fresh from disk;
2. project each into the T6 `RecordedTrial` shape (pure reducer);
3. feed `comparabilityOf`, `aggregateTrial`, `evaluatePolicy` unchanged;
4. emit a `QualificationDecision` through the codec, carrying exclusions with
   reason classes and honest limitation text (sample counts, dispersion).

## 8. Testing strategy (TDD order when implementation starts)

1. Pure scheduler: given synthetic states, next-units selection respects
   order, concurrency bound, cancellation stop, and resume demotion rules —
   no processes involved.
2. Checkpoint integrity: tampered digest / truncated file / stale matrix
   digest each demote to re-run; no path trusts index claims alone.
3. Integration: small fixture matrix (two declarations × two repetitions)
   through real ports; kill mid-run; resume; final decision equals the
   uninterrupted run's decision modulo wall-clock values.
4. Cancellation: mid-flight cancel produces only `'cancelled'`/complete
   states, no orphaned processes or workspaces.

## 9. Open questions for the implementation PR

- should the matrix record gain its own `maxConcurrentTrials`, or does the
  suite-minimum rule stand?
- retention class for `results/` (likely follows each suite's declared
  retention; mixed-suite matrices need a per-artifact answer, not a matrix
  answer);
- whether `schedule-failures` belong inside the sanitized export bundle or
  stay local-only evidence.
