import Entities from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import RunnerJob from "../../../Models/DatabaseModels/RunnerJob";
import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import DatabaseService from "../../../Server/Services/DatabaseService";
import RunnerJobService from "../../../Server/Services/RunnerJobService";
import PrivateRecordPermission, {
  PrivateRecordKind,
} from "../../../Server/Types/Database/Permissions/PrivateRecordPermission";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import WorkflowPrincipal from "../../../Server/Utils/Workflow/WorkflowPrincipal";
import AIRunType from "../../../Types/AI/AIRunType";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../Types/Runbook/RunnerJobStatus";
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
 * WHAT AN AI RUN RAN AND PRINTED FOLLOWS THE RUN, ON A MIGRATED POSTGRES
 * (#9155).
 *
 * A Runner job OneUptime AI ran for one of its AI runs holds the command
 * the run ran and what it printed. RunnerJobService reads it only for those
 * who may read the run (AIRunOutputReadFilter): a chat's only for the person
 * who asked; an investigation's, or one of a run that worked out a fix, for
 * everyone; a CodeFix run's for everyone, as the run is - and, for a run
 * about a private incident or alert, only for those who see that record.
 * One of a run about a deleted record only for Project Owners and Project
 * Admins; one of a run that is gone for no one in the project. A job of a
 * runbook run or a fix still follows it (#9154).
 *
 * The unit suite (AIRunOutputReadFilter.test) holds the SQL the filter
 * writes; this one runs it, through the service, the API's list and the
 * count the AI Logs pages show of what they leave out, for every kind of
 * reader: the person who asked, another member, a pending invitee, a
 * private record's owner team and named owner, a Project Owner and a
 * Project Admin, API keys with and without Project Admin, a workflow's step
 * and someone outside the project. A find and a count always agree.
 *
 * Opt in with RUN_POSTGRES_AI_RUN_OUTPUT_TESTS=true against a database the
 * registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_AI_RUN_OUTPUT_TESTS=true \
 *   AI_RUN_OUTPUT_TEST_DATABASE_HOST=127.0.0.1 \
 *   AI_RUN_OUTPUT_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/AiRunOutputReadPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml.
 *
 * Everything runs in a uniquely named schema holding structure-only clones
 * (LIKE ... INCLUDING ALL) of the tables it writes: the jobs, the AI runs,
 * runbook runs and fixes they name, the incidents and alerts those are
 * about, their owners and the team members. The clones carry no foreign
 * keys, so a seeded row needs only its NOT NULL columns, read from the
 * migrated schema and filled in by kind. Every statement Postgres rejects is
 * recorded and fails the test, even one a caller would have caught.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_AI_RUN_OUTPUT_TESTS"] === "true"
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
  "RunnerJob",
  "RunbookExecution",
  "AutoRemediationSuggestion",
];

describePostgres(
  "what an AI run ran and printed, read on a migrated Postgres",
  () => {
    const schema: string = `ai_run_output_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();
    const owningTeamId: ObjectID = ObjectID.generate();
    const otherTeamId: ObjectID = ObjectID.generate();

    // Asked the chats, and started a CodeFix run.
    const authorId: ObjectID = ObjectID.generate();
    // Another member of the project.
    const otherId: ObjectID = ObjectID.generate();
    // An accepted member of the team that owns the private records.
    const ownerTeamMemberId: ObjectID = ObjectID.generate();
    // Invited to that team, the invitation not accepted yet.
    const invitedId: ObjectID = ObjectID.generate();
    // Named as an owner of the private records.
    const namedOwnerId: ObjectID = ObjectID.generate();
    const projectOwnerId: ObjectID = ObjectID.generate();
    const projectAdminId: ObjectID = ObjectID.generate();
    // Asked a chat none of the readers asked.
    const someoneElseId: ObjectID = ObjectID.generate();
    // A member of another project only.
    const outsiderId: ObjectID = ObjectID.generate();

    const failedQueries: FailedQueryRecorder = new FailedQueryRecorder();
    let database: DataSource;

    const required: Record<string, Array<RequiredColumn>> = {};

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host: process.env["AI_RUN_OUTPUT_TEST_DATABASE_HOST"] || "localhost",
        port: Number(process.env["AI_RUN_OUTPUT_TEST_DATABASE_PORT"] || "5400"),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["AI_RUN_OUTPUT_TEST_DATABASE_NAME"] ||
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

    // An AI run of `runType`, asked by `userId` (none: OneUptime started it).
    async function seedRun(values: {
      runType: AIRunType;
      userId?: ObjectID | undefined;
      incidentId?: string | undefined;
      alertId?: string | undefined;
    }): Promise<string> {
      return await seedRow("AIRun", {
        runType: values.runType,
        userId: values.userId ? values.userId.toString() : null,
        triggeredByIncidentId: values.incidentId || null,
        triggeredByAlertId: values.alertId || null,
      });
    }

    // A command OneUptime AI ran, with what it printed.
    async function seedJob(values: SqlRow): Promise<string> {
      return await seedRow("RunnerJob", {
        runbookExecutionId: null,
        autoRemediationSuggestionId: null,
        aiRunId: null,
        origin: RunnerJobOrigin.AiInvestigation,
        stepType: RunbookStepType.Kubectl,
        status: RunnerJobStatus.Succeeded,
        output: "NAME READY STATUS",
        ...values,
      });
    }

    function grant(permission: Permission): UserPermission {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }

    // Someone reading `tenant`, holding these permissions in `holdsIn`.
    function propsOf(
      permissions: Array<UserPermission>,
      who: ObjectID | null,
      options: {
        userType?: UserType | undefined;
        tenant?: ObjectID | undefined;
        holdsIn?: ObjectID | undefined;
      } = {},
    ): DatabaseCommonInteractionProps {
      const tenant: ObjectID = options.tenant || projectId;
      const holdsIn: ObjectID = options.holdsIn || tenant;

      return {
        ...(who ? { userId: who } : {}),
        tenantId: tenant,
        currentPlan: PlanType.Scale,
        userType: options.userType || (who ? UserType.User : UserType.API),
        userGlobalAccessPermission: {
          _type: "UserGlobalAccessPermission",
          projectIds: [holdsIn],
          globalPermissions: [Permission.User, Permission.CurrentUser],
        },
        userTenantAccessPermission: {
          [holdsIn.toString()]: {
            _type: "UserTenantAccessPermission",
            projectId: holdsIn,
            permissions,
          },
        },
      };
    }

    // A reader of the project's Runner jobs: Viewer over the whole project.
    function viewer(who: ObjectID): DatabaseCommonInteractionProps {
      return propsOf([grant(Permission.Viewer)], who);
    }

    // One who may read a job's output too: Project Member over the project.
    function member(who: ObjectID): DatabaseCommonInteractionProps {
      return propsOf([grant(Permission.ProjectMember)], who);
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

    // What `props` reads of the jobs, by a find and by a count.
    async function read(
      props: DatabaseCommonInteractionProps,
      query: SqlRow = {},
    ): Promise<Read> {
      const found: Array<BaseModel> = await RunnerJobService.findBy({
        query: { ...query },
        select: { _id: true },
        skip: 0,
        limit: 100,
        props: props,
      });
      const count: PositiveNumber = await RunnerJobService.countBy({
        query: { ...query },
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

    // The world every test reads: a job of every kind of AI run, and two that name none.
    interface World {
      // No AI run, no runbook run, no fix: a connection test.
      connectionTest: string;
      authorsChat: string;
      someoneElsesChat: string;
      chatNobodyAsked: string;
      investigationOfPublicIncident: string;
      investigationOfPrivateIncident: string;
      investigationOfPublicAlert: string;
      investigationOfPrivateAlert: string;
      // An insight's triage: about no incident or alert.
      investigationOfNothing: string;
      investigationOfDeletedIncident: string;
      authorsCodeFix: string;
      codeFixOfPublicAlert: string;
      authorsCodeFixOfPrivateIncident: string;
      fixRunsReadOfPrivateIncident: string;
      ofAGoneRun: string;
      fixCommandOfPublicIncident: string;
      fixCommandOfPrivateAlert: string;
      runbookStepOfPrivateIncident: string;
    }

    async function seedWorld(): Promise<World> {
      const publicIncident: string = await seedRecord("Incident", false);
      const privateIncident: string = await seedRecord("Incident", true);
      const publicAlert: string = await seedRecord("Alert", false);
      const privateAlert: string = await seedRecord("Alert", true);

      const jobOfRun: (
        run: Parameters<typeof seedRun>[0],
        values?: SqlRow,
      ) => Promise<string> = async (
        run: Parameters<typeof seedRun>[0],
        values: SqlRow = {},
      ): Promise<string> => {
        return await seedJob({ aiRunId: await seedRun(run), ...values });
      };

      const fixAbout: (values: SqlRow) => Promise<string> = async (
        values: SqlRow,
      ): Promise<string> => {
        return await seedRow("AutoRemediationSuggestion", {
          incidentId: null,
          alertId: null,
          ...values,
        });
      };

      return {
        connectionTest: await seedJob({}),
        authorsChat: await jobOfRun({
          runType: AIRunType.Chat,
          userId: authorId,
        }),
        someoneElsesChat: await jobOfRun({
          runType: AIRunType.Chat,
          userId: someoneElseId,
        }),
        chatNobodyAsked: await jobOfRun({ runType: AIRunType.Chat }),
        investigationOfPublicIncident: await jobOfRun({
          runType: AIRunType.Investigation,
          incidentId: publicIncident,
        }),
        investigationOfPrivateIncident: await jobOfRun({
          runType: AIRunType.Investigation,
          incidentId: privateIncident,
        }),
        investigationOfPublicAlert: await jobOfRun(
          { runType: AIRunType.Investigation, alertId: publicAlert },
          { stepType: RunbookStepType.ResourceCommand },
        ),
        investigationOfPrivateAlert: await jobOfRun(
          { runType: AIRunType.Investigation, alertId: privateAlert },
          { stepType: RunbookStepType.ResourceCommand },
        ),
        investigationOfNothing: await jobOfRun({
          runType: AIRunType.Investigation,
        }),
        investigationOfDeletedIncident: await jobOfRun({
          runType: AIRunType.Investigation,
          incidentId: ObjectID.generate().toString(),
        }),
        authorsCodeFix: await jobOfRun(
          { runType: AIRunType.CodeFix, userId: authorId },
          { stepType: RunbookStepType.Bash },
        ),
        codeFixOfPublicAlert: await jobOfRun(
          { runType: AIRunType.CodeFix, alertId: publicAlert },
          { stepType: RunbookStepType.Bash },
        ),
        authorsCodeFixOfPrivateIncident: await jobOfRun(
          {
            runType: AIRunType.CodeFix,
            userId: authorId,
            incidentId: privateIncident,
          },
          { stepType: RunbookStepType.Bash },
        ),
        fixRunsReadOfPrivateIncident: await jobOfRun({
          runType: AIRunType.RemediationExecution,
          incidentId: privateIncident,
        }),
        ofAGoneRun: await seedJob({
          aiRunId: ObjectID.generate().toString(),
        }),
        fixCommandOfPublicIncident: await jobOfRun(
          {
            runType: AIRunType.RemediationExecution,
            incidentId: publicIncident,
          },
          {
            origin: RunnerJobOrigin.AiRemediation,
            autoRemediationSuggestionId: await fixAbout({
              incidentId: publicIncident,
            }),
          },
        ),
        fixCommandOfPrivateAlert: await jobOfRun(
          { runType: AIRunType.RemediationPlan, alertId: privateAlert },
          {
            origin: RunnerJobOrigin.AiRemediation,
            autoRemediationSuggestionId: await fixAbout({
              alertId: privateAlert,
            }),
          },
        ),
        runbookStepOfPrivateIncident: await seedJob({
          origin: RunnerJobOrigin.Runbook,
          stepType: RunbookStepType.Bash,
          runbookExecutionId: await seedRow("RunbookExecution", {
            incidentId: privateIncident,
            alertId: null,
          }),
        }),
      };
    }

    // The jobs everyone who may read Runner jobs reads.
    function everyonesJobs(world: World): Array<string> {
      return [
        world.connectionTest,
        world.investigationOfPublicIncident,
        world.investigationOfPublicAlert,
        world.investigationOfNothing,
        world.authorsCodeFix,
        world.codeFixOfPublicAlert,
        world.fixCommandOfPublicIncident,
      ];
    }

    // What only those who see the private incident and alert read besides.
    function privateRecordsJobs(world: World): Array<string> {
      return [
        world.investigationOfPrivateIncident,
        world.investigationOfPrivateAlert,
        world.authorsCodeFixOfPrivateIncident,
        world.fixRunsReadOfPrivateIncident,
        world.fixCommandOfPrivateAlert,
        world.runbookStepOfPrivateIncident,
      ];
    }

    test("every kind of reader reads the jobs of the AI runs they may read, and of the private records they see", async () => {
      const world: World = await seedWorld();

      const everyone: Array<string> = everyonesJobs(world);
      const seers: Array<string> = [...everyone, ...privateRecordsJobs(world)];
      // Those who see every private record: the deleted incident's too.
      const all: Array<string> = [
        ...seers,
        world.investigationOfDeletedIncident,
      ];

      // The person who asked: their chat's, and no private record's.
      expect(await read(viewer(authorId))).toEqual(
        sorted([...everyone, world.authorsChat]),
      );

      // Another member, and someone whose invitation to the owning team waits.
      for (const props of [viewer(otherId), viewer(invitedId)]) {
        expect(await read(props)).toEqual(sorted(everyone));
      }

      // The private records' owners: their team's member and the person named.
      for (const props of [viewer(ownerTeamMemberId), viewer(namedOwnerId)]) {
        expect(await read(props)).toEqual(sorted(seers));
      }

      // Project Owners and Admins: every private record, no one else's chat.
      for (const props of [
        propsOf([grant(Permission.ProjectOwner)], projectOwnerId),
        propsOf([grant(Permission.ProjectAdmin)], projectAdminId),
      ]) {
        expect(await read(props)).toEqual(sorted(all));
      }

      // An API key: no chat, as no person asked; private ones with Project Admin only.
      expect(await read(propsOf([grant(Permission.Viewer)], null))).toEqual(
        sorted(everyone),
      );
      expect(
        await read(propsOf([grant(Permission.ProjectAdmin)], null)),
      ).toEqual(sorted(all));

      // A workflow's step acts as a Project Admin, never lent its sight of private records.
      expect(await read(workflowStep())).toEqual(sorted(everyone));

      // OneUptime itself reads every job, a chat's and a gone run's included.
      expect(await read({ isRoot: true })).toEqual(
        sorted([
          ...all,
          world.authorsChat,
          world.someoneElsesChat,
          world.chatNobodyAsked,
          world.ofAGoneRun,
        ]),
      );
    });

    test("someone outside the project reads none of its jobs", async () => {
      const world: World = await seedWorld();

      // Reading their own project: its jobs, none of these.
      expect(
        await read(
          propsOf([grant(Permission.ProjectOwner)], outsiderId, {
            tenant: otherProjectId,
          }),
        ),
      ).toEqual(sorted([]));

      // Naming this project, where they hold no permission: refused.
      let refusal: unknown = null;

      try {
        await read(
          propsOf([grant(Permission.ProjectOwner)], outsiderId, {
            tenant: projectId,
            holdsIn: otherProjectId,
          }),
        );
      } catch (error) {
        refusal = error;
      }

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect(world.authorsChat).toBeTruthy();
    });

    test("a reader's own filters, and a sort, stay beside the rule", async () => {
      const world: World = await seedWorld();

      const authorsChatRun: string = (
        (await database.query(
          `SELECT "aiRunId" FROM "${schema}"."RunnerJob" WHERE "_id" = $1`,
          [world.authorsChat],
        )) as Array<{ aiRunId: string }>
      )[0]!.aiRunId;

      const ofTheRun: SqlRow = { aiRunId: new ObjectID(authorsChatRun) };

      // Asked for the chat's commands by its run: the person who asked reads them.
      expect(await read(viewer(authorId), ofTheRun)).toEqual(
        sorted([world.authorsChat]),
      );

      // Anyone else asking for them by name reads nothing, a Project Owner included.
      for (const props of [
        viewer(otherId),
        propsOf([grant(Permission.ProjectOwner)], projectOwnerId),
        propsOf([grant(Permission.ProjectAdmin)], null),
      ]) {
        expect(await read(props, ofTheRun)).toEqual(sorted([]));
      }

      // A filter on another column keeps to the jobs the reader may read.
      expect(
        await read(viewer(otherId), {
          stepType: RunbookStepType.ResourceCommand,
        }),
      ).toEqual(sorted([world.investigationOfPublicAlert]));
      expect(
        await read(viewer(ownerTeamMemberId), {
          stepType: RunbookStepType.ResourceCommand,
        }),
      ).toEqual(
        sorted([
          world.investigationOfPublicAlert,
          world.investigationOfPrivateAlert,
        ]),
      );

      // Sorted newest first, as the AI Logs pages list them: the same jobs.
      const newestFirst: Array<BaseModel> = await RunnerJobService.findBy({
        query: {},
        select: { _id: true, createdAt: true },
        sort: { createdAt: SortOrder.Descending },
        skip: 0,
        limit: 100,
        props: viewer(otherId),
      });

      expect(
        newestFirst
          .map((job: BaseModel): string => {
            return job._id!.toString();
          })
          .sort(),
      ).toEqual(sorted(everyonesJobs(world)).ids);
    });

    test("a job's command and what it printed are read only with the job", async () => {
      const world: World = await seedWorld();

      await database.query(
        `UPDATE "${schema}"."RunnerJob" SET "output" = 'secret output', "payload" = '{"displayCommand":"kubectl get secrets"}' WHERE "_id" = $1`,
        [world.authorsChat],
      );

      const outputOf: (
        props: DatabaseCommonInteractionProps,
      ) => Promise<Array<string>> = async (
        props: DatabaseCommonInteractionProps,
      ): Promise<Array<string>> => {
        const jobs: Array<RunnerJob> = await RunnerJobService.findBy({
          query: { _id: world.authorsChat },
          select: { _id: true, output: true, payload: true },
          skip: 0,
          limit: 10,
          props: props,
        });

        return jobs.map((job: RunnerJob): string => {
          return `${String(job.output)} ${JSON.stringify(job.payload)}`;
        });
      };

      expect(await outputOf(member(authorId))).toEqual([
        'secret output {"displayCommand":"kubectl get secrets"}',
      ]);

      for (const props of [
        member(otherId),
        member(ownerTeamMemberId),
        propsOf([grant(Permission.ProjectOwner)], projectOwnerId),
        propsOf([grant(Permission.ProjectAdmin)], null),
        workflowStep(),
      ]) {
        expect(await outputOf(props)).toEqual([]);
      }

      // Read by its id, through the service's own lookup: nothing either.
      expect(
        await RunnerJobService.findOneById({
          id: new ObjectID(world.authorsChat),
          select: { _id: true, output: true },
          props: member(otherId),
        }),
      ).toBeNull();
    });

    test("the API's list of Runner jobs leaves out what the reader may not read, and counts the same", async () => {
      const world: World = await seedWorld();

      const api: BaseAPI<BaseModel, DatabaseService<BaseModel>> = new BaseAPI(
        RunnerJob as unknown as { new (): BaseModel },
        RunnerJobService as unknown as DatabaseService<BaseModel>,
      );

      const listOf: (
        props: DatabaseCommonInteractionProps,
      ) => Promise<{ ids: Array<string>; count: number }> = async (
        props: DatabaseCommonInteractionProps,
      ): Promise<{ ids: Array<string>; count: number }> => {
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
                query: JSONFunctions.serialize({}),
                select: JSONFunctions.serialize({ _id: true, output: true }),
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

      expect(await listOf(member(authorId))).toEqual(
        sorted([...everyonesJobs(world), world.authorsChat]),
      );
      expect(await listOf(member(otherId))).toEqual(
        sorted(everyonesJobs(world)),
      );
      expect(await listOf(member(namedOwnerId))).toEqual(
        sorted([...everyonesJobs(world), ...privateRecordsJobs(world)]),
      );
      expect(
        await listOf(propsOf([grant(Permission.ProjectMember)], null)),
      ).toEqual(sorted(everyonesJobs(world)));
    });

    test("the AI Logs pages count the commands they leave out, and only those", async () => {
      const world: World = await seedWorld();
      const clusterId: string = ObjectID.generate().toString();

      // The kubectl commands that ran on one cluster.
      await database.query(
        `UPDATE "${schema}"."RunnerJob" SET "kubernetesClusterId" = $1 WHERE "stepType" = $2`,
        [clusterId, RunbookStepType.Kubectl],
      );

      const onTheCluster: SqlRow = {
        projectId: projectId,
        kubernetesClusterId: new ObjectID(clusterId),
        stepType: RunbookStepType.Kubectl,
      };

      const kubectlJobs: Array<{ _id: string }> = await database.query(
        `SELECT "_id" FROM "${schema}"."RunnerJob" WHERE "kubernetesClusterId" = $1`,
        [clusterId],
      );

      const hiddenFrom: (
        props: DatabaseCommonInteractionProps,
      ) => Promise<number | null> = async (
        props: DatabaseCommonInteractionProps,
      ): Promise<number | null> => {
        return await RunnerJobService.countJobsHiddenFrom({
          query: onTheCluster as never,
          props: props,
        });
      };

      for (const props of [
        viewer(authorId),
        viewer(otherId),
        viewer(namedOwnerId),
        propsOf([grant(Permission.ProjectOwner)], projectOwnerId),
        propsOf([grant(Permission.Viewer)], null),
      ]) {
        const listed: Read = await read(props, onTheCluster);

        expect(await hiddenFrom(props)).toBe(kubectlJobs.length - listed.count);
      }

      // Another member: the chats', the private records' and the deleted one's, and the gone run's.
      expect(await hiddenFrom(viewer(otherId))).toBe(
        [
          world.authorsChat,
          world.someoneElsesChat,
          world.chatNobodyAsked,
          world.investigationOfPrivateIncident,
          world.investigationOfDeletedIncident,
          world.fixRunsReadOfPrivateIncident,
          world.fixCommandOfPrivateAlert,
          world.ofAGoneRun,
        ].length,
      );

      // A Project Owner: only the chats nobody of theirs asked, and the gone run's.
      expect(
        await hiddenFrom(
          propsOf([grant(Permission.ProjectOwner)], projectOwnerId),
        ),
      ).toBe(4);

      // Someone who may not read Runner jobs at all: the page says so on its own.
      expect(
        await hiddenFrom(
          propsOf([grant(Permission.ReadKubernetesCluster)], otherId),
        ),
      ).toBeNull();

      // Its two counts left the query it was given as it was.
      expect(Object.keys(onTheCluster).sort()).toEqual([
        "kubernetesClusterId",
        "projectId",
        "stepType",
      ]);
    });
  },
);
