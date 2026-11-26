import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

import Entities from "../../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import CloudConnectionService from "../../../../Server/Services/CloudConnectionService";
import CloudCostService from "../../../../Server/Services/CloudCostService";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import CloudSavingsBillReader from "../../../../Server/Utils/CloudSavings/CloudSavingsBillReader";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import AwsServerIdentity from "../../../../Server/Utils/CloudConnection/Aws/AwsServerIdentity";
import { AssumedRoleCache } from "../../../../Server/Utils/CloudConnection/Aws/AwsSts";
import { CloudConnectionSettings } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import CloudOffHoursScheduler, {
  CloudOffHoursRunSummary,
} from "../../../../Server/Utils/CloudSavings/CloudOffHoursScheduler";
import CloudSavingsActionRunner, {
  CloudSavingsRunnerOptions,
} from "../../../../Server/Utils/CloudSavings/CloudSavingsActionRunner";
import CloudSavingsActions, {
  CLOUD_SAVINGS_DISMISS_REASON_REQUIRED,
} from "../../../../Server/Utils/CloudSavings/CloudSavingsActions";
import CloudSavingsAiEngine, {
  CloudSavingsAiOutcome,
} from "../../../../Server/Utils/CloudSavings/CloudSavingsAiEngine";
import { CLOUD_SAVINGS_MAY_NOT_EDIT_RESOURCE } from "../../../../Server/Utils/CloudSavings/CloudSavingsOwners";
import CloudSavingsSummaryReader from "../../../../Server/Utils/CloudSavings/CloudSavingsSummaryReader";
import AutoRemediationTriggerEntity from "../../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { CloudSavingKind } from "../../../../Types/Cloud/CloudCost";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudResourceEnvironment } from "../../../../Types/Cloud/CloudResourceEnvironment";
import {
  CloudSavingsActionGroup,
  CloudSavingsActionKind,
  CloudSavingsActionOrigin,
  CloudSavingsActionStatus,
  CloudSavingsActionUndo,
  CloudSavingsActionsAccess,
  CloudSavingsMeasurement,
} from "../../../../Types/Cloud/CloudSavingsAction";
import { CloudSavingsAiAutonomy } from "../../../../Types/Cloud/CloudSavingsAi";
import {
  CloudOffHoursPreview,
  CloudOffHoursSkipReason,
  CloudSavingsActionResult,
  CloudSavingsConnectionState,
  CloudSavingsOffer,
  CloudSavingsSummary,
} from "../../../../Types/Cloud/CloudSavingsApiTypes";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import Dictionary from "../../../../Types/Dictionary";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import { createFakeAwsSavings, FakeAwsSavings } from "./FakeAwsSavings";
import { DataSource } from "typeorm";

/*
 * ACTING ON SAVINGS, END TO END, AGAINST A MIGRATED POSTGRES (#11010).
 *
 * Opt in with RUN_POSTGRES_CLOUD_SAVINGS_TESTS=true against a database the
 * registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_CLOUD_SAVINGS_TESTS=true \
 *   CLOUD_SAVINGS_TEST_DATABASE_HOST=127.0.0.1 \
 *   CLOUD_SAVINGS_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Utils/CloudSavings/CloudSavingsActionsPostgres.test.ts
 *
 * The tables the flows read and write are cloned, structure only (LIKE ...
 * INCLUDING ALL), into a uniquely named schema that is dropped afterwards;
 * every row is synthetic. The cloud is a fake EC2 (FakeAwsSavings), and the
 * connection's credential a test key handed to the runner, never decrypted.
 *
 * What it pins, as the services run the queries:
 *   - Apply by someone who is not an owner waits for one; the owner's
 *     approval makes it as them: a final snapshot, the volume deleted, both
 *     on the timelines; Undo makes the volume again from the snapshot;
 *   - nothing reaches the cloud while the connection's Savings actions are
 *     off, and a change approved before they were turned off fails, saying
 *     so;
 *   - only an owner who may edit the resource approves and undoes it; a
 *     resource nobody owns is the project admins'; a change that cannot be
 *     undone takes two people where the project asks for two, and never
 *     the same person twice; two approvals at once act once;
 *   - a dismissal says why; a proposal the recommender stopped making
 *     expires;
 *   - AI rules: nothing without Enable AI; proposals by default; made
 *     without asking only for known non-production, under the rule's
 *     limit and the hourly circuit breaker; never production; a saving
 *     undone or dismissed is not made again for a month;
 *   - an off-hours schedule stops its non-production resources when
 *     working hours end - never production, never one whose environment
 *     nothing says - starts only what it stopped when they begin, and
 *     counts the hours; what a turned-off or deleted schedule stopped is
 *     started all the same;
 *   - a change the bill shows is kept as realised, and the Savings page
 *     adds up only that (the statement itself runs against ClickHouse in
 *     CloudSavingsBillReaderClickhouse).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_CLOUD_SAVINGS_TESTS"] === "true"
    ? describe
    : describe.skip;

jest.setTimeout(120000);

const ACCOUNT: string = "123456789012";
const REGION: string = "eu-west-1";
const VOLUME: string = "vol-0123456789abcdef0";
const DEV_INSTANCE: string = "i-0abc1234def567890";
const PROD_INSTANCE: string = "i-0def1234abc567890";
const UNKNOWN_INSTANCE: string = "i-0fed1234cba567890";
const ADDRESS: string = "eipalloc-0a1b2c3d4e5f60718";

function arn(kind: string, id: string): string {
  return `arn:aws:ec2:${REGION}:${ACCOUNT}:${kind}/${id}`;
}

// Tables a test seeds: their NOT NULLs dropped, so a row names only what is read.
const SEEDED_TABLES: Array<string> = [
  "Project",
  "User",
  "Team",
  "TeamMember",
  "Label",
  "CloudConnection",
  "CloudAccount",
  "CloudResource",
  "CloudResourceOwnerUser",
  "CloudResourceOwnerTeam",
  "CloudCostRecommendation",
  "AutoRemediationRule",
  "CloudOffHoursSchedule",
];

// Tables the flows write: their constraints kept, so every row is a whole one.
const WRITTEN_TABLES: Array<string> = [
  "CloudSavingsAction",
  "CloudResourceFeed",
  "CloudAccountFeed",
];

// A join table a read joins (a resource's labels): its key is its columns.
const JOIN_TABLES: Array<string> = ["CloudResourceLabel"];

interface Person {
  userId: ObjectID;
  props: DatabaseCommonInteractionProps;
}

interface World {
  projectId: ObjectID;
  accountId: ObjectID;
  connectionId: ObjectID;
  owner: Person;
  secondOwner: Person;
  member: Person;
  admin: Person;
  viewerOwner: Person;
}

interface StoredAction {
  _id: string;
  status: string;
  origin: string;
  kind: string;
  environment: string;
  undo: string;
  finalSnapshot: boolean;
  approvedByUserId: string | null;
  firstApprovedByUserId: string | null;
  requestedByUserId: string | null;
  autoRemediationRuleName: string | null;
  measurement: string | null;
  summary: string | null;
  failureMessage: string | null;
  dismissReason: string | null;
  savedHours: string | null;
  appliedAt: Date | null;
  endedAt: Date | null;
  cloudOffHoursScheduleId: string | null;
  progress: Record<string, unknown> | null;
}

describePostgres("acting on savings, against Postgres", () => {
  const schema: string = `cloud_savings_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;

  async function cloneTable(
    table: string,
    keepNotNull: boolean,
  ): Promise<void> {
    await database.query(
      `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
    );

    if (keepNotNull) {
      return;
    }

    const columns: Array<{ column_name: string }> = await database.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2 AND is_nullable = 'NO' AND column_name <> '_id'`,
      [schema, table],
    );

    for (const column of columns) {
      await database.query(
        `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
      );
    }
  }

  async function insertRow(
    table: string,
    values: Dictionary<unknown>,
  ): Promise<string> {
    const row: Dictionary<unknown> = {
      _id: ObjectID.generate().toString(),
      ...values,
    };
    const columns: Array<string> = Object.keys(row);

    await database.query(
      `INSERT INTO "${schema}"."${table}" (${columns
        .map((column: string): string => {
          return `"${column}"`;
        })
        .join(", ")}) VALUES (${columns
        .map((_column: string, index: number): string => {
          return `$${index + 1}`;
        })
        .join(", ")})`,
      Object.values(row).map((value: unknown): unknown => {
        // A JSON column's value, as JSON: an array would be sent as a Postgres array.
        return value !== null &&
          typeof value === "object" &&
          !(value instanceof Date)
          ? JSON.stringify(value)
          : value;
      }),
    );

    return row["_id"] as string;
  }

  function person(projectId: ObjectID, permission: Permission): Person {
    const userId: ObjectID = ObjectID.generate();
    const tenantPermission: UserTenantAccessPermission = {
      projectId,
      _type: "UserTenantAccessPermission",
      permissions: [
        {
          _type: "UserPermission",
          permission,
          labelIds: [],
          isBlockPermission: false,
        },
      ],
    };

    return {
      userId,
      props: {
        userId,
        tenantId: projectId,
        userTenantAccessPermission: {
          [projectId.toString()]: tenantPermission,
        },
      },
    };
  }

  async function seedWorld(
    data: {
      savingsActions?: CloudSavingsActionsAccess;
      accountEnvironment?: CloudResourceEnvironment;
      requireTwoApprovals?: boolean;
      enableAi?: boolean;
      connectionEnabled?: boolean;
    } = {},
  ): Promise<World> {
    const projectId: ObjectID = ObjectID.generate();

    await insertRow("Project", {
      _id: projectId.toString(),
      name: "Savings",
      requireTwoApprovalsForRiskierFixes: Boolean(data.requireTwoApprovals),
      enableAi: data.enableAi !== false,
    });

    const world: World = {
      projectId,
      accountId: ObjectID.generate(),
      connectionId: ObjectID.generate(),
      owner: person(projectId, Permission.ProjectMember),
      secondOwner: person(projectId, Permission.ProjectMember),
      member: person(projectId, Permission.ProjectMember),
      admin: person(projectId, Permission.ProjectAdmin),
      viewerOwner: person(projectId, Permission.Viewer),
    };

    for (const [name, someone] of Object.entries({
      Owner: world.owner,
      "Second Owner": world.secondOwner,
      Member: world.member,
      Admin: world.admin,
      "Viewer Owner": world.viewerOwner,
    })) {
      await insertRow("User", {
        _id: someone.userId.toString(),
        name,
        email: `${name.toLowerCase().replace(/ /g, ".")}+${projectId.toString()}@example.com`,
      });
    }

    await insertRow("CloudConnection", {
      _id: world.connectionId.toString(),
      projectId: projectId.toString(),
      name: "AWS",
      provider: CloudProvider.AWS,
      isEnabled: data.connectionEnabled !== false,
      config: {
        authMethod: CloudConnectionAuthMethod.AwsAccessKey,
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        savingsActions:
          data.savingsActions ?? CloudSavingsActionsAccess.CleanUp,
      },
    });
    await insertRow("CloudAccount", {
      _id: world.accountId.toString(),
      projectId: projectId.toString(),
      name: "Shop",
      provider: CloudProvider.AWS,
      accountId: ACCOUNT,
      environment: data.accountEnvironment ?? CloudResourceEnvironment.Unknown,
      cloudConnectionId: world.connectionId.toString(),
    });

    return world;
  }

  async function seedResource(
    world: World,
    data: {
      type: string;
      providerResourceId: string;
      name: string;
      tags?: Record<string, string>;
      owners?: Array<Person>;
    },
  ): Promise<string> {
    const id: string = await insertRow("CloudResource", {
      projectId: world.projectId.toString(),
      name: data.name,
      cloudProvider: CloudProvider.AWS,
      cloudResourceType: data.type,
      cloudAccountId: ACCOUNT,
      cloudRegion: REGION,
      providerResourceId: data.providerResourceId,
      cloudTags: data.tags || {},
      isArchived: false,
    });

    for (const owner of data.owners || []) {
      await insertRow("CloudResourceOwnerUser", {
        projectId: world.projectId.toString(),
        cloudResourceId: id,
        userId: owner.userId.toString(),
      });
    }

    return id;
  }

  async function seedSaving(
    world: World,
    data: {
      cloudResourceId?: string;
      kind: CloudSavingKind;
      action: string;
      resourceId: string;
      resourceType: string;
      monthlySavings: number;
      recommendationId?: string;
    },
  ): Promise<ObjectID> {
    return new ObjectID(
      await insertRow("CloudCostRecommendation", {
        projectId: world.projectId.toString(),
        cloudAccountId: world.accountId.toString(),
        ...(data.cloudResourceId
          ? { cloudResourceId: data.cloudResourceId }
          : {}),
        provider: CloudProvider.AWS,
        recommendationId:
          data.recommendationId || `rec-${ObjectID.generate().toString()}`,
        region: REGION,
        resourceId: data.resourceId,
        resourceType: data.resourceType,
        resourceName: data.resourceId,
        kind: data.kind,
        action: data.action,
        monthlySavings: data.monthlySavings,
        currency: "USD",
      }),
    );
  }

  // An unattached gp2 volume of a dev stack, owned by `owners`, that saves 40 a month deleted.
  async function seedVolumeSaving(
    world: World,
    owners: Array<Person> = [world.owner],
  ): Promise<{ resourceId: string; savingId: ObjectID }> {
    const resourceId: string = await seedResource(world, {
      type: "AWS::EC2::Volume",
      providerResourceId: VOLUME,
      name: "orders-dev-data",
      tags: { environment: "dev" },
      owners,
    });

    return {
      resourceId,
      savingId: await seedSaving(world, {
        cloudResourceId: resourceId,
        kind: CloudSavingKind.Idle,
        action: "Delete",
        resourceId: arn("volume", VOLUME),
        resourceType: "AWS::EC2::Volume",
        monthlySavings: 40,
      }),
    };
  }

  function fakeEc2(): FakeAwsSavings {
    return createFakeAwsSavings({
      volumes: [
        {
          id: VOLUME,
          type: "gp2",
          size: 100,
          zone: `${REGION}a`,
          state: "available",
        },
      ],
      instances: [
        { id: DEV_INSTANCE, type: "m5.large", state: "running" },
        { id: PROD_INSTANCE, type: "m5.large", state: "running" },
        { id: UNKNOWN_INSTANCE, type: "m5.large", state: "running" },
      ],
      addresses: [{ allocationId: ADDRESS, publicIp: "203.0.113.10" }],
    });
  }

  function runner(fake: FakeAwsSavings, now: Date): CloudSavingsRunnerOptions {
    return {
      transport: fake.transport,
      now,
      sleep: async (): Promise<void> => {},
    };
  }

  // The worker's runs, two minutes apart from `from`, as it runs every minute: the last run's time.
  async function stepFor(
    fake: FakeAwsSavings,
    from: Date,
    runs: number,
  ): Promise<Date> {
    let at: Date = from;

    for (let run: number = 1; run <= runs; run++) {
      at = new Date(from.getTime() + run * 2 * 60 * 1000);
      await CloudSavingsActionRunner.runDue(runner(fake, at));
    }

    return at;
  }

  async function actionsOf(world: World): Promise<Array<StoredAction>> {
    return await database.query(
      `SELECT * FROM "${schema}"."CloudSavingsAction" WHERE "projectId" = $1 ORDER BY "createdAt", "_id"`,
      [world.projectId.toString()],
    );
  }

  async function actionOf(id: string): Promise<StoredAction> {
    const rows: Array<StoredAction> = await database.query(
      `SELECT * FROM "${schema}"."CloudSavingsAction" WHERE "_id" = $1`,
      [id],
    );

    return rows[0]!;
  }

  async function feedOf(
    world: World,
  ): Promise<{ resource: Array<string>; account: Array<string> }> {
    const resource: Array<{ cloudResourceFeedEventType: string }> =
      await database.query(
        `SELECT "cloudResourceFeedEventType" FROM "${schema}"."CloudResourceFeed" WHERE "projectId" = $1 ORDER BY "createdAt"`,
        [world.projectId.toString()],
      );
    const account: Array<{ cloudAccountFeedEventType: string }> =
      await database.query(
        `SELECT "cloudAccountFeedEventType" FROM "${schema}"."CloudAccountFeed" WHERE "projectId" = $1 ORDER BY "createdAt"`,
        [world.projectId.toString()],
      );

    return {
      resource: resource.map((row: { cloudResourceFeedEventType: string }) => {
        return row.cloudResourceFeedEventType;
      }),
      account: account.map((row: { cloudAccountFeedEventType: string }) => {
        return row.cloudAccountFeedEventType;
      }),
    };
  }

  function settings(): CloudConnectionSettings {
    return {
      provider: CloudProvider.AWS,
      projectId: "11111111-1111-4111-8111-111111111111",
      config: {
        authMethod: CloudConnectionAuthMethod.AwsAccessKey,
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      },
      secrets: { secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
    };
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["CLOUD_SAVINGS_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["CLOUD_SAVINGS_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["CLOUD_SAVINGS_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of SEEDED_TABLES) {
      await cloneTable(table, false);
    }

    for (const table of [...WRITTEN_TABLES, ...JOIN_TABLES]) {
      await cloneTable(table, true);
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    // A write's workflows and realtime events are not what these pin.
    jest
      .spyOn(DatabaseService.prototype, "onTriggerRealtime")
      .mockResolvedValue(undefined);
    jest
      .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
      .mockResolvedValue(undefined);

    // The connection's credential: a test key, never decrypted.
    jest
      .spyOn(CloudConnectionService, "getConnectorSettings")
      .mockImplementation(async (): Promise<CloudConnectionSettings> => {
        return settings();
      });
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }

    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    // The worker and the schedules read every project's: each test sees only its own.
    for (const table of [...WRITTEN_TABLES, "CloudOffHoursSchedule"]) {
      await database.query(`DELETE FROM "${schema}"."${table}"`);
    }

    delete process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"];
    delete process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"];
    AssumedRoleCache.clear();
    AwsServerIdentity.clearCache();
  });

  describe("Apply, an owner's approval, and Undo", () => {
    test("asked by a member, made on the owner's approval with a final snapshot, and undone from it", async () => {
      const world: World = await seedWorld();
      const { savingId } = await seedVolumeSaving(world);
      const fake: FakeAwsSavings = fakeEc2();
      const now: Date = new Date();

      const offer: CloudSavingsOffer = await CloudSavingsActions.offer({
        props: world.member.props,
        projectId: world.projectId,
        cloudCostRecommendationId: savingId,
      });

      expect(offer).toMatchObject({
        kind: CloudSavingsActionKind.DeleteVolume,
        undo: CloudSavingsActionUndo.FromSnapshot,
        finalSnapshot: "offered",
        connectionState: CloudSavingsConnectionState.Ready,
        environment: CloudResourceEnvironment.NonProduction,
        approvedBy: "owners",
        canApprove: false,
        canRequest: true,
        needsTwoApprovals: false,
      });
      expect(offer.owners).toEqual([
        { userId: world.owner.userId.toString(), name: "Owner" },
      ]);

      // The member asks: nothing reaches the cloud, it waits for the owner.
      const asked: CloudSavingsActionResult = await CloudSavingsActions.apply({
        props: world.member.props,
        projectId: world.projectId,
        cloudCostRecommendationId: savingId,
        finalSnapshot: true,
        runner: runner(fake, now),
      });

      expect(asked.status).toBe(CloudSavingsActionStatus.Proposed);
      expect(fake.writes()).toEqual([]);

      // Asked again, the same change is answered: never a second one.
      expect(
        (
          await CloudSavingsActions.apply({
            props: world.member.props,
            projectId: world.projectId,
            cloudCostRecommendationId: savingId,
            runner: runner(fake, now),
          })
        ).actionId,
      ).toBe(asked.actionId);

      // The member may not approve their own ask.
      await expect(
        CloudSavingsActions.approve({
          props: world.member.props,
          projectId: world.projectId,
          actionId: new ObjectID(asked.actionId),
          runner: runner(fake, now),
        }),
      ).rejects.toThrow(
        "Only an owner of the resource can approve or undo this change.",
      );

      // The owner approves: the snapshot is taken first, and waited for.
      const approved: CloudSavingsActionResult =
        await CloudSavingsActions.approve({
          props: world.owner.props,
          projectId: world.projectId,
          actionId: new ObjectID(asked.actionId),
          runner: runner(fake, now),
        });

      expect(approved.status).toBe(CloudSavingsActionStatus.Applying);
      expect(fake.writes()).toEqual(["ec2:CreateSnapshot"]);
      expect(fake.volumes.has(VOLUME)).toBe(true);

      // The worker takes it on a minute apart: the snapshot completes, the volume is deleted.
      const later: Date = await stepFor(fake, now, 3);
      const applied: StoredAction = await actionOf(asked.actionId);

      expect(applied).toMatchObject({
        status: CloudSavingsActionStatus.Applied,
        origin: CloudSavingsActionOrigin.Person,
        requestedByUserId: world.member.userId.toString(),
        approvedByUserId: world.owner.userId.toString(),
        finalSnapshot: true,
        undo: CloudSavingsActionUndo.FromSnapshot,
        measurement: CloudSavingsMeasurement.Measuring,
      });
      expect(fake.volumes.has(VOLUME)).toBe(false);
      expect(fake.writes()).toContain("ec2:DeleteVolume");

      // Nothing is due any more.
      expect(
        await CloudSavingsActionRunner.runDue(
          runner(fake, new Date(later.getTime() + 60 * 60 * 1000)),
        ),
      ).toBe(0);

      // Undo makes the volume again from its final snapshot.
      const undoAt: Date = new Date(later.getTime() + 2 * 60 * 60 * 1000);
      const undone: CloudSavingsActionResult = await CloudSavingsActions.undo({
        props: world.owner.props,
        projectId: world.projectId,
        actionId: new ObjectID(asked.actionId),
        runner: runner(fake, undoAt),
      });

      expect([
        CloudSavingsActionStatus.Undoing,
        CloudSavingsActionStatus.Undone,
      ]).toContain(undone.status);

      await stepFor(fake, undoAt, 4);

      expect((await actionOf(asked.actionId)).status).toBe(
        CloudSavingsActionStatus.Undone,
      );
      expect(fake.writes()).toContain("ec2:CreateVolume");

      expect(await feedOf(world)).toEqual({
        resource: [
          "SavingsActionProposed",
          "SavingsActionApplied",
          "SavingsActionUndone",
        ],
        account: [
          "SavingsActionProposed",
          "SavingsActionApplied",
          "SavingsActionUndone",
        ],
      });
    });

    test("an owner's own Apply is made at once, as them", async () => {
      const world: World = await seedWorld();
      const { savingId } = await seedVolumeSaving(world);
      const fake: FakeAwsSavings = fakeEc2();

      const made: CloudSavingsActionResult = await CloudSavingsActions.apply({
        props: world.owner.props,
        projectId: world.projectId,
        cloudCostRecommendationId: savingId,
        finalSnapshot: true,
        runner: runner(fake, new Date()),
      });

      expect(made.status).toBe(CloudSavingsActionStatus.Applying);
      expect((await actionOf(made.actionId)).approvedByUserId).toBe(
        world.owner.userId.toString(),
      );
      expect(fake.writes()[0]).toBe("ec2:CreateSnapshot");
    });

    test("without a final snapshot, the volume is deleted at once and cannot be undone", async () => {
      const world: World = await seedWorld();
      const { savingId } = await seedVolumeSaving(world);
      const fake: FakeAwsSavings = fakeEc2();

      const made: CloudSavingsActionResult = await CloudSavingsActions.apply({
        props: world.owner.props,
        projectId: world.projectId,
        cloudCostRecommendationId: savingId,
        finalSnapshot: false,
        runner: runner(fake, new Date()),
      });

      expect(made.status).toBe(CloudSavingsActionStatus.Applied);
      expect(fake.writes()).toEqual(["ec2:DeleteVolume"]);
      expect((await actionOf(made.actionId)).undo).toBe(
        CloudSavingsActionUndo.Never,
      );

      await expect(
        CloudSavingsActions.undo({
          props: world.owner.props,
          projectId: world.projectId,
          actionId: new ObjectID(made.actionId),
        }),
      ).rejects.toThrow(
        "This change cannot be undone: what it deleted or released is gone.",
      );
    });
  });

  describe("refusals", () => {
    test("with the connection's Savings actions off, nothing is asked of the cloud", async () => {
      const world: World = await seedWorld({
        savingsActions: CloudSavingsActionsAccess.Off,
      });
      const { savingId } = await seedVolumeSaving(world);
      const fake: FakeAwsSavings = fakeEc2();

      expect(
        (
          await CloudSavingsActions.offer({
            props: world.owner.props,
            projectId: world.projectId,
            cloudCostRecommendationId: savingId,
          })
        ).connectionState,
      ).toBe(CloudSavingsConnectionState.SavingsActionsOff);

      await expect(
        CloudSavingsActions.apply({
          props: world.owner.props,
          projectId: world.projectId,
          cloudCostRecommendationId: savingId,
          runner: runner(fake, new Date()),
        }),
      ).rejects.toThrow('Turn on "Savings actions"');

      expect(await actionsOf(world)).toEqual([]);
      expect(fake.calls).toEqual([]);
    });

    test("a change approved before Savings actions were turned off fails, saying so, and changes nothing", async () => {
      const world: World = await seedWorld();
      const { savingId } = await seedVolumeSaving(world);
      const fake: FakeAwsSavings = fakeEc2();
      const now: Date = new Date();

      const asked: CloudSavingsActionResult = await CloudSavingsActions.apply({
        props: world.member.props,
        projectId: world.projectId,
        cloudCostRecommendationId: savingId,
        runner: runner(fake, now),
      });

      await database.query(
        `UPDATE "${schema}"."CloudConnection" SET "config" = jsonb_set("config", '{savingsActions}', '"off"') WHERE "_id" = $1`,
        [world.connectionId.toString()],
      );

      const approved: CloudSavingsActionResult =
        await CloudSavingsActions.approve({
          props: world.owner.props,
          projectId: world.projectId,
          actionId: new ObjectID(asked.actionId),
          runner: runner(fake, now),
        });

      expect(approved.status).toBe(CloudSavingsActionStatus.Failed);
      expect(approved.summary).toContain(
        "Savings actions are off on the account's cloud connection, so nothing was changed.",
      );
      expect(fake.calls).toEqual([]);
      expect((await feedOf(world)).resource).toContain("SavingsActionFailed");
    });

    test("resizing needs its own setting: clean-up access does not resize", async () => {
      const world: World = await seedWorld();
      const resourceId: string = await seedResource(world, {
        type: "AWS::EC2::Instance",
        providerResourceId: DEV_INSTANCE,
        name: "orders-dev",
        tags: { environment: "dev" },
        owners: [world.owner],
      });
      const savingId: ObjectID = await seedSaving(world, {
        cloudResourceId: resourceId,
        kind: CloudSavingKind.Rightsize,
        action: "Rightsize",
        resourceId: arn("instance", DEV_INSTANCE),
        resourceType: "AWS::EC2::Instance",
        monthlySavings: 60,
      });

      await database.query(
        `UPDATE "${schema}"."CloudCostRecommendation" SET "currentConfiguration" = 'm5.large', "recommendedConfiguration" = 'm5.medium' WHERE "_id" = $1`,
        [savingId.toString()],
      );

      expect(
        (
          await CloudSavingsActions.offer({
            props: world.owner.props,
            projectId: world.projectId,
            cloudCostRecommendationId: savingId,
          })
        ).connectionState,
      ).toBe(CloudSavingsConnectionState.ResizeNotGranted);
      await expect(
        CloudSavingsActions.apply({
          props: world.owner.props,
          projectId: world.projectId,
          cloudCostRecommendationId: savingId,
        }),
      ).rejects.toThrow('"Stop, start, clean up and resize"');
    });

    test("an owner who may only view the resource approves nothing", async () => {
      const world: World = await seedWorld();
      const { savingId } = await seedVolumeSaving(world, [world.viewerOwner]);
      const fake: FakeAwsSavings = fakeEc2();

      // A viewer may not ask either.
      await expect(
        CloudSavingsActions.apply({
          props: world.viewerOwner.props,
          projectId: world.projectId,
          cloudCostRecommendationId: savingId,
        }),
      ).rejects.toThrow("You may not act on this project's savings");

      const asked: CloudSavingsActionResult = await CloudSavingsActions.apply({
        props: world.member.props,
        projectId: world.projectId,
        cloudCostRecommendationId: savingId,
        runner: runner(fake, new Date()),
      });

      await expect(
        CloudSavingsActions.approve({
          props: world.viewerOwner.props,
          projectId: world.projectId,
          actionId: new ObjectID(asked.actionId),
          runner: runner(fake, new Date()),
        }),
      ).rejects.toThrow(CLOUD_SAVINGS_MAY_NOT_EDIT_RESOURCE);
      expect((await actionOf(asked.actionId)).status).toBe(
        CloudSavingsActionStatus.Proposed,
      );
      expect(fake.writes()).toEqual([]);
    });

    test("a resource nobody owns is approved by a project admin, not a member", async () => {
      const world: World = await seedWorld();
      const { savingId } = await seedVolumeSaving(world, []);
      const fake: FakeAwsSavings = fakeEc2();

      const offer: CloudSavingsOffer = await CloudSavingsActions.offer({
        props: world.member.props,
        projectId: world.projectId,
        cloudCostRecommendationId: savingId,
      });

      expect(offer.approvedBy).toBe("admins");
      expect(offer.canApprove).toBe(false);

      const asked: CloudSavingsActionResult = await CloudSavingsActions.apply({
        props: world.member.props,
        projectId: world.projectId,
        cloudCostRecommendationId: savingId,
        runner: runner(fake, new Date()),
      });

      expect(asked.status).toBe(CloudSavingsActionStatus.Proposed);
      await expect(
        CloudSavingsActions.approve({
          props: world.member.props,
          projectId: world.projectId,
          actionId: new ObjectID(asked.actionId),
        }),
      ).rejects.toThrow(
        "Nobody owns this resource, so only a project owner or admin can approve or undo this change.",
      );

      const approved: CloudSavingsActionResult =
        await CloudSavingsActions.approve({
          props: world.admin.props,
          projectId: world.projectId,
          actionId: new ObjectID(asked.actionId),
          runner: runner(fake, new Date()),
        });

      expect(approved.status).toBe(CloudSavingsActionStatus.Applying);
    });

    test("undo is an owner's, or whoever approved it", async () => {
      const world: World = await seedWorld();
      const resourceId: string = await seedResource(world, {
        type: "AWS::EC2::Instance",
        providerResourceId: DEV_INSTANCE,
        name: "orders-dev",
        tags: { environment: "dev" },
        owners: [world.owner],
      });
      const savingId: ObjectID = await seedSaving(world, {
        cloudResourceId: resourceId,
        kind: CloudSavingKind.Idle,
        action: "Stop",
        resourceId: arn("instance", DEV_INSTANCE),
        resourceType: "AWS::EC2::Instance",
        monthlySavings: 70,
      });
      const fake: FakeAwsSavings = fakeEc2();

      const made: CloudSavingsActionResult = await CloudSavingsActions.apply({
        props: world.owner.props,
        projectId: world.projectId,
        cloudCostRecommendationId: savingId,
        runner: runner(fake, new Date()),
      });

      expect(made.status).toBe(CloudSavingsActionStatus.Applied);
      expect(fake.writes()).toEqual(["ec2:StopInstances"]);

      await expect(
        CloudSavingsActions.undo({
          props: world.member.props,
          projectId: world.projectId,
          actionId: new ObjectID(made.actionId),
        }),
      ).rejects.toThrow(
        "Only an owner of the resource can approve or undo this change.",
      );

      const undone: CloudSavingsActionResult = await CloudSavingsActions.undo({
        props: world.owner.props,
        projectId: world.projectId,
        actionId: new ObjectID(made.actionId),
        runner: runner(fake, new Date()),
      });

      expect(undone.status).toBe(CloudSavingsActionStatus.Undone);
      expect(fake.writes()).toEqual([
        "ec2:StopInstances",
        "ec2:StartInstances",
      ]);

      // Undone, it cannot be undone again.
      await expect(
        CloudSavingsActions.undo({
          props: world.owner.props,
          projectId: world.projectId,
          actionId: new ObjectID(made.actionId),
        }),
      ).rejects.toThrow(
        "Only a change that was made and stands can be undone.",
      );
    });
  });

  describe("two approvals, and two people at once", () => {
    async function seedAddressSaving(world: World): Promise<ObjectID> {
      const resourceId: string = await seedResource(world, {
        type: "AWS::EC2::EIP",
        providerResourceId: ADDRESS,
        name: "old-nat-ip",
        tags: { environment: "dev" },
        owners: [world.owner, world.secondOwner],
      });

      return await seedSaving(world, {
        cloudResourceId: resourceId,
        kind: CloudSavingKind.Idle,
        action: "Delete",
        resourceId: arn("elastic-ip", ADDRESS),
        resourceType: "AWS::EC2::EIP",
        monthlySavings: 3.6,
      });
    }

    test("a change that cannot be undone takes two people where the project asks for two", async () => {
      const world: World = await seedWorld({ requireTwoApprovals: true });
      const savingId: ObjectID = await seedAddressSaving(world);
      const fake: FakeAwsSavings = fakeEc2();

      expect(
        (
          await CloudSavingsActions.offer({
            props: world.owner.props,
            projectId: world.projectId,
            cloudCostRecommendationId: savingId,
          })
        ).needsTwoApprovals,
      ).toBe(true);

      // The owner's own Apply is the first approval: nothing is released.
      const first: CloudSavingsActionResult = await CloudSavingsActions.apply({
        props: world.owner.props,
        projectId: world.projectId,
        cloudCostRecommendationId: savingId,
        runner: runner(fake, new Date()),
      });

      expect(first).toMatchObject({
        status: CloudSavingsActionStatus.Proposed,
        waitsForSecondApproval: true,
      });
      expect(fake.writes()).toEqual([]);

      await expect(
        CloudSavingsActions.approve({
          props: world.owner.props,
          projectId: world.projectId,
          actionId: new ObjectID(first.actionId),
        }),
      ).rejects.toThrow(
        "You approved this change already. It cannot be undone, so a second person must approve it too.",
      );

      const second: CloudSavingsActionResult =
        await CloudSavingsActions.approve({
          props: world.secondOwner.props,
          projectId: world.projectId,
          actionId: new ObjectID(first.actionId),
          runner: runner(fake, new Date()),
        });

      expect(second.status).toBe(CloudSavingsActionStatus.Applied);
      expect(fake.writes()).toEqual(["ec2:ReleaseAddress"]);
      expect(await actionOf(first.actionId)).toMatchObject({
        firstApprovedByUserId: world.owner.userId.toString(),
        approvedByUserId: world.secondOwner.userId.toString(),
        undo: CloudSavingsActionUndo.Never,
      });
    });

    test("one approval is enough where the project does not ask for two", async () => {
      const world: World = await seedWorld({ requireTwoApprovals: false });
      const savingId: ObjectID = await seedAddressSaving(world);
      const fake: FakeAwsSavings = fakeEc2();

      expect(
        (
          await CloudSavingsActions.apply({
            props: world.owner.props,
            projectId: world.projectId,
            cloudCostRecommendationId: savingId,
            runner: runner(fake, new Date()),
          })
        ).status,
      ).toBe(CloudSavingsActionStatus.Applied);
    });

    test("two owners approving at the same moment make the change once", async () => {
      const world: World = await seedWorld();
      const { savingId } = await seedVolumeSaving(world, [
        world.owner,
        world.secondOwner,
      ]);
      const fake: FakeAwsSavings = fakeEc2();
      const asked: CloudSavingsActionResult = await CloudSavingsActions.apply({
        props: world.member.props,
        projectId: world.projectId,
        cloudCostRecommendationId: savingId,
        runner: runner(fake, new Date()),
      });

      const answers: Array<PromiseSettledResult<CloudSavingsActionResult>> =
        await Promise.allSettled(
          [world.owner, world.secondOwner].map(
            (someone: Person): Promise<CloudSavingsActionResult> => {
              return CloudSavingsActions.approve({
                props: someone.props,
                projectId: world.projectId,
                actionId: new ObjectID(asked.actionId),
                runner: runner(fake, new Date()),
              });
            },
          ),
        );
      const fulfilled: number = answers.filter(
        (answer: PromiseSettledResult<CloudSavingsActionResult>): boolean => {
          return answer.status === "fulfilled";
        },
      ).length;

      expect(fulfilled).toBe(1);
      expect(
        fake.writes().filter((write: string): boolean => {
          return write === "ec2:CreateSnapshot";
        }),
      ).toHaveLength(1);
    });

    test("two workers due the same step at once take it once", async () => {
      const world: World = await seedWorld();
      const { savingId } = await seedVolumeSaving(world);
      const fake: FakeAwsSavings = fakeEc2();
      const now: Date = new Date();
      const made: CloudSavingsActionResult = await CloudSavingsActions.apply({
        props: world.owner.props,
        projectId: world.projectId,
        cloudCostRecommendationId: savingId,
        runner: runner(fake, now),
      });

      expect(made.status).toBe(CloudSavingsActionStatus.Applying);

      const later: Date = new Date(now.getTime() + 2 * 60 * 1000);
      const stepped: Array<number> = await Promise.all([
        CloudSavingsActionRunner.runDue(runner(fake, later)),
        CloudSavingsActionRunner.runDue(runner(fake, later)),
      ]);

      expect(
        stepped.reduce((total: number, count: number): number => {
          return total + count;
        }, 0),
      ).toBeLessThanOrEqual(1);
      expect(
        fake.writes().filter((write: string): boolean => {
          return write === "ec2:DeleteVolume";
        }).length,
      ).toBeLessThanOrEqual(1);
    });
  });

  describe("dismissing, and savings that went", () => {
    test("a dismissal says why, and is the owner's or the asker's", async () => {
      const world: World = await seedWorld();
      const { savingId } = await seedVolumeSaving(world);
      const asked: CloudSavingsActionResult = await CloudSavingsActions.apply({
        props: world.member.props,
        projectId: world.projectId,
        cloudCostRecommendationId: savingId,
      });

      await expect(
        CloudSavingsActions.dismiss({
          props: world.owner.props,
          projectId: world.projectId,
          actionId: new ObjectID(asked.actionId),
          reason: "  ",
        }),
      ).rejects.toThrow(CLOUD_SAVINGS_DISMISS_REASON_REQUIRED);

      await expect(
        CloudSavingsActions.dismiss({
          props: world.admin.props,
          projectId: world.projectId,
          actionId: new ObjectID(asked.actionId),
          reason: "Not mine to say",
        }),
      ).rejects.toThrow("Only an owner of the resource");

      expect(
        (
          await CloudSavingsActions.dismiss({
            props: world.owner.props,
            projectId: world.projectId,
            actionId: new ObjectID(asked.actionId),
            reason: "The nightly restore still reads it.",
          })
        ).status,
      ).toBe(CloudSavingsActionStatus.Dismissed);
      expect((await actionOf(asked.actionId)).dismissReason).toBe(
        "The nightly restore still reads it.",
      );
      expect((await feedOf(world)).resource).toEqual([
        "SavingsActionProposed",
        "SavingsActionDismissed",
      ]);

      // Dismissed, it is not waiting for anyone's approval any more.
      await expect(
        CloudSavingsActions.approve({
          props: world.owner.props,
          projectId: world.projectId,
          actionId: new ObjectID(asked.actionId),
        }),
      ).rejects.toThrow("This change is no longer waiting for an approval.");
    });

    test("a proposal whose saving the recommender no longer makes expires", async () => {
      const world: World = await seedWorld();
      const { savingId } = await seedVolumeSaving(world);
      const asked: CloudSavingsActionResult = await CloudSavingsActions.apply({
        props: world.member.props,
        projectId: world.projectId,
        cloudCostRecommendationId: savingId,
      });

      await database.query(
        `DELETE FROM "${schema}"."CloudCostRecommendation" WHERE "_id" = $1`,
        [savingId.toString()],
      );

      const outcome: CloudSavingsAiOutcome =
        await CloudSavingsAiEngine.evaluateAccounts({
          projectId: world.projectId,
          cloudAccountIds: [world.accountId],
          now: new Date(),
        });

      expect(outcome.expired).toBe(1);
      expect(await actionOf(asked.actionId)).toMatchObject({
        status: CloudSavingsActionStatus.Expired,
        summary:
          "No longer needed: the recommender no longer makes this saving.",
      });
    });
  });

  describe("AI rules for savings", () => {
    async function seedRule(
      world: World,
      data: {
        name: string;
        autonomy: CloudSavingsAiAutonomy;
        limit?: number;
        groups?: Array<CloudSavingsActionGroup>;
        environments?: Array<CloudResourceEnvironment>;
      },
    ): Promise<void> {
      await insertRow("AutoRemediationRule", {
        projectId: world.projectId.toString(),
        name: data.name,
        isEnabled: true,
        triggerEntityType: AutoRemediationTriggerEntity.CloudSaving,
        cloudSavingAutonomy: data.autonomy,
        cloudSavingMonthlyLimit: data.limit ?? 500,
        cloudSavingActionGroups: data.groups || [],
        cloudSavingEnvironments: data.environments || [],
        cloudSavingProviders: [],
      });
    }

    // Idle instances: one of a dev stack, one of production, one nothing says.
    async function seedIdleInstances(
      world: World,
      monthly: { dev?: number; prod?: number; unknown?: number } = {},
    ): Promise<Record<"dev" | "prod" | "unknown", ObjectID>> {
      const savings: Partial<Record<"dev" | "prod" | "unknown", ObjectID>> = {};

      for (const [key, id, tags] of [
        ["dev", DEV_INSTANCE, { environment: "dev" }],
        ["prod", PROD_INSTANCE, { environment: "production" }],
        ["unknown", UNKNOWN_INSTANCE, { team: "orders" }],
      ] as Array<
        ["dev" | "prod" | "unknown", string, Record<string, string>]
      >) {
        const resourceId: string = await seedResource(world, {
          type: "AWS::EC2::Instance",
          providerResourceId: id,
          name: `${key}-instance`,
          tags,
          owners: [world.owner],
        });

        savings[key] = await seedSaving(world, {
          cloudResourceId: resourceId,
          kind: CloudSavingKind.Idle,
          action: "Stop",
          resourceId: arn("instance", id),
          resourceType: "AWS::EC2::Instance",
          monthlySavings: monthly[key] ?? 40,
          recommendationId: `idle-${key}`,
        });
      }

      return savings as Record<"dev" | "prod" | "unknown", ObjectID>;
    }

    function byResource(
      actions: Array<StoredAction>,
    ): Record<string, StoredAction> {
      const result: Record<string, StoredAction> = {};

      for (const action of actions) {
        result[(action as unknown as { resourceId: string }).resourceId] =
          action;
      }

      return result;
    }

    test("with Enable AI off, nothing is proposed or made", async () => {
      const world: World = await seedWorld({ enableAi: false });
      await seedIdleInstances(world);
      await seedRule(world, {
        name: "Stop dev",
        autonomy: CloudSavingsAiAutonomy.WithoutAsking,
      });

      expect(
        await CloudSavingsAiEngine.evaluateAccounts({
          projectId: world.projectId,
          cloudAccountIds: [world.accountId],
          now: new Date(),
        }),
      ).toEqual({ proposed: 0, madeWithoutAsking: 0, expired: 0 });
      expect(await actionsOf(world)).toEqual([]);
    });

    test("with no rule, every saving OneUptime can make is proposed, and nothing made", async () => {
      const world: World = await seedWorld();
      await seedIdleInstances(world);

      const outcome: CloudSavingsAiOutcome =
        await CloudSavingsAiEngine.evaluateAccounts({
          projectId: world.projectId,
          cloudAccountIds: [world.accountId],
          now: new Date(),
        });

      expect(outcome).toEqual({
        proposed: 3,
        madeWithoutAsking: 0,
        expired: 0,
      });
      expect(
        (await actionsOf(world)).map((action: StoredAction): string => {
          return action.status;
        }),
      ).toEqual([
        CloudSavingsActionStatus.Proposed,
        CloudSavingsActionStatus.Proposed,
        CloudSavingsActionStatus.Proposed,
      ]);

      // A second read asks nothing again.
      expect(
        (
          await CloudSavingsAiEngine.evaluateAccounts({
            projectId: world.projectId,
            cloudAccountIds: [world.accountId],
            now: new Date(),
          })
        ).proposed,
      ).toBe(0);
    });

    test("a rule makes only known non-production within its limit; production and the unknown wait for a person", async () => {
      const world: World = await seedWorld();
      await seedIdleInstances(world, { dev: 40, prod: 40, unknown: 40 });
      await seedRule(world, {
        name: "Stop idle dev",
        autonomy: CloudSavingsAiAutonomy.WithoutAsking,
        limit: 100,
        groups: [CloudSavingsActionGroup.Stop],
      });

      const now: Date = new Date();
      const outcome: CloudSavingsAiOutcome =
        await CloudSavingsAiEngine.evaluateAccounts({
          projectId: world.projectId,
          cloudAccountIds: [world.accountId],
          now,
        });

      expect(outcome).toEqual({
        proposed: 2,
        madeWithoutAsking: 1,
        expired: 0,
      });

      const actions: Record<string, StoredAction> = byResource(
        await actionsOf(world),
      );

      expect(actions[arn("instance", DEV_INSTANCE)]).toMatchObject({
        status: CloudSavingsActionStatus.Applying,
        origin: CloudSavingsActionOrigin.Rule,
        autoRemediationRuleName: "Stop idle dev",
        environment: CloudResourceEnvironment.NonProduction,
      });
      expect(actions[arn("instance", PROD_INSTANCE)]).toMatchObject({
        status: CloudSavingsActionStatus.Proposed,
        environment: CloudResourceEnvironment.Production,
      });
      expect(actions[arn("instance", UNKNOWN_INSTANCE)]).toMatchObject({
        status: CloudSavingsActionStatus.Proposed,
        environment: CloudResourceEnvironment.Unknown,
      });

      // The read never waits on the cloud: the worker makes it.
      const fake: FakeAwsSavings = fakeEc2();

      expect(fake.calls).toEqual([]);
      expect(await CloudSavingsActionRunner.runDue(runner(fake, now))).toBe(1);
      expect(fake.writes()).toEqual(["ec2:StopInstances"]);
      expect(fake.instances.get(PROD_INSTANCE)?.state).toBe("running");
      expect(
        (await actionOf(actions[arn("instance", DEV_INSTANCE)]!._id)).status,
      ).toBe(CloudSavingsActionStatus.AppliedWithoutAsking);
      expect((await feedOf(world)).resource).toContain("SavingsActionApplied");
    });

    test("a saving over the rule's limit is proposed instead", async () => {
      const world: World = await seedWorld();
      await seedIdleInstances(world, { dev: 400 });
      await seedRule(world, {
        name: "Stop idle dev",
        autonomy: CloudSavingsAiAutonomy.WithoutAsking,
        limit: 100,
        environments: [CloudResourceEnvironment.NonProduction],
      });

      const outcome: CloudSavingsAiOutcome =
        await CloudSavingsAiEngine.evaluateAccounts({
          projectId: world.projectId,
          cloudAccountIds: [world.accountId],
          now: new Date(),
        });

      // Production and the unknown are not this rule's: they are left.
      expect(outcome).toEqual({
        proposed: 1,
        madeWithoutAsking: 0,
        expired: 0,
      });
      expect(byResource(await actionsOf(world))).toEqual({
        [arn("instance", DEV_INSTANCE)]: expect.objectContaining({
          status: CloudSavingsActionStatus.Proposed,
          autoRemediationRuleName: "Stop idle dev",
        }),
      });
    });

    test("the circuit breaker: after ten changes made without asking this hour, the rest are proposed", async () => {
      const world: World = await seedWorld();
      await seedIdleInstances(world);
      await seedRule(world, {
        name: "Stop idle dev",
        autonomy: CloudSavingsAiAutonomy.WithoutAsking,
      });

      const now: Date = new Date();

      for (let made: number = 0; made < 10; made++) {
        await database.query(
          `INSERT INTO "${schema}"."CloudSavingsAction" ("_id", "projectId", "cloudAccountId", "recommendationId", "provider", "kind", "status", "origin", "environment", "resourceId", "resourceName", "undo", "finalSnapshot", "monthlySavings", "currency", "version", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, 'AWS', 'StopInstance', 'AppliedWithoutAsking', 'Rule', 'NonProduction', $4, $4, 'Undoable', false, 10, 'USD', 1, $5, $5)`,
          [
            ObjectID.generate().toString(),
            world.projectId.toString(),
            world.accountId.toString(),
            `earlier-${made}`,
            new Date(now.getTime() - 10 * 60 * 1000),
          ],
        );
      }

      expect(
        await CloudSavingsAiEngine.countChangesWithoutAskingThisHour({
          projectId: world.projectId,
          now,
        }),
      ).toBe(10);

      const outcome: CloudSavingsAiOutcome =
        await CloudSavingsAiEngine.evaluateAccounts({
          projectId: world.projectId,
          cloudAccountIds: [world.accountId],
          now,
        });

      expect(outcome.madeWithoutAsking).toBe(0);
      expect(
        byResource(await actionsOf(world))[arn("instance", DEV_INSTANCE)]
          ?.status,
      ).toBe(CloudSavingsActionStatus.Proposed);
    });

    test("a rule that says Off leaves the savings it covers, whatever another says", async () => {
      const world: World = await seedWorld();
      await seedIdleInstances(world);
      await seedRule(world, {
        name: "Act",
        autonomy: CloudSavingsAiAutonomy.WithoutAsking,
      });
      await seedRule(world, {
        name: "Never on dev",
        autonomy: CloudSavingsAiAutonomy.Off,
        environments: [CloudResourceEnvironment.NonProduction],
      });

      await CloudSavingsAiEngine.evaluateAccounts({
        projectId: world.projectId,
        cloudAccountIds: [world.accountId],
        now: new Date(),
      });

      expect(
        byResource(await actionsOf(world))[arn("instance", DEV_INSTANCE)],
      ).toBeUndefined();
    });

    test("a change a person undid is not made again for a month", async () => {
      const world: World = await seedWorld();
      await seedIdleInstances(world);
      await seedRule(world, {
        name: "Stop idle dev",
        autonomy: CloudSavingsAiAutonomy.WithoutAsking,
        environments: [CloudResourceEnvironment.NonProduction],
      });

      const now: Date = new Date();
      const fake: FakeAwsSavings = fakeEc2();

      await CloudSavingsAiEngine.evaluateAccounts({
        projectId: world.projectId,
        cloudAccountIds: [world.accountId],
        now,
      });
      await CloudSavingsActionRunner.runDue(runner(fake, now));

      const made: StoredAction = byResource(await actionsOf(world))[
        arn("instance", DEV_INSTANCE)
      ]!;

      expect(made.status).toBe(CloudSavingsActionStatus.AppliedWithoutAsking);

      // Made without asking, it is undone by an owner - nobody approved it.
      expect(
        (
          await CloudSavingsActions.undo({
            props: world.owner.props,
            projectId: world.projectId,
            actionId: new ObjectID(made._id),
            runner: runner(fake, now),
          })
        ).status,
      ).toBe(CloudSavingsActionStatus.Undone);

      expect(
        await CloudSavingsAiEngine.evaluateAccounts({
          projectId: world.projectId,
          cloudAccountIds: [world.accountId],
          now: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        }),
      ).toEqual({ proposed: 0, madeWithoutAsking: 0, expired: 0 });
      expect(fake.writes()).toEqual([
        "ec2:StopInstances",
        "ec2:StartInstances",
      ]);
    });
  });

  describe("off-hours schedules", () => {
    // Monday 23 November 2026, in UTC: working hours 08:00 to 19:00.
    const MONDAY_EVENING: Date = new Date("2026-11-23T19:05:00Z");
    const MONDAY_LATER: Date = new Date("2026-11-23T21:00:00Z");
    const TUESDAY_MORNING: Date = new Date("2026-11-24T08:05:00Z");

    async function seedScheduledInstances(world: World): Promise<void> {
      for (const [id, name, tags] of [
        [
          DEV_INSTANCE,
          "orders-dev",
          { environment: "dev", Schedule: "office-hours" },
        ],
        [
          PROD_INSTANCE,
          "orders-prod",
          { environment: "production", Schedule: "office-hours" },
        ],
        [UNKNOWN_INSTANCE, "orders-misc", { Schedule: "office-hours" }],
      ] as Array<[string, string, Record<string, string>]>) {
        await seedResource(world, {
          type: "AWS::EC2::Instance",
          providerResourceId: id,
          name,
          tags,
        });
      }
    }

    async function seedSchedule(
      world: World,
      data: { isEnabled?: boolean } = {},
    ): Promise<string> {
      return await insertRow("CloudOffHoursSchedule", {
        projectId: world.projectId.toString(),
        name: "Office hours",
        isEnabled: data.isEnabled !== false,
        tagKey: "Schedule",
        tagValue: "office-hours",
        timezone: "UTC",
        workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        startTime: "08:00",
        stopTime: "19:00",
        stopsInstances: true,
        stopsDatabases: true,
      });
    }

    async function scheduleRow(
      id: string,
    ): Promise<{ lastRunSummary: CloudOffHoursRunSummary }> {
      const rows: Array<{ lastRunSummary: CloudOffHoursRunSummary }> =
        await database.query(
          `SELECT "lastRunSummary" FROM "${schema}"."CloudOffHoursSchedule" WHERE "_id" = $1`,
          [id],
        );

      return rows[0]!;
    }

    test("stops known non-production when working hours end, never production or the unknown, and starts it again when they begin", async () => {
      const world: World = await seedWorld();
      await seedScheduledInstances(world);
      const scheduleId: string = await seedSchedule(world);
      const fake: FakeAwsSavings = fakeEc2();

      const preview: CloudOffHoursPreview =
        await CloudOffHoursScheduler.preview({
          projectId: world.projectId,
          scheduleId: new ObjectID(scheduleId),
          now: MONDAY_EVENING,
        });

      expect(
        preview.resources
          .map((resource: { name: string; skipReason?: string }): string => {
            return `${resource.name}: ${resource.skipReason || "stopped"}`;
          })
          .sort(),
      ).toEqual([
        "orders-dev: stopped",
        `orders-misc: ${CloudOffHoursSkipReason.EnvironmentNotKnown}`,
        `orders-prod: ${CloudOffHoursSkipReason.Production}`,
      ]);
      expect(fake.calls).toEqual([]);

      // 19:05 on a Monday: working hours ended.
      expect(
        await CloudOffHoursScheduler.runAll(runner(fake, MONDAY_EVENING)),
      ).toBe(1);
      expect(fake.writes()).toEqual(["ec2:StopInstances"]);
      expect(fake.instances.get(DEV_INSTANCE)?.state).not.toBe("running");
      expect(fake.instances.get(PROD_INSTANCE)?.state).toBe("running");
      expect(fake.instances.get(UNKNOWN_INSTANCE)?.state).toBe("running");
      expect((await scheduleRow(scheduleId)).lastRunSummary).toMatchObject({
        runningNow: false,
        matched: 3,
        stopped: 1,
        skippedProduction: 1,
        skippedNotKnown: 1,
        nextChangeAt: "2026-11-24T08:00:00.000Z",
      });

      const stop: StoredAction = (await actionsOf(world))[0]!;

      expect(stop).toMatchObject({
        origin: CloudSavingsActionOrigin.Schedule,
        cloudOffHoursScheduleId: scheduleId,
        kind: CloudSavingsActionKind.StopInstance,
      });

      // Later that night it does nothing more: it acts when its hours change.
      await CloudSavingsActionRunner.runDue(runner(fake, MONDAY_LATER));
      expect(
        await CloudOffHoursScheduler.runAll(runner(fake, MONDAY_LATER)),
      ).toBe(0);
      expect((await actionOf(stop._id)).status).toBe(
        CloudSavingsActionStatus.Applied,
      );

      // 08:05 on Tuesday: it starts what it stopped, and only that.
      expect(
        await CloudOffHoursScheduler.runAll(runner(fake, TUESDAY_MORNING)),
      ).toBe(1);
      expect(fake.writes()).toEqual([
        "ec2:StopInstances",
        "ec2:StartInstances",
      ]);

      const ended: StoredAction = await actionOf(stop._id);

      expect(ended.status).toBe(CloudSavingsActionStatus.Ended);
      expect(Number(ended.savedHours)).toBeCloseTo(13, 1);
      expect((await scheduleRow(scheduleId)).lastRunSummary).toMatchObject({
        runningNow: true,
        started: 1,
        nextChangeAt: "2026-11-24T19:00:00.000Z",
      });
    });

    test("a schedule leaves running what its account's connection may not stop", async () => {
      const world: World = await seedWorld({
        savingsActions: CloudSavingsActionsAccess.Off,
      });
      await seedScheduledInstances(world);
      const scheduleId: string = await seedSchedule(world);
      const fake: FakeAwsSavings = fakeEc2();

      await CloudOffHoursScheduler.runAll(runner(fake, MONDAY_EVENING));

      expect(fake.calls).toEqual([]);
      expect((await scheduleRow(scheduleId)).lastRunSummary).toMatchObject({
        stopped: 0,
        skippedNoAccess: 1,
        skippedProduction: 1,
        skippedNotKnown: 1,
      });
    });

    test("an account marked non-production is stopped by a schedule, unless a resource's own tag says production", async () => {
      const world: World = await seedWorld({
        accountEnvironment: CloudResourceEnvironment.NonProduction,
      });
      await seedScheduledInstances(world);
      await seedSchedule(world);
      const fake: FakeAwsSavings = fakeEc2();

      await CloudOffHoursScheduler.runAll(runner(fake, MONDAY_EVENING));

      expect(fake.instances.get(DEV_INSTANCE)?.state).not.toBe("running");
      expect(fake.instances.get(UNKNOWN_INSTANCE)?.state).not.toBe("running");
      expect(fake.instances.get(PROD_INSTANCE)?.state).toBe("running");
    });

    test("a schedule turned off at night starts what it stopped when its hours begin, and stops nothing more", async () => {
      const world: World = await seedWorld();
      await seedScheduledInstances(world);
      const scheduleId: string = await seedSchedule(world);
      const fake: FakeAwsSavings = fakeEc2();

      await CloudOffHoursScheduler.runAll(runner(fake, MONDAY_EVENING));
      await database.query(
        `UPDATE "${schema}"."CloudOffHoursSchedule" SET "isEnabled" = false WHERE "_id" = $1`,
        [scheduleId],
      );

      // Still night: it waits for its hours.
      await CloudOffHoursScheduler.runAll(runner(fake, MONDAY_LATER));
      expect(fake.writes()).toEqual(["ec2:StopInstances"]);

      await CloudOffHoursScheduler.runAll(runner(fake, TUESDAY_MORNING));
      expect(fake.writes()).toEqual([
        "ec2:StopInstances",
        "ec2:StartInstances",
      ]);

      // Tuesday evening, turned off, it stops nothing.
      await CloudOffHoursScheduler.runAll(
        runner(fake, new Date("2026-11-24T19:05:00Z")),
      );
      expect(fake.writes()).toEqual([
        "ec2:StopInstances",
        "ec2:StartInstances",
      ]);
    });

    test("what a deleted schedule stopped is started at once", async () => {
      const world: World = await seedWorld();
      await seedScheduledInstances(world);
      const scheduleId: string = await seedSchedule(world);
      const fake: FakeAwsSavings = fakeEc2();

      await CloudOffHoursScheduler.runAll(runner(fake, MONDAY_EVENING));
      // Deleted: the foreign key sets the stop's schedule to nothing.
      await database.query(
        `UPDATE "${schema}"."CloudSavingsAction" SET "cloudOffHoursScheduleId" = NULL WHERE "cloudOffHoursScheduleId" = $1`,
        [scheduleId],
      );
      await database.query(
        `DELETE FROM "${schema}"."CloudOffHoursSchedule" WHERE "_id" = $1`,
        [scheduleId],
      );

      await CloudOffHoursScheduler.runAll(runner(fake, MONDAY_LATER));

      expect(fake.writes()).toEqual([
        "ec2:StopInstances",
        "ec2:StartInstances",
      ]);
    });

    test("what the schedules stopped is counted on the Savings page in hours", async () => {
      const world: World = await seedWorld();
      await seedScheduledInstances(world);
      await seedSchedule(world);
      const fake: FakeAwsSavings = fakeEc2();

      await CloudOffHoursScheduler.runAll(runner(fake, MONDAY_EVENING));
      await CloudOffHoursScheduler.runAll(runner(fake, TUESDAY_MORNING));

      const summary: CloudSavingsSummary = await CloudSavingsSummaryReader.read(
        {
          props: world.owner.props,
          projectId: world.projectId,
          now: new Date("2026-11-24T12:00:00Z"),
        },
      );

      expect(summary.scheduledHoursThisMonth).toBeCloseTo(13, 0);
      // A schedule's stops are not changes a person reviews.
      expect(summary.changesCount).toBe(0);
    });
  });

  describe("proved by the bill", () => {
    test("a change the bill shows is kept as realised, and Saved this month adds up only that", async () => {
      const world: World = await seedWorld();
      const { savingId } = await seedVolumeSaving(world);
      const fake: FakeAwsSavings = fakeEc2();
      const statements: Array<Statement> = [];

      // Deleted on 10 November without a final snapshot: made at once.
      const made: CloudSavingsActionResult = await CloudSavingsActions.apply({
        props: world.owner.props,
        projectId: world.projectId,
        cloudCostRecommendationId: savingId,
        finalSnapshot: false,
        runner: runner(fake, new Date("2026-11-10T15:00:00Z")),
      });

      expect((await actionOf(made.actionId)).measurement).toBe(
        CloudSavingsMeasurement.Measuring,
      );

      // The cost lane's read, answered as ClickHouse answers the statement.
      const cost: ReturnType<typeof jest.spyOn> = jest
        .spyOn(CloudCostService, "executeQuery")
        .mockImplementation(async (statement: unknown): Promise<never> => {
          statements.push(statement as Statement);
          return {
            json: async (): Promise<unknown> => {
              return {
                data: [
                  {
                    beforeTotal: 70,
                    beforeDays: 7,
                    afterTotal: 0,
                    lastDayRows: 12,
                  },
                ],
              };
            },
          } as never;
        });

      try {
        expect(
          await CloudSavingsBillReader.measureProject({
            projectId: world.projectId,
            now: new Date("2026-11-16T09:00:00Z"),
          }),
        ).toBe(1);
      } finally {
        cost.mockRestore();
      }

      // Read for this project's account, by the volume's ids.
      expect(statements).toHaveLength(1);
      expect(JSON.stringify(statements[0]!.query_params)).toContain(
        world.projectId.toString(),
      );
      expect(JSON.stringify(statements[0]!.query_params)).toContain(VOLUME);

      expect(await actionOf(made.actionId)).toMatchObject({
        measurement: CloudSavingsMeasurement.Realised,
        realisedMonthlySavings: "304.38",
        costBeforeDaily: "10",
        costAfterDaily: "0",
      });

      // 10 a day, from the 11th to the 16th: 50 saved this month.
      expect(
        await CloudSavingsSummaryReader.read({
          props: world.owner.props,
          projectId: world.projectId,
          now: new Date("2026-11-16T12:00:00Z"),
        }),
      ).toMatchObject({
        currency: "USD",
        savedThisMonth: 50,
        realisedCount: 1,
        measuringCount: 0,
        changesCount: 1,
        waitingCount: 0,
      });
    });
  });

  describe("the Savings page's strip", () => {
    test("counts what waits, and what waits for the reader", async () => {
      const world: World = await seedWorld();
      const { savingId } = await seedVolumeSaving(world);

      await CloudSavingsActions.apply({
        props: world.member.props,
        projectId: world.projectId,
        cloudCostRecommendationId: savingId,
      });

      const now: Date = new Date();

      expect(
        await CloudSavingsSummaryReader.read({
          props: world.owner.props,
          projectId: world.projectId,
          now,
        }),
      ).toMatchObject({ waitingCount: 1, waitingForYouCount: 1 });
      expect(
        await CloudSavingsSummaryReader.read({
          props: world.member.props,
          projectId: world.projectId,
          now,
        }),
      ).toMatchObject({ waitingCount: 1, waitingForYouCount: 0 });
    });
  });
});
