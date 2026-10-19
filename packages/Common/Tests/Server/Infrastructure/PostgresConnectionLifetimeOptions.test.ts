import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { EventEmitter } from "events";
import { Pool, PoolClient } from "pg";
import timers from "timers";

/*
 * Postgres connections are replaced once they reach a maximum lifetime.
 *
 * Without one, the connections a busy process opens at boot stay open for as
 * long as the process lives. The Kubernetes agent's eBPF instrumentation ties
 * a Node.js query to the request that ran it through the socket the query
 * goes out on, and it learns a socket only when it sees it opened. A pool
 * opened before the agent attached - a pod started while the agent was still
 * working through a rollout, or every pod when the agent restarts - is never
 * tied to a request: on the test cluster 99.3% of the app's Postgres spans sat
 * under whichever request had most recently begun (a telemetry ingest request,
 * nearly always), and the probe's requests showed no queries of their own.
 *
 * This suite pins the option the pool is built with - on by default,
 * configurable, 0 to turn it off - and, against the node-postgres pool the app
 * runs, what it does with it: a connection past its lifetime is replaced, and
 * one a query or transaction still holds is not cut.
 *
 * The module reads env at import time, so each case re-imports it in isolation
 * (once per lifetime: loading the options loads every entity).
 *
 * Common's jest environment is jsdom, whose setTimeout returns a bare number
 * with no unref(), and pg-pool unrefs its lifetime timer; the pool tests swap
 * in the real Node timers for their duration, as GracefulShutdown.test.ts does.
 */

interface DataSourceExtra {
  maxLifetimeSeconds?: number;
  idleTimeoutMillis?: number;
}

/* Runs `load` on fresh module instances, with `env` set for its duration. */
function withEnv(
  env: Record<string, string | undefined>,
  load: () => void,
): void {
  jest.isolateModules(() => {
    const previous: Record<string, string | undefined> = {};

    for (const [key, value] of Object.entries(env)) {
      previous[key] = process.env[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    try {
      load();
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
}

const loadedExtras: Map<string, DataSourceExtra> = new Map<
  string,
  DataSourceExtra
>();

function loadExtra(lifetimeInMs: string | undefined): DataSourceExtra {
  const cacheKey: string = lifetimeInMs ?? "(unset)";
  const cached: DataSourceExtra | undefined = loadedExtras.get(cacheKey);

  if (cached) {
    return cached;
  }

  let extra: DataSourceExtra = {};

  withEnv(
    {
      RUN_DATABASE_MIGRATIONS_ON_BOOT: "false",
      DATABASE_CONNECTION_MAX_LIFETIME_MS: lifetimeInMs,
    },
    () => {
      /* eslint-disable @typescript-eslint/no-var-requires */
      const options: {
        default: { extra: DataSourceExtra };
        // eslint-disable-next-line @typescript-eslint/no-require-imports
      } = require("../../../Server/Infrastructure/Postgres/DataSourceOptions");
      /* eslint-enable @typescript-eslint/no-var-requires */

      extra = options.default.extra;
    },
  );

  loadedExtras.set(cacheKey, extra);

  return extra;
}

/*
 * A connection the pool opens, connected at once and closed on request; it
 * records whether the pool closed it.
 */
class StubConnection extends EventEmitter {
  public static opened: Array<StubConnection> = [];

  public _queryable: boolean = true;
  public _ending: boolean = false;
  public closed: boolean = false;

  public constructor() {
    super();
    StubConnection.opened.push(this);
  }

  public connect(callback: (error?: Error) => void): void {
    setTimeout(() => {
      callback();
    }, 0);
  }

  public end(callback?: () => void): void {
    this._queryable = false;
    this._ending = true;
    this.closed = true;

    setTimeout(() => {
      this.emit("end");
      if (callback) {
        callback();
      }
    }, 0);
  }
}

// The pool the app builds from these options, over stub connections.
function poolFrom(extra: DataSourceExtra): Pool {
  StubConnection.opened = [];

  return new Pool({ ...extra, Client: StubConnection } as never);
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, ms);
  });
}

async function eventually(condition: () => boolean): Promise<void> {
  const deadline: number = Date.now() + 5000;

  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("condition was not met in time");
    }

    await sleep(10);
  }
}

describe("Postgres connection lifetime", () => {
  describe("the pool option", () => {
    test("replaces connections after 10 minutes by default", () => {
      expect(loadExtra(undefined).maxLifetimeSeconds).toBe(600);
    });

    test("is configurable, in milliseconds like the pool's other settings", () => {
      expect(loadExtra("120000").maxLifetimeSeconds).toBe(120);
    });

    test("0 keeps connections for as long as they stay healthy", () => {
      expect(loadExtra("0").maxLifetimeSeconds).toBeUndefined();
    });

    /*
     * The idle timeout already closes a connection nobody uses; the lifetime
     * is for the ones in steady use, which the idle timeout never reaches.
     */
    test("outlives the idle timeout, so it only ever replaces connections in use", () => {
      const extra: DataSourceExtra = loadExtra(undefined);

      expect(extra.maxLifetimeSeconds! * 1000).toBeGreaterThan(
        extra.idleTimeoutMillis!,
      );
    });
  });

  describe("the pool built with it", () => {
    let jsdomSetTimeout: typeof globalThis.setTimeout;
    let jsdomClearTimeout: typeof globalThis.clearTimeout;

    beforeEach(() => {
      jsdomSetTimeout = globalThis.setTimeout;
      jsdomClearTimeout = globalThis.clearTimeout;
      globalThis.setTimeout = timers.setTimeout as typeof globalThis.setTimeout;
      globalThis.clearTimeout =
        timers.clearTimeout as typeof globalThis.clearTimeout;
    });

    afterEach(() => {
      globalThis.setTimeout = jsdomSetTimeout;
      globalThis.clearTimeout = jsdomClearTimeout;
    });

    // A lifetime short enough to watch run out.
    const SHORT_LIFETIME_IN_MS: string = "200";

    test("replaces a connection once it is past its lifetime", async () => {
      const pool: Pool = poolFrom(loadExtra(SHORT_LIFETIME_IN_MS));

      try {
        const first: PoolClient = await pool.connect();
        first.release();
        expect(pool.idleCount).toBe(1);

        await eventually(() => {
          return StubConnection.opened[0]!.closed;
        });
        await eventually(() => {
          return pool.totalCount === 0;
        });

        const second: PoolClient = await pool.connect();
        second.release();

        // A new connection, opened now: one the agent sees being opened.
        expect(StubConnection.opened).toHaveLength(2);
        expect(StubConnection.opened[1]!.closed).toBe(false);
      } finally {
        await pool.end();
      }
    });

    test("never closes a connection while a query or transaction holds it", async () => {
      const pool: Pool = poolFrom(loadExtra(SHORT_LIFETIME_IN_MS));

      try {
        const held: PoolClient = await pool.connect();

        await sleep(400);
        expect(StubConnection.opened[0]!.closed).toBe(false);

        // Given back past its lifetime, it is closed instead of reused.
        held.release();
        await eventually(() => {
          return StubConnection.opened[0]!.closed;
        });
        await eventually(() => {
          return pool.totalCount === 0;
        });
      } finally {
        await pool.end();
      }
    });

    test("keeps a connection past that time when the lifetime is 0", async () => {
      const pool: Pool = poolFrom(loadExtra("0"));

      try {
        const first: PoolClient = await pool.connect();
        first.release();

        await sleep(400);

        expect(StubConnection.opened).toHaveLength(1);
        expect(StubConnection.opened[0]!.closed).toBe(false);
        expect(pool.idleCount).toBe(1);
      } finally {
        await pool.end();
      }
    });
  });
});
