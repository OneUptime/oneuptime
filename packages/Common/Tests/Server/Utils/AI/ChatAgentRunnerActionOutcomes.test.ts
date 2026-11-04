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
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import AIConversation from "../../../../Models/DatabaseModels/AIConversation";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import AIChatPermissionMode from "../../../../Types/AI/AIChatPermissionMode";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import {
  AIChatToolAction,
  AIChatToolActionStatus,
  AIChatWidget,
  AIChatWidgetType,
  AIRunPausedState,
  AIToolRefusal,
} from "../../../../Types/AI/AIChatTypes";
import { isKnownAIActionCardWords } from "../../../../Types/AI/AIActionWords";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import PositiveNumber from "../../../../Types/PositiveNumber";
import logger from "../../../../Server/Utils/Logger";
import { customDomainCaller } from "../../API/CustomDomainCallers";
import { ON_HIGHEST_PLAN } from "../../TestingUtils/RequestPlan";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHAT AN ACTION DID, AS THE RUN RECORDS IT (#5315's follow-ups).
 *
 *   - A refused or failed action read as retried, and - approved, then
 *     refused - as done: its step said "did not succeed - retrying
 *     differently", and an "executed" line after it said "Declared an
 *     incident". The failed step now says why it was refused (refusal) and
 *     that it was an action (isAction), and only an action that ran is an
 *     executed action.
 *   - An action that ran names the card it left (widgetId), so the answer's
 *     list of actions does not say it again under that card.
 */

type SpyInstance = jest.SpyInstance;

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const INCIDENT_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const DECLARE_CALL: { id: string; name: string; arguments: JSONObject } = {
  id: "call-declare",
  name: "create_incident",
  arguments: { title: "Checkout down", affectedResources: [] },
};

const READ_CALL: { id: string; name: string; arguments: JSONObject } = {
  id: "call-read",
  name: "query_incidents",
  arguments: { state: "nonsense" },
};

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest.spyOn(logger, "debug").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

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

function memberProps(
  permissions: Array<Permission> = [Permission.ProjectMember],
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

function buildRequest(overrides?: Partial<ChatTurnRequest>): ChatTurnRequest {
  return {
    projectId: PROJECT_ID,
    userId: ObjectID.generate(),
    conversationId: ObjectID.generate(),
    assistantMessageId: ObjectID.generate(),
    aiRunId: ObjectID.generate(),
    permissionMode: AIChatPermissionMode.AskForApproval,
    props: memberProps(),
    ...overrides,
  };
}

interface Spies {
  executeWithLogging: SpyInstance;
  messageUpdateOneBy: SpyInstance;
  runUpdateOneBy: SpyInstance;
  eventCreate: SpyInstance;
  incidentCreate: SpyInstance;
}

function installSpies(data?: {
  run?: AIRun | undefined;
  createFails?: Error | undefined;
}): Spies {
  const eventCreate: SpyInstance = jest
    .spyOn(AIRunEventService, "create")
    .mockResolvedValue({} as never);
  jest.spyOn(AIRunService, "updateOneById").mockResolvedValue(1 as never);
  jest.spyOn(AiContextReader, "read").mockResolvedValue(null as never);
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

  const severity: IncidentSeverity = new IncidentSeverity();
  severity._id = ObjectID.generate().toString();
  severity.name = "SEV2";
  severity.order = 1;
  jest
    .spyOn(IncidentSeverityService, "findBy")
    .mockResolvedValue([severity] as never);

  const incidentCreate: SpyInstance = jest
    .spyOn(IncidentService, "create")
    .mockImplementation((async (args: {
      data: Incident;
    }): Promise<Incident> => {
      if (data?.createFails) {
        throw data.createFails;
      }

      const created: Incident = args.data;
      created._id = INCIDENT_ID;
      created.incidentNumber = 12;
      created.incidentNumberWithPrefix = "INC-12";
      return created;
    }) as never);

  const executeWithLogging: SpyInstance = jest
    .spyOn(AIService, "executeWithLogging")
    .mockResolvedValue(response({ content: "Done." }) as never);

  return {
    executeWithLogging,
    messageUpdateOneBy,
    runUpdateOneBy,
    eventCreate,
    incidentCreate,
  };
}

// The events the run wrote, in order.
function eventsOf(spies: Spies): Array<AIRunEvent> {
  return spies.eventCreate.mock.calls.map(
    (call: Array<unknown>): AIRunEvent => {
      return (call[0] as { data: AIRunEvent }).data;
    },
  );
}

function eventsOfType(spies: Spies, type: AIRunEventType): Array<AIRunEvent> {
  return eventsOf(spies).filter((event: AIRunEvent): boolean => {
    return event.eventType === type;
  });
}

// What the message was last saved with.
function lastSaved<T>(spies: Spies, key: string): T | undefined {
  let saved: T | undefined = undefined;

  for (const call of spies.messageUpdateOneBy.mock.calls) {
    const arg: { data?: JSONObject } = call[0] as { data?: JSONObject };

    if (arg.data && key in arg.data) {
      saved = arg.data[key] as unknown as T;
    }
  }

  return saved;
}

function pausedStateOf(spies: Spies): AIRunPausedState {
  for (const call of spies.runUpdateOneBy.mock.calls) {
    const arg: { data?: JSONObject } = call[0] as { data?: JSONObject };

    if (arg.data?.["pausedState"]) {
      return arg.data["pausedState"] as unknown as AIRunPausedState;
    }
  }

  throw new Error("The run was never paused for approval.");
}

// The declare, asked for and paused; then resumed with the person's yes.
async function approveTheDeclare(data: {
  createFails?: Error | undefined;
  props?: DatabaseCommonInteractionProps | undefined;
}): Promise<Spies> {
  const first: Spies = installSpies();
  first.executeWithLogging.mockResolvedValueOnce(
    response({ stopReason: "tool_use", toolCalls: [DECLARE_CALL] }) as never,
  );
  await ChatAgentRunner.runTurn(
    buildRequest(data.props ? { props: data.props } : {}),
  );
  const paused: AIRunPausedState = pausedStateOf(first);
  jest.restoreAllMocks();
  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest.spyOn(logger, "debug").mockImplementation((): void => {});

  const run: AIRun = new AIRun();
  run.status = AIRunStatus.WaitingForApproval;
  run.pausedState = paused;
  const spies: Spies = installSpies({ run, createFails: data.createFails });
  spies.executeWithLogging.mockResolvedValueOnce(
    response({ content: "Answered." }) as never,
  );

  await ChatAgentRunner.resumeTurn(
    buildRequest(data.props ? { props: data.props } : {}),
    [{ toolCallId: DECLARE_CALL.id, approved: true }],
  );

  return spies;
}

describe("an approved action that ran", () => {
  test("is an executed action, and names the card it left", async () => {
    const spies: Spies = await approveTheDeclare({});

    expect(spies.incidentCreate).toHaveBeenCalledTimes(1);
    expect(eventsOfType(spies, AIRunEventType.ActionExecuted)).toHaveLength(1);
    expect(eventsOfType(spies, AIRunEventType.ToolCallFailed)).toHaveLength(0);

    const actions: Array<AIChatToolAction> =
      lastSaved<Array<AIChatToolAction>>(spies, "toolActions") || [];
    const widgets: Array<AIChatWidget> =
      lastSaved<Array<AIChatWidget>>(spies, "widgets") || [];

    expect(actions[0]!.status).toBe(AIChatToolActionStatus.Executed);
    expect(widgets).toHaveLength(1);
    expect(widgets[0]!.type).toBe(AIChatWidgetType.ResourceCard);
    // The card it left, by its id: the answer's actions do not repeat it.
    expect(actions[0]!.widgetId).toBe(widgets[0]!.id);
    expect(widgets[0]!.id).toBe("W1");

    // The card says what it made in words the Dashboard can say.
    expect(isKnownAIActionCardWords(widgets[0]!.data.words)).toBe(true);
    expect(widgets[0]!.data.heading).toBe("INC-12 · Checkout down");
  });
});

describe("an approved action that was refused, or failed", () => {
  test.each([
    [
      "refused as not theirs to make",
      new NotAuthorizedException("You may not create this incident."),
      AIToolRefusal.NotAllowed,
    ],
    [
      "refused for the project's plan",
      new PaymentRequiredException("Please upgrade your plan to Growth."),
      AIToolRefusal.Plan,
    ],
  ])(
    "%s: its failed step says why, and nothing says it was done",
    async (_name: string, error: Error, refusal: AIToolRefusal) => {
      const spies: Spies = await approveTheDeclare({ createFails: error });

      const failed: Array<AIRunEvent> = eventsOfType(
        spies,
        AIRunEventType.ToolCallFailed,
      );
      expect(failed).toHaveLength(1);
      expect(failed[0]!.toolName).toBe("create_incident");
      expect(failed[0]!.resultSummary?.refusal).toBe(refusal);
      expect(failed[0]!.resultSummary?.isAction).toBe(true);

      // REGRESSION: an approved, refused declare left "Declared an incident".
      expect(eventsOfType(spies, AIRunEventType.ActionExecuted)).toHaveLength(
        0,
      );

      const actions: Array<AIChatToolAction> =
        lastSaved<Array<AIChatToolAction>>(spies, "toolActions") || [];
      expect(actions[0]!.status).toBe(AIChatToolActionStatus.Failed);
      expect(actions[0]!.widgetId).toBeUndefined();
    },
  );

  test("a person whose role may not create incidents: refused at the gate, for their role", async () => {
    const spies: Spies = await approveTheDeclare({
      props: memberProps([Permission.Viewer]),
    });

    const failed: Array<AIRunEvent> = eventsOfType(
      spies,
      AIRunEventType.ToolCallFailed,
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]!.resultSummary?.refusal).toBe(AIToolRefusal.Permission);
    expect(failed[0]!.resultSummary?.isAction).toBe(true);
    expect(spies.incidentCreate).not.toHaveBeenCalled();
    expect(eventsOfType(spies, AIRunEventType.ActionExecuted)).toHaveLength(0);
  });

  test("failed for another reason: an action that was not done, with no refusal", async () => {
    const spies: Spies = await approveTheDeclare({
      createFails: new Error("The incident could not be saved."),
    });

    const failed: Array<AIRunEvent> = eventsOfType(
      spies,
      AIRunEventType.ToolCallFailed,
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]!.resultSummary?.refusal).toBeUndefined();
    expect(failed[0]!.resultSummary?.isAction).toBe(true);
    expect(eventsOfType(spies, AIRunEventType.ActionExecuted)).toHaveLength(0);
  });
});

describe("in Auto-run, and for a read", () => {
  test("an action that fails in Auto-run is an action that was not done", async () => {
    const spies: Spies = installSpies({
      createFails: new NotAuthorizedException("You may not."),
    });
    spies.executeWithLogging.mockResolvedValueOnce(
      response({ stopReason: "tool_use", toolCalls: [DECLARE_CALL] }) as never,
    );

    await ChatAgentRunner.runTurn(
      buildRequest({ permissionMode: AIChatPermissionMode.AutoRun }),
    );

    const failed: Array<AIRunEvent> = eventsOfType(
      spies,
      AIRunEventType.ToolCallFailed,
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]!.resultSummary?.isAction).toBe(true);
    expect(failed[0]!.resultSummary?.refusal).toBe(AIToolRefusal.NotAllowed);
  });

  test("a read that fails is no action, and was not refused: the model may try it another way", async () => {
    const spies: Spies = installSpies();
    spies.executeWithLogging.mockResolvedValueOnce(
      response({ stopReason: "tool_use", toolCalls: [READ_CALL] }) as never,
    );
    jest
      .spyOn(IncidentService, "findBy")
      .mockRejectedValue(new Error("state must be active") as never);

    await ChatAgentRunner.runTurn(buildRequest());

    const failed: Array<AIRunEvent> = eventsOfType(
      spies,
      AIRunEventType.ToolCallFailed,
    );

    expect(failed.length).toBeGreaterThan(0);

    for (const event of failed) {
      expect(event.resultSummary?.isAction).toBeUndefined();
      expect(event.resultSummary?.refusal).toBeUndefined();
    }
  });

  test("arguments that did not parse, for an action: not done", async () => {
    const spies: Spies = installSpies();
    spies.executeWithLogging.mockResolvedValueOnce(
      response({
        stopReason: "tool_use",
        toolCalls: [
          {
            ...DECLARE_CALL,
            argumentsParseError: "Unexpected end of JSON input.",
          } as unknown as { id: string; name: string; arguments: JSONObject },
        ],
      }) as never,
    );

    await ChatAgentRunner.runTurn(
      buildRequest({ permissionMode: AIChatPermissionMode.AutoRun }),
    );

    const failed: Array<AIRunEvent> = eventsOfType(
      spies,
      AIRunEventType.ToolCallFailed,
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]!.resultSummary?.isAction).toBe(true);
    expect(failed[0]!.resultSummary?.errorMessage).toBe(
      "Unexpected end of JSON input.",
    );
  });
});
