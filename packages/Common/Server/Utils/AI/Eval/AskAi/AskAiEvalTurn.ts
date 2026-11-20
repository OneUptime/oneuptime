/*
 * The toolbox first: its tools import services that import it back, and
 * the toolbox lists them whole only when it is the one loaded first.
 */
import AIToolbox, { ToolCallOutcome } from "../../Toolbox/Index";
import AIConversation from "../../../../../Models/DatabaseModels/AIConversation";
import AIConversationMessage from "../../../../../Models/DatabaseModels/AIConversationMessage";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../../../Models/DatabaseModels/AIRunEvent";
import AlertOnCallRule from "../../../../../Models/DatabaseModels/AlertOnCallRule";
import AlertSeverity from "../../../../../Models/DatabaseModels/AlertSeverity";
import IncidentOnCallRule from "../../../../../Models/DatabaseModels/IncidentOnCallRule";
import IncidentSeverity from "../../../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../../Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleUser from "../../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import TeamPermission from "../../../../../Models/DatabaseModels/TeamPermission";
import Dashboard from "../../../../../Models/DatabaseModels/Dashboard";
import Form from "../../../../../Models/DatabaseModels/Form";
import IncomingCallPolicy from "../../../../../Models/DatabaseModels/IncomingCallPolicy";
import OnCallDutyPolicySchedule from "../../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Runbook from "../../../../../Models/DatabaseModels/Runbook";
import ServiceLevelObjective from "../../../../../Models/DatabaseModels/ServiceLevelObjective";
import Project from "../../../../../Models/DatabaseModels/Project";
import ProjectMilestone from "../../../../../Models/DatabaseModels/ProjectMilestone";
import Service from "../../../../../Models/DatabaseModels/Service";
import StatusPage from "../../../../../Models/DatabaseModels/StatusPage";
import Team from "../../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../../Models/DatabaseModels/User";
import AIChatMessageRole from "../../../../../Types/AI/AIChatMessageRole";
import AIChatMessageStatus from "../../../../../Types/AI/AIChatMessageStatus";
import AIChatPermissionMode from "../../../../../Types/AI/AIChatPermissionMode";
import { AIChatPageContext } from "../../../../../Types/AI/AIChatPageContext";
import {
  AIChatCitation,
  AIChatToolAction,
  AIChatToolActionStatus,
  AIRunPausedState,
} from "../../../../../Types/AI/AIChatTypes";
import AIRunEventType from "../../../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import Email from "../../../../../Types/Email";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import UserType from "../../../../../Types/UserType";
import { TELEMETRY_RECOMMENDATION_MILESTONES } from "../../../../../Utils/GuidedSetup/ServiceMonitorRecords";
import {
  GUIDED_SETUP_MONITORING_INTERVAL,
  WebsiteAddress,
  WebsiteMonitorSeeds,
  buildWebsiteMonitor,
  parseWebsiteAddress,
} from "../../../../../Utils/GuidedSetup/WebsiteMonitorRecords";
import AIConversationMessageService from "../../../../Services/AIConversationMessageService";
import AIConversationService from "../../../../Services/AIConversationService";
import AIRunEventService from "../../../../Services/AIRunEventService";
import AIRunService from "../../../../Services/AIRunService";
import AIService, {
  AILogRequest,
  AILogResponse,
} from "../../../../Services/AIService";
import AlertOnCallRuleService from "../../../../Services/AlertOnCallRuleService";
import AlertSeverityService from "../../../../Services/AlertSeverityService";
import IncidentOnCallRuleService from "../../../../Services/IncidentOnCallRuleService";
import IncidentSeverityService from "../../../../Services/IncidentSeverityService";
import MonitorProbeService from "../../../../Services/MonitorProbeService";
import MonitorService from "../../../../Services/MonitorService";
import MonitorStatusService from "../../../../Services/MonitorStatusService";
import OnCallDutyPolicyEscalationRuleService from "../../../../Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleTeamService from "../../../../Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../../Services/OnCallDutyPolicyEscalationRuleUserService";
import PagingLadderService from "../../../../Services/PagingLadderService";
import TeamPermissionService from "../../../../Services/TeamPermissionService";
import OnCallDutyPolicyService from "../../../../Services/OnCallDutyPolicyService";
import OnCallReadinessService, {
  ReadinessMethodType,
  ReadinessStatus,
} from "../../../../Services/OnCallReadinessService";
import PayAsYouGoBillingService from "../../../../Services/PayAsYouGoBillingService";
import DashboardService from "../../../../Services/DashboardService";
import FormService from "../../../../Services/FormService";
import IncomingCallPolicyService from "../../../../Services/IncomingCallPolicyService";
import OnCallDutyPolicyScheduleService from "../../../../Services/OnCallDutyPolicyScheduleService";
import RunbookService from "../../../../Services/RunbookService";
import ServiceLevelObjectiveService from "../../../../Services/ServiceLevelObjectiveService";
import ProbeService from "../../../../Services/ProbeService";
import ProjectMilestoneService from "../../../../Services/ProjectMilestoneService";
import ProjectService from "../../../../Services/ProjectService";
import ServiceService from "../../../../Services/ServiceService";
import StatusPageResourceService from "../../../../Services/StatusPageResourceService";
import StatusPageService from "../../../../Services/StatusPageService";
import TeamMemberService from "../../../../Services/TeamMemberService";
import TeamService from "../../../../Services/TeamService";
import ActiveMonitorLimit from "../../../Billing/ActiveMonitorLimit";
import UserLanguage from "../../../Notification/UserLanguage";
import ServerProducts from "../../../ServerProducts/ServerProducts";
import ServerSendingStatus from "../../../ServerSending/ServerSendingStatus";
import AiContextReader from "../../AiContext/AiContextReader";
import ChatAgentRunner from "../../Chat/ChatAgentRunner";
import ChatInfrastructureAccess from "../../Chat/ChatInfrastructureAccess";
import { ObservabilityTool, ToolContext } from "../../Toolbox/ToolTypes";
import { PinnedModelCall } from "../PinnedModel";
import {
  AskAiEvalMonitor,
  AskAiEvalNamedRecord,
  AskAiEvalPerson,
  AskAiEvalProject,
  AskAiEvalReachMethod,
  AskAiEvalTeam,
} from "./AskAiEvalProject";

/*
 * ONE QUESTION TO ASK AI, WITH A LIVE MODEL, AND WHAT ITS TURN DID (#7246,
 * #7066).
 *
 * The question goes through Ask AI's own chat turn (ChatAgentRunner.runTurn,
 * in Ask to act): its system prompt, the tools it offers, its loop and its
 * limits, and the checks an action passes before its approval card, with
 * the model the eval names (PinnedModel) in place of the project's
 * provider. Nothing reads a database:
 *
 *   - the chat's own records (the conversation, its messages, the run and
 *     its events) are kept here, and read back;
 *   - the setup actions' checks read the evaluation's project
 *     (AskAiEvalProject) through the services they call, answered from it;
 *   - Ask AI's other reads answer from the same project, except the docs':
 *     search_docs, read_docs and find_dashboard_page run for real, over the
 *     docs reader the caller registered (AIDocsLibrary.setReader) and the
 *     Dashboard's page catalogs, and the record a Go to button is for is
 *     read from the project by its ID (#7065);
 *   - a question asked on a page carries that page's context (#7062), as
 *     the Dashboard sends it;
 *   - no action runs: a plan waits on its card, and the turn ends there.
 *
 * What it returns is what the person would see: the plan on the card, as
 * the model asked for each part, what was refused before the card and why,
 * or the answer and its sources.
 */

export interface AskAiEvalCall {
  name: string;
  arguments: JSONObject;
}

export interface AskAiEvalRefusal {
  name: string;
  reason: string;
}

export interface AskAiEvalTurn {
  // Every call the model asked for, reads and actions, in order.
  calls: Array<AskAiEvalCall>;
  /*
   * The actions of the first answer that asked for any, as the model asked
   * for them: the plan of one approval card, with any part refused before
   * it. A later answer may propose again once a part was refused.
   */
  proposed: Array<AskAiEvalCall>;
  // How many separate answers asked for an action: one card is one.
  answersWithActions: number;
  // The parts that reached the card, by name.
  onCard: Array<string>;
  // The parts refused before the card, and why: the model was told.
  refusedBeforeCard: Array<AskAiEvalRefusal>;
  // What the person reads: the answer's text, or the words before a card.
  answer: string;
  citations: Array<AIChatCitation>;
  llmCallCount: number;
  totalTokens: number;
  durationMs: number;
  // Set when the turn failed: the provider refused, a limit stopped it.
  error?: string | undefined;
}

export interface AskAiEvalQuestion {
  question: string;
  project: AskAiEvalProject;
  callModel: PinnedModelCall;
  // The language the person reads the Dashboard in (en, de, fa, ...).
  language: string;
  /*
   * The page Ask AI is open on (#7062), as the Dashboard sends it: one of
   * the project's records, a settings page, a create form. None when it is
   * asked from no page in particular.
   */
  pageContext?: AIChatPageContext | undefined;
}

// The project's statuses and severities: what a new monitor is made with.
const OPERATIONAL_STATUS_ID: string = "e7246000-0000-4000-8000-0000000000f1";
const OFFLINE_STATUS_ID: string = "e7246000-0000-4000-8000-0000000000f2";
const INCIDENT_SEVERITY_ID: string = "e7246000-0000-4000-8000-0000000000f3";
const ALERT_SEVERITY_ID: string = "e7246000-0000-4000-8000-0000000000f4";

const SEEDS: WebsiteMonitorSeeds = {
  operationalStatusId: new ObjectID(OPERATIONAL_STATUS_ID),
  offlineStatusId: new ObjectID(OFFLINE_STATUS_ID),
  incidentSeverityId: new ObjectID(INCIDENT_SEVERITY_ID),
  alertSeverityId: new ObjectID(ALERT_SEVERITY_ID),
};

// The docs' tools run for real; every other read answers from the project.
const DOCS_TOOLS: ReadonlyArray<string> = [
  "search_docs",
  "read_docs",
  "find_dashboard_page",
];

function model<T>(type: { new (): T }, values: Record<string, unknown>): T {
  const record: T = new type();
  Object.assign(record as unknown as Record<string, unknown>, values);
  return record;
}

// The words a query asked for, from any shape a QueryHelper gives them.
function asked(value: unknown): string {
  return JSON.stringify(value ?? "").toLowerCase();
}

function named<T extends AskAiEvalNamedRecord>(
  records: ReadonlyArray<T>,
  query: unknown,
): Array<T> {
  const words: string = asked(query);

  if (words === '""' || words === "{}") {
    return [...records];
  }

  return records.filter((record: T): boolean => {
    return words.includes(record.name.toLowerCase());
  });
}

/*
 * Methods set for one turn and put back after it: each an own property of
 * the service or class, so taking it away leaves the prototype's, as it was.
 */
export class AskAiEvalPatches {
  private restores: Array<() => void> = [];

  public set(target: unknown, key: string, value: unknown): void {
    const holder: Record<string, unknown> = target as Record<string, unknown>;
    const hadOwn: boolean = Object.prototype.hasOwnProperty.call(target, key);
    const original: unknown = holder[key];

    holder[key] = value;
    this.restores.push((): void => {
      if (hadOwn) {
        holder[key] = original;
      } else {
        delete holder[key];
      }
    });
  }

  public restoreAll(): void {
    while (this.restores.length > 0) {
      this.restores.pop()!();
    }
  }
}

// The person asking: the project's owner, signed in, on the project's plan.
export function getAskingProps(
  project: AskAiEvalProject,
): DatabaseCommonInteractionProps {
  const projectId: ObjectID = new ObjectID(project.id);
  const grant: UserPermission = {
    _type: "UserPermission",
    permission: Permission.ProjectOwner,
    labelIds: [],
    isBlockPermission: false,
  };

  return {
    userId: new ObjectID(project.me.id),
    userType: UserType.User,
    tenantId: projectId,
    userTenantAccessPermission: {
      [project.id]: {
        _type: "UserTenantAccessPermission",
        projectId: projectId,
        permissions: [grant],
      },
    },
    currentPlan: project.isFreePlan ? PlanType.Free : PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  } as DatabaseCommonInteractionProps;
}

function monitorOf(monitor: AskAiEvalMonitor): Monitor {
  const address: WebsiteAddress | null = parseWebsiteAddress(monitor.url);
  const built: Monitor = address
    ? buildWebsiteMonitor({
        address: address,
        isApi: monitor.type === "API",
        seeds: SEEDS,
        monitoringInterval: GUIDED_SETUP_MONITORING_INTERVAL,
      })
    : new Monitor();

  built._id = monitor.id;
  built.name = monitor.name;
  built.isArchived = false;
  built.disableActiveMonitoring = false;

  return built;
}

function userOf(person: AskAiEvalPerson): User {
  return model(User, {
    _id: person.id,
    name: person.name,
    email: new Email(person.email),
  });
}

function membersOf(project: AskAiEvalProject): Array<TeamMember> {
  return project.members.map((person: AskAiEvalPerson): TeamMember => {
    const team: AskAiEvalTeam | undefined =
      project.teams.find((candidate: AskAiEvalTeam): boolean => {
        return candidate.memberIds.includes(person.id);
      }) || project.teams[0];

    return model(TeamMember, {
      _id: `${person.id.slice(0, -4)}${team ? team.id.slice(-4) : "0000"}`,
      userId: new ObjectID(person.id),
      teamId: team ? new ObjectID(team.id) : undefined,
      hasAcceptedInvitation: true,
      user: userOf(person),
      team: team ? model(Team, { _id: team.id, name: team.name }) : undefined,
    });
  });
}

/*
 * What a read of the project answers, for a read that is not the docs':
 * the records the requests name, as the model would read them.
 */
export function readProject(
  project: AskAiEvalProject,
  toolName: string,
): string {
  switch (toolName) {
    case "query_monitors":
      return JSON.stringify({
        monitors: project.monitors.map(
          (monitor: AskAiEvalMonitor): JSONObject => {
            return {
              name: monitor.name,
              monitorType: monitor.type,
              url: monitor.url,
              currentStatus: "Operational",
            };
          },
        ),
      });
    case "query_teams":
      return JSON.stringify({
        teams: project.teams.map((team: AskAiEvalTeam): JSONObject => {
          return {
            name: team.name,
            members: project.members
              .filter((person: AskAiEvalPerson): boolean => {
                return team.memberIds.includes(person.id);
              })
              .map((person: AskAiEvalPerson): string => {
                return person.name;
              }),
          };
        }),
        members: project.members.map((person: AskAiEvalPerson): JSONObject => {
          return {
            name: person.name,
            email: person.email,
            ...(person.id === project.me.id ? { isYou: true } : {}),
          };
        }),
      });
    case "query_on_call_policies":
    case "get_on_call_status":
      return project.policies.length === 0
        ? "This project has no on-call policy yet: nobody is paged when a monitor goes down."
        : JSON.stringify({
            onCallPolicies: project.policies.map(
              (policy: AskAiEvalNamedRecord): JSONObject => {
                return {
                  name: policy.name,
                  runsFor: "every new incident and alert",
                  firstLevelPages: [project.me.name],
                };
              },
            ),
          });
    case "query_status_pages":
      return JSON.stringify({
        statusPages: project.statusPages.map(
          (page: AskAiEvalNamedRecord): JSONObject => {
            return { name: page.name, isPublic: true };
          },
        ),
      });
    case "query_telemetry_resources":
      return JSON.stringify({
        services: project.services.map(
          (service: AskAiEvalNamedRecord): JSONObject => {
            return {
              name: service.name,
              sends: ["logs", "metrics", "traces", "exceptions"],
            };
          },
        ),
      });
    case "who_is_told":
      return project.policies.length === 0
        ? "The monitor opens an incident and emails its owner. No on-call policy pages anyone: the project has none."
        : `The monitor opens an incident, and the on-call rules page "${project.policies[0]!.name}" for it: its first level pages ${project.me.name} by email.`;
    default:
      return "Nothing in this project matches.";
  }
}

export default class AskAiEvalTurnRunner {
  public static async ask(data: AskAiEvalQuestion): Promise<AskAiEvalTurn> {
    const startedAtMs: number = Date.now();
    const project: AskAiEvalProject = data.project;
    const projectId: ObjectID = new ObjectID(project.id);
    const conversationId: ObjectID = ObjectID.generate();
    const aiRunId: ObjectID = ObjectID.generate();
    const patches: AskAiEvalPatches = new AskAiEvalPatches();

    const replies: Array<Array<AskAiEvalCall>> = [];
    const refusedBeforeCard: Array<AskAiEvalRefusal> = [];
    const seen: {
      pausedState: AIRunPausedState | null;
      answer: string;
      lastContent: string;
      citations: Array<AIChatCitation>;
      toolActions: Array<AIChatToolAction>;
      llmCallCount: number;
      totalTokens: number;
      error: string | undefined;
    } = {
      pausedState: null,
      answer: "",
      lastContent: "",
      citations: [],
      toolActions: [],
      llmCallCount: 0,
      totalTokens: 0,
      error: undefined,
    };

    const question: AIConversationMessage = model(AIConversationMessage, {
      _id: ObjectID.generate().toString(),
      conversationId: conversationId,
      role: AIChatMessageRole.User,
      contentInMarkdown: data.question,
      status: AIChatMessageStatus.Completed,
      createdAt: new Date(),
      citations: [],
      widgets: [],
      toolActions: [],
    });
    const run: AIRun = model(AIRun, {
      _id: aiRunId.toString(),
      status: AIRunStatus.Running,
    });

    try {
      // The model the eval names, in place of the project's provider.
      patches.set(
        AIService,
        "executeWithLogging",
        async (request: AILogRequest): Promise<AILogResponse> => {
          seen.llmCallCount++;

          const reply: Awaited<ReturnType<PinnedModelCall>> =
            await data.callModel({
              messages: request.messages,
              tools: request.tools,
              maxTokens: request.maxTokens ?? 4096,
              temperature: request.temperature ?? 0,
            });

          seen.totalTokens += reply.tokenCount;
          seen.lastContent = reply.content || seen.lastContent;

          if (reply.toolCalls && reply.toolCalls.length > 0) {
            replies.push(
              reply.toolCalls.map(
                (call: { name: string; arguments: JSONObject }) => {
                  return {
                    name: call.name,
                    arguments: JSON.parse(
                      JSON.stringify(call.arguments || {}),
                    ) as JSONObject,
                  };
                },
              ),
            );
          }

          return {
            content: reply.content,
            toolCalls: reply.toolCalls,
            stopReason: reply.stopReason,
            llmLog: {
              totalTokens: reply.tokenCount,
              costInUSDCents: 0,
              modelName: reply.modelName,
              llmProviderName: reply.providerName,
            },
          } as unknown as AILogResponse;
        },
      );

      this.keepTheChatsRecords({
        patches,
        question,
        run,
        projectId,
        conversationId,
        seen,
        refusedBeforeCard,
        language: data.language,
      });
      this.answerFromProject(patches, project);
      this.answerReadsFromProject(patches, project);

      const props: DatabaseCommonInteractionProps = getAskingProps(project);

      await ChatAgentRunner.runTurn({
        projectId: projectId,
        userId: new ObjectID(project.me.id),
        conversationId: conversationId,
        assistantMessageId: ObjectID.generate(),
        aiRunId: aiRunId,
        permissionMode: AIChatPermissionMode.AskForApproval,
        props: props,
        language: data.language,
        ...(data.pageContext ? { pageContext: data.pageContext } : {}),
      });
    } catch (error) {
      seen.error = error instanceof Error ? error.message : String(error);
    } finally {
      patches.restoreAll();
    }

    const paused: AIRunPausedState | null = seen.pausedState;
    const actions: Array<AIChatToolAction> = paused
      ? paused.toolActions || []
      : seen.toolActions;
    const withActions: Array<Array<AskAiEvalCall>> = replies
      .map((calls: Array<AskAiEvalCall>): Array<AskAiEvalCall> => {
        return calls.filter((call: AskAiEvalCall): boolean => {
          return AIToolbox.isMutationTool(call.name);
        });
      })
      .filter((calls: Array<AskAiEvalCall>): boolean => {
        return calls.length > 0;
      });

    return {
      calls: replies.flat(),
      proposed: withActions[0] || [],
      answersWithActions: withActions.length,
      onCard: actions
        .filter((action: AIChatToolAction): boolean => {
          return action.status === AIChatToolActionStatus.Pending;
        })
        .map((action: AIChatToolAction): string => {
          return action.toolName;
        }),
      refusedBeforeCard,
      answer: paused ? seen.lastContent : seen.answer || seen.lastContent,
      citations: paused ? paused.citations || [] : seen.citations,
      llmCallCount: seen.llmCallCount,
      totalTokens: seen.totalTokens,
      durationMs: Date.now() - startedAtMs,
      ...(seen.error ? { error: seen.error } : {}),
    };
  }

  // The conversation, its messages, the run and its events, kept here.
  private static keepTheChatsRecords(data: {
    patches: AskAiEvalPatches;
    question: AIConversationMessage;
    run: AIRun;
    projectId: ObjectID;
    conversationId: ObjectID;
    seen: {
      pausedState: AIRunPausedState | null;
      answer: string;
      citations: Array<AIChatCitation>;
      toolActions: Array<AIChatToolAction>;
      error: string | undefined;
    };
    refusedBeforeCard: Array<AskAiEvalRefusal>;
    language: string;
  }): void {
    const { patches, seen } = data;

    patches.set(
      AIRunEventService,
      "create",
      async (args: { data: AIRunEvent }): Promise<AIRunEvent> => {
        const event: AIRunEvent = args.data;
        const summary: JSONObject = (event.resultSummary || {}) as JSONObject;

        if (
          event.eventType === AIRunEventType.ToolCallFailed &&
          summary["isAction"] === true &&
          event.toolName
        ) {
          data.refusedBeforeCard.push({
            name: event.toolName,
            reason: String(summary["errorMessage"] || ""),
          });
        }

        return event;
      },
    );
    patches.set(AIRunService, "findOneById", async (): Promise<AIRun> => {
      return data.run;
    });
    patches.set(AIRunService, "updateOneById", async (): Promise<number> => {
      return 1;
    });
    patches.set(
      AIRunService,
      "updateOneBy",
      async (args: { data: JSONObject }): Promise<number> => {
        if (args.data["pausedState"]) {
          seen.pausedState = args.data[
            "pausedState"
          ] as unknown as AIRunPausedState;
        }

        if (args.data["status"]) {
          data.run.status = args.data["status"] as AIRunStatus;
        }

        return 1;
      },
    );
    patches.set(
      AIConversationMessageService,
      "findBy",
      async (): Promise<Array<AIConversationMessage>> => {
        return [data.question];
      },
    );
    patches.set(
      AIConversationMessageService,
      "countBy",
      async (): Promise<PositiveNumber> => {
        return new PositiveNumber(1);
      },
    );
    patches.set(
      AIConversationMessageService,
      "findOneBy",
      async (): Promise<null> => {
        return null;
      },
    );
    patches.set(
      AIConversationMessageService,
      "updateOneBy",
      async (args: { data: JSONObject }): Promise<number> => {
        const saved: JSONObject = args.data;

        if (typeof saved["contentInMarkdown"] === "string") {
          seen.answer = saved["contentInMarkdown"] as string;
        }

        if (Array.isArray(saved["citations"])) {
          seen.citations = saved[
            "citations"
          ] as unknown as Array<AIChatCitation>;
        }

        if (Array.isArray(saved["toolActions"])) {
          seen.toolActions = saved[
            "toolActions"
          ] as unknown as Array<AIChatToolAction>;
        }

        if (saved["status"] === AIChatMessageStatus.Error) {
          seen.error = String(saved["errorMessage"] || "The turn failed.");
        }

        return 1;
      },
    );
    patches.set(
      AIConversationService,
      "findOneById",
      async (): Promise<AIConversation> => {
        return model(AIConversation, {
          _id: data.conversationId.toString(),
          projectId: data.projectId,
        });
      },
    );
    patches.set(
      AIConversationService,
      "updateOneById",
      async (): Promise<number> => {
        return 1;
      },
    );
    patches.set(AiContextReader, "read", async (): Promise<null> => {
      return null;
    });
    patches.set(
      ChatInfrastructureAccess,
      "buildForPage",
      async (): Promise<null> => {
        return null;
      },
    );
    patches.set(UserLanguage, "getLanguage", async (): Promise<string> => {
      return data.language;
    });
    // No admin switched a product off: every product is on, as it starts.
    patches.set(ServerProducts, "getSavedSettings", async (): Promise<null> => {
      return null;
    });
  }

  // Ask AI's reads, from the project; the docs' run for real.
  private static answerReadsFromProject(
    patches: AskAiEvalPatches,
    project: AskAiEvalProject,
  ): void {
    const executeTool: typeof AIToolbox.executeTool =
      AIToolbox.executeTool.bind(AIToolbox);

    patches.set(
      AIToolbox,
      "executeTool",
      async (call: {
        name: string;
        args: JSONObject;
        ctx: ToolContext;
      }): Promise<ToolCallOutcome> => {
        const tool: ObservabilityTool | undefined = AIToolbox.getToolByName(
          call.name,
        );

        if (!tool || tool.isMutation || DOCS_TOOLS.includes(call.name)) {
          return await executeTool(call);
        }

        const text: string = readProject(project, call.name);

        return {
          success: true,
          textForLlm: text,
          result: {
            dataForLlm: text,
            rowCount: 1,
            citationLabel: tool.name,
            redactionCount: 0,
            isTruncated: false,
          },
        };
      },
    );
  }

  /*
   * What the setup actions' checks read before a card, from the project:
   * its statuses and severities, its probes and plan, its monitors and
   * status pages, its people, teams and on-call policies, its services.
   */
  private static answerFromProject(
    patches: AskAiEvalPatches,
    project: AskAiEvalProject,
  ): void {
    const monitors: Array<Monitor> = project.monitors.map(monitorOf);
    const members: Array<TeamMember> = membersOf(project);
    const resolve: <T>(value: T) => () => Promise<T> = <T>(
      value: T,
    ): (() => Promise<T>) => {
      return async (): Promise<T> => {
        return value;
      };
    };

    patches.set(
      MonitorStatusService,
      "findBy",
      resolve([
        model(MonitorStatus, {
          _id: OPERATIONAL_STATUS_ID,
          name: "Operational",
          isOperationalState: true,
        }),
        model(MonitorStatus, {
          _id: OFFLINE_STATUS_ID,
          name: "Offline",
          isOfflineState: true,
        }),
      ]),
    );

    const incidentSeverity: IncidentSeverity = model(IncidentSeverity, {
      _id: INCIDENT_SEVERITY_ID,
      name: "Critical Incident",
    });

    patches.set(IncidentSeverityService, "findBy", resolve([incidentSeverity]));
    patches.set(
      IncidentSeverityService,
      "findOneById",
      resolve(incidentSeverity),
    );
    patches.set(
      AlertSeverityService,
      "findBy",
      resolve([model(AlertSeverity, { _id: ALERT_SEVERITY_ID, name: "High" })]),
    );
    patches.set(
      ProjectService,
      "findOneById",
      resolve(
        model(Project, {
          _id: project.id,
          name: project.name,
          enableAi: true,
          doNotAddGlobalProbesByDefaultOnNewMonitors: false,
        }),
      ),
    );
    patches.set(
      ProbeService,
      "countBy",
      async (args: { query: JSONObject }): Promise<PositiveNumber> => {
        return new PositiveNumber(args.query["isGlobalProbe"] ? 2 : 0);
      },
    );
    patches.set(MonitorProbeService, "countBy", resolve(new PositiveNumber(2)));
    patches.set(PayAsYouGoBillingService, "canUsePayAsYouGo", resolve(true));
    patches.set(ActiveMonitorLimit, "getRefusal", resolve(null));
    patches.set(MonitorService, "findBy", resolve(monitors));
    patches.set(
      MonitorService,
      "findOneBy",
      async (args: { query: JSONObject }): Promise<Monitor | null> => {
        const words: string = asked(args.query);
        return (
          monitors.find((monitor: Monitor): boolean => {
            return (
              words.includes(String(monitor.name).toLowerCase()) ||
              words.includes(String(monitor._id).toLowerCase())
            );
          }) || null
        );
      },
    );

    // Paging: the project's policies, run for every new incident and alert.
    const policies: Array<OnCallDutyPolicy> = project.policies.map(
      (policy: AskAiEvalNamedRecord): OnCallDutyPolicy => {
        return model(OnCallDutyPolicy, { _id: policy.id, name: policy.name });
      },
    );
    const firstLevels: Array<OnCallDutyPolicyEscalationRule> =
      project.policies.map(
        (policy: AskAiEvalNamedRecord): OnCallDutyPolicyEscalationRule => {
          return model(OnCallDutyPolicyEscalationRule, {
            _id: `${policy.id.slice(0, -2)}e2`,
            onCallDutyPolicyId: new ObjectID(policy.id),
            name: "Level 1",
            order: 1,
            escalateAfterInMinutes: 30,
          });
        },
      );

    patches.set(
      OnCallDutyPolicyService,
      "countBy",
      resolve(new PositiveNumber(policies.length)),
    );
    patches.set(OnCallDutyPolicyService, "findBy", resolve(policies));
    patches.set(
      OnCallDutyPolicyService,
      "findOneBy",
      resolve(policies[0] || null),
    );
    patches.set(
      OnCallDutyPolicyEscalationRuleService,
      "findBy",
      resolve(firstLevels),
    );
    patches.set(
      OnCallDutyPolicyEscalationRuleService,
      "findOneBy",
      resolve(firstLevels[0] || null),
    );
    patches.set(
      OnCallDutyPolicyEscalationRuleService,
      "getLevelsRefusal",
      resolve(null),
    );
    patches.set(
      IncidentOnCallRuleService,
      "findBy",
      resolve(
        policies.length > 0
          ? [model(IncidentOnCallRule, { _id: `${project.id.slice(0, -2)}f5` })]
          : [],
      ),
    );
    patches.set(
      AlertOnCallRuleService,
      "findBy",
      resolve(
        policies.length > 0
          ? [model(AlertOnCallRule, { _id: `${project.id.slice(0, -2)}f6` })]
          : [],
      ),
    );

    const byMethod: Record<AskAiEvalReachMethod, ReadinessMethodType> = {
      email: ReadinessMethodType.Email,
      sms: ReadinessMethodType.SMS,
      call: ReadinessMethodType.Call,
      push: ReadinessMethodType.Push,
    };

    patches.set(
      OnCallReadinessService,
      "getReadinessForUser",
      resolve({
        status: ReadinessStatus.PartiallyReady,
        methods: project.verifiedMethods.map((method: AskAiEvalReachMethod) => {
          return {
            methodId: new ObjectID(
              `${project.me.id.slice(0, -2)}${method.length}0`,
            ),
            methodType: byMethod[method],
            maskedIdentifier: "•••",
            isVerified: true,
          };
        }),
      }),
    );

    // Who the first level pages: the person asking.
    patches.set(
      OnCallDutyPolicyEscalationRuleUserService,
      "findBy",
      resolve(
        firstLevels.map(
          (
            level: OnCallDutyPolicyEscalationRule,
          ): OnCallDutyPolicyEscalationRuleUser => {
            return model(OnCallDutyPolicyEscalationRuleUser, {
              _id: `${String(level._id).slice(0, -2)}e3`,
              onCallDutyPolicyEscalationRuleId: new ObjectID(String(level._id)),
              userId: new ObjectID(project.me.id),
              user: userOf(project.me),
            });
          },
        ),
      ),
    );
    patches.set(
      OnCallDutyPolicyEscalationRuleTeamService,
      "findBy",
      resolve([]),
    );

    // Their own way to be reached: their email, and no rules of their own yet.
    patches.set(
      PagingLadderService,
      "getUsableMethods",
      resolve(
        project.verifiedMethods.includes("email")
          ? [
              {
                methodColumn: "userEmailId",
                methodId: `${project.me.id.slice(0, -2)}e4`,
              },
            ]
          : [],
      ),
    );
    patches.set(PagingLadderService, "getRules", resolve([]));

    // People and teams, by the names and addresses the requests use.
    patches.set(TeamMemberService, "findBy", resolve(members));
    patches.set(TeamMemberService, "getInvitationRefusal", resolve(null));
    patches.set(
      TeamPermissionService,
      "findTeamsCallerCannotGrant",
      resolve([]),
    );
    patches.set(
      TeamPermissionService,
      "findBy",
      resolve(
        project.teams.map((team: AskAiEvalTeam): TeamPermission => {
          return model(TeamPermission, {
            _id: `${team.id.slice(0, -2)}e5`,
            teamId: new ObjectID(team.id),
            permission: Permission.ProjectMember,
            isBlockPermission: false,
          });
        }),
      ),
    );
    patches.set(ServerSendingStatus, "canSendEmailPublicly", resolve(true));
    patches.set(
      TeamService,
      "findBy",
      async (args: { query: JSONObject }): Promise<Array<Team>> => {
        return named(project.teams, args.query["name"]).map(
          (team: AskAiEvalTeam): Team => {
            return model(Team, { _id: team.id, name: team.name });
          },
        );
      },
    );

    // Status pages, and what is on them (nothing yet).
    patches.set(
      StatusPageService,
      "findOneBy",
      async (args: { query: JSONObject }): Promise<StatusPage | null> => {
        const page: AskAiEvalNamedRecord | undefined = named(
          project.statusPages,
          args.query["name"] ?? args.query["_id"],
        )[0];

        return page
          ? model(StatusPage, { _id: page.id, name: page.name })
          : null;
      },
    );
    patches.set(
      StatusPageService,
      "getCreateRefusal",
      resolve(
        project.isFreePlan && project.statusPages.length > 0
          ? "Your plan includes 1 status page, and this project has it. Upgrade to the Growth plan to publish more."
          : null,
      ),
    );
    patches.set(
      StatusPageService,
      "getStatusPageURL",
      resolve("https://status.acme.example"),
    );
    patches.set(StatusPageResourceService, "findBy", resolve([]));

    /*
     * One record by its ID: how find_dashboard_page reads the record a Go
     * to button is for (#7065). The project's own, and null for any other,
     * as a record the person may not read answers.
     */
    const isId: (id: unknown, recordId: unknown) => boolean = (
      id: unknown,
      recordId: unknown,
    ): boolean => {
      return String(id).toLowerCase() === String(recordId).toLowerCase();
    };

    patches.set(
      StatusPageService,
      "findOneById",
      async (args: { id: ObjectID }): Promise<StatusPage | null> => {
        const page: AskAiEvalNamedRecord | undefined = project.statusPages.find(
          (candidate: AskAiEvalNamedRecord): boolean => {
            return isId(args.id, candidate.id);
          },
        );

        return page
          ? model(StatusPage, { _id: page.id, name: page.name })
          : null;
      },
    );
    patches.set(
      MonitorService,
      "findOneById",
      async (args: { id: ObjectID }): Promise<Monitor | null> => {
        return (
          monitors.find((monitor: Monitor): boolean => {
            return isId(args.id, monitor._id);
          }) || null
        );
      },
    );
    patches.set(
      OnCallDutyPolicyService,
      "findOneById",
      async (args: { id: ObjectID }): Promise<OnCallDutyPolicy | null> => {
        return (
          policies.find((policy: OnCallDutyPolicy): boolean => {
            return isId(args.id, policy._id);
          }) || null
        );
      },
    );
    patches.set(
      ServiceService,
      "findOneById",
      async (args: { id: ObjectID }): Promise<Service | null> => {
        const service: AskAiEvalNamedRecord | undefined = project.services.find(
          (candidate: AskAiEvalNamedRecord): boolean => {
            return isId(args.id, candidate.id);
          },
        );

        return service
          ? model(Service, { _id: service.id, name: service.name })
          : null;
      },
    );

    /*
     * The records a question is asked on since #10104 - a schedule, a call
     * policy, a team, a dashboard, a runbook, an SLO, a form - each read by
     * its ID as the Go to button reads it (DashboardRecordReaders).
     */
    const namedRecordReads: Array<{
      service: unknown;
      modelType: { new (): unknown };
      records: ReadonlyArray<AskAiEvalNamedRecord>;
    }> = [
      {
        service: OnCallDutyPolicyScheduleService,
        modelType: OnCallDutyPolicySchedule,
        records: project.onCallSchedules,
      },
      {
        service: IncomingCallPolicyService,
        modelType: IncomingCallPolicy,
        records: project.incomingCallPolicies,
      },
      {
        service: TeamService,
        modelType: Team,
        records: project.teams,
      },
      {
        service: DashboardService,
        modelType: Dashboard,
        records: project.dashboards,
      },
      {
        service: RunbookService,
        modelType: Runbook,
        records: project.runbooks,
      },
      {
        service: ServiceLevelObjectiveService,
        modelType: ServiceLevelObjective,
        records: project.slos,
      },
      {
        service: FormService,
        modelType: Form,
        records: project.forms,
      },
    ];

    for (const read of namedRecordReads) {
      patches.set(
        read.service,
        "findOneById",
        async (args: { id: ObjectID }): Promise<unknown> => {
          const record: AskAiEvalNamedRecord | undefined = read.records.find(
            (candidate: AskAiEvalNamedRecord): boolean => {
              return isId(args.id, candidate.id);
            },
          );

          return record
            ? model(read.modelType, { _id: record.id, name: record.name })
            : null;
        },
      );
    }

    // Services, each sending every kind of telemetry.
    patches.set(
      ServiceService,
      "findOneBy",
      async (args: { query: JSONObject }): Promise<Service | null> => {
        const service: AskAiEvalNamedRecord | undefined = named(
          project.services,
          args.query["name"],
        )[0];

        return service
          ? model(Service, {
              _id: service.id,
              name: service.name,
              lastSeenAt: new Date(),
            })
          : null;
      },
    );
    patches.set(
      ProjectMilestoneService,
      "findBy",
      resolve(
        TELEMETRY_RECOMMENDATION_MILESTONES.map(
          (milestone: string, index: number): ProjectMilestone => {
            return model(ProjectMilestone, {
              _id: `${project.id.slice(0, -2)}${String(10 + index)}`,
              milestone: milestone,
            });
          },
        ),
      ),
    );
  }
}
