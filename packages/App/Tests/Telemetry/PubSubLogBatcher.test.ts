import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PubSubLogBatcher, {
  PUBSUB_BATCH_MAX_PENDING,
  PUBSUB_BATCH_MAX_RECORDS,
  PubSubBatchFull,
} from "../../FeatureSet/Telemetry/Utils/GcpPubSub/PubSubLogBatcher";

/*
 * Pub/Sub's one-entry pushes, queued a batch at a time: a project's pushes
 * of a moment become one job, every push is answered only once its job is
 * queued - or refused with it - two projects never share a job, and what
 * waits in a process never grows past its bound.
 */

const PROJECT_A: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROJECT_B: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

let queued: Array<{ projectId: string; resourceLogs: Array<JSONObject> }>;
let releases: Array<() => void>;
let fails: boolean;
let holds: boolean;

function releaseAll(): void {
  for (const release of releases.splice(0)) {
    release();
  }
}

function resource(name: string): JSONObject {
  return { resource: { attributes: [] }, name };
}

beforeEach(() => {
  PubSubLogBatcher.reset();
  PubSubLogBatcher.maxWaitMs = 20;
  queued = [];
  releases = [];
  fails = false;
  holds = false;
  PubSubLogBatcher.queue = async (data: {
    projectId: ObjectID;
    resourceLogs: Array<JSONObject>;
  }): Promise<void> => {
    if (holds) {
      await new Promise<void>((resolve: () => void) => {
        releases.push(resolve);
      });
    }

    if (fails) {
      throw new Error("Redis is away");
    }

    queued.push({
      projectId: data.projectId.toString(),
      resourceLogs: data.resourceLogs,
    });
  };
});

afterEach(() => {
  PubSubLogBatcher.reset();
});

describe("a project's pushes of a moment", () => {
  test("are one job, queued after the wait", async () => {
    await Promise.all([
      PubSubLogBatcher.add({
        projectId: PROJECT_A,
        resource: resource("1"),
        records: 1,
      }),
      PubSubLogBatcher.add({
        projectId: PROJECT_A,
        resource: resource("2"),
        records: 1,
      }),
      PubSubLogBatcher.add({
        projectId: PROJECT_A,
        resource: resource("3"),
        records: 1,
      }),
    ]);

    expect(queued).toEqual([
      {
        projectId: PROJECT_A.toString(),
        resourceLogs: [resource("1"), resource("2"), resource("3")],
      },
    ]);
    expect(PubSubLogBatcher.getPending(PROJECT_A)).toBe(0);
  });

  test("are queued at once when a batch is full, without the wait", async () => {
    PubSubLogBatcher.maxWaitMs = 60_000;

    await Promise.all(
      Array.from(
        { length: PUBSUB_BATCH_MAX_RECORDS },
        (_value: unknown, index: number) => {
          return PubSubLogBatcher.add({
            projectId: PROJECT_A,
            resource: resource(String(index)),
            records: 1,
          });
        },
      ),
    );

    expect(queued).toHaveLength(1);
    expect(queued[0]!.resourceLogs).toHaveLength(PUBSUB_BATCH_MAX_RECORDS);
  });

  test("two projects' pushes are two jobs", async () => {
    await Promise.all([
      PubSubLogBatcher.add({
        projectId: PROJECT_A,
        resource: resource("a"),
        records: 1,
      }),
      PubSubLogBatcher.add({
        projectId: PROJECT_B,
        resource: resource("b"),
        records: 1,
      }),
    ]);

    expect(
      queued
        .map((job: { projectId: string }) => {
          return job.projectId;
        })
        .sort(),
    ).toEqual([PROJECT_A.toString(), PROJECT_B.toString()].sort());
  });
});

describe("each push", () => {
  test("is answered only once its job is queued", async () => {
    holds = true;
    let isAnswered: boolean = false;

    const adding: Promise<void> = PubSubLogBatcher.add({
      projectId: PROJECT_A,
      resource: resource("1"),
      records: 1,
    }).then(() => {
      isAnswered = true;
    });

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 60);
    });
    expect(isAnswered).toBe(false);
    expect(PubSubLogBatcher.getPending(PROJECT_A)).toBe(1);

    releaseAll();
    await adding;
    expect(isAnswered).toBe(true);
  });

  test("is refused with its job when the queue cannot take it", async () => {
    fails = true;

    const results: Array<PromiseSettledResult<void>> = await Promise.allSettled(
      [
        PubSubLogBatcher.add({
          projectId: PROJECT_A,
          resource: resource("1"),
          records: 1,
        }),
        PubSubLogBatcher.add({
          projectId: PROJECT_A,
          resource: resource("2"),
          records: 1,
        }),
      ],
    );

    expect(
      results.map((result: PromiseSettledResult<void>) => {
        return result.status;
      }),
    ).toEqual(["rejected", "rejected"]);
    expect(PubSubLogBatcher.getPending(PROJECT_A)).toBe(0);
  });

  test("is refused at once while the project's pushes waiting to be queued are at their bound", async () => {
    holds = true;
    PubSubLogBatcher.maxWaitMs = 0;

    const first: Promise<void> = PubSubLogBatcher.add({
      projectId: PROJECT_A,
      resource: resource("big"),
      records: PUBSUB_BATCH_MAX_PENDING,
    });

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 10);
    });

    await expect(
      PubSubLogBatcher.add({
        projectId: PROJECT_A,
        resource: resource("one more"),
        records: 1,
      }),
    ).rejects.toBeInstanceOf(PubSubBatchFull);
    // Another project is not held up by it.
    const other: Promise<void> = PubSubLogBatcher.add({
      projectId: PROJECT_B,
      resource: resource("b"),
      records: 1,
    });

    holds = false;
    releaseAll();
    await first;
    await other;
    expect(PubSubLogBatcher.getPending(PROJECT_A)).toBe(0);
  });
});
