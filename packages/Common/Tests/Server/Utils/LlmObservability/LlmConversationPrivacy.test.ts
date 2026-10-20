import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import Log from "../../../../Models/AnalyticsModels/Log";
import Metric from "../../../../Models/AnalyticsModels/Metric";
import Span from "../../../../Models/AnalyticsModels/Span";
import { AnalyticsBaseModelType } from "../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import AnalyticsModelPermission from "../../../../Server/Types/AnalyticsDatabase/ModelPermission";
import DatabaseRequestType from "../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import LlmConversationPrivacy, {
  LLM_CONVERSATION_TABLES,
} from "../../../../Server/Utils/LlmObservability/LlmConversationPrivacy";
import { TelemetryReadScope } from "../../../../Server/Utils/Telemetry/TelemetryReadScope";
import AnalyticsTableName from "../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import LlmConnectionProvider from "../../../../Types/LlmObservability/LlmConnectionProvider";
import LlmConversationReaders from "../../../../Types/LlmObservability/LlmConversationReaders";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";

/*
 * What a company's people wrote to its AI tools is read by project owners
 * and admins only, unless the connection lets everyone read it: the tool's
 * service is blocked in everyone else's telemetry read scope, for every
 * read of spans - the one scope the model reads, the /telemetry/* routes,
 * the conversation routes and the AI tools apply. Deleted connections keep
 * their chats restricted; provider accounts restrict nothing.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_PROJECT: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const USER: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const CLAUDE_SERVICE: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COPILOT_SERVICE: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OPENAI_SERVICE: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OPEN_SERVICE: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

interface Row {
  serviceId: string | null;
  provider: string | null;
  conversationReaders: string | null;
}

const PROJECT_ROWS: Array<Row> = [
  {
    serviceId: CLAUDE_SERVICE.toUpperCase(),
    provider: LlmConnectionProvider.ClaudeEnterprise,
    conversationReaders: LlmConversationReaders.Admins,
  },
  {
    serviceId: COPILOT_SERVICE,
    provider: LlmConnectionProvider.Microsoft365Copilot,
    conversationReaders: null,
  },
  {
    serviceId: OPENAI_SERVICE,
    provider: LlmConnectionProvider.OpenAI,
    conversationReaders: LlmConversationReaders.Admins,
  },
  {
    serviceId: OPEN_SERVICE,
    provider: LlmConnectionProvider.ClaudeEnterprise,
    conversationReaders: LlmConversationReaders.Everyone,
  },
];

let query: jest.Mock;

function grant(
  permission: Permission,
  scope?: PermissionScope,
): UserPermission {
  return {
    _type: "UserPermission",
    permission,
    scope,
    labelIds: [],
    isBlockPermission: false,
  };
}

function propsFor(
  permissions: Array<UserPermission>,
  projectId: ObjectID = PROJECT,
): DatabaseCommonInteractionProps {
  return {
    tenantId: projectId,
    userId: USER,
    userTenantAccessPermission: {
      [projectId.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId,
        permissions,
      },
    },
  };
}

async function scopeOf(
  props: DatabaseCommonInteractionProps,
  modelType: AnalyticsBaseModelType = Span,
): Promise<TelemetryReadScope> {
  return await AnalyticsModelPermission.getReadScope(
    modelType,
    props,
    DatabaseRequestType.Read,
  );
}

beforeEach(() => {
  LlmConversationPrivacy.clearCache();
  query = jest.fn(async (_sql: unknown, params: unknown) => {
    return (params as Array<string>)[0] === PROJECT.toString()
      ? PROJECT_ROWS
      : [];
  });
  jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
  jest
    .spyOn(PostgresAppInstance, "getDataSource")
    .mockReturnValue({ query } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  LlmConversationPrivacy.clearCache();
});

describe("Which services are restricted", () => {
  test("company AI tools are, unless everyone may read them; provider accounts never are", () => {
    expect(
      LlmConversationPrivacy.getRestrictedServiceIdsOfRows(PROJECT_ROWS),
    ).toEqual([CLAUDE_SERVICE, COPILOT_SERVICE].sort());
  });

  test("a row without a service or with an unknown provider restricts nothing", () => {
    expect(
      LlmConversationPrivacy.getRestrictedServiceIdsOfRows([
        {
          serviceId: null,
          provider: LlmConnectionProvider.ClaudeEnterprise,
          conversationReaders: null,
        },
        {
          serviceId: OPENAI_SERVICE,
          provider: "openrouter",
          conversationReaders: null,
        },
      ]),
    ).toEqual([]);
  });

  test("the rows are read from Postgres - deleted connections included - and cached per project", async () => {
    expect(
      await LlmConversationPrivacy.getRestrictedServiceIds(PROJECT),
    ).toEqual([CLAUDE_SERVICE, COPILOT_SERVICE].sort());
    await LlmConversationPrivacy.getRestrictedServiceIds(PROJECT);

    expect(query).toHaveBeenCalledTimes(1);
    const sql: string = query.mock.calls[0]![0] as string;
    expect(sql).toContain('FROM "LlmObservabilityConnection"');
    expect(sql).toContain('"projectId" = $1');
    // No deletedAt filter: a deleted connection's chats stay restricted.
    expect(sql).not.toContain("deletedAt");
    // Never a secret.
    expect(sql).not.toContain("secrets");
    expect(query.mock.calls[0]![1]).toEqual([PROJECT.toString()]);

    LlmConversationPrivacy.invalidate(PROJECT);
    await LlmConversationPrivacy.getRestrictedServiceIds(PROJECT);
    expect(query).toHaveBeenCalledTimes(2);
  });

  test("a failed lookup fails the read rather than letting it through", async () => {
    query.mockRejectedValueOnce(new Error("connection reset") as never);

    await expect(
      scopeOf(propsFor([grant(Permission.ProjectMember, PermissionScope.All)])),
    ).rejects.toThrow("connection reset");
  });

  test("before Postgres is connected nothing is restricted, and nothing is cached", async () => {
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(false);

    expect(
      await LlmConversationPrivacy.getRestrictedServiceIds(PROJECT),
    ).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("Who reads them", () => {
  test("a member who reads every trace still never reads a company AI tool's chats", async () => {
    const scope: TelemetryReadScope = await scopeOf(
      propsFor([grant(Permission.ProjectMember, PermissionScope.All)]),
    );

    expect(scope.readableIds).toBeNull();
    expect([...scope.blockedIds].sort()).toEqual(
      [CLAUDE_SERVICE, COPILOT_SERVICE].sort(),
    );
  });

  test.each([[Permission.ProjectOwner], [Permission.ProjectAdmin]])(
    "%s reads them",
    async (permission: Permission) => {
      const scope: TelemetryReadScope = await scopeOf(
        propsFor([grant(permission)]),
      );

      expect(scope.blockedIds).toEqual([]);
      expect(query).not.toHaveBeenCalled();
    },
  );

  test("root and master admins read them", async () => {
    expect((await scopeOf({ isRoot: true })).blockedIds).toEqual([]);
    expect(
      (
        await scopeOf({
          ...propsFor([grant(Permission.ProjectMember)]),
          isMasterAdmin: true,
        })
      ).blockedIds,
    ).toEqual([]);
  });

  test("only reads of spans are held to it: logs and metrics are not where chats are kept", async () => {
    expect(LLM_CONVERSATION_TABLES).toEqual([AnalyticsTableName.Span]);

    for (const modelType of [Log, Metric]) {
      const scope: TelemetryReadScope = await scopeOf(
        propsFor([grant(Permission.ProjectMember, PermissionScope.All)]),
        modelType as unknown as AnalyticsBaseModelType,
      );
      expect(scope.blockedIds).toEqual([]);
    }
  });

  test("a narrowed reader loses the restricted services from what they may read", () => {
    const scope: TelemetryReadScope = LlmConversationPrivacy.blockServices(
      { readableIds: [CLAUDE_SERVICE, OPENAI_SERVICE], blockedIds: ["x"] },
      [CLAUDE_SERVICE.toUpperCase()],
    );

    expect(scope.readableIds).toEqual([OPENAI_SERVICE]);
    expect([...scope.blockedIds].sort()).toEqual([CLAUDE_SERVICE, "x"].sort());
  });

  test("a read across the caller's projects blocks each project's tools where the caller is not an admin", async () => {
    const props: DatabaseCommonInteractionProps = {
      userId: USER,
      userTenantAccessPermission: {
        [PROJECT.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId: PROJECT,
          permissions: [grant(Permission.ProjectMember, PermissionScope.All)],
        },
        [OTHER_PROJECT.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId: OTHER_PROJECT,
          permissions: [grant(Permission.ProjectOwner)],
        },
      },
    };

    expect(LlmConversationPrivacy.getProjectsOfRead(props).map(String)).toEqual(
      [PROJECT.toString(), OTHER_PROJECT.toString()],
    );
    expect(LlmConversationPrivacy.mayReadRestricted(props, PROJECT)).toBe(
      false,
    );
    expect(LlmConversationPrivacy.mayReadRestricted(props, OTHER_PROJECT)).toBe(
      true,
    );

    const scope: TelemetryReadScope =
      await LlmConversationPrivacy.restrictScope({
        scope: { readableIds: null, blockedIds: [] },
        props,
      });

    expect([...scope.blockedIds].sort()).toEqual(
      [CLAUDE_SERVICE, COPILOT_SERVICE].sort(),
    );
    // The project where the caller is the owner was not even asked about.
    expect(query).toHaveBeenCalledTimes(1);
  });

  test("a project with no AI tool connection changes nothing", async () => {
    const scope: TelemetryReadScope = await scopeOf(
      propsFor(
        [grant(Permission.ProjectMember, PermissionScope.All)],
        OTHER_PROJECT,
      ),
    );

    expect(scope).toEqual({ readableIds: null, blockedIds: [] });
  });
});

describe("LlmConversationPrivacy load order", () => {
  /*
   * Every read of spans reaches this module through the analytics
   * permission layer, which the services import. Importing a service from
   * here closed a cycle that left AnalyticsDatabaseService undefined for
   * whoever loaded MetricService first.
   */
  test("imports no service", () => {
    const source: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../Server/Utils/LlmObservability/LlmConversationPrivacy.ts",
      ),
      "utf8",
    );
    const imports: Array<string> = source
      .split("\n")
      .filter((line: string) => {
        return (
          line.trim().startsWith("} from ") || line.trim().startsWith("import ")
        );
      })
      .filter((line: string) => {
        return line.includes(" from ");
      });

    expect(imports.length).toBeGreaterThan(3);

    for (const line of imports) {
      expect(line).not.toContain("/Services/");
      expect(line).not.toContain("/Models/DatabaseModels/");
    }
  });
});
