import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { DataSource, EntityManager } from "typeorm";
import QueueJobConnections from "../../../../Server/Infrastructure/Postgres/QueueJobConnections";
import {
  ConnectionShares,
  computeConnectionShares,
} from "../../../../Server/Utils/Database/ConnectionShares";
import {
  ProbeSchedulingBusyError,
  ProbeSchedulingLimiter,
  probeSchedulingLimits,
} from "../../../../Server/Utils/Probe/ProbeSchedulingLimiter";

/*
 * A sign-in still gets a connection while queue jobs and probe scheduling
 * saturate the database (issue #7920), on a real Postgres.
 *
 * A customer saw every App pod's 50 connections busy and 89 of 100 sessions
 * waiting, and sign-ins, Network Overview and on-call policies time out: up
 * to 200 queue jobs and every probe worker's scheduling requests asked the
 * same first-come pool as a person signing in, so when the database slowed
 * down a sign-in waited behind all of them until the acquire timeout ran
 * out.
 *
 * Here a pool of 10 serves 60 queue jobs and 20 probe workers that each run
 * a slow statement (pg_sleep) back to back, as fast as they are let: far
 * more than the pool can serve, as in that report. With the shares the
 * process runs with in production - queue jobs at most 6 connections
 * (QueueJobConnections), probe scheduling at most 2 requests at once
 * (ProbeSchedulingLimiter), the rest kept for requests - every sign-in's
 * statement gets a connection and its answer well within SIGN_IN_BOUND_MS.
 * Without them, the same load makes the same sign-in wait behind all the
 * background work in the pool's queue, up to the pool's acquire timeout:
 * the failure the shares exist to stop, shown so this test can tell the
 * two apart. (Measured on a laptop: 1-87 ms a sign-in with the shares,
 * about 1.6 s without.)
 *
 * And because the checkout it counts is TypeORM's own, a queue job's
 * transaction holds one slot for exactly as long as it holds its
 * connection: committed, rolled back by the job or failed on the database,
 * it gives the slot back.
 *
 * Needs only a bare Postgres - CI's Common test job sets the flag for the
 * one test-setup.sh starts. It creates nothing. Locally:
 *
 *   RUN_POSTGRES_CONNECTION_SHARE_TESTS=true \
 *   CONNECTION_SHARE_TEST_DATABASE_HOST=127.0.0.1 \
 *   CONNECTION_SHARE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... \
 *     npx jest Tests/Server/Infrastructure/Postgres/ConnectionSharesUnderLoadPostgres.test.ts
 */

const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_CONNECTION_SHARE_TESTS"] === "true"
    ? describe
    : describe.skip;

const POOL_SIZE: number = 10;
const ACQUIRE_TIMEOUT_MS: number = 2000;
const QUEUE_JOBS: number = 60;
const PROBE_WORKERS: number = 20;
// One statement of background work, held on its connection.
const BACKGROUND_STATEMENT: string = "SELECT pg_sleep(0.5)";
// How long a sign-in's statement may take, connection included.
const SIGN_IN_BOUND_MS: number = 1000;
const SIGN_INS: number = 10;

function openPool(): Promise<DataSource> {
  return new DataSource({
    type: "postgres",
    host:
      process.env["CONNECTION_SHARE_TEST_DATABASE_HOST"] ||
      process.env["DATABASE_HOST"] ||
      "localhost",
    port: Number(
      process.env["CONNECTION_SHARE_TEST_DATABASE_PORT"] ||
        process.env["DATABASE_PORT"] ||
        "5400",
    ),
    username: process.env["DATABASE_USERNAME"] || "postgres",
    password: process.env["DATABASE_PASSWORD"] || "password",
    database:
      process.env["CONNECTION_SHARE_TEST_DATABASE_NAME"] ||
      process.env["DATABASE_NAME"] ||
      "oneuptimedb",
    applicationName: "oneuptime-connection-share-test",
    extra: {
      max: POOL_SIZE,
      connectionTimeoutMillis: ACQUIRE_TIMEOUT_MS,
    },
  }).initialize();
}

function pause(ms: number): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, ms);
  });
}

async function eventually(condition: () => boolean): Promise<void> {
  const deadline: number = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("The condition did not come true within 10 s.");
    }
    await pause(10);
  }
}

// A promise the test settles, and the function that settles it.
function gate(): { opened: Promise<void>; open: () => void } {
  let open: () => void = (): void => {
    return undefined;
  };
  const opened: Promise<void> = new Promise<void>((resolve: () => void) => {
    open = resolve;
  });
  return { opened, open };
}

interface BackgroundLoad {
  stop: () => Promise<void>;
  statementsRun: () => number;
}

/*
 * QUEUE_JOBS queue jobs and PROBE_WORKERS probe workers running the
 * background statement back to back until stopped. With `limits`, they run
 * as production runs them: the jobs inside QueueWorker's queue-job scope,
 * the probe workers' requests under the probe scheduling limit (a refused
 * request waits for its next tick, here a moment). Without, both go
 * straight to the pool, as they did before.
 */
function startBackgroundLoad(
  dataSource: DataSource,
  limiter: ProbeSchedulingLimiter | null,
): BackgroundLoad {
  let running: boolean = true;
  let statementsRun: number = 0;

  const statement: () => Promise<void> = async (): Promise<void> => {
    try {
      await dataSource.query(BACKGROUND_STATEMENT);
      statementsRun++;
    } catch {
      // A checkout that ran out of time: the job fails and is retried.
      await pause(10);
    }
  };

  const queueJob: () => Promise<void> = async (): Promise<void> => {
    while (running) {
      if (limiter) {
        await QueueJobConnections.runAsQueueJob("telemetry", statement);
      } else {
        await statement();
      }
    }
  };

  const probeWorker: (probe: number) => Promise<void> = async (
    probe: number,
  ): Promise<void> => {
    while (running) {
      if (!limiter) {
        await statement();
        continue;
      }
      try {
        await limiter.run(`probe-${probe % 4}`, statement);
      } catch (error) {
        if (!(error instanceof ProbeSchedulingBusyError)) {
          throw error;
        }
        // Answered busy: the probe asks again at its next tick.
        await pause(50);
      }
    }
  };

  const loops: Array<Promise<void>> = [
    ...Array.from({ length: QUEUE_JOBS }, (): Promise<void> => {
      return queueJob();
    }),
    ...Array.from(
      { length: PROBE_WORKERS },
      (_value: unknown, index: number): Promise<void> => {
        return probeWorker(index);
      },
    ),
  ];

  return {
    stop: async (): Promise<void> => {
      running = false;
      await Promise.allSettled(loops);
    },
    statementsRun: (): number => {
      return statementsRun;
    },
  };
}

interface SignIn {
  elapsedMs: number;
  error: Error | null;
}

// A plain dashboard read, outside every queue job and probe request.
async function signIn(dataSource: DataSource): Promise<SignIn> {
  const startedAt: number = Date.now();
  try {
    await dataSource.query("SELECT 1");
    return { elapsedMs: Date.now() - startedAt, error: null };
  } catch (error) {
    return { elapsedMs: Date.now() - startedAt, error: error as Error };
  }
}

describePostgres(
  "a sign-in while queue jobs and probe scheduling saturate the database",
  () => {
    jest.setTimeout(120_000);

    let dataSource: DataSource | null = null;
    let load: BackgroundLoad | null = null;

    afterEach(async () => {
      await load?.stop();
      load = null;
      if (dataSource) {
        QueueJobConnections.uninstall(dataSource);
        await dataSource.destroy();
        dataSource = null;
      }
    });

    test("with the shares, every sign-in gets a connection within the bound", async () => {
      const shares: ConnectionShares = computeConnectionShares({
        poolSize: POOL_SIZE,
        receivesIngressTraffic: true,
      });
      expect(shares).toMatchObject({
        probeSchedulingMaxConcurrentRequests: 2,
        maxQueueJobConnections: 6,
        connectionsKeptForRequests: 2,
      });

      dataSource = await openPool();
      const jobConnections: ReturnType<typeof QueueJobConnections.install> =
        QueueJobConnections.install(dataSource, {
          maxConnections: shares.maxQueueJobConnections,
          maxWaitMs: ACQUIRE_TIMEOUT_MS,
        });
      const probeScheduling: ProbeSchedulingLimiter =
        new ProbeSchedulingLimiter(
          probeSchedulingLimits(shares.probeSchedulingMaxConcurrentRequests),
        );

      load = startBackgroundLoad(dataSource, probeScheduling);
      await pause(1500);

      // Saturated: both kinds of work at their limits, with more waiting.
      expect(jobConnections.runningCount()).toBe(6);
      expect(jobConnections.waitingCount()).toBeGreaterThan(0);
      expect(probeScheduling.runningCount()).toBe(2);

      const signIns: Array<SignIn> = [];
      for (let index: number = 0; index < SIGN_INS; index++) {
        signIns.push(await signIn(dataSource));
        await pause(100);
      }

      const statementsBefore: number = load.statementsRun();
      await pause(600);
      // The background work kept running the whole time.
      expect(load.statementsRun()).toBeGreaterThan(statementsBefore);

      expect(
        signIns.filter((attempt: SignIn): boolean => {
          return attempt.error !== null;
        }),
      ).toEqual([]);
      const slowest: number = Math.max(
        ...signIns.map((attempt: SignIn): number => {
          return attempt.elapsedMs;
        }),
      );
      expect(slowest).toBeLessThan(SIGN_IN_BOUND_MS);
    });

    /*
     * The checkout counted is TypeORM's, so a job's transaction - one query
     * runner, one connection, from START TRANSACTION to COMMIT or ROLLBACK -
     * holds one slot for as long as it holds the connection, and gives it
     * back however it ends.
     */
    test("a queue job's transaction holds one slot from its start to its end, and gives it back however it ends", async () => {
      dataSource = await openPool();
      const source: DataSource = dataSource;
      const jobConnections: ReturnType<typeof QueueJobConnections.install> =
        QueueJobConnections.install(source, {
          maxConnections: 2,
          maxWaitMs: ACQUIRE_TIMEOUT_MS,
        });

      // Committed.
      await QueueJobConnections.runAsQueueJob(
        "worker",
        async (): Promise<void> => {
          await source.transaction(
            async (manager: EntityManager): Promise<void> => {
              expect(jobConnections.runningCount("worker")).toBe(1);
              await manager.query("SELECT 1");
              await manager.query("SELECT pg_sleep(0.05)");
              expect(jobConnections.runningCount("worker")).toBe(1);
            },
          );
        },
      );
      expect(jobConnections.runningCount()).toBe(0);

      // Rolled back by the job.
      await expect(
        QueueJobConnections.runAsQueueJob("worker", async (): Promise<void> => {
          await source.transaction(
            async (manager: EntityManager): Promise<void> => {
              await manager.query("SELECT 1");
              throw new Error("the job changed its mind");
            },
          );
        }),
      ).rejects.toThrow("the job changed its mind");
      expect(jobConnections.runningCount()).toBe(0);

      // Failed on the database.
      await expect(
        QueueJobConnections.runAsQueueJob("worker", async (): Promise<void> => {
          await source.transaction(
            async (manager: EntityManager): Promise<void> => {
              await manager.query(
                "SELECT * FROM connection_share_test_no_such_table",
              );
            },
          );
        }),
      ).rejects.toThrow();
      expect(jobConnections.runningCount()).toBe(0);

      /*
       * Two open transactions hold both slots: another job's statement waits
       * for one of them to end, and a request's does not wait at all.
       */
      const first: { opened: Promise<void>; open: () => void } = gate();
      const second: { opened: Promise<void>; open: () => void } = gate();
      const transaction: (hold: Promise<void>) => Promise<void> = (
        hold: Promise<void>,
      ): Promise<void> => {
        return QueueJobConnections.runAsQueueJob(
          "telemetry",
          async (): Promise<void> => {
            await source.transaction(
              async (manager: EntityManager): Promise<void> => {
                await manager.query("SELECT 1");
                await hold;
              },
            );
          },
        );
      };
      const firstTransaction: Promise<void> = transaction(first.opened);
      const secondTransaction: Promise<void> = transaction(second.opened);
      await eventually((): boolean => {
        return jobConnections.runningCount() === 2;
      });

      let anotherJobDone: boolean = false;
      const anotherJob: Promise<void> = QueueJobConnections.runAsQueueJob(
        "worker",
        async (): Promise<void> => {
          await source.query("SELECT 1");
          anotherJobDone = true;
        },
      );
      await pause(300);
      expect(anotherJobDone).toBe(false);
      expect(jobConnections.waitingCount()).toBe(1);

      const request: SignIn = await signIn(source);
      expect(request.error).toBeNull();
      expect(request.elapsedMs).toBeLessThan(SIGN_IN_BOUND_MS);

      first.open();
      await firstTransaction;
      await anotherJob;
      expect(anotherJobDone).toBe(true);

      second.open();
      await secondTransaction;
      expect(jobConnections.runningCount()).toBe(0);
      expect(jobConnections.waitingCount()).toBe(0);
    });

    test("without them, the same sign-in waits behind the background work, up to the acquire timeout", async () => {
      dataSource = await openPool();
      load = startBackgroundLoad(dataSource, null);
      await pause(1500);

      const attempt: SignIn = await signIn(dataSource);

      /*
       * 80 workers on 10 connections, half a second a statement: a sign-in
       * joins the back of the pool's queue and waits behind all of them -
       * here about 1.6 s, the queue held just short of the 2 s acquire
       * timeout by the background checkouts that run out of it first; past
       * it, as the customer's sign-ins did, it fails.
       */
      if (attempt.error) {
        expect(attempt.error.message).toContain(
          "timeout exceeded when trying to connect",
        );
      }
      expect(attempt.elapsedMs).toBeGreaterThanOrEqual(SIGN_IN_BOUND_MS);
    });
  },
);
