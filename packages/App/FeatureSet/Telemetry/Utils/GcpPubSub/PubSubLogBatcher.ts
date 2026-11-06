import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import { CLOUD_STREAM_PUBSUB_LOGS_PATH } from "Common/Types/CloudConnection/CloudStream";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import LogsQueueService from "../../Services/Queue/LogsQueueService";

/*
 * PUB/SUB'S PUSHES, QUEUED A BATCH AT A TIME.
 *
 * A push subscription sends one log entry a request: a busy project's
 * logs are hundreds of requests a second. Each would be a queued job of
 * one log line - and each job reads its project's pipelines, drop filters
 * and scrub rules again - so the pushes of one project are held for at
 * most PUBSUB_BATCH_MAX_WAIT_MS, or until PUBSUB_BATCH_MAX_RECORDS of them
 * wait, and queued as one job. Every push is answered only once the job
 * that holds it is queued - taken, or refused for Pub/Sub to push again -
 * so nothing is acknowledged that was not queued.
 *
 * While a project's batches being queued hold PUBSUB_BATCH_MAX_PENDING
 * records - the queue is slower than the pushes - a push is refused at
 * once, and Pub/Sub backs off and pushes it again: what waits in this
 * process never grows past that.
 */

export const PUBSUB_BATCH_MAX_RECORDS: number = 500;
export const PUBSUB_BATCH_MAX_WAIT_MS: number = 200;
export const PUBSUB_BATCH_MAX_PENDING: number = 20_000;

export class PubSubBatchFull extends Error {}

interface Waiter {
  resolve: () => void;
  reject: (error: Error) => void;
}

interface Batch {
  projectId: ObjectID;
  resources: Array<JSONObject>;
  records: number;
  waiters: Array<Waiter>;
  timer: ReturnType<typeof setTimeout> | null;
}

export default class PubSubLogBatcher {
  /*
   * What queues one batch for a project: a logs ingest job, exactly as an
   * OTLP export is, so drop filters, scrub rules, pipelines, retention and
   * billing apply to it as to any other logs.
   */
  public static queue: (data: {
    projectId: ObjectID;
    resourceLogs: Array<JSONObject>;
  }) => Promise<void> = async (data: {
    projectId: ObjectID;
    resourceLogs: Array<JSONObject>;
  }): Promise<void> => {
    const job: Partial<TelemetryRequest> = {
      body: { resourceLogs: data.resourceLogs as unknown as JSONArray },
      headers: {},
      projectId: data.projectId,
      productType: ProductType.Logs,
      path: CLOUD_STREAM_PUBSUB_LOGS_PATH,
      url: CLOUD_STREAM_PUBSUB_LOGS_PATH,
    };

    await LogsQueueService.addLogIngestJob(job as TelemetryRequest);
  };

  public static maxWaitMs: number = PUBSUB_BATCH_MAX_WAIT_MS;

  private static batches: Map<string, Batch> = new Map();
  // Records of each project in batches being queued now.
  private static inFlight: Map<string, number> = new Map();

  public static reset(): void {
    for (const batch of PubSubLogBatcher.batches.values()) {
      if (batch.timer) {
        clearTimeout(batch.timer);
      }
    }

    PubSubLogBatcher.batches = new Map();
    PubSubLogBatcher.inFlight = new Map();
    PubSubLogBatcher.maxWaitMs = PUBSUB_BATCH_MAX_WAIT_MS;
  }

  // Records of a project waiting or being queued: tests and the limit.
  public static getPending(projectId: ObjectID): number {
    const key: string = projectId.toString();

    return (
      (PubSubLogBatcher.batches.get(key)?.records || 0) +
      (PubSubLogBatcher.inFlight.get(key) || 0)
    );
  }

  /*
   * One push's resource, queued with the project's others: resolves once
   * the job that holds it is queued, rejects when it could not be.
   */
  public static async add(data: {
    projectId: ObjectID;
    resource: JSONObject;
    records: number;
  }): Promise<void> {
    const key: string = data.projectId.toString();

    if (
      PubSubLogBatcher.getPending(data.projectId) + data.records >
      PUBSUB_BATCH_MAX_PENDING
    ) {
      throw new PubSubBatchFull(
        "Too many of this project's pushes wait to be queued.",
      );
    }

    let batch: Batch | undefined = PubSubLogBatcher.batches.get(key);

    if (!batch) {
      batch = {
        projectId: data.projectId,
        resources: [],
        records: 0,
        waiters: [],
        timer: null,
      };
      PubSubLogBatcher.batches.set(key, batch);

      const created: Batch = batch;

      created.timer = setTimeout(() => {
        PubSubLogBatcher.flush(key, created);
      }, PubSubLogBatcher.maxWaitMs);
    }

    const waiting: Promise<void> = new Promise<void>(
      (resolve: () => void, reject: (error: Error) => void) => {
        batch!.waiters.push({ resolve, reject });
      },
    );

    batch.resources.push(data.resource);
    batch.records += data.records;

    if (batch.records >= PUBSUB_BATCH_MAX_RECORDS) {
      PubSubLogBatcher.flush(key, batch);
    }

    return await waiting;
  }

  private static flush(key: string, batch: Batch): void {
    // A batch is flushed once: by its timer, or when it is full.
    if (PubSubLogBatcher.batches.get(key) !== batch) {
      return;
    }

    PubSubLogBatcher.batches.delete(key);

    if (batch.timer) {
      clearTimeout(batch.timer);
      batch.timer = null;
    }

    PubSubLogBatcher.inFlight.set(
      key,
      (PubSubLogBatcher.inFlight.get(key) || 0) + batch.records,
    );

    const settle: () => void = (): void => {
      const left: number = (PubSubLogBatcher.inFlight.get(key) || 0) - batch.records;

      if (left > 0) {
        PubSubLogBatcher.inFlight.set(key, left);
      } else {
        PubSubLogBatcher.inFlight.delete(key);
      }
    };

    PubSubLogBatcher.queue({
      projectId: batch.projectId,
      resourceLogs: batch.resources,
    })
      .then(() => {
        settle();

        for (const waiter of batch.waiters) {
          waiter.resolve();
        }
      })
      .catch((error: unknown) => {
        settle();

        const failure: Error =
          error instanceof Error ? error : new Error(String(error));

        for (const waiter of batch.waiters) {
          waiter.reject(failure);
        }
      });
  }
}
