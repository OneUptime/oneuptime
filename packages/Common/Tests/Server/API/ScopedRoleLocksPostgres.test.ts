/*
 * Must stay the first import: the Dashboard's client builds its API URL from
 * HOST when UI/Config loads. `npm run test` exports HOST from config.env, and
 * the Postgres Schema Drift job, which runs this suite, has no config.env.
 */
import "../../UI/Utils/API/DashboardHost";
import CommonAPI from "../../../Server/API/CommonAPI";
import MonitorAPI from "../../../Server/API/MonitorAPI";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AuditLogService from "../../../Server/Services/AuditLogService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import MonitorOwnerTeamService from "../../../Server/Services/MonitorOwnerTeamService";
import MonitorOwnerUserService from "../../../Server/Services/MonitorOwnerUserService";
import MonitorProbeService from "../../../Server/Services/MonitorProbeService";
import MonitorService from "../../../Server/Services/MonitorService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
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
import MonitorOwnerTeam from "../../../Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "../../../Models/DatabaseModels/MonitorOwnerUser";
import MonitorProbe from "../../../Models/DatabaseModels/MonitorProbe";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../Types/Dictionary";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import { LabelVerdict } from "../../../Types/LabelAccess/LabelAccess";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { RecordOwnershipResult } from "../../../Types/RecordAccess/RecordOwnership";
import ModelAPI, { ListResult } from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, { ModelAction } from "../../../UI/Utils/PermissionGate";
import RecordLocks, {
  ModelLabelLock,
  ModelPartLock,
  ModelRecordLock,
  RecordOwnershipFacts,
} from "../../../UI/Utils/RecordLocks";
import {
  getRecordOwnershipFacts,
  readRecordOwnership,
} from "../../../UI/Utils/RecordOwnershipRead";
import { getRecordLabelIds } from "../../../UI/Utils/RecordLabelLock";
import { getJestSpyOn } from "../../Spy";
import { showProjectInTab } from "../../Helpers/TabProjectPermissions";
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
 * THE DASHBOARD'S LOCKS HELD TO THE SERVER'S ANSWERS, ON A MIGRATED POSTGRES
 * (#11435, #11436).
 *
 * A role scoped to Owned - or a grant limited to labels with one scoped to
 * Owned beside it - reaches only the records the person or the grant's team
 * owns, and a record's parts (its owners, its probes) carry its labels and
 * its owners. The Dashboard offered Edit, Delete, Add owner and Remove where
 * the server refused them. It now locks them by the shared rule
 * (Types/LabelAccess.weighRecord), from the permission snapshot the server
 * sends on every answer and from who owns each record, which it reads from
 * the server's own Owned scope (POST /monitor/record-ownership).
 *
 * Here the Dashboard's side is the Dashboard's own code - its API client
 * over HTTP (DashboardRequestsOverHttp), the snapshot its permission headers
 * leave, PermissionGate and the ownership read - and the server's side is
 * the server's own decision, made with the props its user middleware builds
 * from the tables below: whether a change or a delete of each record finds
 * it (findOneUpdatableById, findOneDeletableById, as the record-access
 * route asks), and whether a new owner or probe of it may be created
 * (checkCallerMayCreate). For every role set, every monitor and every
 * operation:
 *
 *   - the monitor's update and delete, and its owners' add and remove, are
 *     decided by the two alike - the Dashboard locks exactly what the server
 *     refuses;
 *   - a probe names its own probe, which carries labels of its own, so the
 *     Dashboard decides a probe's add and remove by the monitor's blocks and
 *     owners alone: it never locks what the server allows;
 *   - the Dashboard as it was (its own permissions, and a record's labels for
 *     the record alone) offered changes the server refused - each one listed.
 *
 * Opt in with RUN_POSTGRES_SCOPED_ROLE_LOCKS_TESTS=true against a database
 * the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_SCOPED_ROLE_LOCKS_TESTS=true \
 *   SCOPED_ROLE_LOCKS_TEST_DATABASE_HOST=127.0.0.1 \
 *   SCOPED_ROLE_LOCKS_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/API/ScopedRoleLocksPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. The tables it
 * writes are copied from public into a uniquely named schema that is
 * dropped afterwards; every row is synthetic. Workflows, live updates and
 * the audit log are stubbed.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_SCOPED_ROLE_LOCKS_TESTS"] === "true"
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

jest.setTimeout(20 * 60 * 1000);

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
  "Probe",
  "ProbeLabel",
  "ProbeOwnerUser",
  "ProbeOwnerTeam",
  "MonitorProbe",
];

interface PermissionRow {
  team: "Support" | "Ops";
  permission: Permission;
  scope?: PermissionScope | undefined;
  labelIds?: Array<ObjectID> | undefined;
  isBlock?: boolean | undefined;
}

// What a role set is called, and the reader's teams' rows.
type RoleSet = [string, Array<PermissionRow>];

// A monitor, the label it carries (if any), and who owns it.
interface Fixture {
  id: ObjectID;
  name: string;
  isLabelled: boolean;
  ownedBy: "reader" | "Support" | "Ops" | "Elsewhere" | null;
  // The owner rows of someone else, which a remove is asked about.
  otherOwnerUserRowId: ObjectID;
  otherOwnerTeamRowId: ObjectID;
  probeRowId: ObjectID;
}

// The operations decided on each monitor, by the model that is written.
type Asked =
  | "Monitor update"
  | "Monitor delete"
  | "Owner (person) add"
  | "Owner (person) remove"
  | "Owner (team) add"
  | "Owner (team) remove"
  | "Probe add"
  | "Probe remove";

const ASKED: Array<Asked> = [
  "Monitor update",
  "Monitor delete",
  "Owner (person) add",
  "Owner (person) remove",
  "Owner (team) add",
  "Owner (team) remove",
  "Probe add",
  "Probe remove",
];

// The operations a probe's own labels may decide too: the Dashboard's lock is a lower bound.
const NAMES_OTHER_RECORDS: ReadonlyArray<Asked> = ["Probe add", "Probe remove"];

describePostgres(
  "the Dashboard's locks of a record and its parts agree with the server, on Postgres",
  () => {
    const schema: string = `scoped_locks_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    let database: DataSource;
    let server: DashboardRequestsOverHttp;
    let capturedProps: DatabaseCommonInteractionProps | null = null;

    const projectId: ObjectID = ObjectID.generate();
    const readerId: ObjectID = ObjectID.generate();
    const otherOwnerId: ObjectID = ObjectID.generate();
    const newOwnerId: ObjectID = ObjectID.generate();

    const supportTeamId: ObjectID = ObjectID.generate();
    const opsTeamId: ObjectID = ObjectID.generate();
    const elsewhereTeamId: ObjectID = ObjectID.generate();
    const otherOwnerTeamId: ObjectID = ObjectID.generate();
    const newOwnerTeamId: ObjectID = ObjectID.generate();

    const productionLabelId: ObjectID = ObjectID.generate();
    const plainProbeId: ObjectID = ObjectID.generate();
    const productionProbeId: ObjectID = ObjectID.generate();

    const teamIds: Record<PermissionRow["team"], ObjectID> = {
      Support: supportTeamId,
      Ops: opsTeamId,
    };

    const fixture: (
      name: string,
      isLabelled: boolean,
      ownedBy: Fixture["ownedBy"],
    ) => Fixture = (
      name: string,
      isLabelled: boolean,
      ownedBy: Fixture["ownedBy"],
    ): Fixture => {
      return {
        id: ObjectID.generate(),
        name: name,
        isLabelled: isLabelled,
        ownedBy: ownedBy,
        otherOwnerUserRowId: ObjectID.generate(),
        otherOwnerTeamRowId: ObjectID.generate(),
        probeRowId: ObjectID.generate(),
      };
    };

    const MONITORS: Array<Fixture> = [
      fixture("Production, nobody's", true, null),
      fixture("The reader's own", false, "reader"),
      fixture("Support's", false, "Support"),
      fixture("Ops'", false, "Ops"),
      fixture("Another team's", false, "Elsewhere"),
      fixture("Production, Support's", true, "Support"),
      fixture("Nobody's", false, null),
    ];

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

    // The reader's teams' permission rows, replaced.
    const setTeamPermissions: (
      rows: Array<PermissionRow>,
    ) => Promise<void> = async (rows: Array<PermissionRow>): Promise<void> => {
      await database.query(
        `DELETE FROM "${schema}"."TeamPermissionLabel" WHERE "teamPermissionId" IN (SELECT "_id" FROM "${schema}"."TeamPermission")`,
      );
      await database.query(`DELETE FROM "${schema}"."TeamPermission"`);

      for (const row of rows) {
        const id: ObjectID = ObjectID.generate();

        await insert("TeamPermission", {
          _id: id,
          projectId: projectId,
          teamId: teamIds[row.team],
          permission: row.permission,
          isBlockPermission: Boolean(row.isBlock),
          ...(row.scope ? { scope: row.scope } : {}),
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

    const X: Array<ObjectID> = [productionLabelId];

    const ROLE_SETS: Array<RoleSet> = [
      [
        "the customer: Viewer over the project, Project Member on Production",
        [
          {
            team: "Support",
            permission: Permission.Viewer,
            scope: PermissionScope.All,
          },
          {
            team: "Support",
            permission: Permission.ProjectMember,
            scope: PermissionScope.Labels,
            labelIds: X,
          },
        ],
      ],
      [
        "Viewer, and Monitor Admin of what Support owns",
        [
          {
            team: "Support",
            permission: Permission.Viewer,
            scope: PermissionScope.All,
          },
          {
            team: "Support",
            permission: Permission.MonitorAdmin,
            scope: PermissionScope.Owned,
          },
        ],
      ],
      [
        "Viewer; Monitor Admin of what Support owns, Monitor Member of what Ops owns",
        [
          {
            team: "Support",
            permission: Permission.Viewer,
            scope: PermissionScope.All,
          },
          {
            team: "Support",
            permission: Permission.MonitorAdmin,
            scope: PermissionScope.Owned,
          },
          {
            team: "Ops",
            permission: Permission.MonitorMember,
            scope: PermissionScope.Owned,
          },
        ],
      ],
      [
        "Project Member on Production, and Monitor Admin of what Ops owns",
        [
          {
            team: "Support",
            permission: Permission.Viewer,
            scope: PermissionScope.All,
          },
          {
            team: "Support",
            permission: Permission.ProjectMember,
            scope: PermissionScope.Labels,
            labelIds: X,
          },
          {
            team: "Ops",
            permission: Permission.MonitorAdmin,
            scope: PermissionScope.Owned,
          },
        ],
      ],
      [
        "Project Member on Production and Monitor Admin of what Support owns, one team",
        [
          {
            team: "Support",
            permission: Permission.Viewer,
            scope: PermissionScope.All,
          },
          {
            team: "Support",
            permission: Permission.ProjectMember,
            scope: PermissionScope.Labels,
            labelIds: X,
          },
          {
            team: "Support",
            permission: Permission.MonitorAdmin,
            scope: PermissionScope.Owned,
          },
        ],
      ],
      [
        "Monitor Admin of what Support owns, and nothing else",
        [
          {
            team: "Support",
            permission: Permission.MonitorAdmin,
            scope: PermissionScope.Owned,
          },
        ],
      ],
      [
        "Project Member over the project, Delete Monitor and Delete Owner blocked on Production",
        [
          {
            team: "Support",
            permission: Permission.ProjectMember,
            scope: PermissionScope.All,
          },
          {
            team: "Support",
            permission: Permission.DeleteProjectMonitor,
            isBlock: true,
            labelIds: X,
          },
          {
            team: "Support",
            permission: Permission.DeleteMonitorOwnerUser,
            isBlock: true,
            labelIds: X,
          },
        ],
      ],
      [
        "Viewer; people owners on Production, team owners of what Support owns",
        [
          {
            team: "Support",
            permission: Permission.Viewer,
            scope: PermissionScope.All,
          },
          {
            team: "Support",
            permission: Permission.CreateMonitorOwnerUser,
            scope: PermissionScope.Labels,
            labelIds: X,
          },
          {
            team: "Support",
            permission: Permission.DeleteMonitorOwnerUser,
            scope: PermissionScope.Labels,
            labelIds: X,
          },
          {
            team: "Support",
            permission: Permission.CreateMonitorOwnerTeam,
            scope: PermissionScope.Owned,
          },
          {
            team: "Support",
            permission: Permission.DeleteMonitorOwnerTeam,
            scope: PermissionScope.Owned,
          },
        ],
      ],
      [
        "Viewer; probes on Production",
        [
          {
            team: "Support",
            permission: Permission.Viewer,
            scope: PermissionScope.All,
          },
          {
            team: "Support",
            permission: Permission.CreateMonitorProbe,
            scope: PermissionScope.Labels,
            labelIds: X,
          },
          {
            team: "Support",
            permission: Permission.DeleteMonitorProbe,
            scope: PermissionScope.Labels,
            labelIds: X,
          },
        ],
      ],
      [
        "Viewer; probes of what Support owns",
        [
          {
            team: "Support",
            permission: Permission.Viewer,
            scope: PermissionScope.All,
          },
          {
            team: "Support",
            permission: Permission.CreateMonitorProbe,
            scope: PermissionScope.Owned,
          },
          {
            team: "Support",
            permission: Permission.DeleteMonitorProbe,
            scope: PermissionScope.Owned,
          },
        ],
      ],
      [
        "Project Member over the project",
        [
          {
            team: "Support",
            permission: Permission.ProjectMember,
            scope: PermissionScope.All,
          },
        ],
      ],
      [
        "Viewer alone",
        [
          {
            team: "Support",
            permission: Permission.Viewer,
            scope: PermissionScope.All,
          },
        ],
      ],
    ];

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["SCOPED_ROLE_LOCKS_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["SCOPED_ROLE_LOCKS_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["SCOPED_ROLE_LOCKS_TEST_DATABASE_NAME"] ||
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
        MonitorOwnerUserService,
        MonitorOwnerTeamService,
        MonitorProbeService,
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

      for (const [id, name] of [
        [readerId, "Ana Lima"],
        [otherOwnerId, "Ben Ito"],
        [newOwnerId, "Cleo Diaz"],
      ] as Array<[ObjectID, string]>) {
        await insert("User", {
          _id: id,
          name: name,
          email: `${id.toString()}@example.com`,
          slug: id.toString(),
          version: 1,
        });
      }

      for (const [id, name] of [
        [supportTeamId, "Support"],
        [opsTeamId, "Ops"],
        [elsewhereTeamId, "Elsewhere"],
        [otherOwnerTeamId, "Facilities"],
        [newOwnerTeamId, "Networks"],
      ] as Array<[ObjectID, string]>) {
        await insert("Team", {
          _id: id,
          projectId: projectId,
          name: name,
          slug: id.toString(),
          version: 1,
        });
      }

      // The reader is on Support and Ops; the others, on teams of their own.
      for (const [userId, teamId] of [
        [readerId, supportTeamId],
        [readerId, opsTeamId],
        [otherOwnerId, otherOwnerTeamId],
        [newOwnerId, newOwnerTeamId],
      ] as Array<[ObjectID, ObjectID]>) {
        await insert("TeamMember", {
          _id: ObjectID.generate(),
          projectId: projectId,
          teamId: teamId,
          userId: userId,
          hasAcceptedInvitation: true,
          version: 1,
        });
      }

      await insert("Label", {
        _id: productionLabelId,
        projectId: projectId,
        name: "Production",
        slug: productionLabelId.toString(),
        color: "#000000",
        version: 1,
      });

      for (const [id, name, isLabelled] of [
        [plainProbeId, "Frankfurt", false],
        [productionProbeId, "Production probe", true],
      ] as Array<[ObjectID, string, boolean]>) {
        await insert("Probe", {
          _id: id,
          projectId: projectId,
          name: name,
          slug: id.toString(),
          key: ObjectID.generate().toString(),
          probeVersion: "1.0.0",
          version: 1,
        });

        if (isLabelled) {
          await insert("ProbeLabel", {
            probeId: id,
            labelId: productionLabelId,
          });
        }
      }

      for (const monitor of MONITORS) {
        await insert("Monitor", {
          _id: monitor.id,
          projectId: projectId,
          name: monitor.name,
          slug: monitor.id.toString(),
          monitorType: MonitorType.Manual,
          currentMonitorStatusId: ObjectID.generate(),
          version: 1,
        });

        if (monitor.isLabelled) {
          await insert("MonitorLabel", {
            monitorId: monitor.id,
            labelId: productionLabelId,
          });
        }

        if (monitor.ownedBy === "reader") {
          await insert("MonitorOwnerUser", {
            _id: ObjectID.generate(),
            projectId: projectId,
            monitorId: monitor.id,
            userId: readerId,
            version: 1,
          });
        } else if (monitor.ownedBy) {
          await insert("MonitorOwnerTeam", {
            _id: ObjectID.generate(),
            projectId: projectId,
            monitorId: monitor.id,
            teamId:
              monitor.ownedBy === "Support"
                ? supportTeamId
                : monitor.ownedBy === "Ops"
                  ? opsTeamId
                  : elsewhereTeamId,
            version: 1,
          });
        }

        // Owner rows of someone else on every monitor: what a remove is asked about.
        await insert("MonitorOwnerUser", {
          _id: monitor.otherOwnerUserRowId,
          projectId: projectId,
          monitorId: monitor.id,
          userId: otherOwnerId,
          version: 1,
        });
        await insert("MonitorOwnerTeam", {
          _id: monitor.otherOwnerTeamRowId,
          projectId: projectId,
          monitorId: monitor.id,
          teamId: otherOwnerTeamId,
          version: 1,
        });
        await insert("MonitorProbe", {
          _id: monitor.probeRowId,
          projectId: projectId,
          monitorId: monitor.id,
          probeId: plainProbeId,
          version: 1,
        });
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

      /*
       * The props the server's own user middleware builds for the reader,
       * which every check below is asked with: a request's, as any route
       * reads them.
       */
      const props: ExpressRouter = express.Router() as unknown as ExpressRouter;

      props.get(
        "/test/reader-props",
        UserMiddleware.getUserMiddleware,
        async (req: ExpressRequest, res: ExpressResponse) => {
          capturedProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          res.status(200).json({});
        },
      );

      server = new DashboardRequestsOverHttp();
      await server.start([session, props, new MonitorAPI().getRouter()]);
    });

    beforeEach(() => {
      server.requests.length = 0;
      window.localStorage.clear();
      window.sessionStorage.clear();
      showProjectInTab(projectId);
      PermissionGate.clearPermissionPropsCache();
    });

    afterAll(async () => {
      await server?.stop();
      jest.restoreAllMocks();

      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    /*
     * The reader signs in with `rows`: the server's props for them, and the
     * Dashboard's snapshot - left by the permission headers of the
     * Dashboard's own first read, the Monitors list, which it returns.
     */
    const signInAs: (rows: Array<PermissionRow>) => Promise<{
      props: DatabaseCommonInteractionProps;
      monitors: Array<Monitor>;
    }> = async (
      rows: Array<PermissionRow>,
    ): Promise<{
      props: DatabaseCommonInteractionProps;
      monitors: Array<Monitor>;
    }> => {
      await setTeamPermissions(rows);

      capturedProps = null;
      const answer: SentRequest = await server.request(
        "GET",
        "/api/test/reader-props",
      );

      expect(answer.status).toBe(200);
      expect(capturedProps).not.toBeNull();

      const list: ListResult<Monitor> = await ModelAPI.getList<Monitor>({
        modelType: Monitor,
        query: {},
        select: { name: true, labels: { _id: true } },
        sort: {},
        skip: 0,
        limit: 50,
      });

      return { props: capturedProps!, monitors: list.data };
    };

    // Whether a check the server runs before a write lets it through.
    const serverAllows: (
      ask: () => Promise<unknown>,
    ) => Promise<boolean> = async (
      ask: () => Promise<unknown>,
    ): Promise<boolean> => {
      try {
        return Boolean(await ask());
      } catch {
        return false;
      }
    };

    const serverDecides: (data: {
      asked: Asked;
      monitor: Fixture;
      props: DatabaseCommonInteractionProps;
    }) => Promise<boolean> = async (data: {
      asked: Asked;
      monitor: Fixture;
      props: DatabaseCommonInteractionProps;
    }): Promise<boolean> => {
      const props: DatabaseCommonInteractionProps = data.props;
      const monitor: Fixture = data.monitor;
      const byId: (id: ObjectID) => {
        id: ObjectID;
        select: Dictionary<boolean>;
        props: DatabaseCommonInteractionProps;
      } = (id: ObjectID) => {
        return { id: id, select: { _id: true }, props: props };
      };

      switch (data.asked) {
        case "Monitor update":
          return serverAllows(() => {
            return MonitorService.findOneUpdatableById(
              byId(monitor.id) as never,
            );
          });
        case "Monitor delete":
          return serverAllows(() => {
            return MonitorService.findOneDeletableById(
              byId(monitor.id) as never,
            );
          });
        case "Owner (person) add":
          return serverAllows(async () => {
            const row: MonitorOwnerUser = new MonitorOwnerUser();
            row.monitorId = monitor.id;
            row.userId = newOwnerId;
            row.projectId = projectId;
            await MonitorOwnerUserService.checkCallerMayCreate({
              data: row,
              props: props,
            });
            return true;
          });
        case "Owner (person) remove":
          return serverAllows(() => {
            return MonitorOwnerUserService.findOneDeletableById(
              byId(monitor.otherOwnerUserRowId) as never,
            );
          });
        case "Owner (team) add":
          return serverAllows(async () => {
            const row: MonitorOwnerTeam = new MonitorOwnerTeam();
            row.monitorId = monitor.id;
            row.teamId = newOwnerTeamId;
            row.projectId = projectId;
            await MonitorOwnerTeamService.checkCallerMayCreate({
              data: row,
              props: props,
            });
            return true;
          });
        case "Owner (team) remove":
          return serverAllows(() => {
            return MonitorOwnerTeamService.findOneDeletableById(
              byId(monitor.otherOwnerTeamRowId) as never,
            );
          });
        case "Probe add":
          // The probe without labels: one that reaches nothing on its own.
          return serverAllows(async () => {
            const row: MonitorProbe = new MonitorProbe();
            row.monitorId = monitor.id;
            row.probeId = plainProbeId;
            row.projectId = projectId;
            await MonitorProbeService.checkCallerMayCreate({
              data: row,
              props: props,
            });
            return true;
          });
        case "Probe remove":
          return serverAllows(() => {
            return MonitorProbeService.findOneDeletableById(
              byId(monitor.probeRowId) as never,
            );
          });
      }
    };

    // The model each operation writes, and the action.
    const getWrite: (asked: Asked) => {
      model: BaseModel;
      action: ModelAction.Create | ModelAction.Update | ModelAction.Delete;
    } = (asked: Asked) => {
      const action:
        | ModelAction.Create
        | ModelAction.Update
        | ModelAction.Delete = asked.endsWith("update")
        ? ModelAction.Update
        : asked.endsWith("add")
          ? ModelAction.Create
          : ModelAction.Delete;

      if (asked.startsWith("Monitor")) {
        return { model: new Monitor(), action: action };
      }

      if (asked.startsWith("Owner (person)")) {
        return { model: new MonitorOwnerUser(), action: action };
      }

      if (asked.startsWith("Owner (team)")) {
        return { model: new MonitorOwnerTeam(), action: action };
      }

      return { model: new MonitorProbe(), action: action };
    };

    /*
     * What the Dashboard offers: the reader's own permissions
     * (PermissionGate.check), then what the monitor's labels and who owns it
     * leave of it - the monitor's own lock (getRecordLock), or its part's
     * (getPartLock) - as its pages and lists lock them.
     */
    const dashboardAllows: (data: {
      asked: Asked;
      recordLabelIds: Array<string>;
      ownership: RecordOwnershipFacts | null;
    }) => boolean = (data: {
      asked: Asked;
      recordLabelIds: Array<string>;
      ownership: RecordOwnershipFacts | null;
    }): boolean => {
      const write: {
        model: BaseModel;
        action: ModelAction.Create | ModelAction.Update | ModelAction.Delete;
      } = getWrite(data.asked);

      if (!PermissionGate.check(write.model, write.action).isAllowed) {
        return false;
      }

      let verdict: LabelVerdict | null = null;

      if (write.model instanceof Monitor) {
        const lock: ModelRecordLock | null = RecordLocks.getRecordLock(
          new Monitor(),
        );

        verdict = lock
          ? lock.weigh(
              write.action as ModelAction.Update | ModelAction.Delete,
              data.recordLabelIds,
              data.ownership,
            )
          : null;
      } else {
        const lock: ModelPartLock | null = RecordLocks.getPartLock(
          write.model,
          new Monitor(),
        );

        verdict = lock
          ? lock.weigh(write.action, data.recordLabelIds, data.ownership)
          : null;
      }

      return verdict ? verdict.isAllowed : true;
    };

    // What the Dashboard offered before: its own permissions, and the record's labels for the record alone.
    const dashboardAllowedBefore: (data: {
      asked: Asked;
      recordLabelIds: Array<string>;
    }) => boolean = (data: {
      asked: Asked;
      recordLabelIds: Array<string>;
    }): boolean => {
      const write: {
        model: BaseModel;
        action: ModelAction.Create | ModelAction.Update | ModelAction.Delete;
      } = getWrite(data.asked);

      if (!PermissionGate.check(write.model, write.action).isAllowed) {
        return false;
      }

      if (!(write.model instanceof Monitor)) {
        return true;
      }

      const lock: ModelLabelLock | null = RecordLocks.getLabelLock(
        new Monitor(),
      );

      return lock
        ? lock.weigh(
            write.action as ModelAction.Update | ModelAction.Delete,
            data.recordLabelIds,
          ).isAllowed
        : true;
    };

    const offeredBeforeButRefused: Array<string> = [];
    // Of those, what the Dashboard still offers now: the server keeps the last word.
    const stillOffered: Array<string> = [];

    // Every decision both sides made, by role set, operation and monitor.
    const decided: Map<string, { server: boolean; dashboard: boolean }> =
      new Map<string, { server: boolean; dashboard: boolean }>();

    for (const [name, rows] of ROLE_SETS) {
      test(`${name}: every monitor, every change of it and of its owners and probes`, async () => {
        const signedIn: {
          props: DatabaseCommonInteractionProps;
          monitors: Array<Monitor>;
        } = await signInAs(rows);

        const ownership: RecordOwnershipResult = await readRecordOwnership({
          modelType: Monitor,
          ids: MONITORS.map((monitor: Fixture): string => {
            return monitor.id.toString();
          }),
        });

        const disagreements: Array<string> = [];

        for (const monitor of MONITORS) {
          const read: Monitor | undefined = signedIn.monitors.find(
            (item: Monitor): boolean => {
              return (
                item._id?.toString().toLowerCase() ===
                monitor.id.toString().toLowerCase()
              );
            },
          );

          // A monitor the reader may not read: no page offers anything of it.
          if (!read) {
            expect(
              await serverDecides({
                asked: "Monitor update",
                monitor: monitor,
                props: signedIn.props,
              }),
            ).toBe(false);
            expect(
              ownership.records[monitor.id.toString().toLowerCase()],
            ).toBeUndefined();
            continue;
          }

          const recordLabelIds: Array<string> =
            getRecordLabelIds(read, "labels") || [];
          const facts: RecordOwnershipFacts | null = getRecordOwnershipFacts(
            ownership,
            monitor.id.toString(),
          );

          expect(facts).not.toBeNull();

          for (const asked of ASKED) {
            const server: boolean = await serverDecides({
              asked: asked,
              monitor: monitor,
              props: signedIn.props,
            });
            const dashboard: boolean = dashboardAllows({
              asked: asked,
              recordLabelIds: recordLabelIds,
              ownership: facts,
            });
            const before: boolean = dashboardAllowedBefore({
              asked: asked,
              recordLabelIds: recordLabelIds,
            });

            decided.set(`${name} | ${asked} | ${monitor.name}`, {
              server: server,
              dashboard: dashboard,
            });

            const isLowerBound: boolean = NAMES_OTHER_RECORDS.includes(asked);

            if (isLowerBound ? !dashboard && server : dashboard !== server) {
              disagreements.push(
                `${asked} of "${monitor.name}": server ${server}, Dashboard ${dashboard}`,
              );
            }

            if (before && !server) {
              offeredBeforeButRefused.push(
                `${name} - ${asked} of "${monitor.name}"`,
              );

              if (dashboard) {
                stillOffered.push(`${name} - ${asked} of "${monitor.name}"`);
              }
            }
          }
        }

        expect(disagreements).toEqual([]);
      });
    }

    test("the matrix decides both ways: what each side allows and refuses, for a few of its cells", () => {
      const both: (key: string) => { server: boolean; dashboard: boolean } = (
        key: string,
      ) => {
        expect(decided.has(key)).toBe(true);
        return decided.get(key)!;
      };

      const customer: string =
        "the customer: Viewer over the project, Project Member on Production";
      const ownedAdmin: string =
        "Viewer, and Monitor Admin of what Support owns";
      const mixed: string =
        "Project Member on Production, and Monitor Admin of what Ops owns";
      const probes: string = "Viewer; probes on Production";

      for (const [key, allowed] of [
        [`${customer} | Monitor delete | Nobody's`, false],
        [`${customer} | Monitor delete | Production, nobody's`, true],
        [`${customer} | Owner (person) add | Production, Support's`, true],
        [`${customer} | Owner (person) add | Support's`, false],
        [`${customer} | Owner (team) remove | The reader's own`, false],
        [`${ownedAdmin} | Monitor delete | The reader's own`, true],
        [`${ownedAdmin} | Monitor update | Support's`, true],
        [`${ownedAdmin} | Monitor update | Ops'`, false],
        [`${ownedAdmin} | Monitor delete | Production, nobody's`, false],
        [`${ownedAdmin} | Owner (person) add | Support's`, true],
        [`${ownedAdmin} | Owner (person) add | Another team's`, false],
        [`${mixed} | Monitor update | Ops'`, true],
        [`${mixed} | Monitor update | Support's`, false],
        [`${mixed} | Monitor update | Production, nobody's`, true],
        [`${probes} | Probe remove | Production, nobody's`, true],
      ] as Array<[string, boolean]>) {
        expect([key, both(key)]).toEqual([
          key,
          { server: allowed, dashboard: allowed },
        ]);
      }

      /*
       * A probe of a monitor outside the labels: the server refuses it (the
       * probe carries none either), and the Dashboard leaves it to the
       * server - another probe may carry them.
       */
      expect(both(`${probes} | Probe remove | Nobody's`)).toEqual({
        server: false,
        dashboard: true,
      });
    });

    test("the Dashboard as it was offered 136 changes the server refused, and now offers only the probes a probe's own labels may decide", () => {
      // Owners and probes on records outside the labels, Owned roles on records not owned.
      const byChange: Record<string, number> = {};

      for (const entry of offeredBeforeButRefused) {
        const change: string = entry.replace(/^.* - (.*) of ".*"$/, "$1");
        byChange[change] = (byChange[change] || 0) + 1;
      }

      expect(byChange).toEqual({
        "Monitor update": 13,
        "Monitor delete": 13,
        "Owner (person) add": 23,
        "Owner (person) remove": 25,
        "Owner (team) add": 22,
        "Owner (team) remove": 22,
        "Probe add": 9,
        "Probe remove": 9,
      });
      expect(offeredBeforeButRefused.length).toBe(136);
      expect(offeredBeforeButRefused).toContain(
        `Viewer, and Monitor Admin of what Support owns - Monitor delete of "Nobody's"`,
      );
      expect(offeredBeforeButRefused).toContain(
        `the customer: Viewer over the project, Project Member on Production - Owner (person) add of "Nobody's"`,
      );
      expect(offeredBeforeButRefused).toContain(
        `Project Member on Production, and Monitor Admin of what Ops owns - Monitor update of "Support's"`,
      );

      /*
       * Every one of them is locked now, but the probes of a grant limited
       * to labels: a monitor's probe names a probe, which may carry the
       * label, so the server decides those (#11510).
       */
      const LABEL_GRANT_PROBES: RegExp =
        /^Viewer; probes on Production - Probe (add|remove) of /;

      expect(stillOffered.length).toBe(10);
      expect(
        stillOffered.every((entry: string): boolean => {
          return LABEL_GRANT_PROBES.test(entry);
        }),
      ).toBe(true);
    });

    describe("who owns the records, as the route answers it", () => {
      test("the reader's own records, and their Owned grants' teams', and nothing of anyone else's", async () => {
        await signInAs(ROLE_SETS[2]![1]);

        const answer: RecordOwnershipResult = await readRecordOwnership({
          modelType: Monitor,
          ids: MONITORS.map((monitor: Fixture): string => {
            return monitor.id.toString();
          }),
        });

        const ownersOf: (name: string) => unknown = (name: string): unknown => {
          const monitor: Fixture = MONITORS.find((item: Fixture): boolean => {
            return item.name === name;
          })!;

          return answer.records[monitor.id.toString().toLowerCase()];
        };

        expect(ownersOf("The reader's own")).toEqual({
          isOwnedByCaller: true,
          teamIds: [],
        });
        expect(ownersOf("Support's")).toEqual({
          isOwnedByCaller: false,
          teamIds: [supportTeamId.toString().toLowerCase()],
        });
        expect(ownersOf("Ops'")).toEqual({
          isOwnedByCaller: false,
          teamIds: [opsTeamId.toString().toLowerCase()],
        });
        // Another team owns it, the reader is on none of its rows: not said.
        expect(ownersOf("Another team's")).toEqual({
          isOwnedByCaller: false,
          teamIds: [],
        });
        expect(ownersOf("Nobody's")).toEqual({
          isOwnedByCaller: false,
          teamIds: [],
        });
      });

      test("a team the reader is on but whose grants are not scoped to Owned is not said to own anything", async () => {
        // Support holds Monitor Admin of what it owns; Ops holds nothing scoped to Owned.
        await signInAs(ROLE_SETS[1]![1]);

        const answer: RecordOwnershipResult = await readRecordOwnership({
          modelType: Monitor,
          ids: MONITORS.map((monitor: Fixture): string => {
            return monitor.id.toString();
          }),
        });

        const ops: Fixture = MONITORS.find((item: Fixture): boolean => {
          return item.ownedBy === "Ops";
        })!;

        expect(answer.records[ops.id.toString().toLowerCase()]).toEqual({
          isOwnedByCaller: false,
          teamIds: [],
        });
      });

      test("only the records the reader may read are answered", async () => {
        // Monitor Admin of what Support owns, and nothing else: reads only those.
        await signInAs(ROLE_SETS[5]![1]);

        const answer: RecordOwnershipResult = await readRecordOwnership({
          modelType: Monitor,
          ids: MONITORS.map((monitor: Fixture): string => {
            return monitor.id.toString();
          }),
        });

        expect(Object.keys(answer.records).sort()).toEqual(
          MONITORS.filter((monitor: Fixture): boolean => {
            return (
              monitor.ownedBy === "reader" || monitor.ownedBy === "Support"
            );
          })
            .map((monitor: Fixture): string => {
              return monitor.id.toString().toLowerCase();
            })
            .sort(),
        );
      });

      test("the tables and operations the owners decide: the monitor's, its owner tables' and its parts'", async () => {
        await signInAs(ROLE_SETS[1]![1]);

        const answer: RecordOwnershipResult = await readRecordOwnership({
          modelType: Monitor,
          ids: [MONITORS[0]!.id.toString()],
        });

        expect(answer.tableName).toBe("Monitor");
        expect(answer.tables[0]).toEqual({
          tableName: "Monitor",
          key: "_id",
          operations: ["read", "update", "delete"],
        });

        const table: (tableName: string) => unknown = (
          tableName: string,
        ): unknown => {
          return answer.tables.find((item: { tableName: string }) => {
            return item.tableName === tableName;
          });
        };

        // An owner is added and removed only on what its holder owns; owners are read with the monitor.
        expect(table("MonitorOwnerUser")).toEqual({
          tableName: "MonitorOwnerUser",
          key: "monitorId",
          operations: ["create", "update", "delete"],
        });
        expect(table("MonitorOwnerTeam")).toEqual({
          tableName: "MonitorOwnerTeam",
          key: "monitorId",
          operations: ["create", "update", "delete"],
        });
        expect(table("MonitorProbe")).toEqual({
          tableName: "MonitorProbe",
          key: "monitorId",
          operations: ["create", "read", "update", "delete"],
        });
      });

      test("a request that names no records is refused, saying what to send", async () => {
        await signInAs(ROLE_SETS[1]![1]);

        const answer: SentRequest = await server.request(
          "POST",
          "/api/monitor/record-ownership",
          { monitorIds: [] },
        );

        expect(answer.status).toBe(400);
        expect(JSON.stringify(answer.answer)).toContain(
          "Name the records to ask about by their IDs",
        );
      });
    });
  },
);
