import TeamComplianceService from "../../../Server/TeamCompliance/TeamComplianceService";
import Entities from "Common/Models/DatabaseModels/Index";
import TeamComplianceSetting from "Common/Models/DatabaseModels/TeamComplianceSetting";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import AlertSeverityService from "Common/Server/Services/AlertSeverityService";
import IncidentSeverityService from "Common/Server/Services/IncidentSeverityService";
import TeamComplianceSettingService, {
  SEVERITIES_DELETED_ENABLE_MESSAGE,
} from "Common/Server/Services/TeamComplianceSettingService";
import UpdateBy from "Common/Server/Types/Database/UpdateBy";
import { JSONObject } from "Common/Types/JSON";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import ObjectID from "Common/Types/ObjectID";
import ComplianceNotificationChannel from "Common/Types/Team/ComplianceNotificationChannel";
import { ComplianceSeverityKind } from "Common/Types/Team/ComplianceRule";
import ComplianceRuleType from "Common/Types/Team/ComplianceRuleType";
import {
  TeamComplianceIssueJSON,
  TeamComplianceRuleJSON,
  TeamComplianceStatusJSON,
  TeamMemberComplianceJSON,
} from "Common/Types/Team/TeamComplianceStatus";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
/*
 * The typeorm copy Common's services run on. A bare "typeorm" from ee/Tests
 * resolves to the repository root's copy instead: a second DataSource class
 * that PostgresAppInstance.getDataSource() is not typed to return.
 */
import { DataSource, Logger } from "Common/node_modules/typeorm";

/*
 * GET /team/compliance-status/:teamId, end to end against a migrated
 * Postgres: rules written through the real TeamComplianceSettingService, the
 * members' notification rules and methods seeded as rows, and the status read
 * by the real TeamComplianceService - every query it builds (the severity
 * relation select sorted by createdAt, the Includes over uuid ids, the paged
 * reads) run by Postgres, not a mock.
 *
 * Opt in with RUN_POSTGRES_TEAM_COMPLIANCE_TESTS=true against a database the
 * registered migrations (1796000000000-AddTeamComplianceRuleScope and
 * 1796500000000-AddTeamComplianceRuleNotificationChannels included) have
 * been applied to, e.g. from ee/:
 *
 *   RUN_POSTGRES_TEAM_COMPLIANCE_TESTS=true \
 *   TEAM_COMPLIANCE_TEST_DATABASE_HOST=127.0.0.1 \
 *   TEAM_COMPLIANCE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... node node_modules/.bin/jest \
 *     Tests/Server/TeamCompliance/TeamComplianceStatusPostgres.test.ts \
 *     --selectProjects server --runInBand --forceExit
 *
 * Without the flag the suite is skipped. Its twin in packages/Common
 * (Tests/Server/Services/TeamComplianceSettingPostgres.test.ts) covers the
 * rule writes themselves.
 *
 * Scope: channel rules ("Call for Critical incidents", "Push for critical
 * alerts", "Call and Push for Critical incidents") and method rules, whose
 * data this service reads itself - including rows an older build wrote to the
 * single notificationChannel column alone. On-call
 * rules with NO channel are answered from OnCallReadinessService, which reads
 * the whole on-call graph (policies, schedules, escalation rules...); they are
 * left to the mocked behaviour suite, and none is created here, so readiness
 * is never computed.
 *
 * Everything runs in a uniquely named schema holding structure-only clones
 * (LIKE ... INCLUDING ALL) of the tables involved - all nine notification
 * method tables among them, because the rule read joins the owner of every
 * method a rule names; the severity join tables get their migrated foreign
 * keys back, so a severity delete cascades as it does in production. No row
 * is written outside the schema, which is dropped afterwards. Only realtime
 * and workflow triggers are stubbed. Every statement Postgres rejects is
 * recorded and fails the test.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_TEAM_COMPLIANCE_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Project",
  "User",
  "Team",
  "TeamMember",
  "IncidentSeverity",
  "AlertSeverity",
  "TeamComplianceSetting",
  "TeamComplianceSettingIncidentSeverity",
  "TeamComplianceSettingAlertSeverity",
  "UserNotificationRule",
  "UserCall",
  "UserSMS",
  "UserPush",
  "UserEmail",
  "UserWhatsApp",
  "UserTelegram",
  "UserSlack",
  "UserMicrosoftTeams",
  "UserWebhook",
];

const JOIN_TABLES: Array<string> = [
  "TeamComplianceSettingIncidentSeverity",
  "TeamComplianceSettingAlertSeverity",
];

const CALL_SWITCHED_OFF_WARNING: string =
  "Call notifications are switched off for this project, so members will not be notified by Call even when they meet this rule. Turn them on in Project Settings > Notification Settings.";

const WHATSAPP_SWITCHED_OFF_WARNING: string =
  "WhatsApp is switched off for this project, so members cannot add a WhatsApp number to meet this rule. Turn it on in Project Settings > Notification Settings.";

const SEVERITIES_DELETED_WARNING: string =
  "Every severity this rule was scoped to has been deleted, so it is paused. Edit it to choose new severities, or delete it.";

type SqlRow = Record<string, unknown>;

interface ForeignKeyRow {
  table: string;
  name: string;
  definition: string;
}

/*
 * What the page shows for one member: their name, whether they pass, and
 * each failed rule's reason keyed by the rule's name in this file.
 */
interface MemberVerdict {
  name: string;
  isCompliant: boolean;
  issues: Record<string, string>;
}

// A rule as the page lists it, without its generated id.
type RuleSummary = Omit<TeamComplianceRuleJSON, "settingId">;

class FailedQueryRecorder implements Logger {
  public failures: Array<string> = [];

  public logQuery(): void {
    return;
  }

  public logQueryError(error: string | Error, query: string): void {
    this.failures.push(
      `${error instanceof Error ? error.message : error} in: ${query}`,
    );
  }

  public logQuerySlow(): void {
    return;
  }

  public logSchemaBuild(): void {
    return;
  }

  public logMigration(): void {
    return;
  }

  public log(): void {
    return;
  }
}

describePostgres("Team compliance status against a migrated Postgres", () => {
  const schema: string = `team_compliance_status_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;

  const failedQueries: FailedQueryRecorder = new FailedQueryRecorder();

  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();
  const teamId: ObjectID = ObjectID.generate();
  const otherTeamId: ObjectID = ObjectID.generate();
  const otherProjectTeamId: ObjectID = ObjectID.generate();

  const critical: ObjectID = ObjectID.generate();
  const major: ObjectID = ObjectID.generate();
  const minor: ObjectID = ObjectID.generate();
  const criticalAlert: ObjectID = ObjectID.generate();
  const warningAlert: ObjectID = ObjectID.generate();

  /*
   * The team, in member order:
   *  - Alice: Call rule for Critical on her verified phone, Push rule for
   *    Critical alerts on her verified device. Meets everything.
   *  - Bob: a Critical rule by email only, and a Call rule for Major.
   *  - Carol: a Critical rule on her own UNVERIFIED phone.
   *  - Dave: opted out of Critical incidents.
   *  - Erin: a Critical rule pointing at ALICE's verified phone.
   *  - Frank: a Call rule for Critical written before isOptOut existed
   *    (NULL), on his verified phone.
   */
  const alice: ObjectID = ObjectID.generate();
  const bob: ObjectID = ObjectID.generate();
  const carol: ObjectID = ObjectID.generate();
  const dave: ObjectID = ObjectID.generate();
  const erin: ObjectID = ObjectID.generate();
  const frank: ObjectID = ObjectID.generate();
  // On another team of the project, and on a team of another project.
  const outsider: ObjectID = ObjectID.generate();
  const stranger: ObjectID = ObjectID.generate();

  const aliceCall: ObjectID = ObjectID.generate();
  const carolCall: ObjectID = ObjectID.generate();
  const frankCall: ObjectID = ObjectID.generate();
  const alicePush: ObjectID = ObjectID.generate();
  const bobEmail: ObjectID = ObjectID.generate();

  const NAMES: Array<[ObjectID, string]> = [
    [alice, "Alice"],
    [bob, "Bob"],
    [carol, "Carol"],
    [dave, "Dave"],
    [erin, "Erin"],
    [frank, "Frank"],
    [outsider, "Outsider"],
    [stranger, "Stranger"],
  ];

  let database: DataSource;
  let migratedForeignKeys: Array<ForeignKeyRow> = [];

  // The generated id of each rule, by the name this file gives it.
  let ruleNames: Map<string, string> = new Map<string, string>();

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["TEAM_COMPLIANCE_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["TEAM_COMPLIANCE_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["TEAM_COMPLIANCE_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      logging: ["error"],
      logger: failedQueries,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();

    migratedForeignKeys = await database.query(
      `SELECT t.relname AS "table",
              c.conname AS "name",
              pg_get_constraintdef(c.oid) AS "definition"
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = ANY($1) AND c.contype = 'f'`,
      [JOIN_TABLES],
    );

    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    for (const foreignKey of migratedForeignKeys) {
      await database.query(
        `ALTER TABLE "${schema}"."${foreignKey.table}" ADD CONSTRAINT "${foreignKey.name}" ${foreignKey.definition.replace(/REFERENCES public\./g, "REFERENCES ")}`,
      );
    }

    const currentSchema: Array<{ current_schema: string }> =
      await database.query("SELECT current_schema()");
    expect(currentSchema[0]?.current_schema).toBe(schema);

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    jest
      .spyOn(TeamComplianceSettingService, "onTriggerRealtime")
      .mockResolvedValue(undefined);
    jest
      .spyOn(TeamComplianceSettingService, "onTriggerWorkflow")
      .mockResolvedValue(undefined);

    for (const severityService of [
      IncidentSeverityService,
      AlertSeverityService,
    ]) {
      jest
        .spyOn(severityService, "onTriggerRealtime")
        .mockResolvedValue(undefined);
      jest
        .spyOn(severityService, "onTriggerWorkflow")
        .mockResolvedValue(undefined);
    }
  });

  beforeEach(async () => {
    failedQueries.failures = [];
    ruleNames = new Map<string, string>();

    await database.query(
      TABLES.map((table: string): string => {
        return `DELETE FROM "${schema}"."${table}"`;
      })
        .reverse()
        .join("; "),
    );

    for (const [id, name, enableCall] of [
      [projectId, "Compliance project", false],
      [otherProjectId, "Another project", true],
    ] as Array<[ObjectID, string, boolean]>) {
      await insert("Project", {
        _id: id.toString(),
        name: name,
        slug: `project-${id.toString()}`,
        enableCallNotifications: enableCall,
        version: 1,
      });
    }

    for (const [id, project, name] of [
      [teamId, projectId, "Platform on-call"],
      [otherTeamId, projectId, "Database on-call"],
      [otherProjectTeamId, otherProjectId, "Someone else's team"],
    ] as Array<[ObjectID, ObjectID, string]>) {
      await insert("Team", {
        _id: id.toString(),
        projectId: project.toString(),
        name: name,
        slug: `team-${id.toString()}`,
        version: 1,
      });
    }

    for (const [id, name] of NAMES) {
      await insert("User", {
        _id: id.toString(),
        name: name,
        email: `${name.toLowerCase()}@example.com`,
        slug: `user-${id.toString()}`,
        version: 1,
      });
    }

    const memberships: Array<[ObjectID, ObjectID, ObjectID]> = [
      [alice, teamId, projectId],
      [bob, teamId, projectId],
      [carol, teamId, projectId],
      [dave, teamId, projectId],
      [erin, teamId, projectId],
      [frank, teamId, projectId],
      [outsider, otherTeamId, projectId],
      [stranger, otherProjectTeamId, otherProjectId],
    ];

    for (const [userId, team, project] of memberships) {
      await insert("TeamMember", {
        _id: ObjectID.generate().toString(),
        userId: userId.toString(),
        teamId: team.toString(),
        projectId: project.toString(),
        hasAcceptedInvitation: true,
        version: 1,
      });
    }

    for (const [id, name, order] of [
      [critical, "Critical Incident", 1],
      [major, "Major Incident", 2],
      [minor, "Minor Incident", 3],
    ] as Array<[ObjectID, string, number]>) {
      await insertSeverity("IncidentSeverity", id, name, order);
    }

    for (const [id, name, order] of [
      [criticalAlert, "Critical Alert", 1],
      [warningAlert, "Warning", 2],
    ] as Array<[ObjectID, string, number]>) {
      await insertSeverity("AlertSeverity", id, name, order);
    }

    for (const [id, userId, isVerified] of [
      [aliceCall, alice, true],
      [carolCall, carol, false],
      [frankCall, frank, true],
    ] as Array<[ObjectID, ObjectID, boolean]>) {
      await insert("UserCall", {
        _id: id.toString(),
        projectId: projectId.toString(),
        userId: userId.toString(),
        phone: "+15555550100",
        isVerified: isVerified,
        verificationCode: "123456",
        version: 1,
      });
    }

    await insert("UserPush", {
      _id: alicePush.toString(),
      projectId: projectId.toString(),
      userId: alice.toString(),
      deviceToken: "synthetic-device-token",
      deviceType: "iOS",
      isVerified: true,
      version: 1,
    });

    await insert("UserEmail", {
      _id: bobEmail.toString(),
      projectId: projectId.toString(),
      userId: bob.toString(),
      email: "bob@example.com",
      isVerified: true,
      verificationCode: "123456",
      version: 1,
    });

    const incidentRule: NotificationRuleType =
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT;

    await insertNotificationRule({
      userId: alice,
      ruleType: incidentRule,
      incidentSeverityId: critical,
      userCallId: aliceCall,
    });
    await insertNotificationRule({
      userId: alice,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
      alertSeverityId: criticalAlert,
      userPushId: alicePush,
    });
    await insertNotificationRule({
      userId: bob,
      ruleType: incidentRule,
      incidentSeverityId: critical,
      userEmailId: bobEmail,
    });
    await insertNotificationRule({
      userId: bob,
      ruleType: incidentRule,
      incidentSeverityId: major,
      userCallId: aliceCall,
    });
    await insertNotificationRule({
      userId: carol,
      ruleType: incidentRule,
      incidentSeverityId: critical,
      userCallId: carolCall,
    });
    await insertNotificationRule({
      userId: dave,
      ruleType: incidentRule,
      incidentSeverityId: critical,
      isOptOut: true,
    });
    await insertNotificationRule({
      userId: erin,
      ruleType: incidentRule,
      incidentSeverityId: critical,
      userCallId: aliceCall,
    });
    await insertNotificationRule({
      userId: frank,
      ruleType: incidentRule,
      incidentSeverityId: critical,
      userCallId: frankCall,
      isOptOut: null,
    });
  });

  afterEach(() => {
    // A failed statement fails the test, even if a caller swallowed it.
    expect(failedQueries.failures).toEqual([]);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  async function insert(table: string, row: SqlRow): Promise<void> {
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
        return row[column];
      }),
    );
  }

  async function insertSeverity(
    table: "IncidentSeverity" | "AlertSeverity",
    id: ObjectID,
    name: string,
    order: number,
  ): Promise<void> {
    await insert(table, {
      _id: id.toString(),
      projectId: projectId.toString(),
      name: name,
      slug: `severity-${id.toString()}`,
      color: order === 1 ? "#FF0000" : "#FFA500",
      order: order,
      version: 1,
    });
  }

  async function insertNotificationRule(data: {
    userId: ObjectID;
    ruleType: NotificationRuleType;
    incidentSeverityId?: ObjectID;
    alertSeverityId?: ObjectID;
    userCallId?: ObjectID;
    userSmsId?: ObjectID;
    userPushId?: ObjectID;
    userEmailId?: ObjectID;
    isOptOut?: boolean | null;
  }): Promise<void> {
    const row: SqlRow = {
      _id: ObjectID.generate().toString(),
      projectId: projectId.toString(),
      userId: data.userId.toString(),
      ruleType: data.ruleType,
      isOptOut: data.isOptOut === undefined ? false : data.isOptOut,
      version: 1,
    };

    for (const column of [
      "incidentSeverityId",
      "alertSeverityId",
      "userCallId",
      "userSmsId",
      "userPushId",
      "userEmailId",
    ] as const) {
      const value: ObjectID | undefined = data[column];

      if (value) {
        row[column] = value.toString();
      }
    }

    await insert("UserNotificationRule", row);
  }

  // A rule written through the real service, remembered under `name`.
  async function createRule(
    name: string,
    data: {
      ruleType: ComplianceRuleType;
      notificationChannels?: Array<ComplianceNotificationChannel>;
      incidentSeverities?: Array<ObjectID>;
      alertSeverities?: Array<ObjectID>;
      enabled?: boolean;
    },
  ): Promise<void> {
    const setting: TeamComplianceSetting = new TeamComplianceSetting();
    setting.projectId = projectId;
    setting.teamId = teamId;
    setting.ruleType = data.ruleType;
    setting.enabled = data.enabled === undefined ? true : data.enabled;

    const raw: Record<string, unknown> = setting as unknown as Record<
      string,
      unknown
    >;

    // The list, as the Dashboard's rule form sends it.
    if (data.notificationChannels) {
      raw["notificationChannels"] = data.notificationChannels;
    }

    // `{_id}` JSON, one of the shapes the API hands the hooks.
    const asJson: (list: Array<ObjectID>) => Array<JSONObject> = (
      list: Array<ObjectID>,
    ): Array<JSONObject> => {
      return list.map((id: ObjectID): JSONObject => {
        return { _id: id.toString() };
      });
    };

    if (data.incidentSeverities) {
      raw["incidentSeverities"] = asJson(data.incidentSeverities);
    }

    if (data.alertSeverities) {
      raw["alertSeverities"] = asJson(data.alertSeverities);
    }

    const created: TeamComplianceSetting =
      await TeamComplianceSettingService.create({
        data: setting,
        props: { isRoot: true },
      });

    ruleNames.set(created.id!.toString(), name);
  }

  async function getStatus(): Promise<TeamComplianceStatusJSON> {
    return await TeamComplianceService.getTeamComplianceStatus(
      teamId,
      projectId,
    );
  }

  function ruleName(settingId: string): string {
    return ruleNames.get(settingId) || `unknown rule ${settingId}`;
  }

  /*
   * By name: the service lists members in the order their TeamMember rows
   * come back, and the page sorts them itself (worst first, then name).
   */
  function byName(
    status: TeamComplianceStatusJSON,
  ): Array<TeamMemberComplianceJSON> {
    return [...status.userComplianceStatuses].sort(
      (a: TeamMemberComplianceJSON, b: TeamMemberComplianceJSON): number => {
        return a.userName.localeCompare(b.userName);
      },
    );
  }

  function verdicts(status: TeamComplianceStatusJSON): Array<MemberVerdict> {
    return byName(status).map(
      (member: TeamMemberComplianceJSON): MemberVerdict => {
        const issues: Record<string, string> = {};

        for (const issue of member.nonCompliantRules) {
          issues[ruleName(issue.settingId)] = issue.reason;
        }

        return {
          name: member.userName,
          isCompliant: member.isCompliant,
          issues: issues,
        };
      },
    );
  }

  function rulesByName(
    status: TeamComplianceStatusJSON,
  ): Array<[string, RuleSummary]> {
    return status.complianceSettings.map(
      (rule: TeamComplianceRuleJSON): [string, RuleSummary] => {
        const { settingId, ...summary } = rule;
        return [ruleName(settingId), summary];
      },
    );
  }

  test("Call for Critical incidents: covered, missing, unverified, not-owned, opted out and legacy rows", async () => {
    await createRule("call-for-critical", {
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannels: [ComplianceNotificationChannel.Call],
      incidentSeverities: [critical],
    });

    const status: TeamComplianceStatusJSON = await getStatus();

    expect(status.teamId).toBe(teamId.toString());
    expect(status.teamName).toBe("Platform on-call");
    expect(Number.isNaN(Date.parse(status.evaluatedAt))).toBe(false);

    expect(rulesByName(status)).toEqual([
      [
        "call-for-critical",
        {
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          enabled: true,
          notificationChannels: [ComplianceNotificationChannel.Call],
          severityKind: ComplianceSeverityKind.Incident,
          appliesToAllSeverities: false,
          severities: [
            {
              id: critical.toString(),
              name: "Critical Incident",
              color: "#FF0000",
            },
          ],
          compliantCount: 2,
          nonCompliantCount: 4,
          // The project has calls switched off.
          warnings: [CALL_SWITCHED_OFF_WARNING],
        },
      ],
    ]);

    const unverifiedCall: string =
      "The Call rule for incident severities Critical Incident points at an unverified phone number for calls";

    expect(verdicts(status)).toEqual([
      { name: "Alice", isCompliant: true, issues: {} },
      {
        name: "Bob",
        isCompliant: false,
        issues: {
          "call-for-critical":
            "No Call rule for incident severities: Critical Incident",
        },
      },
      {
        name: "Carol",
        isCompliant: false,
        issues: { "call-for-critical": unverifiedCall },
      },
      {
        name: "Dave",
        isCompliant: false,
        issues: {
          "call-for-critical":
            "Opted out of incident notifications for: Critical Incident",
        },
      },
      {
        name: "Erin",
        isCompliant: false,
        issues: { "call-for-critical": unverifiedCall },
      },
      { name: "Frank", isCompliant: true, issues: {} },
    ]);

    const aliceStatus: TeamMemberComplianceJSON | undefined = byName(status)[0];

    expect(aliceStatus?.userId).toBe(alice.toString());
    expect(aliceStatus?.userEmail).toBe("alice@example.com");
  });

  test("a rule for every severity checks the project's severities in order, and alert, method and disabled rules sit beside it", async () => {
    await createRule("call-for-every-incident", {
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannels: [ComplianceNotificationChannel.Call],
    });
    await createRule("push-for-critical-alerts", {
      ruleType: ComplianceRuleType.HasAlertOnCallRules,
      notificationChannels: [ComplianceNotificationChannel.Push],
      alertSeverities: [criticalAlert],
    });
    await createRule("verified-phone", {
      ruleType: ComplianceRuleType.HasNotificationCallMethod,
    });
    await createRule("paused-sms", {
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannels: [ComplianceNotificationChannel.SMS],
      incidentSeverities: [major, critical],
      enabled: false,
    });

    const status: TeamComplianceStatusJSON = await getStatus();

    expect(rulesByName(status)).toEqual([
      [
        "call-for-every-incident",
        {
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          enabled: true,
          notificationChannels: [ComplianceNotificationChannel.Call],
          severityKind: ComplianceSeverityKind.Incident,
          appliesToAllSeverities: true,
          severities: [],
          compliantCount: 0,
          nonCompliantCount: 6,
          warnings: [CALL_SWITCHED_OFF_WARNING],
        },
      ],
      [
        "push-for-critical-alerts",
        {
          ruleType: ComplianceRuleType.HasAlertOnCallRules,
          enabled: true,
          notificationChannels: [ComplianceNotificationChannel.Push],
          severityKind: ComplianceSeverityKind.Alert,
          appliesToAllSeverities: false,
          severities: [
            {
              id: criticalAlert.toString(),
              name: "Critical Alert",
              color: "#FF0000",
            },
          ],
          compliantCount: 1,
          nonCompliantCount: 5,
          warnings: [],
        },
      ],
      [
        "verified-phone",
        {
          ruleType: ComplianceRuleType.HasNotificationCallMethod,
          enabled: true,
          notificationChannels: [],
          severityKind: null,
          appliesToAllSeverities: false,
          severities: [],
          compliantCount: 2,
          nonCompliantCount: 4,
          warnings: [CALL_SWITCHED_OFF_WARNING],
        },
      ],
      [
        "paused-sms",
        {
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          enabled: false,
          notificationChannels: [ComplianceNotificationChannel.SMS],
          severityKind: ComplianceSeverityKind.Incident,
          appliesToAllSeverities: false,
          // In severity order, whatever order they were picked in.
          severities: [
            {
              id: critical.toString(),
              name: "Critical Incident",
              color: "#FF0000",
            },
            {
              id: major.toString(),
              name: "Major Incident",
              color: "#FFA500",
            },
          ],
          compliantCount: 0,
          nonCompliantCount: 0,
          warnings: [],
        },
      ],
    ]);

    const noPush: string =
      "No Push notification rule for alert severities: Critical Alert";
    const noPhone: string =
      "No verified phone number configured for call notifications";

    expect(verdicts(status)).toEqual([
      {
        name: "Alice",
        isCompliant: false,
        issues: {
          "call-for-every-incident":
            "No Call rule for incident severities: Major Incident, Minor Incident",
        },
      },
      {
        name: "Bob",
        isCompliant: false,
        issues: {
          /*
           * Bob's Major rule points at ALICE's phone: a broken rule, not a
           * missing one.
           */
          "call-for-every-incident":
            "No Call rule for incident severities: Critical Incident, Minor Incident. The Call rule for incident severities Major Incident points at an unverified phone number for calls",
          "push-for-critical-alerts": noPush,
          "verified-phone": noPhone,
        },
      },
      {
        name: "Carol",
        isCompliant: false,
        issues: {
          "call-for-every-incident":
            "No Call rule for incident severities: Major Incident, Minor Incident. The Call rule for incident severities Critical Incident points at an unverified phone number for calls",
          "push-for-critical-alerts": noPush,
          "verified-phone": noPhone,
        },
      },
      {
        name: "Dave",
        isCompliant: false,
        issues: {
          "call-for-every-incident":
            "No Call rule for incident severities: Major Incident, Minor Incident. Opted out of incident notifications for: Critical Incident",
          "push-for-critical-alerts": noPush,
          "verified-phone": noPhone,
        },
      },
      {
        name: "Erin",
        isCompliant: false,
        issues: {
          "call-for-every-incident":
            "No Call rule for incident severities: Major Incident, Minor Incident. The Call rule for incident severities Critical Incident points at an unverified phone number for calls",
          "push-for-critical-alerts": noPush,
          "verified-phone": noPhone,
        },
      },
      {
        name: "Frank",
        isCompliant: false,
        issues: {
          "call-for-every-incident":
            "No Call rule for incident severities: Major Incident, Minor Incident",
          "push-for-critical-alerts": noPush,
        },
      },
    ]);
  });

  /*
   * A rule on several channels checks each of them, exactly as that many
   * one-channel rules would: here Call AND Push for Critical incidents.
   * Bob meets it with ONE notification rule naming both his verified phone
   * and his verified push device.
   */
  test("Call and Push for Critical incidents: a member passes only with a working rule on both channels", async () => {
    const alicePushForIncidents: ObjectID = ObjectID.generate();
    const bobCall: ObjectID = ObjectID.generate();
    const bobPush: ObjectID = ObjectID.generate();

    await insert("UserPush", {
      _id: alicePushForIncidents.toString(),
      projectId: projectId.toString(),
      userId: alice.toString(),
      deviceToken: "synthetic-device-token-2",
      deviceType: "Android",
      isVerified: true,
      version: 1,
    });
    await insert("UserCall", {
      _id: bobCall.toString(),
      projectId: projectId.toString(),
      userId: bob.toString(),
      phone: "+15555550101",
      isVerified: true,
      verificationCode: "123456",
      version: 1,
    });
    await insert("UserPush", {
      _id: bobPush.toString(),
      projectId: projectId.toString(),
      userId: bob.toString(),
      deviceToken: "synthetic-device-token-3",
      deviceType: "iOS",
      isVerified: true,
      version: 1,
    });

    await insertNotificationRule({
      userId: alice,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      incidentSeverityId: critical,
      userPushId: alicePushForIncidents,
    });
    await insertNotificationRule({
      userId: bob,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      incidentSeverityId: critical,
      userCallId: bobCall,
      userPushId: bobPush,
    });

    await createRule("call-and-push-for-critical", {
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      // Picked Push first; listed - and stored - in catalog order.
      notificationChannels: [
        ComplianceNotificationChannel.Push,
        ComplianceNotificationChannel.Call,
      ],
      incidentSeverities: [critical],
    });

    const stored: Array<SqlRow> = await database.query(
      `SELECT "notificationChannels", "notificationChannel" FROM "${schema}"."TeamComplianceSetting"`,
    );

    expect(stored).toEqual([
      {
        notificationChannels: [
          ComplianceNotificationChannel.Call,
          ComplianceNotificationChannel.Push,
        ],
        notificationChannel: ComplianceNotificationChannel.Call,
      },
    ]);

    const status: TeamComplianceStatusJSON = await getStatus();

    expect(rulesByName(status)).toEqual([
      [
        "call-and-push-for-critical",
        {
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          enabled: true,
          notificationChannels: [
            ComplianceNotificationChannel.Call,
            ComplianceNotificationChannel.Push,
          ],
          severityKind: ComplianceSeverityKind.Incident,
          appliesToAllSeverities: false,
          severities: [
            {
              id: critical.toString(),
              name: "Critical Incident",
              color: "#FF0000",
            },
          ],
          compliantCount: 2,
          nonCompliantCount: 4,
          // Calls are off for the project; push has no project switch.
          warnings: [CALL_SWITCHED_OFF_WARNING],
        },
      ],
    ]);

    const noPush: string =
      "No Push notification rule for incident severities: Critical Incident";
    const unverifiedCall: string =
      "The Call rule for incident severities Critical Incident points at an unverified phone number for calls";

    expect(verdicts(status)).toEqual([
      { name: "Alice", isCompliant: true, issues: {} },
      { name: "Bob", isCompliant: true, issues: {} },
      {
        name: "Carol",
        isCompliant: false,
        issues: {
          "call-and-push-for-critical": `${unverifiedCall}. ${noPush}`,
        },
      },
      {
        // Said once, not once per channel.
        name: "Dave",
        isCompliant: false,
        issues: {
          "call-and-push-for-critical":
            "Opted out of incident notifications for: Critical Incident",
        },
      },
      {
        name: "Erin",
        isCompliant: false,
        issues: {
          "call-and-push-for-critical": `${unverifiedCall}. ${noPush}`,
        },
      },
      {
        // His Call rule counts; there is no Push one.
        name: "Frank",
        isCompliant: false,
        issues: { "call-and-push-for-critical": noPush },
      },
    ]);
  });

  test("channels a project switched off are named in one warning, and each drops out when switched on", async () => {
    const carolSms: ObjectID = ObjectID.generate();

    await insert("UserSMS", {
      _id: carolSms.toString(),
      projectId: projectId.toString(),
      userId: carol.toString(),
      phone: "+15555550102",
      isVerified: true,
      verificationCode: "123456",
      version: 1,
    });
    await insertNotificationRule({
      userId: carol,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      incidentSeverityId: critical,
      userSmsId: carolSms,
    });

    await createRule("sms-and-call-for-critical", {
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannels: [
        ComplianceNotificationChannel.SMS,
        ComplianceNotificationChannel.Call,
      ],
      incidentSeverities: [critical],
    });
    await createRule("whatsapp-push-and-call-for-critical", {
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannels: [
        ComplianceNotificationChannel.WhatsApp,
        ComplianceNotificationChannel.Push,
        ComplianceNotificationChannel.Call,
      ],
      incidentSeverities: [critical],
    });

    const warnings: () => Promise<Array<Array<string>>> = async (): Promise<
      Array<Array<string>>
    > => {
      return (await getStatus()).complianceSettings.map(
        (rule: TeamComplianceRuleJSON): Array<string> => {
          return rule.warnings;
        },
      );
    };

    expect(await warnings()).toEqual([
      [
        "Call and SMS notifications are switched off for this project, so members will not be notified on these channels even when they meet this rule. Turn them on in Project Settings > Notification Settings.",
      ],
      [CALL_SWITCHED_OFF_WARNING, WHATSAPP_SWITCHED_OFF_WARNING],
    ]);

    // Carol's SMS rule counts; only her unverified phone is left.
    const carolVerdict: MemberVerdict | undefined = verdicts(
      await getStatus(),
    ).find((verdict: MemberVerdict): boolean => {
      return verdict.name === "Carol";
    });

    expect(carolVerdict?.issues["sms-and-call-for-critical"]).toBe(
      "The Call rule for incident severities Critical Incident points at an unverified phone number for calls",
    );

    await database.query(
      `UPDATE "${schema}"."Project" SET "enableCallNotifications" = true WHERE "_id" = $1`,
      [projectId.toString()],
    );

    expect(await warnings()).toEqual([
      [
        "SMS notifications are switched off for this project, so members will not be notified by SMS even when they meet this rule. Turn them on in Project Settings > Notification Settings.",
      ],
      [WHATSAPP_SWITCHED_OFF_WARNING],
    ]);

    await database.query(
      `UPDATE "${schema}"."Project" SET "enableSmsNotifications" = true, "enableWhatsAppNotifications" = true WHERE "_id" = $1`,
      [projectId.toString()],
    );

    expect(await warnings()).toEqual([[], []]);
  });

  /*
   * A replica of the previous build, still serving while this one rolls
   * out, writes only notificationChannel. The page must check what it
   * wrote: the single channel of a rule it created (no list at all), and
   * the single channel it re-picked on a rule whose list it never saw.
   */
  test("rules written by an older build are checked by the channel it wrote", async () => {
    const legacyId: ObjectID = ObjectID.generate();

    await insert("TeamComplianceSetting", {
      _id: legacyId.toString(),
      projectId: projectId.toString(),
      teamId: teamId.toString(),
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      enabled: true,
      notificationChannel: ComplianceNotificationChannel.Push,
      notificationChannels: null,
      version: 1,
    });
    await insert("TeamComplianceSettingIncidentSeverity", {
      teamComplianceSettingId: legacyId.toString(),
      incidentSeverityId: critical.toString(),
    });
    ruleNames.set(legacyId.toString(), "push-written-by-an-older-build");

    await createRule("re-picked-by-an-older-build", {
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannels: [
        ComplianceNotificationChannel.Call,
        ComplianceNotificationChannel.Push,
      ],
      incidentSeverities: [critical],
    });

    await database.query(
      `UPDATE "${schema}"."TeamComplianceSetting" SET "notificationChannel" = 'Email' WHERE "_id" <> $1`,
      [legacyId.toString()],
    );

    const status: TeamComplianceStatusJSON = await getStatus();

    expect(
      rulesByName(status).map(
        ([name, rule]: [string, RuleSummary]): [
          string,
          Array<ComplianceNotificationChannel>,
          Array<string>,
        ] => {
          return [name, rule.notificationChannels, rule.warnings];
        },
      ),
    ).toEqual([
      [
        "push-written-by-an-older-build",
        [ComplianceNotificationChannel.Push],
        [],
      ],
      [
        "re-picked-by-an-older-build",
        [ComplianceNotificationChannel.Email],
        // No longer a Call rule, so no word about calls being off.
        [],
      ],
    ]);

    const verdictsByName: Map<string, MemberVerdict> = new Map<
      string,
      MemberVerdict
    >(
      verdicts(status).map(
        (verdict: MemberVerdict): [string, MemberVerdict] => {
          return [verdict.name, verdict];
        },
      ),
    );

    // Bob's verified email covers Critical; nobody else has an email rule.
    expect(verdictsByName.get("Bob")?.issues).toEqual({
      "push-written-by-an-older-build":
        "No Push notification rule for incident severities: Critical Incident",
    });
    expect(verdictsByName.get("Frank")?.issues).toEqual({
      "push-written-by-an-older-build":
        "No Push notification rule for incident severities: Critical Incident",
      "re-picked-by-an-older-build":
        "No Email rule for incident severities: Critical Incident",
    });
  });

  test("turning the project's calls on clears the warning, and pausing a rule stops it being checked", async () => {
    await createRule("call-for-critical", {
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannels: [ComplianceNotificationChannel.Call],
      incidentSeverities: [critical],
    });

    await database.query(
      `UPDATE "${schema}"."Project" SET "enableCallNotifications" = true WHERE "_id" = $1`,
      [projectId.toString()],
    );

    let status: TeamComplianceStatusJSON = await getStatus();

    expect(status.complianceSettings[0]?.warnings).toEqual([]);

    const settingId: string = status.complianceSettings[0]!.settingId;

    await TeamComplianceSettingService.updateOneById({
      id: new ObjectID(settingId),
      data: { enabled: false },
      props: { isRoot: true },
    });

    status = await getStatus();

    expect(status.complianceSettings[0]).toMatchObject({
      enabled: false,
      compliantCount: 0,
      nonCompliantCount: 0,
      warnings: [],
    });
    expect(
      status.userComplianceStatuses.every(
        (member: TeamMemberComplianceJSON): boolean => {
          return member.isCompliant;
        },
      ),
    ).toBe(true);
  });

  test("a rescoped rule is checked against its new severities", async () => {
    await createRule("call-for-critical", {
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannels: [ComplianceNotificationChannel.Call],
      incidentSeverities: [critical],
    });

    const settingId: string = (await getStatus()).complianceSettings[0]!
      .settingId;

    /*
     * `{_id}` JSON, as BaseAPI.updateItem passes it on. Built apart from the
     * call, so the compiler does not expand the deep partial-entity type.
     */
    const rescope: UpdateBy<TeamComplianceSetting>["data"] = {
      incidentSeverities: [{ _id: major.toString() }],
    } as unknown as UpdateBy<TeamComplianceSetting>["data"];

    await TeamComplianceSettingService.updateOneById({
      id: new ObjectID(settingId),
      data: rescope,
      props: { isRoot: true },
    });

    const status: TeamComplianceStatusJSON = await getStatus();

    expect(status.complianceSettings[0]?.severities).toEqual([
      { id: major.toString(), name: "Major Incident", color: "#FFA500" },
    ]);

    const issues: Array<[string, Array<string>]> = byName(status).map(
      (member: TeamMemberComplianceJSON): [string, Array<string>] => {
        return [
          member.userName,
          member.nonCompliantRules.map(
            (issue: TeamComplianceIssueJSON): string => {
              return issue.reason;
            },
          ),
        ];
      },
    );

    const noMajor: string =
      "No Call rule for incident severities: Major Incident";

    expect(issues).toEqual([
      ["Alice", [noMajor]],
      [
        "Bob",
        [
          "The Call rule for incident severities Major Incident points at an unverified phone number for calls",
        ],
      ],
      ["Carol", [noMajor]],
      ["Dave", [noMajor]],
      ["Erin", [noMajor]],
      ["Frank", [noMajor]],
    ]);
  });

  /*
   * The severity join row cascades with the severity (the migration's ON
   * DELETE CASCADE), and a rule with no severity left reads exactly like one
   * created with none - a rule for every severity of its kind. Deleting
   * "Critical" through IncidentSeverityService therefore PAUSES "Call for
   * Critical incidents" instead of letting it widen to every incident
   * severity and fail the whole team against a rule nobody wrote. The page
   * lists it as paused with no severities - not "all severities" - and says
   * why, for an admin to re-scope or delete.
   */
  test("deleting a rule's only severity pauses the rule instead of widening it to every severity", async () => {
    await createRule("call-for-critical", {
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannels: [ComplianceNotificationChannel.Call],
      incidentSeverities: [critical],
    });
    await createRule("call-for-critical-and-major", {
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannels: [ComplianceNotificationChannel.Push],
      incidentSeverities: [critical, major],
    });

    await IncidentSeverityService.deleteOneById({
      id: critical,
      props: { isRoot: true },
    });

    const status: TeamComplianceStatusJSON = await getStatus();

    expect(rulesByName(status)).toEqual([
      [
        "call-for-critical",
        expect.objectContaining({
          enabled: false,
          appliesToAllSeverities: false,
          severities: [],
          compliantCount: 0,
          nonCompliantCount: 0,
          warnings: [SEVERITIES_DELETED_WARNING],
        }),
      ],
      [
        "call-for-critical-and-major",
        expect.objectContaining({
          enabled: true,
          appliesToAllSeverities: false,
          severities: [
            { id: major.toString(), name: "Major Incident", color: "#FFA500" },
          ],
        }),
      ],
    ]);

    // Nobody fails the paused rule; the narrowed one checks Major only.
    for (const member of byName(status)) {
      for (const issue of member.nonCompliantRules) {
        expect(ruleName(issue.settingId)).toBe("call-for-critical-and-major");
        expect(issue.reason).toContain("Major Incident");
        expect(issue.reason).not.toContain("Minor Incident");
      }
    }
  });

  /*
   * The runtime loads the owner of every method a rule names and refuses the
   * whole rule - nothing is sent on any channel - when one is somebody
   * else's (UserNotificationRuleService.executeNotificationRuleItem). So
   * Frank's Call rule on his own verified phone stops covering him the
   * moment it also names Bob's email.
   */
  test("a Call rule that also names another member's email is refused, as the runtime refuses it", async () => {
    await createRule("call-for-critical", {
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannels: [ComplianceNotificationChannel.Call],
      incidentSeverities: [critical],
    });

    const frankBefore: MemberVerdict | undefined = verdicts(
      await getStatus(),
    ).find((verdict: MemberVerdict): boolean => {
      return verdict.name === "Frank";
    });

    expect(frankBefore).toEqual({
      name: "Frank",
      isCompliant: true,
      issues: {},
    });

    await database.query(
      `UPDATE "${schema}"."UserNotificationRule" SET "userEmailId" = $1 WHERE "userId" = $2`,
      [bobEmail.toString(), frank.toString()],
    );

    const frankAfter: MemberVerdict | undefined = verdicts(
      await getStatus(),
    ).find((verdict: MemberVerdict): boolean => {
      return verdict.name === "Frank";
    });

    expect(frankAfter).toEqual({
      name: "Frank",
      isCompliant: false,
      issues: {
        "call-for-critical":
          "The Call rule for incident severities Critical Incident is never sent, because another notification method on it belongs to a different user",
      },
    });
  });

  /*
   * Emptied by a delete, the rule is stored with no severities - as the
   * team's real "every severity" rule of the same type and channel is. It
   * must not be switched back on as a second copy of that rule; the edit
   * form re-scopes it, and it is checked again.
   */
  test("a rule a delete emptied cannot be switched back on as it is; re-scoped from its edit form, it is checked again", async () => {
    await createRule("call-for-every-incident", {
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannels: [ComplianceNotificationChannel.Call],
    });
    await createRule("call-for-critical", {
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannels: [ComplianceNotificationChannel.Call],
      incidentSeverities: [critical],
    });

    await IncidentSeverityService.deleteOneById({
      id: critical,
      props: { isRoot: true },
    });

    let status: TeamComplianceStatusJSON = await getStatus();

    expect(
      rulesByName(status).map(
        ([name, rule]: [string, RuleSummary]): [string, boolean, boolean] => {
          return [name, rule.enabled, rule.appliesToAllSeverities];
        },
      ),
    ).toEqual([
      ["call-for-every-incident", true, true],
      ["call-for-critical", false, false],
    ]);

    const emptiedId: ObjectID = new ObjectID(
      status.complianceSettings[1]!.settingId,
    );
    const everyIncidentId: ObjectID = new ObjectID(
      status.complianceSettings[0]!.settingId,
    );

    await expect(
      TeamComplianceSettingService.updateOneById({
        id: emptiedId,
        data: { enabled: true },
        props: { isRoot: true },
      }),
    ).rejects.toThrow(SEVERITIES_DELETED_ENABLE_MESSAGE);

    // The real every-severity rule's edit form still saves.
    const everyIncidentForm: UpdateBy<TeamComplianceSetting>["data"] = {
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannels: [ComplianceNotificationChannel.Call],
      incidentSeverities: [],
      alertSeverities: [],
      enabled: true,
    } as unknown as UpdateBy<TeamComplianceSetting>["data"];

    await TeamComplianceSettingService.updateOneById({
      id: everyIncidentId,
      data: everyIncidentForm,
      props: { isRoot: true },
    });

    // The emptied rule's edit form: a new severity, switched back on.
    const rescope: UpdateBy<TeamComplianceSetting>["data"] = {
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannels: [ComplianceNotificationChannel.Call],
      incidentSeverities: [{ _id: major.toString() }],
      alertSeverities: [],
      enabled: true,
    } as unknown as UpdateBy<TeamComplianceSetting>["data"];

    await TeamComplianceSettingService.updateOneById({
      id: emptiedId,
      data: rescope,
      props: { isRoot: true },
    });

    status = await getStatus();

    expect(rulesByName(status)[1]).toEqual([
      "call-for-critical",
      expect.objectContaining({
        enabled: true,
        appliesToAllSeverities: false,
        severities: [
          { id: major.toString(), name: "Major Incident", color: "#FFA500" },
        ],
        compliantCount: 0,
        nonCompliantCount: 6,
        warnings: [CALL_SWITCHED_OFF_WARNING],
      }),
    ]);
  });

  /*
   * Project.enableWhatsAppNotifications is off on this project (its
   * default). WhatsAppService still sends to numbers verified before it went
   * off, but nobody can add a number while it is off - so a WhatsApp rule
   * says members cannot meet it, not that pages stop.
   */
  test("a WhatsApp rule warns that members cannot add a number while WhatsApp is switched off", async () => {
    await createRule("verified-whatsapp", {
      ruleType: ComplianceRuleType.HasNotificationWhatsAppMethod,
    });
    await createRule("whatsapp-for-critical", {
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannels: [ComplianceNotificationChannel.WhatsApp],
      incidentSeverities: [critical],
    });

    let status: TeamComplianceStatusJSON = await getStatus();

    expect(
      status.complianceSettings.map((rule: TeamComplianceRuleJSON) => {
        return rule.warnings;
      }),
    ).toEqual([
      [WHATSAPP_SWITCHED_OFF_WARNING],
      [WHATSAPP_SWITCHED_OFF_WARNING],
    ]);

    await database.query(
      `UPDATE "${schema}"."Project" SET "enableWhatsAppNotifications" = true WHERE "_id" = $1`,
      [projectId.toString()],
    );

    status = await getStatus();

    expect(
      status.complianceSettings.map((rule: TeamComplianceRuleJSON) => {
        return rule.warnings;
      }),
    ).toEqual([[], []]);
  });

  /*
   * One bind parameter per id in an IN list, and Postgres refuses a
   * statement with more than 65,535 of them. The method ids come from the
   * members' own rules, which nothing caps, so they are looked up in chunks:
   * a member with more rules than that still gets a page, not a 500.
   */
  test("more referenced methods than one statement can bind still produce a page", async () => {
    await createRule("webhook-for-critical", {
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannels: [ComplianceNotificationChannel.Webhook],
      incidentSeverities: [critical],
    });

    const count: number = 66000;

    await database.query(
      `INSERT INTO "${schema}"."UserWebhook" ("_id", "projectId", "userId", "name", "webhookUrl", "version")
         SELECT gen_random_uuid(), $1, $2, 'Hook ' || n, 'https://example.com/hook', 1
           FROM generate_series(1, $3::int) AS n`,
      [projectId.toString(), bob.toString(), count],
    );
    await database.query(
      `INSERT INTO "${schema}"."UserNotificationRule" ("_id", "projectId", "userId", "ruleType", "incidentSeverityId", "userWebhookId", "isOptOut", "version")
         SELECT gen_random_uuid(), "projectId", "userId", $1, $2, "_id", false, 1
           FROM "${schema}"."UserWebhook"`,
      [NotificationRuleType.ON_CALL_EXECUTED_INCIDENT, critical.toString()],
    );

    const status: TeamComplianceStatusJSON = await getStatus();

    const bobVerdict: MemberVerdict | undefined = verdicts(status).find(
      (verdict: MemberVerdict): boolean => {
        return verdict.name === "Bob";
      },
    );

    expect(bobVerdict).toEqual({ name: "Bob", isCompliant: true, issues: {} });
    expect(status.complianceSettings[0]).toMatchObject({
      compliantCount: 1,
      nonCompliantCount: 5,
    });
  }, 300000);

  test("another project's team is not found, and nobody outside the team is listed", async () => {
    await expect(
      TeamComplianceService.getTeamComplianceStatus(
        otherProjectTeamId,
        projectId,
      ),
    ).rejects.toThrow("Team not found");

    const status: TeamComplianceStatusJSON = await getStatus();

    expect(
      byName(status).map((member: TeamMemberComplianceJSON): string => {
        return member.userName;
      }),
    ).toEqual(["Alice", "Bob", "Carol", "Dave", "Erin", "Frank"]);
    expect(status.complianceSettings).toEqual([]);
  });
});
