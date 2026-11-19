import ChatAgentRunner, {
  ChatTurnRequest,
} from "../../../../Server/Utils/AI/Chat/ChatAgentRunner";
import ChatInfrastructureAccess from "../../../../Server/Utils/AI/Chat/ChatInfrastructureAccess";
import AiContextReader from "../../../../Server/Utils/AI/AiContext/AiContextReader";
import AIToolbox from "../../../../Server/Utils/AI/Toolbox/Index";
import { ObservabilityTool } from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import AIService, {
  AILogResponse,
} from "../../../../Server/Services/AIService";
import AIConversationMessageService from "../../../../Server/Services/AIConversationMessageService";
import AIConversationService from "../../../../Server/Services/AIConversationService";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../Server/Services/AIRunService";
import AIConversation from "../../../../Models/DatabaseModels/AIConversation";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import AIChatPermissionMode from "../../../../Types/AI/AIChatPermissionMode";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import {
  AIChatToolAction,
  AIChatToolActionStatus,
  AIRunPausedState,
  AIToolRefusal,
} from "../../../../Types/AI/AIChatTypes";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import PositiveNumber from "../../../../Types/PositiveNumber";
import logger from "../../../../Server/Utils/Logger";
import { customDomainCaller } from "../../API/CustomDomainCallers";
import { ON_HIGHEST_PLAN } from "../../TestingUtils/RequestPlan";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * IN ASK TO ACT, AN ACTION THE PERSON MAY NOT TAKE NEVER REACHES THE
 * APPROVAL CARD (issue #7248), THROUGH THE WHOLE CHAT TURN.
 *
 * A person whose role may not acknowledge an incident used to see
 * "Acknowledge incident #42", approve it, and only then read "Not done:
 * your role does not allow it". Now the turn asks the gates a run asks
 * before it puts an action on the card - as it asked them for setup
 * actions since #6829 - so:
 *
 *   - the action is not on the card, and the turn does not wait on one;
 *   - the model is told which permission it needs, and says so;
 *   - the answer's steps say it was not done, and why (the refusal);
 *   - an action the person may take, asked in the same answer, still waits
 *     on its card, alone;
 *   - Auto-run is unchanged: it shows no card, and its refusal comes as the
 *     action runs, before anything is changed.
 */

type SpyInstance = jest.SpyInstance;

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);

const ACKNOWLEDGE_CALL: { id: string; name: string; arguments: JSONObject } = {
  id: "call-acknowledge",
  name: "acknowledge_incident",
  arguments: { incidentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
};

const RUNBOOK_CALL: { id: string; name: string; arguments: JSONObject } = {
  id: "call-runbook",
  name: "run_runbook",
  arguments: { runbookId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
};

const WORKFLOW_CALL: { id: string; name: string; arguments: JSONObject } = {
  id: "call-workflow",
  name: "update_workflow",
  arguments: {
    workflowId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    name: "Page the database team",
  },
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
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

function buildRequest(overrides: Partial<ChatTurnRequest>): ChatTurnRequest {
  const props: DatabaseCommonInteractionProps =
    overrides.props || memberProps([Permission.ProjectMember]);

  return {
    projectId: PROJECT_ID,
    userId: props.userId!,
    conversationId: ObjectID.generate(),
    assistantMessageId: ObjectID.generate(),
    aiRunId: ObjectID.generate(),
    permissionMode: AIChatPermissionMode.AskForApproval,
    props: props,
    ...overrides,
  };
}

interface Spies {
  executeWithLogging: SpyInstance;
  messageUpdateOneBy: SpyInstance;
  runUpdateOneBy: SpyInstance;
  eventCreate: SpyInstance;
  // Each tool's run, by its name: none of them may run in these tests.
  executes: Record<string, SpyInstance>;
}

function installSpies(): Spies {
  const eventCreate: SpyInstance = jest
    .spyOn(AIRunEventService, "create")
    .mockResolvedValue({} as never);
  jest.spyOn(AIRunService, "updateOneById").mockResolvedValue(1 as never);
  jest.spyOn(AiContextReader, "read").mockResolvedValue(null as never);
  jest
    .spyOn(ChatInfrastructureAccess, "buildForPage")
    .mockResolvedValue(null as never);

  const run: AIRun = new AIRun();
  run.status = AIRunStatus.Running;
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

  const executes: Record<string, SpyInstance> = {};

  for (const call of [ACKNOWLEDGE_CALL, RUNBOOK_CALL, WORKFLOW_CALL]) {
    const tool: ObservabilityTool = AIToolbox.getToolByName(call.name)!;

    /*
     * The card's words are read as the person: here, the arguments as
     * the model wrote them, with no read of the record.
     */
    jest
      .spyOn(
        tool as unknown as {
          prepareMutation: NonNullable<ObservabilityTool["prepareMutation"]>;
        },
        "prepareMutation",
      )
      .mockImplementation((async (args: JSONObject) => {
        return { arguments: args };
      }) as never);

    executes[call.name] = jest
      .spyOn(
        tool as unknown as { execute: ObservabilityTool["execute"] },
        "execute",
      )
      .mockRejectedValue(new Error("No action may run in this test.") as never);
  }

  const executeWithLogging: SpyInstance = jest
    .spyOn(AIService, "executeWithLogging")
    .mockResolvedValue(response({ content: "Done." }) as never);

  return {
    executeWithLogging,
    messageUpdateOneBy,
    runUpdateOneBy,
    eventCreate,
    executes,
  };
}

function eventsOfType(spies: Spies, type: AIRunEventType): Array<AIRunEvent> {
  return spies.eventCreate.mock.calls
    .map((call: Array<unknown>): AIRunEvent => {
      return (call[0] as { data: AIRunEvent }).data;
    })
    .filter((event: AIRunEvent): boolean => {
      return event.eventType === type;
    });
}

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

function pausedStateOf(spies: Spies): AIRunPausedState | null {
  for (const call of spies.runUpdateOneBy.mock.calls) {
    const arg: { data?: JSONObject } = call[0] as { data?: JSONObject };

    if (arg.data?.["pausedState"]) {
      return arg.data["pausedState"] as unknown as AIRunPausedState;
    }
  }

  return null;
}

// What the model was told for each call, on its next call (or in the pause).
function toldModel(spies: Spies): Record<string, string> {
  const told: Record<string, string> = {};
  const paused: AIRunPausedState | null = pausedStateOf(spies);
  const messages: Array<JSONObject> = paused
    ? (paused.messages as Array<JSONObject>)
    : (
        spies.executeWithLogging.mock.calls[1]?.[0] as
          | { messages: Array<JSONObject> }
          | undefined
      )?.messages || [];

  for (const message of messages) {
    if (message["role"] === "tool") {
      told[message["toolCallId"] as string] = message["content"] as string;
    }
  }

  return told;
}

async function ask(data: {
  toolCalls: Array<{ id: string; name: string; arguments: JSONObject }>;
  props: DatabaseCommonInteractionProps;
  permissionMode?: AIChatPermissionMode | undefined;
}): Promise<Spies> {
  const spies: Spies = installSpies();
  spies.executeWithLogging
    .mockResolvedValueOnce(
      response({ stopReason: "tool_use", toolCalls: data.toolCalls }) as never,
    )
    .mockResolvedValueOnce(
      response({ content: "You need another role for that." }) as never,
    );

  await ChatAgentRunner.runTurn(
    buildRequest({
      props: data.props,
      permissionMode:
        data.permissionMode || AIChatPermissionMode.AskForApproval,
    }),
  );

  return spies;
}

describe.each([
  {
    kind: "an incident action",
    call: ACKNOWLEDGE_CALL,
    refusedRole: [Permission.Viewer],
    allowedRole: [Permission.ProjectMember],
    namedPermission: "Create Incident State Timeline",
  },
  {
    kind: "a runbook",
    call: RUNBOOK_CALL,
    refusedRole: [Permission.Viewer],
    allowedRole: [Permission.ProjectMember],
    namedPermission: "Create Runbook Execution",
  },
  {
    kind: "a workflow change",
    call: WORKFLOW_CALL,
    // A Project Member may not change a workflow; a Project Admin may.
    refusedRole: [Permission.ProjectMember],
    allowedRole: [Permission.ProjectAdmin],
    namedPermission: "Edit Workflow",
  },
])(
  "in Ask to act, $kind",
  (row: {
    call: { id: string; name: string; arguments: JSONObject };
    refusedRole: Array<Permission>;
    allowedRole: Array<Permission>;
    namedPermission: string;
  }) => {
    test("the person's role may not take it: no card, the model is told which permission it needs, and the step says why", async () => {
      const spies: Spies = await ask({
        toolCalls: [row.call],
        props: memberProps(row.refusedRole),
      });

      // REGRESSION (#7248): it was on the card, then refused once approved.
      expect(pausedStateOf(spies)).toBeNull();
      expect(lastToolActions(spies)).toEqual([]);
      expect(spies.executes[row.call.name]).not.toHaveBeenCalled();

      const told: string = toldModel(spies)[row.call.id] || "";
      expect(told).toContain(
        `does not have permission to use ${row.call.name}`,
      );
      expect(told).toContain(row.namedPermission);

      const failed: Array<AIRunEvent> = eventsOfType(
        spies,
        AIRunEventType.ToolCallFailed,
      );
      expect(failed).toHaveLength(1);
      expect(failed[0]!.toolName).toBe(row.call.name);
      expect(failed[0]!.resultSummary?.refusal).toBe(AIToolRefusal.Permission);
      expect(failed[0]!.resultSummary?.isAction).toBe(true);
      expect(eventsOfType(spies, AIRunEventType.ActionExecuted)).toHaveLength(
        0,
      );

      // The turn answers: the model's second call is the answer.
      expect(spies.executeWithLogging).toHaveBeenCalledTimes(2);
    });

    test("a person whose role may take it gets the card, and nothing runs before they approve", async () => {
      const spies: Spies = await ask({
        toolCalls: [row.call],
        props: memberProps(row.allowedRole),
      });

      expect(pausedStateOf(spies)?.pendingToolCalls).toHaveLength(1);
      expect(
        lastToolActions(spies).map((action: AIChatToolAction) => {
          return [action.toolName, action.status, action.requiresApproval];
        }),
      ).toEqual([[row.call.name, AIChatToolActionStatus.Pending, true]]);
      expect(spies.executes[row.call.name]).not.toHaveBeenCalled();
      expect(eventsOfType(spies, AIRunEventType.ToolCallFailed)).toHaveLength(
        0,
      );
    });
  },
);

describe("in Ask to act, two actions in one answer", () => {
  test("the one the person may take waits on the card alone; the other is told what it needs", async () => {
    // A Project Member acknowledges incidents but does not change workflows.
    const spies: Spies = await ask({
      toolCalls: [ACKNOWLEDGE_CALL, WORKFLOW_CALL],
      props: memberProps([Permission.ProjectMember]),
    });

    expect(
      lastToolActions(spies).map((action: AIChatToolAction) => {
        return action.toolName;
      }),
    ).toEqual(["acknowledge_incident"]);
    expect(pausedStateOf(spies)?.pendingToolCalls).toHaveLength(1);
    expect(toldModel(spies)[WORKFLOW_CALL.id]).toContain(
      "does not have permission to use update_workflow",
    );

    const failed: Array<AIRunEvent> = eventsOfType(
      spies,
      AIRunEventType.ToolCallFailed,
    );
    expect(
      failed.map((event: AIRunEvent) => {
        return [event.toolName, event.resultSummary?.refusal];
      }),
    ).toEqual([["update_workflow", AIToolRefusal.Permission]]);
  });

  test("a team's block is said as the block: the person is not sent after a role they have", async () => {
    const spies: Spies = await ask({
      toolCalls: [ACKNOWLEDGE_CALL],
      props: {
        ...customDomainCaller({
          permissions: [Permission.ProjectMember],
          blocks: [Permission.CreateIncidentStateTimeline],
          projectId: PROJECT_ID,
        }),
        ...ON_HIGHEST_PLAN,
      },
    });

    expect(pausedStateOf(spies)).toBeNull();
    expect(toldModel(spies)[ACKNOWLEDGE_CALL.id]).toContain(
      "a team they belong to blocks",
    );
    expect(
      eventsOfType(spies, AIRunEventType.ToolCallFailed)[0]!.resultSummary
        ?.refusal,
    ).toBe(AIToolRefusal.TeamBlock);
  });
});

describe("in Auto-run, unchanged", () => {
  test("no card is ever shown: the action is refused as it runs, by the same gate, and nothing is changed", async () => {
    const spies: Spies = await ask({
      toolCalls: [ACKNOWLEDGE_CALL],
      props: memberProps([Permission.Viewer]),
      permissionMode: AIChatPermissionMode.AutoRun,
    });

    expect(pausedStateOf(spies)).toBeNull();
    expect(spies.executes["acknowledge_incident"]).not.toHaveBeenCalled();

    const failed: Array<AIRunEvent> = eventsOfType(
      spies,
      AIRunEventType.ToolCallFailed,
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]!.resultSummary?.refusal).toBe(AIToolRefusal.Permission);
    expect(failed[0]!.resultSummary?.isAction).toBe(true);

    // Auto-run records the action it tried, as before: not done.
    expect(
      lastToolActions(spies).map((action: AIChatToolAction) => {
        return action.status;
      }),
    ).toEqual([AIChatToolActionStatus.Failed]);
  });
});
