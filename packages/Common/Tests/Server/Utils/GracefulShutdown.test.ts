import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import timers from "timers";
import GracefulShutdown, {
  ShutdownCallback,
  ShutdownPriority,
} from "../../../Server/Utils/GracefulShutdown";

/*
 * The single owner of SIGTERM / SIGINT and of process.exit.
 *
 * Kubernetes gives a terminating pod one SIGTERM and then a hard SIGKILL at
 * the end of terminationGracePeriodSeconds. Everything this coordinator
 * promises has to happen inside that window, and each promise fails in a way
 * that is invisible in the happy path:
 *
 *  - Tier ORDER is what stops us draining the Postgres pool while an HTTP
 *    request is still mid-query. If ordering regresses, shutdown still
 *    "succeeds" -- it just emits connection errors under load.
 *  - Registration is BY NAME and idempotent, because connect() runs more than
 *    once in several services. A duplicate registration would double-close a
 *    pool, and the second close is the one that throws.
 *  - A handler that hangs must NOT hold the sequence. Exceeding the overall
 *    deadline means SIGKILL, i.e. exactly the un-drained teardown this class
 *    exists to prevent.
 *  - A handler that THROWS must not abort the remaining tiers, or one broken
 *    subsystem takes every other subsystem's cleanup down with it.
 *
 * process.exit is stubbed throughout: the real one would take the test runner
 * with it, and the exit CODE is itself part of the contract (0 clean, 1 when
 * we gave up).
 *
 * Common's jest environment is jsdom, whose setTimeout returns a bare number
 * with no unref() -- a browser shim, not a Node timer. The coordinator unrefs
 * its deadline timer so it cannot by itself keep a draining process alive, so
 * the suite swaps in the real Node timers for the duration. (A
 * `@jest-environment node` docblock is not an option here: Common's shared
 * jest.setup.ts touches `window`.)
 */

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

interface MutableGracefulShutdown {
  handlers: Array<{ name: string; priority: ShutdownPriority }>;
  isShuttingDown: boolean;
  signalListenersInstalled: boolean;
  perHandlerTimeoutMs: number;
  overallTimeoutMs: number;
}

type ExitSpy = jest.SpiedFunction<(code?: number) => never>;

const internals: MutableGracefulShutdown =
  GracefulShutdown as unknown as MutableGracefulShutdown;

/*
 * The class keeps its registry, its "already draining" latch and its timeouts
 * in private statics that survive between tests. Reset them so each test
 * starts from a freshly booted process, and shrink the timeouts so the
 * deadline tests do not sit for 10s of real time.
 */
const resetCoordinator: (overrides?: {
  perHandlerTimeoutMs?: number;
  overallTimeoutMs?: number;
}) => void = (
  overrides: {
    perHandlerTimeoutMs?: number;
    overallTimeoutMs?: number;
  } = {},
): void => {
  internals.handlers = [];
  internals.isShuttingDown = false;
  internals.signalListenersInstalled = false;
  internals.perHandlerTimeoutMs = overrides.perHandlerTimeoutMs ?? 50;
  internals.overallTimeoutMs = overrides.overallTimeoutMs ?? 5_000;
};

const registeredNames: () => Array<string> = (): Array<string> => {
  return internals.handlers.map((handler: { name: string }) => {
    return handler.name;
  });
};

interface Deferred {
  promise: Promise<void>;
  release: () => void;
}

/*
 * A promise the test releases by hand. Lets a handler sit "in flight" for as
 * long as an assertion needs, without leaning on real timers.
 */
const deferred: () => Deferred = (): Deferred => {
  let release: () => void = (): void => {};

  const promise: Promise<void> = new Promise<void>((resolve: () => void) => {
    release = resolve;
  });

  return {
    promise,
    release: (): void => {
      release();
    },
  };
};

describe("GracefulShutdown", () => {
  let exitSpy: ExitSpy;
  let signalListenersBefore: Array<NodeJS.SignalsListener>;
  let jsdomSetTimeout: typeof globalThis.setTimeout;
  let jsdomClearTimeout: typeof globalThis.clearTimeout;

  beforeEach(() => {
    resetCoordinator();

    jsdomSetTimeout = globalThis.setTimeout;
    jsdomClearTimeout = globalThis.clearTimeout;
    globalThis.setTimeout = timers.setTimeout as typeof globalThis.setTimeout;
    globalThis.clearTimeout =
      timers.clearTimeout as typeof globalThis.clearTimeout;

    signalListenersBefore = [
      ...process.listeners("SIGTERM"),
      ...process.listeners("SIGINT"),
    ] as Array<NodeJS.SignalsListener>;

    exitSpy = jest.spyOn(process, "exit").mockImplementation((): never => {
      return undefined as never;
    }) as ExitSpy;
  });

  afterEach(() => {
    exitSpy.mockRestore();
    globalThis.setTimeout = jsdomSetTimeout;
    globalThis.clearTimeout = jsdomClearTimeout;

    /*
     * installSignalListeners() attaches to the real process. Without this the
     * listeners accumulate across tests and Node starts warning about a leak.
     */
    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      for (const listener of process.listeners(signal)) {
        if (
          !signalListenersBefore.includes(listener as NodeJS.SignalsListener)
        ) {
          process.removeListener(signal, listener as NodeJS.SignalsListener);
        }
      }
    }
  });

  describe("registration", () => {
    test("registering the same name twice replaces the callback instead of stacking a duplicate", async () => {
      const stale: ReturnType<typeof jest.fn> = jest.fn();
      const fresh: ReturnType<typeof jest.fn> = jest.fn();

      GracefulShutdown.registerHandler(
        "postgres",
        ShutdownPriority.DataStores,
        stale as unknown as ShutdownCallback,
      );
      GracefulShutdown.registerHandler(
        "postgres",
        ShutdownPriority.DataStores,
        fresh as unknown as ShutdownCallback,
      );

      expect(registeredNames()).toEqual(["postgres"]);

      await GracefulShutdown.shutdown("SIGTERM");

      // The second connect() owns the live pool; closing the first would throw.
      expect(stale).not.toHaveBeenCalled();
      expect(fresh).toHaveBeenCalledTimes(1);
    });

    test("re-registering under a new priority moves the handler rather than running it in both tiers", async () => {
      const order: Array<string> = [];

      GracefulShutdown.registerHandler(
        "buffers",
        ShutdownPriority.Telemetry,
        (): void => {
          order.push("buffers");
        },
      );
      GracefulShutdown.registerHandler(
        "buffers",
        ShutdownPriority.HttpServer,
        (): void => {
          order.push("buffers");
        },
      );
      GracefulShutdown.registerHandler(
        "telemetry",
        ShutdownPriority.Telemetry,
        (): void => {
          order.push("telemetry");
        },
      );

      await GracefulShutdown.shutdown("SIGTERM");

      expect(order).toEqual(["buffers", "telemetry"]);
    });

    test("distinct names under one priority are kept side by side", () => {
      GracefulShutdown.registerHandler(
        "clickhouse-primary",
        ShutdownPriority.DataStores,
        (): void => {},
      );
      GracefulShutdown.registerHandler(
        "clickhouse-secondary",
        ShutdownPriority.DataStores,
        (): void => {},
      );

      expect(registeredNames()).toEqual([
        "clickhouse-primary",
        "clickhouse-secondary",
      ]);
    });

    test("the first registration installs the signal listeners, and later ones do not stack more", () => {
      const before: number =
        process.listeners("SIGTERM").length +
        process.listeners("SIGINT").length;

      GracefulShutdown.registerHandler("a", ShutdownPriority.Workers, () => {});
      GracefulShutdown.registerHandler("b", ShutdownPriority.Workers, () => {});
      GracefulShutdown.registerHandler("c", ShutdownPriority.Buffers, () => {});

      const after: number =
        process.listeners("SIGTERM").length +
        process.listeners("SIGINT").length;

      /*
       * Exactly one SIGTERM listener and one SIGINT listener, however many
       * subsystems registered.
       */
      expect(after - before).toBe(2);
    });
  });

  describe("ordering", () => {
    test("tiers run lowest priority first, whatever order they registered in", async () => {
      const order: Array<string> = [];

      const record: (name: string) => ShutdownCallback = (
        name: string,
      ): ShutdownCallback => {
        return async (): Promise<void> => {
          await Promise.resolve();
          order.push(name);
        };
      };

      // Deliberately registered back to front.
      GracefulShutdown.registerHandler(
        "telemetry",
        ShutdownPriority.Telemetry,
        record("telemetry"),
      );
      GracefulShutdown.registerHandler(
        "datastores",
        ShutdownPriority.DataStores,
        record("datastores"),
      );
      GracefulShutdown.registerHandler(
        "buffers",
        ShutdownPriority.Buffers,
        record("buffers"),
      );
      GracefulShutdown.registerHandler(
        "workers",
        ShutdownPriority.Workers,
        record("workers"),
      );
      GracefulShutdown.registerHandler(
        "http",
        ShutdownPriority.HttpServer,
        record("http"),
      );

      await GracefulShutdown.shutdown("SIGTERM");

      expect(order).toEqual([
        "http",
        "workers",
        "buffers",
        "datastores",
        "telemetry",
      ]);
    });

    test("a later tier does not start until every handler in the previous tier has settled", async () => {
      const events: Array<string> = [];

      const http: Deferred = deferred();

      GracefulShutdown.registerHandler(
        "http",
        ShutdownPriority.HttpServer,
        async (): Promise<void> => {
          events.push("http:start");
          await http.promise;
          events.push("http:end");
        },
      );

      GracefulShutdown.registerHandler(
        "postgres",
        ShutdownPriority.DataStores,
        (): void => {
          events.push("postgres");
        },
      );

      const shuttingDown: Promise<void> = GracefulShutdown.shutdown("SIGTERM");

      // Let the HTTP handler get going, then confirm the pool is untouched.
      await Promise.resolve();
      expect(events).toEqual(["http:start"]);

      http.release();
      await shuttingDown;

      expect(events).toEqual(["http:start", "http:end", "postgres"]);
    });

    test("handlers in the same tier run concurrently rather than one after the other", async () => {
      const started: Array<string> = [];
      const gate: Deferred = deferred();

      const concurrent: (name: string) => ShutdownCallback = (
        name: string,
      ): ShutdownCallback => {
        return async (): Promise<void> => {
          started.push(name);
          await gate.promise;
        };
      };

      GracefulShutdown.registerHandler(
        "redis",
        ShutdownPriority.DataStores,
        concurrent("redis"),
      );
      GracefulShutdown.registerHandler(
        "postgres",
        ShutdownPriority.DataStores,
        concurrent("postgres"),
      );

      const shuttingDown: Promise<void> = GracefulShutdown.shutdown("SIGTERM");

      await Promise.resolve();

      /*
       * Both are in flight while neither has finished -- that is the point of
       * a tier: the 30s budget is shared, not spent serially.
       */
      expect(started).toEqual(["redis", "postgres"]);

      gate.release();
      await shuttingDown;
    });
  });

  describe("failure containment", () => {
    test("a handler that rejects does not stop the tiers that follow it", async () => {
      const drained: Array<string> = [];

      GracefulShutdown.registerHandler(
        "workers",
        ShutdownPriority.Workers,
        async (): Promise<void> => {
          throw new Error("queue consumer was already closed");
        },
      );
      GracefulShutdown.registerHandler(
        "postgres",
        ShutdownPriority.DataStores,
        (): void => {
          drained.push("postgres");
        },
      );
      GracefulShutdown.registerHandler(
        "telemetry",
        ShutdownPriority.Telemetry,
        (): void => {
          drained.push("telemetry");
        },
      );

      await expect(
        GracefulShutdown.shutdown("SIGTERM"),
      ).resolves.toBeUndefined();

      expect(drained).toEqual(["postgres", "telemetry"]);
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    test("a handler that throws synchronously is contained the same way", async () => {
      const drained: Array<string> = [];

      GracefulShutdown.registerHandler(
        "buffers",
        ShutdownPriority.Buffers,
        (): void => {
          throw new Error("flush target unreachable");
        },
      );
      GracefulShutdown.registerHandler(
        "postgres",
        ShutdownPriority.DataStores,
        (): void => {
          drained.push("postgres");
        },
      );

      await GracefulShutdown.shutdown("SIGTERM");

      expect(drained).toEqual(["postgres"]);
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    test("a handler that never settles is abandoned at the per-handler timeout and the rest still drain", async () => {
      resetCoordinator({ perHandlerTimeoutMs: 20 });

      const drained: Array<string> = [];

      GracefulShutdown.registerHandler(
        "wedged",
        ShutdownPriority.Workers,
        (): Promise<void> => {
          // Models a queue consumer waiting on a socket that will never answer.
          return new Promise<void>(() => {});
        },
      );
      GracefulShutdown.registerHandler(
        "postgres",
        ShutdownPriority.DataStores,
        (): void => {
          drained.push("postgres");
        },
      );

      await GracefulShutdown.shutdown("SIGTERM");

      expect(drained).toEqual(["postgres"]);
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    test("shutting down with nothing registered still exits cleanly", async () => {
      await GracefulShutdown.shutdown("SIGTERM");

      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });

  describe("exit codes", () => {
    test("a clean drain exits 0", async () => {
      GracefulShutdown.registerHandler(
        "http",
        ShutdownPriority.HttpServer,
        (): void => {},
      );

      await GracefulShutdown.shutdown("SIGTERM");

      expect(exitSpy).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    test("a second signal mid-drain force-exits 1 without waiting for the first drain", async () => {
      const http: Deferred = deferred();

      const httpHandler: ReturnType<typeof jest.fn> = jest.fn();

      GracefulShutdown.registerHandler(
        "http",
        ShutdownPriority.HttpServer,
        async (): Promise<void> => {
          httpHandler();
          await http.promise;
        },
      );

      const first: Promise<void> = GracefulShutdown.shutdown("SIGTERM");
      await Promise.resolve();

      // The operator hit Ctrl-C again, or the orchestrator escalated.
      await GracefulShutdown.shutdown("SIGINT");

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(httpHandler).toHaveBeenCalledTimes(1);

      http.release();
      await first;
    });

    test("the overall deadline force-exits 1 even though a handler is still running", async () => {
      resetCoordinator({ perHandlerTimeoutMs: 5_000, overallTimeoutMs: 20 });

      const http: Deferred = deferred();

      GracefulShutdown.registerHandler(
        "http",
        ShutdownPriority.HttpServer,
        (): Promise<void> => {
          return http.promise;
        },
      );

      const shuttingDown: Promise<void> = GracefulShutdown.shutdown("SIGTERM");

      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 60);
      });

      expect(exitSpy).toHaveBeenCalledWith(1);

      http.release();
      await shuttingDown;
    });
  });

  describe("ShutdownPriority", () => {
    test("the tiers are ordered so work stops before the resources that work depends on", () => {
      /*
       * The numbers themselves are load-bearing -- shutdown() sorts on them.
       * Pin the relative order so a renumbering has to be deliberate.
       */
      expect(ShutdownPriority.HttpServer).toBeLessThan(
        ShutdownPriority.Workers,
      );
      expect(ShutdownPriority.Workers).toBeLessThan(ShutdownPriority.Buffers);
      expect(ShutdownPriority.Buffers).toBeLessThan(
        ShutdownPriority.DataStores,
      );
      expect(ShutdownPriority.DataStores).toBeLessThan(
        ShutdownPriority.Telemetry,
      );
    });
  });
});
