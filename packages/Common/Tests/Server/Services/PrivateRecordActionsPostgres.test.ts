import Entities from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import RunbookExecution from "../../../Models/DatabaseModels/RunbookExecution";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AlertService from "../../../Server/Services/AlertService";
import CallLogService from "../../../Server/Services/CallLogService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import EmailLogService from "../../../Server/Services/EmailLogService";
import IncidentService from "../../../Server/Services/IncidentService";
import LlmLogService from "../../../Server/Services/LlmLogService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import PushNotificationLogService from "../../../Server/Services/PushNotificationLogService";
import RunbookExecutionService from "../../../Server/Services/RunbookExecutionService";
import SmsLogService from "../../../Server/Services/SmsLogService";
import TelegramLogService from "../../../Server/Services/TelegramLogService";
import WebhookLogService from "../../../Server/Services/WebhookLogService";
import WhatsAppLogService from "../../../Server/Services/WhatsAppLogService";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import {
  PrivateRecordColumn,
  PrivateRecordKind,
} from "../../../Server/Types/Database/Permissions/PrivateRecordPermission";
import PrivateRecordReadFilter from "../../../Server/Utils/Permission/PrivateRecordReadFilter";
import PrivateRecordWriteCheck from "../../../Server/Utils/Permission/PrivateRecordWriteCheck";
import RunbookPrivateRecordAccess from "../../../Server/Utils/Runbook/RunbookPrivateRecordAccess";
import WorkflowPrincipal from "../../../Server/Utils/Workflow/WorkflowPrincipal";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
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
import { DataSource, Logger } from "typeorm";

/*
 * WHAT IS DONE ABOUT A PRIVATE RECORD FOLLOWS ITS OWNERS, ON A MIGRATED
 * POSTGRES (#8913).
 *
 * A page of an on-call policy about a private incident, alert or episode, a
 * step of that page, a runbook run linked to one, and the logs of what
 * OneUptime sent about one - its emails, SMS, calls, push notifications,
 * WhatsApp, Telegram, Slack and Microsoft Teams messages, webhooks and AI
 * requests - are parts of that record, read through something else (an
 * on-call policy, a runbook, the project's logs). The unit tests check the
 * rule against a repository kept in memory; what only Postgres and the real
 * read path can say is checked here, with each part's own service:
 *
 *   - the statement each read hook adds runs (PrivateRecordReadFilter: an
 *     anti-join over the private records of each kind a part names), and
 *     a find and a count agree;
 *   - a part naming a private record is read only by those who see the
 *     record: the members of a team that owns it who have accepted their
 *     invitation, the people named as its owners, and the project's owners
 *     and admins - not by another member of the project, not by someone
 *     whose invitation to an owning team waits, not by an API key without
 *     Project Owner or Project Admin, and not by a workflow's step (#8914);
 *     one naming a public record, or none, is read as before;
 *   - a page, a run or a fix about a private incident is started only
 *     through the teams that own it and the people named as its owners
 *     (PrivateRecordWriteCheck.reaches, RunbookPrivateRecordAccess).
 *
 * Opt in with RUN_POSTGRES_PRIVATE_RECORD_ACTIONS_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_PRIVATE_RECORD_ACTIONS_TESTS=true \
 *   PRIVATE_RECORD_ACTIONS_TEST_DATABASE_HOST=127.0.0.1 \
 *   PRIVATE_RECORD_ACTIONS_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/PrivateRecordActionsPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml.
 *
 * Everything runs in a uniquely named schema holding structure-only clones
 * (LIKE ... INCLUDING ALL) of the tables it writes: the parts, the records
 * they name and those records' owners, and the team members. The clones
 * carry no foreign keys, so a seeded row needs only its NOT NULL columns,
 * which are read from the migrated schema and filled in by kind. The
 * DataSource's search path is that schema, then public: a table the read
 * path only reads (labels) is the migrated, empty one. Every statement
 * Postgres rejects is recorded and fails the test, even one a caller would
 * have caught.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_PRIVATE_RECORD_ACTIONS_TESTS"] === "true"
    ? describe
    : describe.skip;

type AsServiceFunction = (service: unknown) => DatabaseService<BaseModel>;

const asService: AsServiceFunction = (
  service: unknown,
): DatabaseService<BaseModel> => {
  return service as DatabaseService<BaseModel>;
};

interface Part {
  name: string;
  service: DatabaseService<BaseModel>;
}

// Every part read through something else (PrivateRecordParts.ALSO_PART_OF) with a read hook of its own.
const PARTS: Array<Part> = [
  {
    name: "a page of an on-call policy",
    service: asService(OnCallDutyPolicyExecutionLogService),
  },
  {
    name: "a step of a page of an on-call policy",
    service: asService(OnCallDutyPolicyExecutionLogTimelineService),
  },
  { name: "a runbook run", service: asService(RunbookExecutionService) },
  { name: "an email log", service: asService(EmailLogService) },
  { name: "an SMS log", service: asService(SmsLogService) },
  { name: "a call log", service: asService(CallLogService) },
  {
    name: "a push notification log",
    service: asService(PushNotificationLogService),
  },
  { name: "a WhatsApp log", service: asService(WhatsAppLogService) },
  { name: "a Telegram log", service: asService(TelegramLogService) },
  { name: "a webhook log", service: asService(WebhookLogService) },
  {
    name: "a Slack or Microsoft Teams log",
    service: asService(WorkspaceNotificationLogService),
  },
  { name: "an AI request log", service: asService(LlmLogService) },
];

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

type ColumnsOfFunction = (part: Part) => Array<PrivateRecordColumn>;

// The columns a part's rows name private records by, besides the one it is read through.
const columnsOf: ColumnsOfFunction = (
  part: Part,
): Array<PrivateRecordColumn> => {
  return PrivateRecordReadFilter.getNamedRecordColumns(
    part.service.modelType as { new (): BaseModel },
  );
};

describePostgres(
  "what is done about a private record, read and started on a migrated Postgres",
  () => {
    const schema: string = `private_record_actions_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    const projectId: ObjectID = ObjectID.generate();
    const owningTeamId: ObjectID = ObjectID.generate();
    const otherTeamId: ObjectID = ObjectID.generate();

    // An accepted member of the team that owns the private records.
    const memberId: ObjectID = ObjectID.generate();
    // Invited to that team, the invitation not accepted yet.
    const invitedId: ObjectID = ObjectID.generate();
    // Named as an owner of the private records.
    const namedOwnerId: ObjectID = ObjectID.generate();
    // Another member of the project.
    const otherId: ObjectID = ObjectID.generate();
    const adminId: ObjectID = ObjectID.generate();

    const failedQueries: FailedQueryRecorder = new FailedQueryRecorder();
    let database: DataSource;

    const required: Record<string, Array<RequiredColumn>> = {};
    let tables: Array<string> = [];

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["PRIVATE_RECORD_ACTIONS_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["PRIVATE_RECORD_ACTIONS_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["PRIVATE_RECORD_ACTIONS_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        logger: failedQueries,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();

      const kinds: Array<PrivateRecordKind> = PARTS.flatMap(
        (part: Part): Array<PrivateRecordKind> => {
          return columnsOf(part).map(
            (column: PrivateRecordColumn): PrivateRecordKind => {
              return column.kind;
            },
          );
        },
      );

      tables = Array.from(
        new Set<string>([
          "TeamMember",
          ...kinds.flatMap((kind: PrivateRecordKind): Array<string> => {
            return [kind.tableName, kind.ownerUserTable, kind.ownerTeamTable];
          }),
          ...PARTS.map((part: Part): string => {
            return part.service.getModel().tableName as string;
          }),
        ]),
      );

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
        [tables],
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

      for (const table of tables) {
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

    beforeEach(async () => {
      failedQueries.failures = [];

      await database.query(
        tables
          .map((table: string): string => {
            return `DELETE FROM "${schema}"."${table}"`;
          })
          .join("; "),
      );

      // The owning team's members, one of them still invited only.
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

    /*
     * A record of `kind`: a private one owned by the owning team and by the
     * person named as its owner, or a public one the owning team owns too.
     * Returns its ID.
     */
    async function seedRecord(
      kind: PrivateRecordKind,
      isPrivate: boolean,
    ): Promise<string> {
      const id: string = ObjectID.generate().toString();

      await insert(kind.tableName, {
        _id: id,
        projectId: projectId.toString(),
        isPrivate: isPrivate,
      });
      await insert(kind.ownerTeamTable, {
        _id: ObjectID.generate().toString(),
        projectId: projectId.toString(),
        teamId: owningTeamId.toString(),
        [kind.ownerKey]: id,
      });

      if (isPrivate) {
        await insert(kind.ownerUserTable, {
          _id: ObjectID.generate().toString(),
          projectId: projectId.toString(),
          userId: namedOwnerId.toString(),
          [kind.ownerKey]: id,
        });
      }

      return id;
    }

    // A row of `part` naming `named` (column -> record ID) and no other record. Returns its ID.
    async function seedPart(
      part: Part,
      named: Record<string, string>,
    ): Promise<string> {
      const table: string = part.service.getModel().tableName as string;
      const id: string = ObjectID.generate().toString();
      const values: SqlRow = { _id: id, projectId: projectId.toString() };

      for (const column of columnsOf(part)) {
        const isRequired: boolean = (required[table] || []).some(
          (each: RequiredColumn): boolean => {
            return each.name === column.column;
          },
        );

        // A column that must name something names a record nobody has.
        values[column.column] =
          named[column.column] ||
          (isRequired ? ObjectID.generate().toString() : null);
      }

      await insert(table, values);

      return id;
    }

    function grant(
      permission: Permission,
      teamId?: ObjectID | undefined,
    ): UserPermission {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: false,
        ...(teamId ? { teamId: teamId } : {}),
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

    // A reader of the project's runs and logs: Viewer over the whole project.
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

    interface Read {
      ids: Array<string>;
      count: number;
    }

    // What `props` reads of `part` in the project: by a find, and by a count.
    async function read(
      part: Part,
      props: DatabaseCommonInteractionProps,
    ): Promise<Read> {
      const found: Array<BaseModel> = await part.service.findBy({
        query: {},
        select: { _id: true },
        skip: 0,
        limit: 100,
        props: props,
      });
      const count: PositiveNumber = await part.service.countBy({
        query: {},
        props: props,
      });

      return {
        ids: found
          .map((each: BaseModel): string => {
            return each._id!.toString();
          })
          .sort(),
        count: count.toNumber(),
      };
    }

    function sorted(ids: Array<string>): Read {
      return { ids: [...ids].sort(), count: ids.length };
    }

    describe.each(PARTS)("$name", (part: Part) => {
      test("names private records by the columns its read hook narrows by", () => {
        expect(columnsOf(part).length).toBeGreaterThan(0);
        expect(
          (part.service.getColumnsReadHooksNarrowBy() || []).sort(),
        ).toEqual(
          columnsOf(part)
            .map((column: PrivateRecordColumn): string => {
              return column.column;
            })
            .sort(),
        );
      });

      test("one about a private record is read only by those who see the record, by each column it names one", async () => {
        const none: string = await seedPart(part, {});
        const aboutPublic: Array<string> = [];
        const aboutPrivate: Array<string> = [];

        for (const column of columnsOf(part)) {
          aboutPublic.push(
            await seedPart(part, {
              [column.column]: await seedRecord(column.kind, false),
            }),
          );
          aboutPrivate.push(
            await seedPart(part, {
              [column.column]: await seedRecord(column.kind, true),
            }),
          );
        }

        const everything: Read = sorted([
          none,
          ...aboutPublic,
          ...aboutPrivate,
        ]);
        const notPrivate: Read = sorted([none, ...aboutPublic]);

        // Those who see the private records.
        expect(await read(part, viewer(memberId))).toEqual(everything);
        expect(await read(part, viewer(namedOwnerId))).toEqual(everything);
        expect(
          await read(part, propsOf([grant(Permission.ProjectAdmin)], adminId)),
        ).toEqual(everything);
        expect(
          await read(part, propsOf([grant(Permission.ProjectOwner)], adminId)),
        ).toEqual(everything);

        // Those who do not.
        expect(await read(part, viewer(otherId))).toEqual(notPrivate);
        expect(await read(part, viewer(invitedId))).toEqual(notPrivate);
        expect(
          await read(
            part,
            propsOf([grant(Permission.Viewer)], null, UserType.API),
          ),
        ).toEqual(notPrivate);
        expect(await read(part, workflowStep())).toEqual(notPrivate);
      });

      test("one naming a public record beside a private one is read only by those who see the private one", async () => {
        const columns: Array<PrivateRecordColumn> = columnsOf(part);

        if (columns.length < 2) {
          return;
        }

        const both: string = await seedPart(part, {
          [columns[0]!.column]: await seedRecord(columns[0]!.kind, false),
          [columns[1]!.column]: await seedRecord(columns[1]!.kind, true),
        });

        expect(await read(part, viewer(memberId))).toEqual(sorted([both]));
        expect(await read(part, viewer(otherId))).toEqual(sorted([]));
      });

      test("the caller's own filter on a column it names records by is kept", async () => {
        const column: PrivateRecordColumn = columnsOf(part)[0]!;
        const publicRecord: string = await seedRecord(column.kind, false);
        const privateRecord: string = await seedRecord(column.kind, true);

        const aboutPublic: string = await seedPart(part, {
          [column.column]: publicRecord,
        });
        await seedPart(part, { [column.column]: privateRecord });
        await seedPart(part, {});

        for (const props of [
          viewer(memberId),
          viewer(otherId),
          propsOf([grant(Permission.ProjectAdmin)], adminId),
        ]) {
          const found: Array<BaseModel> = await part.service.findBy({
            query: { [column.column]: publicRecord },
            select: { _id: true },
            skip: 0,
            limit: 100,
            props: props,
          });

          expect(
            found.map((each: BaseModel): string => {
              return each._id!.toString();
            }),
          ).toEqual([aboutPublic]);
        }

        // Asked for the private record by name, someone who does not see it reads nothing.
        const asked: Array<BaseModel> = await part.service.findBy({
          query: { [column.column]: privateRecord },
          select: { _id: true },
          skip: 0,
          limit: 100,
          props: viewer(otherId),
        });

        expect(asked).toEqual([]);
      });
    });

    describe("a page, a runbook run and a fix about a private incident are started only through its owners", () => {
      const incidentKind: () => PrivateRecordKind = (): PrivateRecordKind => {
        return columnsOf(PARTS[2]!).find((column: PrivateRecordColumn) => {
          return column.column === "incidentId";
        })!.kind;
      };

      async function reaches(
        modelType: { new (): BaseModel },
        recordId: string,
        props: DatabaseCommonInteractionProps,
      ): Promise<boolean> {
        return PrivateRecordWriteCheck.reaches({
          modelType: modelType,
          type: DatabaseRequestType.Create,
          recordService: asService(IncidentService),
          recordId: new ObjectID(recordId),
          props: props,
        });
      }

      // Team 1 (another team of theirs) may do everything; the team that owns the incident only views.
      const viewOnlyOwner: () => Array<UserPermission> =
        (): Array<UserPermission> => {
          return [
            grant(Permission.ProjectMember, otherTeamId),
            grant(Permission.Viewer, owningTeamId),
          ];
        };

      test("a member of an owning team that may only view it pages no one and runs nothing, though another team of theirs may", async () => {
        const privateIncident: string = await seedRecord(incidentKind(), true);
        const props: DatabaseCommonInteractionProps = propsOf(
          viewOnlyOwner(),
          memberId,
        );

        expect(
          await reaches(OnCallDutyPolicyExecutionLog, privateIncident, props),
        ).toBe(false);
        expect(await reaches(RunbookExecution, privateIncident, props)).toBe(
          false,
        );

        let refusal: unknown = null;

        try {
          await RunbookPrivateRecordAccess.assertMayStartFor({
            props: props,
            incidentId: new ObjectID(privateIncident),
          });
        } catch (error) {
          refusal = error;
        }

        expect(refusal).toBeInstanceOf(NotAuthorizedException);
        expect((refusal as Error).message).toContain(
          "You do not have permission to run a runbook for this incident. This incident is private",
        );
      });

      test("once the owning team may page, its member pages; once it may run runbooks, runs them", async () => {
        const privateIncident: string = await seedRecord(incidentKind(), true);

        const pager: DatabaseCommonInteractionProps = propsOf(
          [...viewOnlyOwner(), grant(Permission.OnCallMember, owningTeamId)],
          memberId,
        );

        expect(
          await reaches(OnCallDutyPolicyExecutionLog, privateIncident, pager),
        ).toBe(true);
        expect(await reaches(RunbookExecution, privateIncident, pager)).toBe(
          false,
        );

        const runner: DatabaseCommonInteractionProps = propsOf(
          [...viewOnlyOwner(), grant(Permission.RunbookMember, owningTeamId)],
          memberId,
        );

        expect(await reaches(RunbookExecution, privateIncident, runner)).toBe(
          true,
        );
        await RunbookPrivateRecordAccess.assertMayStartFor({
          props: runner,
          incidentId: new ObjectID(privateIncident),
        });
      });

      test("the person named as its owner acts with every permission they hold, and the project's admins with theirs", async () => {
        const privateIncident: string = await seedRecord(incidentKind(), true);

        for (const props of [
          propsOf([grant(Permission.ProjectMember)], namedOwnerId),
          propsOf([grant(Permission.ProjectAdmin)], adminId),
        ]) {
          expect(
            await reaches(OnCallDutyPolicyExecutionLog, privateIncident, props),
          ).toBe(true);
          expect(await reaches(RunbookExecution, privateIncident, props)).toBe(
            true,
          );
        }
      });

      test("another member of the project, however much they may do elsewhere, starts nothing about it", async () => {
        const privateIncident: string = await seedRecord(incidentKind(), true);
        const props: DatabaseCommonInteractionProps = propsOf(
          [grant(Permission.ProjectMember)],
          otherId,
        );

        expect(
          await reaches(OnCallDutyPolicyExecutionLog, privateIncident, props),
        ).toBe(false);
        expect(await reaches(RunbookExecution, privateIncident, props)).toBe(
          false,
        );
      });

      test("about a public incident, the member's own permissions decide, as before", async () => {
        const publicIncident: string = await seedRecord(incidentKind(), false);
        const props: DatabaseCommonInteractionProps = propsOf(
          viewOnlyOwner(),
          memberId,
        );

        expect(
          await reaches(OnCallDutyPolicyExecutionLog, publicIncident, props),
        ).toBe(true);
        expect(await reaches(RunbookExecution, publicIncident, props)).toBe(
          true,
        );
        await RunbookPrivateRecordAccess.assertMayStartFor({
          props: props,
          incidentId: new ObjectID(publicIncident),
        });
      });

      test("a private alert's runbook run follows the alert's owners the same way", async () => {
        const alertKind: PrivateRecordKind = columnsOf(PARTS[2]!).find(
          (column: PrivateRecordColumn) => {
            return column.column === "alertId";
          },
        )!.kind;
        const privateAlert: string = await seedRecord(alertKind, true);

        expect(
          await PrivateRecordWriteCheck.reaches({
            modelType: RunbookExecution,
            type: DatabaseRequestType.Create,
            recordService: asService(AlertService),
            recordId: new ObjectID(privateAlert),
            props: propsOf(viewOnlyOwner(), memberId),
          }),
        ).toBe(false);
        expect(
          await PrivateRecordWriteCheck.reaches({
            modelType: RunbookExecution,
            type: DatabaseRequestType.Create,
            recordService: asService(AlertService),
            recordId: new ObjectID(privateAlert),
            props: propsOf(
              [
                ...viewOnlyOwner(),
                grant(Permission.RunbookMember, owningTeamId),
              ],
              memberId,
            ),
          }),
        ).toBe(true);
      });
    });
  },
);
