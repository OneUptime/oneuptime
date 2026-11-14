import QueueJobConnections, {
  QueueJobConnectionTimeoutError,
} from "../../../../Server/Infrastructure/Postgres/QueueJobConnections";
import KeyedConcurrencyLimiter from "../../../../Server/Utils/KeyedConcurrencyLimiter";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * The cap on the Postgres connections queue jobs borrow (#7920), on a
 * stand-in for TypeORM's PostgresDriver: its obtainMasterConnection hands
 * out a connection and the function that gives it back, as pg-pool's
 * connect() callback does. What these pin:
 *
 *   - work outside every queue job is never counted and never waits, even
 *     while the jobs hold every connection they may: a request's checkout
 *     goes straight to the pool;
 *   - jobs hold at most the cap; one more waits WITHOUT asking the pool, and
 *     gets its turn, in arrival order, when a job gives a connection back;
 *   - a job that waits past the pool's acquire timeout fails as a checkout
 *     from a full pool does, and the pool is never asked;
 *   - a slot is given back exactly once, when the connection is, and when
 *     the pool fails the checkout.
 */

interface FakeConnection {
  id: number;
}

class FakePostgresDriver {
  public checkouts: number = 0;
  public released: Array<{ id: number; error: unknown }> = [];
  public failNext: Error | null = null;
  private nextId: number = 1;

  public async obtainMasterConnection(): Promise<
    [FakeConnection, (error?: unknown) => void]
  > {
    if (this.failNext) {
      const failure: Error = this.failNext;
      this.failNext = null;
      throw failure;
    }
    this.checkouts++;
    const connection: FakeConnection = { id: this.nextId++ };
    return [
      connection,
      (error?: unknown): void => {
        this.released.push({ id: connection.id, error });
      },
    ];
  }
}

type Checkout = [FakeConnection, (error?: unknown) => void];

function dataSourceWith(driver: FakePostgresDriver): DataSource {
  return { driver } as unknown as DataSource;
}

function checkOut(driver: FakePostgresDriver): Promise<Checkout> {
  return driver.obtainMasterConnection();
}

// Lets queued promise callbacks run, on the real or Jest's fake clock.
async function settle(): Promise<void> {
  for (let round: number = 0; round < 5; round++) {
    await new Promise<void>((resolve: () => void): void => {
      process.nextTick(resolve);
    });
  }
}

describe("QueueJobConnections", () => {
  let driver: FakePostgresDriver;
  let dataSource: DataSource;

  beforeEach(() => {
    driver = new FakePostgresDriver();
    dataSource = dataSourceWith(driver);
  });

  afterEach(() => {
    QueueJobConnections.uninstall(dataSource);
    jest.useRealTimers();
  });

  test("tells a queue job's work from everything else, through its awaits and the promises it starts", async () => {
    expect(QueueJobConnections.currentQueue()).toBeUndefined();

    const seen: Array<string | undefined> =
      await QueueJobConnections.runAsQueueJob(
        "telemetry",
        async (): Promise<Array<string | undefined>> => {
          const before: string | undefined = QueueJobConnections.currentQueue();
          await settle();
          const started: Promise<string | undefined> = new Promise<
            string | undefined
          >((resolve: (queue: string | undefined) => void): void => {
            setTimeout((): void => {
              resolve(QueueJobConnections.currentQueue());
            }, 0);
          });
          return [before, QueueJobConnections.currentQueue(), await started];
        },
      );

    expect(seen).toEqual(["telemetry", "telemetry", "telemetry"]);
    expect(QueueJobConnections.currentQueue()).toBeUndefined();
  });

  test("work outside every queue job is never counted and never waits, even while jobs hold every connection they may", async () => {
    const limiter: KeyedConcurrencyLimiter = QueueJobConnections.install(
      dataSource,
      { maxConnections: 1, maxWaitMs: 60_000 },
    );

    const held: Checkout = await QueueJobConnections.runAsQueueJob(
      "worker",
      () => {
        return checkOut(driver);
      },
    );
    expect(limiter.runningCount()).toBe(1);

    // A request: straight to the pool, not counted.
    const request: Checkout = await checkOut(driver);
    expect(driver.checkouts).toBe(2);
    expect(limiter.runningCount()).toBe(1);
    expect(limiter.waitingCount()).toBe(0);

    request[1]();
    held[1]();
    expect(limiter.runningCount()).toBe(0);
    expect(
      driver.released.map((release: { id: number }) => {
        return release.id;
      }),
    ).toEqual([2, 1]);
  });

  test("jobs hold at most the cap; one more waits without asking the pool, and gets the next connection given back", async () => {
    const limiter: KeyedConcurrencyLimiter = QueueJobConnections.install(
      dataSource,
      { maxConnections: 2, maxWaitMs: 60_000 },
    );

    const first: Checkout = await QueueJobConnections.runAsQueueJob(
      "telemetry",
      () => {
        return checkOut(driver);
      },
    );
    const second: Checkout = await QueueJobConnections.runAsQueueJob(
      "worker",
      () => {
        return checkOut(driver);
      },
    );
    expect(limiter.runningCount("telemetry")).toBe(1);
    expect(limiter.runningCount("worker")).toBe(1);

    let thirdCheckout: Checkout | null = null;
    const third: Promise<Checkout> = QueueJobConnections.runAsQueueJob(
      "telemetry",
      () => {
        return checkOut(driver);
      },
    );
    void third.then((checkout: Checkout): void => {
      thirdCheckout = checkout;
    });
    await settle();

    // Waiting here, holding nothing: the pool was not asked.
    expect(thirdCheckout).toBeNull();
    expect(driver.checkouts).toBe(2);
    expect(limiter.waitingCount("telemetry")).toBe(1);

    second[1]();
    await settle();
    expect(thirdCheckout).not.toBeNull();
    expect(driver.checkouts).toBe(3);
    expect(limiter.runningCount()).toBe(2);
    expect(limiter.runningCount("telemetry")).toBe(2);

    first[1]();
    (await third)[1]();
    expect(limiter.runningCount()).toBe(0);
  });

  test("a job that waits past the pool's acquire timeout fails as a checkout from a full pool does, and the pool is never asked", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick"] });
    QueueJobConnections.install(dataSource, {
      maxConnections: 1,
      maxWaitMs: 5_000,
    });

    const held: Checkout = await QueueJobConnections.runAsQueueJob(
      "telemetry",
      () => {
        return checkOut(driver);
      },
    );
    const waiting: Promise<Checkout> = QueueJobConnections.runAsQueueJob(
      "telemetry",
      () => {
        return checkOut(driver);
      },
    );
    const outcome: Promise<unknown> = waiting.then(
      (): null => {
        return null;
      },
      (error: unknown): unknown => {
        return error;
      },
    );
    await settle();

    jest.advanceTimersByTime(5_000);
    const error: unknown = await outcome;
    expect(error).toBeInstanceOf(QueueJobConnectionTimeoutError);
    expect((error as Error).message).toContain(
      "timeout exceeded when trying to connect",
    );
    expect((error as Error).message).toContain(
      "DATABASE_MAX_QUEUE_JOB_CONNECTIONS",
    );
    expect(driver.checkouts).toBe(1);

    held[1]();
  });

  test("a connection given back twice gives back one slot, and hands its error to the pool", async () => {
    const limiter: KeyedConcurrencyLimiter = QueueJobConnections.install(
      dataSource,
      { maxConnections: 1, maxWaitMs: 60_000 },
    );

    const [, release] = await QueueJobConnections.runAsQueueJob(
      "worker",
      () => {
        return checkOut(driver);
      },
    );
    const broken: Error = new Error("connection terminated");
    release(broken);
    release(broken);
    expect(limiter.runningCount()).toBe(0);
    expect(driver.released[0]).toEqual({ id: 1, error: broken });

    // The one slot is free once, not twice: one job takes it, the next waits.
    const next: Checkout = await QueueJobConnections.runAsQueueJob(
      "worker",
      () => {
        return checkOut(driver);
      },
    );
    let afterGranted: boolean = false;
    const after: Promise<Checkout> = QueueJobConnections.runAsQueueJob(
      "worker",
      () => {
        return checkOut(driver);
      },
    );
    void after.then((): void => {
      afterGranted = true;
    });
    await settle();
    expect(limiter.runningCount()).toBe(1);
    expect(afterGranted).toBe(false);

    next[1]();
    (await after)[1]();
    expect(limiter.runningCount()).toBe(0);
  });

  test("a checkout the pool fails gives its slot back", async () => {
    const limiter: KeyedConcurrencyLimiter = QueueJobConnections.install(
      dataSource,
      { maxConnections: 1, maxWaitMs: 60_000 },
    );
    driver.failNext = new Error("timeout exceeded when trying to connect");

    await expect(
      QueueJobConnections.runAsQueueJob("worker", () => {
        return checkOut(driver);
      }),
    ).rejects.toThrow("timeout exceeded when trying to connect");
    expect(limiter.runningCount()).toBe(0);

    const next: Checkout = await QueueJobConnections.runAsQueueJob(
      "worker",
      () => {
        return checkOut(driver);
      },
    );
    expect(limiter.runningCount()).toBe(1);
    next[1]();
  });

  test("installs once per pool, and uninstall puts the driver's own checkout back", async () => {
    const original: FakePostgresDriver["obtainMasterConnection"] =
      FakePostgresDriver.prototype.obtainMasterConnection;
    expect(QueueJobConnections.limiterOf(dataSource)).toBeUndefined();

    const first: KeyedConcurrencyLimiter = QueueJobConnections.install(
      dataSource,
      { maxConnections: 1, maxWaitMs: 1 },
    );
    const second: KeyedConcurrencyLimiter = QueueJobConnections.install(
      dataSource,
      { maxConnections: 5, maxWaitMs: 1 },
    );
    expect(second).toBe(first);
    expect(first.limits.maxRunning).toBe(1);
    expect(QueueJobConnections.limiterOf(dataSource)).toBe(first);
    expect(driver.obtainMasterConnection).not.toBe(original);

    QueueJobConnections.uninstall(dataSource);
    expect(driver.obtainMasterConnection).toBe(original);
    expect(
      Object.prototype.hasOwnProperty.call(driver, "obtainMasterConnection"),
    ).toBe(false);
    expect(QueueJobConnections.limiterOf(dataSource)).toBeUndefined();

    // Another pool is capped on its own.
    const other: FakePostgresDriver = new FakePostgresDriver();
    const otherSource: DataSource = dataSourceWith(other);
    expect(
      QueueJobConnections.install(otherSource, {
        maxConnections: 3,
        maxWaitMs: 1,
      }),
    ).not.toBe(first);
    QueueJobConnections.uninstall(otherSource);
  });

  describe("limitsFor", () => {
    test("caps the jobs of a process that runs queue workers, at its share, waiting as long as a checkout does", () => {
      expect(
        QueueJobConnections.limitsFor({
          runsQueueWorkers: true,
          poolSize: 50,
          maxQueueJobConnections: 30,
          acquireTimeoutMs: 5000,
        }),
      ).toEqual({ maxConnections: 30, maxWaitMs: 5000 });
    });

    test("no cap where no queue workers run, or where the share is the whole pool", () => {
      expect(
        QueueJobConnections.limitsFor({
          runsQueueWorkers: false,
          poolSize: 50,
          maxQueueJobConnections: 30,
          acquireTimeoutMs: 5000,
        }),
      ).toBeNull();
      expect(
        QueueJobConnections.limitsFor({
          runsQueueWorkers: true,
          poolSize: 50,
          maxQueueJobConnections: 50,
          acquireTimeoutMs: 5000,
        }),
      ).toBeNull();
    });
  });
});
