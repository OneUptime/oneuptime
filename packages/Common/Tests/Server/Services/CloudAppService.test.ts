import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import CloudAppService, {
  DEFAULT_CLOUD_APP_RETENTION_DAYS,
} from "../../../Server/Services/CloudAppService";
import CloudApp from "../../../Models/DatabaseModels/CloudApp";
import type { FindOperator } from "../../../Server/Types/Database/QueryHelper";
import { CloudAppIdentity } from "../../../Server/Utils/Telemetry/CloudAppIdentity";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";

/*
 * CloudAppService keeps one row per app of an App Platforms environment:
 * found by its key and marked seen, or created - and when two workers meet
 * a new app at once, the one whose create the unique index refused takes the
 * other's row instead of failing its batch. Apps that sent nothing for the
 * retention window are removed, one environment at a time.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7a000000-0000-4000-8000-000000000001",
);
const ENVIRONMENT_ID: ObjectID = new ObjectID(
  "7a000000-0000-4000-8000-000000000002",
);
const APP_ID: string = "7a000000-0000-4000-8000-000000000003";
const NOW: Date = new Date("2026-11-01T10:00:00.000Z");
const ENV_KEY: string = "CLOUD_APP_RETENTION_DAYS";

const IDENTITY: CloudAppIdentity = {
  name: "checkout-api",
  nameAttribute: "aws.ecs.task.family",
  groupName: "production",
  groupAttribute: "aws.ecs.cluster.arn",
  telemetryAttributes: {
    "aws.ecs.task.family": "checkout-api",
    "aws.ecs.cluster.arn":
      "arn:aws:ecs:us-east-1:123456789012:cluster/production",
  },
  appKey: "0123456789abcdef0123456789abcdef01234567",
  serviceName: "checkout",
  revision: "43",
  revisionAttribute: "aws.ecs.task.revision",
  serviceVersion: "1.4.2",
  image: "registry/checkout:1.4.2",
};

interface FindOneArgs {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  props: { isRoot?: boolean };
}

interface UpdateArgs {
  id: ObjectID;
  data: Record<string, unknown>;
  props: { isRoot?: boolean };
}

interface CreateArgs {
  data: CloudApp;
  props: { isRoot?: boolean };
}

function appRow(id: string): CloudApp {
  const app: CloudApp = new CloudApp();
  app._id = id;
  return app;
}

let savedEnv: string | undefined;

beforeEach(() => {
  savedEnv = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
});

afterEach(() => {
  if (savedEnv === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = savedEnv;
  }
  jest.restoreAllMocks();
});

describe("CloudAppService.recordApp", () => {
  test("creates an app the environment has not had, with what its identity says, as root", async () => {
    const findOneBy: jest.SpiedFunction<typeof CloudAppService.findOneBy> = jest
      .spyOn(CloudAppService, "findOneBy")
      .mockResolvedValue(null);
    const create: jest.SpiedFunction<typeof CloudAppService.create> = jest
      .spyOn(CloudAppService, "create")
      .mockImplementation((async (args: CreateArgs) => {
        const created: CloudApp = args.data;
        created._id = APP_ID;
        return created;
      }) as never);
    const update: jest.SpiedFunction<typeof CloudAppService.updateOneById> =
      jest.spyOn(CloudAppService, "updateOneById");

    const id: ObjectID = await CloudAppService.recordApp({
      projectId: PROJECT_ID,
      cloudResourceId: ENVIRONMENT_ID,
      cloudPlatform: "aws_ecs",
      identity: IDENTITY,
      now: NOW,
    });

    expect(id.toString()).toBe(APP_ID);
    expect(update).not.toHaveBeenCalled();

    // Found by its key, in its environment of its project.
    const lookup: FindOneArgs = findOneBy.mock.calls[0]![0] as never;
    expect(lookup.query).toEqual({
      projectId: PROJECT_ID,
      cloudResourceId: ENVIRONMENT_ID,
      appKey: IDENTITY.appKey,
    });
    expect(lookup.props).toEqual({ isRoot: true });

    const created: CreateArgs = create.mock.calls[0]![0] as never;
    expect(created.props).toEqual({ isRoot: true });
    expect(created.data.projectId!.toString()).toBe(PROJECT_ID.toString());
    expect(created.data.cloudResourceId!.toString()).toBe(
      ENVIRONMENT_ID.toString(),
    );
    expect(created.data.appKey).toBe(IDENTITY.appKey);
    expect(created.data.name).toBe("checkout-api");
    expect(created.data.groupName).toBe("production");
    expect(created.data.cloudPlatform).toBe("aws_ecs");
    expect(created.data.telemetryAttributes).toEqual(
      IDENTITY.telemetryAttributes,
    );
    expect(created.data.serviceName).toBe("checkout");
    expect(created.data.image).toBe("registry/checkout:1.4.2");
    expect(created.data.revisionAttribute).toBe("aws.ecs.task.revision");
    expect(created.data.lastSeenAt).toEqual(NOW);
    /*
     * The revision is the revision service's: an app's row never claims a
     * current revision before that service has recorded one.
     */
    expect(created.data.currentRevision).toBeUndefined();
  });

  test("marks an app it has seen before as seen again, keeping its name and revision", async () => {
    jest
      .spyOn(CloudAppService, "findOneBy")
      .mockResolvedValue(appRow(APP_ID) as never);
    const create: jest.SpiedFunction<typeof CloudAppService.create> =
      jest.spyOn(CloudAppService, "create");
    const update: jest.SpiedFunction<typeof CloudAppService.updateOneById> =
      jest
        .spyOn(CloudAppService, "updateOneById")
        .mockResolvedValue(undefined as never);

    const id: ObjectID = await CloudAppService.recordApp({
      projectId: PROJECT_ID,
      cloudResourceId: ENVIRONMENT_ID,
      cloudPlatform: "aws_ecs",
      identity: IDENTITY,
      now: NOW,
    });

    expect(id.toString()).toBe(APP_ID);
    expect(create).not.toHaveBeenCalled();

    const updated: UpdateArgs = update.mock.calls[0]![0] as never;
    expect(updated.id.toString()).toBe(APP_ID);
    expect(updated.props).toEqual({ isRoot: true });
    expect(updated.data).toEqual({
      lastSeenAt: NOW,
      cloudPlatform: "aws_ecs",
      telemetryAttributes: IDENTITY.telemetryAttributes,
      serviceName: "checkout",
      image: "registry/checkout:1.4.2",
      revisionAttribute: "aws.ecs.task.revision",
    });
  });

  test("leaves out what this batch did not report, rather than blanking it", async () => {
    jest
      .spyOn(CloudAppService, "findOneBy")
      .mockResolvedValue(appRow(APP_ID) as never);
    const update: jest.SpiedFunction<typeof CloudAppService.updateOneById> =
      jest
        .spyOn(CloudAppService, "updateOneById")
        .mockResolvedValue(undefined as never);

    await CloudAppService.recordApp({
      projectId: PROJECT_ID,
      cloudResourceId: ENVIRONMENT_ID,
      cloudPlatform: "aws_ecs",
      identity: {
        ...IDENTITY,
        serviceName: null,
        image: null,
        revisionAttribute: null,
      },
      now: NOW,
    });

    expect((update.mock.calls[0]![0] as UpdateArgs).data).toEqual({
      lastSeenAt: NOW,
      cloudPlatform: "aws_ecs",
      telemetryAttributes: IDENTITY.telemetryAttributes,
    });
  });

  test("a create the unique index refused takes the row the other worker created", async () => {
    jest
      .spyOn(CloudAppService, "findOneBy")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(appRow(APP_ID) as never);
    jest
      .spyOn(CloudAppService, "create")
      .mockRejectedValue({ postgresErrorCode: "23505" });

    const id: ObjectID = await CloudAppService.recordApp({
      projectId: PROJECT_ID,
      cloudResourceId: ENVIRONMENT_ID,
      cloudPlatform: "aws_ecs",
      identity: IDENTITY,
      now: NOW,
    });

    expect(id.toString()).toBe(APP_ID);
  });

  test("any other failure is thrown, as is a refused create with no row to take", async () => {
    jest.spyOn(CloudAppService, "findOneBy").mockResolvedValue(null);
    const create: jest.SpiedFunction<typeof CloudAppService.create> = jest
      .spyOn(CloudAppService, "create")
      .mockRejectedValueOnce(new Error("Postgres said no"));

    await expect(
      CloudAppService.recordApp({
        projectId: PROJECT_ID,
        cloudResourceId: ENVIRONMENT_ID,
        cloudPlatform: "aws_ecs",
        identity: IDENTITY,
        now: NOW,
      }),
    ).rejects.toThrow("Postgres said no");

    const refused: { postgresErrorCode: string } = {
      postgresErrorCode: "23505",
    };
    create.mockRejectedValueOnce(refused);

    await expect(
      CloudAppService.recordApp({
        projectId: PROJECT_ID,
        cloudResourceId: ENVIRONMENT_ID,
        cloudPlatform: "aws_ecs",
        identity: IDENTITY,
        now: NOW,
      }),
    ).rejects.toBe(refused);
  });
});

describe("CloudAppService.findAppId", () => {
  test("is the id of the app with the key in the environment, or null", async () => {
    const findOneBy: jest.SpiedFunction<typeof CloudAppService.findOneBy> = jest
      .spyOn(CloudAppService, "findOneBy")
      .mockResolvedValueOnce(appRow(APP_ID) as never)
      .mockResolvedValueOnce(null);

    const found: ObjectID | null = await CloudAppService.findAppId({
      projectId: PROJECT_ID,
      cloudResourceId: ENVIRONMENT_ID,
      appKey: IDENTITY.appKey,
    });
    const missing: ObjectID | null = await CloudAppService.findAppId({
      projectId: PROJECT_ID,
      cloudResourceId: ENVIRONMENT_ID,
      appKey: "another",
    });

    expect(found!.toString()).toBe(APP_ID);
    expect(missing).toBeNull();
    expect((findOneBy.mock.calls[0]![0] as FindOneArgs).select).toEqual({
      _id: true,
    });
  });
});

describe("CloudAppService.deleteUnseenForResource", () => {
  test("removes, as root, the environment's apps not seen since the cutoff", async () => {
    const cutoff: Date = new Date("2026-10-02T10:00:00.000Z");
    const deleteBy: jest.SpiedFunction<typeof CloudAppService.deleteBy> = jest
      .spyOn(CloudAppService, "deleteBy")
      .mockResolvedValue(3);

    const removed: number = await CloudAppService.deleteUnseenForResource({
      cloudResourceId: ENVIRONMENT_ID,
      olderThan: cutoff,
    });

    expect(removed).toBe(3);
    const args: {
      query: { cloudResourceId: ObjectID; lastSeenAt: FindOperator<Date> };
      limit: number;
      props: { isRoot?: boolean };
    } = deleteBy.mock.calls[0]![0] as never;
    expect(args.query.cloudResourceId).toBe(ENVIRONMENT_ID);
    // Strictly older than the cutoff: an app seen AT it stays.
    expect(args.query.lastSeenAt.getSql!("lastSeenAt")).toMatch(
      /lastSeenAt < :/,
    );
    expect(
      Object.values(args.query.lastSeenAt.objectLiteralParameters!),
    ).toEqual([cutoff]);
    expect(args.limit).toBe(LIMIT_MAX);
    expect(args.props).toEqual({ isRoot: true });
  });
});

describe("CloudAppService retention", () => {
  test("keeps an app 30 days by default", () => {
    expect(DEFAULT_CLOUD_APP_RETENTION_DAYS).toBe(30);
    expect(CloudAppService.getRetentionDays()).toBe(30);
    expect(CloudAppService.getUnseenThresholdDate(NOW)).toEqual(
      new Date("2026-10-02T10:00:00.000Z"),
    );
  });

  test.each([
    ["7", 7],
    ["1", 1],
    ["0", 30],
    ["-3", 30],
    ["soon", 30],
  ])(
    "CLOUD_APP_RETENTION_DAYS=%s keeps it %d days",
    (value: string, days: number) => {
      process.env[ENV_KEY] = value;

      expect(CloudAppService.getRetentionDays()).toBe(days);
    },
  );
});
