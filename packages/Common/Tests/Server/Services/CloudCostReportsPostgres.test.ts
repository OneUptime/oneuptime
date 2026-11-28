import Entities from "../../../Models/DatabaseModels/Index";
import CloudCostReport from "../../../Models/DatabaseModels/CloudCostReport";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import CloudCostReportService, {
  CLOUD_COST_REPORT_OUTSIDE_REFUSAL,
} from "../../../Server/Services/CloudCostReportService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import CloudCostReportSchedule from "../../../Server/Utils/CloudCost/CloudCostReportSchedule";
import CloudCostReportSender, {
  CloudCostReportSendResult,
} from "../../../Server/Utils/CloudCost/CloudCostReportSender";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  CloudCostReportPeriod,
  CloudCostReportScope,
} from "../../../Types/Cloud/CloudCostReport";
import Recurring from "../../../Types/Events/Recurring";
import EventInterval from "../../../Types/Events/EventInterval";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import UserType from "../../../Types/UserType";
import moment from "moment-timezone";
import { DataSource } from "typeorm";

/*
 * COST REPORTS (#11009) EXECUTED ON POSTGRES. The unit suites hold the
 * rules with every read stood in for; only a real database shows what the
 * service, its hooks and the schedule's claim do to real rows:
 *
 *   - a report is made by whoever may make the other Cloud records, and
 *     goes out next Monday (or on the 1st) at 09:00 in its maker's time
 *     zone, with its period and scope said;
 *   - its name is its own within its project;
 *   - an address outside the project, or a channel, needs a Cloud admin,
 *     who is kept as the one the report is read as for them;
 *   - its people, teams and records are its project's own;
 *   - a change of schedule moves its next send, nothing else does;
 *   - two replicas that find one report due send it once.
 *
 * Opt in with RUN_POSTGRES_CLOUD_COST_REPORT_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database right after its drift check. The STRUCTURE of every table the
 * service reads and writes is cloned into a unique schema (search_path
 * holds only that schema), dropped afterwards. Credentials from
 * DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * CLOUD_COST_REPORT_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * CLOUD_COST_REPORT_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_CLOUD_COST_REPORT_TESTS"] === "true"
    ? describe
    : describe.skip;

// The tables the service writes, cloned whole.
const SERVICE_TABLES: Array<string> = [
  "CloudCostReport",
  "CloudCostReportUser",
  "CloudCostReportTeam",
];

/*
 * The tables it reads, filled here by hand: every NOT NULL but the keys is
 * relaxed, so a fixture row names only what the test is about.
 */
const FIXTURE_TABLES: Array<string> = [
  "User",
  "Team",
  "TeamMember",
  "CloudAccount",
  "CloudCostView",
  "CloudCostGroup",
];

const KEPT_NOT_NULL: Array<string> = ["_id", "createdAt", "updatedAt"];

const PROJECT_ID: ObjectID = ObjectID.generate();
const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();

const ALICE: ObjectID = ObjectID.generate();
const CAROL: ObjectID = ObjectID.generate();
const VIC: ObjectID = ObjectID.generate();
const OUTSIDER: ObjectID = ObjectID.generate();

const FINANCE_TEAM: string = ObjectID.generate().toString();
const OTHER_TEAM: string = ObjectID.generate().toString();
const ACCOUNT: string = ObjectID.generate().toString();
const OTHER_ACCOUNT: string = ObjectID.generate().toString();
const VIEW: string = ObjectID.generate().toString();

function propsOf(
  userId: ObjectID,
  permissions: Array<Permission>,
  projectId: ObjectID = PROJECT_ID,
): DatabaseCommonInteractionProps {
  const tenant: UserTenantAccessPermission = {
    projectId,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission) => {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };

  return {
    tenantId: projectId,
    userId,
    userType: UserType.User,
    userTenantAccessPermission: { [projectId.toString()]: tenant },
  };
}

// Makes the other Cloud records: may make reports.
const MEMBER: DatabaseCommonInteractionProps = propsOf(ALICE, [
  Permission.CloudMember,
]);
// May send outside the project.
const CLOUD_ADMIN: DatabaseCommonInteractionProps = propsOf(CAROL, [
  Permission.CloudAdmin,
]);
// May read the costs, and make nothing.
const VIEWER: DatabaseCommonInteractionProps = propsOf(VIC, [
  Permission.CloudViewer,
]);
const OTHER_ADMIN: DatabaseCommonInteractionProps = propsOf(
  CAROL,
  [Permission.ProjectAdmin],
  OTHER_PROJECT_ID,
);

function monthly(): Recurring {
  const recurring: Recurring = new Recurring();
  recurring.intervalType = EventInterval.Month;
  recurring.intervalCount = new PositiveNumber(1);
  return recurring;
}

describePostgres("Cost reports against Postgres", () => {
  const schema: string = `cloud_cost_reports_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;

  async function insert(
    table: string,
    row: Record<string, unknown>,
  ): Promise<void> {
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

  async function create(
    data: Partial<CloudCostReport> & Record<string, unknown>,
    props: DatabaseCommonInteractionProps = MEMBER,
  ): Promise<CloudCostReport> {
    const report: CloudCostReport = new CloudCostReport();
    report.projectId = props.tenantId || PROJECT_ID;
    report.name = `Report ${ObjectID.generate().toString().slice(0, 8)}`;
    Object.assign(report, data);

    return CloudCostReportService.create({ data: report, props });
  }

  async function stored(id: ObjectID): Promise<CloudCostReport> {
    const found: CloudCostReport | null =
      await CloudCostReportService.findOneById({
        id,
        select: {
          _id: true,
          name: true,
          scope: true,
          period: true,
          costBasis: true,
          cloudAccountId: true,
          cloudCostViewId: true,
          cloudCostGroupId: true,
          isSentToGroupTeams: true,
          emailAddresses: true,
          slackChannelNames: true,
          outsideRecipientsSetByUserId: true,
          recurringInterval: true,
          sendFirstReportAt: true,
          nextSendAt: true,
          timezone: true,
          isEnabled: true,
          createdByUserId: true,
          recipientUsers: { _id: true },
          recipientTeams: { _id: true },
        } as never,
        props: { isRoot: true },
      });

    if (!found) {
      throw new Error("The report was not stored.");
    }

    return found;
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["CLOUD_COST_REPORT_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["CLOUD_COST_REPORT_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["CLOUD_COST_REPORT_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema}` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of [...SERVICE_TABLES, ...FIXTURE_TABLES]) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    for (const table of FIXTURE_TABLES) {
      const columns: Array<{ column_name: string }> = await database.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2 AND is_nullable = 'NO'`,
        [schema, table],
      );

      for (const column of columns) {
        if (!KEPT_NOT_NULL.includes(column.column_name)) {
          await database.query(
            `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
          );
        }
      }
    }

    expect(
      (await database.query("SELECT current_schema()"))[0].current_schema,
    ).toBe(schema);

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    jest
      .spyOn(
        CloudCostReportService as DatabaseService<any>,
        "onTriggerRealtime",
      )
      .mockResolvedValue();
    jest
      .spyOn(
        CloudCostReportService as DatabaseService<any>,
        "onTriggerWorkflow",
      )
      .mockResolvedValue();

    // Alice in Berlin, Carol in New York; Vic and the outsider anywhere.
    await insert("User", {
      _id: ALICE.toString(),
      name: "Alice",
      email: "alice@example.com",
      timezone: "Europe/Berlin",
    });
    await insert("User", {
      _id: CAROL.toString(),
      name: "Carol",
      email: "carol@example.com",
      timezone: "America/New_York",
    });
    await insert("User", {
      _id: VIC.toString(),
      name: "Vic",
      email: "vic@example.com",
    });
    await insert("User", {
      _id: OUTSIDER.toString(),
      name: "Outsider",
      email: "outsider@example.com",
    });

    await insert("Team", {
      _id: FINANCE_TEAM,
      projectId: PROJECT_ID.toString(),
      name: "Finance",
    });
    await insert("Team", {
      _id: OTHER_TEAM,
      projectId: OTHER_PROJECT_ID.toString(),
      name: "Elsewhere",
    });

    // Alice, Carol and Vic are members; the outsider is another project's.
    for (const userId of [ALICE, CAROL, VIC]) {
      await insert("TeamMember", {
        _id: ObjectID.generate().toString(),
        projectId: PROJECT_ID.toString(),
        teamId: FINANCE_TEAM,
        userId: userId.toString(),
        hasAcceptedInvitation: true,
      });
    }

    await insert("TeamMember", {
      _id: ObjectID.generate().toString(),
      projectId: OTHER_PROJECT_ID.toString(),
      teamId: OTHER_TEAM,
      userId: OUTSIDER.toString(),
      hasAcceptedInvitation: true,
    });

    await insert("CloudAccount", {
      _id: ACCOUNT,
      projectId: PROJECT_ID.toString(),
      name: "Production AWS",
    });
    await insert("CloudAccount", {
      _id: OTHER_ACCOUNT,
      projectId: OTHER_PROJECT_ID.toString(),
      name: "Elsewhere AWS",
    });
    await insert("CloudCostView", {
      _id: VIEW,
      projectId: PROJECT_ID.toString(),
      name: "By team",
    });
  });

  afterAll(async () => {
    jest.restoreAllMocks();

    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  test("a Cloud member makes a weekly report: next Monday at 09:00 in their time zone, last week, every account", async () => {
    const before: Date = new Date();
    const report: CloudCostReport = await create({ name: "Weekly costs" });
    const kept: CloudCostReport = await stored(report.id!);
    const next: moment.Moment = moment.tz(kept.nextSendAt!, "Europe/Berlin");

    expect(kept.scope).toBe(CloudCostReportScope.AllAccounts);
    expect(kept.period).toBe(CloudCostReportPeriod.LastWeek);
    expect(kept.isSentToGroupTeams).toBe(false);
    expect(kept.isEnabled).toBe(true);
    expect(String(kept.timezone)).toBe("Europe/Berlin");
    expect(kept.createdByUserId?.toString()).toBe(ALICE.toString());
    expect(
      Recurring.fromJSON(kept.recurringInterval as never).intervalType,
    ).toBe(EventInterval.Week);
    expect(next.isoWeekday()).toBe(1);
    expect(next.format("HH:mm")).toBe("09:00");
    expect(kept.nextSendAt!.getTime()).toBeGreaterThan(before.getTime());
    expect(kept.nextSendAt!.getTime() - before.getTime()).toBeLessThanOrEqual(
      7 * 24 * 60 * 60 * 1000,
    );
    expect(kept.sendFirstReportAt?.getTime()).toBe(kept.nextSendAt!.getTime());
  });

  test("a monthly one goes out on the 1st at 09:00, in New York for Carol", async () => {
    const report: CloudCostReport = await create(
      { name: "Monthly costs", recurringInterval: monthly() as never },
      CLOUD_ADMIN,
    );
    const kept: CloudCostReport = await stored(report.id!);
    const next: moment.Moment = moment.tz(kept.nextSendAt!, "America/New_York");

    expect(next.date()).toBe(1);
    expect(next.format("HH:mm")).toBe("09:00");
  });

  test("a daily one is refused: reports go out weekly or monthly", async () => {
    const daily: Recurring = new Recurring();
    daily.intervalType = EventInterval.Day;
    daily.intervalCount = new PositiveNumber(1);

    await expect(
      create({ name: "Daily", recurringInterval: daily as never }),
    ).rejects.toThrow("every week or every month");
  });

  test("a report's name is its own within its project", async () => {
    await create({ name: "Finance review" });

    await expect(create({ name: "Finance review" })).rejects.toThrow();

    // Another project may use it.
    const elsewhere: CloudCostReport = await create(
      { name: "Finance review", projectId: OTHER_PROJECT_ID },
      OTHER_ADMIN,
    );
    expect(elsewhere.id).toBeTruthy();
  });

  test("a Cloud viewer may read the costs but not make a report", async () => {
    await expect(create({ name: "By a viewer" }, VIEWER)).rejects.toThrow();
  });

  test("an address outside the project needs a Cloud admin, who is kept as the one it is read as", async () => {
    await expect(
      create({
        name: "To the accountant, by a member",
        emailAddresses: ["Accountant@Example.org"],
      }),
    ).rejects.toThrow(CLOUD_COST_REPORT_OUTSIDE_REFUSAL);

    const report: CloudCostReport = await create(
      {
        name: "To the accountant",
        emailAddresses: "Accountant@Example.org, cfo@example.org" as never,
        slackChannelNames: ["#finops", "finops"],
      },
      CLOUD_ADMIN,
    );
    const kept: CloudCostReport = await stored(report.id!);

    expect(kept.emailAddresses).toEqual([
      "accountant@example.org",
      "cfo@example.org",
    ]);
    expect(kept.slackChannelNames).toEqual(["#finops"]);
    expect(kept.outsideRecipientsSetByUserId?.toString()).toBe(
      CAROL.toString(),
    );

    // A member may take them all off; who set them is then forgotten.
    await CloudCostReportService.updateOneById({
      id: report.id!,
      data: { emailAddresses: [], slackChannelNames: [] } as never,
      props: MEMBER,
    });
    expect((await stored(report.id!)).outsideRecipientsSetByUserId).toBeFalsy();

    // But not put one back.
    await expect(
      CloudCostReportService.updateOneById({
        id: report.id!,
        data: { emailAddresses: ["other@example.org"] } as never,
        props: MEMBER,
      }),
    ).rejects.toThrow(CLOUD_COST_REPORT_OUTSIDE_REFUSAL);
  });

  test("a report of an account, view or group names the project's own; the other scopes' records are cleared", async () => {
    const report: CloudCostReport = await create({
      name: "One account",
      scope: CloudCostReportScope.Account,
      cloudAccountId: new ObjectID(ACCOUNT),
      cloudCostViewId: new ObjectID(VIEW),
    });
    const kept: CloudCostReport = await stored(report.id!);

    expect(kept.cloudAccountId?.toString()).toBe(ACCOUNT);
    expect(kept.cloudCostViewId).toBeFalsy();

    await expect(
      create({
        name: "Another project's account",
        scope: CloudCostReportScope.Account,
        cloudAccountId: new ObjectID(OTHER_ACCOUNT),
      }),
    ).rejects.toThrow();

    await expect(
      create({ name: "No account", scope: CloudCostReportScope.Account }),
    ).rejects.toThrow("needs its account");

    const byView: CloudCostReport = await create({
      name: "By team, a section each",
      scope: CloudCostReportScope.CostView,
      cloudCostViewId: new ObjectID(VIEW),
      isSentToGroupTeams: true,
      period: CloudCostReportPeriod.LastMonth,
    });
    const keptView: CloudCostReport = await stored(byView.id!);

    expect(keptView.isSentToGroupTeams).toBe(true);
    expect(keptView.period).toBe(CloudCostReportPeriod.LastMonth);
  });

  test("its people and teams are the project's own", async () => {
    const alice: User = new User();
    alice.id = ALICE;
    const vic: User = new User();
    vic.id = VIC;
    const finance: Team = new Team();
    finance.id = new ObjectID(FINANCE_TEAM);

    const report: CloudCostReport = await create({
      name: "To people and a team",
      recipientUsers: [alice, vic],
      recipientTeams: [finance],
    });
    const kept: CloudCostReport = await stored(report.id!);

    expect(
      (kept.recipientUsers || [])
        .map((user: User) => {
          return user.id!.toString();
        })
        .sort(),
    ).toEqual([ALICE.toString(), VIC.toString()].sort());
    expect(
      (kept.recipientTeams || []).map((team: Team) => {
        return team.id!.toString();
      }),
    ).toEqual([FINANCE_TEAM]);

    // Someone of another project, or another project's team, is refused.
    const outsider: User = new User();
    outsider.id = OUTSIDER;
    await expect(
      create({ name: "To an outsider", recipientUsers: [outsider] }),
    ).rejects.toThrow();

    const elsewhere: Team = new Team();
    elsewhere.id = new ObjectID(OTHER_TEAM);
    await expect(
      create({
        name: "To another project's team",
        recipientTeams: [elsewhere],
      }),
    ).rejects.toThrow();
  });

  test("a new schedule moves the next send; a new name leaves it", async () => {
    const report: CloudCostReport = await create({ name: "Rescheduled" });
    const first: Date = (await stored(report.id!)).nextSendAt!;

    await CloudCostReportService.updateOneById({
      id: report.id!,
      data: { name: "Renamed" } as never,
      props: MEMBER,
    });
    expect((await stored(report.id!)).nextSendAt!.getTime()).toBe(
      first.getTime(),
    );

    // Monthly from the 1st after next, at 09:00 in Berlin.
    const firstOfMonth: Date = moment
      .tz("Europe/Berlin")
      .add(2, "months")
      .startOf("month")
      .hour(9)
      .toDate();

    await CloudCostReportService.updateOneById({
      id: report.id!,
      data: {
        recurringInterval: monthly(),
        sendFirstReportAt: firstOfMonth,
      } as never,
      props: MEMBER,
    });
    const moved: CloudCostReport = await stored(report.id!);

    expect(moved.nextSendAt!.getTime()).toBe(firstOfMonth.getTime());
    expect(
      Recurring.fromJSON(moved.recurringInterval as never).intervalType,
    ).toBe(EventInterval.Month);

    // A next send of the caller's own is never taken.
    await expect(
      CloudCostReportService.updateOneById({
        id: report.id!,
        data: { nextSendAt: new Date() } as never,
        props: MEMBER,
      }),
    ).rejects.toThrow();
  });

  test("two replicas that find one report due send it once, and move it a week on", async () => {
    const report: CloudCostReport = await create({ name: "Due now" });
    const due: Date = new Date(Date.now() - 60 * 1000);

    // Due a minute ago, at a Monday's 09:00 in Berlin.
    await database.query(
      `UPDATE "${schema}"."CloudCostReport" SET "nextSendAt" = $1, "sendFirstReportAt" = $1 WHERE "_id" = $2`,
      [due, report.id!.toString()],
    );

    const sent: Array<Date> = [];
    const send: jest.SpiedFunction<typeof CloudCostReportSender.send> = jest
      .spyOn(CloudCostReportSender, "send")
      .mockImplementation(
        async (data: { at: Date }): Promise<CloudCostReportSendResult> => {
          sent.push(data.at);
          return {
            sentAt: data.at.toISOString(),
            people: 1,
            groupSections: 0,
            addresses: 0,
            channels: 0,
            skipped: [],
            errors: [],
          };
        },
      );

    const found: CloudCostReport = await stored(report.id!);
    const now: Date = new Date();
    const claims: Array<boolean> = await Promise.all([
      CloudCostReportSchedule.claimAndSend(found, now),
      CloudCostReportSchedule.claimAndSend(found, now),
      CloudCostReportSchedule.claimAndSend(found, now),
    ]);

    expect(
      claims.filter((claimed: boolean) => {
        return claimed;
      }),
    ).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.getTime()).toBe(due.getTime());

    const after: CloudCostReport = await stored(report.id!);
    expect(after.nextSendAt!.getTime()).toBeGreaterThan(now.getTime());

    const lastSent: Array<{
      lastSentAt: Date | null;
      lastSendResult: unknown;
    }> = await database.query(
      `SELECT "lastSentAt", "lastSendResult" FROM "${schema}"."CloudCostReport" WHERE "_id" = $1`,
      [report.id!.toString()],
    );
    expect(lastSent[0]!.lastSentAt).toBeTruthy();
    expect((lastSent[0]!.lastSendResult as { people: number }).people).toBe(1);

    send.mockRestore();
  });

  test("the schedule sends what is due and enabled, nothing else", async () => {
    const dueReport: CloudCostReport = await create({ name: "Due" });
    const offReport: CloudCostReport = await create({ name: "Off" });
    const laterReport: CloudCostReport = await create({ name: "Later" });
    const past: Date = new Date(Date.now() - 5 * 60 * 1000);

    await database.query(
      `UPDATE "${schema}"."CloudCostReport" SET "nextSendAt" = $1 WHERE "_id" IN ($2, $3)`,
      [past, dueReport.id!.toString(), offReport.id!.toString()],
    );
    await database.query(
      `UPDATE "${schema}"."CloudCostReport" SET "isEnabled" = false WHERE "_id" = $1`,
      [offReport.id!.toString()],
    );
    // Every report made earlier waits for its own Monday.
    await database.query(
      `UPDATE "${schema}"."CloudCostReport" SET "nextSendAt" = $1 WHERE "_id" NOT IN ($2, $3)`,
      [
        new Date(Date.now() + 24 * 60 * 60 * 1000),
        dueReport.id!.toString(),
        offReport.id!.toString(),
      ],
    );

    const sentTo: Array<string> = [];
    const send: jest.SpiedFunction<typeof CloudCostReportSender.send> = jest
      .spyOn(CloudCostReportSender, "send")
      .mockImplementation(
        async (data: {
          reportId: ObjectID;
          at: Date;
        }): Promise<CloudCostReportSendResult> => {
          sentTo.push(data.reportId.toString());
          return {
            sentAt: data.at.toISOString(),
            people: 0,
            groupSections: 0,
            addresses: 0,
            channels: 0,
            skipped: [],
            errors: [],
          };
        },
      );

    expect(await CloudCostReportSchedule.sendDue(new Date())).toBe(1);
    expect(sentTo).toEqual([dueReport.id!.toString()]);
    expect(laterReport.id).toBeTruthy();

    send.mockRestore();
  });
});
