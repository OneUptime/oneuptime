jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: false,
  };
});

// The data source below is built here; the app's own needs no migrations.
jest.mock("../../../Server/Infrastructure/Postgres/DataSourceOptions", () => {
  return {};
});

import Entities from "../../../Models/DatabaseModels/Index";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import { AddOnCallFireDrillResultsIndexAndKey1809183110000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1809183110000-AddOnCallFireDrillResultsIndexAndKey";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallFireDrillHistoryService from "../../../Server/Services/OnCallFireDrillHistoryService";
import OnCallFireDrillService from "../../../Server/Services/OnCallFireDrillService";
import OnCallTestPageService, {
  OnCallTestPageLimitKey,
} from "../../../Server/Services/OnCallTestPageService";
import WhoIsToldService from "../../../Server/Services/WhoIsToldService";
import OnCallTestPageEvents from "../../../Server/Utils/OnCall/OnCallTestPageEvents";
import OnCallPolicyRunMessage from "../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import {
  WhoIsToldEvent,
  WhoIsToldPolicy,
  WhoIsToldResult,
} from "../../../Types/Monitor/WhoIsTold";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../Types/ObjectID";
import {
  OnCallFireDrillRecord,
  OnCallFireDrillStarted,
  getOnCallFireDrillEventKey,
} from "../../../Types/OnCallDutyPolicy/OnCallFireDrill";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  OnCallTestPageKind,
  OnCallTestPageRecordKind,
  OnCallTestPageStatus,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import UserType from "../../../Types/UserType";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * A MONITOR'S FIRE DRILL (#7012), ON POSTGRES: what it writes, and what it
 * never writes.
 *
 * A drill tests every on-call policy a failure of the monitor would page,
 * each as "Test this policy" tests it. Only a database answers whether the
 * rows it leaves are what that promises, so the drill runs here as the API
 * runs it - OnCallFireDrillService.start, the policy and severity reads of
 * OnCallTestPageService and the run's create through
 * OnCallDutyPolicyExecutionLogService, its hooks included - on copies of
 * the migrated tables:
 *
 *   - each policy the failure pages gets one run, and it is a test page:
 *     the Test Page event type, the failure's kind and severity, its first
 *     level only, credited to who started it - and no incident, alert or
 *     episode behind it;
 *   - no incident and no alert is created, for an incident's failure or an
 *     alert's;
 *   - a policy or a severity that is not the project's stops the whole
 *     drill before any limit is claimed or any run is written.
 *
 * Which policies a failure pages is When this goes down's answer
 * (WhoIsToldService, tested with it), handed in here; how often a drill
 * may run is the limits' (OnCallTestPageService.claimLimitsOfEach, tested
 * on Valkey), and paging the first level is every run's
 * (startFirstEscalationRule): each is recorded, not run.
 *
 * Opt in with RUN_POSTGRES_ON_CALL_FIRE_DRILL_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check. The tables' structure
 * is cloned into a schema of its own, dropped afterwards, and every row is
 * synthetic. Credentials from DATABASE_USERNAME / DATABASE_PASSWORD,
 * database from ON_CALL_FIRE_DRILL_TEST_DATABASE_NAME or DATABASE_NAME,
 * endpoint from ON_CALL_FIRE_DRILL_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_ON_CALL_FIRE_DRILL_TESTS"] === "true"
    ? describe
    : describe.skip;

/*
 * What the drill reads and writes, and the records it must never write -
 * and what reading its last drill back reads (#9386): the monitor, who
 * started it, and the messages its tests were acknowledged from.
 */
const TABLES: Array<string> = [
  "OnCallDutyPolicy",
  "IncidentSeverity",
  "AlertSeverity",
  "OnCallDutyPolicyExecutionLog",
  "Incident",
  "Alert",
  "Monitor",
  "User",
  "UserOnCallLogTimeline",
];

interface Seeded {
  projectId: ObjectID;
  monitorId: ObjectID;
  userId: ObjectID;
  primaryId: string;
  platformId: string;
  criticalId: string;
  warningId: string;
  // Another project's policy and severity.
  otherPolicyId: string;
  otherSeverityId: string;
}

interface RunRow {
  _id: string;
  onCallDutyPolicyId: string;
  userNotificationEventType: string;
  testPageRecordKind: string | null;
  testPageSeverityId: string | null;
  testPageWalksEscalation: boolean | null;
  triggeredByIncidentId: string | null;
  triggeredByAlertId: string | null;
  triggeredByIncidentEpisodeId: string | null;
  triggeredByAlertEpisodeId: string | null;
  triggeredByUserId: string | null;
}

// What a run keeps of the fire drill it is part of (#9386).
interface KeptRow {
  _id: string;
  onCallDutyPolicyId: string;
  testPageFireDrillId: string | null;
  testPageFireDrillMonitorId: string | null;
  testPageFireDrillFailure: unknown;
  testPageWalksEscalation: boolean;
  testPageRecordKind: string | null;
  testPageSeverityId: string | null;
}

const OFFLINE_KEY: string = getOnCallFireDrillEventKey({
  criteriaId: "criteria-offline",
  recordKind: OnCallTestPageRecordKind.Incident,
  templateId: "template-offline",
  index: 0,
});

const SLOW_KEY: string = getOnCallFireDrillEventKey({
  criteriaId: "criteria-slow",
  recordKind: OnCallTestPageRecordKind.Alert,
  templateId: "template-slow",
  index: 0,
});

function policy(id: string, name: string): WhoIsToldPolicy {
  return {
    id: id,
    name: name,
    isHidden: false,
    isNamedByCriteria: true,
    ruleIds: [],
    levelCount: 1,
    people: [],
    notPaged: [],
  };
}

function event(data: Partial<WhoIsToldEvent>): WhoIsToldEvent {
  return {
    kind: OnCallTestPageRecordKind.Incident,
    id: "template-offline",
    title: "API is down",
    severityName: "Critical",
    owners: { kind: "None" } as unknown as WhoIsToldEvent["owners"],
    ownerRules: [],
    rules: [],
    policies: [],
    statusPages: [],
    ...data,
  };
}

/*
 * When this goes down for a monitor whose Offline criteria opens a
 * Critical incident that pages `offline`, and whose Slow criteria opens a
 * Warning alert that pages `slow`.
 */
function whoIsTold(
  seeded: Seeded,
  data: {
    offline: Array<WhoIsToldPolicy>;
    slow?: Array<WhoIsToldPolicy> | undefined;
    offlineSeverityId?: string | undefined;
  },
): WhoIsToldResult {
  return {
    monitorId: seeded.monitorId.toString(),
    monitorName: "API",
    checkedAt: new Date().toISOString(),
    criteria: [
      {
        id: "criteria-offline",
        name: "Offline",
        events: [
          event({
            severityId: data.offlineSeverityId || seeded.criticalId,
            policies: data.offline,
          }),
        ],
      },
      {
        id: "criteria-slow",
        name: "Slow",
        events: [
          event({
            kind: OnCallTestPageRecordKind.Alert,
            id: "template-slow",
            title: "API is slow",
            severityId: seeded.warningId,
            severityName: "Warning",
            policies: data.slow || [],
          }),
        ],
      },
    ],
    channels: {} as WhoIsToldResult["channels"],
    breaks: [],
  };
}

describePostgres("a monitor's fire drill, against a migrated Postgres", () => {
  const schema: string = `oncall_fire_drill_${ObjectID.generate().toString().replace(/-/g, "")}`;
  let database: DataSource;
  let told: WhoIsToldResult | null = null;
  // The runs whose first level the drill's runs asked to page.
  let started: Array<string> = [];
  // The policies whose limits were claimed, a claim each.
  let claimed: Array<Array<string>> = [];
  let sent: Array<{
    executionLogId: string;
    kind: OnCallTestPageKind;
    recordKind: OnCallTestPageRecordKind;
  }> = [];

  async function seed(): Promise<Seeded> {
    const id: () => string = (): string => {
      return ObjectID.generate().toString();
    };
    const seeded: Seeded = {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      userId: ObjectID.generate(),
      primaryId: id(),
      platformId: id(),
      criticalId: id(),
      warningId: id(),
      otherPolicyId: id(),
      otherSeverityId: id(),
    };
    const otherProjectId: string = id();

    for (const [policyId, projectId, name] of [
      [seeded.primaryId, seeded.projectId.toString(), "Primary"],
      [seeded.platformId, seeded.projectId.toString(), "Platform"],
      [seeded.otherPolicyId, otherProjectId, "Elsewhere"],
    ] as Array<[string, string, string]>) {
      await database.query(
        `INSERT INTO "${schema}"."OnCallDutyPolicy" ("_id", "version", "projectId", "name", "slug") VALUES ($1, 1, $2, $3, $4)`,
        [policyId, projectId, name, `policy-${policyId}`],
      );
    }

    for (const [severityId, projectId, name] of [
      [seeded.criticalId, seeded.projectId.toString(), "Critical"],
      [seeded.otherSeverityId, otherProjectId, "Critical"],
    ] as Array<[string, string, string]>) {
      await database.query(
        `INSERT INTO "${schema}"."IncidentSeverity" ("_id", "projectId", "name", "slug", "color", "order", "version") VALUES ($1, $2, $3, $4, '#ff0000', 1, 1)`,
        [severityId, projectId, name, `severity-${severityId}`],
      );
    }

    await database.query(
      `INSERT INTO "${schema}"."AlertSeverity" ("_id", "projectId", "name", "slug", "color", "order", "version") VALUES ($1, $2, 'Warning', $3, '#ffaa00', 1, 1)`,
      [
        seeded.warningId,
        seeded.projectId.toString(),
        `severity-${seeded.warningId}`,
      ],
    );

    // The monitor drilled, and who drills it.
    await database.query(
      `INSERT INTO "${schema}"."Monitor" ("_id", "version", "projectId", "name", "slug", "monitorType", "currentMonitorStatusId") VALUES ($1, 1, $2, 'API', $3, 'Manual', $4)`,
      [
        seeded.monitorId.toString(),
        seeded.projectId.toString(),
        `monitor-${seeded.monitorId.toString()}`,
        id(),
      ],
    );
    await database.query(
      `INSERT INTO "${schema}"."User" ("_id", "version", "email", "slug", "name") VALUES ($1, 1, $2, $3, 'Ana Lopez')`,
      [
        seeded.userId.toString(),
        `ana-${seeded.userId.toString()}@example.com`,
        `user-${seeded.userId.toString()}`,
      ],
    );

    return seeded;
  }

  async function drill(
    seeded: Seeded,
    eventKey: string,
    walksEscalation?: boolean | undefined,
  ): Promise<OnCallFireDrillStarted> {
    return await OnCallFireDrillService.start({
      projectId: seeded.projectId,
      monitorId: seeded.monitorId,
      sentByUserId: seeded.userId,
      props: { userId: seeded.userId, tenantId: seeded.projectId },
      eventKey: eventKey,
      walksEscalation: walksEscalation,
      // Who may test each policy is the API's to ask (OnCallTestPageAPI).
      assertMayTestPolicy: async (): Promise<void> => {},
    });
  }

  // What each run of the project keeps of its fire drill (#9386).
  async function keptOf(projectId: ObjectID): Promise<Array<KeptRow>> {
    return (await database.query(
      `SELECT "_id", "onCallDutyPolicyId", "testPageFireDrillId", "testPageFireDrillMonitorId", "testPageFireDrillFailure", "testPageWalksEscalation", "testPageRecordKind", "testPageSeverityId" FROM "${schema}"."OnCallDutyPolicyExecutionLog" WHERE "projectId" = $1 ORDER BY "createdAt", "_id"`,
      [projectId.toString()],
    )) as Array<KeptRow>;
  }

  async function runs(projectId?: ObjectID): Promise<Array<RunRow>> {
    return (await database.query(
      `SELECT "_id", "onCallDutyPolicyId", "userNotificationEventType", "testPageRecordKind", "testPageSeverityId", "testPageWalksEscalation", "triggeredByIncidentId", "triggeredByAlertId", "triggeredByIncidentEpisodeId", "triggeredByAlertEpisodeId", "triggeredByUserId" FROM "${schema}"."OnCallDutyPolicyExecutionLog"${projectId ? ` WHERE "projectId" = $1` : ""} ORDER BY "createdAt", "_id"`,
      projectId ? [projectId.toString()] : [],
    )) as Array<RunRow>;
  }

  async function countOf(table: string): Promise<number> {
    const rows: Array<{ count: string }> = await database.query(
      `SELECT count(*)::text AS count FROM "${schema}"."${table}"`,
    );

    return Number(rows[0]?.count || 0);
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["ON_CALL_FIRE_DRILL_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["ON_CALL_FIRE_DRILL_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["ON_CALL_FIRE_DRILL_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      /*
       * No schema of its own: table names stay unqualified, so the tables
       * copied into the test schema are found first and every other table a
       * read joins is found, empty, in public.
       */
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
  });

  beforeEach(() => {
    told = null;
    started = [];
    claimed = [];
    sent = [];

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    // Nothing is cached between the drill's reads.
    jest.spyOn(GlobalCache, "getJSONObject").mockResolvedValue(null as never);
    jest.spyOn(GlobalCache, "setJSON").mockResolvedValue(undefined as never);
    jest.spyOn(GlobalCache, "deleteKey").mockResolvedValue(undefined as never);

    jest
      .spyOn(WhoIsToldService, "getForMonitor")
      .mockImplementation(async (): Promise<WhoIsToldResult> => {
        if (!told) {
          throw new Error("No When this goes down answer for this test.");
        }

        return told;
      });

    jest
      .spyOn(OnCallTestPageService, "claimLimitsOfEach")
      .mockImplementation(
        async (data: {
          keys: ReadonlyArray<OnCallTestPageLimitKey>;
        }): Promise<void> => {
          claimed.push(
            data.keys.map((key: OnCallTestPageLimitKey): string => {
              return key.id.toString();
            }),
          );
        },
      );

    jest
      .spyOn(
        OnCallDutyPolicyExecutionLogService as unknown as {
          startFirstEscalationRule: (run: { id?: ObjectID }) => Promise<void>;
        },
        "startFirstEscalationRule",
      )
      .mockImplementation(async (run: { id?: ObjectID }): Promise<void> => {
        started.push(run.id!.toString());
      });

    // The run's Slack and Microsoft Teams message is posted elsewhere.
    jest.spyOn(OnCallPolicyRunMessage, "refresh").mockReturnValue(undefined);

    jest
      .spyOn(OnCallTestPageEvents, "onTestPageSent")
      .mockImplementation(
        (data: {
          executionLogId: ObjectID;
          kind: OnCallTestPageKind;
          recordKind: OnCallTestPageRecordKind;
        }): void => {
          sent.push({
            executionLogId: data.executionLogId.toString(),
            kind: data.kind,
            recordKind: data.recordKind,
          });
        },
      );
  });

  afterEach(async () => {
    jest.restoreAllMocks();

    for (const table of TABLES) {
      await database.query(`DELETE FROM "${schema}"."${table}"`);
    }
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  test("an incident's failure: one test page run for each policy it pages, at its kind and severity, and no incident or alert", async () => {
    const seeded: Seeded = await seed();
    told = whoIsTold(seeded, {
      offline: [
        policy(seeded.primaryId, "Primary"),
        policy(seeded.platformId, "Platform"),
      ],
    });

    const result: OnCallFireDrillStarted = await drill(seeded, OFFLINE_KEY);
    const written: Array<RunRow> = await runs(seeded.projectId);

    expect(
      written
        .map((row: RunRow): string => {
          return row.onCallDutyPolicyId;
        })
        .sort(),
    ).toEqual([seeded.primaryId, seeded.platformId].sort());

    for (const row of written) {
      expect(row).toEqual({
        _id: row._id,
        onCallDutyPolicyId: row.onCallDutyPolicyId,
        userNotificationEventType: UserNotificationEventType.TestPage,
        testPageRecordKind: OnCallTestPageRecordKind.Incident,
        testPageSeverityId: seeded.criticalId,
        testPageWalksEscalation: false,
        triggeredByIncidentId: null,
        triggeredByAlertId: null,
        triggeredByIncidentEpisodeId: null,
        triggeredByAlertEpisodeId: null,
        triggeredByUserId: seeded.userId.toString(),
      });
    }

    // What the dialog reads each policy's result by is the run written.
    expect(
      result.runs
        .map((run: { executionLogId: string }): string => {
          return run.executionLogId;
        })
        .sort(),
    ).toEqual(
      written
        .map((row: RunRow): string => {
          return row._id;
        })
        .sort(),
    );

    // Each run pages its first level, as any test of the policy does.
    expect([...started].sort()).toEqual(
      written
        .map((row: RunRow): string => {
          return row._id;
        })
        .sort(),
    );
    expect(claimed).toEqual([[seeded.primaryId, seeded.platformId]]);
    expect(sent).toEqual(
      result.runs.map((run: { executionLogId: string }) => {
        return {
          executionLogId: run.executionLogId,
          kind: OnCallTestPageKind.Policy,
          recordKind: OnCallTestPageRecordKind.Incident,
        };
      }),
    );

    expect(await countOf("Incident")).toBe(0);
    expect(await countOf("Alert")).toBe(0);
  });

  test("an alert's failure tests its policy at the alert's severity, and no alert or incident is created", async () => {
    const seeded: Seeded = await seed();
    told = whoIsTold(seeded, {
      offline: [policy(seeded.primaryId, "Primary")],
      slow: [policy(seeded.platformId, "Platform")],
    });

    await drill(seeded, SLOW_KEY);

    const written: Array<RunRow> = await runs(seeded.projectId);

    expect(written).toHaveLength(1);
    expect(written[0]).toEqual(
      expect.objectContaining({
        onCallDutyPolicyId: seeded.platformId,
        userNotificationEventType: UserNotificationEventType.TestPage,
        testPageRecordKind: OnCallTestPageRecordKind.Alert,
        testPageSeverityId: seeded.warningId,
        testPageWalksEscalation: false,
        triggeredByIncidentId: null,
        triggeredByAlertId: null,
      }),
    );
    expect(await countOf("Alert")).toBe(0);
    expect(await countOf("Incident")).toBe(0);
  });

  test("a policy that is not the project's stops the whole drill: no limit claimed, no run written", async () => {
    const seeded: Seeded = await seed();
    told = whoIsTold(seeded, {
      offline: [
        policy(seeded.primaryId, "Primary"),
        policy(seeded.otherPolicyId, "Elsewhere"),
      ],
    });

    await expect(drill(seeded, OFFLINE_KEY)).rejects.toThrow(
      "On-call policy not found.",
    );

    expect(await runs()).toEqual([]);
    expect(claimed).toEqual([]);
    expect(started).toEqual([]);
    expect(sent).toEqual([]);
  });

  test("a severity that is not the project's stops the drill too", async () => {
    const seeded: Seeded = await seed();
    told = whoIsTold(seeded, {
      offline: [policy(seeded.primaryId, "Primary")],
      offlineSeverityId: seeded.otherSeverityId,
    });

    await expect(drill(seeded, OFFLINE_KEY)).rejects.toThrow(
      "Pick one of this project's incident severities.",
    );

    expect(await runs()).toEqual([]);
    expect(claimed).toEqual([]);
  });

  /*
   * #9386: each policy's test is kept with its drill - one id on every run
   * of it - the monitor and the failure, written to the migrated columns
   * and read back as written (the failure's jsonb included).
   */
  test("each test of a drill is kept with the drill, the monitor and the failure it rehearsed", async () => {
    const seeded: Seeded = await seed();
    told = whoIsTold(seeded, {
      offline: [
        policy(seeded.primaryId, "Primary"),
        policy(seeded.platformId, "Platform"),
      ],
    });

    const started: OnCallFireDrillStarted = await drill(seeded, OFFLINE_KEY);
    const kept: Array<KeptRow> = await keptOf(seeded.projectId);

    expect(kept).toHaveLength(2);

    for (const row of kept) {
      expect({
        drill: row.testPageFireDrillId,
        monitor: row.testPageFireDrillMonitorId,
        failure: row.testPageFireDrillFailure,
        walks: row.testPageWalksEscalation,
      }).toEqual({
        drill: started.fireDrillId,
        monitor: seeded.monitorId.toString(),
        failure: { criteriaName: "Offline" },
        walks: false,
      });
    }
  });

  // #9385: a walk is kept on each policy's run, as a walked test of it is.
  test("a drill that walks every level writes each policy's test as a walk", async () => {
    const seeded: Seeded = await seed();
    told = whoIsTold(seeded, {
      offline: [
        policy(seeded.primaryId, "Primary"),
        policy(seeded.platformId, "Platform"),
      ],
    });

    await drill(seeded, OFFLINE_KEY, true);

    expect(
      (await keptOf(seeded.projectId)).map((row: KeptRow): boolean => {
        return row.testPageWalksEscalation;
      }),
    ).toEqual([true, true]);
    // Still one claim, for both policies' windows.
    expect(claimed).toEqual([[seeded.primaryId, seeded.platformId]]);
  });

  /*
   * #9397: the incident an alert incident rule declares from the slow
   * alert, which pages nobody itself: its policy is tested at the
   * incident's kind and severity, and how long the alert waits is kept.
   */
  test("the incident an alert incident rule declares is tested at the incident's kind and severity, and its wait is kept", async () => {
    const seeded: Seeded = await seed();
    const answer: WhoIsToldResult = whoIsTold(seeded, {
      offline: [],
      slow: [],
    });

    answer.criteria[1]!.events[0]!.declares = {
      rule: { id: "alert-incident-rule-1", name: "Escalate slow alerts" },
      waitInMinutes: 30,
      incident: event({
        id: "",
        severityId: seeded.criticalId,
        severityName: "Critical",
        title: "API is slow (declared)",
        policies: [policy(seeded.platformId, "Platform")],
      }),
    };
    told = answer;

    await drill(
      seeded,
      getOnCallFireDrillEventKey({
        criteriaId: "criteria-slow",
        recordKind: OnCallTestPageRecordKind.Incident,
        templateId: "template-slow",
        index: 0,
        isDeclared: true,
      }),
    );

    const kept: Array<KeptRow> = await keptOf(seeded.projectId);

    expect(kept).toEqual([
      expect.objectContaining({
        onCallDutyPolicyId: seeded.platformId,
        testPageRecordKind: OnCallTestPageRecordKind.Incident,
        testPageSeverityId: seeded.criticalId,
        testPageFireDrillFailure: {
          criteriaName: "Slow",
          declaredAfterMinutes: 30,
        },
      }),
    ]);
    // A drill of the incident creates no incident, and no alert.
    expect(await countOf("Incident")).toBe(0);
    expect(await countOf("Alert")).toBe(0);
  });

  // A run of the project, acknowledged by the person seeded, from an SMS.
  async function acknowledgeBySms(data: {
    seeded: Seeded;
    runId: string;
    afterSeconds: number;
  }): Promise<void> {
    const sentAt: Date = new Date(Date.now() - 60 * 1000);
    const answeredAt: Date = new Date(
      sentAt.getTime() + data.afterSeconds * 1000,
    );

    await database.query(
      `UPDATE "${schema}"."OnCallDutyPolicyExecutionLog" SET "acknowledgedAt" = $1, "acknowledgedByUserId" = $2 WHERE "_id" = $3`,
      [answeredAt, data.seeded.userId.toString(), data.runId],
    );
    await database.query(
      `INSERT INTO "${schema}"."UserOnCallLogTimeline" ("_id", "version", "userId", "projectId", "userNotificationLogId", "onCallDutyPolicyExecutionLogId", "onCallDutyPolicyExecutionLogTimelineId", "userNotificationEventType", "statusMessage", "status", "isAcknowledged", "acknowledgedAt", "userSmsId", "createdAt") VALUES ($1, 1, $2, $3, $4, $5, $6, $7, 'Test page acknowledged.', 'Sent', true, $8, $9, $10)`,
      [
        ObjectID.generate().toString(),
        data.seeded.userId.toString(),
        data.seeded.projectId.toString(),
        ObjectID.generate().toString(),
        data.runId,
        ObjectID.generate().toString(),
        UserNotificationEventType.TestPage,
        answeredAt,
        ObjectID.generate().toString(),
        sentAt,
      ],
    );
  }

  /*
   * #9386: the monitor's last drill, read back from the migrated tables as
   * the card reads it - the latest drill's tests only, by the index on the
   * monitor, in the order they were started; who started it; the failure;
   * and each test as it stands, acknowledged ones by whom, by what and how
   * fast.
   */
  test("the monitor's last drill reads back: only its latest drill's tests, with who started it, the failure and each test as it stands", async () => {
    const seeded: Seeded = await seed();
    told = whoIsTold(seeded, {
      offline: [
        policy(seeded.primaryId, "Primary"),
        policy(seeded.platformId, "Platform"),
      ],
      slow: [policy(seeded.platformId, "Platform")],
    });

    await drill(seeded, OFFLINE_KEY);
    // A moment later, another drill of another failure.
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 20);
    });
    const latest: OnCallFireDrillStarted = await drill(seeded, SLOW_KEY, true);

    await acknowledgeBySms({
      seeded: seeded,
      runId: latest.runs[0]!.executionLogId,
      afterSeconds: 14,
    });

    const record: OnCallFireDrillRecord | null =
      await OnCallFireDrillHistoryService.getLast({
        projectId: seeded.projectId,
        monitorId: seeded.monitorId,
        props: { isRoot: true },
      });

    expect(record).not.toBeNull();
    expect({
      fireDrillId: record!.fireDrillId,
      monitorId: record!.monitorId,
      startedByName: record!.startedByName,
      failure: record!.failure,
      walksEscalation: record!.walksEscalation,
    }).toEqual({
      fireDrillId: latest.fireDrillId,
      monitorId: seeded.monitorId.toString(),
      startedByName: "Ana Lopez",
      failure: {
        criteriaName: "Slow",
        recordKind: OnCallTestPageRecordKind.Alert,
        severityName: "Warning",
      },
      walksEscalation: true,
    });
    expect(record!.runs).toEqual([
      expect.objectContaining({
        executionLogId: latest.runs[0]!.executionLogId,
        policyId: seeded.platformId,
        policyName: "Platform",
        status: OnCallTestPageStatus.Acknowledged,
        acknowledgedByName: "Ana Lopez",
        acknowledgedChannel: OnCallPageChannel.SMS,
        acknowledgedAfterSeconds: 14,
      }),
    ]);
  });

  test("a monitor never drilled has no last drill", async () => {
    const seeded: Seeded = await seed();

    expect(
      await OnCallFireDrillHistoryService.getLast({
        projectId: seeded.projectId,
        monitorId: seeded.monitorId,
        props: { isRoot: true },
      }),
    ).toBeNull();
  });

  /*
   * WHO MAY READ A DRILL'S RESULTS (#9386): somebody who may read the
   * monitor and every one of its tests as an execution log - asked by the
   * real permission rules, on the migrated tables.
   */
  describe("who may read a drill's results", () => {
    function propsOf(
      seeded: Seeded,
      permissions: Array<Permission>,
    ): DatabaseCommonInteractionProps {
      return {
        userId: seeded.userId,
        tenantId: seeded.projectId,
        currentPlan: PlanType.Scale,
        userType: UserType.User,
        userGlobalAccessPermission: {
          _type: "UserGlobalAccessPermission",
          projectIds: [seeded.projectId],
          globalPermissions: [Permission.User, Permission.CurrentUser],
        },
        userTenantAccessPermission: {
          [seeded.projectId.toString()]: {
            _type: "UserTenantAccessPermission",
            projectId: seeded.projectId,
            permissions: permissions.map(
              (permission: Permission): UserPermission => {
                return {
                  _type: "UserPermission",
                  permission: permission,
                  labelIds: [],
                  isBlockPermission: false,
                };
              },
            ),
          },
        },
      };
    }

    async function drilled(): Promise<Seeded> {
      const seeded: Seeded = await seed();
      told = whoIsTold(seeded, {
        offline: [
          policy(seeded.primaryId, "Primary"),
          policy(seeded.platformId, "Platform"),
        ],
      });

      await drill(seeded, OFFLINE_KEY);

      return seeded;
    }

    async function lastAs(
      seeded: Seeded,
      permissions: Array<Permission>,
    ): Promise<OnCallFireDrillRecord | null> {
      return await OnCallFireDrillHistoryService.getLast({
        projectId: seeded.projectId,
        monitorId: seeded.monitorId,
        props: propsOf(seeded, permissions),
      });
    }

    test("a Viewer of the project - the monitor and the execution logs - reads it", async () => {
      const seeded: Seeded = await drilled();
      const record: OnCallFireDrillRecord | null = await lastAs(seeded, [
        Permission.Viewer,
      ]);

      expect(record?.runs).toHaveLength(2);
    });

    test("one who may read the monitor and the policies' execution logs, each by its own role, reads it", async () => {
      const seeded: Seeded = await drilled();

      expect(
        (
          await lastAs(seeded, [
            Permission.MonitorViewer,
            Permission.OnCallViewer,
          ])
        )?.runs,
      ).toHaveLength(2);
    });

    /*
     * An execution log is read through its policy (@CanAccessIfCanReadOn):
     * the logs' own permission, without the policies', reads none of them -
     * so no drill of them either.
     */
    test("the execution logs' own permission without the policies' reads no test: no drill", async () => {
      const seeded: Seeded = await drilled();

      expect(
        await lastAs(seeded, [
          Permission.MonitorViewer,
          Permission.ReadProjectOnCallDutyPolicyExecutionLog,
        ]),
      ).toBeNull();
    });

    test("one who may read the monitor but not the execution logs is told of no drill", async () => {
      const seeded: Seeded = await drilled();

      expect(await lastAs(seeded, [Permission.MonitorViewer])).toBeNull();
    });

    test("one who may read the execution logs but not the monitor is refused", async () => {
      const seeded: Seeded = await drilled();

      await expect(
        lastAs(seeded, [Permission.ReadProjectOnCallDutyPolicyExecutionLog]),
      ).rejects.toThrow();
    });
  });

  /*
   * THE MIGRATION ON REAL TABLES (#9386): the columns are on the migrated
   * table, nullable; the index and the key AddOnCallFireDrillResultsIndexAndKey
   * builds online are there as TypeORM names them; and, run on the copies,
   * the key keeps a drill's tests when their monitor is deleted, its
   * reference cleared - and running it again changes nothing.
   */
  describe("the migration", () => {
    test("the migrated table has the three nullable columns, the partial index and the SET NULL key, validated", async () => {
      const columns: Array<{
        column_name: string;
        data_type: string;
        is_nullable: string;
      }> = await database.query(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'OnCallDutyPolicyExecutionLog'
            AND column_name LIKE 'testPageFireDrill%' ORDER BY column_name`,
      );

      expect(columns).toEqual([
        {
          column_name: "testPageFireDrillFailure",
          data_type: "jsonb",
          is_nullable: "YES",
        },
        {
          column_name: "testPageFireDrillId",
          data_type: "uuid",
          is_nullable: "YES",
        },
        {
          column_name: "testPageFireDrillMonitorId",
          data_type: "uuid",
          is_nullable: "YES",
        },
      ]);

      const indexes: Array<{ indexdef: string }> = await database.query(
        `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'IDX_4820183028729f3fceae04dafd'`,
      );

      expect(indexes).toHaveLength(1);
      expect(indexes[0]!.indexdef).toContain(
        `("testPageFireDrillMonitorId", "createdAt") WHERE ("testPageFireDrillMonitorId" IS NOT NULL)`,
      );

      const keys: Array<{ on_delete: string; validated: boolean }> =
        await database.query(
          `SELECT confdeltype AS on_delete, convalidated AS validated FROM pg_constraint
            WHERE conname = 'FK_d75b2b6de2c8cf161836d749833' AND conrelid = 'public."OnCallDutyPolicyExecutionLog"'::regclass`,
        );

      expect(keys).toEqual([{ on_delete: "n", validated: true }]);
    });

    test("run on the copies, its key keeps a drill's tests when their monitor is deleted, and a second run changes nothing", async () => {
      const seeded: Seeded = await seed();
      told = whoIsTold(seeded, {
        offline: [policy(seeded.primaryId, "Primary")],
      });

      await drill(seeded, OFFLINE_KEY);

      const queryRunner: QueryRunner = database.createQueryRunner();
      const migration: AddOnCallFireDrillResultsIndexAndKey1809183110000 =
        new AddOnCallFireDrillResultsIndexAndKey1809183110000();

      try {
        await migration.up(queryRunner);
        // Safe to run again: built already, validated already.
        await migration.up(queryRunner);
      } finally {
        await queryRunner.release();
      }

      const keys: Array<{ on_delete: string; validated: boolean }> =
        await database.query(
          `SELECT confdeltype AS on_delete, convalidated AS validated FROM pg_constraint
            WHERE conname = 'FK_d75b2b6de2c8cf161836d749833' AND conrelid = to_regclass($1)`,
          [`"${schema}"."OnCallDutyPolicyExecutionLog"`],
        );

      expect(keys).toEqual([{ on_delete: "n", validated: true }]);

      await database.query(
        `DELETE FROM "${schema}"."Monitor" WHERE "_id" = $1`,
        [seeded.monitorId.toString()],
      );

      const kept: Array<KeptRow> = await keptOf(seeded.projectId);

      expect(kept).toHaveLength(1);
      expect(kept[0]!.testPageFireDrillMonitorId).toBeNull();
      // Still a fire drill's test: its drill and its failure stay.
      expect(kept[0]!.testPageFireDrillId).not.toBeNull();
      expect(kept[0]!.testPageFireDrillFailure).toEqual({
        criteriaName: "Offline",
      });

      await database.query(
        `ALTER TABLE "${schema}"."OnCallDutyPolicyExecutionLog" DROP CONSTRAINT "FK_d75b2b6de2c8cf161836d749833"`,
      );
    });
  });
});
