import KeyedConcurrencyLimiter, {
  KeyedConcurrencyRelease,
} from "../../Utils/KeyedConcurrencyLimiter";
import { AsyncLocalStorage } from "async_hooks";
import { DataSource } from "typeorm";

/*
 * THE POSTGRES CONNECTIONS QUEUE JOBS BORROW (issue #7920).
 *
 * A process that serves requests and also runs the queue workers - every
 * App pod while the Helm chart's worker.enabled is false, the default - has
 * one pool for both, handed out first come, first served. Up to
 * TELEMETRY_CONCURRENCY plus WORKER_CONCURRENCY jobs (200 by default) ask it
 * for connections, and when the database slows down their queries fill the
 * pool and queue ahead of every request: a sign-in waits behind them until
 * DATABASE_CONNECTION_TIMEOUT_MS runs out.
 *
 * So the connections queue jobs hold are counted, and capped at
 * DATABASE_MAX_QUEUE_JOB_CONNECTIONS (Utils/Database/ConnectionShares). A
 * job that wants one more while jobs hold them all waits here, in arrival
 * order, WITHOUT a connection and without a place in the pool's own queue,
 * so a request's checkout never queues behind it. A job holds its slot from
 * the moment it asks the pool until it gives the connection back, so jobs
 * waiting in the pool's queue count too. One that waits longer than the
 * pool's own acquire timeout fails as a checkout from a full pool does
 * ("timeout exceeded when trying to connect"): its job fails and BullMQ
 * retries it. A request never waits here: only work run inside
 * runAsQueueJob counts, and QueueWorker runs every job's handler there.
 *
 * It wraps the data source's driver - TypeORM's PostgresDriver - at
 * obtainMasterConnection, the one checkout every query runner makes (a
 * repository call, a query builder, dataSource.query(), a transaction),
 * and the connection's release, which every query runner calls once.
 */

const queueOfCurrentJob: AsyncLocalStorage<string> =
  new AsyncLocalStorage<string>();

/*
 * A queue job waited longer than the pool's own acquire timeout for a
 * connection while the queue jobs of this process held every one they may.
 * Worded as pg-pool's own acquire timeout, which is what it stands in for.
 */
export class QueueJobConnectionTimeoutError extends Error {
  public constructor(maxConnections: number) {
    super(
      `timeout exceeded when trying to connect: the queue jobs of this process already hold the ${maxConnections} Postgres connections they may (DATABASE_MAX_QUEUE_JOB_CONNECTIONS)`,
    );
    this.name = "QueueJobConnectionTimeoutError";
  }
}

// A Postgres connection and the function that gives it back to the pool.
type ConnectionCheckout = [unknown, (error?: unknown) => unknown];

type ObtainConnection = (this: unknown) => Promise<ConnectionCheckout>;

// TypeORM's PostgresDriver, or a stand-in with its checkout.
interface PostgresDriverLike {
  obtainMasterConnection: ObtainConnection;
}

export interface QueueJobConnectionLimits {
  // Connections the queue jobs of this process hold at once.
  maxConnections: number;
  // Longest a job waits for one: the pool's own acquire timeout.
  maxWaitMs: number;
}

interface Installation {
  limiter: KeyedConcurrencyLimiter;
  // The checkout install() wrapped, and whether it was the driver's own.
  original: ObtainConnection;
  wasOwnProperty: boolean;
}

export default class QueueJobConnections {
  private static installations: WeakMap<PostgresDriverLike, Installation> =
    new WeakMap<PostgresDriverLike, Installation>();

  /*
   * Runs `work` as a job of the queue `queueName`: every Postgres connection
   * it borrows - through its awaits, and the promises it starts - counts
   * against the cap of the pool it borrows from.
   */
  public static runAsQueueJob<T>(queueName: string, work: () => T): T {
    return queueOfCurrentJob.run(queueName, work);
  }

  // The queue of the job running now, or undefined outside every job.
  public static currentQueue(): string | undefined {
    return queueOfCurrentJob.getStore();
  }

  /*
   * The cap for a process, or null for none: a process that runs no queue
   * workers has no jobs to cap, and a share as large as the pool is no cap.
   */
  public static limitsFor(settings: {
    runsQueueWorkers: boolean;
    poolSize: number;
    maxQueueJobConnections: number;
    acquireTimeoutMs: number;
  }): QueueJobConnectionLimits | null {
    if (
      !settings.runsQueueWorkers ||
      settings.maxQueueJobConnections >= settings.poolSize
    ) {
      return null;
    }

    return {
      maxConnections: settings.maxQueueJobConnections,
      maxWaitMs: settings.acquireTimeoutMs,
    };
  }

  /*
   * Caps the connections queue jobs borrow from `dataSource`'s pool, once:
   * a second install keeps the first. Hands back the limiter that counts
   * them, keyed by queue name.
   */
  public static install(
    dataSource: DataSource,
    limits: QueueJobConnectionLimits,
  ): KeyedConcurrencyLimiter {
    const driver: PostgresDriverLike =
      dataSource.driver as unknown as PostgresDriverLike;

    const installed: Installation | undefined =
      QueueJobConnections.installations.get(driver);

    if (installed) {
      return installed.limiter;
    }

    const limiter: KeyedConcurrencyLimiter = new KeyedConcurrencyLimiter({
      limits: {
        maxRunning: limits.maxConnections,
        // One arrival-order queue for every queue's jobs.
        maxRunningPerKey: limits.maxConnections,
        // Bounded by how many jobs run at once, and how many queries each.
        maxWaiting: Infinity,
        maxWaitingPerKey: Infinity,
        maxWaitMs: limits.maxWaitMs,
      },
      busyError: (): Error => {
        return new QueueJobConnectionTimeoutError(limits.maxConnections);
      },
      abandonedError: (): Error => {
        // Nothing passes a signal; a checkout is never abandoned.
        return new Error("A queue job's Postgres checkout was abandoned.");
      },
    });

    const original: ObtainConnection = driver.obtainMasterConnection;
    const wasOwnProperty: boolean = Object.prototype.hasOwnProperty.call(
      driver,
      "obtainMasterConnection",
    );

    const obtainMasterConnection: ObtainConnection = async function (
      this: unknown,
    ): Promise<ConnectionCheckout> {
      const queueName: string | undefined = queueOfCurrentJob.getStore();

      if (queueName === undefined) {
        return await original.call(this);
      }

      const releaseSlot: KeyedConcurrencyRelease =
        await limiter.acquire(queueName);

      let checkout: ConnectionCheckout;

      try {
        checkout = await original.call(this);
      } catch (error) {
        releaseSlot();
        throw error;
      }

      const [connection, releaseConnection] = checkout;

      return [
        connection,
        (error?: unknown): unknown => {
          releaseSlot();
          return releaseConnection(error);
        },
      ];
    };

    driver.obtainMasterConnection = obtainMasterConnection;
    QueueJobConnections.installations.set(driver, {
      limiter,
      original,
      wasOwnProperty,
    });

    return limiter;
  }

  // The limiter install() put on `dataSource`'s pool, if any.
  public static limiterOf(
    dataSource: DataSource,
  ): KeyedConcurrencyLimiter | undefined {
    return QueueJobConnections.installations.get(
      dataSource.driver as unknown as PostgresDriverLike,
    )?.limiter;
  }

  // Test seam: puts back the checkout install() wrapped.
  public static uninstall(dataSource: DataSource): void {
    const driver: PostgresDriverLike =
      dataSource.driver as unknown as PostgresDriverLike;
    const installed: Installation | undefined =
      QueueJobConnections.installations.get(driver);

    if (!installed) {
      return;
    }

    if (installed.wasOwnProperty) {
      driver.obtainMasterConnection = installed.original;
    } else {
      // The driver's class has it: take the wrapper off, not shadow it.
      delete (driver as Partial<PostgresDriverLike>).obtainMasterConnection;
    }

    QueueJobConnections.installations.delete(driver);
  }
}
