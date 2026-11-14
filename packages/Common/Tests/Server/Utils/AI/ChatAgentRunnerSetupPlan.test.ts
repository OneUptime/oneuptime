import ChatAgentRunner, {
  ChatTurnRequest,
} from "../../../../Server/Utils/AI/Chat/ChatAgentRunner";
import ChatInfrastructureAccess from "../../../../Server/Utils/AI/Chat/ChatInfrastructureAccess";
import AIToolbox from "../../../../Server/Utils/AI/Toolbox/Index";
import AiContextReader from "../../../../Server/Utils/AI/AiContext/AiContextReader";
import AIService, {
  AILogResponse,
} from "../../../../Server/Services/AIService";
import AIConversationMessageService from "../../../../Server/Services/AIConversationMessageService";
import AIConversationService from "../../../../Server/Services/AIConversationService";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../Server/Services/AIRunService";
import AlertOnCallRuleService from "../../../../Server/Services/AlertOnCallRuleService";
import AlertSeverityService from "../../../../Server/Services/AlertSeverityService";
import IncidentOnCallRuleService from "../../../../Server/Services/IncidentOnCallRuleService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import MonitorProbeService from "../../../../Server/Services/MonitorProbeService";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import OnCallReadinessService, {
  ReadinessMethodType,
  ReadinessStatus,
} from "../../../../Server/Services/OnCallReadinessService";
import PayAsYouGoBillingService from "../../../../Server/Services/PayAsYouGoBillingService";
import ProbeService from "../../../../Server/Services/ProbeService";
import ProjectService from "../../../../Server/Services/ProjectService";
import StatusPageResourceService from "../../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../../Server/Services/StatusPageService";
import ActiveMonitorLimit from "../../../../Server/Utils/Billing/ActiveMonitorLimit";
import AIConversation from "../../../../Models/DatabaseModels/AIConversation";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import Project from "../../../../Models/DatabaseModels/Project";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../../Models/DatabaseModels/StatusPageResource";
import AIChatPermissionMode from "../../../../Types/AI/AIChatPermissionMode";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import {
  AIChatToolAction,
  AIChatToolActionStatus,
  AIRunPausedState,
  AIToolRefusal,
} from "../../../../Types/AI/AIChatTypes";
import { AI_SETUP_ACTION_TOOL_NAMES } from "../../../../Types/AI/AISetupActions";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { GUIDED_SETUP_POLICY_NAME } from "../../../../Utils/GuidedSetup/OnCallPolicyRecords";
import { customDomainCaller } from "../../API/CustomDomainCallers";
import { ON_HIGHEST_PLAN } from "../../TestingUtils/RequestPlan";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * "MONITOR EXAMPLE.COM EVERY MINUTE AND TEXT ME IF IT IS DOWN" (issue
 * #6829), THROUGH THE WHOLE CHAT TURN.
 *
 *   - One plan, one approval: the model proposes the monitor and who is
 *     paged in one answer, and the turn pauses on one card holding both,
 *     each said in plain words - the missing phone number included.
 *   - Nothing is created before the person approves, in any mode: Auto-run
 *     asks for a setup action too, and Read-only never offers one.
 *   - A part the person may not make, or the project has already, is never
 *     on the card: the model is told what is needed instead.
 *   - Approved, the parts run in their plan's order - who is paged, then the
 *     monitor, then the status page that shows it - each as the person; a
 *     skipped part is not made; a part that fails says why while the rest
 *     are made.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

type SpyInstance = jest.SpyInstance;

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const MONITOR_ID: string = "55555555-5555-4555-8555-555555555555";
const POLICY_ID: string = "77777777-7777-4777-8777-777777777777";
const STATUS_PAGE_ID: string = "88888888-8888-4888-8888-888888888888";

const MONITOR_CALL: { id: string; name: string; arguments: JSONObject } = {
  id: "call-monitor",
  name: "set_up_website_monitoring",
  arguments: { address: "example.com", checkEveryMinutes: 1 },
};

const PAGING_CALL: { id: string; name: string; arguments: JSONObject } = {
  id: "call-paging",
  name: "set_up_paging",
  arguments: { reachMeBy: ["sms"] },
};

const STATUS_PAGE_CALL: { id: string; name: string; arguments: JSONObject } = {
  id: "call-status-page",
  name: "publish_status_page",
  arguments: { name: "Acme Status", monitors: ["example.com"] },
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

/*
 * A new project's owner, by default: who sets a project up first. A member
 * may create a monitor but not the on-call rules paging needs (below).
 */
function memberProps(
  permissions: Array<Permission> = [Permission.ProjectOwner],
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

function buildRequest(overrides?: Partial<ChatTurnRequest>): ChatTurnRequest {
  const props: DatabaseCommonInteractionProps = memberProps();

  return {
    projectId: PROJECT_ID,
    userId: props.userId!,
    conversationId: ObjectID.generate(),
    assistantMessageId: ObjectID.generate(),
    aiRunId: ObjectID.generate(),
    permissionMode: AIChatPermissionMode.AskForApproval,
    props: props,
    offersPageInfrastructure: true,
    ...overrides,
  };
}

function model<T>(type: { new (): T }, values: Record<string, unknown>): T {
  const record: T = new type();
  Object.assign(record as unknown as Record<string, unknown>, values);
  return record;
}

interface Spies {
  executeWithLogging: SpyInstance;
  messageUpdateOneBy: SpyInstance;
  runUpdateOneBy: SpyInstance;
  runEventCreate: SpyInstance;
  monitorCreate: SpyInstance;
  policyCreate: SpyInstance;
  statusPageCreate: SpyInstance;
  resourceCreate: SpyInstance;
}

function installSpies(data?: {
  run?: AIRun | undefined;
  policies?: number;
}): Spies {
  const runEventCreate: SpyInstance = jest
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

  // The project's statuses, severities and the probes a new monitor starts with.
  jest.spyOn(MonitorStatusService, "findBy").mockResolvedValue([
    model(MonitorStatus, {
      _id: ObjectID.generate().toString(),
      isOperationalState: true,
    }),
    model(MonitorStatus, {
      _id: ObjectID.generate().toString(),
      isOfflineState: true,
    }),
  ] as never);
  const severityId: string = ObjectID.generate().toString();
  jest
    .spyOn(IncidentSeverityService, "findBy")
    .mockResolvedValue([
      model(IncidentSeverity, { _id: severityId, name: "Critical Incident" }),
    ] as never);
  jest.spyOn(IncidentSeverityService, "findOneById").mockResolvedValue(
    model(IncidentSeverity, {
      _id: severityId,
      name: "Critical Incident",
    }) as never,
  );
  jest
    .spyOn(AlertSeverityService, "findBy")
    .mockResolvedValue([
      model(AlertSeverity, { _id: ObjectID.generate().toString() }),
    ] as never);
  jest.spyOn(ProjectService, "findOneById").mockResolvedValue(
    model(Project, {
      _id: PROJECT_ID.toString(),
      name: "Acme",
      doNotAddGlobalProbesByDefaultOnNewMonitors: false,
    }) as never,
  );
  jest.spyOn(ProbeService, "countBy").mockImplementation((async (args: {
    query: { isGlobalProbe: boolean };
  }): Promise<PositiveNumber> => {
    return new PositiveNumber(args.query.isGlobalProbe ? 2 : 0);
  }) as never);
  jest
    .spyOn(MonitorProbeService, "countBy")
    .mockResolvedValue(new PositiveNumber(2) as never);

  /*
   * Common Test runs with billing on (config.env: BILLING_ENABLED=true),
   * where a website monitor needs pay as you go and room under the plan's
   * active monitor limit (SetupTools' readMonitorPlanRefusal): this project
   * has both. A project without them is SetupTools.test.ts's.
   */
  jest
    .spyOn(PayAsYouGoBillingService, "canUsePayAsYouGo")
    .mockResolvedValue(true as never);
  jest.spyOn(ActiveMonitorLimit, "getRefusal").mockResolvedValue(null as never);

  // Paging: none yet (or some), and a person with a verified email only.
  jest
    .spyOn(OnCallDutyPolicyService, "countBy")
    .mockResolvedValue(new PositiveNumber(data?.policies ?? 0) as never);
  jest
    .spyOn(IncidentOnCallRuleService, "countBy")
    .mockResolvedValue(new PositiveNumber(0) as never);
  jest
    .spyOn(AlertOnCallRuleService, "countBy")
    .mockResolvedValue(new PositiveNumber(0) as never);
  jest.spyOn(OnCallReadinessService, "getReadinessForUser").mockResolvedValue({
    status: ReadinessStatus.PartiallyReady,
    methods: [
      {
        methodId: ObjectID.generate(),
        methodType: ReadinessMethodType.Email,
        maskedIdentifier: "•••",
        isVerified: true,
      },
    ],
  } as never);

  // The monitor exists once it is created: a status page finds it then.
  let monitorCreated: boolean = false;
  const monitorCreate: SpyInstance = jest
    .spyOn(MonitorService, "create")
    .mockImplementation((async (args: { data: Monitor }): Promise<Monitor> => {
      monitorCreated = true;
      const created: Monitor = args.data;
      created._id = MONITOR_ID;
      return created;
    }) as never);
  jest.spyOn(MonitorService, "findBy").mockImplementation((async (): Promise<
    Array<Monitor>
  > => {
    return monitorCreated
      ? [model(Monitor, { _id: MONITOR_ID, name: "example.com" })]
      : [];
  }) as never);

  const policyCreate: SpyInstance = jest
    .spyOn(OnCallDutyPolicyService, "create")
    .mockImplementation((async (args: {
      data: OnCallDutyPolicy;
    }): Promise<OnCallDutyPolicy> => {
      const created: OnCallDutyPolicy = args.data;
      created._id = POLICY_ID;
      return created;
    }) as never);

  const statusPageCreate: SpyInstance = jest
    .spyOn(StatusPageService, "create")
    .mockImplementation((async (args: {
      data: StatusPage;
    }): Promise<StatusPage> => {
      const created: StatusPage = args.data;
      created._id = STATUS_PAGE_ID;
      return created;
    }) as never);
  jest
    .spyOn(StatusPageService, "getStatusPageURL")
    .mockResolvedValue(
      `https://oneuptime.example/status-page/${STATUS_PAGE_ID}` as never,
    );
  jest
    .spyOn(StatusPageResourceService, "findBy")
    .mockResolvedValue([] as never);
  const resourceCreate: SpyInstance = jest
    .spyOn(StatusPageResourceService, "create")
    .mockImplementation((async (args: {
      data: StatusPageResource;
    }): Promise<StatusPageResource> => {
      return args.data;
    }) as never);

  const executeWithLogging: SpyInstance = jest
    .spyOn(AIService, "executeWithLogging")
    .mockResolvedValue(response({ content: "Done." }) as never);

  return {
    executeWithLogging,
    messageUpdateOneBy,
    runUpdateOneBy,
    runEventCreate,
    monitorCreate,
    policyCreate,
    statusPageCreate,
    resourceCreate,
  };
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

function pausedStateOf(spies: Spies): AIRunPausedState {
  for (const call of spies.runUpdateOneBy.mock.calls) {
    const arg: { data?: JSONObject } = call[0] as { data?: JSONObject };

    if (arg.data?.["pausedState"]) {
      return arg.data["pausedState"] as unknown as AIRunPausedState;
    }
  }

  throw new Error("The run was never paused for approval.");
}

function wasPaused(spies: Spies): boolean {
  return spies.runUpdateOneBy.mock.calls.some((call: Array<unknown>) => {
    const arg: { data?: JSONObject } = call[0] as { data?: JSONObject };
    return Boolean(arg.data?.["pausedState"]);
  });
}

// The tool results handed back to the model on its next call, by call id.
function toolResultsSent(
  spies: Spies,
  callIndex: number,
): Record<string, string> {
  const args: { messages: Array<JSONObject> } = spies.executeWithLogging.mock
    .calls[callIndex]![0] as { messages: Array<JSONObject> };
  const results: Record<string, string> = {};

  for (const message of args.messages) {
    if (message["role"] === "tool") {
      results[message["toolCallId"] as string] = message["content"] as string;
    }
  }

  return results;
}

// Proposes the plan, pauses, and hands back the run to resume.
async function proposeAndPause(
  toolCalls: Array<{ id: string; name: string; arguments: JSONObject }>,
): Promise<AIRun> {
  const spies: Spies = installSpies();
  spies.executeWithLogging.mockResolvedValueOnce(
    response({ stopReason: "tool_use", toolCalls }) as never,
  );
  await ChatAgentRunner.runTurn(buildRequest());
  const paused: AIRunPausedState = pausedStateOf(spies);
  jest.restoreAllMocks();

  const run: AIRun = new AIRun();
  run.status = AIRunStatus.WaitingForApproval;
  run.pausedState = paused;

  return run;
}

describe("one plan, one approval card", () => {
  test("the monitor and who is paged wait on one card, each in plain words, and nothing is created", async () => {
    const spies: Spies = installSpies();
    spies.executeWithLogging.mockResolvedValueOnce(
      response({
        stopReason: "tool_use",
        toolCalls: [MONITOR_CALL, PAGING_CALL],
      }) as never,
    );

    await ChatAgentRunner.runTurn(buildRequest());

    expect(spies.monitorCreate).not.toHaveBeenCalled();
    expect(spies.policyCreate).not.toHaveBeenCalled();

    const actions: Array<AIChatToolAction> = lastToolActions(spies);
    expect(
      actions.map((action: AIChatToolAction) => {
        return [action.toolName, action.status, action.requiresApproval];
      }),
    ).toEqual([
      ["set_up_website_monitoring", AIChatToolActionStatus.Pending, true],
      ["set_up_paging", AIChatToolActionStatus.Pending, true],
    ]);
    expect(actions[0]!.title).toBe("Set up monitoring for example.com");
    expect(actions[0]!.description).toBe(
      "A website monitor checks https://example.com every minute. It is checked from 2 locations. If it does not answer, or answers with an error, OneUptime opens an incident (Critical Incident). You own this monitor, so you are emailed when its status changes.",
    );
    expect(actions[1]!.title).toBe(
      `Create on-call policy "${GUIDED_SETUP_POLICY_NAME}"`,
    );
    expect(actions[1]!.description).toBe(
      "Pages you for every new incident and alert. You have no verified phone number for texts yet. Add one in Notification Methods, and pages reach you by SMS too.",
    );

    const paused: AIRunPausedState = pausedStateOf(spies);
    expect(paused.pendingToolCalls).toHaveLength(2);
  });

  test("in Auto-run, a setup plan still waits for the person: nothing runs unapproved", async () => {
    const spies: Spies = installSpies();
    spies.executeWithLogging.mockResolvedValueOnce(
      response({
        stopReason: "tool_use",
        toolCalls: [MONITOR_CALL, PAGING_CALL],
      }) as never,
    );

    await ChatAgentRunner.runTurn(
      buildRequest({ permissionMode: AIChatPermissionMode.AutoRun }),
    );

    expect(spies.monitorCreate).not.toHaveBeenCalled();
    expect(spies.policyCreate).not.toHaveBeenCalled();
    expect(wasPaused(spies)).toBe(true);
    expect(
      lastToolActions(spies).map((action: AIChatToolAction) => {
        return action.status;
      }),
    ).toEqual([AIChatToolActionStatus.Pending, AIChatToolActionStatus.Pending]);
  });

  test("in Read-only, no setup action is offered to the model, and one asked for anyway is refused", async () => {
    const spies: Spies = installSpies();
    spies.executeWithLogging
      .mockResolvedValueOnce(
        response({
          stopReason: "tool_use",
          toolCalls: [MONITOR_CALL],
        }) as never,
      )
      .mockResolvedValueOnce(response({ content: "Read-only." }) as never);

    await ChatAgentRunner.runTurn(
      buildRequest({ permissionMode: AIChatPermissionMode.ReadOnly }),
    );

    const offered: Array<string> = (
      (
        spies.executeWithLogging.mock.calls[0]![0] as {
          tools: Array<{ name: string }>;
        }
      ).tools || []
    ).map((tool: { name: string }) => {
      return tool.name;
    });
    for (const name of AI_SETUP_ACTION_TOOL_NAMES) {
      expect(offered).not.toContain(name);
    }
    expect(offered).toContain("who_is_told");

    expect(spies.monitorCreate).not.toHaveBeenCalled();
    expect(wasPaused(spies)).toBe(false);
    expect(toolResultsSent(spies, 1)[MONITOR_CALL.id]).toContain("READ-ONLY");
  });

  test("in Ask to act, the setup actions are offered", () => {
    const offered: Array<string> = AIToolbox.getLlmToolDefinitions(
      AIChatPermissionMode.AskForApproval,
    ).map((definition: { name: string }) => {
      return definition.name;
    });

    for (const name of AI_SETUP_ACTION_TOOL_NAMES) {
      expect(offered).toContain(name);
    }
  });
});

describe("what cannot be made is never on the card", () => {
  test("a person whose role may not create a monitor or a policy gets no card: the model is told what is needed", async () => {
    const spies: Spies = installSpies();
    spies.executeWithLogging
      .mockResolvedValueOnce(
        response({
          stopReason: "tool_use",
          toolCalls: [MONITOR_CALL, PAGING_CALL],
        }) as never,
      )
      .mockResolvedValueOnce(
        response({
          content: "You need a role that creates monitors.",
        }) as never,
      );

    await ChatAgentRunner.runTurn(
      buildRequest({ props: memberProps([Permission.Viewer]) }),
    );

    expect(wasPaused(spies)).toBe(false);
    expect(lastToolActions(spies)).toEqual([]);
    expect(spies.monitorCreate).not.toHaveBeenCalled();
    expect(spies.policyCreate).not.toHaveBeenCalled();

    const told: Record<string, string> = toolResultsSent(spies, 1);
    expect(told[MONITOR_CALL.id]).toContain(
      "does not have permission to use set_up_website_monitoring",
    );
    expect(told[PAGING_CALL.id]).toContain(
      "does not have permission to use set_up_paging",
    );

    // The answer's steps say each was not done, and why.
    const refusals: Array<unknown> = spies.runEventCreate.mock.calls
      .map((call: Array<unknown>) => {
        return (call[0] as { data: JSONObject }).data;
      })
      .filter((event: JSONObject) => {
        return event["eventType"] === AIRunEventType.ToolCallFailed;
      })
      .map((event: JSONObject) => {
        return (event["resultSummary"] as JSONObject)?.["refusal"];
      });
    expect(refusals).toEqual([
      AIToolRefusal.Permission,
      AIToolRefusal.Permission,
    ]);
  });

  test("a project member gets the monitor on the card, and is told paging needs the on-call rules a project admin may add", async () => {
    const spies: Spies = installSpies();
    spies.executeWithLogging.mockResolvedValueOnce(
      response({
        stopReason: "tool_use",
        toolCalls: [MONITOR_CALL, PAGING_CALL],
      }) as never,
    );

    await ChatAgentRunner.runTurn(
      buildRequest({ props: memberProps([Permission.ProjectMember]) }),
    );

    expect(
      lastToolActions(spies).map((action: AIChatToolAction) => {
        return action.toolName;
      }),
    ).toEqual(["set_up_website_monitoring"]);

    const paused: AIRunPausedState = pausedStateOf(spies);
    const told: Array<JSONObject> = (
      paused.messages as Array<JSONObject>
    ).filter((message: JSONObject) => {
      return message["toolCallId"] === PAGING_CALL.id;
    });
    expect(told[0]?.["content"]).toContain(
      "does not have permission to use set_up_paging",
    );
    expect(told[0]?.["content"]).toContain("Create Incident On-Call Rule");
  });

  test("a project that pages people already gets the monitor on the card, and no second policy", async () => {
    const spies: Spies = installSpies({ policies: 2 });
    spies.executeWithLogging.mockResolvedValueOnce(
      response({
        stopReason: "tool_use",
        toolCalls: [MONITOR_CALL, PAGING_CALL],
      }) as never,
    );

    await ChatAgentRunner.runTurn(buildRequest());

    expect(
      lastToolActions(spies).map((action: AIChatToolAction) => {
        return action.toolName;
      }),
    ).toEqual(["set_up_website_monitoring"]);

    const paused: AIRunPausedState = pausedStateOf(spies);
    const told: Array<JSONObject> = (
      paused.messages as Array<JSONObject>
    ).filter((message: JSONObject) => {
      return message["toolCallId"] === PAGING_CALL.id;
    });
    expect(told[0]?.["content"]).toContain("this project already pages people");
  });
});

describe("approved, the plan runs as the person, in its plan's order", () => {
  test("both approved: who is paged first, then the monitor, each as the person who approved", async () => {
    const run: AIRun = await proposeAndPause([MONITOR_CALL, PAGING_CALL]);
    const spies: Spies = installSpies({ run });
    spies.executeWithLogging.mockResolvedValueOnce(
      response({
        content: "Set up example.com and paging [C1] [C2].",
      }) as never,
    );
    const decider: ChatTurnRequest = buildRequest();

    await ChatAgentRunner.resumeTurn(decider, [
      { toolCallId: MONITOR_CALL.id, approved: true },
      { toolCallId: PAGING_CALL.id, approved: true },
    ]);

    expect(spies.policyCreate).toHaveBeenCalledTimes(1);
    expect(spies.monitorCreate).toHaveBeenCalledTimes(1);
    expect(spies.policyCreate.mock.invocationCallOrder[0]!).toBeLessThan(
      spies.monitorCreate.mock.invocationCallOrder[0]!,
    );
    expect(
      (spies.policyCreate.mock.calls[0]![0] as { props: unknown }).props,
    ).toBe(decider.props);
    expect(
      (spies.monitorCreate.mock.calls[0]![0] as { props: unknown }).props,
    ).toBe(decider.props);

    expect(
      lastToolActions(spies).map((action: AIChatToolAction) => {
        return action.status;
      }),
    ).toEqual([
      AIChatToolActionStatus.Executed,
      AIChatToolActionStatus.Executed,
    ]);

    // The results go back to the model in the order it asked for them.
    const args: { messages: Array<JSONObject> } = spies.executeWithLogging.mock
      .calls[0]![0] as { messages: Array<JSONObject> };
    const order: Array<string> = args.messages
      .filter((message: JSONObject) => {
        return message["role"] === "tool";
      })
      .map((message: JSONObject) => {
        return message["toolCallId"] as string;
      });
    expect(order).toEqual([MONITOR_CALL.id, PAGING_CALL.id]);
  });

  test("a part the person skipped is not made", async () => {
    const run: AIRun = await proposeAndPause([MONITOR_CALL, PAGING_CALL]);
    const spies: Spies = installSpies({ run });

    await ChatAgentRunner.resumeTurn(buildRequest(), [
      { toolCallId: MONITOR_CALL.id, approved: true },
      { toolCallId: PAGING_CALL.id, approved: false },
    ]);

    expect(spies.monitorCreate).toHaveBeenCalledTimes(1);
    expect(spies.policyCreate).not.toHaveBeenCalled();
    expect(
      lastToolActions(spies).map((action: AIChatToolAction) => {
        return action.status;
      }),
    ).toEqual([AIChatToolActionStatus.Executed, AIChatToolActionStatus.Denied]);
  });

  test("a part that fails says why, and the rest is still made", async () => {
    const run: AIRun = await proposeAndPause([MONITOR_CALL, PAGING_CALL]);
    const spies: Spies = installSpies({ run });
    spies.policyCreate.mockRejectedValue(
      new Error("Escalation rule limit reached on this plan.") as never,
    );

    await ChatAgentRunner.resumeTurn(buildRequest(), [
      { toolCallId: MONITOR_CALL.id, approved: true },
      { toolCallId: PAGING_CALL.id, approved: true },
    ]);

    expect(spies.monitorCreate).toHaveBeenCalledTimes(1);
    expect(
      lastToolActions(spies).map((action: AIChatToolAction) => {
        return action.status;
      }),
    ).toEqual([AIChatToolActionStatus.Executed, AIChatToolActionStatus.Failed]);

    const told: Record<string, string> = toolResultsSent(spies, 0);
    expect(told[PAGING_CALL.id]).toContain(
      "Escalation rule limit reached on this plan.",
    );
    expect(told[MONITOR_CALL.id]).toContain(
      'Created the Website monitor "example.com"',
    );
  });

  test("a status page asked for before its monitor still shows it: the monitor is made first", async () => {
    const run: AIRun = await proposeAndPause([STATUS_PAGE_CALL, MONITOR_CALL]);
    const spies: Spies = installSpies({ run });

    await ChatAgentRunner.resumeTurn(buildRequest(), [
      { toolCallId: STATUS_PAGE_CALL.id, approved: true },
      { toolCallId: MONITOR_CALL.id, approved: true },
    ]);

    expect(spies.monitorCreate.mock.invocationCallOrder[0]!).toBeLessThan(
      spies.statusPageCreate.mock.invocationCallOrder[0]!,
    );
    expect(spies.resourceCreate).toHaveBeenCalledTimes(1);
    expect(
      (
        spies.resourceCreate.mock.calls[0]![0] as { data: StatusPageResource }
      ).data.monitorId?.toString(),
    ).toBe(MONITOR_ID);
  });

  test("the status page's card named the monitor its plan sets up as new, before anything existed", async () => {
    const spies: Spies = installSpies();
    spies.executeWithLogging.mockResolvedValueOnce(
      response({
        stopReason: "tool_use",
        toolCalls: [STATUS_PAGE_CALL, MONITOR_CALL],
      }) as never,
    );

    await ChatAgentRunner.runTurn(buildRequest());

    const statusPage: AIChatToolAction | undefined = lastToolActions(
      spies,
    ).find((action: AIChatToolAction) => {
      return action.toolName === "publish_status_page";
    });
    expect(statusPage?.title).toBe('Publish status page "Acme Status"');
    expect(statusPage?.description).toBe(
      'It is public as soon as it is created: anyone with its link sees the status of the monitors it shows. It shows "example.com" (new).',
    );
  });
});

describe("orderForRun", () => {
  test("puts a plan's setup actions in their plan's order and keeps every other call where it was asked", () => {
    const calls: Array<{ id: string; name: string; arguments: JSONObject }> = [
      { id: "1", name: "publish_status_page", arguments: {} },
      { id: "2", name: "create_incident", arguments: {} },
      { id: "3", name: "set_up_website_monitoring", arguments: {} },
      { id: "4", name: "add_monitors_to_status_page", arguments: {} },
      { id: "5", name: "set_up_paging", arguments: {} },
      { id: "6", name: "create_alert", arguments: {} },
    ];

    expect(
      ChatAgentRunner.orderForRun(calls).map((call: { id: string }) => {
        return call.id;
      }),
    ).toEqual(["5", "3", "1", "4", "2", "6"]);
    expect(
      ChatAgentRunner.orderForRun([
        { id: "a", name: "create_incident", arguments: {} },
        { id: "b", name: "resolve_incident", arguments: {} },
      ]).map((call: { id: string }) => {
        return call.id;
      }),
    ).toEqual(["a", "b"]);
  });
});
