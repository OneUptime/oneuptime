import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import WhoWasToldService from "../../../Server/Services/WhoWasToldService";
import WorkflowPrincipal from "../../../Server/Utils/Workflow/WorkflowPrincipal";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import MailStatus from "../../../Types/Mail/MailStatus";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import {
  WhoWasToldPerson,
  WhoWasToldResult,
  WhoWasToldStatus,
} from "../../../Types/Notification/WhoWasTold";
import ObjectID from "../../../Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import Permission, { UserPermission } from "../../../Types/Permission";
import SmsStatus from "../../../Types/SmsStatus";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import UserType from "../../../Types/UserType";
import WorkspaceNotificationActionType from "../../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceNotificationStatus from "../../../Types/Workspace/WorkspaceNotificationStatus";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
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
import { DataSource, Logger } from "typeorm";

/*
 * WHO WAS TOLD FOLLOWS THE RECORD'S READ RULE, ON A MIGRATED POSTGRES (#7075).
 *
 * An incident's or an alert's Who Was Told is read from its on-call runs
 * and their steps and its notification logs, every row as the person
 * asking (WhoWasToldService). The unit tests stub the services; what only
 * Postgres and the real read path can say is checked here:
 *
 *   - a private incident's or alert's answer is read only by those who see
 *     the record - the members of a team that owns it who accepted their
 *     invitation, the people named as its owners, Project Owners and
 *     Project Admins - and is not found by another member of the project,
 *     someone whose invitation to an owning team waits, an API key without
 *     Project Owner or Project Admin, or a workflow's step (#8913, #8914);
 *   - one of a public record is read by every member who may read logs;
 *   - someone who may read the record but not its logs or runs is told how
 *     many they may not read, and nothing else of them;
 *   - status page subscribers are counted, never listed, and never in the
 *     hidden count;
 *   - every statement the reads write runs on the migrated schema.
 *
 * Opt in with RUN_POSTGRES_WHO_WAS_TOLD_TESTS=true against a database the
 * registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_WHO_WAS_TOLD_TESTS=true \
 *   WHO_WAS_TOLD_TEST_DATABASE_HOST=127.0.0.1 \
 *   WHO_WAS_TOLD_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/WhoWasToldReadPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml.
 *
 * Everything runs in a uniquely named schema holding structure-only clones
 * (LIKE ... INCLUDING ALL) of the tables it writes. The clones carry no
 * foreign keys, so a seeded row needs only its NOT NULL columns, which are
 * read from the migrated schema and filled in by kind. A table the read path
 * only reads (users, labels, escalation rules) is the migrated, empty one.
 * Every statement Postgres rejects is recorded and fails the test.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_WHO_WAS_TOLD_TESTS"] === "true"
    ? describe
    : describe.skip;

type SqlRow = Record<string, unknown>;

interface RequiredColumn {
  name: string;
  type: string;
  maxLength: number | null;
}

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

const LOG_TABLES: ReadonlyArray<string> = [
  "EmailLog",
  "SmsLog",
  "CallLog",
  "PushNotificationLog",
  "WhatsAppLog",
  "TelegramLog",
  "WebhookLog",
  "WorkspaceNotificationLog",
];

/*
 * The tables written, and the ones the reads join by name (the schema
 * qualifies every table a read names): the people, teams, levels and
 * schedules a step names.
 */
const TABLES: ReadonlyArray<string> = [
  "User",
  "Team",
  "OnCallDutyPolicyEscalationRule",
  "OnCallDutyPolicySchedule",
  "TeamMember",
  "Incident",
  "IncidentOwnerUser",
  "IncidentOwnerTeam",
  "Alert",
  "AlertOwnerUser",
  "AlertOwnerTeam",
  "OnCallDutyPolicy",
  "OnCallDutyPolicyExecutionLog",
  "OnCallDutyPolicyExecutionLogTimeline",
  ...LOG_TABLES,
];

describePostgres(
  "who was told about a record, read as each kind of reader on a migrated Postgres",
  () => {
    const schema: string = `who_was_told_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    const projectId: ObjectID = ObjectID.generate();
    const owningTeamId: ObjectID = ObjectID.generate();
    const otherTeamId: ObjectID = ObjectID.generate();
    const policyId: ObjectID = ObjectID.generate();

    // An accepted member of the team that owns the private records.
    const memberId: ObjectID = ObjectID.generate();
    // Invited to that team, the invitation not accepted yet.
    const invitedId: ObjectID = ObjectID.generate();
    // Named as an owner of the private records.
    const namedOwnerId: ObjectID = ObjectID.generate();
    // Another member of the project.
    const otherId: ObjectID = ObjectID.generate();
    const adminId: ObjectID = ObjectID.generate();
    // Paged about the records, and on no team that owns them.
    const pagedId: ObjectID = ObjectID.generate();

    const failedQueries: FailedQueryRecorder = new FailedQueryRecorder();
    let database: DataSource;

    const required: Record<string, Array<RequiredColumn>> = {};

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host: process.env["WHO_WAS_TOLD_TEST_DATABASE_HOST"] || "localhost",
        port: Number(process.env["WHO_WAS_TOLD_TEST_DATABASE_PORT"] || "5400"),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["WHO_WAS_TOLD_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        logger: failedQueries,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();

      const notNull: Array<{
        table: string;
        name: string;
        type: string;
        maxLength: number | null;
      }> = await database.query(
        `SELECT table_name AS "table", column_name AS "name", data_type AS "type",
                character_maximum_length AS "maxLength"
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = ANY($1)
            AND is_nullable = 'NO'
            AND column_default IS NULL
          ORDER BY table_name, ordinal_position`,
        [TABLES],
      );

      for (const column of notNull) {
        (required[column.table] = required[column.table] || []).push({
          name: column.name,
          type: column.type,
          maxLength:
            column.maxLength === null ? null : Number(column.maxLength),
        });
      }

      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      const currentSchema: Array<{ current_schema: string }> =
        await database.query("SELECT current_schema()");
      expect(currentSchema[0]?.current_schema).toBe(schema);

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);
    });

    // A value for a NOT NULL column the test has nothing to say about.
    function fillerFor(table: string, column: RequiredColumn): unknown {
      switch (column.type) {
        case "uuid":
          return ObjectID.generate().toString();
        case "character varying":
        case "text": {
          const text: string = ObjectID.generate().toString().replace(/-/g, "");

          return column.maxLength === null
            ? text
            : text.slice(0, column.maxLength);
        }
        case "integer":
        case "smallint":
        case "bigint":
        case "numeric":
        case "double precision":
        case "real":
          return 1;
        case "boolean":
          return false;
        case "timestamp with time zone":
        case "timestamp without time zone":
        case "date":
          return new Date();
        case "jsonb":
        case "json":
          return "{}";
        default:
          throw new Error(
            `${table}.${column.name} must be given a value: this suite has no filler for a ${column.type}.`,
          );
      }
    }

    async function insert(table: string, values: SqlRow): Promise<void> {
      const row: SqlRow = {};

      for (const column of required[table] || []) {
        row[column.name] =
          column.name in values
            ? values[column.name]
            : fillerFor(table, column);
      }

      Object.assign(row, values);

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

    function grant(permission: Permission): UserPermission {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }

    // Someone signed in to the project, holding these permissions in it.
    function propsOf(
      permissions: Array<UserPermission>,
      who: ObjectID | null,
      userType: UserType = UserType.User,
    ): DatabaseCommonInteractionProps {
      return {
        ...(who ? { userId: who } : {}),
        tenantId: projectId,
        currentPlan: PlanType.Scale,
        userType: userType,
        userGlobalAccessPermission: {
          _type: "UserGlobalAccessPermission",
          projectIds: [projectId],
          globalPermissions: [Permission.User, Permission.CurrentUser],
        },
        userTenantAccessPermission: {
          [projectId.toString()]: {
            _type: "UserTenantAccessPermission",
            projectId: projectId,
            permissions,
          },
        },
      };
    }

    function viewer(who: ObjectID): DatabaseCommonInteractionProps {
      return propsOf([grant(Permission.Viewer)], who);
    }

    function workflowStep(): DatabaseCommonInteractionProps {
      return {
        ...WorkflowPrincipal.getPropsWithoutPlan({
          projectId: projectId,
          workflowId: ObjectID.generate(),
        }),
        currentPlan: PlanType.Scale,
      };
    }

    interface SeededRecord {
      id: ObjectID;
      kind: "Incident" | "Alert";
    }

    /*
     * A record and everything told about it: an on-call run of the policy
     * that paged Ana by SMS (delivered) and acknowledged, a step that reached
     * nobody, an owner's email that failed, a Slack post, a webhook, and two
     * status page subscribers' emails, one of them failed.
     */
    async function seedRecord(data: {
      kind: "Incident" | "Alert";
      isPrivate: boolean;
    }): Promise<SeededRecord> {
      const id: ObjectID = ObjectID.generate();
      const isAlert: boolean = data.kind === "Alert";
      const ownerKey: string = isAlert ? "alertId" : "incidentId";
      const recordColumn: string = isAlert ? "alertId" : "incidentId";
      const triggeredBy: string = isAlert
        ? "triggeredByAlertId"
        : "triggeredByIncidentId";

      await insert(data.kind, {
        _id: id.toString(),
        projectId: projectId.toString(),
        isPrivate: data.isPrivate,
        ...(isAlert
          ? {}
          : {
              subscriberNotificationStatusOnIncidentCreated:
                StatusPageSubscriberNotificationStatus.Success,
              subscriberNotificationStatusMessage: "Sent to 2 subscribers.",
            }),
      });
      await insert(`${data.kind}OwnerTeam`, {
        _id: ObjectID.generate().toString(),
        projectId: projectId.toString(),
        teamId: owningTeamId.toString(),
        [ownerKey]: id.toString(),
      });
      await insert(`${data.kind}OwnerUser`, {
        _id: ObjectID.generate().toString(),
        projectId: projectId.toString(),
        userId: namedOwnerId.toString(),
        [ownerKey]: id.toString(),
      });

      const runId: ObjectID = ObjectID.generate();

      await insert("OnCallDutyPolicyExecutionLog", {
        _id: runId.toString(),
        projectId: projectId.toString(),
        onCallDutyPolicyId: policyId.toString(),
        [triggeredBy]: id.toString(),
        status: OnCallDutyPolicyStatus.Completed,
        statusMessage: "Done.",
        acknowledgedAt: new Date(),
        acknowledgedByUserId: pagedId.toString(),
      });
      await insert("OnCallDutyPolicyExecutionLogTimeline", {
        _id: ObjectID.generate().toString(),
        projectId: projectId.toString(),
        onCallDutyPolicyId: policyId.toString(),
        onCallDutyPolicyExecutionLogId: runId.toString(),
        [triggeredBy]: id.toString(),
        alertSentToUserId: pagedId.toString(),
        status: OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
        statusMessage: "Acknowledged.",
        isAcknowledged: true,
        acknowledgedAt: new Date(),
        notificationChannels: JSON.stringify([OnCallPageChannel.SMS]),
        escalationRuleOrder: 1,
      });
      await insert("OnCallDutyPolicyExecutionLogTimeline", {
        _id: ObjectID.generate().toString(),
        projectId: projectId.toString(),
        onCallDutyPolicyId: policyId.toString(),
        onCallDutyPolicyExecutionLogId: runId.toString(),
        [triggeredBy]: id.toString(),
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        statusMessage: "No one was on call in this schedule.",
        escalationRuleOrder: 2,
      });

      await insert("SmsLog", {
        _id: ObjectID.generate().toString(),
        projectId: projectId.toString(),
        [recordColumn]: id.toString(),
        userId: pagedId.toString(),
        onCallDutyPolicyId: policyId.toString(),
        status: SmsStatus.Delivered,
        // A number the column reads back as one.
        toNumber: "+15555550100",
        fromNumber: "+15555550199",
      });
      await insert("EmailLog", {
        _id: ObjectID.generate().toString(),
        projectId: projectId.toString(),
        [recordColumn]: id.toString(),
        userId: namedOwnerId.toString(),
        toEmail: "owner@example.com",
        status: MailStatus.Error,
        statusMessage: "The mailbox is full.",
      });
      await insert("WorkspaceNotificationLog", {
        _id: ObjectID.generate().toString(),
        projectId: projectId.toString(),
        [recordColumn]: id.toString(),
        workspaceType: WorkspaceType.Slack,
        actionType: WorkspaceNotificationActionType.SendMessage,
        channelId: "C123",
        channelName: "#incidents",
        status: WorkspaceNotificationStatus.Success,
      });
      // A channel made, not a message posted: never listed.
      await insert("WorkspaceNotificationLog", {
        _id: ObjectID.generate().toString(),
        projectId: projectId.toString(),
        [recordColumn]: id.toString(),
        workspaceType: WorkspaceType.Slack,
        actionType: WorkspaceNotificationActionType.CreateChannel,
        channelId: "C999",
        channelName: "#inc-made",
        status: WorkspaceNotificationStatus.Success,
      });
      await insert("WebhookLog", {
        _id: ObjectID.generate().toString(),
        projectId: projectId.toString(),
        [recordColumn]: id.toString(),
        webhookUrl: "https://hooks.example.com/services/SECRET",
        status: "Success",
      });

      if (!isAlert) {
        const statusPageId: string = ObjectID.generate().toString();

        await insert("EmailLog", {
          _id: ObjectID.generate().toString(),
          projectId: projectId.toString(),
          incidentId: id.toString(),
          statusPageId: statusPageId,
          toEmail: "subscriber@example.com",
          status: MailStatus.Success,
        });
        await insert("EmailLog", {
          _id: ObjectID.generate().toString(),
          projectId: projectId.toString(),
          incidentId: id.toString(),
          statusPageId: statusPageId,
          toEmail: "bounced@example.com",
          status: MailStatus.Error,
        });
      }

      return { id: id, kind: data.kind };
    }

    async function whoWasTold(
      record: SeededRecord,
      props: DatabaseCommonInteractionProps,
    ): Promise<WhoWasToldResult> {
      return record.kind === "Alert"
        ? await WhoWasToldService.getForAlert({
            projectId: projectId,
            alertId: record.id,
            props: props,
          })
        : await WhoWasToldService.getForIncident({
            projectId: projectId,
            incidentId: record.id,
            props: props,
          });
    }

    // The whole answer, as one who may read everything about the record reads it.
    function expectWholeChain(
      result: WhoWasToldResult,
      record: SeededRecord,
    ): void {
      expect(result.hiddenNotificationCount).toBe(0);
      expect(result.hiddenRunCount).toBe(0);
      expect(result.runs).toHaveLength(1);

      const paged: WhoWasToldPerson | undefined = result.people.find(
        (person: WhoWasToldPerson): boolean => {
          return person.userId === pagedId.toString();
        },
      );
      const owner: WhoWasToldPerson | undefined = result.people.find(
        (person: WhoWasToldPerson): boolean => {
          return person.userId === namedOwnerId.toString();
        },
      );

      expect(paged?.status).toBe(WhoWasToldStatus.Acknowledged);
      expect(paged?.notifications).toHaveLength(1);
      expect(owner?.status).toBe(WhoWasToldStatus.Failed);
      expect(owner?.notifications[0]?.statusMessage).toBe(
        "The mailbox is full.",
      );
      expect(result.notPaged).toHaveLength(1);
      expect(
        result.channels.map((group: { name: string }): string => {
          return group.name;
        }),
      ).toEqual(["#incidents", "hooks.example.com"]);
      expect(JSON.stringify(result)).not.toContain("SECRET");
      expect(JSON.stringify(result)).not.toContain("#inc-made");
      // Subscribers counted, never listed.
      expect(JSON.stringify(result)).not.toContain("subscriber@example.com");

      if (record.kind === "Incident") {
        expect(result.subscribers).toMatchObject({
          status: StatusPageSubscriberNotificationStatus.Success,
          sentCount: 1,
          failedCount: 1,
          areCountsReadable: true,
        });
      } else {
        expect(result.subscribers).toBeUndefined();
      }
    }

    beforeEach(async () => {
      failedQueries.failures = [];

      await database.query(
        TABLES.map((table: string): string => {
          return `DELETE FROM "${schema}"."${table}"`;
        }).join("; "),
      );

      await insert("OnCallDutyPolicy", {
        _id: policyId.toString(),
        projectId: projectId.toString(),
        name: "Primary",
      });
      await insert("TeamMember", {
        _id: ObjectID.generate().toString(),
        projectId: projectId.toString(),
        teamId: owningTeamId.toString(),
        userId: memberId.toString(),
        hasAcceptedInvitation: true,
      });
      await insert("TeamMember", {
        _id: ObjectID.generate().toString(),
        projectId: projectId.toString(),
        teamId: owningTeamId.toString(),
        userId: invitedId.toString(),
        hasAcceptedInvitation: false,
      });
      await insert("TeamMember", {
        _id: ObjectID.generate().toString(),
        projectId: projectId.toString(),
        teamId: otherTeamId.toString(),
        userId: otherId.toString(),
        hasAcceptedInvitation: true,
      });
    });

    afterEach(() => {
      // A statement Postgres rejected fails the test, caught or not.
      expect(failedQueries.failures).toEqual([]);
    });

    afterAll(async () => {
      jest.restoreAllMocks();

      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    for (const kind of ["Incident", "Alert"] as const) {
      describe(`a private ${kind.toLowerCase()}`, () => {
        test("is read whole by the owning team's member, its named owner, a Project Admin and a Project Owner", async () => {
          const record: SeededRecord = await seedRecord({
            kind: kind,
            isPrivate: true,
          });

          for (const props of [
            viewer(memberId),
            viewer(namedOwnerId),
            propsOf([grant(Permission.ProjectAdmin)], adminId),
            propsOf([grant(Permission.ProjectOwner)], adminId),
          ]) {
            expectWholeChain(await whoWasTold(record, props), record);
          }
        });

        test("is not found by another member, a pending invitee, the person paged, an API key or a workflow step - and nothing of it is read", async () => {
          const record: SeededRecord = await seedRecord({
            kind: kind,
            isPrivate: true,
          });

          for (const props of [
            viewer(otherId),
            viewer(invitedId),
            viewer(pagedId),
            propsOf([grant(Permission.Viewer)], null, UserType.API),
            workflowStep(),
          ]) {
            await expect(whoWasTold(record, props)).rejects.toBeInstanceOf(
              NotFoundException,
            );
          }
        });
      });

      describe(`a public ${kind.toLowerCase()}`, () => {
        test("is read whole by any member who may read its logs", async () => {
          const record: SeededRecord = await seedRecord({
            kind: kind,
            isPrivate: false,
          });

          for (const props of [viewer(otherId), viewer(invitedId)]) {
            expectWholeChain(await whoWasTold(record, props), record);
          }
        });

        test("a member who may read it but not its logs or runs is told how many, and nothing else of them", async () => {
          const record: SeededRecord = await seedRecord({
            kind: kind,
            isPrivate: false,
          });
          const viewerOfRecordsOnly: Permission =
            kind === "Alert"
              ? Permission.AlertViewer
              : Permission.IncidentViewer;

          const result: WhoWasToldResult = await whoWasTold(
            record,
            propsOf([grant(viewerOfRecordsOnly)], otherId),
          );

          // The SMS, the email, the Slack post and the webhook: not the channel made.
          expect(result.hiddenNotificationCount).toBe(4);
          expect(result.hiddenRunCount).toBe(1);
          expect(result.people).toEqual([]);
          expect(result.channels).toEqual([]);
          expect(result.runs).toEqual([]);
          expect(JSON.stringify(result)).not.toContain("mailbox");

          if (kind === "Incident") {
            expect(result.subscribers).toMatchObject({
              status: StatusPageSubscriberNotificationStatus.Success,
              areCountsReadable: false,
              sentCount: 0,
              failedCount: 0,
            });
          }
        });
      });
    }
  },
);
