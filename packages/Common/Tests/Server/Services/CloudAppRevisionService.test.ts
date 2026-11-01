import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import CloudAppRevisionService, {
  CLOUD_APP_REVISION_LIVE_MINUTES,
  MAX_NEW_CLOUD_APP_REVISIONS_PER_HOUR,
  RecordCloudAppRevisionResult,
} from "../../../Server/Services/CloudAppRevisionService";
import CloudAppService from "../../../Server/Services/CloudAppService";
import CloudApp from "../../../Models/DatabaseModels/CloudApp";
import CloudAppRevision from "../../../Models/DatabaseModels/CloudAppRevision";
import { CloudAppRevisionChangeKind } from "../../../Server/Utils/Telemetry/ChangeDetection/CloudAppChangeEntries";
import type { FindOperator } from "../../../Server/Types/Database/QueryHelper";
import PositiveNumber from "../../../Types/PositiveNumber";
import ObjectID from "../../../Types/ObjectID";

/*
 * What one sighting of a revision means for an App Platforms app - the
 * deploy history the app's pages, its environment's feed and OneUptime AI
 * read:
 *
 *   - the app's first revision is its baseline, not a deploy;
 *   - a revision it never ran is a deploy, recorded once (the unique index
 *     decides which worker owns it) and capped per hour;
 *   - an old revision still reporting while the current one does is a
 *     draining instance: nothing changes;
 *   - an old revision still reporting after the current one went quiet for
 *     the live window is a rollback (older) or a roll forward (newer).
 *
 * Postgres is stood in for by an in-memory table of the app's revisions.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7b000000-0000-4000-8000-000000000001",
);
const ENVIRONMENT_ID: ObjectID = new ObjectID(
  "7b000000-0000-4000-8000-000000000002",
);
const APP_ID: ObjectID = new ObjectID("7b000000-0000-4000-8000-000000000003");
const NOW: Date = new Date("2026-11-01T10:00:00.000Z");
const MINUTE_MS: number = 60 * 1000;

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE_MS);
}

interface StoredRevision {
  _id: string;
  revision: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  previousRevision?: string | undefined;
}

// The app's row, as CloudAppService would read and write it.
let appRow: { currentRevision?: string | undefined } | null;
let appUpdates: Array<Record<string, unknown>>;
let revisions: Array<StoredRevision>;
let created: Array<CloudAppRevision>;
let revisionUpdates: Array<{ id: string; data: Record<string, unknown> }>;
let newRevisionsThisHour: number;
let createFails: unknown;

function stored(data: {
  revision: string;
  firstSeenMinutesAgo: number;
  lastSeenMinutesAgo: number;
}): StoredRevision {
  return {
    _id: ObjectID.generate().toString(),
    revision: data.revision,
    firstSeenAt: minutesAgo(data.firstSeenMinutesAgo),
    lastSeenAt: minutesAgo(data.lastSeenMinutesAgo),
  };
}

async function sighting(
  revision: string,
  extra: { serviceVersion?: string; image?: string } = {},
): Promise<RecordCloudAppRevisionResult> {
  return await CloudAppRevisionService.recordRevision({
    projectId: PROJECT_ID,
    cloudResourceId: ENVIRONMENT_ID,
    cloudAppId: APP_ID,
    revision,
    now: NOW,
    ...extra,
  });
}

beforeEach(() => {
  appRow = {};
  appUpdates = [];
  revisions = [];
  created = [];
  revisionUpdates = [];
  newRevisionsThisHour = 0;
  createFails = null;

  jest.spyOn(CloudAppService, "findOneById").mockImplementation((async () => {
    if (!appRow) {
      return null;
    }
    const app: CloudApp = new CloudApp();
    app._id = APP_ID.toString();
    if (appRow.currentRevision) {
      app.currentRevision = appRow.currentRevision;
    }
    return app;
  }) as never);

  jest
    .spyOn(CloudAppService, "updateOneById")
    .mockImplementation((async (args: { data: Record<string, unknown> }) => {
      appUpdates.push(args.data);
      if (appRow && typeof args.data["currentRevision"] === "string") {
        appRow.currentRevision = args.data["currentRevision"];
      }
    }) as never);

  jest
    .spyOn(CloudAppRevisionService, "findOneBy")
    .mockImplementation((async (args: { query: { revision: string } }) => {
      const found: StoredRevision | undefined = revisions.find(
        (row: StoredRevision): boolean => {
          return row.revision === args.query.revision;
        },
      );
      if (!found) {
        return null;
      }
      const row: CloudAppRevision = new CloudAppRevision();
      row._id = found._id;
      row.firstSeenAt = found.firstSeenAt;
      row.lastSeenAt = found.lastSeenAt;
      return row;
    }) as never);

  jest
    .spyOn(CloudAppRevisionService, "create")
    .mockImplementation((async (args: { data: CloudAppRevision }) => {
      if (createFails) {
        throw createFails;
      }
      created.push(args.data);
      revisions.push({
        _id: ObjectID.generate().toString(),
        revision: args.data.revision!,
        firstSeenAt: args.data.firstSeenAt!,
        lastSeenAt: args.data.lastSeenAt!,
        previousRevision: args.data.previousRevision,
      });
      return args.data;
    }) as never);

  jest
    .spyOn(CloudAppRevisionService, "updateOneById")
    .mockImplementation((async (args: {
      id: ObjectID;
      data: Record<string, unknown>;
    }) => {
      revisionUpdates.push({ id: args.id.toString(), data: args.data });
    }) as never);

  jest
    .spyOn(CloudAppRevisionService, "countBy")
    .mockImplementation((async () => {
      return new PositiveNumber(newRevisionsThisHour);
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an app's first revision", () => {
  test("is its baseline: recorded and made current, but no deploy", async () => {
    const result: RecordCloudAppRevisionResult = await sighting("42", {
      serviceVersion: "1.4.1",
      image: "registry/checkout:1.4.1",
    });

    expect(result.change).toBeNull();
    expect(created).toHaveLength(1);
    expect(created[0]!.revision).toBe("42");
    expect(created[0]!.previousRevision).toBeUndefined();
    expect(created[0]!.firstSeenAt).toEqual(NOW);
    expect(created[0]!.serviceVersion).toBe("1.4.1");
    expect(created[0]!.image).toBe("registry/checkout:1.4.1");
    expect(created[0]!.cloudResourceId!.toString()).toBe(
      ENVIRONMENT_ID.toString(),
    );
    expect(appUpdates).toEqual([
      { currentRevision: "42", currentRevisionSince: NOW },
    ]);
  });

  test("an app that is gone records nothing", async () => {
    appRow = null;

    const result: RecordCloudAppRevisionResult = await sighting("42");

    expect(result.change).toBeNull();
    expect(created).toHaveLength(0);
    expect(appUpdates).toHaveLength(0);
  });
});

describe("a revision the app never ran", () => {
  beforeEach(() => {
    appRow = { currentRevision: "42" };
    revisions = [
      stored({
        revision: "42",
        firstSeenMinutesAgo: 600,
        lastSeenMinutesAgo: 1,
      }),
    ];
  });

  test("is a deploy, naming the revision it replaced", async () => {
    const result: RecordCloudAppRevisionResult = await sighting("43");

    expect(result.change).toEqual({
      kind: CloudAppRevisionChangeKind.Deployed,
      revision: "43",
      previousRevision: "42",
      time: NOW,
    });
    expect(created[0]!.previousRevision).toBe("42");
    // The app runs it from now, and remembers what it ran before.
    expect(appUpdates).toEqual([
      {
        currentRevision: "43",
        currentRevisionSince: NOW,
        previousRevision: "42",
      },
    ]);
  });

  test("is recorded once: the worker whose create the unique index refused records no deploy", async () => {
    createFails = { postgresErrorCode: "23505" };

    const result: RecordCloudAppRevisionResult = await sighting("43");

    expect(result.change).toBeNull();
    expect(appUpdates).toHaveLength(0);
  });

  test("any other failure to record it is thrown", async () => {
    createFails = new Error("Postgres said no");

    await expect(sighting("43")).rejects.toThrow("Postgres said no");
    expect(appUpdates).toHaveLength(0);
  });

  test(`past ${MAX_NEW_CLOUD_APP_REVISIONS_PER_HOUR} new revisions in an hour, no more are recorded`, async () => {
    newRevisionsThisHour = MAX_NEW_CLOUD_APP_REVISIONS_PER_HOUR;

    const result: RecordCloudAppRevisionResult = await sighting("43");

    expect(result.change).toBeNull();
    expect(created).toHaveLength(0);
    expect(appUpdates).toHaveLength(0);

    newRevisionsThisHour = MAX_NEW_CLOUD_APP_REVISIONS_PER_HOUR - 1;

    expect((await sighting("43")).change).not.toBeNull();
  });

  test("the hourly budget counts the app's revisions first seen in the last hour", async () => {
    const countBy: jest.SpiedFunction<typeof CloudAppRevisionService.countBy> =
      jest.spyOn(CloudAppRevisionService, "countBy");

    await sighting("43");

    const query: { cloudAppId: ObjectID; firstSeenAt: FindOperator<Date> } = (
      countBy.mock.calls[0]![0] as never as {
        query: { cloudAppId: ObjectID; firstSeenAt: FindOperator<Date> };
      }
    ).query;
    expect(query.cloudAppId).toBe(APP_ID);
    expect(query.firstSeenAt.getSql!("firstSeenAt")).toMatch(/firstSeenAt > :/);
    expect(Object.values(query.firstSeenAt.objectLiteralParameters!)).toEqual([
      minutesAgo(60),
    ]);
  });
});

describe("a revision the app ran before", () => {
  test("the current one is only marked seen", async () => {
    appRow = { currentRevision: "43" };
    revisions = [
      stored({
        revision: "43",
        firstSeenMinutesAgo: 30,
        lastSeenMinutesAgo: 5,
      }),
    ];

    const result: RecordCloudAppRevisionResult = await sighting("43", {
      serviceVersion: "1.4.2",
    });

    expect(result.change).toBeNull();
    expect(created).toHaveLength(0);
    expect(revisionUpdates).toEqual([
      {
        id: revisions[0]!._id,
        data: { lastSeenAt: NOW, serviceVersion: "1.4.2" },
      },
    ]);
    expect(appUpdates).toHaveLength(0);
  });

  test("an older one still reporting while the current one does is a draining instance", async () => {
    appRow = { currentRevision: "43" };
    revisions = [
      stored({
        revision: "42",
        firstSeenMinutesAgo: 600,
        lastSeenMinutesAgo: 3,
      }),
      stored({
        revision: "43",
        firstSeenMinutesAgo: 10,
        lastSeenMinutesAgo: 1,
      }),
    ];

    const result: RecordCloudAppRevisionResult = await sighting("42");

    expect(result.change).toBeNull();
    expect(appUpdates).toHaveLength(0);
  });

  test(`an older one still reporting after the current one went quiet for ${CLOUD_APP_REVISION_LIVE_MINUTES} minutes is a rollback, at when the current one stopped`, async () => {
    appRow = { currentRevision: "43" };
    revisions = [
      stored({
        revision: "42",
        firstSeenMinutesAgo: 600,
        lastSeenMinutesAgo: 2,
      }),
      stored({
        revision: "43",
        firstSeenMinutesAgo: 40,
        lastSeenMinutesAgo: CLOUD_APP_REVISION_LIVE_MINUTES + 5,
      }),
    ];

    const result: RecordCloudAppRevisionResult = await sighting("42");

    const stoppedAt: Date = minutesAgo(CLOUD_APP_REVISION_LIVE_MINUTES + 5);
    expect(result.change).toEqual({
      kind: CloudAppRevisionChangeKind.RolledBack,
      revision: "42",
      previousRevision: "43",
      time: stoppedAt,
    });
    expect(appUpdates).toEqual([
      {
        currentRevision: "42",
        currentRevisionSince: stoppedAt,
        previousRevision: "43",
      },
    ]);
    // A rollback adds no revision: the app ran this one before.
    expect(created).toHaveLength(0);
  });

  test("a newer one taking over again from an older current one is a deploy (a roll forward)", async () => {
    appRow = { currentRevision: "42" };
    revisions = [
      stored({
        revision: "42",
        firstSeenMinutesAgo: 600,
        lastSeenMinutesAgo: 30,
      }),
      stored({
        revision: "43",
        firstSeenMinutesAgo: 60,
        lastSeenMinutesAgo: 1,
      }),
    ];

    const result: RecordCloudAppRevisionResult = await sighting("43");

    expect(result.change).toEqual(
      expect.objectContaining({
        kind: CloudAppRevisionChangeKind.Deployed,
        revision: "43",
        previousRevision: "42",
      }),
    );
  });

  test("an app that lost its current revision takes this one quietly", async () => {
    appRow = {};
    revisions = [
      stored({
        revision: "42",
        firstSeenMinutesAgo: 600,
        lastSeenMinutesAgo: 1,
      }),
    ];

    const result: RecordCloudAppRevisionResult = await sighting("42");

    expect(result.change).toBeNull();
    expect(appUpdates).toEqual([
      { currentRevision: "42", currentRevisionSince: minutesAgo(600) },
    ]);
  });
});

describe("CloudAppRevisionService.deleteUnseenForResource", () => {
  test("removes each app's revisions not seen since the cutoff, but never the one it runs", async () => {
    const cutoff: Date = minutesAgo(60 * 24 * 30);
    const withCurrent: CloudApp = new CloudApp();
    withCurrent._id = APP_ID.toString();
    withCurrent.currentRevision = "43";
    const withoutCurrent: CloudApp = new CloudApp();
    withoutCurrent._id = ObjectID.generate().toString();

    jest
      .spyOn(CloudAppService, "findBy")
      .mockResolvedValue([withCurrent, withoutCurrent] as never);
    const deleteBy: jest.SpiedFunction<
      typeof CloudAppRevisionService.deleteBy
    > = jest
      .spyOn(CloudAppRevisionService, "deleteBy")
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);

    const removed: number =
      await CloudAppRevisionService.deleteUnseenForResource({
        cloudResourceId: ENVIRONMENT_ID,
        olderThan: cutoff,
      });

    expect(removed).toBe(3);
    expect(deleteBy).toHaveBeenCalledTimes(2);

    const first: {
      query: {
        cloudAppId: ObjectID;
        lastSeenAt: FindOperator<Date>;
        revision?: FindOperator<string>;
      };
      props: { isRoot?: boolean };
    } = deleteBy.mock.calls[0]![0] as never;
    expect(first.query.cloudAppId.toString()).toBe(APP_ID.toString());
    expect(first.query.lastSeenAt.getSql!("lastSeenAt")).toMatch(
      /lastSeenAt < :/,
    );
    expect(
      Object.values(first.query.lastSeenAt.objectLiteralParameters!),
    ).toEqual([cutoff]);
    // The revision the app runs now is kept, however old its last sighting.
    expect(first.query.revision!.getSql!("revision")).toMatch(/revision != :/);
    expect(
      Object.values(first.query.revision!.objectLiteralParameters!),
    ).toEqual(["43"]);
    expect(first.props).toEqual({ isRoot: true });

    // An app with no current revision has none to keep.
    const second: { query: Record<string, unknown> } = deleteBy.mock
      .calls[1]![0] as never;
    expect(second.query["revision"]).toBeUndefined();
  });
});
