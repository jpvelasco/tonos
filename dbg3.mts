import { createServer } from 'node:http';
import { once } from 'node:events';
import { runOpenAiCompatibleExchange } from './adapters/providers/openai-compatible.ts';
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hi' } }] })}\n\n`);
  res.end();
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const addr = server.address() as { port: number };
const out = await runOpenAiCompatibleExchange({ baseUrl: `http://127.0.0.1:${addr.port}/v1`, modelAlias: 'm', prompt: 'p', maxOutputTokens: 4, timeoutMs: 5000 });
console.log(JSON.stringify(out, null, 2));
server.close();
