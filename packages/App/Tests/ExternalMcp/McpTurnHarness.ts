import ChatAgentRunner, {
  ChatTurnRequest,
  ResumeToolDecision,
} from "Common/Server/Utils/AI/Chat/ChatAgentRunner";
import ExternalMcpServerCheck from "Common/Server/Utils/AI/Mcp/ExternalMcpServerCheck";
import ExternalMcpServerConnection from "Common/Server/Utils/AI/Mcp/ExternalMcpServerConnection";
import { clearMcpSignInCachesForTests } from "Common/Server/Utils/AI/Mcp/McpSignIn";
import AiContextReader from "Common/Server/Utils/AI/AiContext/AiContextReader";
import AIRunLimitsReader from "Common/Server/Utils/AI/AIRunLimitsReader";
import AIService, {
  AILogRequest,
  AILogResponse,
} from "Common/Server/Services/AIService";
import AIConversationMessageService from "Common/Server/Services/AIConversationMessageService";
import AIConversationService from "Common/Server/Services/AIConversationService";
import AIRunEventService from "Common/Server/Services/AIRunEventService";
import AIRunService from "Common/Server/Services/AIRunService";
import ExternalMcpServerService from "Common/Server/Services/ExternalMcpServerService";
import ProjectService from "Common/Server/Services/ProjectService";
import logger from "Common/Server/Utils/Logger";
import { LLMToolDefinition } from "Common/Server/Utils/LLM/LLMService";
import AIConversation from "Common/Models/DatabaseModels/AIConversation";
import AIRun from "Common/Models/DatabaseModels/AIRun";
import ExternalMcpServer from "Common/Models/DatabaseModels/ExternalMcpServer";
import Project from "Common/Models/DatabaseModels/Project";
import AIAgentRunLimitsHelper from "Common/Types/AI/AIAgentRunLimits";
import AIChatMessageStatus from "Common/Types/AI/AIChatMessageStatus";
import AIChatPermissionMode from "Common/Types/AI/AIChatPermissionMode";
import AIRunStatus from "Common/Types/AI/AIRunStatus";
import {
  AIChatCitation,
  AIChatToolAction,
  AIRunPausedState,
} from "Common/Types/AI/AIChatTypes";
import ExternalMcpServerAuthType from "Common/Types/AI/ExternalMcpServer/ExternalMcpServerAuthType";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import PositiveNumber from "Common/Types/PositiveNumber";
import { LocalMcpHttpTransport } from "Common/Tests/Helpers/FakeMcpServer";
import { jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * WHAT AN ASK AI TURN NEEDS AROUND IT, for the tests of the project's
 * external MCP servers in Ask AI and in an incident's investigation box:
 * the turn itself is the real one (ChatAgentRunner), the servers are real
 * processes (LocalMcpServerProcess), and the model is a script - each
 * answer it gives, in order. What stands in for the database is only what
 * a turn reads and writes of its own: the run, its messages, its
 * conversation, and the project's stored servers.
 *
 * The production transport refuses the loopback address the fixture
 * listens on (the egress guard), so each connection is handed the tests'
 * loopback transport, as the client's own suites do.
 */

export const PROJECT_ID: ObjectID = new ObjectID(
  "10879000-0000-4000-8000-000000000001",
);

export const KUBERNETES_SERVER_ID: string =
  "10879000-0000-4000-8000-0000000000a1";
export const SECOND_SERVER_ID: string = "10879000-0000-4000-8000-0000000000a2";

export const SERVER_TOKEN: string = "fixture-bearer-token-10879";

// What every model answer stands on: a tool call, or the answer itself.
export interface ScriptedToolCall {
  id: string;
  name: string;
  arguments: JSONObject;
}

export function toolCallsAnswer(
  toolCalls: Array<ScriptedToolCall>,
): AILogResponse {
  return {
    content: "",
    toolCalls,
    stopReason: "tool_use",
    llmLog: { totalTokens: 10, costInUSDCents: 1 },
  } as unknown as AILogResponse;
}

export function finalAnswer(content: string): AILogResponse {
  return {
    content,
    stopReason: "end_turn",
    llmLog: { totalTokens: 10, costInUSDCents: 1 },
  } as unknown as AILogResponse;
}

// A person's props in the project, holding these permissions.
export function personProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: new ObjectID("10879000-0000-4000-8000-0000000000b1"),
    userGlobalAccessPermission: {
      globalPermissions: [Permission.Public],
      projectIds: [PROJECT_ID],
      _type: "UserGlobalAccessPermission",
    },
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

// A stored server, as the project's admins saved it.
export function storedServer(data: {
  id?: string | undefined;
  name: string;
  url: string;
  description?: string | undefined;
  isEnabled?: boolean | undefined;
  token?: string | undefined;
}): ExternalMcpServer {
  const server: ExternalMcpServer = new ExternalMcpServer();
  server.id = new ObjectID(data.id || KUBERNETES_SERVER_ID);
  server.projectId = PROJECT_ID;
  server.name = data.name;

  if (data.description) {
    server.description = data.description;
  }

  server.url = data.url;
  server.authType = ExternalMcpServerAuthType.BearerToken;
  server.bearerToken = data.token ?? SERVER_TOKEN;
  server.isEnabled = data.isEnabled ?? true;
  return server;
}

/*
 * One answer of the scripted model: as it is, or worked out when the model
 * is asked - after something a test does at that moment.
 */
export type ScriptedAnswer = AILogResponse | (() => Promise<AILogResponse>);

export interface TurnHarness {
  // The model's answers, in order; once they run out it answers "Done.".
  script: (answers: Array<ScriptedAnswer>) => void;
  // The steps the turn recorded in its activity, in order.
  runEvents: () => Array<JSONObject>;
  llmRequests: () => Array<AILogRequest>;
  // Every connection a turn opened to a server, by the server it reached.
  connectionsOpened: () => Array<string>;
  // What a turn wrote of its run: its pause for approval, when it paused.
  pausedState: () => AIRunPausedState | undefined;
  finalized: () => JSONObject | undefined;
  // The tool actions a turn last wrote on its message.
  lastToolActions: () => Array<AIChatToolAction>;
  recordedFailures: () => Array<JSONObject>;
  // Enable AI, as the project reads now.
  setAiEnabled: (isEnabled: boolean) => void;
  setServers: (servers: Array<ExternalMcpServer>) => void;
  // The run as a resume reads it: waiting for approval, with what was paused.
  serveRunForResume: (pausedState: AIRunPausedState) => void;
  // A turn's own time limit, as the project's limits say it.
  setTurnTimeLimitMs: (milliseconds: number) => void;
}

export function installTurnHarness(): TurnHarness {
  clearMcpSignInCachesForTests();

  let answers: Array<ScriptedAnswer> = [];
  let servers: Array<ExternalMcpServer> = [];
  let isAiEnabled: boolean = true;
  const connections: Array<string> = [];
  const failures: Array<JSONObject> = [];

  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest.spyOn(logger, "debug").mockImplementation((): void => {});
  jest.spyOn(logger, "info").mockImplementation((): void => {});

  const createEvent: SpyInstance<typeof AIRunEventService.create> = jest
    .spyOn(AIRunEventService, "create")
    .mockResolvedValue({} as never);
  jest.spyOn(AIRunService, "updateOneById").mockResolvedValue(1 as never);
  jest.spyOn(AiContextReader, "read").mockResolvedValue(null as never);

  const runningRun: AIRun = new AIRun();
  runningRun.status = AIRunStatus.Running;

  jest
    .spyOn(AIRunService, "findOneById")
    .mockResolvedValue(runningRun as never);
  const runUpdateOneBy: SpyInstance<typeof AIRunService.updateOneBy> = jest
    .spyOn(AIRunService, "updateOneBy")
    .mockResolvedValue(1 as never);

  jest
    .spyOn(AIConversationMessageService, "findBy")
    .mockResolvedValue([] as never);
  jest
    .spyOn(AIConversationMessageService, "countBy")
    .mockResolvedValue(new PositiveNumber(0) as never);
  jest
    .spyOn(AIConversationMessageService, "findOneBy")
    .mockResolvedValue(null as never);
  const messageUpdateOneBy: SpyInstance<
    typeof AIConversationMessageService.updateOneBy
  > = jest
    .spyOn(AIConversationMessageService, "updateOneBy")
    .mockResolvedValue(1 as never);

  jest
    .spyOn(AIConversationService, "findOneById")
    .mockResolvedValue(new AIConversation() as never);
  jest
    .spyOn(AIConversationService, "updateOneById")
    .mockResolvedValue(1 as never);

  // The project, as Enable AI reads it now.
  jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
    const project: Project = new Project(PROJECT_ID);
    project.enableAi = isAiEnabled;
    return project;
  }) as never);

  // A turn's limits: the defaults, unless a test sets its time limit.
  jest
    .spyOn(AIRunLimitsReader, "read")
    .mockResolvedValue(AIAgentRunLimitsHelper.getDefault() as never);

  // The project's stored servers, read as the database would hold them.
  jest
    .spyOn(ExternalMcpServerService, "findBy")
    .mockImplementation((async (data: { query: JSONObject }) => {
      return servers.filter((server: ExternalMcpServer): boolean => {
        if (
          typeof data.query["isEnabled"] === "boolean" &&
          data.query["isEnabled"] !== (server.isEnabled === true)
        ) {
          return false;
        }

        return (
          !data.query["projectId"] ||
          data.query["projectId"].toString() === PROJECT_ID.toString()
        );
      });
    }) as never);

  jest
    .spyOn(ExternalMcpServerCheck, "recordConnection")
    .mockImplementation((async (data: JSONObject) => {
      failures.push(data);
    }) as never);

  const realFromServer: typeof ExternalMcpServerConnection.fromServer =
    ExternalMcpServerConnection.fromServer.bind(ExternalMcpServerConnection);

  jest
    .spyOn(ExternalMcpServerConnection, "fromServer")
    .mockImplementation((server: ExternalMcpServer) => {
      connections.push(server.name || "");
      return realFromServer(server, {
        transport: new LocalMcpHttpTransport(),
      });
    });

  const executeWithLogging: SpyInstance<typeof AIService.executeWithLogging> =
    jest
      .spyOn(AIService, "executeWithLogging")
      .mockImplementation((async () => {
        const next: ScriptedAnswer | undefined = answers.shift();

        if (!next) {
          return finalAnswer("Done.");
        }

        return typeof next === "function" ? await next() : next;
      }) as never);

  return {
    script: (next: Array<ScriptedAnswer>): void => {
      answers = [...next];
    },
    runEvents: (): Array<JSONObject> => {
      return createEvent.mock.calls.map((call: Array<unknown>): JSONObject => {
        return ((call[0] as { data?: JSONObject }).data || {}) as JSONObject;
      });
    },
    llmRequests: (): Array<AILogRequest> => {
      return executeWithLogging.mock.calls.map(
        (call: Array<unknown>): AILogRequest => {
          return call[0] as AILogRequest;
        },
      );
    },
    connectionsOpened: (): Array<string> => {
      return connections;
    },
    pausedState: (): AIRunPausedState | undefined => {
      for (const call of runUpdateOneBy.mock.calls) {
        const data: JSONObject = (call[0] as { data: JSONObject }).data;

        if (data["status"] === AIRunStatus.WaitingForApproval) {
          return data["pausedState"] as unknown as AIRunPausedState;
        }
      }

      return undefined;
    },
    finalized: (): JSONObject | undefined => {
      for (const call of messageUpdateOneBy.mock.calls) {
        const data: JSONObject = (call[0] as { data: JSONObject }).data;

        if (data["status"] === AIChatMessageStatus.Completed) {
          return data;
        }
      }

      return undefined;
    },
    lastToolActions: (): Array<AIChatToolAction> => {
      const calls: Array<Array<unknown>> = messageUpdateOneBy.mock.calls;

      for (let index: number = calls.length - 1; index >= 0; index--) {
        const data: JSONObject = (calls[index]![0] as { data: JSONObject })
          .data;

        if (data["toolActions"]) {
          return data["toolActions"] as unknown as Array<AIChatToolAction>;
        }
      }

      return [];
    },
    recordedFailures: (): Array<JSONObject> => {
      return failures;
    },
    setAiEnabled: (isEnabled: boolean): void => {
      isAiEnabled = isEnabled;
    },
    setServers: (next: Array<ExternalMcpServer>): void => {
      servers = next;
    },
    serveRunForResume: (pausedState: AIRunPausedState): void => {
      const run: AIRun = new AIRun();
      run.status = AIRunStatus.WaitingForApproval;
      run.pausedState = pausedState;

      jest
        .spyOn(AIRunService, "findOneById")
        .mockResolvedValueOnce(run as never)
        .mockResolvedValue(runningRun as never);
    },
    setTurnTimeLimitMs: (milliseconds: number): void => {
      jest.spyOn(AIRunLimitsReader, "read").mockResolvedValue({
        ...AIAgentRunLimitsHelper.getDefault(),
        maxWallClockMs: milliseconds,
      } as never);
    },
  };
}

// A personal Ask AI turn, as the AI chat API starts one.
export function askAiTurn(
  overrides?: Partial<ChatTurnRequest> | undefined,
): ChatTurnRequest {
  return {
    projectId: PROJECT_ID,
    userId: new ObjectID("10879000-0000-4000-8000-0000000000b1"),
    conversationId: new ObjectID("10879000-0000-4000-8000-0000000000c1"),
    assistantMessageId: new ObjectID("10879000-0000-4000-8000-0000000000c2"),
    aiRunId: new ObjectID("10879000-0000-4000-8000-0000000000c3"),
    permissionMode: AIChatPermissionMode.AskForApproval,
    props: personProps([Permission.ProjectMember]),
    offersPageInfrastructure: true,
    offersExternalMcpServers: true,
    ...overrides,
  } as ChatTurnRequest;
}

export async function resumeWith(
  request: ChatTurnRequest,
  decisions: Array<ResumeToolDecision>,
): Promise<void> {
  await ChatAgentRunner.resumeTurn(request, decisions);
}

export function toolNamesOffered(request: AILogRequest): Array<string> {
  return (request.tools || []).map((tool: LLMToolDefinition): string => {
    return tool.name;
  });
}

export function systemPromptOf(request: AILogRequest): string {
  return request.messages[0]!.content;
}

// What the model was handed back for one tool call, as it read it.
export function toolResultFor(
  request: AILogRequest,
  toolCallId: string,
): string {
  for (const message of request.messages) {
    if (message.role === "tool" && message.toolCallId === toolCallId) {
      return message.content;
    }
  }

  return "";
}

export function citationsOf(
  finalized: JSONObject | undefined,
): Array<AIChatCitation> {
  return ((finalized?.["citations"] as unknown) || []) as Array<AIChatCitation>;
}
