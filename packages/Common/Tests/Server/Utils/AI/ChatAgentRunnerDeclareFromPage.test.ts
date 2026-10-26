import ChatAgentRunner, {
  ChatTurnRequest,
} from "../../../../Server/Utils/AI/Chat/ChatAgentRunner";
import ChatInfrastructureAccess from "../../../../Server/Utils/AI/Chat/ChatInfrastructureAccess";
import { CreateIncidentTool } from "../../../../Server/Utils/AI/Toolbox/IncidentWriteTools";
import AIToolbox from "../../../../Server/Utils/AI/Toolbox/Index";
import { ToolContext } from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import AiContextReader from "../../../../Server/Utils/AI/AiContext/AiContextReader";
import AIService, {
  AILogResponse,
} from "../../../../Server/Services/AIService";
import AIConversationMessageService from "../../../../Server/Services/AIConversationMessageService";
import AIConversationService from "../../../../Server/Services/AIConversationService";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../Server/Services/AIRunService";
import HostService from "../../../../Server/Services/HostService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import AIConversation from "../../../../Models/DatabaseModels/AIConversation";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Host from "../../../../Models/DatabaseModels/Host";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import AIChatPageContextType, {
  AIChatPageContext,
} from "../../../../Types/AI/AIChatPageContext";
import AIChatPermissionMode from "../../../../Types/AI/AIChatPermissionMode";
import { AIResourceType } from "../../../../Types/AI/AIResourceContext";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import {
  AIChatToolAction,
  AIChatToolActionStatus,
  AIRunPausedState,
} from "../../../../Types/AI/AIChatTypes";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { customDomainCaller } from "../../API/CustomDomainCallers";
import { ON_HIGHEST_PLAN } from "../../TestingUtils/RequestPlan";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * ISSUE #5293, THROUGH THE WHOLE CHAT TURN.
 *
 * On host test01's page, the user asks Ask AI "Declare an incident, high
 * memory usage" and approves. The incident used to be linked to nothing:
 * create_incident took no resources, so the investigation never reached
 * test01 and auto-remediation said there was nothing to fix. Now:
 *
 *   - the action is prepared before it is shown: the page's host is written
 *     into the arguments the person approves, and the approval card says
 *     "Linked to host "test01"." under the action's title;
 *   - what was approved is what runs: resumed after approval, the incident
 *     is created linked to test01, as the person who approved;
 *   - in Auto-run the same arguments run at once;
 *   - a tool reads the conversation's subject (ToolContext.pageContext),
 *     on the first turn and on the turn resumed after approval alike.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

type SpyInstance = jest.SpyInstance;

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const HOST_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const INCIDENT_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const HOST_PAGE: AIChatPageContext = {
  type: AIChatPageContextType.Resource,
  resourceType: AIResourceType.Host,
  entityId: HOST_ID,
  entityTitle: "test01",
};

const DECLARE_CALL: { id: string; name: string; arguments: JSONObject } = {
  id: "call-declare",
  name: "create_incident",
  arguments: {
    title: "High memory usage",
    description: "Memory on test01 has been above 95% for 20 minutes.",
  },
};

function response(data: {
  content?: string;
  stopReason?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: JSONObject }>;
}): AILogResponse {
  return {
    content: data.content ?? "",
    toolCalls: data.toolCalls,
    stopReason: data.stopReason,
    llmLog: { totalTokens: 10, costInUSDCents: 1 },
  } as unknown as AILogResponse;
}

// A project member, signed in: who asks, and who approves.
function memberProps(): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({
      permissions: [Permission.ProjectMember],
      projectId: PROJECT_ID,
    }),
    ...ON_HIGHEST_PLAN,
  };
}

// A personal Ask AI turn on host test01's page, as the AI chat API starts it.
function buildRequest(overrides?: Partial<ChatTurnRequest>): ChatTurnRequest {
  return {
    projectId: PROJECT_ID,
    userId: ObjectID.generate(),
    conversationId: ObjectID.generate(),
    assistantMessageId: ObjectID.generate(),
    aiRunId: ObjectID.generate(),
    permissionMode: AIChatPermissionMode.AskForApproval,
    props: memberProps(),
    pageContext: HOST_PAGE,
    offersPageInfrastructure: true,
    ...overrides,
  };
}

interface Spies {
  executeWithLogging: SpyInstance;
  messageUpdateOneBy: SpyInstance;
  runUpdateOneBy: SpyInstance;
  runFindOneById: SpyInstance;
  hostFindBy: SpyInstance;
  incidentCreate: SpyInstance;
}

function installSpies(data?: { run?: AIRun | undefined }): Spies {
  jest.spyOn(AIRunEventService, "create").mockResolvedValue({} as never);
  jest.spyOn(AIRunService, "updateOneById").mockResolvedValue(1 as never);
  jest.spyOn(AiContextReader, "read").mockResolvedValue(null as never);
  // The host's commands are another story (issue #5259): none here.
  jest
    .spyOn(ChatInfrastructureAccess, "buildForPage")
    .mockResolvedValue(null as never);

  const run: AIRun = data?.run ?? new AIRun();
  if (!data?.run) {
    run.status = AIRunStatus.Running;
  }

  const runFindOneById: SpyInstance = jest
    .spyOn(AIRunService, "findOneById")
    .mockResolvedValue(run as never);
  const runUpdateOneBy: SpyInstance = jest
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
  const messageUpdateOneBy: SpyInstance = jest
    .spyOn(AIConversationMessageService, "updateOneBy")
    .mockResolvedValue(1 as never);

  jest
    .spyOn(AIConversationService, "findOneById")
    .mockResolvedValue(new AIConversation() as never);
  jest
    .spyOn(AIConversationService, "updateOneById")
    .mockResolvedValue(1 as never);

  const host: Host = new Host();
  host._id = HOST_ID;
  host.name = "test01";
  host.isArchived = false;
  const hostFindBy: SpyInstance = jest
    .spyOn(HostService, "findBy")
    .mockResolvedValue([host] as never);

  const severity: IncidentSeverity = new IncidentSeverity();
  severity._id = ObjectID.generate().toString();
  severity.name = "SEV2";
  severity.order = 2;
  jest
    .spyOn(IncidentSeverityService, "findBy")
    .mockResolvedValue([severity] as never);

  const incidentCreate: SpyInstance = jest
    .spyOn(IncidentService, "create")
    .mockImplementation((async (args: {
      data: Incident;
    }): Promise<Incident> => {
      const created: Incident = args.data;
      created._id = INCIDENT_ID;
      created.incidentNumber = 12;
      return created;
    }) as never);

  const executeWithLogging: SpyInstance = jest
    .spyOn(AIService, "executeWithLogging")
    .mockResolvedValue(response({ content: "Done." }) as never);

  return {
    executeWithLogging,
    messageUpdateOneBy,
    runUpdateOneBy,
    runFindOneById,
    hostFindBy,
    incidentCreate,
  };
}

// The tool actions the message was last saved with.
function lastToolActions(spies: Spies): Array<AIChatToolAction> {
  let actions: Array<AIChatToolAction> = [];

  for (const call of spies.messageUpdateOneBy.mock.calls) {
    const arg: { data?: JSONObject } = call[0] as { data?: JSONObject };
    const saved: unknown = arg.data?.["toolActions"];

    if (Array.isArray(saved)) {
      actions = saved as unknown as Array<AIChatToolAction>;
    }
  }

  return actions;
}

// The state the run was paused with, for the resume.
function pausedStateOf(spies: Spies): AIRunPausedState {
  for (const call of spies.runUpdateOneBy.mock.calls) {
    const arg: { data?: JSONObject } = call[0] as { data?: JSONObject };

    if (arg.data?.["pausedState"]) {
      return arg.data["pausedState"] as unknown as AIRunPausedState;
    }
  }

  throw new Error("The run was never paused for approval.");
}

function hostIdsOf(incident: Incident): Array<string> {
  return (incident.hosts || []).map((host: Host): string => {
    return host.id!.toString();
  });
}

describe("Ask AI on a host's page declares an incident linked to the host (issue #5293)", () => {
  test("the approval card names the host, and the arguments it approves link it", async () => {
    const spies: Spies = installSpies();
    spies.executeWithLogging.mockResolvedValueOnce(
      response({ stopReason: "tool_use", toolCalls: [DECLARE_CALL] }) as never,
    );
    const request: ChatTurnRequest = buildRequest();

    await ChatAgentRunner.runTurn(request);

    // Nothing is created before the person approves.
    expect(spies.incidentCreate).not.toHaveBeenCalled();

    const actions: Array<AIChatToolAction> = lastToolActions(spies);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.status).toBe(AIChatToolActionStatus.Pending);
    expect(actions[0]!.requiresApproval).toBe(true);
    expect(actions[0]!.title).toBe("Create incident: High memory usage");
    expect(actions[0]!.description).toBe('Linked to host "test01".');
    expect(actions[0]!.arguments).toEqual({
      ...DECLARE_CALL.arguments,
      affectedResources: [{ resourceType: "Host", resourceId: HOST_ID }],
    });

    // The host was read as the person asking, to name it - never as root.
    const read: { props: unknown } = spies.hostFindBy.mock.calls[0]![0] as {
      props: unknown;
    };
    expect(read.props).toBe(request.props);

    // What is persisted for the resume runs exactly what the card shows.
    const paused: AIRunPausedState = pausedStateOf(spies);
    const pending: Array<{ arguments: JSONObject }> =
      paused.pendingToolCalls as unknown as Array<{ arguments: JSONObject }>;
    expect(pending[0]!.arguments).toEqual(actions[0]!.arguments);
  });

  test("approved, the incident is created linked to test01, as the person who approved", async () => {
    // Turn 1: the model asks to declare it, and the turn pauses.
    const first: Spies = installSpies();
    first.executeWithLogging.mockResolvedValueOnce(
      response({ stopReason: "tool_use", toolCalls: [DECLARE_CALL] }) as never,
    );
    await ChatAgentRunner.runTurn(buildRequest());
    const paused: AIRunPausedState = pausedStateOf(first);
    jest.restoreAllMocks();

    // Turn 1 resumed: the person approves.
    const run: AIRun = new AIRun();
    run.status = AIRunStatus.WaitingForApproval;
    run.pausedState = paused;
    const spies: Spies = installSpies({ run });
    spies.executeWithLogging.mockResolvedValueOnce(
      response({
        content: "Declared incident #12, linked to host test01 [C1].",
      }) as never,
    );

    const decider: ChatTurnRequest = buildRequest();
    await ChatAgentRunner.resumeTurn(decider, [
      { toolCallId: DECLARE_CALL.id, approved: true },
    ]);

    expect(spies.incidentCreate).toHaveBeenCalledTimes(1);
    const args: { data: Incident; props: unknown } = spies.incidentCreate.mock
      .calls[0]![0] as { data: Incident; props: unknown };
    expect(args.data.title).toBe("High memory usage");
    expect(hostIdsOf(args.data)).toEqual([HOST_ID]);
    expect(args.props).toBe(decider.props);

    const actions: Array<AIChatToolAction> = lastToolActions(spies);
    expect(actions[0]!.status).toBe(AIChatToolActionStatus.Executed);
  });

  test("in Auto-run the prepared arguments run at once", async () => {
    const spies: Spies = installSpies();
    spies.executeWithLogging.mockResolvedValueOnce(
      response({ stopReason: "tool_use", toolCalls: [DECLARE_CALL] }) as never,
    );

    await ChatAgentRunner.runTurn(
      buildRequest({ permissionMode: AIChatPermissionMode.AutoRun }),
    );

    expect(spies.incidentCreate).toHaveBeenCalledTimes(1);
    const incident: Incident = (
      spies.incidentCreate.mock.calls[0]![0] as { data: Incident }
    ).data;
    expect(hostIdsOf(incident)).toEqual([HOST_ID]);

    const actions: Array<AIChatToolAction> = lastToolActions(spies);
    expect(actions[0]!.description).toBe('Linked to host "test01".');
    expect(actions[0]!.status).toBe(AIChatToolActionStatus.Executed);
  });

  test("a call that names its own list keeps it: the model can declare one about something else", async () => {
    const spies: Spies = installSpies();
    spies.executeWithLogging.mockResolvedValueOnce(
      response({
        stopReason: "tool_use",
        toolCalls: [
          {
            ...DECLARE_CALL,
            arguments: { ...DECLARE_CALL.arguments, affectedResources: [] },
          },
        ],
      }) as never,
    );

    await ChatAgentRunner.runTurn(buildRequest());

    const actions: Array<AIChatToolAction> = lastToolActions(spies);
    expect(actions[0]!.arguments["affectedResources"]).toEqual([]);
    expect(actions[0]!.description).toBeUndefined();
    expect(spies.hostFindBy).not.toHaveBeenCalled();
  });

  test("a prepare that fails leaves the model's arguments, and the action is still asked about", async () => {
    const spies: Spies = installSpies();
    jest
      .spyOn(CreateIncidentTool, "prepareMutation")
      .mockRejectedValue(new Error("lookup failed") as never);
    spies.executeWithLogging.mockResolvedValueOnce(
      response({ stopReason: "tool_use", toolCalls: [DECLARE_CALL] }) as never,
    );

    await ChatAgentRunner.runTurn(buildRequest());

    const actions: Array<AIChatToolAction> = lastToolActions(spies);
    expect(actions[0]!.status).toBe(AIChatToolActionStatus.Pending);
    expect(actions[0]!.arguments).toEqual(DECLARE_CALL.arguments);
    expect(actions[0]!.description).toBeUndefined();
  });

  test("a read is never prepared, and every tool reads the conversation's subject", async () => {
    const spies: Spies = installSpies();
    const prepare: SpyInstance = jest.spyOn(
      CreateIncidentTool,
      "prepareMutation",
    );
    const execute: SpyInstance = jest
      .spyOn(AIToolbox, "executeTool")
      .mockResolvedValue({
        success: true,
        textForLlm: "No incidents.",
        result: {
          dataForLlm: "No incidents.",
          rowCount: 0,
          citationLabel: "Incidents",
          redactionCount: 0,
          isTruncated: false,
        },
      } as never);
    spies.executeWithLogging.mockResolvedValueOnce(
      response({
        stopReason: "tool_use",
        toolCalls: [
          { id: "call-read", name: "query_incidents", arguments: {} },
        ],
      }) as never,
    );

    await ChatAgentRunner.runTurn(buildRequest());

    expect(prepare).not.toHaveBeenCalled();
    const ctx: ToolContext = (execute.mock.calls[0]![0] as { ctx: ToolContext })
      .ctx;
    expect(ctx.pageContext).toEqual(HOST_PAGE);
    expect(ctx.projectId).toBe(PROJECT_ID);
  });

  test("a conversation that kept a host's page as its subject still links it", async () => {
    const spies: Spies = installSpies();
    const conversation: AIConversation = new AIConversation();
    conversation.pageContext = HOST_PAGE;
    jest
      .spyOn(AIConversationService, "findOneById")
      .mockResolvedValue(conversation as never);
    spies.executeWithLogging.mockResolvedValueOnce(
      response({ stopReason: "tool_use", toolCalls: [DECLARE_CALL] }) as never,
    );

    // Asked later from a page that sends no context (the AI Chat page).
    await ChatAgentRunner.runTurn(buildRequest({ pageContext: undefined }));

    expect(lastToolActions(spies)[0]!.description).toBe(
      'Linked to host "test01".',
    );
  });
});
