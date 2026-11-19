import ChatAgentRunner, {
  ChatTurnRequest,
} from "../../../../../Server/Utils/AI/Chat/ChatAgentRunner";
import ChatInfrastructureAccess from "../../../../../Server/Utils/AI/Chat/ChatInfrastructureAccess";
import AIToolbox from "../../../../../Server/Utils/AI/Toolbox/Index";
import SetupActionRunner, {
  API_KEY_REFUSAL,
  READ_ONLY_CONNECTION_REFUSAL,
} from "../../../../../Server/Utils/AI/Toolbox/SetupActionRunner";
import { ToolContext } from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import AiContextReader from "../../../../../Server/Utils/AI/AiContext/AiContextReader";
import ServerProducts from "../../../../../Server/Utils/ServerProducts/ServerProducts";
import ActiveMonitorLimit from "../../../../../Server/Utils/Billing/ActiveMonitorLimit";
import logger from "../../../../../Server/Utils/Logger";
import AIService, {
  AILogResponse,
} from "../../../../../Server/Services/AIService";
import AIConversationMessageService from "../../../../../Server/Services/AIConversationMessageService";
import AIConversationService from "../../../../../Server/Services/AIConversationService";
import AIRunEventService from "../../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../../Server/Services/AIRunService";
import AlertOnCallRuleService from "../../../../../Server/Services/AlertOnCallRuleService";
import AlertSeverityService from "../../../../../Server/Services/AlertSeverityService";
import IncidentOnCallRuleService from "../../../../../Server/Services/IncidentOnCallRuleService";
import IncidentSeverityService from "../../../../../Server/Services/IncidentSeverityService";
import MonitorProbeService from "../../../../../Server/Services/MonitorProbeService";
import MonitorService from "../../../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../../../Server/Services/MonitorStatusService";
import OnCallDutyPolicyService from "../../../../../Server/Services/OnCallDutyPolicyService";
import OnCallReadinessService, {
  ReadinessMethodType,
  ReadinessStatus,
} from "../../../../../Server/Services/OnCallReadinessService";
import PayAsYouGoBillingService from "../../../../../Server/Services/PayAsYouGoBillingService";
import ProbeService from "../../../../../Server/Services/ProbeService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import StatusPageResourceService from "../../../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../../../Server/Services/StatusPageService";
import WhoIsToldService from "../../../../../Server/Services/WhoIsToldService";
import AIConversation from "../../../../../Models/DatabaseModels/AIConversation";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import AlertSeverity from "../../../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../../Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import Project from "../../../../../Models/DatabaseModels/Project";
import StatusPage from "../../../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../../../Models/DatabaseModels/StatusPageResource";
import AIChatPermissionMode from "../../../../../Types/AI/AIChatPermissionMode";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import { AIRunPausedState } from "../../../../../Types/AI/AIChatTypes";
import {
  SETUP_ACTIONS_RUN_OUTSIDE_CHAT,
  SetupActionRunResult,
} from "../../../../../Types/AI/AISetupActions";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ForbiddenException from "../../../../../Types/Exception/ForbiddenException";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import ProductKey from "../../../../../Types/Product/ProductKey";
import { ServerProductOffReason } from "../../../../../Types/Product/ServerProducts";
import { customDomainCaller } from "../../../API/CustomDomainCallers";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ASK AI'S SETUP ACTIONS, ONE CALL EACH, OUTSIDE THE CHAT (#7241).
 *
 * The MCP server's set_up_website_monitoring, set_up_paging,
 * publish_status_page, add_monitors_to_status_page and who_is_told are run
 * by SetupActionRunner through Ask AI's own tools. So:
 *
 *   - for the same arguments, an agent's call makes the very records an
 *     approved Ask AI card makes - the monitor, the policy and its rules,
 *     the status page and each monitor on it - as the same person;
 *   - what would be refused before Ask AI's card is refused before
 *     anything is made, with what is needed, as an error of its kind:
 *     a permission or a switched-off product (403), the plan (402),
 *     something missing (400);
 *   - a project API key is refused a setup action - it acts as a person -
 *     and a read-only connection every one; who_is_told reads for both;
 *   - the result says what was made in the card's words, and its words
 *     for the agent point to OneUptime's own pages, never to a card or a
 *     test page under an answer an MCP client does not draw.
 */

type SpyInstance = jest.SpyInstance;

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const MONITOR_ID: string = "55555555-5555-4555-8555-555555555555";
const POLICY_ID: string = "77777777-7777-4777-8777-777777777777";
const STATUS_PAGE_ID: string = "88888888-8888-4888-8888-888888888888";

const OPERATIONAL: string = "11111111-1111-4111-8111-111111111111";
const OFFLINE: string = "22222222-2222-4222-8222-222222222222";
const INCIDENT_SEVERITY: string = "33333333-3333-4333-8333-333333333333";
const ALERT_SEVERITY: string = "44444444-4444-4444-8444-444444444444";

const SEEDS: ReadonlySet<string> = new Set<string>([
  PROJECT_ID.toString(),
  MONITOR_ID,
  POLICY_ID,
  STATUS_PAGE_ID,
  OPERATIONAL,
  OFFLINE,
  INCIDENT_SEVERITY,
  ALERT_SEVERITY,
]);

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest.spyOn(logger, "debug").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function model<T>(type: { new (): T }, values: Record<string, unknown>): T {
  const record: T = new type();
  Object.assign(record as unknown as Record<string, unknown>, values);
  return record;
}

// A new project's owner: who sets a project up first.
function ownerProps(
  permissions: Array<Permission> = [Permission.ProjectOwner],
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

function ctxOf(props: DatabaseCommonInteractionProps): ToolContext {
  return { projectId: PROJECT_ID, props: props };
}

/*
 * A record as JSON, the ids its criteria and steps make for themselves
 * numbered in the order they appear, and the project's own kept.
 */
function comparable(record: unknown): unknown {
  const numbered: Map<string, string> = new Map<string, string>();
  const text: string = JSON.stringify(record).replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
    (uuid: string): string => {
      if (SEEDS.has(uuid)) {
        return uuid;
      }

      if (!numbered.has(uuid)) {
        numbered.set(uuid, `generated-${numbered.size + 1}`);
      }

      return numbered.get(uuid)!;
    },
  );

  return JSON.parse(text);
}

interface Spies {
  executeWithLogging: SpyInstance;
  runUpdateOneBy: SpyInstance;
  monitorCreate: SpyInstance;
  policyCreate: SpyInstance;
  statusPageCreate: SpyInstance;
  resourceCreate: SpyInstance;
}

function installSpies(data?: {
  run?: AIRun | undefined;
  policies?: number | undefined;
  // A monitor of example.com the project has: a status page can show it.
  hasMonitor?: boolean | undefined;
}): Spies {
  jest.spyOn(AIRunEventService, "create").mockResolvedValue({} as never);
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
  jest
    .spyOn(AIConversationMessageService, "updateOneBy")
    .mockResolvedValue(1 as never);
  jest
    .spyOn(AIConversationService, "findOneById")
    .mockResolvedValue(new AIConversation() as never);
  jest
    .spyOn(AIConversationService, "updateOneById")
    .mockResolvedValue(1 as never);

  jest
    .spyOn(MonitorStatusService, "findBy")
    .mockResolvedValue([
      model(MonitorStatus, { _id: OPERATIONAL, isOperationalState: true }),
      model(MonitorStatus, { _id: OFFLINE, isOfflineState: true }),
    ] as never);
  jest
    .spyOn(IncidentSeverityService, "findBy")
    .mockResolvedValue([
      model(IncidentSeverity, { _id: INCIDENT_SEVERITY, name: "Critical" }),
    ] as never);
  jest.spyOn(IncidentSeverityService, "findOneById").mockResolvedValue(
    model(IncidentSeverity, {
      _id: INCIDENT_SEVERITY,
      name: "Critical",
    }) as never,
  );
  jest
    .spyOn(AlertSeverityService, "findBy")
    .mockResolvedValue([
      model(AlertSeverity, { _id: ALERT_SEVERITY }),
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
  jest
    .spyOn(PayAsYouGoBillingService, "canUsePayAsYouGo")
    .mockResolvedValue(true as never);
  jest.spyOn(ActiveMonitorLimit, "getRefusal").mockResolvedValue(null as never);

  jest
    .spyOn(OnCallDutyPolicyService, "countBy")
    .mockResolvedValue(new PositiveNumber(data?.policies ?? 0) as never);
  jest
    .spyOn(IncidentOnCallRuleService, "findBy")
    .mockResolvedValue([] as never);
  jest.spyOn(AlertOnCallRuleService, "findBy").mockResolvedValue([] as never);
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

  let monitorExists: boolean = Boolean(data?.hasMonitor);
  const monitorCreate: SpyInstance = jest
    .spyOn(MonitorService, "create")
    .mockImplementation((async (args: { data: Monitor }): Promise<Monitor> => {
      monitorExists = true;
      const created: Monitor = args.data;
      created._id = MONITOR_ID;
      return created;
    }) as never);
  jest.spyOn(MonitorService, "findBy").mockImplementation((async (): Promise<
    Array<Monitor>
  > => {
    return monitorExists
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
    .mockResolvedValue({
      content: "Done.",
      llmLog: { totalTokens: 10, costInUSDCents: 1 },
    } as unknown as AILogResponse as never);

  return {
    executeWithLogging,
    runUpdateOneBy,
    monitorCreate,
    policyCreate,
    statusPageCreate,
    resourceCreate,
  };
}

// What a create was handed, as comparable JSON, and as whom.
function createdBy(spy: SpyInstance): { data: unknown; props: unknown } {
  const call: { data: unknown; props: unknown } = spy.mock.calls[0]![0] as {
    data: unknown;
    props: unknown;
  };

  return { data: comparable(call.data), props: call.props };
}

/*
 * Ask AI's way: the model proposes the call, the turn pauses on its card,
 * and the person approves it.
 */
async function approvedOnAskAisCard(data: {
  call: { name: string; arguments: JSONObject };
  props: DatabaseCommonInteractionProps;
  hasMonitor?: boolean | undefined;
}): Promise<Spies> {
  const call: { id: string; name: string; arguments: JSONObject } = {
    id: "call-1",
    ...data.call,
  };
  const request: ChatTurnRequest = {
    projectId: PROJECT_ID,
    userId: data.props.userId!,
    conversationId: ObjectID.generate(),
    assistantMessageId: ObjectID.generate(),
    aiRunId: ObjectID.generate(),
    permissionMode: AIChatPermissionMode.AskForApproval,
    props: data.props,
  };

  const proposing: Spies = installSpies({ hasMonitor: data.hasMonitor });
  proposing.executeWithLogging.mockResolvedValueOnce({
    content: "",
    stopReason: "tool_use",
    toolCalls: [call],
    llmLog: { totalTokens: 10, costInUSDCents: 1 },
  } as unknown as AILogResponse as never);
  await ChatAgentRunner.runTurn(request);

  let paused: AIRunPausedState | undefined = undefined;

  for (const update of proposing.runUpdateOneBy.mock.calls) {
    const arg: { data?: JSONObject } = update[0] as { data?: JSONObject };

    if (arg.data?.["pausedState"]) {
      paused = arg.data["pausedState"] as unknown as AIRunPausedState;
    }
  }

  expect(paused).toBeDefined();
  jest.restoreAllMocks();
  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest.spyOn(logger, "debug").mockImplementation((): void => {});

  const run: AIRun = new AIRun();
  run.status = AIRunStatus.WaitingForApproval;
  run.pausedState = paused!;
  const approving: Spies = installSpies({ run, hasMonitor: data.hasMonitor });

  await ChatAgentRunner.resumeTurn(request, [
    { toolCallId: call.id, approved: true },
  ]);

  return approving;
}

// The agent's way: one call, through SetupActionRunner.
async function calledByAnAgent(data: {
  call: { name: string; arguments: JSONObject };
  props: DatabaseCommonInteractionProps;
  hasMonitor?: boolean | undefined;
}): Promise<{ spies: Spies; result: SetupActionRunResult }> {
  const spies: Spies = installSpies({ hasMonitor: data.hasMonitor });
  const result: SetupActionRunResult = await SetupActionRunner.run({
    action: data.call.name,
    args: data.call.arguments,
    ctx: ctxOf(data.props),
  });

  return { spies, result };
}

describe("an agent's call makes the records an approved Ask AI card makes", () => {
  test("set_up_website_monitoring: the same monitor, created as the same person", async () => {
    const props: DatabaseCommonInteractionProps = ownerProps();
    const call: { name: string; arguments: JSONObject } = {
      name: "set_up_website_monitoring",
      arguments: { address: "example.com", checkEveryMinutes: 1 },
    };

    const askAi: Spies = await approvedOnAskAisCard({ call, props });
    const fromAskAi: { data: unknown; props: unknown } = createdBy(
      askAi.monitorCreate,
    );
    jest.restoreAllMocks();

    const agent: { spies: Spies; result: SetupActionRunResult } =
      await calledByAnAgent({ call, props });
    const fromAgent: { data: unknown; props: unknown } = createdBy(
      agent.spies.monitorCreate,
    );

    expect(agent.spies.monitorCreate).toHaveBeenCalledTimes(1);
    expect(fromAgent.data).toEqual(fromAskAi.data);
    expect(fromAgent.props).toBe(props);
    expect(fromAskAi.props).toBe(props);
    expect((fromAgent.data as JSONObject)["name"]).toBe("example.com");
  });

  test("set_up_paging: the same policy, its escalation rule and its two on-call rules", async () => {
    const props: DatabaseCommonInteractionProps = ownerProps();
    const call: { name: string; arguments: JSONObject } = {
      name: "set_up_paging",
      arguments: { reachMeBy: ["sms"] },
    };

    /*
     * The policy's create carries its first escalation rule and the two
     * catch-all on-call rules (miscDataProps), as the guided setups make it.
     */
    const policyOf: (spies: Spies) => unknown = (spies: Spies): unknown => {
      const create: { data: unknown; miscDataProps: unknown; props: unknown } =
        spies.policyCreate.mock.calls[0]![0] as {
          data: unknown;
          miscDataProps: unknown;
          props: unknown;
        };

      return {
        data: comparable(create.data),
        miscDataProps: comparable(create.miscDataProps),
        props: create.props,
      };
    };

    const askAi: Spies = await approvedOnAskAisCard({ call, props });
    const fromAskAi: unknown = policyOf(askAi);
    jest.restoreAllMocks();

    const agent: { spies: Spies; result: SetupActionRunResult } =
      await calledByAnAgent({ call, props });

    expect(agent.spies.policyCreate).toHaveBeenCalledTimes(1);
    expect(policyOf(agent.spies)).toEqual(fromAskAi);
    expect((policyOf(agent.spies) as { props: unknown }).props).toBe(props);

    const miscData: JSONObject = (
      policyOf(agent.spies) as { miscDataProps: JSONObject }
    ).miscDataProps;
    expect(Object.keys(miscData).length).toBeGreaterThan(0);
  });

  test("publish_status_page: the same page, showing the same monitor", async () => {
    const props: DatabaseCommonInteractionProps = ownerProps();
    const call: { name: string; arguments: JSONObject } = {
      name: "publish_status_page",
      arguments: { name: "Acme Status", monitors: ["example.com"] },
    };

    const askAi: Spies = await approvedOnAskAisCard({
      call,
      props,
      hasMonitor: true,
    });
    const askAiPage: { data: unknown; props: unknown } = createdBy(
      askAi.statusPageCreate,
    );
    const askAiResource: unknown = createdBy(askAi.resourceCreate).data;
    jest.restoreAllMocks();

    const agent: { spies: Spies; result: SetupActionRunResult } =
      await calledByAnAgent({ call, props, hasMonitor: true });

    expect(createdBy(agent.spies.statusPageCreate)).toEqual(askAiPage);
    expect(createdBy(agent.spies.resourceCreate).data).toEqual(askAiResource);
    expect(
      (
        agent.spies.resourceCreate.mock.calls[0]![0] as {
          data: StatusPageResource;
        }
      ).data.monitorId?.toString(),
    ).toBe(MONITOR_ID);
  });
});

describe("what an agent is answered with", () => {
  test("what was made, in the card's words, and the record it opens", async () => {
    const { result } = await calledByAnAgent({
      call: {
        name: "set_up_website_monitoring",
        arguments: { address: "example.com", checkEveryMinutes: 1 },
      },
      props: ownerProps(),
    });

    expect(result.action).toBe("set_up_website_monitoring");
    expect(result.title).toBe("Set up monitoring for example.com");
    expect(result.details.join(" ")).toBe(
      "A website monitor checks https://example.com every minute. It is checked from 2 locations. If it does not answer, or answers with an error, OneUptime opens an incident (Critical). A status change needs both connected probes to agree. You own this monitor, so you are emailed when its status changes.",
    );
    expect(result.message).toContain(
      'Created the Website monitor "example.com", checking https://example.com every minute',
    );
    expect(result.record).toEqual({
      type: "MonitorView",
      params: { monitorId: MONITOR_ID },
    });
  });

  test("its words point to OneUptime's own pages: no card, no test page under an answer", async () => {
    const monitor: { result: SetupActionRunResult } = await calledByAnAgent({
      call: {
        name: "set_up_website_monitoring",
        arguments: { address: "example.com" },
      },
      props: ownerProps(),
    });
    jest.restoreAllMocks();
    const paging: { result: SetupActionRunResult } = await calledByAnAgent({
      call: { name: "set_up_paging", arguments: { reachMeBy: ["sms"] } },
      props: ownerProps(),
    });

    for (const message of [monitor.result.message, paging.result.message]) {
      expect(message).not.toContain("Under your answer");
      expect(message).not.toContain("approval card");
      expect(message).not.toContain("find_dashboard_page");
      expect(message).toContain("No test page was sent.");
    }

    expect(monitor.result.message).toContain(
      "Send me a test page, under User Settings > Notification Methods",
    );
    expect(paging.result.message).toContain("On-Call > Readiness");
    expect(paging.result.message).toContain(
      "If the details say a phone number or the app is missing",
    );

    // What the person still has to add, said where Ask AI's card says it.
    expect(paging.result.details.join(" ")).toContain(
      "You have no verified phone number for texts yet.",
    );
  });

  test("Ask AI's own run keeps its words: the card and the test page under its answer", async () => {
    const outcome: { textForLlm: string } = await (async () => {
      installSpies();
      return await AIToolbox.executeTool({
        name: "set_up_website_monitoring",
        args: { address: "example.com" },
        ctx: ctxOf(ownerProps()),
      });
    })();

    expect(outcome.textForLlm).toContain(
      "Under your answer the person can send themselves a test page; offer it in one sentence and never say one was sent.",
    );
    expect(outcome.textForLlm).not.toContain("No test page was sent.");
  });

  test("who_is_told reads, and answers what the chain says", async () => {
    installSpies({ hasMonitor: true });
    jest
      .spyOn(MonitorService, "findOneBy")
      .mockResolvedValue(
        model(Monitor, { _id: MONITOR_ID, name: "example.com" }) as never,
      );
    const chain: SpyInstance = jest
      .spyOn(WhoIsToldService, "getForMonitor")
      .mockResolvedValue({ criteria: [], breaks: [] } as never);

    const result: SetupActionRunResult = await SetupActionRunner.run({
      action: "who_is_told",
      args: { monitor: MONITOR_ID },
      ctx: ctxOf(ownerProps()),
    });

    expect(chain).toHaveBeenCalledTimes(1);
    expect(result.action).toBe("who_is_told");
    expect(result.title).toBeUndefined();
    expect(result.details).toEqual([]);
    expect(typeof result.message).toBe("string");
  });
});

describe("what is refused before anything is made", () => {
  async function refusal(data: {
    action: string;
    args: unknown;
    props?: DatabaseCommonInteractionProps | undefined;
    policies?: number;
  }): Promise<{ error: Error; spies: Spies }> {
    const spies: Spies = installSpies({ policies: data.policies ?? 0 });
    let error: Error | null = null;

    try {
      await SetupActionRunner.run({
        action: data.action,
        args: data.args,
        ctx: ctxOf(data.props || ownerProps()),
      });
    } catch (caught) {
      error = caught as Error;
    }

    expect(error).not.toBeNull();
    expect(spies.monitorCreate).not.toHaveBeenCalled();
    expect(spies.policyCreate).not.toHaveBeenCalled();
    expect(spies.statusPageCreate).not.toHaveBeenCalled();
    expect(spies.resourceCreate).not.toHaveBeenCalled();

    return { error: error!, spies };
  }

  test("a person whose role may not make it: 403, with the permission it needs", async () => {
    const { error } = await refusal({
      action: "set_up_website_monitoring",
      args: { address: "example.com" },
      props: ownerProps([Permission.Viewer]),
    });

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.message).toContain(
      "does not have permission to use set_up_website_monitoring",
    );
    expect(error.message).toContain("Create Monitor");
  });

  test("a project API key: 403, it acts as a person, and what to do instead", async () => {
    const { error } = await refusal({
      action: "set_up_website_monitoring",
      args: { address: "example.com" },
      props: {
        ...customDomainCaller({
          permissions: [Permission.ProjectOwner],
          projectId: PROJECT_ID,
          isApiKey: true,
        }),
        ...ON_HIGHEST_PLAN,
      },
    });

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.message).toBe(API_KEY_REFUSAL("set_up_website_monitoring"));
  });

  test("a connection authorized as read-only: 403, every setup action", async () => {
    const props: DatabaseCommonInteractionProps = ownerProps();
    props.isReadOnlyCredential = true;

    const { error } = await refusal({
      action: "publish_status_page",
      args: { monitors: ["example.com"] },
      props,
    });

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.message).toBe(READ_ONLY_CONNECTION_REFUSAL);
  });

  test("a project that pages people already: 400, and it keeps its own policies", async () => {
    const { error } = await refusal({
      action: "set_up_paging",
      args: {},
      policies: 2,
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toContain("already pages people");
    expect(error.message).not.toContain("Nothing proposed");
  });

  test("an address that is not one: 400, and what to ask for", async () => {
    const { error } = await refusal({
      action: "set_up_website_monitoring",
      args: { address: "the website" },
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toContain(
      "That is not a web address a website monitor can check",
    );
  });

  test("the plan: 402, in the plan's own words", async () => {
    installSpies();
    jest
      .spyOn(ActiveMonitorLimit, "getRefusal")
      .mockResolvedValue(
        "Your plan allows 5 active monitors. Upgrade to add more." as never,
      );
    const create: SpyInstance = jest.spyOn(MonitorService, "create");

    await expect(
      SetupActionRunner.run({
        action: "set_up_website_monitoring",
        args: { address: "example.com" },
        ctx: ctxOf(ownerProps()),
      }),
    ).rejects.toBeInstanceOf(PaymentRequiredException);
    expect(create).not.toHaveBeenCalled();
  });

  test("its product switched off on the server: 403, and who can switch it on", async () => {
    installSpies();
    jest.spyOn(ServerProducts, "getFirstOff").mockResolvedValue({
      product: ProductKey.StatusPages,
      reason: ServerProductOffReason.SwitchedOff,
    } as never);

    let error: Error | null = null;

    try {
      await SetupActionRunner.run({
        action: "publish_status_page",
        args: { monitors: ["example.com"] },
        ctx: ctxOf(ownerProps()),
      });
    } catch (caught) {
      error = caught as Error;
    }

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error?.message).toContain(
      "Status Pages is switched off on this server.",
    );
  });

  test.each([
    [
      "an action of Ask AI's that is not offered outside the chat",
      "create_incident",
    ],
    ["a setup action the MCP server does not offer", "set_how_to_reach_me"],
    ["a name that is no tool", "drop_tables"],
  ])("%s: 400", async (_why: string, action: string) => {
    const { error } = await refusal({ action, args: {} });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toContain(`Unknown setup action "${action}"`);
  });

  test("arguments that are not an object: 400", async () => {
    for (const args of [[], "example.com", null]) {
      const { error } = await refusal({
        action: "set_up_website_monitoring",
        args,
      });

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toContain("must be a JSON object");
    }
  });
});

describe("the actions it runs", () => {
  test("are Ask AI's own tools: setup actions, and the read beside them", () => {
    for (const action of SETUP_ACTIONS_RUN_OUTSIDE_CHAT) {
      expect([action, Boolean(AIToolbox.getToolByName(action))]).toEqual([
        action,
        true,
      ]);
    }

    expect(
      SETUP_ACTIONS_RUN_OUTSIDE_CHAT.filter((action: string): boolean => {
        return !AIToolbox.isSetupAction(action);
      }),
    ).toEqual(["who_is_told"]);
  });
});
