import ChatAgentRunner, {
  ChatTurnRequest,
} from "../../../../Server/Utils/AI/Chat/ChatAgentRunner";
import ChatInfrastructureAccess from "../../../../Server/Utils/AI/Chat/ChatInfrastructureAccess";
import AiContextReader from "../../../../Server/Utils/AI/AiContext/AiContextReader";
import AIService, {
  AILogResponse,
} from "../../../../Server/Services/AIService";
import AIConversationMessageService from "../../../../Server/Services/AIConversationMessageService";
import AIConversationService from "../../../../Server/Services/AIConversationService";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../Server/Services/AIRunService";
import AlertService from "../../../../Server/Services/AlertService";
import AlertSeverityService from "../../../../Server/Services/AlertSeverityService";
import HostService from "../../../../Server/Services/HostService";
import { LLMToolDefinition } from "../../../../Server/Utils/LLM/LLMService";
import AIConversation from "../../../../Models/DatabaseModels/AIConversation";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import Host from "../../../../Models/DatabaseModels/Host";
import AIChatPageContextType, {
  AIChatPageContext,
} from "../../../../Types/AI/AIChatPageContext";
import AIChatPermissionMode from "../../../../Types/AI/AIChatPermissionMode";
import { AIResourceType } from "../../../../Types/AI/AIResourceContext";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import {
  AIChatToolAction,
  AIChatToolActionStatus,
  AIChatWidget,
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
 * ISSUE #5301, THROUGH THE WHOLE CHAT TURN.
 *
 * On host test01's page the customer asked Ask AI "Create alert on high ram
 * 75%", and was told it had no tool to create alerts, though the same chat
 * declared incidents. Now, with create_alert asked for on that page:
 *
 *   - nothing is created before the person approves: the action is
 *     prepared first, the page's host and the severity the alert takes
 *     written into the arguments, and the approval card says what the host
 *     is ("Linked to host "test01".");
 *   - what was approved is what runs: resumed after approval, the alert is
 *     created linked to test01 with that severity, as the person who
 *     approved, and the chat shows its card;
 *   - skipped, nothing is created; in Auto-run the same arguments run at
 *     once; in Read-only the tool is never offered, and named anyway it
 *     creates nothing.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

type SpyInstance = jest.SpyInstance;

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const HOST_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ALERT_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const HIGH_ID: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const LOW_ID: string = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const HOST_PAGE: AIChatPageContext = {
  type: AIChatPageContextType.Resource,
  resourceType: AIResourceType.Host,
  entityId: HOST_ID,
  entityTitle: "test01",
};

const RAISE_CALL: { id: string; name: string; arguments: JSONObject } = {
  id: "call-raise",
  name: "create_alert",
  arguments: {
    title: "High memory usage on test01",
    description: "Memory in use on test01 has been at 78% for 20 minutes.",
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
  hostFindBy: SpyInstance;
  severityFindBy: SpyInstance;
  alertCreate: SpyInstance;
}

function severity(id: string, name: string, order: number): AlertSeverity {
  const row: AlertSeverity = new AlertSeverity();
  row._id = id;
  row.name = name;
  row.order = order;
  return row;
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

  jest.spyOn(AIRunService, "findOneById").mockResolvedValue(run as never);
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

  // A new project's alert severities, in their order.
  const severityFindBy: SpyInstance = jest
    .spyOn(AlertSeverityService, "findBy")
    .mockResolvedValue([
      severity(HIGH_ID, "High", 1),
      severity(LOW_ID, "Low", 2),
    ] as never);

  const alertCreate: SpyInstance = jest
    .spyOn(AlertService, "create")
    .mockImplementation((async (args: { data: Alert }): Promise<Alert> => {
      const created: Alert = args.data;
      created._id = ALERT_ID;
      created.alertNumber = 12;
      created.alertNumberWithPrefix = "ALT-12";
      return created;
    }) as never);

  const executeWithLogging: SpyInstance = jest
    .spyOn(AIService, "executeWithLogging")
    .mockResolvedValue(response({ content: "Done." }) as never);

  return {
    executeWithLogging,
    messageUpdateOneBy,
    runUpdateOneBy,
    hostFindBy,
    severityFindBy,
    alertCreate,
  };
}

// The message as it was last saved: its tool actions and widgets.
function lastSaved(spies: Spies, field: string): Array<JSONObject> {
  let saved: Array<JSONObject> = [];

  for (const call of spies.messageUpdateOneBy.mock.calls) {
    const arg: { data?: JSONObject } = call[0] as { data?: JSONObject };
    const value: unknown = arg.data?.[field];

    if (Array.isArray(value)) {
      saved = value as Array<JSONObject>;
    }
  }

  return saved;
}

function lastToolActions(spies: Spies): Array<AIChatToolAction> {
  return lastSaved(spies, "toolActions") as unknown as Array<AIChatToolAction>;
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

function hostIdsOf(alert: Alert): Array<string> {
  return (alert.hosts || []).map((host: Host): string => {
    return host.id!.toString();
  });
}

// The tool names the model was offered on its first call.
function offeredToolNames(spies: Spies): Array<string> {
  const firstCall: { tools?: Array<LLMToolDefinition> } = spies
    .executeWithLogging.mock.calls[0]![0] as {
    tools?: Array<LLMToolDefinition>;
  };

  return (firstCall.tools || []).map((tool: LLMToolDefinition): string => {
    return tool.name;
  });
}

// Turn 1 on host test01's page: the model asks to raise the alert, and the turn pauses.
async function askAndPause(): Promise<AIRunPausedState> {
  const first: Spies = installSpies();
  first.executeWithLogging.mockResolvedValueOnce(
    response({ stopReason: "tool_use", toolCalls: [RAISE_CALL] }) as never,
  );
  await ChatAgentRunner.runTurn(buildRequest());
  const paused: AIRunPausedState = pausedStateOf(first);
  jest.restoreAllMocks();
  return paused;
}

function resumedRun(paused: AIRunPausedState): AIRun {
  const run: AIRun = new AIRun();
  run.status = AIRunStatus.WaitingForApproval;
  run.pausedState = paused;
  return run;
}

describe("Ask AI on a host's page raises an alert linked to the host (issue #5301)", () => {
  test("the model is offered create_alert beside create_incident when the conversation may act", async () => {
    const spies: Spies = installSpies();

    await ChatAgentRunner.runTurn(buildRequest());

    const offered: Array<string> = offeredToolNames(spies);
    expect(offered).toContain("create_alert");
    expect(offered).toContain("create_incident");
  });

  test("the approval card names the host, and the arguments it approves link it with the severity it takes", async () => {
    const spies: Spies = installSpies();
    spies.executeWithLogging.mockResolvedValueOnce(
      response({ stopReason: "tool_use", toolCalls: [RAISE_CALL] }) as never,
    );
    const request: ChatTurnRequest = buildRequest();

    await ChatAgentRunner.runTurn(request);

    // Nothing is created before the person approves.
    expect(spies.alertCreate).not.toHaveBeenCalled();

    const actions: Array<AIChatToolAction> = lastToolActions(spies);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.toolName).toBe("create_alert");
    expect(actions[0]!.status).toBe(AIChatToolActionStatus.Pending);
    expect(actions[0]!.requiresApproval).toBe(true);
    expect(actions[0]!.title).toBe("Create alert: High memory usage on test01");
    expect(actions[0]!.description).toBe('Linked to host "test01".');
    expect(actions[0]!.arguments).toEqual({
      ...RAISE_CALL.arguments,
      affectedResources: [{ resourceType: "Host", resourceId: HOST_ID }],
      severityName: "High",
    });

    // The host and the severities were read as the person asking.
    expect(
      (spies.hostFindBy.mock.calls[0]![0] as { props: unknown }).props,
    ).toBe(request.props);
    expect(
      (spies.severityFindBy.mock.calls[0]![0] as { props: unknown }).props,
    ).toBe(request.props);

    // What is persisted for the resume runs exactly what the card shows.
    const paused: AIRunPausedState = pausedStateOf(spies);
    const pending: Array<{ arguments: JSONObject }> =
      paused.pendingToolCalls as unknown as Array<{ arguments: JSONObject }>;
    expect(pending[0]!.arguments).toEqual(actions[0]!.arguments);
  });

  test("approved, the alert is created linked to test01, with that severity, as the person who approved, and the chat shows its card", async () => {
    const paused: AIRunPausedState = await askAndPause();
    const spies: Spies = installSpies({ run: resumedRun(paused) });
    spies.executeWithLogging.mockResolvedValueOnce(
      response({
        content: "Raised alert ALT-12, linked to host test01 [C1].",
      }) as never,
    );

    const decider: ChatTurnRequest = buildRequest();
    await ChatAgentRunner.resumeTurn(decider, [
      { toolCallId: RAISE_CALL.id, approved: true },
    ]);

    expect(spies.alertCreate).toHaveBeenCalledTimes(1);
    const args: { data: Alert; props: unknown } = spies.alertCreate.mock
      .calls[0]![0] as { data: Alert; props: unknown };
    expect(args.data.title).toBe("High memory usage on test01");
    expect(hostIdsOf(args.data)).toEqual([HOST_ID]);
    expect(args.data.alertSeverityId?.toString()).toBe(HIGH_ID);
    expect(args.props).toBe(decider.props);

    const actions: Array<AIChatToolAction> = lastToolActions(spies);
    expect(actions[0]!.status).toBe(AIChatToolActionStatus.Executed);

    // The card the chat draws under the answer: the alert, by its number.
    const widgets: Array<AIChatWidget> = lastSaved(
      spies,
      "widgets",
    ) as unknown as Array<AIChatWidget>;
    expect(widgets).toHaveLength(1);
    expect(widgets[0]!.data["heading"]).toBe(
      "ALT-12 · High memory usage on test01",
    );
    expect(widgets[0]!.data["resourceType"]).toBe("Alert");
  });

  test("skipped, nothing is created", async () => {
    const paused: AIRunPausedState = await askAndPause();
    const spies: Spies = installSpies({ run: resumedRun(paused) });
    spies.executeWithLogging.mockResolvedValueOnce(
      response({ content: "Understood, no alert was raised." }) as never,
    );

    await ChatAgentRunner.resumeTurn(buildRequest(), [
      { toolCallId: RAISE_CALL.id, approved: false },
    ]);

    expect(spies.alertCreate).not.toHaveBeenCalled();
    expect(lastToolActions(spies)[0]!.status).toBe(
      AIChatToolActionStatus.Denied,
    );
  });

  test("in Auto-run the prepared arguments run at once", async () => {
    const spies: Spies = installSpies();
    spies.executeWithLogging.mockResolvedValueOnce(
      response({ stopReason: "tool_use", toolCalls: [RAISE_CALL] }) as never,
    );

    await ChatAgentRunner.runTurn(
      buildRequest({ permissionMode: AIChatPermissionMode.AutoRun }),
    );

    expect(spies.alertCreate).toHaveBeenCalledTimes(1);
    const alert: Alert = (
      spies.alertCreate.mock.calls[0]![0] as { data: Alert }
    ).data;
    expect(hostIdsOf(alert)).toEqual([HOST_ID]);
    expect(alert.alertSeverityId?.toString()).toBe(HIGH_ID);

    const actions: Array<AIChatToolAction> = lastToolActions(spies);
    expect(actions[0]!.description).toBe('Linked to host "test01".');
    expect(actions[0]!.status).toBe(AIChatToolActionStatus.Executed);
  });

  test("in Read-only the tool is never offered, and named anyway it creates nothing", async () => {
    const spies: Spies = installSpies();
    spies.executeWithLogging.mockResolvedValueOnce(
      response({ stopReason: "tool_use", toolCalls: [RAISE_CALL] }) as never,
    );

    await ChatAgentRunner.runTurn(
      buildRequest({ permissionMode: AIChatPermissionMode.ReadOnly }),
    );

    expect(offeredToolNames(spies)).not.toContain("create_alert");
    expect(spies.alertCreate).not.toHaveBeenCalled();

    const actions: Array<AIChatToolAction> = lastToolActions(spies);
    expect(actions[0]!.status).toBe(AIChatToolActionStatus.Denied);
    expect(actions[0]!.resultSummary).toBe("This conversation is read-only.");
  });
});
