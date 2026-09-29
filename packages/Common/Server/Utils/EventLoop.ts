export default class EventLoop {
  /**
   * Yields control back to the Node.js event loop, resuming on a later
   * "check" phase tick.
   *
   * Use this to break up CPU-bound synchronous work — e.g. transforming
   * tens of thousands of OTLP datapoints / spans / log records inside a
   * single ingest job — so the process can service pending I/O between
   * chunks. Most importantly, this lets the Kubernetes liveness and
   * readiness probe handlers (/status/live, /status/ready) run. Without a
   * periodic yield a large batch pins the single-threaded event loop for
   * seconds at a time, the probe HTTP handler never gets scheduled, the
   * kubelet marks the probe as failed, and the pod is restarted.
   *
   * IMPORTANT: this is implemented with setImmediate, NOT
   * `await Promise.resolve()`. Awaiting a resolved promise only drains the
   * microtask queue; the event loop never advances to its poll phase, so
   * queued I/O (including probe requests) stays starved no matter how often
   * you await. setImmediate schedules a macrotask in the check phase, which
   * runs only after the poll phase has had a chance to process I/O — so a
   * loop that periodically awaits this genuinely unblocks the event loop.
   */
  public static async yieldToEventLoop(): Promise<void> {
    return new Promise<void>((resolve: () => void) => {
      setImmediate(resolve);
    });
  }
}
