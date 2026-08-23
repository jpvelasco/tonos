# Optional Tonos and Morpheus Interoperability

Status: Accepted boundary; deferred implementation

Date: 2026-08-22

## Decision

Tonos and Morpheus are independent products with complementary specialization:

- **Tonos** qualifies the developer-facing harness/configuration experience
  against an externally served model endpoint.
- **Morpheus** selects, tunes, deploys, observes, and recovers the
  model/quantization/engine/hardware tuple that serves an endpoint.

Neither repository imports, vendors, symlinks, packages, starts, or requires the
other. Each must pass its complete standalone gate when the other repository and
service are absent.

## Supported Topologies

All of these remain valid:

```text
Tonos -> LM Studio on the same machine
Tonos -> arbitrary compatible LAN or remote provider
Tonos -> Morpheus-managed endpoint on an inference host
Morpheus -> its own canonical direct benchmark suite, without Tonos
```

Morpheus normally runs on the machine whose inference deployment it manages.
Tonos runs where the harness and disposable task workspace run. This agreement
does not turn Morpheus into a remote fleet controller.

## Measurement Boundary

Tonos is authoritative for observations at the client/harness boundary:

- harness setup and orchestration time;
- end-to-end task wall time;
- visible/reasoning/tool-event timing observed by the client;
- tool calls, repository edits, verification, recovery, and task correctness;
- harness failures and retries.

The inference operator is authoritative for server-side evidence:

- queue and request scheduling;
- server TTFT and decode throughput;
- KV/cache behavior;
- GPU, RAM, storage, power, and process health;
- engine/model/configuration identity and lifecycle state.

The two views may disagree without either being corrupt. Clock skew, buffering,
client preprocessing, transport, retries, and provider queues are material
explanations that remain explicit.

## Optional Correlation

An operator may provide one opaque correlation value to both independent runs.
It is a convenience for later search and comparison, with these invariants:

- optional and disabled by default;
- bounded, non-secret, and safe to log in sanitized records;
- generated or supplied by the operator, not negotiated between services;
- untrusted metadata, never authentication or authorization;
- not a machine, model, deployment, request, user, or ownership identity;
- not evidence that clocks or record boundaries align;
- absence or provider inability to carry it does not fail a Tonos trial or a
  Morpheus campaign.

Until a later implementation decision fixes a carrier, Tonos records the value
locally and may send it only through an explicitly configured provider-supported
metadata/header field. It must not overwrite required protocol fields or place
the value in prompts.

## Evidence Exchange

The optional integration unit is a sanitized immutable file/bundle, not a
runtime control API. A Tonos bundle may contain:

- Tonos schema and producer version;
- source result digest and export/redactor version;
- harness identity and effective configuration;
- provider profile and served-model observation;
- task suite/evaluator identities;
- trial terminal state, measurements, objective outcomes, limitations, and
  sample/dispersion summaries;
- optional external deployment/evidence references and correlation value;
- explicit declarations of omitted content and missing provenance.

It excludes secrets, prompts, responses, reasoning, arbitrary tool arguments,
repository content, active user configuration, and engine-control instructions.

Morpheus or another consumer independently validates and maps the bundle. It may
classify evidence as measured, foreign-machine, stale, partial, estimated, or
incomparable. A successful parse never makes evidence recommendation-eligible
automatically.

## Joint Workflow

When an operator deliberately uses both projects:

1. Morpheus or another operator stages a served deployment and exposes a bounded
   provider endpoint.
2. The operator records the deployment/evidence reference and optionally chooses
   a correlation value.
3. Tonos runs one harness matrix against the endpoint without changing it.
4. Tonos produces a sanitized qualification bundle.
5. The operator may import the bundle into Morpheus after its canonical identity
   and evidence-import contracts are available.
6. Morpheus treats harness outcomes as attributed workload-quality evidence and
   retains its own deployment, hardware, policy, and promotion authority.

No step automatically retunes, promotes, rolls back, or adopts an inference
runtime. A new server configuration creates a new Morpheus plan/evidence
identity and requires a distinct Tonos matrix if its behavior is to be compared.

## Change Control

Implementation belongs after Tonos T1-through-T6 and Morpheus rectification R1
and R2. Before implementation, both repositories must agree only on static
golden exchange fixtures and semantic field definitions. A shared runtime
library, remote-control API, automatic orchestration, or fleet controller would
be a new architectural decision and is outside this boundary.
