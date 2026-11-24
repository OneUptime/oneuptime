import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import AlertService from "../../../../Server/Services/AlertService";
import AlertSeverityService from "../../../../Server/Services/AlertSeverityService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import AlertStateTimelineService from "../../../../Server/Services/AlertStateTimelineService";
import CloudCommitmentService from "../../../../Server/Services/CloudCommitmentService";
import CloudCostSettingService, {
  CLOUD_COMMITMENT_EXPIRY_DAYS_ERROR,
  CLOUD_COMMITMENT_THRESHOLD_ERROR,
  CLOUD_COST_BASIS_ERROR,
} from "../../../../Server/Services/CloudCostSettingService";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import CloudCommitmentAlertEvaluator from "../../../../Server/Utils/CloudConnection/CloudCommitmentAlertEvaluator";
import CloudCommitmentWriter, {
  CloudCommitmentWriteResult,
} from "../../../../Server/Utils/CloudConnection/CloudCommitmentWriter";
import { CloudCommitmentRecord } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import AlertStateTimeline from "../../../../Models/DatabaseModels/AlertStateTimeline";
import CloudCommitment from "../../../../Models/DatabaseModels/CloudCommitment";
import CloudCostSetting from "../../../../Models/DatabaseModels/CloudCostSetting";
import Entities from "../../../../Models/DatabaseModels/Index";
import { CloudCostState } from "../../../../Types/Cloud/CloudCost";
import { CloudCostBasis } from "../../../../Types/Cloud/CloudCostBasis";
import { CloudCommitmentKind } from "../../../../Types/Cloud/CloudCommitments";
import {
  CloudCommitmentPaymentOption,
  CloudCommitmentScope,
  CloudCommitmentState,
} from "../../../../Types/Cloud/CloudCommitmentInventory";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import Dictionary from "../../../../Types/Dictionary";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { getJestSpyOn } from "../../../Spy";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * A PROJECT'S COMMITMENTS AND CLOUD COST SETTINGS, ON A MIGRATED POSTGRES
 * (#11007, #11011).
 *
 * The tables are copied from public into a schema of the suite's own, and
 * the services read and write them through TypeORM as the app does:
 *
 *   - the cost settings are one row a project, made with every default the
 *     first time anything asks - by three callers at once too - and a write
 *     that is not a setting's value is refused in words to act on;
 *   - each read of a connection's commitments creates, updates and removes
 *     rows: the cloud's figures as numbers, dates and JSON, a commitment
 *     no longer listed removed only when its account was read in full;
 *   - the alert evaluator reads the commitments, raises an expiry and an
 *     under-use alert, keeps what it raised on each row, raises nothing
 *     twice, resolves what recovered, and keeps each account's coverage on
 *     the settings. Alerts themselves are stood in: their own suites hold
 *     what an alert does once raised.
 *
 * Opt in with RUN_POSTGRES_CLOUD_COMMITMENTS_TESTS=true against a database
 * the registered migrations have been applied to, e.g. from packages/Common:
 *
 *   RUN_POSTGRES_CLOUD_COMMITMENTS_TESTS=true \
 *   CLOUD_COMMITMENTS_TEST_DATABASE_HOST=127.0.0.1 \
 *   CLOUD_COMMITMENTS_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest --runInBand <this file>
 *
 * The schema is dropped afterwards; every row is synthetic.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_CLOUD_COMMITMENTS_TESTS"] === "true"
    ? describe
    : describe.skip;

jest.setTimeout(120000);

jest.mock("../../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: false,
  };
});

// The data source below is built here; the app's own needs no migrations.
jest.mock(
  "../../../../Server/Infrastructure/Postgres/DataSourceOptions",
  () => {
    return {};
  },
);

// The audit trail of a write is written elsewhere.
jest.mock("../../../../Server/Services/AuditLogService", () => {
  return {
    __esModule: true,
    default: {
      recordCreate: jest.fn(),
      recordUpdate: jest.fn(),
      recordDelete: jest.fn(),
    },
  };
});

const TABLES: Array<string> = [
  "CloudAccount",
  "CloudCommitment",
  "CloudCostSetting",
  "CloudCostSettingOnCallDutyPolicy",
  "CloudCostSettingOwnerUser",
  "CloudCostSettingOwnerTeam",
];

const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const DAY_MS: number = 24 * 60 * 60 * 1000;

function databaseOptions(): {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
} {
  return {
    host: process.env["CLOUD_COMMITMENTS_TEST_DATABASE_HOST"] || "localhost",
    port: Number(process.env["CLOUD_COMMITMENTS_TEST_DATABASE_PORT"] || "5400"),
    username: process.env["DATABASE_USERNAME"] || "postgres",
    password: process.env["DATABASE_PASSWORD"] || "password",
    database: process.env["DATABASE_NAME"] || "oneuptimedb",
  };
}

const schema: string = `cloud_commitments_${ObjectID.generate()
  .toString()
  .split("-")
  .join("")}`;
let database: DataSource;

async function insert(table: string, row: Dictionary<unknown>): Promise<void> {
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
    columns.map((column: string): unknown => {
      const value: unknown = row[column];

      if (value instanceof ObjectID) {
        return value.toString();
      }

      return value !== null && typeof value === "object" && !(value instanceof Date)
        ? JSON.stringify(value)
        : value;
    }),
  );
}

async function rowsOf(
  table: string,
  projectId: ObjectID,
): Promise<Array<Dictionary<unknown>>> {
  return await database.query(
    `SELECT * FROM "${schema}"."${table}" WHERE "projectId" = $1 ORDER BY "createdAt", "_id"`,
    [projectId.toString()],
  );
}

// An account of the project, as the lanes keep it.
async function insertAccount(data: {
  projectId: ObjectID;
  accountId: string;
  provider?: CloudProvider | undefined;
  savingsSummary?: JSONObject | undefined;
}): Promise<ObjectID> {
  const id: ObjectID = ObjectID.generate();

  await insert("CloudAccount", {
    _id: id,
    projectId: data.projectId,
    name: `Account ${data.accountId}`,
    provider: data.provider || CloudProvider.AWS,
    accountId: data.accountId,
    ...(data.savingsSummary ? { savingsSummary: data.savingsSummary } : {}),
    version: 1,
  });

  return id;
}

function commitment(
  overrides: Partial<CloudCommitmentRecord>,
): CloudCommitmentRecord {
  return {
    accountId: "111111111111",
    commitmentId: "arn:aws:savingsplans::111111111111:savingsplan/plan-1",
    kind: CloudCommitmentKind.SavingsPlans,
    name: "plan-1",
    commitmentType: "Compute Savings Plans",
    covers: "",
    region: "",
    scope: CloudCommitmentScope.Shared,
    appliesTo: "",
    termMonths: 12,
    paymentOption: CloudCommitmentPaymentOption.NoUpfront,
    startsAt: new Date("2025-12-15T00:00:00.000Z"),
    endsAt: new Date(NOW.getTime() + 25 * DAY_MS),
    state: CloudCommitmentState.Active,
    isAutoRenew: false,
    hourlyCommitment: 1.25,
    quantity: null,
    upfrontCost: 0,
    recurringHourlyCost: 1.25,
    currency: "USD",
    utilizationPercent: 96.5,
    weekUtilizationPercent: 98,
    figures: {
      days: 30,
      commitmentCost: 900,
      usedCost: 868.5,
      unusedCost: 31.5,
      coveredOnDemandCost: 1240,
      netSavings: 340,
      weekCommitmentCost: 210,
      weekUnusedCost: 4.2,
    },
    ...overrides,
  };
}

describePostgres("cloud commitments and cost settings, on Postgres", () => {
  const projectId: ObjectID = ObjectID.generate();
  let accountRow: ObjectID;
  let otherAccountRow: ObjectID;

  let created: Array<Alert> = [];
  let timelines: Array<AlertStateTimeline> = [];
  let openFingerprints: Map<string, ObjectID> = new Map();

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      ...databaseOptions(),
      entities: Entities,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    getJestSpyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    getJestSpyOn(PostgresAppInstance, "getDataSource").mockReturnValue(
      database,
    );
    getJestSpyOn(GlobalCache, "getJSONObject").mockResolvedValue(null as never);
    getJestSpyOn(GlobalCache, "setJSON").mockResolvedValue(undefined as never);
    getJestSpyOn(GlobalCache, "deleteKey").mockResolvedValue(
      undefined as never,
    );
    // Workflows run elsewhere.
    getJestSpyOn(
      DatabaseService.prototype,
      "onTriggerWorkflow",
    ).mockResolvedValue(undefined as never);

    accountRow = await insertAccount({
      projectId,
      accountId: "111111111111",
      savingsSummary: {
        state: CloudCostState.Reading,
        count: 0,
        monthlySavings: 0,
        byKind: {},
        currency: "USD",
        readAt: NOW.toISOString(),
        commitments: {
          state: CloudCostState.Reading,
          currency: "USD",
          days: 30,
          kinds: [
            {
              kind: CloudCommitmentKind.SavingsPlans,
              coveredSpend: 400,
              onDemandSpend: 600,
              commitmentSpend: 420,
              unusedSpend: 20,
            },
          ],
          readAt: NOW.toISOString(),
        },
      },
    });
    otherAccountRow = await insertAccount({
      projectId,
      accountId: "222222222222",
    });
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(() => {
    created = [];
    timelines = [];

    getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
    // Alerts, stood in: an open one per fingerprint until it is resolved.
    getJestSpyOn(AlertStateService, "getUnresolvedAlertStateIds").mockResolvedValue(
      [ObjectID.generate()] as never,
    );
    getJestSpyOn(AlertService, "findBy").mockImplementation((async (input: {
      query: { seriesFingerprint: string };
    }): Promise<Array<Alert>> => {
      const id: ObjectID | undefined = openFingerprints.get(
        input.query.seriesFingerprint,
      );

      if (!id) {
        return [];
      }

      const alert: Alert = new Alert();
      alert.id = id;
      return [alert];
    }) as never);
    getJestSpyOn(AlertSeverityService, "findOneBy").mockImplementation((async (): Promise<AlertSeverity> => {
      const severity: AlertSeverity = new AlertSeverity();
      severity.id = new ObjectID("10000000-0000-4000-8000-0000000000e1");
      return severity;
    }) as never);
    getJestSpyOn(AlertService, "create").mockImplementation((async (input: {
      data: Alert;
    }): Promise<Alert> => {
      created.push(input.data);
      const saved: Alert = new Alert();
      saved.id = ObjectID.generate();
      openFingerprints.set(input.data.seriesFingerprint!, saved.id);
      return saved;
    }) as never);
    getJestSpyOn(
      AlertStateTimelineService,
      "getResolvedStateIdForProject",
    ).mockResolvedValue(
      new ObjectID("10000000-0000-4000-8000-0000000000aa") as never,
    );
    getJestSpyOn(AlertStateTimelineService, "create").mockImplementation((async (input: {
      data: AlertStateTimeline;
    }): Promise<AlertStateTimeline> => {
      timelines.push(input.data);

      for (const [fingerprint, id] of openFingerprints) {
        if (id.toString() === input.data.alertId?.toString()) {
          openFingerprints.delete(fingerprint);
        }
      }

      return input.data;
    }) as never);
  });

  describe("the project's cost settings", () => {
    test("made with every default the first time anything asks, by three callers at once too: one row", async () => {
      const settings: Array<CloudCostSetting> = await Promise.all([
        CloudCostSettingService.getOrCreateForProject(projectId),
        CloudCostSettingService.getOrCreateForProject(projectId),
        CloudCostSettingService.getOrCreateForProject(projectId),
      ]);

      expect(
        new Set(
          settings.map((setting: CloudCostSetting): string => {
            return setting.id!.toString();
          }),
        ).size,
      ).toBe(1);
      expect(settings[0]).toMatchObject({
        costBasis: CloudCostBasis.Amortized,
        isCommitmentAlertsEnabled: true,
        commitmentExpiryAlertDays: "90, 30, 7",
        commitmentUtilizationThreshold: 80,
        commitmentCoverageThreshold: 60,
      });
      expect(await rowsOf("CloudCostSetting", projectId)).toHaveLength(1);
    });

    test("a project with none reads the default basis, without one being made", async () => {
      const other: ObjectID = ObjectID.generate();

      expect(await CloudCostSettingService.getCostBasisOfProject(other)).toBe(
        CloudCostBasis.Amortized,
      );
      expect(await rowsOf("CloudCostSetting", other)).toHaveLength(0);
    });

    test("a write is kept as the settings keep it: the days before an end the furthest first, coverage off when empty", async () => {
      const setting: CloudCostSetting =
        await CloudCostSettingService.getOrCreateForProject(projectId);

      await CloudCostSettingService.updateOneById({
        id: setting.id!,
        data: {
          costBasis: CloudCostBasis.Net,
          commitmentExpiryAlertDays: "7,90, 30",
          commitmentCoverageThreshold: null,
        } as never,
        props: { isRoot: true },
      });

      const row: Dictionary<unknown> = (
        await rowsOf("CloudCostSetting", projectId)
      )[0]!;

      expect(row).toMatchObject({
        costBasis: "net",
        commitmentExpiryAlertDays: "90, 30, 7",
        commitmentCoverageThreshold: null,
      });
      expect(await CloudCostSettingService.getCostBasisOfProject(projectId)).toBe(
        CloudCostBasis.Net,
      );
    });

    test("what is not a setting's value is refused, in words to act on, and nothing is written", async () => {
      const setting: CloudCostSetting =
        await CloudCostSettingService.getOrCreateForProject(projectId);
      const refusals: Array<[JSONObject, string]> = [
        [{ costBasis: "blended" }, CLOUD_COST_BASIS_ERROR],
        [{ commitmentExpiryAlertDays: "soon" }, CLOUD_COMMITMENT_EXPIRY_DAYS_ERROR],
        [{ commitmentExpiryAlertDays: "0, 30" }, CLOUD_COMMITMENT_EXPIRY_DAYS_ERROR],
        [{ commitmentUtilizationThreshold: 0 }, CLOUD_COMMITMENT_THRESHOLD_ERROR],
        [{ commitmentUtilizationThreshold: null }, CLOUD_COMMITMENT_THRESHOLD_ERROR],
        [{ commitmentCoverageThreshold: 101 }, CLOUD_COMMITMENT_THRESHOLD_ERROR],
      ];

      for (const [data, message] of refusals) {
        await expect(
          CloudCostSettingService.updateOneById({
            id: setting.id!,
            data: data as never,
            props: { isRoot: true },
          }),
        ).rejects.toThrow(new BadDataException(message));
      }

      expect((await rowsOf("CloudCostSetting", projectId))[0]).toMatchObject({
        costBasis: "net",
        commitmentExpiryAlertDays: "90, 30, 7",
        commitmentUtilizationThreshold: 80,
      });
    });

    test("a second row for the project is refused by its unique index", async () => {
      const second: CloudCostSetting = new CloudCostSetting();
      second.projectId = projectId;

      await expect(
        CloudCostSettingService.create({
          data: second,
          props: { isRoot: true },
        }),
      ).rejects.toBeDefined();
      expect(await rowsOf("CloudCostSetting", projectId)).toHaveLength(1);
    });
  });

  describe("each read of a connection's commitments", () => {
    let firstWrite: CloudCommitmentWriteResult;

    test("a first read creates a row a commitment, on the account that bought it, the cloud's figures as it said them", async () => {
      firstWrite = await CloudCommitmentWriter.write({
        projectId,
        provider: CloudProvider.AWS,
        inventory: {
          records: [
            commitment({}),
            commitment({
              accountId: "222222222222",
              commitmentId: "Amazon Elastic Compute Cloud - Compute/359809062",
              kind: CloudCommitmentKind.Reservations,
              name: "359809062",
              commitmentType: "Amazon Elastic Compute Cloud - Compute (Standard)",
              covers: "3 × t3.large, Linux/UNIX, us-east-1",
              region: "us-east-1",
              hourlyCommitment: null,
              quantity: 3,
              paymentOption: CloudCommitmentPaymentOption.PartialUpfront,
              termMonths: 36,
              endsAt: new Date(NOW.getTime() + 400 * DAY_MS),
              weekUtilizationPercent: 55,
              utilizationPercent: 61.25,
              figures: null,
            }),
            // Of an account OneUptime does not hold: kept on the management account.
            commitment({
              accountId: "333333333333",
              commitmentId:
                "arn:aws:savingsplans::333333333333:savingsplan/plan-9",
              name: "plan-9",
              state: CloudCommitmentState.Queued,
              startsAt: new Date(NOW.getTime() + 25 * DAY_MS),
              endsAt: new Date(NOW.getTime() + 390 * DAY_MS),
              figures: null,
            }),
          ],
          complete: true,
          state: CloudCostState.Reading,
        },
        accountRows: new Map([
          ["111111111111", accountRow],
          ["222222222222", otherAccountRow],
        ]),
        accountsRead: new Set(["111111111111", "222222222222"]),
        fallbackAccountId: "111111111111",
        now: NOW,
      });

      expect(firstWrite).toEqual({
        created: 3,
        updated: 0,
        removed: 0,
        withoutAccount: 0,
        orphanedAlertIds: [],
      });

      const rows: Array<CloudCommitment> = await CloudCommitmentService.findBy(
        {
          query: { projectId },
          select: {
            _id: true,
            cloudAccountId: true,
            commitmentId: true,
            kind: true,
            name: true,
            covers: true,
            state: true,
            termMonths: true,
            paymentOption: true,
            endsAt: true,
            hourlyCommitment: true,
            quantity: true,
            utilizationPercent: true,
            weekUtilizationPercent: true,
            figures: true,
            lastSeenAt: true,
          },
          sort: { name: SortOrder.Ascending },
          skip: 0,
          limit: 10,
          props: { isRoot: true },
        },
      );

      expect(rows).toHaveLength(3);

      const plan: CloudCommitment = rows.find((row: CloudCommitment) => {
        return row.name === "plan-1";
      })!;
      expect(plan.cloudAccountId?.toString()).toBe(accountRow.toString());
      expect(plan.kind).toBe(CloudCommitmentKind.SavingsPlans);
      expect(plan.termMonths).toBe(12);
      expect(Number(plan.hourlyCommitment)).toBe(1.25);
      expect(Number(plan.utilizationPercent)).toBe(96.5);
      expect(new Date(plan.endsAt!).toISOString()).toBe(
        new Date(NOW.getTime() + 25 * DAY_MS).toISOString(),
      );
      expect(plan.figures).toMatchObject({
        commitmentCost: 900,
        weekUnusedCost: 4.2,
      });
      expect(new Date(plan.lastSeenAt!).toISOString()).toBe(NOW.toISOString());

      const reservation: CloudCommitment = rows.find(
        (row: CloudCommitment) => {
          return row.name === "359809062";
        },
      )!;
      expect(reservation.cloudAccountId?.toString()).toBe(
        otherAccountRow.toString(),
      );
      expect(Number(reservation.quantity)).toBe(3);
      expect(reservation.hourlyCommitment ?? null).toBeNull();
      expect(reservation.figures ?? null).toBeNull();
      expect(reservation.covers).toBe("3 × t3.large, Linux/UNIX, us-east-1");

      const queued: CloudCommitment = rows.find((row: CloudCommitment) => {
        return row.name === "plan-9";
      })!;
      expect(queued.cloudAccountId?.toString()).toBe(accountRow.toString());
      expect(queued.state).toBe(CloudCommitmentState.Queued);
    });

    test("its alerts: the plan ending in 25 days told at 30 days once no renewal is queued, the reservation used 55% of its week; neither twice", async () => {
      const fingerprints: () => Array<string> = (): Array<string> => {
        return created
          .map((alert: Alert): string => {
            return alert.seriesFingerprint!.replace(
              /:[0-9a-f-]{36}:/,
              ":<id>:",
            );
          })
          .sort();
      };

      /*
       * plan-9 is queued to start the day plan-1 ends: its renewal, so
       * plan-1's end is nothing to alert on.
       */
      await CloudCommitmentAlertEvaluator.evaluateProject(projectId);

      expect(fingerprints()).toEqual(["cloud-commitment:<id>:under-use"]);

      // Queued for later instead: not a renewal of it.
      await CloudCommitmentService.updateBy({
        query: { projectId, name: "plan-9" },
        data: {
          startsAt: new Date(NOW.getTime() + 200 * DAY_MS),
          endsAt: new Date(NOW.getTime() + 565 * DAY_MS),
        } as never,
        limit: 1,
        skip: 0,
        props: { isRoot: true, ignoreHooks: true },
      });
      await CloudCommitmentAlertEvaluator.evaluateProject(projectId);

      expect(fingerprints()).toEqual([
        "cloud-commitment:<id>:expiry-30",
        "cloud-commitment:<id>:under-use",
      ]);

      const expiry: Alert = created.find((alert: Alert) => {
        return alert.seriesFingerprint!.endsWith("expiry-30");
      })!;
      expect(expiry.title).toContain("plan-1");
      expect(expiry.title).toContain("25 days");

      // What it raised, kept on each row.
      const rows: Array<Dictionary<unknown>> = await rowsOf(
        "CloudCommitment",
        projectId,
      );
      const states: Dictionary<unknown> = {};

      for (const row of rows) {
        states[String(row["name"])] = row["alertState"];
      }

      expect(states["plan-1"]).toEqual({
        expiryThresholds: [90, 30],
        expiryAlertId: expect.any(String),
      });
      expect(states["359809062"]).toEqual({
        expiryThresholds: [],
        underUseAlertId: expect.any(String),
      });
      // Queued: not alerted on until it pays for usage.
      expect(states["plan-9"] ?? null).toBeNull();

      // The coverage: 40% of eligible spend, under 60, on the settings.
      expect(created).toHaveLength(2);

      // Again: nothing new.
      created = [];
      await CloudCommitmentAlertEvaluator.evaluateProject(projectId);
      expect(created).toEqual([]);
    });

    test("a second read: one recovered, one no longer listed - removed, its open alert handed back to resolve", async () => {
      const second: CloudCommitmentWriteResult = await CloudCommitmentWriter.write({
        projectId,
        provider: CloudProvider.AWS,
        inventory: {
          records: [
            commitment({
              accountId: "222222222222",
              commitmentId: "Amazon Elastic Compute Cloud - Compute/359809062",
              kind: CloudCommitmentKind.Reservations,
              name: "359809062",
              quantity: 3,
              hourlyCommitment: null,
              endsAt: new Date(NOW.getTime() + 400 * DAY_MS),
              weekUtilizationPercent: 91,
              utilizationPercent: 70,
              figures: null,
            }),
            commitment({
              accountId: "333333333333",
              commitmentId:
                "arn:aws:savingsplans::333333333333:savingsplan/plan-9",
              name: "plan-9",
              state: CloudCommitmentState.Queued,
              startsAt: new Date(NOW.getTime() + 25 * DAY_MS),
              endsAt: new Date(NOW.getTime() + 390 * DAY_MS),
              figures: null,
            }),
          ],
          complete: true,
          state: CloudCostState.Reading,
        },
        accountRows: new Map([
          ["111111111111", accountRow],
          ["222222222222", otherAccountRow],
        ]),
        accountsRead: new Set(["111111111111", "222222222222"]),
        fallbackAccountId: "111111111111",
        now: new Date(NOW.getTime() + DAY_MS),
      });

      expect(second.created).toBe(0);
      expect(second.updated).toBe(2);
      expect(second.removed).toBe(1);
      expect(second.orphanedAlertIds).toHaveLength(1);

      const names: Array<string> = (
        await rowsOf("CloudCommitment", projectId)
      ).map((row: Dictionary<unknown>): string => {
        return String(row["name"]);
      });
      expect(names.sort()).toEqual(["359809062", "plan-9"]);

      // The plan's alert: resolved as gone; the reservation's as recovered.
      await CloudCommitmentAlertEvaluator.resolveGone({
        projectId,
        alertIds: second.orphanedAlertIds,
      });
      await CloudCommitmentAlertEvaluator.evaluateProject(projectId);

      expect(
        timelines.map((timeline: AlertStateTimeline): string => {
          return timeline.rootCause || "";
        }),
      ).toHaveLength(2);
      expect(created).toEqual([]);

      const reservation: Dictionary<unknown> = (
        await rowsOf("CloudCommitment", projectId)
      ).find((row: Dictionary<unknown>): boolean => {
        return row["name"] === "359809062";
      })!;
      expect(reservation["alertState"]).toEqual({ expiryThresholds: [] });
      expect(Number(reservation["weekUtilizationPercent"])).toBe(91);
    });

    test("a list cut short removes nothing, and another account's commitments are never touched", async () => {
      const before: number = (await rowsOf("CloudCommitment", projectId))
        .length;

      const cutShort: CloudCommitmentWriteResult =
        await CloudCommitmentWriter.write({
          projectId,
          provider: CloudProvider.AWS,
          inventory: {
            records: [],
            complete: false,
            state: CloudCostState.Reading,
          },
          accountRows: new Map([
            ["111111111111", accountRow],
            ["222222222222", otherAccountRow],
          ]),
          accountsRead: new Set(["111111111111", "222222222222"]),
          now: NOW,
        });

      expect(cutShort.removed).toBe(0);

      // A read of the first account alone, in full: the other account's reservation stays.
      const oneAccount: CloudCommitmentWriteResult =
        await CloudCommitmentWriter.write({
          projectId,
          provider: CloudProvider.AWS,
          inventory: {
            records: [
              commitment({
                accountId: "333333333333",
                commitmentId:
                  "arn:aws:savingsplans::333333333333:savingsplan/plan-9",
                name: "plan-9",
                state: CloudCommitmentState.Queued,
                figures: null,
              }),
            ],
            complete: true,
            state: CloudCostState.Reading,
          },
          accountRows: new Map([["111111111111", accountRow]]),
          accountsRead: new Set(["111111111111"]),
          fallbackAccountId: "111111111111",
          now: NOW,
        });

      expect(oneAccount.removed).toBe(0);
      expect((await rowsOf("CloudCommitment", projectId)).length).toBe(before);

      // Another cloud's read never removes AWS's.
      const azure: CloudCommitmentWriteResult = await CloudCommitmentWriter.write(
        {
          projectId,
          provider: CloudProvider.Azure,
          inventory: {
            records: [],
            complete: true,
            state: CloudCostState.Reading,
          },
          accountRows: new Map([["111111111111", accountRow]]),
          accountsRead: new Set(["111111111111"]),
          now: NOW,
        },
      );

      expect(azure.removed).toBe(0);
      expect((await rowsOf("CloudCommitment", projectId)).length).toBe(before);
    });

    test("commitment alerts turned off resolve every open one and raise none", async () => {
      // The reservation under-used again: an alert opens.
      await CloudCommitmentService.updateBy({
        query: { projectId, name: "359809062" },
        data: { weekUtilizationPercent: 40 } as never,
        limit: 1,
        skip: 0,
        props: { isRoot: true, ignoreHooks: true },
      });
      await CloudCommitmentAlertEvaluator.evaluateProject(projectId);
      expect(created).toHaveLength(1);

      const setting: CloudCostSetting =
        await CloudCostSettingService.getOrCreateForProject(projectId);
      await CloudCostSettingService.updateOneById({
        id: setting.id!,
        data: { isCommitmentAlertsEnabled: false } as never,
        props: { isRoot: true },
      });

      created = [];
      timelines = [];
      await CloudCommitmentAlertEvaluator.evaluateProject(projectId);

      expect(created).toEqual([]);
      // The reservation's under-use, and the account's coverage.
      expect(timelines.length).toBeGreaterThanOrEqual(1);
      expect(
        (await rowsOf("CloudCommitment", projectId)).every(
          (row: Dictionary<unknown>): boolean => {
            const state: JSONObject = (row["alertState"] || {}) as JSONObject;
            return !state["expiryAlertId"] && !state["underUseAlertId"];
          },
        ),
      ).toBe(true);
    });

    test("an account's coverage, kept on the settings read after read: a fall under the threshold alerts once, a return resolves", async () => {
      const setting: CloudCostSetting =
        await CloudCostSettingService.getOrCreateForProject(projectId);
      await CloudCostSettingService.updateOneById({
        id: setting.id!,
        data: {
          isCommitmentAlertsEnabled: true,
          commitmentCoverageThreshold: 60,
        } as never,
        props: { isRoot: true },
      });

      // Savings Plans covering coveredSpend of covered and on-demand spend.
      const coverAccount: (coveredSpend: number) => Promise<void> = async (
        coveredSpend: number,
      ): Promise<void> => {
        await database.query(
          `UPDATE "${schema}"."CloudAccount" SET "savingsSummary" = $1 WHERE "_id" = $2`,
          [
            JSON.stringify({
              state: CloudCostState.Reading,
              count: 0,
              monthlySavings: 0,
              byKind: {},
              currency: "USD",
              readAt: NOW.toISOString(),
              commitments: {
                state: CloudCostState.Reading,
                currency: "USD",
                days: 30,
                kinds: [
                  {
                    kind: CloudCommitmentKind.SavingsPlans,
                    coveredSpend,
                    onDemandSpend: 1000 - coveredSpend,
                    commitmentSpend: coveredSpend,
                    unusedSpend: 0,
                  },
                ],
                readAt: NOW.toISOString(),
              },
            }),
            accountRow.toString(),
          ],
        );
      };
      const coverage: () => Promise<JSONObject> =
        async (): Promise<JSONObject> => {
          const row: Dictionary<unknown> = (
            await rowsOf("CloudCostSetting", projectId)
          )[0]!;

          return ((row["commitmentAlertState"] || {}) as JSONObject)[
            "coverage"
          ] as JSONObject;
        };
      const key: string = `${accountRow.toString()}|${CloudCommitmentKind.SavingsPlans}`;
      // The coverage alerts raised: the reservation's own under-use aside.
      const coverageAlerts: () => Array<Alert> = (): Array<Alert> => {
        return created.filter((alert: Alert): boolean => {
          return alert.seriesFingerprint!.startsWith(
            "cloud-commitment-coverage:",
          );
        });
      };

      // At 70%, then down to 40%: one alert, its id kept.
      await coverAccount(700);
      created = [];
      await CloudCommitmentAlertEvaluator.evaluateProject(projectId);
      expect(coverageAlerts()).toEqual([]);
      expect(await coverage()).toEqual({ [key]: { percent: 70 } });

      await coverAccount(400);
      await CloudCommitmentAlertEvaluator.evaluateProject(projectId);
      expect(coverageAlerts()).toHaveLength(1);
      expect(coverageAlerts()[0]!.seriesFingerprint).toBe(
        `cloud-commitment-coverage:${key}`,
      );
      expect(coverageAlerts()[0]!.title).toContain("40%");

      const state: JSONObject = await coverage();
      expect(state).toEqual({
        [key]: { percent: 40, alertId: expect.any(String) },
      });

      // Still under: not again. Back over: resolved.
      await CloudCommitmentAlertEvaluator.evaluateProject(projectId);
      expect(coverageAlerts()).toHaveLength(1);

      timelines = [];
      await coverAccount(650);
      await CloudCommitmentAlertEvaluator.evaluateProject(projectId);
      expect(
        timelines.map((timeline: AlertStateTimeline): string => {
          return timeline.alertId!.toString();
        }),
      ).toEqual([String((state[key] as JSONObject)["alertId"])]);
      expect(await coverage()).toEqual({ [key]: { percent: 65 } });
    });
  });
});
