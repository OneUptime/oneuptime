import logger from "./Logger";

/*
 * Centralized graceful-shutdown coordinator.
 *
 * Before this existed, each subsystem registered its own
 * process.on("SIGTERM" | "SIGINT") handler independently. The telemetry
 * handler in particular called process.exit(0) as soon as the OTEL SDK
 * flushed, which raced every other handler and — crucially — meant the
 * Postgres / Redis / Clickhouse pools were never drained. Connections were
 * left for the OS socket teardown to reap (and leaked outright on SIGKILL or
 * a network partition).
 *
 * Now every subsystem registers an async cleanup callback here, and this class
 * is the single owner of the signal handlers and of process.exit. Handlers run
 * in ascending priority order (lower first) so we stop accepting new work
 * before tearing down the resources that work depends on:
 *
 *   HttpServer (10) -> stop accepting new HTTP requests
 *   Workers    (20) -> stop pulling new queue jobs, finish in-flight jobs
 *   Buffers    (30) -> flush in-memory write buffers to their datastore
 *   DataStores (40) -> drain Postgres / Redis / Clickhouse pools
 *   Telemetry  (50) -> flush traces / metrics / logs / profiles last
 *
 * Handlers in the same tier run concurrently. Each handler is bounded by a
 * per-handler timeout, and the whole sequence by an overall deadline, so a
 * single hung handler can never wedge the shutdown.
 */
export enum ShutdownPriority {
  HttpServer = 10,
  Workers = 20,
  Buffers = 30,
  DataStores = 40,
  Telemetry = 50,
}

export type ShutdownCallback = () => Promise<void> | void;

interface RegisteredShutdownHandler {
  name: string;
  priority: ShutdownPriority;
  callback: ShutdownCallback;
}

export default class GracefulShutdown {
  private static handlers: Array<RegisteredShutdownHandler> = [];
  private static signalListenersInstalled: boolean = false;
  private static isShuttingDown: boolean = false;

  /*
   * How long a single handler may run before we give up on it and move on.
   * Kept comfortably under the orchestrator (Kubernetes) default
   * terminationGracePeriodSeconds of 30s.
   */
  private static readonly perHandlerTimeoutMs: number = 10_000;

  /*
   * Hard ceiling for the entire shutdown. If we blow past this we force-exit
   * rather than risk being SIGKILLed mid-cleanup.
   */
  private static readonly overallTimeoutMs: number = 25_000;

  /*
   * Register a cleanup callback to run on SIGTERM / SIGINT. Registering by a
   * stable name is idempotent: a repeat registration (e.g. a second connect())
   * replaces the previous callback instead of stacking a duplicate. Callers
   * that own multiple independent resources (e.g. two Clickhouse pools) must
   * therefore pass distinct names.
   */
  public static registerHandler(
    name: string,
    priority: ShutdownPriority,
    callback: ShutdownCallback,
  ): void {
    const existingIndex: number = this.handlers.findIndex(
      (handler: RegisteredShutdownHandler) => {
        return handler.name === name;
      },
    );

    if (existingIndex >= 0) {
      this.handlers[existingIndex] = { name, priority, callback };
    } else {
      this.handlers.push({ name, priority, callback });
    }

    this.installSignalListeners();
  }

  private static installSignalListeners(): void {
    if (this.signalListenersInstalled) {
      return;
    }
    this.signalListenersInstalled = true;

    process.on("SIGTERM", () => {
      void this.shutdown("SIGTERM");
    });
    process.on("SIGINT", () => {
      void this.shutdown("SIGINT");
    });
  }

  public static async shutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) {
      /*
       * A second signal while we're already draining means the operator (or
       * orchestrator) is impatient. Bail out immediately.
       */
      logger.warn(
        `GracefulShutdown: received ${signal} while already shutting down. Forcing exit.`,
      );
      return process.exit(1);
    }

    this.isShuttingDown = true;
    logger.info(
      `GracefulShutdown: received ${signal}. Draining ${this.handlers.length} handler(s)...`,
    );

    const forceExitTimer: ReturnType<typeof setTimeout> = setTimeout(() => {
      logger.error(
        `GracefulShutdown: exceeded ${this.overallTimeoutMs}ms overall deadline. Forcing exit.`,
      );
      return process.exit(1);
    }, this.overallTimeoutMs);

    // Don't let this timer keep the event loop alive on its own.
    forceExitTimer.unref();

    // Run handlers tier by tier; lower priority tiers complete before the next.
    const tiers: Array<number> = Array.from(
      new Set(
        this.handlers.map((handler: RegisteredShutdownHandler) => {
          return handler.priority;
        }),
      ),
    ).sort((a: number, b: number) => {
      return a - b;
    });

    for (const tier of tiers) {
      const handlersInTier: Array<RegisteredShutdownHandler> =
        this.handlers.filter((handler: RegisteredShutdownHandler) => {
          return handler.priority === tier;
        });

      // Handlers within a tier are independent, so run them concurrently.
      await Promise.all(
        handlersInTier.map((handler: RegisteredShutdownHandler) => {
          return this.runHandlerWithTimeout(handler);
        }),
      );
    }

    clearTimeout(forceExitTimer);
    logger.info("GracefulShutdown: all handlers complete. Exiting cleanly.");
    return process.exit(0);
  }

  private static async runHandlerWithTimeout(
    handler: RegisteredShutdownHandler,
  ): Promise<void> {
    logger.debug(`GracefulShutdown: running handler "${handler.name}"...`);

    let timer: ReturnType<typeof setTimeout> | null = null;

    const timeout: Promise<void> = new Promise<void>((resolve: () => void) => {
      timer = setTimeout(() => {
        logger.warn(
          `GracefulShutdown: handler "${handler.name}" exceeded ${this.perHandlerTimeoutMs}ms. Moving on.`,
        );
        return resolve();
      }, this.perHandlerTimeoutMs);
      timer.unref();
    });

    const run: Promise<void> = (async (): Promise<void> => {
      try {
        await handler.callback();
        logger.debug(`GracefulShutdown: handler "${handler.name}" done.`);
      } catch (err) {
        logger.error(`GracefulShutdown: handler "${handler.name}" failed:`);
        logger.error(err);
      }
    })();

    await Promise.race([run, timeout]);

    if (timer) {
      clearTimeout(timer);
    }
  }
}
