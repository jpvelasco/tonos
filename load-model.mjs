#!/usr/bin/env node

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

const sdkPath = process.env.LMSTUDIO_SDK_PATH || path.join(
  os.homedir(), ".lmstudio", "extensions", "plugins", "lmstudio",
  "js-code-sandbox", "node_modules", "@lmstudio", "sdk", "dist", "index.mjs",
);
if (!fs.existsSync(sdkPath)) {
  throw new Error(`LM Studio SDK not found at ${sdkPath}. Set LMSTUDIO_SDK_PATH to its index.mjs file.`);
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

for (const loaded of await client.llm.listLoaded()) await loaded.unload();

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
if (args["physical-batch"] !== undefined) config.physicalBatchSize = Number(args["physical-batch"]);
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

const deadline = Date.now() + 300_000;
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

if (!instance) throw new Error("Model load did not finish within 300 seconds");
process.stdout.write(`${JSON.stringify(instance)}\n`);
await Promise.race([
  client[Symbol.asyncDispose](),
  new Promise((resolve) => setTimeout(resolve, 2_000)),
]);
process.exit(0);
