import type { Response } from "express";

export interface EventStream {
  send(id: number, eventName: string, data: unknown): void;
  close(): void;
  readonly closed: boolean;
}

/**
 * Opens a Server-Sent Events response. Sends a heartbeat comment so idle
 * proxies don't drop the connection, and stops it when the client leaves.
 */
export function openEventStream(res: Response, heartbeatMs = 15_000): EventStream {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Stops nginx-style proxies from buffering the stream.
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 2000\n\n");

  let closed = false;
  const heartbeat = setInterval(() => {
    if (!closed) {
      res.write(": keep-alive\n\n");
    }
  }, heartbeatMs);

  const close = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    clearInterval(heartbeat);
    res.end();
  };

  // `res` close, not `req` close: since Node 16 a body-less request emits
  // "close" as soon as it is read, long before the client disconnects.
  res.on("close", () => {
    closed = true;
    clearInterval(heartbeat);
  });

  return {
    send(id, eventName, data) {
      if (!closed) {
        res.write(`id: ${id}\nevent: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    },
    close,
    get closed() {
      return closed;
    },
  };
}
