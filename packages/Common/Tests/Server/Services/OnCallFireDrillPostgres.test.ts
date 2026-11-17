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
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
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
import ObjectID from "../../../Types/ObjectID";
import {
  OnCallFireDrillStarted,
  getOnCallFireDrillEventKey,
} from "../../../Types/OnCallDutyPolicy/OnCallFireDrill";
import {
  OnCallTestPageKind,
  OnCallTestPageRecordKind,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
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
import { DataSource } from "typeorm";

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

// What the drill reads and writes, and the records it must never write.
const TABLES: Array<string> = [
  "OnCallDutyPolicy",
  "IncidentSeverity",
  "AlertSeverity",
  "OnCallDutyPolicyExecutionLog",
  "Incident",
  "Alert",
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

    return seeded;
  }

  async function drill(
    seeded: Seeded,
    eventKey: string,
  ): Promise<OnCallFireDrillStarted> {
    return await OnCallFireDrillService.start({
      projectId: seeded.projectId,
      monitorId: seeded.monitorId,
      sentByUserId: seeded.userId,
      props: { userId: seeded.userId, tenantId: seeded.projectId },
      eventKey: eventKey,
      // Who may test each policy is the API's to ask (OnCallTestPageAPI).
      assertMayTestPolicy: async (): Promise<void> => {},
    });
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
          keys: Array<OnCallTestPageLimitKey>;
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
});
