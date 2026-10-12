// Streaming helpers for scripted responses.
// A "script" is any (async) iterable of { delay?: ms, packet: object|string }.
export async function streamNdjson(res, iterable, { contentType = "text/plain; charset=utf-8", headers = {} } = {}) {
  res.writeHead(200, { "content-type": contentType, "cache-control": "no-cache", ...headers });
  for await (const { delay, packet } of iterable) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (res.destroyed) return;
    res.write((typeof packet === "string" ? packet : JSON.stringify(packet)) + "\n");
  }
  res.end();
}

// Server-sent events variant (for plugins whose apps use EventSource / SSE).
export async function streamSse(res, iterable, { headers = {} } = {}) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", ...headers });
  for await (const { delay, packet, event } of iterable) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (res.destroyed) return;
    res.write(`${event ? `event: ${event}\n` : ""}data: ${typeof packet === "string" ? packet : JSON.stringify(packet)}\n\n`);
  }
  res.end();
}

export function chunkText(text, size = 24) {
  const parts = [];
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
  return parts;
}
