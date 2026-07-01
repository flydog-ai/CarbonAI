import type { BindHost } from "@carbon-ai/config";

export type FetchHandler = (req: Request) => Response | Promise<Response>;

export type ListenHandle = {
  port: number;
  urls: string[];
  stop: () => void;
};

export type ListenOptions = {
  host: BindHost;
  port: number;
  /**
   * Bun defaults to 10s, which would kill operator waits and hang tests.
   * 0 = disable. Spike on Bun 1.3.14: 12s hang stays open; client abort cancels ≤ 2s.
   */
  idleTimeout?: number;
  maxRequestBodySize?: number;
};

function serveOne(
  fetch: FetchHandler,
  hostname: string,
  port: number,
  idleTimeout: number,
  maxRequestBodySize: number,
): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    hostname,
    port,
    fetch,
    idleTimeout,
    maxRequestBodySize,
  });
}

/**
 * Bind IPv4 and IPv6 loopback on the same port when host=loopback.
 * Bun.serve idleTimeout must be disabled (or ≥ wait_timeout) or SSE hangs die at 10s.
 */
export function listen(fetch: FetchHandler, opts: ListenOptions): ListenHandle {
  const idleTimeout = opts.idleTimeout ?? 0;
  const maxRequestBodySize = opts.maxRequestBodySize ?? 16 * 1024 * 1024;

  if (opts.host === "loopback") {
    const v4 = serveOne(fetch, "127.0.0.1", opts.port, idleTimeout, maxRequestBodySize);
    let v6: ReturnType<typeof Bun.serve>;
    try {
      v6 = serveOne(fetch, "::1", v4.port, idleTimeout, maxRequestBodySize);
    } catch (err) {
      v4.stop(true);
      throw new Error(
        `Failed to bind [::1]:${v4.port} (loopback dual-stack is required). ${err instanceof Error ? err.message : err}`,
      );
    }
    const port = v4.port;
    return {
      port,
      urls: [`http://127.0.0.1:${port}`, `http://[::1]:${port}`],
      stop: () => {
        v4.stop(true);
        v6.stop(true);
      },
    };
  }

  const hostname = opts.host === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1";
  const server = serveOne(fetch, hostname, opts.port, idleTimeout, maxRequestBodySize);
  const urlHost = hostname === "127.0.0.1" ? "127.0.0.1" : "0.0.0.0";
  return {
    port: server.port,
    urls: [`http://${urlHost}:${server.port}`],
    stop: () => server.stop(true),
  };
}
