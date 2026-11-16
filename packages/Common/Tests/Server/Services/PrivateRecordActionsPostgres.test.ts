import Entities from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import RunbookExecution from "../../../Models/DatabaseModels/RunbookExecution";
import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AlertService from "../../../Server/Services/AlertService";
import CallLogService from "../../../Server/Services/CallLogService";
import DataSecurityIssueService from "../../../Server/Services/DataSecurityIssueService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import EmailLogService from "../../../Server/Services/EmailLogService";
import FormSubmissionService from "../../../Server/Services/FormSubmissionService";
import IncidentService from "../../../Server/Services/IncidentService";
import LlmLogService from "../../../Server/Services/LlmLogService";
import RumSessionPinService from "../../../Server/Services/RumSessionPinService";
import RumSessionReplayViewService from "../../../Server/Services/RumSessionReplayViewService";
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import { QuerySecurityCasesTool } from "../../../Server/Utils/AI/Toolbox/SecurityCaseTools";
import { ToolExecutionResult } from "../../../Server/Utils/AI/Toolbox/ToolTypes";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import SecurityCaseValues from "../../../Server/Utils/SecurityCase/SecurityCaseValues";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import PushNotificationLogService from "../../../Server/Services/PushNotificationLogService";
import RunbookExecutionService from "../../../Server/Services/RunbookExecutionService";
import RunnerJobService from "../../../Server/Services/RunnerJobService";
import SmsLogService from "../../../Server/Services/SmsLogService";
import TelegramLogService from "../../../Server/Services/TelegramLogService";
import WebhookLogService from "../../../Server/Services/WebhookLogService";
import WhatsAppLogService from "../../../Server/Services/WhatsAppLogService";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import PrivateRecordPermission, {
  PrivateRecordColumn,
  PrivateRecordKind,
} from "../../../Server/Types/Database/Permissions/PrivateRecordPermission";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import QueryUtil from "../../../Server/Types/Database/QueryUtil";
import PrivateRecordReadFilter, {
  PrivateRecordRelation,
} from "../../../Server/Utils/Permission/PrivateRecordReadFilter";
import PrivateRecordWriteCheck from "../../../Server/Utils/Permission/PrivateRecordWriteCheck";
import RunbookPrivateRecordAccess from "../../../Server/Utils/Runbook/RunbookPrivateRecordAccess";
import WorkflowPrincipal from "../../../Server/Utils/Workflow/WorkflowPrincipal";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
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
 *     (PrivateRecordWriteCheck.reaches, RunbookPrivateRecordAccess);
 *   - a Runner job of a run or a fix about a private record - what its step
 *     ran and printed - is read only by those who see the record, and one
 *     of a fix that is gone only by those who see every private record;
 *   - through every relation the rule holds (#9102: a Data Security
 *     issue's incident, a security case's, a form submission's, a session
 *     replay's, a public alert's private episode, a runner job's run...), a
 *     select reads the related record, and a filter on its columns matches
 *     it, only for those who see it - by the rule itself for every such
 *     relation, and through the services, a count, a sort, the API's list
 *     and OneUptime AI's read of a security case for the models #9102 names.
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

// A relation the rule holds (PrivateRecordReadFilter.getRelations), of a model.
interface HeldRelation {
  name: string;
  modelType: { new (): BaseModel };
  relation: PrivateRecordRelation;
}

const HELD_RELATIONS: Array<HeldRelation> = Entities.flatMap(
  (modelType: { new (): BaseModel }): Array<HeldRelation> => {
    return PrivateRecordReadFilter.getRelations(modelType).map(
      (relation: PrivateRecordRelation): HeldRelation => {
        return {
          name: `${new modelType().tableName}.${relation.relation}`,
          modelType: modelType,
          relation: relation,
        };
      },
    );
  },
);

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
          // Each model holding a relation, and the records it reaches.
          ...HELD_RELATIONS.flatMap((held: HeldRelation): Array<string> => {
            return [
              new held.modelType().tableName as string,
              new held.relation.relatedModelType().tableName as string,
            ];
          }),
          // What OneUptime AI's read of a security case reads beside it.
          "SecurityDetection",
          // What a Runner job is read through beside its run: the fix it runs a command of.
          "AutoRemediationSuggestion",
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
      values: SqlRow = {},
    ): Promise<string> {
      const id: string = ObjectID.generate().toString();

      await insert(kind.tableName, {
        _id: id,
        projectId: projectId.toString(),
        isPrivate: isPrivate,
        ...values,
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

    /*
     * A RUNNER JOB carries what a runbook run's step, or a command of a fix
     * OneUptime AI proposed, ran and printed: the run's or the fix's own
     * output. It is read through the run and the fix it names
     * (RunnerJobService.applyPrivacyFilters) - only by those who see every
     * private record they are about. A job naming a fix that is gone, which
     * it names by a plain id, only by those who see every private record.
     */
    describe("a Runner job, with what a run's step or a fix's command printed", () => {
      const runnerJobs: Part = {
        name: "a Runner job",
        service: asService(RunnerJobService),
      };

      async function seedRow(table: string, values: SqlRow): Promise<string> {
        const id: string = ObjectID.generate().toString();

        await insert(table, {
          _id: id,
          projectId: projectId.toString(),
          ...values,
        });

        return id;
      }

      async function runAbout(values: SqlRow): Promise<string> {
        return await seedRow("RunbookExecution", {
          incidentId: null,
          alertId: null,
          ...values,
        });
      }

      async function fixAbout(values: SqlRow): Promise<string> {
        return await seedRow("AutoRemediationSuggestion", {
          incidentId: null,
          alertId: null,
          ...values,
        });
      }

      async function jobOf(values: SqlRow): Promise<string> {
        return await seedRow("RunnerJob", {
          runbookExecutionId: null,
          autoRemediationSuggestionId: null,
          aiRunId: null,
          ...values,
        });
      }

      function kindOf(tableName: string): PrivateRecordKind {
        return PrivateRecordPermission.getKind(tableName)!;
      }

      test("one of a run or a fix about a private record is read only by those who see the record", async () => {
        const privateIncident: string = await seedRecord(
          kindOf("Incident"),
          true,
        );
        const publicIncident: string = await seedRecord(
          kindOf("Incident"),
          false,
        );
        const privateAlert: string = await seedRecord(kindOf("Alert"), true);

        const notPrivate: Array<string> = [
          // A Kubernetes or resource agent's job: no run, no fix.
          await jobOf({}),
          await jobOf({
            runbookExecutionId: await runAbout({ incidentId: publicIncident }),
          }),
          // A run started by hand, about nothing.
          await jobOf({ runbookExecutionId: await runAbout({}) }),
          await jobOf({
            autoRemediationSuggestionId: await fixAbout({
              incidentId: publicIncident,
            }),
          }),
        ];

        const aboutPrivate: Array<string> = [
          await jobOf({
            runbookExecutionId: await runAbout({ incidentId: privateIncident }),
          }),
          await jobOf({
            runbookExecutionId: await runAbout({ alertId: privateAlert }),
          }),
          await jobOf({
            autoRemediationSuggestionId: await fixAbout({
              incidentId: privateIncident,
            }),
          }),
          await jobOf({
            autoRemediationSuggestionId: await fixAbout({
              alertId: privateAlert,
            }),
          }),
          // A fix's command, run as a step of a public run: the fix decides.
          await jobOf({
            runbookExecutionId: await runAbout({ incidentId: publicIncident }),
            autoRemediationSuggestionId: await fixAbout({
              alertId: privateAlert,
            }),
          }),
        ];

        // Its fix deleted with the incident it was about.
        const ofAGoneFix: string = await jobOf({
          autoRemediationSuggestionId: ObjectID.generate().toString(),
        });

        const owned: Read = sorted([...notPrivate, ...aboutPrivate]);
        const everything: Read = sorted([
          ...notPrivate,
          ...aboutPrivate,
          ofAGoneFix,
        ]);

        // Those who see the private records.
        expect(await read(runnerJobs, viewer(memberId))).toEqual(owned);
        expect(await read(runnerJobs, viewer(namedOwnerId))).toEqual(owned);

        // Those who see every private record.
        expect(
          await read(
            runnerJobs,
            propsOf([grant(Permission.ProjectAdmin)], adminId),
          ),
        ).toEqual(everything);
        expect(
          await read(
            runnerJobs,
            propsOf([grant(Permission.ProjectOwner)], adminId),
          ),
        ).toEqual(everything);

        // Those who do not.
        for (const props of [
          viewer(otherId),
          viewer(invitedId),
          propsOf([grant(Permission.RunbookViewer)], otherId),
          propsOf([grant(Permission.Viewer)], null, UserType.API),
          workflowStep(),
        ]) {
          expect(await read(runnerJobs, props)).toEqual(sorted(notPrivate));
        }
      });

      test("the caller's own filter on the run it names is kept", async () => {
        const publicRun: string = await runAbout({
          incidentId: await seedRecord(kindOf("Incident"), false),
        });
        const privateRun: string = await runAbout({
          incidentId: await seedRecord(kindOf("Incident"), true),
        });

        const ofPublicRun: string = await jobOf({
          runbookExecutionId: publicRun,
        });
        const ofPrivateRun: string = await jobOf({
          runbookExecutionId: privateRun,
        });
        await jobOf({});

        const found: (
          runId: string,
          props: DatabaseCommonInteractionProps,
        ) => Promise<Array<string>> = async (
          runId: string,
          props: DatabaseCommonInteractionProps,
        ): Promise<Array<string>> => {
          return (
            await RunnerJobService.findBy({
              query: { runbookExecutionId: new ObjectID(runId) },
              select: { _id: true },
              skip: 0,
              limit: 100,
              props: props,
            })
          ).map((job: BaseModel): string => {
            return job._id!.toString();
          });
        };

        for (const props of [
          viewer(memberId),
          viewer(otherId),
          propsOf([grant(Permission.ProjectAdmin)], adminId),
        ]) {
          expect(await found(publicRun, props)).toEqual([ofPublicRun]);
        }

        expect(await found(privateRun, viewer(memberId))).toEqual([
          ofPrivateRun,
        ]);

        // Asked for the private run by name, someone who does not see it reads nothing.
        expect(await found(privateRun, viewer(otherId))).toEqual([]);
      });
    });

    /*
     * THROUGH A RELATION (#9102). A row that names a private record without
     * being a part of it - a Data Security issue's incident, a public
     * alert's private episode, a runner job's run - is read by whoever may
     * read it, and before this a join handed them the record's columns.
     */
    describe("a private record read through a relation", () => {
      // The readers who see the private records, and those who do not.
      function seers(): Array<[string, DatabaseCommonInteractionProps]> {
        return [
          ["the owning team's member", viewer(memberId)],
          ["the person named as its owner", viewer(namedOwnerId)],
          [
            "a Project Admin",
            propsOf([grant(Permission.ProjectAdmin)], adminId),
          ],
          [
            "a Project Owner",
            propsOf([grant(Permission.ProjectOwner)], adminId),
          ],
        ];
      }

      function others(): Array<[string, DatabaseCommonInteractionProps]> {
        return [
          ["another member", viewer(otherId)],
          ["an invitee who has not accepted", viewer(invitedId)],
          [
            "an API key",
            propsOf([grant(Permission.Viewer)], null, UserType.API),
          ],
          ["a workflow's step", workflowStep()],
        ];
      }

      function isRequired(table: string, column: string): boolean {
        return (required[table] || []).some((each: RequiredColumn): boolean => {
          return each.name === column;
        });
      }

      /*
       * A record of `relatedModelType` - a private record of its kind, or a
       * part naming one by its first key - private or public. Returns its ID.
       */
      async function seedRelated(
        relatedModelType: { new (): BaseModel },
        isPrivate: boolean,
        values: SqlRow = {},
      ): Promise<string> {
        const table: string = new relatedModelType().tableName as string;
        const kind: PrivateRecordKind | null =
          PrivateRecordPermission.getKind(table);

        if (kind) {
          return await seedRecord(kind, isPrivate, values);
        }

        const id: string = ObjectID.generate().toString();
        const row: SqlRow = { _id: id, projectId: projectId.toString() };

        for (const [
          index,
          column,
        ] of PrivateRecordPermission.getPrivateRecordColumns(
          relatedModelType,
        ).entries()) {
          row[column.column] =
            index === 0
              ? await seedRecord(column.kind, isPrivate)
              : isRequired(table, column.column)
                ? ObjectID.generate().toString()
                : null;
        }

        await insert(table, { ...row, ...values });

        return id;
      }

      // A row of the model holding `held`, linked to `relatedId`. Returns its ID.
      async function seedLinked(
        held: HeldRelation,
        relatedId: string,
        values: SqlRow = {},
      ): Promise<string> {
        const model: BaseModel = new held.modelType();
        const metadata: TableColumnMetadata = model.getTableColumnMetadata(
          held.relation.relation,
        );
        const id: string = ObjectID.generate().toString();

        await insert(model.tableName as string, {
          _id: id,
          projectId: projectId.toString(),
          [metadata.manyToOneRelationColumn as string]: relatedId,
          ...values,
        });

        return id;
      }

      test("every relation the rule holds is to one record, which these tests read", () => {
        expect(HELD_RELATIONS.length).toBeGreaterThan(0);

        for (const held of HELD_RELATIONS) {
          expect({ name: held.name, isList: held.relation.isList }).toEqual({
            name: held.name,
            isList: false,
          });
        }
      });

      describe.each(HELD_RELATIONS)("$name", (held: HeldRelation) => {
        async function seedBoth(): Promise<{
          toPrivate: string;
          toPublic: string;
        }> {
          return {
            toPrivate: await seedLinked(
              held,
              await seedRelated(held.relation.relatedModelType, true),
            ),
            toPublic: await seedLinked(
              held,
              await seedRelated(held.relation.relatedModelType, false),
            ),
          };
        }

        // The rows read as OneUptime, with the related record's creation time.
        async function readLinked(
          ids: Array<string>,
        ): Promise<Array<BaseModel>> {
          return await database.getRepository(held.modelType).find({
            where: { _id: QueryHelper.any(ids) } as never,
            relations: { [held.relation.relation]: true } as never,
            select: {
              _id: true,
              [held.relation.relation]: { _id: true, createdAt: true },
            } as never,
          });
        }

        test("a select reads the related record only for those who see it", async () => {
          const { toPrivate, toPublic } = await seedBoth();

          const relatedOf: (
            props: DatabaseCommonInteractionProps,
          ) => Promise<Record<string, boolean>> = async (
            props: DatabaseCommonInteractionProps,
          ): Promise<Record<string, boolean>> => {
            const rows: Array<BaseModel> = await readLinked([
              toPrivate,
              toPublic,
            ]);

            // Every row came back with its related record from the join.
            expect(rows).toHaveLength(2);

            await PrivateRecordReadFilter.keepSeenRelatedRecords({
              modelType: held.modelType,
              rows: rows,
              select: { [held.relation.relation]: { createdAt: true } },
              props: props,
            });

            const shown: Record<string, boolean> = {};

            for (const row of rows) {
              shown[row._id!.toString() === toPrivate ? "private" : "public"] =
                Boolean(
                  (row as unknown as Record<string, unknown>)[
                    held.relation.relation
                  ],
                );
            }

            return shown;
          };

          for (const [who, props] of seers()) {
            expect({ who, shown: await relatedOf(props) }).toEqual({
              who,
              shown: { private: true, public: true },
            });
          }

          for (const [who, props] of others()) {
            expect({ who, shown: await relatedOf(props) }).toEqual({
              who,
              shown: { private: false, public: true },
            });
          }
        });

        test("a filter on the related record's columns matches only the ones the reader sees", async () => {
          const { toPrivate, toPublic } = await seedBoth();

          const matched: (
            props: DatabaseCommonInteractionProps,
          ) => Promise<Array<string>> = async (
            props: DatabaseCommonInteractionProps,
          ): Promise<Array<string>> => {
            const query: Record<string, unknown> = QueryUtil.serializeQuery(
              held.modelType,
              PrivateRecordReadFilter.addToRelationFilters(
                held.modelType,
                {
                  _id: QueryHelper.any([toPrivate, toPublic]),
                  [held.relation.relation]: {
                    createdAt: QueryHelper.notNull(),
                  },
                },
                props,
              ) as never,
            ) as Record<string, unknown>;

            const rows: Array<BaseModel> = await database
              .getRepository(held.modelType)
              .find({ where: query as never, select: { _id: true } as never });

            return rows
              .map((row: BaseModel): string => {
                return row._id!.toString() === toPrivate ? "private" : "public";
              })
              .sort();
          };

          for (const [who, props] of seers()) {
            expect({ who, matched: await matched(props) }).toEqual({
              who,
              matched: ["private", "public"],
            });
          }

          for (const [who, props] of others()) {
            expect({ who, matched: await matched(props) }).toEqual({
              who,
              matched: ["public"],
            });
          }
        });
      });

      /*
       * The models #9102 names, and a public record in a private episode,
       * read as the API reads them: through their own services, with every
       * permission check, the read rule of each and the query serializer.
       */
      interface ThroughService {
        name: string;
        service: DatabaseService<BaseModel>;
        relation: string;
      }

      const THROUGH_SERVICES: Array<ThroughService> = [
        {
          name: "a Data Security issue's incident",
          service: asService(DataSecurityIssueService),
          relation: "incident",
        },
        {
          name: "a Data Security issue's alert",
          service: asService(DataSecurityIssueService),
          relation: "alert",
        },
        {
          name: "a security case's incident",
          service: asService(SecurityCaseService),
          relation: "incident",
        },
        {
          name: "a form submission's incident",
          service: asService(FormSubmissionService),
          relation: "incident",
        },
        {
          name: "a session replay pin's incident",
          service: asService(RumSessionPinService),
          relation: "incident",
        },
        {
          name: "a session replay pin's alert",
          service: asService(RumSessionPinService),
          relation: "alert",
        },
        {
          name: "a session replay view's incident",
          service: asService(RumSessionReplayViewService),
          relation: "linkedIncident",
        },
        {
          name: "a public alert's private episode",
          service: asService(AlertService),
          relation: "alertEpisode",
        },
        {
          name: "a public incident's private episode",
          service: asService(IncidentService),
          relation: "incidentEpisode",
        },
      ];

      // A reader of these models: Viewer, and what the other products ask for.
      function reader(who: ObjectID | null): DatabaseCommonInteractionProps {
        return propsOf(
          [
            grant(Permission.Viewer),
            grant(Permission.SecurityViewer),
            grant(Permission.ReadFormSubmission),
            grant(Permission.ReadRumSessionReplay),
            grant(Permission.ReadRumSessionReplayAudit),
          ],
          who,
          who ? UserType.User : UserType.API,
        );
      }

      function serviceSeers(): Array<[string, DatabaseCommonInteractionProps]> {
        return [
          ["the owning team's member", reader(memberId)],
          ["the person named as its owner", reader(namedOwnerId)],
          [
            "a Project Admin",
            propsOf([grant(Permission.ProjectAdmin)], adminId),
          ],
        ];
      }

      function serviceOthers(): Array<
        [string, DatabaseCommonInteractionProps]
      > {
        return [
          ["another member", reader(otherId)],
          ["an invitee who has not accepted", reader(invitedId)],
          ["an API key", reader(null)],
        ];
      }

      const SECRET_TITLE: string = "Secret: the payments database is down";
      const PUBLIC_TITLE: string = "Public: slow checkout";

      describe.each(THROUGH_SERVICES)("$name", (through: ThroughService) => {
        const held: () => HeldRelation = (): HeldRelation => {
          return HELD_RELATIONS.find((candidate: HeldRelation): boolean => {
            return (
              candidate.modelType === through.service.modelType &&
              candidate.relation.relation === through.relation
            );
          })!;
        };

        async function seedBoth(): Promise<{
          toPrivate: string;
          toPublic: string;
        }> {
          // A public row of the private kinds (a public alert in an episode).
          const ownValues: SqlRow =
            PrivateRecordPermission.isPrivateRecordModel(
              through.service.modelType as { new (): BaseModel },
            )
              ? { isPrivate: false }
              : {};

          return {
            toPrivate: await seedLinked(
              held(),
              await seedRelated(held().relation.relatedModelType, true, {
                title: SECRET_TITLE,
              }),
              ownValues,
            ),
            toPublic: await seedLinked(
              held(),
              await seedRelated(held().relation.relatedModelType, false, {
                title: PUBLIC_TITLE,
              }),
              ownValues,
            ),
          };
        }

        // The title each row shows of its related record, by row.
        async function titles(
          props: DatabaseCommonInteractionProps,
          ids: { toPrivate: string; toPublic: string },
        ): Promise<Record<string, string | null>> {
          const rows: Array<BaseModel> = await through.service.findBy({
            query: { _id: QueryHelper.any([ids.toPrivate, ids.toPublic]) },
            select: {
              _id: true,
              [through.relation]: { title: true },
            } as never,
            skip: 0,
            limit: 10,
            props: props,
          });

          const shown: Record<string, string | null> = {};

          for (const row of rows) {
            const related: unknown = (
              row as unknown as Record<string, unknown>
            )[through.relation];

            shown[
              row._id!.toString() === ids.toPrivate ? "private" : "public"
            ] = related
              ? ((related as Record<string, unknown>)["title"] as string)
              : null;
          }

          return shown;
        }

        test("its title is selected only by those who see the record; everyone else reads the row without it", async () => {
          const ids: { toPrivate: string; toPublic: string } = await seedBoth();

          for (const [who, props] of serviceSeers()) {
            expect({ who, shown: await titles(props, ids) }).toEqual({
              who,
              shown: { private: SECRET_TITLE, public: PUBLIC_TITLE },
            });
          }

          for (const [who, props] of serviceOthers()) {
            expect({ who, shown: await titles(props, ids) }).toEqual({
              who,
              shown: { private: null, public: PUBLIC_TITLE },
            });
          }
        });

        test("a filter or a count on its title finds it only for those who see it", async () => {
          await seedBoth();

          const found: (
            props: DatabaseCommonInteractionProps,
          ) => Promise<{ found: number; counted: number }> = async (
            props: DatabaseCommonInteractionProps,
          ): Promise<{ found: number; counted: number }> => {
            const query: Record<string, unknown> = {
              [through.relation]: { title: new Search("payments database") },
            };

            return {
              found: (
                await through.service.findBy({
                  query: query as never,
                  select: { _id: true },
                  skip: 0,
                  limit: 10,
                  props: props,
                })
              ).length,
              counted: (
                await through.service.countBy({
                  query: query as never,
                  props: props,
                })
              ).toNumber(),
            };
          };

          for (const [who, props] of serviceSeers()) {
            expect({ who, ...(await found(props)) }).toEqual({
              who,
              found: 1,
              counted: 1,
            });
          }

          for (const [who, props] of serviceOthers()) {
            expect({ who, ...(await found(props)) }).toEqual({
              who,
              found: 0,
              counted: 0,
            });
          }
        });

        test("a sort by its title is refused to everyone who does not see every private record", async () => {
          await seedBoth();

          const sort: (
            props: DatabaseCommonInteractionProps,
          ) => Promise<void> = async (
            props: DatabaseCommonInteractionProps,
          ): Promise<void> => {
            await through.service.findBy({
              query: {},
              select: { _id: true },
              sort: {
                [through.relation]: { title: SortOrder.Ascending },
              } as never,
              skip: 0,
              limit: 10,
              props: props,
            });
          };

          for (const [who, props] of serviceOthers()) {
            let refusal: unknown = null;

            try {
              await sort(props);
            } catch (error) {
              refusal = error;
            }

            expect({
              who,
              refused: refusal instanceof NotAuthorizedException,
            }).toEqual({ who, refused: true });
          }

          // The owning team's member, who sees this one, may not see every one.
          await expect(sort(reader(memberId))).rejects.toBeInstanceOf(
            NotAuthorizedException,
          );

          await sort(propsOf([grant(Permission.ProjectAdmin)], adminId));
          await sort(propsOf([grant(Permission.ProjectOwner)], adminId));
        });
      });

      test("the API's list of Data Security issues leaves out the private incident's title", async () => {
        const dataSecurityIssue: HeldRelation = HELD_RELATIONS.find(
          (candidate: HeldRelation): boolean => {
            return (
              candidate.modelType === DataSecurityIssue &&
              candidate.relation.relation === "incident"
            );
          },
        )!;

        const toPrivate: string = await seedLinked(
          dataSecurityIssue,
          await seedRelated(dataSecurityIssue.relation.relatedModelType, true, {
            title: SECRET_TITLE,
          }),
        );

        const api: BaseAPI<BaseModel, DatabaseService<BaseModel>> = new BaseAPI(
          DataSecurityIssue as unknown as { new (): BaseModel },
          asService(DataSecurityIssueService),
        );

        const listOf: (
          props: DatabaseCommonInteractionProps,
          body: Record<string, unknown>,
        ) => Promise<Array<BaseModel>> = async (
          props: DatabaseCommonInteractionProps,
          body: Record<string, unknown>,
        ): Promise<Array<BaseModel>> => {
          const propsSpy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
            CommonAPI,
            "getDatabaseCommonInteractionProps",
          ).mockResolvedValue(props as never);
          const sent: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
            Response,
            "sendEntityArrayResponse",
          ).mockImplementation((() => {
            return undefined;
          }) as never);

          try {
            await api.getList(
              {
                method: "POST",
                params: {},
                query: {},
                headers: {},
                body: body,
              } as unknown as ExpressRequest,
              {} as ExpressResponse,
            );

            return sent.mock.calls[0]![2] as Array<BaseModel>;
          } finally {
            propsSpy.mockRestore();
            sent.mockRestore();
          }
        };

        const body: Record<string, unknown> = {
          query: JSONFunctions.serialize({}),
          select: JSONFunctions.serialize({
            _id: true,
            incident: { title: true },
          }),
        };

        const asMember: Array<BaseModel> = await listOf(reader(memberId), body);
        const asOther: Array<BaseModel> = await listOf(reader(otherId), body);

        expect((asMember[0] as DataSecurityIssue).incident?.title).toBe(
          SECRET_TITLE,
        );
        expect(
          asOther.map((row: BaseModel) => {
            return row._id!.toString();
          }),
        ).toEqual([toPrivate]);
        expect((asOther[0] as DataSecurityIssue).incident).toBeUndefined();
        expect((asOther[0] as DataSecurityIssue).incidentId?.toString()).toBe(
          (asMember[0] as DataSecurityIssue).incidentId?.toString(),
        );

        // Filtered by the title, through the API: nothing for the other member.
        const filtered: Record<string, unknown> = {
          query: JSONFunctions.serialize({
            incident: { title: new Search("payments") },
          }),
          select: JSONFunctions.serialize({ _id: true }),
        };

        expect(await listOf(reader(otherId), filtered)).toEqual([]);
        expect(await listOf(reader(memberId), filtered)).toHaveLength(1);
      });

      test("OneUptime AI's read of a security case names its private incident only to those who see it", async () => {
        const securityCase: HeldRelation = HELD_RELATIONS.find(
          (candidate: HeldRelation): boolean => {
            return candidate.modelType === SecurityCaseService.modelType;
          },
        )!;

        const caseId: string = await seedLinked(
          securityCase,
          await seedRelated(securityCase.relation.relatedModelType, true, {
            title: SECRET_TITLE,
          }),
        );

        // The project's case statuses and priorities: none, and none written.
        const values: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
          SecurityCaseValues,
          "getForProject",
        ).mockResolvedValue({ priorities: [], statuses: [] } as never);

        const read: (
          props: DatabaseCommonInteractionProps,
        ) => Promise<string> = async (
          props: DatabaseCommonInteractionProps,
        ): Promise<string> => {
          const result: ToolExecutionResult =
            await QuerySecurityCasesTool.execute(
              { securityCaseId: caseId },
              { projectId: projectId, props: props },
            );

          return result.dataForLlm;
        };

        try {
          expect(await read(reader(memberId))).toContain(SECRET_TITLE);
          expect(await read(reader(otherId))).not.toContain(SECRET_TITLE);
          expect(await read(reader(otherId))).not.toContain("payments");
        } finally {
          values.mockRestore();
        }
      });
    });
  },
);
