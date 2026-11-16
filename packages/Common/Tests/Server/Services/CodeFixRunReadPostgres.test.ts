import Entities from "../../../Models/DatabaseModels/Index";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AIAgentTaskPullRequestService from "../../../Server/Services/AIAgentTaskPullRequestService";
import AIRunService from "../../../Server/Services/AIRunService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import PrivateRecordPermission, {
  PrivateRecordKind,
} from "../../../Server/Types/Database/Permissions/PrivateRecordPermission";
import AIRunOutputReadFilter from "../../../Server/Utils/AI/AIRunOutputReadFilter";
import CodeTaskListQuery from "../../../Server/Utils/AI/CodeTask/CodeTaskListQuery";
import CodeTaskStats from "../../../Server/Utils/AI/CodeTask/CodeTaskStats";
import CodeTaskThread from "../../../Server/Utils/AI/CodeTask/CodeTaskThread";
import {
  assertReachesFixSubject,
  OPEN_CODE_FIX_PULL_REQUEST_ACTION,
  OPEN_FIX_PULL_REQUEST_ACTION,
} from "../../../Server/Utils/AutoRemediation/RemediationApproval";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import { RealtimeReader } from "../../../Server/Utils/Realtime/RealtimeReadAccess";
import Response from "../../../Server/Utils/Response";
import WorkflowPrincipal from "../../../Server/Utils/Workflow/WorkflowPrincipal";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import AIRunType from "../../../Types/AI/AIRunType";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import {
  CodeRepositoryTaskStatsJSON,
  CodeTaskListCountsJSON,
  CodeTaskListFilter,
} from "../../../Types/AI/CodeTask";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PullRequestState from "../../../Types/CodeRepository/PullRequestState";
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
 * ONEUPTIME AI'S CODE WORK ABOUT A PRIVATE INCIDENT OR ALERT FOLLOWS ITS
 * OWNERS, ON A MIGRATED POSTGRES (#9165, #9106).
 *
 * A CodeFix run is the project's to read - except one about a private
 * incident or alert, which only those who see that record read: the fix
 * pull request of its investigation (FixFromIncident), a Code task asked
 * for the code that declares one of its fixes' changes (DeclaredCodeChanges,
 * by the fix it names), and every reply in such a task, through the task.
 * One about a deleted record: only Project Owners and Project Admins. The
 * same holds for the run's pull request, read through its run, and for the
 * Code pages' own SQL. And opening a pull request from a private record is
 * held to its owners, as approving one of its fixes is.
 *
 * AIRunOutputReadFilter.test holds the SQL the rule writes; this suite runs
 * it through every read: the run's service (a find and a count that agree,
 * a filter, a sort, a read by id, a live update's), the API's list, the
 * pull request's service, the Code pages' list, filters, counts and
 * repository totals, a task's page (findTask), and the task page's own read
 * of a run (CodeFixRunAPI). As every kind of reader: the person who asked
 * for the fix, another member, a pending invitee of the owning team, the
 * owning team's member, the person named as owner, a member of the owning
 * team that may only view it who holds Code permissions through another
 * team, a Project Owner, a Project Admin, API keys with and without Project
 * Admin, and a workflow's step.
 *
 * Opt in with RUN_POSTGRES_CODE_FIX_RUN_TESTS=true against a database the
 * registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_CODE_FIX_RUN_TESTS=true \
 *   CODE_FIX_RUN_TEST_DATABASE_HOST=127.0.0.1 \
 *   CODE_FIX_RUN_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/CodeFixRunReadPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml.
 *
 * Everything runs in a uniquely named schema holding structure-only clones
 * (LIKE ... INCLUDING ALL) of the tables it reads: the AI runs, their pull
 * requests, the fixes they name, the incidents and alerts, their owners and
 * the team members. The clones carry no foreign keys, so a seeded row needs
 * only its NOT NULL columns, read from the migrated schema and filled in by
 * kind. Every statement Postgres rejects is recorded and fails the test,
 * even one a caller would have caught.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_CODE_FIX_RUN_TESTS"] === "true"
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

const TABLES: Array<string> = [
  "TeamMember",
  "Incident",
  "IncidentOwnerUser",
  "IncidentOwnerTeam",
  "Alert",
  "AlertOwnerUser",
  "AlertOwnerTeam",
  "AIRun",
  "AIAgentTaskPullRequest",
  "AutoRemediationSuggestion",
];

describePostgres(
  "OneUptime AI's code work about a private record, read on a migrated Postgres",
  () => {
    const schema: string = `code_fix_run_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    const projectId: ObjectID = ObjectID.generate();
    const repositoryId: ObjectID = ObjectID.generate();
    // The team that owns the private records, and another team.
    const owningTeamId: ObjectID = ObjectID.generate();
    const otherTeamId: ObjectID = ObjectID.generate();

    // Asked for the fixes and the Code tasks; owns no private record.
    const authorId: ObjectID = ObjectID.generate();
    // Another member of the project.
    const otherId: ObjectID = ObjectID.generate();
    // An accepted member of the team that owns the private records.
    const ownerTeamMemberId: ObjectID = ObjectID.generate();
    // Invited to that team, the invitation not accepted yet.
    const invitedId: ObjectID = ObjectID.generate();
    // Named as an owner of the private records.
    const namedOwnerId: ObjectID = ObjectID.generate();
    /*
     * On the owning team, which may only view; may change Code and run
     * fixes through the other team.
     */
    const viewOnlyOwnerId: ObjectID = ObjectID.generate();
    const projectOwnerId: ObjectID = ObjectID.generate();
    const projectAdminId: ObjectID = ObjectID.generate();

    const failedQueries: FailedQueryRecorder = new FailedQueryRecorder();
    let database: DataSource;

    const required: Record<string, Array<RequiredColumn>> = {};

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host: process.env["CODE_FIX_RUN_TEST_DATABASE_HOST"] || "localhost",
        port: Number(process.env["CODE_FIX_RUN_TEST_DATABASE_PORT"] || "5400"),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["CODE_FIX_RUN_TEST_DATABASE_NAME"] ||
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

    beforeEach(async () => {
      failedQueries.failures = [];

      await database.query(
        TABLES.map((table: string): string => {
          return `DELETE FROM "${schema}"."${table}"`;
        }).join("; "),
      );

      for (const member of [
        { userId: ownerTeamMemberId, teamId: owningTeamId, accepted: true },
        { userId: viewOnlyOwnerId, teamId: owningTeamId, accepted: true },
        { userId: viewOnlyOwnerId, teamId: otherTeamId, accepted: true },
        { userId: invitedId, teamId: owningTeamId, accepted: false },
        { userId: otherId, teamId: otherTeamId, accepted: true },
        { userId: authorId, teamId: otherTeamId, accepted: true },
      ]) {
        await insert("TeamMember", {
          _id: ObjectID.generate().toString(),
          projectId: projectId.toString(),
          teamId: member.teamId.toString(),
          userId: member.userId.toString(),
          hasAcceptedInvitation: member.accepted,
        });
      }
    });

    afterEach(() => {
      jest.restoreAllMocks();
      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

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

    async function seedRow(table: string, values: SqlRow): Promise<string> {
      const id: string = ObjectID.generate().toString();

      await insert(table, {
        _id: id,
        projectId: projectId.toString(),
        ...values,
      });

      return id;
    }

    function kindOf(tableName: string): PrivateRecordKind {
      return PrivateRecordPermission.getKind(tableName)!;
    }

    /*
     * An incident or an alert: a private one owned by the owning team and
     * by the person named as its owner, or a public one the owning team
     * owns too. Returns its ID.
     */
    async function seedRecord(
      tableName: string,
      isPrivate: boolean,
    ): Promise<string> {
      const kind: PrivateRecordKind = kindOf(tableName);
      const id: string = await seedRow(kind.tableName, {
        isPrivate: isPrivate,
      });

      await seedRow(kind.ownerTeamTable, {
        teamId: owningTeamId.toString(),
        [kind.ownerKey]: id,
      });

      if (isPrivate) {
        await seedRow(kind.ownerUserTable, {
          userId: namedOwnerId.toString(),
          [kind.ownerKey]: id,
        });
      }

      return id;
    }

    // A code-fix run: a task (its first turn), or a reply in one.
    async function seedRun(values: {
      taskType?: CodeFixTaskType | undefined;
      runType?: AIRunType | undefined;
      userId?: ObjectID | undefined;
      incidentId?: string | undefined;
      alertId?: string | undefined;
      fixId?: string | undefined;
      taskId?: string | undefined;
      status?: AIRunStatus | undefined;
      createdAt?: Date | undefined;
    }): Promise<string> {
      return await seedRow("AIRun", {
        runType: values.runType || AIRunType.CodeFix,
        codeFixTaskType:
          values.runType && values.runType !== AIRunType.CodeFix
            ? null
            : values.taskType || CodeFixTaskType.CodeRequest,
        status: values.status || AIRunStatus.Completed,
        userId: values.userId ? values.userId.toString() : null,
        triggeredByIncidentId: values.incidentId || null,
        triggeredByAlertId: values.alertId || null,
        triggeredByAutoRemediationSuggestionId: values.fixId || null,
        codeTaskId: values.taskId || null,
        codeRepositoryId: repositoryId.toString(),
        needsUserInput: false,
        createdAt: values.createdAt || new Date(),
        deletedAt: null,
      });
    }

    // A pull request a run opened (none: one OneUptime AI opened from a chat).
    async function seedPullRequest(runId: string | null): Promise<string> {
      return await seedRow("AIAgentTaskPullRequest", {
        aiRunId: runId,
        codeRepositoryId: repositoryId.toString(),
        pullRequestState: PullRequestState.Open,
        title: "fix: a change",
        pullRequestUrl: "https://github.com/acme/checkout/pull/1",
        deletedAt: null,
      });
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

    // Someone reading the project, holding these permissions in it.
    function propsOf(
      permissions: Array<UserPermission>,
      who: ObjectID | null,
    ): DatabaseCommonInteractionProps {
      return {
        ...(who ? { userId: who } : {}),
        tenantId: projectId,
        currentPlan: PlanType.Scale,
        userType: who ? UserType.User : UserType.API,
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

    function member(who: ObjectID): DatabaseCommonInteractionProps {
      return propsOf([grant(Permission.ProjectMember)], who);
    }

    // On the owning team, which may only view; a member through another team.
    function viewOnlyOwner(): DatabaseCommonInteractionProps {
      return propsOf(
        [
          grant(Permission.ProjectMember, otherTeamId),
          grant(Permission.Viewer, owningTeamId),
        ],
        viewOnlyOwnerId,
      );
    }

    function projectOwner(): DatabaseCommonInteractionProps {
      return propsOf([grant(Permission.ProjectOwner)], projectOwnerId);
    }

    function projectAdmin(): DatabaseCommonInteractionProps {
      return propsOf([grant(Permission.ProjectAdmin)], projectAdminId);
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

    // The world every test reads.
    interface World {
      privateIncident: string;
      publicIncident: string;
      privateAlert: string;
      publicAlert: string;
      fixOfPrivateIncident: string;
      fixOfPrivateAlert: string;
      fixOfPublicAlert: string;
      // Runs everyone may read.
      plainTask: string;
      codeFixOfPublicIncident: string;
      replyInPublicTask: string;
      codeFixOfPublicAlert: string;
      declaredCodeOfPublicAlertsFix: string;
      // Runs about the private incident and alert.
      codeFixOfPrivateIncident: string;
      replyInPrivateTask: string;
      codeFixOfPrivateAlert: string;
      declaredCodeOfPrivateIncidentsFix: string;
      replyInPrivateFixsTask: string;
      declaredCodeOfPrivateAlertsFix: string;
      // Runs about what is gone: a record, a fix, a task.
      codeFixOfDeletedIncident: string;
      codeFixOfDeletedAlert: string;
      declaredCodeOfGoneFix: string;
      replyInGoneTask: string;
      // The author's own chat, which only they read.
      authorsChat: string;
      // Pull requests, by the run that opened them.
      prOfPublicIncident: string;
      prOfPlainTask: string;
      prFromAChat: string;
      prOfPrivateIncident: string;
      prOfPrivateReply: string;
      prOfPrivateAlertsDeclaredCode: string;
      prOfDeletedIncident: string;
    }

    async function seedWorld(): Promise<World> {
      const privateIncident: string = await seedRecord("Incident", true);
      const publicIncident: string = await seedRecord("Incident", false);
      const privateAlert: string = await seedRecord("Alert", true);
      const publicAlert: string = await seedRecord("Alert", false);

      const fixAbout: (values: SqlRow) => Promise<string> = async (
        values: SqlRow,
      ): Promise<string> => {
        return await seedRow("AutoRemediationSuggestion", {
          incidentId: null,
          alertId: null,
          ...values,
        });
      };

      const fixOfPrivateIncident: string = await fixAbout({
        incidentId: privateIncident,
      });
      const fixOfPrivateAlert: string = await fixAbout({
        alertId: privateAlert,
      });
      const fixOfPublicAlert: string = await fixAbout({
        alertId: publicAlert,
      });

      const codeFixOfPublicIncident: string = await seedRun({
        taskType: CodeFixTaskType.FixFromIncident,
        incidentId: publicIncident,
        userId: authorId,
      });
      const codeFixOfPrivateIncident: string = await seedRun({
        taskType: CodeFixTaskType.FixFromIncident,
        incidentId: privateIncident,
        userId: authorId,
        status: AIRunStatus.Running,
      });
      const declaredCodeOfPrivateIncidentsFix: string = await seedRun({
        fixId: fixOfPrivateIncident,
        userId: authorId,
      });

      const plainTask: string = await seedRun({ userId: authorId });

      const world: Omit<
        World,
        | "prOfPublicIncident"
        | "prOfPlainTask"
        | "prFromAChat"
        | "prOfPrivateIncident"
        | "prOfPrivateReply"
        | "prOfPrivateAlertsDeclaredCode"
        | "prOfDeletedIncident"
      > = {
        privateIncident,
        publicIncident,
        privateAlert,
        publicAlert,
        fixOfPrivateIncident,
        fixOfPrivateAlert,
        fixOfPublicAlert,
        plainTask,
        codeFixOfPublicIncident,
        replyInPublicTask: await seedRun({
          taskId: codeFixOfPublicIncident,
          userId: otherId,
        }),
        codeFixOfPublicAlert: await seedRun({
          taskType: CodeFixTaskType.ImproveInstrumentation,
          alertId: publicAlert,
        }),
        declaredCodeOfPublicAlertsFix: await seedRun({
          fixId: fixOfPublicAlert,
          userId: authorId,
        }),
        codeFixOfPrivateIncident,
        replyInPrivateTask: await seedRun({
          taskId: codeFixOfPrivateIncident,
          userId: authorId,
        }),
        codeFixOfPrivateAlert: await seedRun({
          taskType: CodeFixTaskType.FixFromIncident,
          alertId: privateAlert,
        }),
        declaredCodeOfPrivateIncidentsFix,
        replyInPrivateFixsTask: await seedRun({
          taskId: declaredCodeOfPrivateIncidentsFix,
          userId: otherId,
        }),
        declaredCodeOfPrivateAlertsFix: await seedRun({
          fixId: fixOfPrivateAlert,
          userId: authorId,
        }),
        codeFixOfDeletedIncident: await seedRun({
          taskType: CodeFixTaskType.FixFromIncident,
          incidentId: ObjectID.generate().toString(),
        }),
        codeFixOfDeletedAlert: await seedRun({
          taskType: CodeFixTaskType.FixFromIncident,
          alertId: ObjectID.generate().toString(),
        }),
        declaredCodeOfGoneFix: await seedRun({
          fixId: ObjectID.generate().toString(),
          userId: authorId,
        }),
        replyInGoneTask: await seedRun({
          taskId: ObjectID.generate().toString(),
          userId: authorId,
        }),
        authorsChat: await seedRun({
          runType: AIRunType.Chat,
          userId: authorId,
        }),
      };

      return {
        ...world,
        prOfPublicIncident: await seedPullRequest(codeFixOfPublicIncident),
        prOfPlainTask: await seedPullRequest(plainTask),
        prFromAChat: await seedPullRequest(null),
        prOfPrivateIncident: await seedPullRequest(codeFixOfPrivateIncident),
        prOfPrivateReply: await seedPullRequest(world.replyInPrivateTask),
        prOfPrivateAlertsDeclaredCode: await seedPullRequest(
          world.declaredCodeOfPrivateAlertsFix,
        ),
        prOfDeletedIncident: await seedPullRequest(
          world.codeFixOfDeletedIncident,
        ),
      };
    }

    // The CodeFix runs everyone who may read AI runs reads.
    function everyonesRuns(world: World): Array<string> {
      return [
        world.plainTask,
        world.codeFixOfPublicIncident,
        world.replyInPublicTask,
        world.codeFixOfPublicAlert,
        world.declaredCodeOfPublicAlertsFix,
      ];
    }

    // What only those who see the private incident and alert read besides.
    function privateRecordsRuns(world: World): Array<string> {
      return [
        world.codeFixOfPrivateIncident,
        world.replyInPrivateTask,
        world.codeFixOfPrivateAlert,
        world.declaredCodeOfPrivateIncidentsFix,
        world.replyInPrivateFixsTask,
        world.declaredCodeOfPrivateAlertsFix,
      ];
    }

    // What only those who see every private record read besides.
    function goneRecordsRuns(world: World): Array<string> {
      return [
        world.codeFixOfDeletedIncident,
        world.codeFixOfDeletedAlert,
        world.declaredCodeOfGoneFix,
        world.replyInGoneTask,
      ];
    }

    interface Read {
      ids: Array<string>;
      count: number;
    }

    function sorted(ids: Array<string>): Read {
      return { ids: [...ids].sort(), count: ids.length };
    }

    async function readRuns(
      props: DatabaseCommonInteractionProps,
      query: SqlRow = {},
    ): Promise<Read> {
      const found: Array<AIRun> = await AIRunService.findBy({
        query: { runType: AIRunType.CodeFix, ...query } as never,
        select: { _id: true },
        skip: 0,
        limit: 100,
        props: props,
      });
      const count: PositiveNumber = await AIRunService.countBy({
        query: { runType: AIRunType.CodeFix, ...query } as never,
        props: props,
      });

      return {
        ids: found
          .map((run: AIRun): string => {
            return run._id!.toString();
          })
          .sort(),
        count: count.toNumber(),
      };
    }

    async function readPullRequests(
      props: DatabaseCommonInteractionProps,
    ): Promise<Read> {
      const found: Array<BaseModel> =
        await AIAgentTaskPullRequestService.findBy({
          query: {},
          select: { _id: true, title: true },
          skip: 0,
          limit: 100,
          props: props,
        });
      const count: PositiveNumber = await AIAgentTaskPullRequestService.countBy(
        { query: {}, props: props },
      );

      return {
        ids: found
          .map((pullRequest: BaseModel): string => {
            return pullRequest._id!.toString();
          })
          .sort(),
        count: count.toNumber(),
      };
    }

    describe("the AI runs themselves", () => {
      test("every kind of reader reads the CodeFix runs about what they see, and only those", async () => {
        const world: World = await seedWorld();

        const everyone: Array<string> = everyonesRuns(world);
        const seers: Array<string> = [
          ...everyone,
          ...privateRecordsRuns(world),
        ];
        const all: Array<string> = [...seers, ...goneRecordsRuns(world)];

        /*
         * The person who asked for the fixes: the project's runs, none about
         * a private record they do not see - their own included.
         */
        expect(await readRuns(member(authorId))).toEqual(sorted(everyone));

        // Another member, and someone whose invitation to the owning team waits.
        for (const props of [member(otherId), member(invitedId)]) {
          expect(await readRuns(props)).toEqual(sorted(everyone));
        }

        /*
         * The private records' owners: their team's member, the person named,
         * and a member of the owning team that may only view it.
         */
        for (const props of [
          member(ownerTeamMemberId),
          member(namedOwnerId),
          viewOnlyOwner(),
        ]) {
          expect(await readRuns(props)).toEqual(sorted(seers));
        }

        // Project Owners and Admins: every one, those about what is gone too.
        for (const props of [projectOwner(), projectAdmin()]) {
          expect(await readRuns(props)).toEqual(sorted(all));
        }

        // OneUptime itself.
        expect(await readRuns({ isRoot: true })).toEqual(sorted(all));
      });

      test("an API key and a workflow's step read no AI run, as before", async () => {
        await seedWorld();

        for (const props of [
          propsOf([grant(Permission.ProjectMember)], null),
          propsOf([grant(Permission.ProjectAdmin)], null),
          workflowStep(),
        ]) {
          let refusal: unknown = null;

          try {
            await readRuns(props);
          } catch (error) {
            refusal = error;
          }

          expect(refusal).toBeInstanceOf(NotAuthorizedException);
        }
      });

      test("a person's own chat is still theirs alone, whatever they see", async () => {
        const world: World = await seedWorld();

        const chats: (
          props: DatabaseCommonInteractionProps,
        ) => Promise<Read> = (
          props: DatabaseCommonInteractionProps,
        ): Promise<Read> => {
          return readRuns(props, { runType: AIRunType.Chat });
        };

        expect(await chats(member(authorId))).toEqual(
          sorted([world.authorsChat]),
        );
        expect(await chats(projectOwner())).toEqual(sorted([]));
      });

      test("a reader's own filter, a sort and a read by id keep to the rule", async () => {
        const world: World = await seedWorld();

        // Asked for a private incident's runs by name: only who sees it.
        const ofThePrivateIncident: SqlRow = {
          triggeredByIncidentId: new ObjectID(world.privateIncident),
        };

        expect(await readRuns(member(otherId), ofThePrivateIncident)).toEqual(
          sorted([]),
        );
        expect(
          await readRuns(member(ownerTeamMemberId), ofThePrivateIncident),
        ).toEqual(sorted([world.codeFixOfPrivateIncident]));

        // A task's replies, by the task: none of a private record's for another member.
        const repliesOf: SqlRow = {
          codeTaskId: new ObjectID(world.codeFixOfPrivateIncident),
        };

        expect(await readRuns(member(otherId), repliesOf)).toEqual(sorted([]));
        expect(await readRuns(member(namedOwnerId), repliesOf)).toEqual(
          sorted([world.replyInPrivateTask]),
        );

        // Newest first, as the lists read them: the same runs.
        const newestFirst: Array<AIRun> = await AIRunService.findBy({
          query: { runType: AIRunType.CodeFix },
          select: { _id: true, createdAt: true },
          sort: { createdAt: SortOrder.Descending },
          skip: 0,
          limit: 100,
          props: member(otherId),
        });

        expect(
          newestFirst
            .map((run: AIRun): string => {
              return run._id!.toString();
            })
            .sort(),
        ).toEqual(sorted(everyonesRuns(world)).ids);

        // By its id, through the service's own lookup.
        for (const runId of [
          world.codeFixOfPrivateIncident,
          world.replyInPrivateFixsTask,
          world.declaredCodeOfPrivateAlertsFix,
        ]) {
          expect(
            await AIRunService.findOneById({
              id: new ObjectID(runId),
              select: { _id: true, status: true, errorMessage: true },
              props: member(otherId),
            }),
          ).toBeNull();
          expect(
            (
              await AIRunService.findOneById({
                id: new ObjectID(runId),
                select: { _id: true },
                props: member(namedOwnerId),
              })
            )?._id?.toString(),
          ).toBe(runId);
        }
      });

      test("a live update of a run reaches only those who may read it", async () => {
        const world: World = await seedWorld();

        const readableBy: (
          props: DatabaseCommonInteractionProps,
        ) => Promise<Array<string>> = async (
          props: DatabaseCommonInteractionProps,
        ): Promise<Array<string>> => {
          const reader: RealtimeReader = {
            key: (props.userId || ObjectID.generate()).toString(),
            props: props,
            remember: <T>(_key: string, work: () => Promise<T>): Promise<T> => {
              return work();
            },
          };

          return (
            await AIRunService.getRealtimeReadAccess().getReadableIds(reader, [
              new ObjectID(world.codeFixOfPrivateIncident),
              new ObjectID(world.replyInPrivateTask),
              new ObjectID(world.codeFixOfPublicIncident),
            ])
          ).sort();
        };

        expect(await readableBy(member(otherId))).toEqual([
          world.codeFixOfPublicIncident,
        ]);
        expect(await readableBy(member(ownerTeamMemberId))).toEqual(
          [
            world.codeFixOfPrivateIncident,
            world.replyInPrivateTask,
            world.codeFixOfPublicIncident,
          ].sort(),
        );
      });

      test("the API's list leaves out what the reader may not read, and counts the same", async () => {
        const world: World = await seedWorld();

        const api: BaseAPI<BaseModel, DatabaseService<BaseModel>> = new BaseAPI(
          AIRun as unknown as { new (): BaseModel },
          AIRunService as unknown as DatabaseService<BaseModel>,
        );

        const listOf: (
          props: DatabaseCommonInteractionProps,
        ) => Promise<Read> = async (
          props: DatabaseCommonInteractionProps,
        ): Promise<Read> => {
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
                query: { limit: "50" },
                headers: {},
                body: {
                  query: JSONFunctions.serialize({
                    runType: AIRunType.CodeFix,
                  }),
                  select: JSONFunctions.serialize({
                    _id: true,
                    status: true,
                    errorMessage: true,
                    triggeredByIncidentId: true,
                  }),
                },
              } as unknown as ExpressRequest,
              {} as ExpressResponse,
            );

            const call: Array<unknown> = sent.mock.calls[0]!;
            const count: unknown = call[3];

            return {
              ids: (call[2] as Array<BaseModel>)
                .map((row: BaseModel): string => {
                  return row._id!.toString();
                })
                .sort(),
              count:
                count instanceof PositiveNumber
                  ? count.toNumber()
                  : Number(count),
            };
          } finally {
            propsSpy.mockRestore();
            sent.mockRestore();
          }
        };

        expect(await listOf(member(otherId))).toEqual(
          sorted(everyonesRuns(world)),
        );
        expect(await listOf(viewOnlyOwner())).toEqual(
          sorted([...everyonesRuns(world), ...privateRecordsRuns(world)]),
        );
      });

      test("the fix run's page and Log read a run through the rule, as OneUptime", async () => {
        const world: World = await seedWorld();

        // CodeFixRunAPI.findReadableRun's read.
        const asTheRunPage: (
          runId: string,
          props: DatabaseCommonInteractionProps,
        ) => Promise<string | null> = async (
          runId: string,
          props: DatabaseCommonInteractionProps,
        ): Promise<string | null> => {
          const run: AIRun | null = await AIRunService.findOneBy({
            query: AIRunOutputReadFilter.applyToRunRow(
              {
                _id: runId,
                projectId: projectId,
                runType: AIRunType.CodeFix,
              },
              props,
            ),
            select: { _id: true, status: true, errorMessage: true },
            props: { isRoot: true },
          });

          return run?._id?.toString() || null;
        };

        for (const runId of [
          world.codeFixOfPrivateIncident,
          world.replyInPrivateTask,
          world.declaredCodeOfPrivateIncidentsFix,
          world.codeFixOfPrivateAlert,
        ]) {
          expect(await asTheRunPage(runId, member(otherId))).toBeNull();
          expect(await asTheRunPage(runId, member(invitedId))).toBeNull();
          expect(await asTheRunPage(runId, member(namedOwnerId))).toBe(runId);
          expect(await asTheRunPage(runId, viewOnlyOwner())).toBe(runId);
        }

        expect(
          await asTheRunPage(world.codeFixOfDeletedIncident, member(otherId)),
        ).toBeNull();
        expect(
          await asTheRunPage(
            world.codeFixOfDeletedIncident,
            member(ownerTeamMemberId),
          ),
        ).toBeNull();
        expect(
          await asTheRunPage(world.codeFixOfDeletedIncident, projectAdmin()),
        ).toBe(world.codeFixOfDeletedIncident);
        expect(
          await asTheRunPage(world.codeFixOfPublicIncident, member(otherId)),
        ).toBe(world.codeFixOfPublicIncident);
      });
    });

    describe("their pull requests", () => {
      test("every kind of reader reads a pull request only as they read the run that opened it", async () => {
        const world: World = await seedWorld();

        const everyone: Array<string> = [
          world.prOfPublicIncident,
          world.prOfPlainTask,
          world.prFromAChat,
        ];
        const seers: Array<string> = [
          ...everyone,
          world.prOfPrivateIncident,
          world.prOfPrivateReply,
          world.prOfPrivateAlertsDeclaredCode,
        ];
        const all: Array<string> = [...seers, world.prOfDeletedIncident];

        for (const props of [
          member(authorId),
          member(otherId),
          member(invitedId),
          // An API key: no private record is its to see.
          propsOf([grant(Permission.ProjectMember)], null),
          // A workflow's step acts as a Project Admin, never lent its sight of private records.
          workflowStep(),
        ]) {
          expect(await readPullRequests(props)).toEqual(sorted(everyone));
        }

        for (const props of [
          member(ownerTeamMemberId),
          member(namedOwnerId),
          viewOnlyOwner(),
        ]) {
          expect(await readPullRequests(props)).toEqual(sorted(seers));
        }

        for (const props of [
          projectOwner(),
          projectAdmin(),
          propsOf([grant(Permission.ProjectAdmin)], null),
          { isRoot: true } as DatabaseCommonInteractionProps,
        ]) {
          expect(await readPullRequests(props)).toEqual(sorted(all));
        }
      });

      test("a pull request's title is read only with the pull request", async () => {
        const world: World = await seedWorld();

        await database.query(
          `UPDATE "${schema}"."AIAgentTaskPullRequest" SET "title" = 'fix: checkout outage at Acme Bank' WHERE "_id" = $1`,
          [world.prOfPrivateIncident],
        );

        const titlesFor: (
          props: DatabaseCommonInteractionProps,
        ) => Promise<Array<string>> = async (
          props: DatabaseCommonInteractionProps,
        ): Promise<Array<string>> => {
          const found: Array<BaseModel> =
            await AIAgentTaskPullRequestService.findBy({
              query: { _id: world.prOfPrivateIncident },
              select: { _id: true, title: true },
              skip: 0,
              limit: 10,
              props,
            });

          return found.map((row: BaseModel): string => {
            return String((row as unknown as { title?: string }).title);
          });
        };

        expect(await titlesFor(member(otherId))).toEqual([]);
        expect(await titlesFor(member(namedOwnerId))).toEqual([
          "fix: checkout outage at Acme Bank",
        ]);
      });
    });

    describe("the Code pages' own reads", () => {
      const scopeOf: (reader: DatabaseCommonInteractionProps) => {
        projectId: ObjectID;
        reader: DatabaseCommonInteractionProps;
        repositoryIds: Array<ObjectID>;
        includeWithoutRepository: boolean;
        isProductionReviews: boolean;
        search: string;
      } = (reader: DatabaseCommonInteractionProps) => {
        return {
          projectId,
          reader,
          repositoryIds: [repositoryId],
          includeWithoutRepository: false,
          isProductionReviews: false,
          search: "",
        };
      };

      // A repository's tasks: first turns, never a chat or a reply.
      function tasksOf(runs: Array<string>, world: World): Array<string> {
        const replies: Array<string> = [
          world.replyInPublicTask,
          world.replyInPrivateTask,
          world.replyInPrivateFixsTask,
          world.replyInGoneTask,
        ];

        return runs.filter((run: string): boolean => {
          return !replies.includes(run);
        });
      }

      test("a repository's list, its filters and counts keep to the reader's tasks", async () => {
        const world: World = await seedWorld();

        const everyone: Array<string> = tasksOf(everyonesRuns(world), world);
        const seers: Array<string> = tasksOf(
          [...everyonesRuns(world), ...privateRecordsRuns(world)],
          world,
        );
        const all: Array<string> = tasksOf(
          [
            ...everyonesRuns(world),
            ...privateRecordsRuns(world),
            ...goneRecordsRuns(world),
          ],
          world,
        );

        const pageOf: (
          reader: DatabaseCommonInteractionProps,
        ) => Promise<Array<string>> = async (
          reader: DatabaseCommonInteractionProps,
        ): Promise<Array<string>> => {
          return (
            await CodeTaskListQuery.readPage({
              ...scopeOf(reader),
              filter: CodeTaskListFilter.All,
              limit: 50,
              skip: 0,
            })
          ).sort();
        };

        expect(await pageOf(member(otherId))).toEqual([...everyone].sort());
        expect(await pageOf(member(invitedId))).toEqual([...everyone].sort());
        expect(await pageOf(viewOnlyOwner())).toEqual([...seers].sort());
        expect(await pageOf(member(namedOwnerId))).toEqual([...seers].sort());
        expect(await pageOf(projectAdmin())).toEqual([...all].sort());

        // The counts the tabs show: the same tasks.
        const countsOf: (
          reader: DatabaseCommonInteractionProps,
        ) => Promise<CodeTaskListCountsJSON> = (
          reader: DatabaseCommonInteractionProps,
        ): Promise<CodeTaskListCountsJSON> => {
          return CodeTaskListQuery.readCounts(scopeOf(reader));
        };

        expect((await countsOf(member(otherId)))[CodeTaskListFilter.All]).toBe(
          everyone.length,
        );
        expect(
          (await countsOf(member(ownerTeamMemberId)))[CodeTaskListFilter.All],
        ).toBe(seers.length);
        expect((await countsOf(projectOwner()))[CodeTaskListFilter.All]).toBe(
          all.length,
        );

        /*
         * A tab's own count: the tasks whose pull request is open - the
         * public incident's fix and the request, and for its owners the
         * private incident's fix and the private alert's fix's code too.
         */
        expect(
          (await countsOf(member(otherId)))[CodeTaskListFilter.PullRequestOpen],
        ).toBe(2);
        expect(
          (await countsOf(member(namedOwnerId)))[
            CodeTaskListFilter.PullRequestOpen
          ],
        ).toBe(4);
        expect(
          (await countsOf(projectAdmin()))[CodeTaskListFilter.PullRequestOpen],
        ).toBe(5);

        // A filtered page: the same tasks as its count.
        expect(
          (
            await CodeTaskListQuery.readPage({
              ...scopeOf(member(otherId)),
              filter: CodeTaskListFilter.PullRequestOpen,
              limit: 50,
              skip: 0,
            })
          ).sort(),
        ).toEqual([world.codeFixOfPublicIncident, world.plainTask].sort());

        // A search by a private task's number finds nothing for another member.
        await database.query(
          `UPDATE "${schema}"."AIRun" SET "taskNumber" = 4242, "title" = 'Fix the checkout outage' WHERE "_id" = $1`,
          [world.codeFixOfPrivateIncident],
        );

        for (const search of ["#4242", "checkout outage"]) {
          expect(
            await CodeTaskListQuery.readPage({
              ...scopeOf(member(otherId)),
              search,
              filter: CodeTaskListFilter.All,
              limit: 50,
              skip: 0,
            }),
          ).toEqual([]);
          expect(
            await CodeTaskListQuery.readPage({
              ...scopeOf(member(namedOwnerId)),
              search,
              filter: CodeTaskListFilter.All,
              limit: 50,
              skip: 0,
            }),
          ).toEqual([world.codeFixOfPrivateIncident]);
        }
      });

      test("a repository's totals count the reader's tasks and pull requests only", async () => {
        const world: World = await seedWorld();

        const statsOf: (
          reader: DatabaseCommonInteractionProps,
        ) => Promise<CodeRepositoryTaskStatsJSON> = async (
          reader: DatabaseCommonInteractionProps,
        ): Promise<CodeRepositoryTaskStatsJSON> => {
          return (
            await CodeTaskStats.getRepositoryStats({
              projectId,
              repositoryIds: [repositoryId],
              reader,
            })
          ).get(repositoryId.toString())!;
        };

        const other: CodeRepositoryTaskStatsJSON = await statsOf(
          member(otherId),
        );
        const owner: CodeRepositoryTaskStatsJSON =
          await statsOf(viewOnlyOwner());
        const admin: CodeRepositoryTaskStatsJSON =
          await statsOf(projectAdmin());

        expect(other.taskCount).toBe(
          tasksOf(everyonesRuns(world), world).length,
        );
        expect(owner.taskCount).toBe(
          tasksOf(
            [...everyonesRuns(world), ...privateRecordsRuns(world)],
            world,
          ).length,
        );
        expect(admin.taskCount).toBe(
          tasksOf(
            [
              ...everyonesRuns(world),
              ...privateRecordsRuns(world),
              ...goneRecordsRuns(world),
            ],
            world,
          ).length,
        );

        // The one working task is the private incident's fix.
        expect(other.working).toBe(0);
        expect(owner.working).toBe(1);

        // Open pull requests: each through the run that opened it.
        expect(other.openPullRequests).toBe(3);
        expect(owner.openPullRequests).toBe(6);
        expect(admin.openPullRequests).toBe(7);

        // The tasks with no repository: none here, for anyone.
        expect(
          await CodeTaskStats.countTasksWithoutRepository({
            projectId,
            reader: member(otherId),
          }),
        ).toBe(0);
      });

      test("a task's page opens only for those who may read it, by its own id or a reply's", async () => {
        const world: World = await seedWorld();

        const taskFor: (
          taskId: string,
          reader: DatabaseCommonInteractionProps,
        ) => Promise<string | null> = async (
          taskId: string,
          reader: DatabaseCommonInteractionProps,
        ): Promise<string | null> => {
          const task: AIRun | null = await CodeTaskThread.findTask({
            projectId,
            taskId: new ObjectID(taskId),
            readableBy: reader,
          });

          return task?._id?.toString() || null;
        };

        for (const taskId of [
          world.codeFixOfPrivateIncident,
          world.replyInPrivateTask,
          world.declaredCodeOfPrivateIncidentsFix,
          world.replyInPrivateFixsTask,
        ]) {
          expect(await taskFor(taskId, member(otherId))).toBeNull();
          expect(await taskFor(taskId, member(authorId))).toBeNull();
        }

        expect(
          await taskFor(world.replyInPrivateTask, member(namedOwnerId)),
        ).toBe(world.codeFixOfPrivateIncident);
        expect(
          await taskFor(world.replyInPrivateFixsTask, viewOnlyOwner()),
        ).toBe(world.declaredCodeOfPrivateIncidentsFix);
        expect(await taskFor(world.replyInPublicTask, member(otherId))).toBe(
          world.codeFixOfPublicIncident,
        );

        // With no reader - OneUptime's own reads, the Runner's - every one.
        expect(
          (
            await CodeTaskThread.findTask({
              projectId,
              taskId: new ObjectID(world.replyInPrivateTask),
            })
          )?._id?.toString(),
        ).toBe(world.codeFixOfPrivateIncident);
      });
    });

    describe("opening a pull request from a private record (#9106)", () => {
      async function refusalOf(
        props: DatabaseCommonInteractionProps,
        subject: { incidentId?: ObjectID; alertId?: ObjectID },
        action: string,
      ): Promise<unknown> {
        try {
          await assertReachesFixSubject({
            props,
            suggestion: subject,
            action,
          });
        } catch (error) {
          return error;
        }

        return null;
      }

      test.each([
        ["a pull request for a fix's step", OPEN_FIX_PULL_REQUEST_ACTION],
        [
          "the fix pull request of an investigation",
          OPEN_CODE_FIX_PULL_REQUEST_ACTION,
        ],
      ])(
        "%s is refused, with the reason, to a member of the owning team that may only view it",
        async (_what: string, action: string) => {
          const world: World = await seedWorld();

          for (const [subject, noun] of [
            [{ incidentId: new ObjectID(world.privateIncident) }, "incident"],
            [{ alertId: new ObjectID(world.privateAlert) }, "alert"],
          ] as Array<[{ incidentId?: ObjectID; alertId?: ObjectID }, string]>) {
            const refusal: unknown = await refusalOf(
              viewOnlyOwner(),
              subject,
              action,
            );

            expect(refusal).toBeInstanceOf(NotAuthorizedException);
            expect((refusal as Error).message).toBe(
              `You do not have permission to ${action}. This ${noun} is private, so it is changed only with the permissions of the teams that own it and of the people named as its owners, and none of them lets you do this. Ask a Project Admin to give one of the teams that own it this permission, or to add you as an owner.`,
            );
          }
        },
      );

      test("is allowed through a team that owns the record and may act on its fixes, for its named owner and for Project Owners and Admins", async () => {
        const world: World = await seedWorld();

        for (const props of [
          propsOf(
            [
              grant(Permission.Viewer, owningTeamId),
              grant(Permission.ProjectMember, owningTeamId),
            ],
            ownerTeamMemberId,
          ),
          member(namedOwnerId),
          projectOwner(),
          projectAdmin(),
        ]) {
          for (const action of [
            OPEN_FIX_PULL_REQUEST_ACTION,
            OPEN_CODE_FIX_PULL_REQUEST_ACTION,
          ]) {
            expect(
              await refusalOf(
                props,
                { incidentId: new ObjectID(world.privateIncident) },
                action,
              ),
            ).toBeNull();
          }
        }
      });

      test("a public record's pull request asks nothing more of anyone", async () => {
        const world: World = await seedWorld();

        for (const props of [viewOnlyOwner(), member(otherId)]) {
          expect(
            await refusalOf(
              props,
              { incidentId: new ObjectID(world.publicIncident) },
              OPEN_CODE_FIX_PULL_REQUEST_ACTION,
            ),
          ).toBeNull();
          expect(
            await refusalOf(
              props,
              { alertId: new ObjectID(world.publicAlert) },
              OPEN_FIX_PULL_REQUEST_ACTION,
            ),
          ).toBeNull();
        }
      });
    });
  },
);
