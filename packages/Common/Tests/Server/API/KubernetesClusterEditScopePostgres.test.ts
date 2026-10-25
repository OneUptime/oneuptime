import { mockRouter } from "./Helpers";
import CommonAPI from "../../../Server/API/CommonAPI";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import DatabaseService from "../../../Server/Services/DatabaseService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import KubernetesAiAgentService from "../../../Server/Services/KubernetesAiAgentService";
import KubernetesClusterAiAccessService from "../../../Server/Services/KubernetesClusterAiAccessService";
import ProjectService from "../../../Server/Services/ProjectService";
import ResourceAiAccessService from "../../../Server/Services/ResourceAiAccessService";
import ResourceAiAgentService from "../../../Server/Services/ResourceAiAgentService";
import RunnerJobService from "../../../Server/Services/RunnerJobService";
import UserService from "../../../Server/Services/UserService";
import KubectlJobRunner from "../../../Server/Utils/AI/ClusterAccess/KubectlJobRunner";
import { ChatExtraTool } from "../../../Server/Utils/AI/Chat/ChatAgentRunner";
import ChatInfrastructureAccess, {
  ChatPageInfrastructure,
} from "../../../Server/Utils/AI/Chat/ChatInfrastructureAccess";
import {
  LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
  RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
} from "../../../Server/Utils/AI/ResourceAccess/ResourceAccessToolNames";
import InvestigationThread, {
  INFRASTRUCTURE_OUT_OF_VIEW_SECTION,
  InvestigationThreadTurnContext,
} from "../../../Server/Utils/AI/SRE/InvestigationThread";
import CustomRoleSync from "../../../Server/Utils/CustomRole/CustomRoleSync";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import RealtimeAccessChanges from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import Response from "../../../Server/Utils/Response";
import Entities from "../../../Models/DatabaseModels/Index";
import KubernetesAiAgent from "../../../Models/DatabaseModels/KubernetesAiAgent";
import ResourceAiAgent from "../../../Models/DatabaseModels/ResourceAiAgent";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import AIChatPageContextType, {
  AIChatPageContext,
} from "../../../Types/AI/AIChatPageContext";
import { AIResourceType } from "../../../Types/AI/AIResourceContext";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import {
  KUBERNETES_AI_ACCESS_TEST_EDIT_REFUSAL,
  KUBERNETES_AI_AGENT_RESET_EDIT_REFUSAL,
  getKubernetesAiPlanApprovalEditRefusal,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccessPermissions";
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import {
  LIST_CLUSTER_ACCESS_TOOL_NAME,
  RUN_KUBECTL_TOOL_NAME,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccessToolNames";
import { ResourceAiAccessStatus } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import { getResourceAiAgentResetEditRefusal } from "../../../Types/AI/ResourceAiAccessPermissions";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import { getJestSpyOn } from "../../Spy";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * WHO MAY ACT ON ONE KUBERNETES CLUSTER, against a migrated Postgres.
 *
 * A cluster's AI page has two actions that only someone who may edit THAT
 * cluster may take: Test connection (POST /kubernetes-cluster/ai-access
 * /test), which runs `kubectl version` and `kubectl auth can-i --list`
 * through the cluster's Kubernetes AI agent or Runner, and Reset agent
 * (POST /kubernetes-cluster/ai-access/reset-agent), which also takes one of
 * the AI admin permissions. Approving an AI plan whose kubectl commands
 * change a cluster takes it too. "May edit that cluster" is what an update
 * of the cluster through the API decides, for its own row:
 *
 *   - an edit permission limited to some labels reaches the clusters
 *     carrying one of them, and no cluster without labels;
 *   - a block with labels takes away the clusters carrying one of them;
 *   - an edit permission scoped to Owned reaches the clusters the member,
 *     or one of their teams, owns;
 *   - a custom role's permission is held exactly as the team's own;
 *   - holding an edit permission somewhere in the project is not enough;
 *   - an API key takes neither action, whatever it may edit: both are a
 *     signed-in person's.
 *
 * The same holds for an infrastructure resource's Reset agent (a Docker
 * host here). And an incident's shared AI conversation, whose read-only
 * kubectl and infrastructure commands the person asking steers, reaches
 * only the linked clusters and Docker hosts that person may view.
 * Every request goes through the route, the real user
 * middleware - which reads the member's teams, their permission rows and
 * labels (a custom role's copies included), or an API key and its
 * permission rows, from the tables below - and the real permission
 * pipeline, query
 * serializer and TypeORM, so the label and owner rules run as the SQL
 * Postgres runs. Only what lies past the decision is stood in for: the
 * cluster's AI access status, the kubectl jobs themselves, the agent reset,
 * the reservation and locks (Valkey), the session token and the audit
 * trail.
 *
 * Opt in with RUN_POSTGRES_KUBERNETES_EDIT_SCOPE_TESTS=true against a
 * database the registered migrations have been applied to, e.g. from
 * packages/Common:
 *
 *   RUN_POSTGRES_KUBERNETES_EDIT_SCOPE_TESTS=true \
 *   KUBERNETES_EDIT_SCOPE_TEST_DATABASE_HOST=127.0.0.1 \
 *   KUBERNETES_EDIT_SCOPE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... node node_modules/.bin/jest --runInBand \
 *     Tests/Server/API/KubernetesClusterEditScopePostgres.test.ts --forceExit
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. The tables it
 * writes are copied from public into a uniquely named schema that is
 * dropped afterwards; every row is synthetic.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_KUBERNETES_EDIT_SCOPE_TESTS"] === "true"
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

jest.mock("../../../Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      ...((actual["default"] as Record<string, unknown>) || {}),
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
    },
  };
});

// The data source below is built here; the app's own needs no migrations.
jest.mock("../../../Server/Infrastructure/Postgres/DataSourceOptions", () => {
  return {};
});

// The audit trail of a write is kept elsewhere.
jest.mock("../../../Server/Services/AuditLogService", () => {
  return {
    __esModule: true,
    default: {
      recordCreate: jest.fn(),
      recordUpdate: jest.fn(),
      recordDelete: jest.fn(),
    },
  };
});

// The tables this suite writes; every other table is read from public.
const TABLES: Array<string> = [
  "User",
  "Project",
  "Team",
  "TeamMember",
  "TeamPermission",
  "TeamPermissionLabel",
  "Label",
  "CustomRole",
  "CustomRolePermission",
  "CustomRolePermissionLabel",
  "TeamCustomRole",
  "ApiKey",
  "ApiKeyPermission",
  "ApiKeyPermissionLabel",
  // A role's sync keeps the API keys given it too.
  "ApiKeyCustomRole",
  "KubernetesCluster",
  "KubernetesClusterLabel",
  "KubernetesClusterOwnerUser",
  "KubernetesClusterOwnerTeam",
  "DockerHost",
  "DockerHostLabel",
];

const TEST_ROUTE: string = "/kubernetes-cluster/ai-access/test";
const RESET_ROUTE: string = "/kubernetes-cluster/ai-access/reset-agent";
const RESOURCE_RESET_ROUTE: string = "/resource-ai-access/reset-agent";

const NOT_FOUND: string =
  "Kubernetes cluster not found (or you do not have access to it).";

// What every caller who is not a signed-in person is told.
const SESSION_REQUIRED: string = "A logged-in user session is required.";

interface PermissionRow {
  permission: Permission;
  labelIds?: Array<ObjectID>;
  isBlock?: boolean;
  scope?: PermissionScope;
}

type Caller =
  | { kind: "member"; userId: ObjectID; tenantId: ObjectID }
  | { kind: "apiKey"; apiKey: ObjectID };

// What a route answered.
interface Outcome {
  error?: unknown;
  json?: JSONObject;
}

describePostgres(
  "who may test, reset and approve fixes on one Kubernetes cluster, on Postgres",
  () => {
    const schema: string = `k8s_edit_scope_${ObjectID.generate()
      .toString()
      .split("-")
      .join("")}`;

    let database: DataSource;

    // The member every request is made as, and somebody of another project.
    const memberId: ObjectID = ObjectID.generate();
    const outsiderId: ObjectID = ObjectID.generate();

    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();

    // The member's team, the team that owns a cluster, the outsider's team.
    const memberTeamId: ObjectID = ObjectID.generate();
    const owningTeamId: ObjectID = ObjectID.generate();
    const otherTeamId: ObjectID = ObjectID.generate();

    const productionLabelId: ObjectID = ObjectID.generate();
    const stagingLabelId: ObjectID = ObjectID.generate();
    const otherProjectLabelId: ObjectID = ObjectID.generate();

    // Clusters of the project: one per label, one with none, two owned.
    const productionClusterId: ObjectID = ObjectID.generate();
    const stagingClusterId: ObjectID = ObjectID.generate();
    const unlabelledClusterId: ObjectID = ObjectID.generate();
    const memberOwnedClusterId: ObjectID = ObjectID.generate();
    const teamOwnedClusterId: ObjectID = ObjectID.generate();
    // A cluster of another project.
    const otherProjectClusterId: ObjectID = ObjectID.generate();

    // Docker hosts, for the resource agents' reset.
    const productionHostId: ObjectID = ObjectID.generate();
    const stagingHostId: ObjectID = ObjectID.generate();

    const member: Caller = {
      kind: "member",
      userId: memberId,
      tenantId: projectId,
    };

    // What ran past the decision, and on which cluster.
    let kubectlRuns: Array<string> = [];
    let agentResets: Array<string> = [];
    let resourceAgentResets: Array<string> = [];

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

    const insertCluster: (data: {
      id: ObjectID;
      projectId: ObjectID;
      name: string;
      labelIds?: Array<ObjectID>;
    }) => Promise<void> = async (data: {
      id: ObjectID;
      projectId: ObjectID;
      name: string;
      labelIds?: Array<ObjectID>;
    }): Promise<void> => {
      await insert("KubernetesCluster", {
        _id: data.id,
        projectId: data.projectId,
        name: data.name,
        slug: `${data.name}-${data.id.toString()}`,
        clusterIdentifier: data.name,
        version: 1,
      });

      for (const labelId of data.labelIds || []) {
        await insert("KubernetesClusterLabel", {
          kubernetesClusterId: data.id,
          labelId: labelId,
        });
      }
    };

    const insertDockerHost: (data: {
      id: ObjectID;
      name: string;
      labelIds: Array<ObjectID>;
    }) => Promise<void> = async (data: {
      id: ObjectID;
      name: string;
      labelIds: Array<ObjectID>;
    }): Promise<void> => {
      await insert("DockerHost", {
        _id: data.id,
        projectId: projectId,
        name: data.name,
        slug: `${data.name}-${data.id.toString()}`,
        hostIdentifier: data.name,
        version: 1,
      });

      for (const labelId of data.labelIds) {
        await insert("DockerHostLabel", {
          dockerHostId: data.id,
          labelId: labelId,
        });
      }
    };

    // The team's own permission rows, replaced (a custom role's copies too).
    const setTeamPermissions: (
      teamId: ObjectID,
      rows: Array<PermissionRow>,
    ) => Promise<void> = async (
      teamId: ObjectID,
      rows: Array<PermissionRow>,
    ): Promise<void> => {
      await database.query(
        `DELETE FROM "${schema}"."TeamPermissionLabel" WHERE "teamPermissionId" IN (SELECT "_id" FROM "${schema}"."TeamPermission" WHERE "teamId" = $1)`,
        [teamId.toString()],
      );
      await database.query(
        `DELETE FROM "${schema}"."TeamPermission" WHERE "teamId" = $1`,
        [teamId.toString()],
      );
      await database.query(
        `DELETE FROM "${schema}"."TeamCustomRole" WHERE "teamId" = $1`,
        [teamId.toString()],
      );

      for (const row of rows) {
        const id: ObjectID = ObjectID.generate();

        await insert("TeamPermission", {
          _id: id,
          projectId: projectId,
          teamId: teamId,
          permission: row.permission,
          isBlockPermission: Boolean(row.isBlock),
          scope:
            row.scope ||
            (!row.isBlock && row.labelIds && row.labelIds.length > 0
              ? PermissionScope.Labels
              : PermissionScope.All),
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

    /*
     * A custom role holding `rows`, given to the member's team (and only
     * that), its copies written by the one sync that writes them - after
     * the team's own rows are set to `teamRows`.
     */
    const giveCustomRole: (data: {
      teamRows: Array<PermissionRow>;
      roleRows: Array<PermissionRow>;
    }) => Promise<void> = async (data: {
      teamRows: Array<PermissionRow>;
      roleRows: Array<PermissionRow>;
    }): Promise<void> => {
      await setTeamPermissions(memberTeamId, data.teamRows);

      const roleId: ObjectID = ObjectID.generate();

      await insert("CustomRole", {
        _id: roleId,
        projectId: projectId,
        name: `Cluster editors ${roleId.toString()}`,
        slug: `cluster-editors-${roleId.toString()}`,
        version: 1,
      });

      for (const row of data.roleRows) {
        const rolePermissionId: ObjectID = ObjectID.generate();

        await insert("CustomRolePermission", {
          _id: rolePermissionId,
          projectId: projectId,
          customRoleId: roleId,
          permission: row.permission,
          scope:
            row.scope ||
            (row.labelIds && row.labelIds.length > 0
              ? PermissionScope.Labels
              : PermissionScope.All),
          version: 1,
        });

        for (const labelId of row.labelIds || []) {
          await insert("CustomRolePermissionLabel", {
            customRolePermissionId: rolePermissionId,
            labelId: labelId,
          });
        }
      }

      await insert("TeamCustomRole", {
        _id: ObjectID.generate(),
        projectId: projectId,
        teamId: memberTeamId,
        customRoleId: roleId,
        version: 1,
      });

      await CustomRoleSync.syncRoles({
        projectId: projectId,
        customRoleIds: [roleId],
      });
    };

    // A new API key of the project with these permission rows.
    const createApiKey: (
      rows: Array<PermissionRow>,
    ) => Promise<ObjectID> = async (
      rows: Array<PermissionRow>,
    ): Promise<ObjectID> => {
      const id: ObjectID = ObjectID.generate();
      const apiKey: ObjectID = ObjectID.generate();

      await insert("ApiKey", {
        _id: id,
        projectId: projectId,
        name: `Key ${id.toString()}`,
        slug: `key-${id.toString()}`,
        apiKey: apiKey,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        version: 1,
      });

      for (const row of rows) {
        const permissionId: ObjectID = ObjectID.generate();

        await insert("ApiKeyPermission", {
          _id: permissionId,
          projectId: projectId,
          apiKeyId: id,
          permission: row.permission,
          isBlockPermission: Boolean(row.isBlock),
          version: 1,
        });

        for (const labelId of row.labelIds || []) {
          await insert("ApiKeyPermissionLabel", {
            apiKeyPermissionId: permissionId,
            labelId: labelId,
          });
        }
      }

      return apiKey;
    };

    const headersOf: (caller: Caller) => Dictionary<string> = (
      caller: Caller,
    ): Dictionary<string> => {
      if (caller.kind === "member") {
        return {
          authorization: `Bearer ${caller.userId.toString()}`,
          tenantid: caller.tenantId.toString(),
        };
      }

      return { apikey: caller.apiKey.toString() };
    };

    const requestOf: (caller: Caller, body: JSONObject) => ExpressRequest = (
      caller: Caller,
      body: JSONObject,
    ): ExpressRequest => {
      return {
        method: "POST",
        params: {},
        query: {},
        cookies: {},
        headers: headersOf(caller),
        body: body,
      } as unknown as ExpressRequest;
    };

    const responseStub: () => ExpressResponse = (): ExpressResponse => {
      return {
        set: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        send: jest.fn(),
      } as unknown as ExpressResponse;
    };

    // Sends one request through its route's middleware and handler.
    const send: (data: {
      uri: string;
      caller: Caller;
      body: JSONObject;
    }) => Promise<Outcome> = async (data: {
      uri: string;
      caller: Caller;
      body: JSONObject;
    }): Promise<Outcome> => {
      jest.mocked(Response.sendJsonObjectResponse).mockClear();
      jest.mocked(Response.sendErrorResponse).mockClear();

      const req: ExpressRequest = requestOf(data.caller, data.body);
      const res: ExpressResponse = responseStub();
      const route: (typeof mockRouter.routes)[number] = mockRouter.match(
        "post",
        data.uri,
      );

      for (const middleware of route.middlewares) {
        let isPassed: boolean = false;

        await middleware(req, res, ((error?: unknown) => {
          if (!error) {
            isPassed = true;
          }
        }) as NextFunction);

        if (!isPassed) {
          return {
            error: jest.mocked(Response.sendErrorResponse).mock.calls[0]?.[2],
          };
        }
      }

      let forwardedError: unknown = undefined;

      await route.handlerFunction(req, res, ((error: unknown) => {
        forwardedError = error;
      }) as NextFunction);

      if (forwardedError) {
        return { error: forwardedError };
      }

      const answer: Array<unknown> | undefined = jest.mocked(
        Response.sendJsonObjectResponse,
      ).mock.calls[0];

      if (!answer) {
        throw new Error(`${data.uri} answered nothing.`);
      }

      return { json: answer[2] as JSONObject };
    };

    const testCluster: (
      caller: Caller,
      clusterId: ObjectID,
    ) => Promise<Outcome> = async (
      caller: Caller,
      clusterId: ObjectID,
    ): Promise<Outcome> => {
      return await send({
        uri: TEST_ROUTE,
        caller: caller,
        body: { clusterId: clusterId.toString() },
      });
    };

    const resetAgent: (
      caller: Caller,
      clusterId: ObjectID,
    ) => Promise<Outcome> = async (
      caller: Caller,
      clusterId: ObjectID,
    ): Promise<Outcome> => {
      return await send({
        uri: RESET_ROUTE,
        caller: caller,
        body: { clusterId: clusterId.toString() },
      });
    };

    // The props the member's request carries, as the middleware builds them.
    const propsOf: (
      caller: Caller,
    ) => Promise<DatabaseCommonInteractionProps> = async (
      caller: Caller,
    ): Promise<DatabaseCommonInteractionProps> => {
      const req: ExpressRequest = requestOf(caller, {});

      for (const middleware of mockRouter.match("post", TEST_ROUTE)
        .middlewares) {
        let isPassed: boolean = false;

        await middleware(req, responseStub(), ((error?: unknown) => {
          isPassed = !error;
        }) as NextFunction);

        expect(isPassed).toBe(true);
      }

      return await CommonAPI.getDatabaseCommonInteractionProps(req);
    };

    // The test ran kubectl on this cluster, and only on it.
    const expectKubectlRanOn: (
      outcome: Outcome,
      clusterId: ObjectID,
    ) => void = (outcome: Outcome, clusterId: ObjectID): void => {
      expect(outcome.error).toBeUndefined();
      expect(outcome.json?.["ok"]).toBe(true);
      expect(kubectlRuns).toEqual([
        `${clusterId.toString()} kubectl version`,
        `${clusterId.toString()} kubectl auth can-i --list`,
      ]);
    };

    // Refused with `message`, before anything ran.
    const expectRefused: (outcome: Outcome, message: string) => void = (
      outcome: Outcome,
      message: string,
    ): void => {
      expect(outcome.json).toBeUndefined();
      expect(outcome.error).toBeInstanceOf(NotAuthorizedException);
      expect((outcome.error as Error).message).toBe(message);
      expect(kubectlRuns).toEqual([]);
      expect(agentResets).toEqual([]);
      expect(resourceAgentResets).toEqual([]);
    };

    // Answered exactly as a cluster that does not exist, before anything ran.
    const expectNotFound: (outcome: Outcome) => void = (
      outcome: Outcome,
    ): void => {
      expect(outcome.json).toBeUndefined();
      expect(outcome.error).toBeInstanceOf(BadDataException);
      expect((outcome.error as Error).message).toBe(NOT_FOUND);
      expect(kubectlRuns).toEqual([]);
      expect(agentResets).toEqual([]);
    };

    const readyStatus: (
      clusterId: ObjectID,
    ) => KubernetesClusterAiAccessStatus = (
      clusterId: ObjectID,
    ): KubernetesClusterAiAccessStatus => {
      return {
        clusterId: clusterId.toString(),
        clusterName: "cluster",
        clusterIdentifier: "cluster",
        runner: {
          id: ObjectID.generate().toString(),
          name: "office-runner",
          isOnline: true,
          canRunAiCommands: true,
        },
        accessMethod: "credential",
        aiAgent: null,
        automaticInvestigation: { incidents: false, alerts: false },
        credentialId: undefined,
        credentialName: undefined,
        kubectlAllowlist: [],
        isInvestigationEnabled: true,
        isInvestigationReady: true,
        remediationMode: KubernetesAiRemediationMode.Disabled,
        isRemediationReady: false,
        gaps: [],
        evaluatedAt: "2026-10-17T00:00:00.000Z",
      } as unknown as KubernetesClusterAiAccessStatus;
    };

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["KUBERNETES_EDIT_SCOPE_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["KUBERNETES_EDIT_SCOPE_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["KUBERNETES_EDIT_SCOPE_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        /*
         * No schema of its own: table names stay unqualified, so the tables
         * copied into the test schema are found first and every other table
         * a read joins is found, empty, in public.
         */
        synchronize: false,
        logging: ["error"],
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

      // The session token names the member; it is not a signed token here.
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
      getJestSpyOn(RealtimeAccessChanges, "announce").mockReturnValue(
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
      getJestSpyOn(
        GlobalConfigService,
        "getRequireSsoForLogin",
      ).mockResolvedValue(false as never);

      // Workflows and live updates run elsewhere.
      getJestSpyOn(
        DatabaseService.prototype,
        "onTriggerWorkflow",
      ).mockResolvedValue(undefined as never);
      getJestSpyOn(
        DatabaseService.prototype,
        "onTriggerRealtime",
      ).mockResolvedValue(undefined as never);

      // The reservation and the locks (Valkey): always free.
      getJestSpyOn(GlobalCache, "setStringIfNotExists").mockResolvedValue(
        true as never,
      );
      getJestSpyOn(GlobalCache, "deleteKeyIfValue").mockResolvedValue(
        true as never,
      );
      getJestSpyOn(Semaphore, "lock").mockImplementation((async (data: {
        key: string;
        namespace: string;
      }): Promise<unknown> => {
        return { key: data.key, namespace: data.namespace };
      }) as never);
      getJestSpyOn(Semaphore, "release").mockResolvedValue(undefined as never);

      // No test has run yet: the limits are never what decides here.
      getJestSpyOn(RunnerJobService, "countBy").mockResolvedValue(
        new PositiveNumber(0) as never,
      );

      // Past the decision: the cluster's AI access and the commands it runs.
      getJestSpyOn(
        KubernetesClusterAiAccessService,
        "getStatusForCluster",
      ).mockImplementation((async (data: {
        clusterId: ObjectID;
      }): Promise<KubernetesClusterAiAccessStatus> => {
        return readyStatus(data.clusterId);
      }) as never);
      getJestSpyOn(KubectlJobRunner, "run").mockImplementation((async (data: {
        kubernetesClusterId: ObjectID;
        command: string;
      }): Promise<unknown> => {
        kubectlRuns.push(
          `${data.kubernetesClusterId.toString()} ${data.command}`,
        );

        return {
          jobId: ObjectID.generate().toString(),
          succeeded: true,
          exitCode: 0,
          output: "ok",
          displayCommand: data.command,
        };
      }) as never);

      getJestSpyOn(
        KubernetesAiAgentService,
        "findForCluster",
      ).mockImplementation((async (data: {
        kubernetesClusterId: ObjectID;
      }): Promise<KubernetesAiAgent> => {
        const agent: KubernetesAiAgent = new KubernetesAiAgent();
        agent.id = ObjectID.generate();
        agent.kubernetesClusterId = data.kubernetesClusterId;
        return agent;
      }) as never);
      getJestSpyOn(KubernetesAiAgentService, "resetAgent").mockImplementation(
        (async (data: { kubernetesClusterId: ObjectID }): Promise<void> => {
          agentResets.push(data.kubernetesClusterId.toString());
        }) as never,
      );

      getJestSpyOn(
        ResourceAiAgentService,
        "findAgentForResource",
      ).mockImplementation((async (): Promise<ResourceAiAgent> => {
        const agent: ResourceAiAgent = new ResourceAiAgent();
        agent.id = ObjectID.generate();
        return agent;
      }) as never);
      getJestSpyOn(ResourceAiAgentService, "resetAgent").mockImplementation(
        (async (data: { resourceId: ObjectID }): Promise<void> => {
          resourceAgentResets.push(data.resourceId.toString());
        }) as never,
      );
      getJestSpyOn(
        ResourceAiAccessService,
        "getStatusForResource",
      ).mockResolvedValue(null as never);

      // The routes register on mockRouter as the API modules load.
      mockRouter.routes.length = 0;
      await import("../../../Server/API/KubernetesClusterAiAccessAPI");
      await import("../../../Server/API/ResourceAiAccessAPI");

      for (const [id, name] of [
        [projectId, "Home project"],
        [otherProjectId, "Other project"],
      ] as Array<[ObjectID, string]>) {
        await insert("Project", {
          _id: id,
          name: name,
          slug: id.toString(),
          version: 1,
        });
      }

      for (const id of [memberId, outsiderId]) {
        await insert("User", {
          _id: id,
          name: "Synthetic User",
          email: `${id.toString()}@example.com`,
          slug: id.toString(),
          version: 1,
        });
      }

      for (const [teamId, teamProjectId, userId] of [
        [memberTeamId, projectId, memberId],
        [owningTeamId, projectId, memberId],
        [otherTeamId, otherProjectId, outsiderId],
      ] as Array<[ObjectID, ObjectID, ObjectID]>) {
        await insert("Team", {
          _id: teamId,
          projectId: teamProjectId,
          name: `Team ${teamId.toString()}`,
          slug: teamId.toString(),
          version: 1,
        });
        await insert("TeamMember", {
          _id: ObjectID.generate(),
          projectId: teamProjectId,
          teamId: teamId,
          userId: userId,
          hasAcceptedInvitation: true,
          version: 1,
        });
      }

      for (const [labelId, labelProjectId, name] of [
        [productionLabelId, projectId, "Production"],
        [stagingLabelId, projectId, "Staging"],
        [otherProjectLabelId, otherProjectId, "Production"],
      ] as Array<[ObjectID, ObjectID, string]>) {
        await insert("Label", {
          _id: labelId,
          projectId: labelProjectId,
          name: name,
          slug: labelId.toString(),
          color: "#000000",
          version: 1,
        });
      }

      await insertCluster({
        id: productionClusterId,
        projectId: projectId,
        name: "prod-us",
        labelIds: [productionLabelId],
      });
      await insertCluster({
        id: stagingClusterId,
        projectId: projectId,
        name: "staging-us",
        labelIds: [stagingLabelId],
      });
      await insertCluster({
        id: unlabelledClusterId,
        projectId: projectId,
        name: "sandbox",
      });
      await insertCluster({
        id: memberOwnedClusterId,
        projectId: projectId,
        name: "owned-by-member",
        labelIds: [productionLabelId],
      });
      await insertCluster({
        id: teamOwnedClusterId,
        projectId: projectId,
        name: "owned-by-team",
        labelIds: [productionLabelId],
      });
      await insertCluster({
        id: otherProjectClusterId,
        projectId: otherProjectId,
        name: "their-prod",
        labelIds: [otherProjectLabelId],
      });

      await insert("KubernetesClusterOwnerUser", {
        _id: ObjectID.generate(),
        projectId: projectId,
        userId: memberId,
        kubernetesClusterId: memberOwnedClusterId,
        version: 1,
      });
      await insert("KubernetesClusterOwnerTeam", {
        _id: ObjectID.generate(),
        projectId: projectId,
        teamId: owningTeamId,
        kubernetesClusterId: teamOwnedClusterId,
        version: 1,
      });

      await insertDockerHost({
        id: productionHostId,
        name: "prod-docker",
        labelIds: [productionLabelId],
      });
      await insertDockerHost({
        id: stagingHostId,
        name: "staging-docker",
        labelIds: [stagingLabelId],
      });

      // The outsider may do anything in their own project.
      await database.query(
        `INSERT INTO "${schema}"."TeamPermission" ("_id", "projectId", "teamId", "permission", "isBlockPermission", "scope", "version") VALUES ($1, $2, $3, $4, false, $5, 1)`,
        [
          ObjectID.generate().toString(),
          otherProjectId.toString(),
          otherTeamId.toString(),
          Permission.ProjectOwner,
          PermissionScope.All,
        ],
      );
    });

    beforeEach(async () => {
      kubectlRuns = [];
      agentResets = [];
      resourceAgentResets = [];

      // The owning team holds nothing of its own unless a test says so.
      await setTeamPermissions(owningTeamId, []);
    });

    afterAll(async () => {
      jest.restoreAllMocks();

      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    /*
     * The suite can see what it guards against: a member who may edit every
     * cluster runs the test on each of them, the Production one included.
     */
    test("a member who may edit every cluster tests any of them", async () => {
      await setTeamPermissions(memberTeamId, [
        { permission: Permission.ProjectMember },
      ]);

      for (const clusterId of [
        productionClusterId,
        stagingClusterId,
        unlabelledClusterId,
      ]) {
        kubectlRuns = [];
        expectKubectlRanOn(await testCluster(member, clusterId), clusterId);
      }
    });

    describe("Test connection, for an edit permission limited to labels", () => {
      const stagingEditor: Array<PermissionRow> = [
        { permission: Permission.ReadKubernetesCluster },
        {
          permission: Permission.EditKubernetesCluster,
          labelIds: [stagingLabelId],
        },
      ];

      test("refuses the Production cluster to a member who may edit only Staging clusters, and runs no kubectl", async () => {
        await setTeamPermissions(memberTeamId, stagingEditor);

        expectRefused(
          await testCluster(member, productionClusterId),
          KUBERNETES_AI_ACCESS_TEST_EDIT_REFUSAL,
        );
      });

      test("runs on the Staging cluster for the same member", async () => {
        await setTeamPermissions(memberTeamId, stagingEditor);

        expectKubectlRanOn(
          await testCluster(member, stagingClusterId),
          stagingClusterId,
        );
      });

      test("an id written in capitals names the same cluster, and is held to the same rule", async () => {
        await setTeamPermissions(memberTeamId, stagingEditor);

        expectRefused(
          await send({
            uri: TEST_ROUTE,
            caller: member,
            body: { clusterId: productionClusterId.toString().toUpperCase() },
          }),
          KUBERNETES_AI_ACCESS_TEST_EDIT_REFUSAL,
        );
        expectKubectlRanOn(
          await send({
            uri: TEST_ROUTE,
            caller: member,
            body: { clusterId: stagingClusterId.toString().toUpperCase() },
          }),
          stagingClusterId,
        );
      });

      test("refuses a cluster with no labels: it matches no permission limited to labels", async () => {
        await setTeamPermissions(memberTeamId, stagingEditor);

        expectRefused(
          await testCluster(member, unlabelledClusterId),
          KUBERNETES_AI_ACCESS_TEST_EDIT_REFUSAL,
        );
      });

      test("a role limited to Staging (Project Member) reaches only Staging clusters", async () => {
        await setTeamPermissions(memberTeamId, [
          { permission: Permission.ReadKubernetesCluster },
          { permission: Permission.ProjectMember, labelIds: [stagingLabelId] },
        ]);

        expectRefused(
          await testCluster(member, productionClusterId),
          KUBERNETES_AI_ACCESS_TEST_EDIT_REFUSAL,
        );

        expectKubectlRanOn(
          await testCluster(member, stagingClusterId),
          stagingClusterId,
        );
      });

      test("a member who may read only Staging clusters is told the Production cluster does not exist", async () => {
        await setTeamPermissions(memberTeamId, [
          {
            permission: Permission.ReadKubernetesCluster,
            labelIds: [stagingLabelId],
          },
          { permission: Permission.EditKubernetesCluster },
        ]);

        expectNotFound(await testCluster(member, productionClusterId));
        expectKubectlRanOn(
          await testCluster(member, stagingClusterId),
          stagingClusterId,
        );
      });
    });

    describe("Test connection, for a block with labels", () => {
      const keptOffProduction: Array<PermissionRow> = [
        { permission: Permission.ProjectMember },
        {
          permission: Permission.EditKubernetesCluster,
          labelIds: [productionLabelId],
          isBlock: true,
        },
      ];

      test("refuses the Production cluster to a member blocked from editing Production clusters", async () => {
        await setTeamPermissions(memberTeamId, keptOffProduction);

        expectRefused(
          await testCluster(member, productionClusterId),
          KUBERNETES_AI_ACCESS_TEST_EDIT_REFUSAL,
        );
      });

      test("negative control: the same block leaves the Staging and unlabelled clusters alone", async () => {
        await setTeamPermissions(memberTeamId, keptOffProduction);

        expectKubectlRanOn(
          await testCluster(member, stagingClusterId),
          stagingClusterId,
        );

        kubectlRuns = [];

        expectKubectlRanOn(
          await testCluster(member, unlabelledClusterId),
          unlabelledClusterId,
        );
      });

      test("a project admin blocked from editing Production clusters is refused there too", async () => {
        await setTeamPermissions(memberTeamId, [
          { permission: Permission.ProjectAdmin },
          {
            permission: Permission.EditKubernetesCluster,
            labelIds: [productionLabelId],
            isBlock: true,
          },
        ]);

        expectRefused(
          await testCluster(member, productionClusterId),
          KUBERNETES_AI_ACCESS_TEST_EDIT_REFUSAL,
        );
      });
    });

    describe("Test connection, for an edit permission scoped to Owned", () => {
      const ownerEditor: Array<PermissionRow> = [
        { permission: Permission.ReadKubernetesCluster },
        {
          permission: Permission.EditKubernetesCluster,
          scope: PermissionScope.Owned,
        },
      ];

      test("refuses a cluster nobody on the member's teams owns", async () => {
        await setTeamPermissions(memberTeamId, ownerEditor);

        expectRefused(
          await testCluster(member, productionClusterId),
          KUBERNETES_AI_ACCESS_TEST_EDIT_REFUSAL,
        );
      });

      test("runs on the cluster the member owns, and on the one their team owns", async () => {
        await setTeamPermissions(memberTeamId, ownerEditor);

        expectKubectlRanOn(
          await testCluster(member, memberOwnedClusterId),
          memberOwnedClusterId,
        );

        kubectlRuns = [];

        expectKubectlRanOn(
          await testCluster(member, teamOwnedClusterId),
          teamOwnedClusterId,
        );
      });
    });

    describe("Test connection, through a custom role", () => {
      test("an edit permission limited to Staging in a custom role reaches only Staging clusters, as the team's own does", async () => {
        await giveCustomRole({
          teamRows: [{ permission: Permission.ReadKubernetesCluster }],
          roleRows: [
            {
              permission: Permission.EditKubernetesCluster,
              labelIds: [stagingLabelId],
            },
          ],
        });

        // The role's copy is on the team, as the sync writes it.
        const copies: Array<{ permission: string; scope: string }> =
          await database.query(
            `SELECT "permission", "scope" FROM "${schema}"."TeamPermission" WHERE "teamId" = $1 AND "teamCustomRoleId" IS NOT NULL`,
            [memberTeamId.toString()],
          );
        expect(copies).toEqual([
          {
            permission: Permission.EditKubernetesCluster,
            scope: PermissionScope.Labels,
          },
        ]);

        expectRefused(
          await testCluster(member, productionClusterId),
          KUBERNETES_AI_ACCESS_TEST_EDIT_REFUSAL,
        );

        expectKubectlRanOn(
          await testCluster(member, stagingClusterId),
          stagingClusterId,
        );
      });

      test("a role that may edit every cluster does not outweigh the team's block on Production clusters", async () => {
        // A role holds grants only: the block is the team's own, beside it.
        await giveCustomRole({
          teamRows: [
            {
              permission: Permission.EditKubernetesCluster,
              labelIds: [productionLabelId],
              isBlock: true,
            },
          ],
          roleRows: [{ permission: Permission.ProjectMember }],
        });

        expectRefused(
          await testCluster(member, productionClusterId),
          KUBERNETES_AI_ACCESS_TEST_EDIT_REFUSAL,
        );

        expectKubectlRanOn(
          await testCluster(member, stagingClusterId),
          stagingClusterId,
        );
      });
    });

    /*
     * The cluster's AI actions are a person's: an API key is refused
     * whatever it may edit, before any cluster is read.
     */
    describe("Test connection and Reset agent, as an API key", () => {
      test("a key that may edit only Staging clusters is refused, on every cluster", async () => {
        const apiKey: ObjectID = await createApiKey([
          { permission: Permission.ReadKubernetesCluster },
          {
            permission: Permission.EditKubernetesCluster,
            labelIds: [stagingLabelId],
          },
        ]);

        for (const clusterId of [productionClusterId, stagingClusterId]) {
          expectRefused(
            await testCluster({ kind: "apiKey", apiKey }, clusterId),
            SESSION_REQUIRED,
          );
        }
      });

      test("a key that may do anything in the project is refused too", async () => {
        const apiKey: ObjectID = await createApiKey([
          { permission: Permission.ProjectOwner },
        ]);

        expectRefused(
          await testCluster({ kind: "apiKey", apiKey }, stagingClusterId),
          SESSION_REQUIRED,
        );
        expectRefused(
          await resetAgent({ kind: "apiKey", apiKey }, stagingClusterId),
          SESSION_REQUIRED,
        );
      });
    });

    describe("Test connection, for who may edit nothing, or another project", () => {
      test("a member who may only read clusters is refused, in the test's words", async () => {
        await setTeamPermissions(memberTeamId, [
          { permission: Permission.ReadKubernetesCluster },
        ]);

        expectRefused(
          await testCluster(member, stagingClusterId),
          KUBERNETES_AI_ACCESS_TEST_EDIT_REFUSAL,
        );
      });

      test("another project's cluster is answered as one that does not exist", async () => {
        await setTeamPermissions(memberTeamId, [
          { permission: Permission.ProjectOwner },
        ]);

        expectNotFound(await testCluster(member, otherProjectClusterId));
      });

      test("somebody who is not a member of the project is refused before any cluster is read", async () => {
        const outcome: Outcome = await testCluster(
          { kind: "member", userId: outsiderId, tenantId: projectId },
          stagingClusterId,
        );

        expect(outcome.json).toBeUndefined();
        expect(outcome.error).toBeDefined();
        expect(kubectlRuns).toEqual([]);
      });

      test("project owners and admins test every cluster", async () => {
        for (const permission of [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
        ]) {
          await setTeamPermissions(memberTeamId, [{ permission }]);

          kubectlRuns = [];
          expectKubectlRanOn(
            await testCluster(member, productionClusterId),
            productionClusterId,
          );
        }
      });
    });

    describe("Reset agent", () => {
      test("refuses an AI admin who may not edit Production clusters, and resets nothing", async () => {
        await setTeamPermissions(memberTeamId, [
          { permission: Permission.ProjectAdmin },
          {
            permission: Permission.EditKubernetesCluster,
            labelIds: [productionLabelId],
            isBlock: true,
          },
        ]);

        expectRefused(
          await resetAgent(member, productionClusterId),
          KUBERNETES_AI_AGENT_RESET_EDIT_REFUSAL,
        );
      });

      test("resets the Staging cluster's agent for the same admin", async () => {
        await setTeamPermissions(memberTeamId, [
          { permission: Permission.ProjectAdmin },
          {
            permission: Permission.EditKubernetesCluster,
            labelIds: [productionLabelId],
            isBlock: true,
          },
        ]);

        const outcome: Outcome = await resetAgent(member, stagingClusterId);

        expect(outcome.error).toBeUndefined();
        expect(outcome.json?.["ok"]).toBe(true);
        expect(agentResets).toEqual([stagingClusterId.toString()]);
      });

      test("Edit AI Rule without any edit of clusters resets no agent", async () => {
        await setTeamPermissions(memberTeamId, [
          { permission: Permission.ReadKubernetesCluster },
          { permission: Permission.EditAutoRemediationRule },
        ]);

        expectRefused(
          await resetAgent(member, stagingClusterId),
          KUBERNETES_AI_AGENT_RESET_EDIT_REFUSAL,
        );
      });

      test("Edit AI Rule with an edit of Staging clusters resets only Staging agents", async () => {
        await setTeamPermissions(memberTeamId, [
          { permission: Permission.ReadKubernetesCluster },
          { permission: Permission.EditAutoRemediationRule },
          {
            permission: Permission.EditKubernetesCluster,
            labelIds: [stagingLabelId],
          },
        ]);

        expectRefused(
          await resetAgent(member, productionClusterId),
          KUBERNETES_AI_AGENT_RESET_EDIT_REFUSAL,
        );

        const outcome: Outcome = await resetAgent(member, stagingClusterId);

        expect(outcome.error).toBeUndefined();
        expect(agentResets).toEqual([stagingClusterId.toString()]);
      });

      test("a member who may edit the cluster but holds none of the admin set is still refused", async () => {
        await setTeamPermissions(memberTeamId, [
          { permission: Permission.ProjectMember },
        ]);

        const outcome: Outcome = await resetAgent(member, stagingClusterId);

        expect(outcome.error).toBeInstanceOf(NotAuthorizedException);
        expect((outcome.error as Error).message).toContain(
          "permissions to reset this cluster's Kubernetes AI agent",
        );
        expect(agentResets).toEqual([]);
      });
    });

    describe("Reset agent, on an infrastructure resource", () => {
      const resetDockerAgent: (hostId: ObjectID) => Promise<Outcome> = async (
        hostId: ObjectID,
      ): Promise<Outcome> => {
        return await send({
          uri: RESOURCE_RESET_ROUTE,
          caller: member,
          body: {
            resourceType: AiResourceType.DockerHost,
            resourceId: hostId.toString(),
          },
        });
      };

      test("refuses an AI admin blocked from editing Production Docker hosts, and resets the Staging one", async () => {
        await setTeamPermissions(memberTeamId, [
          { permission: Permission.ProjectAdmin },
          {
            permission: Permission.EditDockerHost,
            labelIds: [productionLabelId],
            isBlock: true,
          },
        ]);

        expectRefused(
          await resetDockerAgent(productionHostId),
          getResourceAiAgentResetEditRefusal(AiResourceType.DockerHost),
        );

        const outcome: Outcome = await resetDockerAgent(stagingHostId);

        expect(outcome.error).toBeUndefined();
        expect(resourceAgentResets).toEqual([stagingHostId.toString()]);
      });

      test("Edit AI Rule with an edit of Staging Docker hosts resets only the Staging one", async () => {
        await setTeamPermissions(memberTeamId, [
          { permission: Permission.ReadDockerHost },
          { permission: Permission.EditAutoRemediationRule },
          {
            permission: Permission.EditDockerHost,
            labelIds: [stagingLabelId],
          },
        ]);

        expectRefused(
          await resetDockerAgent(productionHostId),
          getResourceAiAgentResetEditRefusal(AiResourceType.DockerHost),
        );

        const outcome: Outcome = await resetDockerAgent(stagingHostId);

        expect(outcome.error).toBeUndefined();
        expect(resourceAgentResets).toEqual([stagingHostId.toString()]);
      });
    });

    /*
     * Approving an AI plan asks the same question of every cluster its
     * kubectl commands change, with the approver's own props
     * (AutoRemediationAPI: assertApproverMayChangeClusters).
     */
    describe("approving a plan's kubectl commands", () => {
      const assertMayApprove: (
        props: DatabaseCommonInteractionProps,
        clusterId: ObjectID,
      ) => Promise<void> = async (
        props: DatabaseCommonInteractionProps,
        clusterId: ObjectID,
      ): Promise<void> => {
        await KubernetesClusterAiAccessService.assertCallerMayChangeCluster({
          props: props,
          projectId: projectId,
          clusterId: clusterId,
          refusal: getKubernetesAiPlanApprovalEditRefusal("prod-us"),
        });
      };

      test("an approver blocked from editing Production clusters may not approve a change to one", async () => {
        await setTeamPermissions(memberTeamId, [
          { permission: Permission.ProjectMember },
          { permission: Permission.RunbookMember },
          {
            permission: Permission.EditKubernetesCluster,
            labelIds: [productionLabelId],
            isBlock: true,
          },
        ]);

        const props: DatabaseCommonInteractionProps = await propsOf(member);

        await expect(
          assertMayApprove(props, productionClusterId),
        ).rejects.toThrow(getKubernetesAiPlanApprovalEditRefusal("prod-us"));
        await expect(
          assertMayApprove(props, stagingClusterId),
        ).resolves.toBeUndefined();
      });

      test("an approver whose cluster edits are limited to owned clusters approves only those", async () => {
        await setTeamPermissions(memberTeamId, [
          { permission: Permission.ReadKubernetesCluster },
          { permission: Permission.RunbookMember },
          {
            permission: Permission.EditKubernetesCluster,
            scope: PermissionScope.Owned,
          },
        ]);

        const props: DatabaseCommonInteractionProps = await propsOf(member);

        await expect(
          assertMayApprove(props, productionClusterId),
        ).rejects.toThrow(NotAuthorizedException);
        await expect(
          assertMayApprove(props, teamOwnedClusterId),
        ).resolves.toBeUndefined();
      });

      test("another project's cluster is never one an approver may change", async () => {
        await setTeamPermissions(memberTeamId, [
          { permission: Permission.ProjectOwner },
        ]);

        const props: DatabaseCommonInteractionProps = await propsOf(member);

        await expect(
          assertMayApprove(props, otherProjectClusterId),
        ).rejects.toThrow(NotAuthorizedException);
        await expect(
          assertMayApprove(props, productionClusterId),
        ).resolves.toBeUndefined();
      });
    });

    /*
     * An incident's shared AI conversation ("Ask OneUptime AI") runs
     * read-only kubectl and infrastructure commands that the person asking
     * steers, so it reaches only the linked clusters and resources that
     * person may view - their own read, labels, owners, blocks and custom
     * roles included - never one their read does not cover
     * (InvestigationThread.buildTurnContext). Every linked cluster here has
     * "Investigate with kubectl" on; only the person asking differs.
     */
    describe("the incident's AI conversation", () => {
      const incidentId: ObjectID = ObjectID.generate();
      const resourceAgentId: string = ObjectID.generate().toString();

      const linkedCluster: (
        clusterId: ObjectID,
        name: string,
      ) => KubernetesClusterAiAccessStatus = (
        clusterId: ObjectID,
        name: string,
      ): KubernetesClusterAiAccessStatus => {
        return {
          ...readyStatus(clusterId),
          clusterName: name,
          clusterIdentifier: name,
        } as KubernetesClusterAiAccessStatus;
      };

      const linkedHost: (
        hostId: ObjectID,
        name: string,
      ) => ResourceAiAccessStatus = (
        hostId: ObjectID,
        name: string,
      ): ResourceAiAccessStatus => {
        return {
          resourceType: AiResourceType.DockerHost,
          resourceId: hostId.toString(),
          resourceName: name,
          isAiInvestigationEnabled: true,
          aiRemediationMode: "Disabled",
          aiCommandAllowlist: [],
          agent: {
            agentId: resourceAgentId,
            connectionStatus: "Connected",
            isOnline: true,
          },
          gaps: [],
          isInvestigationReady: true,
          isRemediationReady: false,
        } as unknown as ResourceAiAccessStatus;
      };

      beforeEach(() => {
        getJestSpyOn(
          KubernetesClusterAiAccessService,
          "getStatusesForSubject",
        ).mockResolvedValue([
          linkedCluster(productionClusterId, "prod-us"),
          linkedCluster(stagingClusterId, "staging-us"),
          linkedCluster(unlabelledClusterId, "sandbox"),
          linkedCluster(memberOwnedClusterId, "owned-by-member"),
          linkedCluster(teamOwnedClusterId, "owned-by-team"),
        ] as never);
        getJestSpyOn(
          ResourceAiAccessService,
          "getStatusesForSubject",
        ).mockResolvedValue([
          linkedHost(productionHostId, "prod-docker"),
          linkedHost(stagingHostId, "staging-docker"),
        ] as never);
      });

      // The turn's context, built for the member as their request carries them.
      const askAsMember: () => Promise<InvestigationThreadTurnContext> =
        async (): Promise<InvestigationThreadTurnContext> => {
          return await InvestigationThread.buildTurnContext({
            projectId: projectId,
            subject: { type: "incident", id: incidentId },
            aiRunId: ObjectID.generate(),
            props: await propsOf(member),
          });
        };

      const toolOf: (
        context: InvestigationThreadTurnContext,
        name: string,
      ) => ChatExtraTool | undefined = (
        context: InvestigationThreadTurnContext,
        name: string,
      ): ChatExtraTool | undefined => {
        return context.extraTools.find((tool: ChatExtraTool): boolean => {
          return tool.definition.name === name;
        });
      };

      // The clusters the conversation offers kubectl on, by id.
      const offeredClusters: (
        context: InvestigationThreadTurnContext,
      ) => Promise<Array<string>> = async (
        context: InvestigationThreadTurnContext,
      ): Promise<Array<string>> => {
        const tool: ChatExtraTool | undefined = toolOf(
          context,
          LIST_CLUSTER_ACCESS_TOOL_NAME,
        );

        if (!tool) {
          return [];
        }

        const text: string = (await tool.execute({})).result?.dataForLlm || "";

        return [
          productionClusterId,
          stagingClusterId,
          unlabelledClusterId,
          memberOwnedClusterId,
          teamOwnedClusterId,
        ]
          .map((id: ObjectID): string => {
            return id.toString();
          })
          .filter((id: string): boolean => {
            return text.includes(`clusterId: ${id} `);
          });
      };

      // The Docker hosts the conversation offers commands on, by id.
      const offeredHosts: (
        context: InvestigationThreadTurnContext,
      ) => Promise<Array<string>> = async (
        context: InvestigationThreadTurnContext,
      ): Promise<Array<string>> => {
        const tool: ChatExtraTool | undefined = toolOf(
          context,
          LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
        );

        if (!tool) {
          return [];
        }

        const text: string = (await tool.execute({})).result?.dataForLlm || "";

        return [productionHostId, stagingHostId]
          .map((id: ObjectID): string => {
            return id.toString();
          })
          .filter((id: string): boolean => {
            return text.includes(`resourceId: ${id} `);
          });
      };

      // Asks the conversation's run_kubectl for `auth can-i --list` on a cluster.
      const runKubectlOn: (
        context: InvestigationThreadTurnContext,
        clusterId: ObjectID,
      ) => Promise<boolean> = async (
        context: InvestigationThreadTurnContext,
        clusterId: ObjectID,
      ): Promise<boolean> => {
        const tool: ChatExtraTool | undefined = toolOf(
          context,
          RUN_KUBECTL_TOOL_NAME,
        );

        if (!tool) {
          return false;
        }

        return (
          await tool.execute({
            clusterId: clusterId.toString(),
            command: "kubectl auth can-i --list",
            rationale: "What may the agent do here?",
          })
        ).success;
      };

      test("a member who may view only Staging clusters gets kubectl on Staging alone, and is told the rest is out of view", async () => {
        await setTeamPermissions(memberTeamId, [
          {
            permission: Permission.ReadKubernetesCluster,
            labelIds: [stagingLabelId],
          },
        ]);

        const context: InvestigationThreadTurnContext = await askAsMember();

        expect(await offeredClusters(context)).toEqual([
          stagingClusterId.toString(),
        ]);
        expect(context.additionalSystemInstructions).toContain(
          'Cluster "staging-us"',
        );
        expect(context.additionalSystemInstructions).not.toContain(
          'Cluster "prod-us"',
        );
        expect(context.additionalSystemInstructions).toContain(
          INFRASTRUCTURE_OUT_OF_VIEW_SECTION,
        );

        // Asked to run on Production anyway: refused, nothing ran.
        expect(await runKubectlOn(context, productionClusterId)).toBe(false);
        expect(kubectlRuns).toEqual([]);

        expect(await runKubectlOn(context, stagingClusterId)).toBe(true);
        expect(kubectlRuns).toEqual([
          `${stagingClusterId.toString()} kubectl auth can-i --list`,
        ]);
      });

      test("a Project Member blocked from viewing Production clusters gets every other one", async () => {
        await setTeamPermissions(memberTeamId, [
          { permission: Permission.ProjectMember },
          {
            permission: Permission.ReadKubernetesCluster,
            labelIds: [productionLabelId],
            isBlock: true,
          },
        ]);

        const context: InvestigationThreadTurnContext = await askAsMember();

        // The owned clusters carry the Production label too.
        expect(await offeredClusters(context)).toEqual([
          stagingClusterId.toString(),
          unlabelledClusterId.toString(),
        ]);
        expect(await runKubectlOn(context, productionClusterId)).toBe(false);
        expect(kubectlRuns).toEqual([]);
      });

      test("negative control: a member who may view every cluster gets every one, and nothing is out of view", async () => {
        await setTeamPermissions(memberTeamId, [
          { permission: Permission.ProjectMember },
        ]);

        const context: InvestigationThreadTurnContext = await askAsMember();

        expect(await offeredClusters(context)).toEqual([
          productionClusterId.toString(),
          stagingClusterId.toString(),
          unlabelledClusterId.toString(),
          memberOwnedClusterId.toString(),
          teamOwnedClusterId.toString(),
        ]);
        expect(await offeredHosts(context)).toEqual([
          productionHostId.toString(),
          stagingHostId.toString(),
        ]);
        expect(context.additionalSystemInstructions).not.toContain(
          INFRASTRUCTURE_OUT_OF_VIEW_SECTION,
        );
        expect(await runKubectlOn(context, productionClusterId)).toBe(true);
      });

      test("a member who may view clusters they own gets those alone", async () => {
        await setTeamPermissions(memberTeamId, [
          {
            permission: Permission.ReadKubernetesCluster,
            scope: PermissionScope.Owned,
          },
        ]);

        const context: InvestigationThreadTurnContext = await askAsMember();

        expect(await offeredClusters(context)).toEqual([
          memberOwnedClusterId.toString(),
          teamOwnedClusterId.toString(),
        ]);
      });

      test("a custom role limited to Staging reaches Staging clusters alone, as the team's own does", async () => {
        await giveCustomRole({
          teamRows: [],
          roleRows: [
            {
              permission: Permission.ReadKubernetesCluster,
              labelIds: [stagingLabelId],
            },
          ],
        });

        const context: InvestigationThreadTurnContext = await askAsMember();

        expect(await offeredClusters(context)).toEqual([
          stagingClusterId.toString(),
        ]);
      });

      test("a member who may view no cluster and no Docker host gets no commands at all", async () => {
        await setTeamPermissions(memberTeamId, [
          { permission: Permission.ReadProjectIncident },
        ]);

        const context: InvestigationThreadTurnContext = await askAsMember();

        expect(toolOf(context, RUN_KUBECTL_TOOL_NAME)).toBeUndefined();
        expect(
          toolOf(context, RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME),
        ).toBeUndefined();
        expect(context.extraTools).toEqual([]);
        expect(context.additionalSystemInstructions).not.toContain(
          "read-only terminal",
        );
        expect(context.additionalSystemInstructions).toContain(
          INFRASTRUCTURE_OUT_OF_VIEW_SECTION,
        );
      });

      test("Docker hosts follow the same rule: a member who may view only Staging hosts gets the Staging one", async () => {
        await setTeamPermissions(memberTeamId, [
          {
            permission: Permission.ReadDockerHost,
            labelIds: [stagingLabelId],
          },
        ]);

        const context: InvestigationThreadTurnContext = await askAsMember();

        expect(await offeredHosts(context)).toEqual([stagingHostId.toString()]);
        expect(await offeredClusters(context)).toEqual([]);
        expect(context.additionalSystemInstructions).not.toContain(
          "prod-docker",
        );
      });
    });

    /*
     * Issue #5259: Ask AI opened on a cluster's or a Docker host's page runs
     * read-only commands there through its AI agent
     * (ChatInfrastructureAccess.buildForPage) - for the person asking, so
     * only on a cluster or host that person may view, decided by the same
     * real permission pipeline as above. The page is whatever the client
     * sent, so a page of a cluster the member may not view (a persisted
     * subject, or a forged one) must offer nothing and name nothing.
     */
    describe("Ask AI on a cluster's or a Docker host's page", () => {
      const resourceAgentId: string = ObjectID.generate().toString();

      const pageHost: (
        hostId: ObjectID,
        name: string,
      ) => ResourceAiAccessStatus = (
        hostId: ObjectID,
        name: string,
      ): ResourceAiAccessStatus => {
        return {
          resourceType: AiResourceType.DockerHost,
          resourceId: hostId.toString(),
          resourceName: name,
          isAiInvestigationEnabled: true,
          aiRemediationMode: "Disabled",
          aiCommandAllowlist: [],
          agent: {
            agentId: resourceAgentId,
            connectionStatus: "Connected",
            isOnline: true,
          },
          gaps: [],
          isInvestigationReady: true,
          isRemediationReady: false,
        } as unknown as ResourceAiAccessStatus;
      };

      beforeEach(() => {
        getJestSpyOn(
          ResourceAiAccessService,
          "getStatusForResource",
        ).mockImplementation((async (data: {
          resourceId: ObjectID;
        }): Promise<ResourceAiAccessStatus | null> => {
          if (data.resourceId.toString() === productionHostId.toString()) {
            return pageHost(productionHostId, "prod-docker");
          }

          if (data.resourceId.toString() === stagingHostId.toString()) {
            return pageHost(stagingHostId, "staging-docker");
          }

          return null;
        }) as never);
      });

      afterAll(() => {
        getJestSpyOn(
          ResourceAiAccessService,
          "getStatusForResource",
        ).mockResolvedValue(null as never);
      });

      // What the member's turn reaches, asked from this page.
      const askOnPage: (
        pageContext: AIChatPageContext,
      ) => Promise<ChatPageInfrastructure | null> = async (
        pageContext: AIChatPageContext,
      ): Promise<ChatPageInfrastructure | null> => {
        return await ChatInfrastructureAccess.buildForPage({
          projectId: projectId,
          aiRunId: ObjectID.generate(),
          props: await propsOf(member),
          pageContext,
        });
      };

      const clusterPage: (clusterId: ObjectID) => AIChatPageContext = (
        clusterId: ObjectID,
      ): AIChatPageContext => {
        return {
          type: AIChatPageContextType.Resource,
          resourceType: AIResourceType.KubernetesCluster,
          entityId: clusterId.toString(),
        };
      };

      const dockerHostPage: (hostId: ObjectID) => AIChatPageContext = (
        hostId: ObjectID,
      ): AIChatPageContext => {
        return {
          type: AIChatPageContextType.Resource,
          resourceType: AIResourceType.DockerHost,
          entityId: hostId.toString(),
        };
      };

      const toolNamed: (
        infrastructure: ChatPageInfrastructure | null,
        name: string,
      ) => ChatExtraTool | undefined = (
        infrastructure: ChatPageInfrastructure | null,
        name: string,
      ): ChatExtraTool | undefined => {
        return (infrastructure?.extraTools || []).find(
          (tool: ChatExtraTool): boolean => {
            return tool.definition.name === name;
          },
        );
      };

      test("a member who may view only Staging clusters runs kubectl on the Staging cluster's page", async () => {
        await setTeamPermissions(memberTeamId, [
          {
            permission: Permission.ReadKubernetesCluster,
            labelIds: [stagingLabelId],
          },
        ]);

        const infrastructure: ChatPageInfrastructure | null = await askOnPage(
          clusterPage(stagingClusterId),
        );

        const runKubectl: ChatExtraTool | undefined = toolNamed(
          infrastructure,
          RUN_KUBECTL_TOOL_NAME,
        );
        expect(runKubectl).toBeDefined();
        expect(infrastructure!.instructions).toContain(
          `(clusterId: ${stagingClusterId.toString()}): kubectl READ access`,
        );

        expect(
          (
            await runKubectl!.execute({
              clusterId: stagingClusterId.toString(),
              command: "kubectl get pods -A",
              rationale: "Which pods are running?",
            })
          ).success,
        ).toBe(true);
        expect(kubectlRuns).toEqual([
          `${stagingClusterId.toString()} kubectl get pods -A`,
        ]);
      });

      test("the same member on the Production cluster's page gets no kubectl, and nothing about it but that it is out of view", async () => {
        await setTeamPermissions(memberTeamId, [
          {
            permission: Permission.ReadKubernetesCluster,
            labelIds: [stagingLabelId],
          },
        ]);

        const infrastructure: ChatPageInfrastructure | null = await askOnPage(
          clusterPage(productionClusterId),
        );

        expect(infrastructure?.extraTools).toEqual([]);
        expect(infrastructure?.instructions).toBe(
          INFRASTRUCTURE_OUT_OF_VIEW_SECTION,
        );
        expect(infrastructure?.instructions).not.toContain(
          productionClusterId.toString(),
        );
        expect(kubectlRuns).toEqual([]);
      });

      test("a cluster of another project, on the page, is reached by nobody here", async () => {
        await setTeamPermissions(memberTeamId, [
          { permission: Permission.ProjectOwner },
        ]);

        const infrastructure: ChatPageInfrastructure | null = await askOnPage(
          clusterPage(otherProjectClusterId),
        );

        expect(toolNamed(infrastructure, RUN_KUBECTL_TOOL_NAME)).toBeUndefined();
        expect(infrastructure?.instructions || "").not.toContain(
          otherProjectClusterId.toString(),
        );
      });

      test("Docker hosts follow the same rule: commands on the Staging host's page, none on the Production one's", async () => {
        await setTeamPermissions(memberTeamId, [
          {
            permission: Permission.ReadDockerHost,
            labelIds: [stagingLabelId],
          },
        ]);

        const staging: ChatPageInfrastructure | null = await askOnPage(
          dockerHostPage(stagingHostId),
        );

        expect(
          toolNamed(staging, RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME),
        ).toBeDefined();
        expect(staging!.instructions).toContain(
          `Docker host "staging-docker" (resourceId: ${stagingHostId.toString()}): READ access`,
        );

        const production: ChatPageInfrastructure | null = await askOnPage(
          dockerHostPage(productionHostId),
        );

        expect(production?.extraTools).toEqual([]);
        expect(production?.instructions).toBe(
          INFRASTRUCTURE_OUT_OF_VIEW_SECTION,
        );
        expect(production?.instructions).not.toContain("prod-docker");
      });

      test("negative control: a member who may view every cluster and host reaches each one's page", async () => {
        await setTeamPermissions(memberTeamId, [
          { permission: Permission.ProjectMember },
        ]);

        for (const clusterId of [productionClusterId, stagingClusterId]) {
          expect(
            toolNamed(await askOnPage(clusterPage(clusterId)), RUN_KUBECTL_TOOL_NAME),
          ).toBeDefined();
        }

        for (const hostId of [productionHostId, stagingHostId]) {
          expect(
            toolNamed(
              await askOnPage(dockerHostPage(hostId)),
              RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
            ),
          ).toBeDefined();
        }
      });
    });
  },
);
