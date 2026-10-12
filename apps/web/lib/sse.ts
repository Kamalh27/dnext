export interface RawSse { event: string; data: string }

/** Parse a fetch() body as Server-Sent Events (works for POST, unlike EventSource). */
export async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<RawSse> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buf += decoder.decode(value, { stream: !done });
      buf = buf.replace(/\r\n?/g, "\n");
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const msg = parseBlock(buf.slice(0, idx));
        buf = buf.slice(idx + 2);
        if (msg) yield msg;
      }
      if (done) break;
    }
    const tail = parseBlock(buf);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function parseBlock(block: string): RawSse | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const i = line.indexOf(":");
    const field = i === -1 ? line : line.slice(0, i);
    const value = i === -1 ? "" : line.slice(i + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  return data.length ? { event, data: data.join("\n") } : null;
}
