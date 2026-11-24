import ChatMcpAccess, {
  ChatMcpServers,
  EXTERNAL_MCP_SERVERS_OUT_OF_REACH_SECTION,
  EXTERNAL_MCP_SERVERS_SECTION_HEADING,
} from "../../../../../Server/Utils/AI/Chat/ChatMcpAccess";
import { ChatExtraTool } from "../../../../../Server/Utils/AI/Chat/ChatAgentRunner";
import ToolOutputPager, {
  READ_TOOL_OUTPUT_TOOL_NAME,
} from "../../../../../Server/Utils/AI/Chat/ToolOutputPager";
import ExternalMcpServerService from "../../../../../Server/Services/ExternalMcpServerService";
import logger from "../../../../../Server/Utils/Logger";
import ExternalMcpServer from "../../../../../Models/DatabaseModels/ExternalMcpServer";
import AIChatPermissionMode from "../../../../../Types/AI/AIChatPermissionMode";
import {
  CALL_MCP_TOOL_TOOL_NAME,
  CALL_MCP_TOOL_WITH_APPROVAL_TOOL_NAME,
  LIST_MCP_TOOLS_TOOL_NAME,
} from "../../../../../Types/AI/ExternalMcpServer/ExternalMcpToolNames";
import { ExternalMcpServerAllowance } from "../../../../../Types/AI/ExternalMcpServer/ExternalMcpServerAllowance";
import ExternalMcpServerAuthType from "../../../../../Types/AI/ExternalMcpServer/ExternalMcpServerAuthType";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHAT ONE CHAT TURN MAY USE OF THE PROJECT'S EXTERNAL MCP SERVERS
 * (issue #10879): every server that is on, for a person who may read the
 * project's External MCP Servers - with the servers that are off named, so
 * a question about one is answered - and nothing, said so without naming a
 * server, for anyone else. Nothing here reaches a server: the tools connect
 * when they are first called.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5d000000-0000-4000-8000-000000000001",
);
const RUN_ID: ObjectID = new ObjectID("5d000000-0000-4000-8000-000000000002");

let onServers: Array<ExternalMcpServer> = [];
let offServers: Array<ExternalMcpServer> = [];
let allowances: Array<ExternalMcpServerAllowance> = [];

function server(name: string, isEnabled: boolean): ExternalMcpServer {
  const item: ExternalMcpServer = new ExternalMcpServer();
  item.id = ObjectID.generate();
  item.projectId = PROJECT_ID;
  item.name = name;
  item.description = `${name}'s tools.`;
  item.url = "https://mcp.example.com/mcp";
  item.authType = ExternalMcpServerAuthType.None;
  item.isEnabled = isEnabled;
  return item;
}

function props(permissions: Array<Permission>): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: ObjectID.generate(),
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        permissions: permissions.map((permission: Permission): JSONObject => {
          return {
            permission,
            labelIds: [],
            isBlockPermission: false,
            _type: "UserPermission",
          };
        }),
        _type: "UserTenantAccessPermission",
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

beforeEach(() => {
  onServers = [];
  offServers = [];
  allowances = [];

  jest
    .spyOn(ExternalMcpServerService, "findServersForRun")
    .mockImplementation((async (data: {
      allowance: ExternalMcpServerAllowance;
    }) => {
      allowances.push(data.allowance);
      return onServers;
    }) as never);
  jest.spyOn(ExternalMcpServerService, "findBy").mockImplementation((async (
    data: { query: JSONObject },
  ) => {
    return data.query["isEnabled"] === false ? offServers : onServers;
  }) as never);
  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function build(data?: {
  permissions?: Array<Permission> | undefined;
  permissionMode?: AIChatPermissionMode | undefined;
  hasReadToolOutput?: boolean | undefined;
}): Promise<ChatMcpServers | null> {
  return await ChatMcpAccess.buildForTurn({
    projectId: PROJECT_ID,
    aiRunId: RUN_ID,
    props: props(data?.permissions || [Permission.ProjectMember]),
    permissionMode:
      data?.permissionMode || AIChatPermissionMode.AskForApproval,
    outputPager: new ToolOutputPager(),
    hasReadToolOutput: data?.hasReadToolOutput === true,
  });
}

function names(tools: Array<ChatExtraTool>): Array<string> {
  return tools.map((tool: ChatExtraTool): string => {
    return tool.definition.name;
  });
}

describe("ChatMcpAccess.buildForTurn", () => {
  test("a project with no MCP server: nothing to offer, nothing to say", async () => {
    expect(await build()).toBeNull();
  });

  test("a project's servers that are on, every one of them: the tools, and what the turn may do with them", async () => {
    onServers = [server("Kubernetes", true), server("AWS", true)];

    const built: ChatMcpServers | null = await build();

    expect(allowances).toEqual([{ isEveryServer: true, serverIds: [] }]);
    expect(names(built!.extraTools)).toEqual([
      LIST_MCP_TOOLS_TOOL_NAME,
      CALL_MCP_TOOL_TOOL_NAME,
      CALL_MCP_TOOL_WITH_APPROVAL_TOOL_NAME,
      READ_TOOL_OUTPUT_TOOL_NAME,
    ]);
    expect(built!.instructions).toContain(EXTERNAL_MCP_SERVERS_SECTION_HEADING);
    expect(built!.instructions).toContain("- Kubernetes: Kubernetes's tools.");
    expect(built!.instructions).toContain("- AWS: AWS's tools.");
    expect(built!.instructions).not.toContain("Turned off for OneUptime AI");

    await built!.close();
  });

  test("read_tool_output is offered once: not again when the turn's commands offer it", async () => {
    onServers = [server("Kubernetes", true)];

    const built: ChatMcpServers | null = await build({
      hasReadToolOutput: true,
    });

    expect(names(built!.extraTools)).not.toContain(READ_TOOL_OUTPUT_TOOL_NAME);
  });

  test("a Read-only conversation is told it can only read through them", async () => {
    onServers = [server("Kubernetes", true)];

    const built: ChatMcpServers | null = await build({
      permissionMode: AIChatPermissionMode.ReadOnly,
    });

    expect(built!.instructions).toContain("This conversation is Read-only");
  });

  test("a Viewer reads through them", async () => {
    onServers = [server("Kubernetes", true)];

    const built: ChatMcpServers | null = await build({
      permissions: [Permission.Viewer],
    });

    expect(names(built!.extraTools)).toContain(CALL_MCP_TOOL_TOOL_NAME);
  });

  test("a person whose role may not read the project's External MCP Servers is offered none, told why, and no server is named", async () => {
    onServers = [server("Kubernetes", true)];
    offServers = [server("Staging", false)];

    const built: ChatMcpServers | null = await build({
      permissions: [Permission.ReadIncident],
    });

    expect(built!.extraTools).toEqual([]);
    expect(built!.instructions).toBe(EXTERNAL_MCP_SERVERS_OUT_OF_REACH_SECTION);
    expect(built!.instructions).not.toContain("Kubernetes");
    expect(built!.instructions).not.toContain("Staging");
  });

  test("servers that are off are named, so a question about one is answered", async () => {
    onServers = [server("Kubernetes", true)];
    offServers = [server("Staging", false), server("In-house\n", false)];

    const built: ChatMcpServers | null = await build();

    expect(built!.instructions).toContain(
      "Turned off for OneUptime AI (Let OneUptime AI use this server is off on its page): Staging, In-house.",
    );
  });

  test("every server off: no tools, and the turn says they are off and who can turn one on", async () => {
    offServers = [server("Staging", false)];

    const built: ChatMcpServers | null = await build();

    expect(built!.extraTools).toEqual([]);
    expect(built!.instructions).toContain(
      "Turned off for OneUptime AI (Let OneUptime AI use this server is off on its page): Staging.",
    );
    expect(built!.instructions).toContain(
      "a Project Admin can turn it on on the server's page",
    );
  });

  test("servers that cannot be read: nothing, and the turn answers from OneUptime's data", async () => {
    jest
      .spyOn(ExternalMcpServerService, "findServersForRun")
      .mockRejectedValue(new Error("database is down") as never);

    expect(await build()).toBeNull();
  });

  test("building the tools reaches no server", async () => {
    onServers = [server("Kubernetes", true)];

    const built: ChatMcpServers | null = await build();

    // An address no test serves: a connection would have failed the build.
    expect(built).not.toBeNull();
    await built!.close();
  });
});

describe("ChatMcpAccess.mayUseServers", () => {
  test("what reading the project's External MCP Servers takes", () => {
    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ]) {
      expect(
        ChatMcpAccess.mayUseServers({
          projectId: PROJECT_ID,
          props: props([permission]),
        }),
      ).toBe(true);
    }

    expect(
      ChatMcpAccess.mayUseServers({
        projectId: PROJECT_ID,
        props: props([Permission.ReadIncident]),
      }),
    ).toBe(false);
  });
});
