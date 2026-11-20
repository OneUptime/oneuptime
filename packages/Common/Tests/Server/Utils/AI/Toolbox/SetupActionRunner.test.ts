import ChatAgentRunner, {
  ChatTurnRequest,
} from "../../../../../Server/Utils/AI/Chat/ChatAgentRunner";
import ChatInfrastructureAccess from "../../../../../Server/Utils/AI/Chat/ChatInfrastructureAccess";
import AIToolbox from "../../../../../Server/Utils/AI/Toolbox/Index";
import SetupActionRunner, {
  READ_ONLY_CONNECTION_REFUSAL,
  readArgumentsTheSchemaTakes,
} from "../../../../../Server/Utils/AI/Toolbox/SetupActionRunner";
import {
  ObservabilityTool,
  ToolContext,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
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
  AI_SETUP_ACTION_TOOL_NAMES,
  SETUP_ACTIONS_RUN_OUTSIDE_CHAT,
  SetupActionRunResult,
  getSetupActionApiKeyRefusal,
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
import OnCallDutyPolicyEscalationRuleService from "../../../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleTeamService from "../../../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import PagingLadderService from "../../../../../Server/Services/PagingLadderService";
import ProjectMilestoneService from "../../../../../Server/Services/ProjectMilestoneService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import TeamMemberService from "../../../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../../../Server/Services/TeamPermissionService";
import TeamService from "../../../../../Server/Services/TeamService";
import ServerSendingStatus from "../../../../../Server/Utils/ServerSending/ServerSendingStatus";
import OnCallDutyPolicyEscalationRule from "../../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleUser from "../../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import ProjectMilestone from "../../../../../Models/DatabaseModels/ProjectMilestone";
import Service from "../../../../../Models/DatabaseModels/Service";
import Team from "../../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../../Models/DatabaseModels/TeamMember";
import TeamPermission from "../../../../../Models/DatabaseModels/TeamPermission";
import User from "../../../../../Models/DatabaseModels/User";
import UserNotificationRule from "../../../../../Models/DatabaseModels/UserNotificationRule";
import ActivationMilestone from "../../../../../Types/Analytics/ActivationMilestone";
import NotificationRuleType from "../../../../../Types/NotificationRule/NotificationRuleType";
import ConflictException from "../../../../../Types/Exception/ConflictException";
import Email from "../../../../../Types/Email";
import Name from "../../../../../Types/Name";
import { getPagingLadderCells } from "../../../../../Types/NotificationRule/PagingLadder";
import { PagingLadderMethodReference } from "../../../../../Types/NotificationRule/PagingLadderDefault";
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

/*
 * A new project's owner: who sets a project up first - signed in, so they
 * hold what every signed-in person holds (AccessTokenService), their own
 * settings among it (Current User), as an MCP client's OAuth connection
 * carries them too (McpDelegationAuthorization).
 */
function ownerProps(
  permissions: Array<Permission> = [Permission.ProjectOwner],
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions, projectId: PROJECT_ID }),
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [PROJECT_ID],
      globalPermissions: [
        Permission.Public,
        Permission.User,
        Permission.CurrentUser,
      ],
    },
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
  // What an action of its own reads and writes (the four #10041 adds).
  project?: (() => void) | undefined;
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

  data?.project?.();

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
  project?: (() => void) | undefined;
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

  const proposing: Spies = installSpies({
    hasMonitor: data.hasMonitor,
    project: data.project,
  });
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
  const approving: Spies = installSpies({
    run,
    hasMonitor: data.hasMonitor,
    project: data.project,
  });

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
  project?: (() => void) | undefined;
}): Promise<{ spies: Spies; result: SetupActionRunResult }> {
  const spies: Spies = installSpies({
    hasMonitor: data.hasMonitor,
    project: data.project,
  });
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
    expect(error.message).toBe(
      getSetupActionApiKeyRefusal("set_up_website_monitoring"),
    );
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
    ["a read of Ask AI's that is not offered outside the chat", "search_docs"],
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

  test("are every setup action of Ask AI's (#10041), and the read beside them", () => {
    expect([...SETUP_ACTIONS_RUN_OUTSIDE_CHAT].sort()).toEqual(
      [...AI_SETUP_ACTION_TOOL_NAMES, "who_is_told"].sort(),
    );
  });
});

/*
 * THE FOUR #10041 ADDS: a service's recommended monitor, people added to a
 * policy the project has, invitations, and the person's own How to Reach
 * Me. Each makes what an approved Ask AI card makes, as the same person;
 * a key is refused in that action's own words; a second identical call
 * makes nothing twice; and what an action's prepare works out is never
 * the caller's to hand it.
 */

const SERVICE_ID: string = "10041000-0000-4000-8000-000000000001";
const LEVEL_ONE_ID: string = "10041000-0000-4000-8000-000000000002";
const LEVEL_TWO_ID: string = "10041000-0000-4000-8000-000000000003";
const ANA_ID: string = "10041000-0000-4000-8000-000000000004";
const STRANGER_ID: string = "10041000-0000-4000-8000-000000000005";
const MEMBERS_TEAM_ID: string = "10041000-0000-4000-8000-000000000006";
const OWNERS_TEAM_ID: string = "10041000-0000-4000-8000-000000000007";
const SMS_ID: string = "10041000-0000-4000-8000-000000000008";
const CALL_ID: string = "10041000-0000-4000-8000-000000000009";

function apiKeyProps(): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({
      permissions: [Permission.ProjectOwner],
      projectId: PROJECT_ID,
      isApiKey: true,
    }),
    ...ON_HIGHEST_PLAN,
  };
}

// The checkout service, which sends traces, metrics, exceptions and logs.
function sendsTelemetry(): void {
  jest.spyOn(ServiceService, "findOneBy").mockResolvedValue(
    model(Service, {
      _id: SERVICE_ID,
      name: "checkout",
      lastSeenAt: new Date(),
    }) as never,
  );
  jest.spyOn(ProjectMilestoneService, "findBy").mockResolvedValue(
    [
      ActivationMilestone.FirstTracesReceived,
      ActivationMilestone.FirstMetricsReceived,
      ActivationMilestone.FirstExceptionsReceived,
      ActivationMilestone.FirstLogsReceived,
    ].map((milestone: ActivationMilestone) => {
      return model(ProjectMilestone, { milestone: milestone });
    }) as never,
  );
  // The project's monitors are the ones made so far.
  jest.spyOn(MonitorService, "findBy").mockImplementation((async (): Promise<
    Array<Monitor>
  > => {
    return (MonitorService.create as unknown as SpyInstance).mock.calls.map(
      (call: Array<unknown>): Monitor => {
        return (call[0] as { data: Monitor }).data;
      },
    );
  }) as never);
}

interface PolicyRows {
  levels: Array<string>;
  // Who each level pages: its user rows.
  userRows: Array<{ ruleId: string; userId: string }>;
}

/*
 * A project with the policy "Payments on-call" (one level, or `levels`),
 * Ana Lopez a member, and every row made kept, so a second call reads
 * what the first made.
 */
function pagesWithPolicy(data?: { levels?: number }): PolicyRows {
  const rows: PolicyRows = {
    levels: [LEVEL_ONE_ID, LEVEL_TWO_ID].slice(0, data?.levels ?? 1),
    userRows: [],
  };

  jest
    .spyOn(OnCallDutyPolicyService, "findBy")
    .mockResolvedValue([
      model(OnCallDutyPolicy, { _id: POLICY_ID, name: "Payments on-call" }),
    ] as never);
  jest
    .spyOn(OnCallDutyPolicyEscalationRuleService, "findBy")
    .mockImplementation((async (): Promise<
      Array<OnCallDutyPolicyEscalationRule>
    > => {
      return rows.levels.map((id: string, index: number) => {
        return model(OnCallDutyPolicyEscalationRule, {
          _id: id,
          name: `Level ${index + 1}`,
          order: index + 1,
          escalateAfterInMinutes: 30,
        });
      });
    }) as never);
  jest
    .spyOn(OnCallDutyPolicyEscalationRuleUserService, "findBy")
    .mockImplementation((async (args: {
      query: JSONObject;
    }): Promise<Array<OnCallDutyPolicyEscalationRuleUser>> => {
      const ruleId: string = String(
        args.query["onCallDutyPolicyEscalationRuleId"],
      );

      return rows.userRows
        .filter((row: { ruleId: string }): boolean => {
          return row.ruleId === ruleId;
        })
        .map((row: { userId: string }) => {
          return model(OnCallDutyPolicyEscalationRuleUser, {
            userId: new ObjectID(row.userId),
          });
        });
    }) as never);
  jest
    .spyOn(OnCallDutyPolicyEscalationRuleTeamService, "findBy")
    .mockResolvedValue([] as never);
  jest
    .spyOn(OnCallDutyPolicyEscalationRuleUserService, "create")
    .mockImplementation((async (args: {
      data: OnCallDutyPolicyEscalationRuleUser;
    }): Promise<OnCallDutyPolicyEscalationRuleUser> => {
      rows.userRows.push({
        ruleId: args.data.onCallDutyPolicyEscalationRuleId!.toString(),
        userId: args.data.userId!.toString(),
      });
      return args.data;
    }) as never);
  jest
    .spyOn(OnCallDutyPolicyEscalationRuleService, "create")
    .mockImplementation((async (args: {
      miscDataProps: JSONObject;
    }): Promise<OnCallDutyPolicyEscalationRule> => {
      const id: string = LEVEL_TWO_ID;
      rows.levels.push(id);

      for (const userId of (args.miscDataProps["users"] as Array<string>) ||
        []) {
        rows.userRows.push({ ruleId: id, userId: userId });
      }

      return new OnCallDutyPolicyEscalationRule();
    }) as never);
  jest
    .spyOn(OnCallDutyPolicyEscalationRuleService, "findOneById")
    .mockResolvedValue(
      model(OnCallDutyPolicyEscalationRule, {
        _id: LEVEL_ONE_ID,
        escalateAfterInMinutes: 30,
      }) as never,
    );
  jest
    .spyOn(OnCallDutyPolicyEscalationRuleService, "updateOneById")
    .mockResolvedValue(undefined as never);

  const ana: User = model(User, {
    _id: ANA_ID,
    name: new Name("Ana Lopez"),
    email: new Email("ana@acme.example"),
  });

  jest.spyOn(TeamMemberService, "findBy").mockImplementation((async (args: {
    select: JSONObject;
  }): Promise<Array<TeamMember>> => {
    return [
      model(TeamMember, {
        _id: "10041000-0000-4000-8000-0000000000a1",
        userId: new ObjectID(ANA_ID),
        ...(args.select["user"] ? { user: ana } : {}),
      }),
    ];
  }) as never);
  jest.spyOn(TeamService, "findBy").mockResolvedValue([] as never);

  return rows;
}

/*
 * A project whose teams are Owners and Members, as a project starts, which
 * the person may hand on unless told, and whose people are those invited
 * so far.
 */
function invitesPeople(data?: { cannotGrant?: Array<string> }): {
  invited: Array<string>;
} {
  const state: { invited: Array<string> } = { invited: [] };

  jest
    .spyOn(TeamService, "findBy")
    .mockResolvedValue([
      model(Team, { _id: OWNERS_TEAM_ID, name: "Owners" }),
      model(Team, { _id: MEMBERS_TEAM_ID, name: "Members" }),
    ] as never);
  jest.spyOn(TeamPermissionService, "findBy").mockResolvedValue([
    model(TeamPermission, {
      teamId: new ObjectID(OWNERS_TEAM_ID),
      permission: Permission.ProjectOwner,
      isBlockPermission: false,
    }),
    model(TeamPermission, {
      teamId: new ObjectID(MEMBERS_TEAM_ID),
      permission: Permission.ProjectMember,
      isBlockPermission: false,
    }),
  ] as never);
  jest
    .spyOn(TeamPermissionService, "findTeamsCallerCannotGrant")
    .mockResolvedValue(
      (data?.cannotGrant || []).map((id: string): ObjectID => {
        return new ObjectID(id);
      }) as never,
    );
  jest.spyOn(TeamMemberService, "findBy").mockImplementation((async (args: {
    select: JSONObject;
  }): Promise<Array<TeamMember>> => {
    return state.invited.map((email: string, index: number) => {
      return model(TeamMember, {
        _id: `10041000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`,
        userId: new ObjectID(
          `10041000-0000-4000-8000-0000000002${String(index).padStart(2, "0")}`,
        ),
        ...(args.select["user"]
          ? { user: model(User, { email: new Email(email) }) }
          : {}),
      });
    });
  }) as never);
  jest
    .spyOn(ServerSendingStatus, "canSendEmailPublicly")
    .mockResolvedValue(true as never);
  jest
    .spyOn(TeamMemberService, "getInvitationRefusal")
    .mockResolvedValue(null as never);
  jest.spyOn(TeamMemberService, "create").mockImplementation((async (args: {
    miscDataProps: JSONObject;
  }): Promise<TeamMember> => {
    state.invited.push(String(args.miscDataProps["email"]));
    return new TeamMember();
  }) as never);

  return state;
}

// The person's verified number, for texts and calls, and no rules yet.
function canBeTextedAndCalled(): void {
  const methods: Array<PagingLadderMethodReference> = [
    { methodColumn: "userSmsId", methodId: SMS_ID },
    { methodColumn: "userCallId", methodId: CALL_ID },
  ];

  jest
    .spyOn(PagingLadderService, "getUsableMethods")
    .mockResolvedValue(methods as never);
  jest.spyOn(PagingLadderService, "getCells").mockResolvedValue(
    getPagingLadderCells({
      incidentSeverities: [{ _id: INCIDENT_SEVERITY, name: "Critical" }],
      alertSeverities: [{ _id: ALERT_SEVERITY, name: "High" }],
    }) as never,
  );
  jest.spyOn(PagingLadderService, "getRules").mockResolvedValue([] as never);
  jest.spyOn(PagingLadderService, "applyLadder").mockResolvedValue({
    createdCount: 8,
    updatedCount: 0,
    deletedCount: 0,
  } as never);
}

// What the first create or save was handed, as it was handed.
function rawCall(spy: SpyInstance): JSONObject {
  return spy.mock.calls[0]![0] as JSONObject;
}

// The same, as comparable JSON, and as whom.
function handed(spy: SpyInstance): JSONObject {
  const call: JSONObject = rawCall(spy);

  return {
    ...(comparable(call) as JSONObject),
    props: call["props"] as unknown as JSONObject,
  };
}

// Email at once, for every incident and alert: a ladder the person has.
function emailAtOnceRules(emailId: string): Array<UserNotificationRule> {
  return [
    NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
    NotificationRuleType.ON_CALL_EXECUTED_ALERT,
    NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
  ].map((ruleType: NotificationRuleType): UserNotificationRule => {
    const isIncident: boolean =
      ruleType === NotificationRuleType.ON_CALL_EXECUTED_INCIDENT ||
      ruleType === NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE;

    return model(UserNotificationRule, {
      _id: ObjectID.generate().toString(),
      ruleType: ruleType,
      notifyAfterMinutes: 0,
      userEmailId: new ObjectID(emailId),
      ...(isIncident
        ? { incidentSeverityId: new ObjectID(INCIDENT_SEVERITY) }
        : { alertSeverityId: new ObjectID(ALERT_SEVERITY) }),
    });
  });
}

describe("the four actions #10041 adds make what an approved Ask AI card makes", () => {
  test("set_up_service_monitor: the same monitor, as the same person", async () => {
    const props: DatabaseCommonInteractionProps = ownerProps();
    const call: { name: string; arguments: JSONObject } = {
      name: "set_up_service_monitor",
      arguments: { service: "checkout", monitor: "errors" },
    };

    const askAi: Spies = await approvedOnAskAisCard({
      call,
      props,
      project: sendsTelemetry,
    });
    const fromAskAi: JSONObject = handed(askAi.monitorCreate);
    jest.restoreAllMocks();

    const agent: { spies: Spies; result: SetupActionRunResult } =
      await calledByAnAgent({ call, props, project: sendsTelemetry });

    expect(agent.spies.monitorCreate).toHaveBeenCalledTimes(1);
    expect(handed(agent.spies.monitorCreate)).toEqual(fromAskAi);
    expect(fromAskAi["props"]).toBe(props);
    expect(agent.result.details.join(" ")).toContain(
      "It reads the data checkout sends and opens an alert for your team",
    );
    expect(agent.result.record).toEqual({
      type: "MonitorView",
      params: { monitorId: MONITOR_ID },
    });
  });

  test("add_to_on_call_policy: the same row on the same level, as the same person", async () => {
    const props: DatabaseCommonInteractionProps = ownerProps();
    const call: { name: string; arguments: JSONObject } = {
      name: "add_to_on_call_policy",
      arguments: { policy: "Payments on-call", alsoPage: ["Ana Lopez"] },
    };

    await approvedOnAskAisCard({
      call,
      props,
      project: (): void => {
        pagesWithPolicy();
      },
    });
    const fromAskAi: JSONObject = handed(
      OnCallDutyPolicyEscalationRuleUserService.create as unknown as SpyInstance,
    );
    jest.restoreAllMocks();

    let rows: PolicyRows | null = null;
    const agent: { spies: Spies; result: SetupActionRunResult } =
      await calledByAnAgent({
        call,
        props,
        project: (): void => {
          rows = pagesWithPolicy();
        },
      });

    expect(
      handed(
        OnCallDutyPolicyEscalationRuleUserService.create as unknown as SpyInstance,
      ),
    ).toEqual(fromAskAi);
    expect(fromAskAi["props"]).toBe(props);
    expect(rows!.userRows).toEqual([
      { ruleId: LEVEL_ONE_ID, userId: ANA_ID },
    ]);
    expect(agent.result.title).toBe('Add to on-call policy "Payments on-call"');
    expect(agent.result.details).toEqual([
      'Adds Ana Lopez to escalation rule "Level 1".',
    ]);
    expect(agent.result.message).toContain("On-Call > Readiness");
  });

  test("add_to_on_call_policy as a new level: the same escalation rule, and the level before waits as asked", async () => {
    const props: DatabaseCommonInteractionProps = ownerProps();
    const call: { name: string; arguments: JSONObject } = {
      name: "add_to_on_call_policy",
      arguments: { alsoPage: ["ana@acme.example"], level: 2, afterMinutes: 5 },
    };

    await approvedOnAskAisCard({
      call,
      props,
      project: (): void => {
        pagesWithPolicy();
      },
    });
    const fromAskAi: JSONObject = handed(
      OnCallDutyPolicyEscalationRuleService.create as unknown as SpyInstance,
    );
    const waitFromAskAi: JSONObject = handed(
      OnCallDutyPolicyEscalationRuleService.updateOneById as unknown as SpyInstance,
    );
    const levelFromAskAi: JSONObject = rawCall(
      OnCallDutyPolicyEscalationRuleService.create as unknown as SpyInstance,
    );
    jest.restoreAllMocks();

    await calledByAnAgent({
      call,
      props,
      project: (): void => {
        pagesWithPolicy();
      },
    });

    expect(
      handed(
        OnCallDutyPolicyEscalationRuleService.create as unknown as SpyInstance,
      ),
    ).toEqual(fromAskAi);
    expect(
      handed(
        OnCallDutyPolicyEscalationRuleService.updateOneById as unknown as SpyInstance,
      ),
    ).toEqual(waitFromAskAi);
    expect(levelFromAskAi["miscDataProps"]).toEqual({
      users: [ANA_ID],
      teams: [],
    });
  });

  test("invite_people: the same invitation, on the same team, as the same person", async () => {
    const props: DatabaseCommonInteractionProps = ownerProps();
    const call: { name: string; arguments: JSONObject } = {
      name: "invite_people",
      arguments: { emails: ["Ana@Acme.example"] },
    };

    await approvedOnAskAisCard({
      call,
      props,
      project: (): void => {
        invitesPeople();
      },
    });
    const fromAskAi: JSONObject = handed(
      TeamMemberService.create as unknown as SpyInstance,
    );
    const invitationFromAskAi: { data: TeamMember } = rawCall(
      TeamMemberService.create as unknown as SpyInstance,
    ) as unknown as { data: TeamMember };
    jest.restoreAllMocks();

    const agent: { spies: Spies; result: SetupActionRunResult } =
      await calledByAnAgent({
        call,
        props,
        project: (): void => {
          invitesPeople();
        },
      });

    expect(handed(TeamMemberService.create as unknown as SpyInstance)).toEqual(
      fromAskAi,
    );
    expect(fromAskAi["props"]).toBe(props);
    expect(fromAskAi["miscDataProps"]).toEqual({ email: "ana@acme.example" });
    // The team Invite User starts on: the project's members team.
    expect(invitationFromAskAi.data.teamId?.toString()).toBe(MEMBERS_TEAM_ID);
    expect(agent.result.details).toEqual([
      "They join the Members team, and each gets an email to accept the invitation.",
    ]);
    expect(agent.result.message).toContain(
      "Invited ana@acme.example to this project, on the Members team.",
    );
  });

  test("set_how_to_reach_me: the same ladder saved, for the same person", async () => {
    const props: DatabaseCommonInteractionProps = ownerProps();
    const call: { name: string; arguments: JSONObject } = {
      name: "set_how_to_reach_me",
      arguments: {
        steps: [
          { by: "sms", afterMinutes: 0 },
          { by: "call", afterMinutes: 5 },
        ],
      },
    };

    await approvedOnAskAisCard({ call, props, project: canBeTextedAndCalled });
    const fromAskAi: JSONObject = handed(
      PagingLadderService.applyLadder as unknown as SpyInstance,
    );
    jest.restoreAllMocks();

    const agent: { spies: Spies; result: SetupActionRunResult } =
      await calledByAnAgent({ call, props, project: canBeTextedAndCalled });

    expect(
      handed(PagingLadderService.applyLadder as unknown as SpyInstance),
    ).toEqual(fromAskAi);
    expect(fromAskAi["props"]).toBe(props);
    // The person's own ladder: never anyone else's.
    expect(
      String(
        rawCall(PagingLadderService.applyLadder as unknown as SpyInstance)[
          "targetUserId"
        ],
      ),
    ).toBe(props.userId!.toString());
    expect(agent.result.details).toEqual([
      "At once: SMS.",
      "After 5 minutes: phone call.",
      "This replaces how pages reach you now, for every incident and alert at every severity.",
    ]);
    expect(agent.result.message).toContain(
      "Send me a test page, under User Settings > Notification Methods",
    );
  });
});

describe("a project API key is refused each of the four, in its own words", () => {
  test.each([
    ["set_up_service_monitor", { service: "checkout", monitor: "errors" }],
    ["add_to_on_call_policy", { alsoPage: ["Ana Lopez"] }],
    ["invite_people", { emails: ["ana@acme.example"] }],
    ["set_how_to_reach_me", { steps: [{ by: "sms" }] }],
  ])(
    "%s: 403 before anything is read",
    async (action: string, args: JSONObject) => {
      installSpies();
      const reads: Array<SpyInstance> = [
        jest.spyOn(ServiceService, "findOneBy"),
        jest.spyOn(OnCallDutyPolicyService, "findBy"),
        jest.spyOn(TeamService, "findBy"),
        jest.spyOn(PagingLadderService, "getUsableMethods"),
      ];

      await expect(
        SetupActionRunner.run({ action, args, ctx: ctxOf(apiKeyProps()) }),
      ).rejects.toThrow(getSetupActionApiKeyRefusal(action));

      for (const read of reads) {
        expect(read).not.toHaveBeenCalled();
      }
    },
  );

  test("How to Reach Me is the person's own: for a key there is nobody to set it for", () => {
    expect(getSetupActionApiKeyRefusal("set_how_to_reach_me")).toBe(
      "set_how_to_reach_me sets how pages reach the person signed in to OneUptime: their own How to Reach Me. A project API key is not a person, so there is nobody whose How to Reach Me it could set. Connect this MCP client by signing in to OneUptime (OAuth) as the person to be reached.",
    );
  });

  test("an invitation names who sent it: a key cannot send one", () => {
    expect(getSetupActionApiKeyRefusal("invite_people")).toBe(
      "invite_people sends each invitation in the name of the person signed in to OneUptime: the email says who invited them, and a reply reaches that person. A project API key is not a person, so it cannot invite anyone. Connect this MCP client by signing in to OneUptime (OAuth) to invite people.",
    );
  });

  test("the others make what is theirs, and say what to do instead", () => {
    for (const action of [
      "set_up_website_monitoring",
      "set_up_service_monitor",
      "set_up_paging",
      "add_to_on_call_policy",
      "publish_status_page",
      "add_monitors_to_status_page",
    ]) {
      const words: string = getSetupActionApiKeyRefusal(action);

      expect(words.startsWith(`${action} acts as the person signed in`)).toBe(
        true,
      );
      expect(words).toContain("A project API key is not a person");
      expect(words).toContain("create the records one by one");
      // Never the reach-me ladder's or an invitation's words.
      expect(words).not.toContain("How to Reach Me");
      expect(words).not.toContain("invit");
    }
  });
});

describe("a second identical call makes nothing twice", () => {
  test("add_to_on_call_policy on a level: the second adds no row, and says who the level pages already", async () => {
    let rows: PolicyRows | null = null;
    installSpies({
      project: (): void => {
        rows = pagesWithPolicy();
      },
    });
    const call: { action: string; args: JSONObject } = {
      action: "add_to_on_call_policy",
      args: { policy: "Payments on-call", alsoPage: ["Ana Lopez"] },
    };

    await SetupActionRunner.run({ ...call, ctx: ctxOf(ownerProps()) });

    let error: Error | null = null;

    try {
      await SetupActionRunner.run({ ...call, ctx: ctxOf(ownerProps()) });
    } catch (caught) {
      error = caught as Error;
    }

    expect(rows!.userRows).toEqual([
      { ruleId: LEVEL_ONE_ID, userId: ANA_ID },
    ]);
    expect(
      OnCallDutyPolicyEscalationRuleUserService.create as unknown as SpyInstance,
    ).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(
      'Nothing was set up: level 1 of the on-call policy "Payments on-call" pages "Ana Lopez" already, so nobody is added again and no level is made. Say so in one sentence.',
    );
  });

  test("add_to_on_call_policy as a new level: the second makes no second escalation rule", async () => {
    let rows: PolicyRows | null = null;
    installSpies({
      project: (): void => {
        rows = pagesWithPolicy();
      },
    });
    const call: { action: string; args: JSONObject } = {
      action: "add_to_on_call_policy",
      args: { alsoPage: ["Ana Lopez"], level: 2, afterMinutes: 5 },
    };

    await SetupActionRunner.run({ ...call, ctx: ctxOf(ownerProps()) });
    await expect(
      SetupActionRunner.run({ ...call, ctx: ctxOf(ownerProps()) }),
    ).rejects.toThrow('level 2 of the on-call policy "Payments on-call" pages');

    expect(
      OnCallDutyPolicyEscalationRuleService.create as unknown as SpyInstance,
    ).toHaveBeenCalledTimes(1);
    expect(rows!.levels).toEqual([LEVEL_ONE_ID, LEVEL_TWO_ID]);
    expect(rows!.userRows).toEqual([
      { ruleId: LEVEL_TWO_ID, userId: ANA_ID },
    ]);
  });

  test("add_to_on_call_policy: someone added to the level since it was prepared gets no second row (409)", async () => {
    let rows: PolicyRows | null = null;
    installSpies({
      project: (): void => {
        rows = pagesWithPolicy();
      },
    });
    /*
     * Ana is added between the prepare's read of the level and the run's
     * own: the second read of who it pages.
     */
    const levelMembers: SpyInstance =
      OnCallDutyPolicyEscalationRuleUserService.findBy as unknown as SpyInstance;
    const asRead: (...args: Array<unknown>) => unknown =
      levelMembers.getMockImplementation() as (
        ...args: Array<unknown>
      ) => unknown;
    let reads: number = 0;
    levelMembers.mockImplementation(((...args: Array<unknown>) => {
      reads++;
      if (reads === 2) {
        rows!.userRows.push({ ruleId: LEVEL_ONE_ID, userId: ANA_ID });
      }
      return asRead(...args);
    }) as never);

    let error: Error | null = null;

    try {
      await SetupActionRunner.run({
        action: "add_to_on_call_policy",
        args: { alsoPage: ["Ana Lopez"] },
        ctx: ctxOf(ownerProps()),
      });
    } catch (caught) {
      error = caught as Error;
    }

    expect(error).toBeInstanceOf(ConflictException);
    expect(error?.message).toContain(
      'Level 1 of the on-call policy "Payments on-call" pages everyone named already, so nobody was added again.',
    );
    expect(
      OnCallDutyPolicyEscalationRuleUserService.create as unknown as SpyInstance,
    ).not.toHaveBeenCalled();
    expect(rows!.userRows).toHaveLength(1);
  });

  test("add_to_on_call_policy: a level made at that place since it was prepared makes no second one (409)", async () => {
    let rows: PolicyRows | null = null;
    installSpies({
      project: (): void => {
        rows = pagesWithPolicy();
      },
    });
    /*
     * A teammate adds level 2 between the check before the card and the
     * run: the third read of the policy's levels, after the prepare's and
     * the check's.
     */
    const levels: SpyInstance =
      OnCallDutyPolicyEscalationRuleService.findBy as unknown as SpyInstance;
    const asRead: (...args: Array<unknown>) => unknown =
      levels.getMockImplementation() as (...args: Array<unknown>) => unknown;
    let reads: number = 0;
    levels.mockImplementation(((...args: Array<unknown>) => {
      reads++;
      if (reads === 3) {
        rows!.levels.push(LEVEL_TWO_ID);
      }
      return asRead(...args);
    }) as never);

    let error: Error | null = null;

    try {
      await SetupActionRunner.run({
        action: "add_to_on_call_policy",
        args: { alsoPage: ["Ana Lopez"], level: 2, afterMinutes: 5 },
        ctx: ctxOf(ownerProps()),
      });
    } catch (caught) {
      error = caught as Error;
    }

    expect(error).toBeInstanceOf(ConflictException);
    expect(error?.message).toContain(
      'The on-call policy "Payments on-call" has a level 2 already, made since this was asked for, so no second one was made and nobody was added.',
    );
    expect(
      OnCallDutyPolicyEscalationRuleService.create as unknown as SpyInstance,
    ).not.toHaveBeenCalled();
    expect(
      OnCallDutyPolicyEscalationRuleService.updateOneById as unknown as SpyInstance,
    ).not.toHaveBeenCalled();
  });

  test("invite_people: the second sends no email, and says who is in the project already", async () => {
    let state: { invited: Array<string> } | null = null;
    installSpies({
      project: (): void => {
        state = invitesPeople();
      },
    });
    const call: { action: string; args: JSONObject } = {
      action: "invite_people",
      args: { emails: ["ana@acme.example"] },
    };

    await SetupActionRunner.run({ ...call, ctx: ctxOf(ownerProps()) });
    await expect(
      SetupActionRunner.run({ ...call, ctx: ctxOf(ownerProps()) }),
    ).rejects.toThrow(
      "Nothing was set up: ana@acme.example is in this project already, invited or a member, so nobody is invited again and no invitation email is sent. Say so in one sentence.",
    );

    expect(state!.invited).toEqual(["ana@acme.example"]);
    expect(
      TeamMemberService.create as unknown as SpyInstance,
    ).toHaveBeenCalledTimes(1);
  });

  test("set_up_service_monitor: the second makes no second monitor, and names the one there", async () => {
    const spies: Spies = installSpies({ project: sendsTelemetry });
    const call: { action: string; args: JSONObject } = {
      action: "set_up_service_monitor",
      args: { service: "checkout", monitor: "errors" },
    };

    await SetupActionRunner.run({ ...call, ctx: ctxOf(ownerProps()) });
    await expect(
      SetupActionRunner.run({ ...call, ctx: ctxOf(ownerProps()) }),
    ).rejects.toThrow('already watches "checkout" this way');

    expect(spies.monitorCreate).toHaveBeenCalledTimes(1);
  });

  test("set_how_to_reach_me: a ladder that reaches the person this way already is left as it is", async () => {
    const emailId: string = "10041000-0000-4000-8000-000000000010";
    installSpies({ project: canBeTextedAndCalled });
    // Their verified email, and their rules now: email at once, everywhere.
    jest
      .spyOn(PagingLadderService, "getUsableMethods")
      .mockResolvedValue([
        { methodColumn: "userEmailId", methodId: emailId },
      ] as never);
    jest
      .spyOn(PagingLadderService, "getRules")
      .mockResolvedValue(emailAtOnceRules(emailId) as never);

    await expect(
      SetupActionRunner.run({
        action: "set_how_to_reach_me",
        args: { steps: [{ by: "email", afterMinutes: 0 }] },
        ctx: ctxOf(ownerProps()),
      }),
    ).rejects.toThrow(
      "Nothing was set up: pages already reach the person exactly this way. Say so in one sentence.",
    );

    expect(
      PagingLadderService.applyLadder as unknown as SpyInstance,
    ).not.toHaveBeenCalled();
  });
});

describe("what a prepare works out is never the caller's to hand it", () => {
  test("only the arguments the action's schema takes are read", () => {
    const tool: ObservabilityTool = AIToolbox.getToolByName("invite_people")!;

    expect(
      readArgumentsTheSchemaTakes(tool, {
        emails: ["ana@acme.example"],
        teamId: OWNERS_TEAM_ID,
        teamName: "Owners",
        alreadyInProject: [],
      }),
    ).toEqual({ emails: ["ana@acme.example"] });
  });

  test("invite_people: a team the person may not hand on, named by the caller, invites nobody to it", async () => {
    installSpies({
      project: (): void => {
        invitesPeople({ cannotGrant: [OWNERS_TEAM_ID, MEMBERS_TEAM_ID] });
      },
    });

    let error: Error | null = null;

    try {
      await SetupActionRunner.run({
        action: "invite_people",
        args: {
          emails: ["ana@acme.example"],
          teamId: OWNERS_TEAM_ID,
          teamName: "Owners",
        },
        ctx: ctxOf(ownerProps()),
      });
    } catch (caught) {
      error = caught as Error;
    }

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toContain("no team could be picked for them");
    expect(TeamMemberService.create as unknown as SpyInstance).not.toHaveBeenCalled();
  });

  test("add_to_on_call_policy: a level and a person the caller names by id are not added when the prepare reads nothing", async () => {
    installSpies({
      project: (): void => {
        pagesWithPolicy();
      },
    });
    // The project's members cannot be read now: the prepare works out nothing.
    jest
      .spyOn(TeamMemberService, "findBy")
      .mockRejectedValue(new Error("Database is not reachable.") as never);

    await expect(
      SetupActionRunner.run({
        action: "add_to_on_call_policy",
        args: {
          policy: "Payments on-call",
          alsoPage: ["Ana Lopez"],
          policyId: POLICY_ID,
          policyName: "Payments on-call",
          ruleId: LEVEL_ONE_ID,
          userIds: [STRANGER_ID],
          people: ["A stranger"],
        },
        ctx: ctxOf(ownerProps()),
      }),
    ).rejects.toBeInstanceOf(BadDataException);

    expect(
      OnCallDutyPolicyEscalationRuleUserService.create as unknown as SpyInstance,
    ).not.toHaveBeenCalled();
  });
});
