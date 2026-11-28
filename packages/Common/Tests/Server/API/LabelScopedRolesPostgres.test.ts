/*
 * Must stay the first import: the Dashboard's client builds its API URL from
 * HOST when UI/Config loads. `npm run test` exports HOST from config.env, and
 * the Postgres Schema Drift job, which runs this suite, has no config.env.
 */
import "../../UI/Utils/API/DashboardHost";
import BaseAPI from "../../../Server/API/BaseAPI";
import MonitorAPI from "../../../Server/API/MonitorAPI";
import RunnerAPI from "../../../Server/API/RunnerAPI";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import AuditLogService from "../../../Server/Services/AuditLogService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import MonitorService from "../../../Server/Services/MonitorService";
import ProjectService from "../../../Server/Services/ProjectService";
import RunnerService from "../../../Server/Services/RunnerService";
import UserService from "../../../Server/Services/UserService";
import WorkflowService from "../../../Server/Services/WorkflowService";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Entities from "../../../Models/DatabaseModels/Index";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Runner from "../../../Models/DatabaseModels/Runner";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../Types/Dictionary";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import API from "../../../UI/Utils/API/API";
import ModelAPI, { ListResult } from "../../../UI/Utils/ModelAPI/ModelAPI";
import { getJestSpyOn } from "../../Spy";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../TestingUtils/DashboardRequestsOverHttp";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import express from "express";
import { DataSource } from "typeorm";

/*
 * THE CUSTOMER'S ROLES, OVER HTTP, AGAINST A MIGRATED POSTGRES (#11259).
 *
 * A team held Viewer over the whole project and Project Member on the
 * monitors labelled Production; its member was on no other team. Monitor A
 * carries the label, monitor B carries none. Opening B said "This monitor
 * could not be found": the Dashboard asks for a monitor's secret keys
 * whenever the reader holds a role that may read them, and selecting a
 * column read only on some labels narrowed the whole read to those labels.
 * Removing the Project Member role made B open read-only - a permission had
 * taken away what the reader could read. B's Delete was refused only after
 * the confirmation, " You do not have permission to delete Monitor without
 * any labels." The same narrowing hid the unlabelled runners from a Runbook
 * Admin on one label, and a workflow from a Workflow Admin on one.
 *
 * Here the Dashboard's own requests (ModelAPI) go over HTTP
 * (DashboardRequestsOverHttp) through the real user middleware - which
 * reads the reader's team, its permission rows, labels and scopes from the
 * tables below - the real APIs (MonitorAPI, RunnerAPI, BaseAPI), the
 * permission layer and TypeORM:
 *
 *   - B opens, read with its name, its type and every other column the
 *     reader reads on it, its secret keys left out; A opens with its keys;
 *   - the Monitors list holds both monitors, the keys on A alone; the
 *     Runners list holds both runners, the key on the labelled one alone;
 *     both workflows open, the webhook key on the labelled one alone;
 *   - a filter on B's key, or a search across the keys, finds nothing - a
 *     match would say what B's key holds - and an order by a key is refused;
 *   - B's Delete is refused, in words that start with no space, and B is
 *     still there; A is one the reader may delete;
 *   - with Viewer alone the same reads that leave out the keys open B, as
 *     they always did.
 *
 * Opt in with RUN_POSTGRES_LABEL_SCOPED_ROLES_TESTS=true against a database
 * the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_LABEL_SCOPED_ROLES_TESTS=true \
 *   LABEL_SCOPED_ROLES_TEST_DATABASE_HOST=127.0.0.1 \
 *   LABEL_SCOPED_ROLES_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/API/LabelScopedRolesPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. The tables it
 * writes are copied from public into a uniquely named schema that is
 * dropped afterwards; every row is synthetic. Workflows, live updates and
 * the audit log are stubbed.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_LABEL_SCOPED_ROLES_TESTS"] === "true"
    ? describe
    : describe.skip;

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

jest.mock("isolated-vm", () => {
  return {};
});

jest.setTimeout(10 * 60 * 1000);

// The tables this suite writes; every other table is read from public.
const TABLES: Array<string> = [
  "User",
  "Project",
  "Team",
  "TeamMember",
  "TeamPermission",
  "TeamPermissionLabel",
  "Label",
  "Monitor",
  "MonitorLabel",
  "MonitorOwnerUser",
  "MonitorOwnerTeam",
  "Runner",
  "RunnerLabel",
  "RunnerOwnerUser",
  "RunnerOwnerTeam",
  "Workflow",
  "WorkflowLabel",
  "WorkflowOwnerUser",
  "WorkflowOwnerTeam",
];

interface PermissionRow {
  permission: Permission;
  scope: PermissionScope;
  labelIds?: Array<ObjectID>;
}

// The columns the monitor's pages ask for when the reader may read them.
const MONITOR_CREDENTIALS: Array<string> = [
  "serverMonitorSecretKey",
  "incomingRequestSecretKey",
  "incomingEmailSecretKey",
  "incomingEmailCustomLocalPart",
];

describePostgres(
  "a Viewer who is a Project Member on one label, against the real rule on Postgres",
  () => {
    const schema: string = `label_scoped_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    let database: DataSource;
    let server: DashboardRequestsOverHttp;

    const projectId: ObjectID = ObjectID.generate();
    const readerId: ObjectID = ObjectID.generate();
    const teamId: ObjectID = ObjectID.generate();
    const productionLabelId: ObjectID = ObjectID.generate();

    const monitorAId: ObjectID = ObjectID.generate();
    const monitorBId: ObjectID = ObjectID.generate();
    const monitorAKey: string = ObjectID.generate().toString();
    const monitorBKey: string = ObjectID.generate().toString();

    const runner1Id: ObjectID = ObjectID.generate();
    const runner2Id: ObjectID = ObjectID.generate();

    const workflow1Id: ObjectID = ObjectID.generate();
    const workflow2Id: ObjectID = ObjectID.generate();

    const insert: (
      table: string,
      row: Dictionary<unknown>,
    ) => Promise<void> = async (
      table: string,
      row: Dictionary<unknown>,
    ): Promise<void> => {
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
          return value instanceof ObjectID ? value.toString() : value;
        }),
      );
    };

    const countRows: (
      table: string,
      where: string,
      values: Array<unknown>,
    ) => Promise<number> = async (
      table: string,
      where: string,
      values: Array<unknown>,
    ): Promise<number> => {
      const rows: Array<{ count: string }> = await database.query(
        `SELECT COUNT(*) AS "count" FROM "${schema}"."${table}" WHERE ${where}`,
        values,
      );

      return Number(rows[0]?.count || 0);
    };

    // The reader's team's permission rows, replaced.
    const setTeamPermissions: (
      rows: Array<PermissionRow>,
    ) => Promise<void> = async (rows: Array<PermissionRow>): Promise<void> => {
      await database.query(
        `DELETE FROM "${schema}"."TeamPermissionLabel" WHERE "teamPermissionId" IN (SELECT "_id" FROM "${schema}"."TeamPermission" WHERE "teamId" = $1)`,
        [teamId.toString()],
      );
      await database.query(
        `DELETE FROM "${schema}"."TeamPermission" WHERE "teamId" = $1`,
        [teamId.toString()],
      );

      for (const row of rows) {
        const id: ObjectID = ObjectID.generate();

        await insert("TeamPermission", {
          _id: id,
          projectId: projectId,
          teamId: teamId,
          permission: row.permission,
          isBlockPermission: false,
          scope: row.scope,
          version: 1,
        });

        for (const labelId of row.labelIds || []) {
          await insert("TeamPermissionLabel", {
            teamPermissionId: id,
            labelId: labelId,
          });
        }
      }
    };

    // The customer's team, exactly.
    const CUSTOMER: Array<PermissionRow> = [
      { permission: Permission.Viewer, scope: PermissionScope.All },
      {
        permission: Permission.ProjectMember,
        scope: PermissionScope.Labels,
        labelIds: [productionLabelId],
      },
    ];

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["LABEL_SCOPED_ROLES_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["LABEL_SCOPED_ROLES_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["LABEL_SCOPED_ROLES_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
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

      // The session token names the reader; it is not a signed token here.
      getJestSpyOn(JSONWebToken, "decode").mockImplementation(((
        token: string,
      ): JSONWebTokenData => {
        return {
          userId: new ObjectID(token),
          isMasterAdmin: false,
          isGlobalLogin: true,
        } as JSONWebTokenData;
      }) as never);

      // Permissions are read from the tables every time: nothing is cached.
      getJestSpyOn(GlobalCache, "getJSONObject").mockResolvedValue(
        null as never,
      );
      getJestSpyOn(GlobalCache, "setJSON").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(GlobalCache, "deleteKey").mockResolvedValue(
        undefined as never,
      );

      getJestSpyOn(UserService, "isUserBlocked").mockResolvedValue(
        false as never,
      );
      getJestSpyOn(UserService, "updateLastActive").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(ProjectService, "updateLastActive").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(ProjectService, "getRequireSsoForLogin").mockResolvedValue(
        false as never,
      );
      getJestSpyOn(ProjectService, "isProjectBlocked").mockResolvedValue(
        false as never,
      );
      getJestSpyOn(
        GlobalConfigService,
        "getRequireSsoForLogin",
      ).mockResolvedValue(false as never);

      // Workflows, live updates and the audit log run elsewhere.
      getJestSpyOn(
        DatabaseService.prototype,
        "onTriggerWorkflow",
      ).mockResolvedValue(undefined as never);
      getJestSpyOn(
        DatabaseService.prototype,
        "onTriggerRealtime",
      ).mockResolvedValue(undefined as never);

      for (const service of [
        MonitorService,
        RunnerService,
        WorkflowService,
      ] as Array<DatabaseService<BaseModel>>) {
        getJestSpyOn(service, "onTriggerWorkflow").mockResolvedValue(
          undefined as never,
        );
        getJestSpyOn(service, "onTriggerRealtime").mockResolvedValue(
          undefined as never,
        );
      }

      getJestSpyOn(AuditLogService, "recordCreate").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(AuditLogService, "recordUpdate").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(AuditLogService, "recordDelete").mockResolvedValue(
        undefined as never,
      );

      // The Dashboard's requests carry the reader's project...
      getJestSpyOn(ModelAPI, "getCommonHeaders").mockReturnValue({
        tenantid: projectId.toString(),
      } as never);

      await insert("Project", {
        _id: projectId,
        name: "Acme Commerce",
        slug: projectId.toString(),
        version: 1,
      });

      await insert("User", {
        _id: readerId,
        name: "Ana Lima",
        email: `${readerId.toString()}@example.com`,
        slug: readerId.toString(),
        version: 1,
      });

      // The reader is on this one team, and on no other.
      await insert("Team", {
        _id: teamId,
        projectId: projectId,
        name: "Support",
        slug: teamId.toString(),
        version: 1,
      });
      await insert("TeamMember", {
        _id: ObjectID.generate(),
        projectId: projectId,
        teamId: teamId,
        userId: readerId,
        hasAcceptedInvitation: true,
        version: 1,
      });

      await insert("Label", {
        _id: productionLabelId,
        projectId: projectId,
        name: "Production",
        slug: productionLabelId.toString(),
        color: "#000000",
        version: 1,
      });

      for (const [id, name, key, labelled] of [
        [monitorAId, "Website A", monitorAKey, true],
        [monitorBId, "Website B", monitorBKey, false],
      ] as Array<[ObjectID, string, string, boolean]>) {
        await insert("Monitor", {
          _id: id,
          projectId: projectId,
          name: name,
          slug: id.toString(),
          monitorType: MonitorType.Server,
          currentMonitorStatusId: ObjectID.generate(),
          serverMonitorSecretKey: key,
          version: 1,
        });

        if (labelled) {
          await insert("MonitorLabel", {
            monitorId: id,
            labelId: productionLabelId,
          });
        }
      }

      for (const [id, name, labelled] of [
        [runner1Id, "Runner One", true],
        [runner2Id, "Runner Two", false],
      ] as Array<[ObjectID, string, boolean]>) {
        await insert("Runner", {
          _id: id,
          projectId: projectId,
          name: name,
          slug: id.toString(),
          key: `${name.replace(/\s/g, "-").toLowerCase()}-key`,
          version: 1,
        });

        if (labelled) {
          await insert("RunnerLabel", {
            runnerId: id,
            labelId: productionLabelId,
          });
        }
      }

      for (const [id, name, labelled] of [
        [workflow1Id, "Deploy Hook", true],
        [workflow2Id, "Nightly Report", false],
      ] as Array<[ObjectID, string, boolean]>) {
        await insert("Workflow", {
          _id: id,
          projectId: projectId,
          name: name,
          slug: id.toString(),
          webhookSecretKey: ObjectID.generate().toString(),
          version: 1,
        });

        if (labelled) {
          await insert("WorkflowLabel", {
            workflowId: id,
            labelId: productionLabelId,
          });
        }
      }

      /*
       * ...and their session: the reader's, as the browser's cookie carries
       * it, set as each request arrives, before the user middleware reads it.
       */
      const session: ExpressRouter =
        express.Router() as unknown as ExpressRouter;

      session.use(
        (req: ExpressRequest, _res: ExpressResponse, next: NextFunction) => {
          req.headers["authorization"] = `Bearer ${readerId.toString()}`;
          req.headers["tenantid"] = projectId.toString();
          next();
        },
      );

      server = new DashboardRequestsOverHttp();
      await server.start([
        session,
        new MonitorAPI().getRouter(),
        new RunnerAPI().getRouter(),
        new BaseAPI<Workflow, DatabaseService<BaseModel>>(
          Workflow,
          WorkflowService as unknown as DatabaseService<BaseModel>,
        ).getRouter(),
      ]);
    });

    beforeEach(async () => {
      server.requests.length = 0;
      await setTeamPermissions(CUSTOMER);
    });

    afterAll(async () => {
      await server?.stop();
      jest.restoreAllMocks();

      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    // The monitor's pages' select, with every credential the reader may read.
    const monitorPageSelect: () => Dictionary<boolean> =
      (): Dictionary<boolean> => {
        return {
          name: true,
          monitorType: true,
          ...Object.fromEntries(
            MONITOR_CREDENTIALS.map((column: string): [string, boolean] => {
              return [column, true];
            }),
          ),
        };
      };

    const lastRequest: () => SentRequest = (): SentRequest => {
      return server.requests[server.requests.length - 1]!;
    };

    // The reader's props, read from the tables as a request's are.
    const readerProps: () => Promise<DatabaseCommonInteractionProps> =
      async (): Promise<DatabaseCommonInteractionProps> => {
        return await AccessTokenService.getDatabaseCommonInteractionPropsByUserAndProject(
          { userId: readerId, projectId: projectId },
        );
      };

    // The refusal the Dashboard would show, or "" for none.
    const refusalOf: (
      action: () => Promise<unknown>,
    ) => Promise<string> = async (
      action: () => Promise<unknown>,
    ): Promise<string> => {
      try {
        await action();
        return "";
      } catch (error) {
        return error instanceof HTTPErrorResponse
          ? API.getFriendlyMessage(error)
          : String((error as Error)?.message || error);
      }
    };

    describe("reads: holding Project Member takes nothing away", () => {
      test("monitor B opens, read-only, without its secret keys", async () => {
        const monitor: Monitor | null = await ModelAPI.getItem<Monitor>({
          modelType: Monitor,
          id: monitorBId,
          select: monitorPageSelect() as never,
        });

        expect(lastRequest().status).toBe(200);
        expect(monitor).not.toBeNull();
        expect(monitor!.name).toBe("Website B");
        expect(monitor!.monitorType).toBe(MonitorType.Server);
        expect(monitor!.serverMonitorSecretKey).toBeFalsy();
      });

      test("monitor A opens with its key: it carries the label", async () => {
        const monitor: Monitor | null = await ModelAPI.getItem<Monitor>({
          modelType: Monitor,
          id: monitorAId,
          select: monitorPageSelect() as never,
        });

        expect(monitor).not.toBeNull();
        expect(monitor!.serverMonitorSecretKey?.toString()).toBe(monitorAKey);
      });

      test("the Monitors list holds both monitors, the key on A alone", async () => {
        const list: ListResult<Monitor> = await ModelAPI.getList<Monitor>({
          modelType: Monitor,
          query: {},
          select: { name: true, serverMonitorSecretKey: true } as never,
          sort: { name: SortOrder.Ascending } as never,
          skip: 0,
          limit: 10,
        });

        expect(
          list.data.map((monitor: Monitor) => {
            return [monitor.name, monitor.serverMonitorSecretKey?.toString()];
          }),
        ).toEqual([
          ["Website A", monitorAKey],
          ["Website B", undefined],
        ]);
        expect(list.count).toBe(2);
      });

      test("the Runners list holds both runners, the key on the labelled one alone", async () => {
        await setTeamPermissions([
          { permission: Permission.Viewer, scope: PermissionScope.All },
          {
            permission: Permission.RunbookAdmin,
            scope: PermissionScope.Labels,
            labelIds: [productionLabelId],
          },
        ]);

        const list: ListResult<Runner> = await ModelAPI.getList<Runner>({
          modelType: Runner,
          query: {},
          select: { name: true, key: true } as never,
          sort: { name: SortOrder.Ascending } as never,
          skip: 0,
          limit: 10,
        });

        expect(
          list.data.map((runner: Runner) => {
            return [runner.name, runner.key];
          }),
        ).toEqual([
          ["Runner One", "runner-one-key"],
          ["Runner Two", undefined],
        ]);
      });

      test("both workflows open for a Workflow Admin on the label, the webhook key on the labelled one alone", async () => {
        await setTeamPermissions([
          { permission: Permission.Viewer, scope: PermissionScope.All },
          {
            permission: Permission.WorkflowAdmin,
            scope: PermissionScope.Labels,
            labelIds: [productionLabelId],
          },
        ]);

        const labelled: Workflow | null = await ModelAPI.getItem<Workflow>({
          modelType: Workflow,
          id: workflow1Id,
          select: { name: true, webhookSecretKey: true } as never,
        });
        const unlabelled: Workflow | null = await ModelAPI.getItem<Workflow>({
          modelType: Workflow,
          id: workflow2Id,
          select: { name: true, webhookSecretKey: true } as never,
        });

        expect(labelled?.webhookSecretKey).toBeTruthy();
        expect(unlabelled).not.toBeNull();
        expect(unlabelled!.name).toBe("Nightly Report");
        expect(unlabelled!.webhookSecretKey).toBeFalsy();
      });

      test("with Viewer alone, B opens as it always did, read without the keys", async () => {
        await setTeamPermissions([
          { permission: Permission.Viewer, scope: PermissionScope.All },
        ]);

        const monitor: Monitor | null = await ModelAPI.getItem<Monitor>({
          modelType: Monitor,
          id: monitorBId,
          select: { name: true, monitorType: true } as never,
        });

        expect(monitor?.name).toBe("Website B");

        // Asking for a key the reader may not read at all is refused, as before.
        expect(
          await refusalOf(async () => {
            await ModelAPI.getItem<Monitor>({
              modelType: Monitor,
              id: monitorBId,
              select: monitorPageSelect() as never,
            });
          }),
        ).not.toBe("");
      });
    });

    describe("what the key holds is read no other way", () => {
      test("a filter on B's key finds nothing", async () => {
        const list: ListResult<Monitor> = await ModelAPI.getList<Monitor>({
          modelType: Monitor,
          query: { serverMonitorSecretKey: monitorBKey } as never,
          select: { name: true } as never,
          sort: {} as never,
          skip: 0,
          limit: 10,
        });

        expect(list.data).toEqual([]);
      });

      test("a filter on A's key finds A", async () => {
        const list: ListResult<Monitor> = await ModelAPI.getList<Monitor>({
          modelType: Monitor,
          query: { serverMonitorSecretKey: monitorAKey } as never,
          select: { name: true } as never,
          sort: {} as never,
          skip: 0,
          limit: 10,
        });

        expect(
          list.data.map((monitor: Monitor) => {
            return monitor.name;
          }),
        ).toEqual(["Website A"]);
      });

      test("an order by a key is refused, saying why", async () => {
        const refusal: string = await refusalOf(async () => {
          await ModelAPI.getList<Monitor>({
            modelType: Monitor,
            query: {},
            select: { name: true } as never,
            sort: { serverMonitorSecretKey: SortOrder.Ascending } as never,
            skip: 0,
            limit: 10,
          });
        });

        expect(refusal).toContain("you cannot sort Monitors by it");
      });
    });

    describe("changes: refused where the role does not reach, and only there", () => {
      test("B's delete is refused, in words that start with no space, and B is still there", async () => {
        const refusal: string = await refusalOf(async () => {
          await ModelAPI.deleteItem<Monitor>({
            modelType: Monitor,
            id: monitorBId,
          });
        });

        expect(refusal).toBe(
          "You do not have permission to delete Monitor without any labels.",
        );
        expect(
          await countRows("Monitor", '"_id" = $1 AND "deletedAt" IS NULL', [
            monitorBId.toString(),
          ]),
        ).toBe(1);
      });

      test("A, labelled Production, is one the reader may delete and change", async () => {
        const deletable: Monitor | null =
          await MonitorService.findOneDeletableById({
            id: monitorAId,
            select: { _id: true },
            props: await readerProps(),
          });
        const updatable: Monitor | null =
          await MonitorService.findOneUpdatableById({
            id: monitorAId,
            select: { _id: true },
            props: await readerProps(),
          });

        expect(deletable?._id?.toString()).toBe(monitorAId.toString());
        expect(updatable?._id?.toString()).toBe(monitorAId.toString());
      });
    });
  },
);
