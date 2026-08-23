#!/usr/bin/env node
//
// LEGACY MACHINE-LAB OPERATION — loads a model into LM Studio through the SDK
// client (client.llm.load). This mutates the local inference engine and is not
// part of the provider-agnostic Tonos path. Invoke deliberately.

import { pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

function readArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i];
    const value = argv[i + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid argument near ${name ?? "<end>"}`);
    }
    args[name.slice(2)] = value;
  }
  return args;
}

const args = readArgs(process.argv.slice(2));
for (const required of ["model", "server", "context", "parallel", "batch", "experts", "kv"]) {
  if (!(required in args)) throw new Error(`Missing --${required}`);
}

const allowedKv = new Set(["f16", "q8_0", "q4_0"]);
if (!allowedKv.has(args.kv)) throw new Error(`Unsupported KV cache type: ${args.kv}`);

function resolveSdkPath() {
  if (process.env.LMSTUDIO_SDK_PATH) return process.env.LMSTUDIO_SDK_PATH;
  const pluginsRoot = path.join(os.homedir(), ".lmstudio", "extensions", "plugins");
  let best;
  let publishers;
  try { publishers = fs.readdirSync(pluginsRoot, { withFileTypes: true }); } catch { return undefined; }
  for (const publisher of publishers) {
    if (!publisher.isDirectory()) continue;
    let plugins;
    try { plugins = fs.readdirSync(path.join(pluginsRoot, publisher.name), { withFileTypes: true }); } catch { continue; }
    for (const plugin of plugins) {
      if (!plugin.isDirectory()) continue;
      const candidate = path.join(pluginsRoot, publisher.name, plugin.name, "node_modules", "@lmstudio", "sdk", "dist", "index.mjs");
      if (!fs.existsSync(candidate)) continue;
      const mtime = fs.statSync(candidate).mtimeMs;
      if (!best || mtime > best.mtime) best = { path: candidate, mtime };
    }
  }
  return best?.path;
}

const sdkPath = resolveSdkPath();
if (!sdkPath) {
  throw new Error("No @lmstudio/sdk found under ~/.lmstudio/extensions/plugins. Set LMSTUDIO_SDK_PATH to its index.mjs file.");
}
const { LMStudioClient } = await import(pathToFileURL(sdkPath).href);
const apiRoot = args.server.replace(/\/$/, "");
const catalogResponse = await fetch(`${apiRoot}/api/v1/models`);
if (!catalogResponse.ok) throw new Error(`Model catalog request failed: HTTP ${catalogResponse.status}`);
const catalog = await catalogResponse.json();
const targetRecord = catalog.models?.find((candidate) => candidate.key === args.model);
if (!targetRecord) throw new Error(`Model ${args.model} not found in installed catalog`);
const isMoe = /moe/i.test(String(targetRecord.architecture ?? ""));

const baseUrl = args.server.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
const client = new LMStudioClient({ baseUrl, verboseErrorMessages: true });

let lastProgress = -1;
let loadError;
const config = {
    gpu: { ratio: "max", numCpuExpertLayersRatio: "off", mainGpu: 0 },
    maxParallelPredictions: Number(args.parallel),
    useUnifiedKvCache: true,
    gpuStrictVramCap: true,
    offloadKVCacheToGpu: true,
    contextLength: Number(args.context),
    evalBatchSize: Number(args.batch),
    flashAttention: true,
    keepModelInMemory: true,
    llamaKCacheQuantizationType: args.kv,
    llamaVCacheQuantizationType: args.kv,
};
if (isMoe) config.numExperts = Number(args.experts);
client.llm.load(args.model, {
    identifier: args.model,
    config,
    onProgress(progress) {
      const percent = Math.floor(progress * 100);
      if (percent >= lastProgress + 10) {
        process.stderr.write(`load ${percent}%\n`);
        lastProgress = percent;
      }
    },
  }).catch((error) => {
    loadError = error;
  });

const loadTimeoutMs = args["load-timeout-ms"] !== undefined ? Number(args["load-timeout-ms"]) : 300_000;
if (!Number.isFinite(loadTimeoutMs) || loadTimeoutMs <= 0) throw new Error(`Invalid --load-timeout-ms: ${args["load-timeout-ms"]}`);
setTimeout(() => {
  process.stderr.write(`Loader watchdog: exceeded ${Math.round(loadTimeoutMs / 1000)}s + grace; aborting.\n`);
  process.exit(1);
}, loadTimeoutMs + 15_000);
const start = Date.now();
const deadline = start + loadTimeoutMs;
let instance;
while (Date.now() < deadline) {
  if (loadError) throw loadError;
  const response = await fetch(`${apiRoot}/api/v1/models`);
  if (!response.ok) throw new Error(`Model status request failed: HTTP ${response.status}`);
  const catalog = await response.json();
  const record = catalog.models?.find((candidate) => candidate.key === args.model);
  instance = record?.loaded_instances?.find((candidate) => candidate.id === args.model);
  if (instance) break;
  await new Promise((resolve) => setTimeout(resolve, 500));
}

if (!instance) throw new Error(`Model load did not finish within ${Math.round(loadTimeoutMs / 1000)} seconds`);
process.stdout.write(`${JSON.stringify(instance)}\n`);
process.exit(0);
