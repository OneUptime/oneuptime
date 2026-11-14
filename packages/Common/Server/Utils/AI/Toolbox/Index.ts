import { JSONObject } from "../../../../Types/JSON";
import ServerProducts from "../../ServerProducts/ServerProducts";
import { getToolProducts } from "./ToolProducts";
import ProductKey from "../../../../Types/Product/ProductKey";
import {
  ServerProductOffReason,
  getProductOffMessage,
} from "../../../../Types/Product/ServerProducts";
import Permission, { PermissionHelper } from "../../../../Types/Permission";
import ConflictException from "../../../../Types/Exception/ConflictException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import HeldPermissionsUtil, {
  HeldPermissions,
} from "../../../../Types/HeldPermissions";
import CallerPermission from "../../Permission/CallerPermission";
import { LLMToolDefinition } from "../../LLM/LLMService";
import logger from "../../Logger";
import {
  ObservabilityTool,
  SetupActionRefusal,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";
import { QueryIncidentsTool, SearchIncidentsTool } from "./IncidentTools";
import { QueryAlertsTool } from "./AlertTools";
import { QueryMonitorsTool } from "./MonitorTools";
import { QueryRumApplicationsTool, QueryRumWebVitalsTool } from "./RumTools";
import {
  QueryTelemetryResourcesTool,
  QueryResourceTelemetryTool,
} from "./ResourceTools";
import { QueryContainersTool } from "./ContainerTools";
import { QueryNetworkTransceiversTool } from "./TransceiverTools";
import { QueryCloudAccountsTool, QueryCloudResourceTool } from "./CloudTools";
import { QueryScheduledMaintenanceTool } from "./ScheduledMaintenanceTools";
import {
  GetOnCallStatusTool,
  QueryOnCallPagesTool,
  QueryOnCallPoliciesTool,
} from "./OnCallTools";
import {
  QueryStatusPageAnnouncementsTool,
  QueryStatusPagesTool,
} from "./StatusPageTools";
import { QuerySlosTool } from "./SloTools";
import { QueryRunbooksTool } from "./RunbookTools";
import { GetAlertTimelineTool, GetIncidentTimelineTool } from "./TimelineTools";
import {
  GetAIInvestigationTool,
  QueryAIInsightsTool,
  StartInvestigationTool,
} from "./AIMetaTools";
import { QueryProbesTool, QueryWorkflowsTool } from "./WorkflowProbeTools";
import {
  CheckWorkflowDraftTool,
  CreateWorkflowTool,
  FindWorkflowComponentsTool,
  UpdateWorkflowTool,
} from "./WorkflowBuilderTools";
import { QueryTeamsTool } from "./TeamTools";
import { GetSetupHealthTool } from "./SetupHealthTools";
import { CreateAlertNoteTool, CreateIncidentNoteTool } from "./NoteWriteTools";
import { TopExceptionsTool } from "./ExceptionTools";
import { LogHistogramTool, SearchLogsTool } from "./LogTools";
import {
  SearchSecurityEventsTool,
  SecurityEventSummaryTool,
} from "./SecurityEventTools";
import {
  AddSecurityCaseNoteTool,
  LookupThreatIntelTool,
  QuerySecurityCasesTool,
  QuerySecurityPlaybooksTool,
  RunSecurityPlaybookTool,
  SecurityEntityActivityTool,
} from "./SecurityCaseTools";
import { RecentChangesTool } from "./RecentChangesTools";
import {
  QueryDataSecurityIssuesTool,
  QueryDataStoreAccessTool,
  QueryDataStoresTool,
} from "./DataSecurityTools";
import {
  GetDataTableFreshnessTool,
  GetDataTableLineageTool,
} from "./DataObservabilityTools";
import { GetChangeDetailsTool } from "./ChangeTools";
import { BaselineAnomalyTool, QueryMetricsTool } from "./MetricTools";
import { GetTraceTool, QueryTracesTool } from "./TraceTools";
import {
  CompareProfilesTool,
  GetProfileFunctionTool,
  GetProfileHotspotsTool,
} from "./ProfileTools";
import { LookupContextTool } from "./ContextTools";
import {
  FindDashboardPageTool,
  ReadDocsTool,
  SearchDocsTool,
} from "./DocsTools";
import {
  FindCodeForExceptionTool,
  ListCodeRepositoriesTool,
  ReadCodeFileTool,
  SearchCodeTool,
} from "./CodeTools";
import {
  CommitCodeToBranchTool,
  OpenCodePullRequestTool,
} from "./CodeWriteTools";
import {
  AcknowledgeIncidentTool,
  AddIncidentAffectedResourcesTool,
  CreateIncidentTool,
  ResolveIncidentTool,
} from "./IncidentWriteTools";
import {
  AcknowledgeAlertTool,
  AddAlertAffectedResourcesTool,
  CreateAlertTool,
  ResolveAlertTool,
} from "./AlertWriteTools";
import {
  PageOnCallPolicyTool,
  RunRunbookTool,
  PostIncidentStatusUpdateTool,
  ChangeIncidentSeverityTool,
} from "./AIActionTools";
import {
  AddMonitorsToStatusPageTool,
  PublishStatusPageTool,
  SetUpPagingTool,
  SetUpWebsiteMonitoringTool,
} from "./SetupTools";
import { WhoIsToldTool } from "./WhoIsToldTools";
import AIChatPermissionMode from "../../../../Types/AI/AIChatPermissionMode";
import { AIToolRefusal } from "../../../../Types/AI/AIChatTypes";

export interface ToolCallOutcome {
  success: boolean;
  /*
   * What goes back to the LLM: serialized data, or an error envelope the
   * model can self-correct from.
   */
  textForLlm: string;
  result?: ToolExecutionResult | undefined;
  errorMessage?: string | undefined;
  /*
   * Why the call was refused, when it was: the person may not make it, a
   * team blocks it, the plan does not include it, or it is not theirs to
   * make here. A refused call is never tried again; the run's activity says
   * it was not done, and why.
   */
  refusal?: AIToolRefusal | undefined;
}

const TOOL_EXECUTION_TIMEOUT_MS: number = 45 * 1000;

/*
 * The curated tool belt for AI features (chat today, the Investigation Engine
 * later). Read tools wrap an existing deterministic query; write tools mutate
 * the project (create/acknowledge/resolve). Every tool executes under the
 * requesting user's permission props. A write tool makes the change the
 * dashboard makes for the same action, with those props, and runs only for a
 * signed-in person (executeTool; ToolboxWritesAsThePersonGuard holds every
 * write to it); write tools are additionally gated by the conversation's
 * permission mode (see ChatAgentRunner).
 */
export default class AIToolbox {
  private static readonly tools: Array<ObservabilityTool> = [
    LookupContextTool,
    QueryIncidentsTool,
    SearchIncidentsTool,
    GetIncidentTimelineTool,
    GetAlertTimelineTool,
    QueryAlertsTool,
    QueryMonitorsTool,
    QueryRumApplicationsTool,
    QueryRumWebVitalsTool,
    QueryTelemetryResourcesTool,
    QueryResourceTelemetryTool,
    // A container host's containers: the busiest, and the ones that stopped.
    QueryContainersTool,
    // A network device's optics, port by port, with their trend.
    QueryNetworkTransceiversTool,
    // What a connected cloud's inventory says: one resource, every account.
    QueryCloudResourceTool,
    QueryCloudAccountsTool,
    QueryScheduledMaintenanceTool,
    /*
     * Platform reads: the operational surface an on-call product exists to
     * answer questions about — who is on call, what does the runbook say,
     * what do customers see, is the error budget burning.
     */
    QueryOnCallPoliciesTool,
    GetOnCallStatusTool,
    QueryOnCallPagesTool,
    QueryStatusPagesTool,
    QueryStatusPageAnnouncementsTool,
    QuerySlosTool,
    QueryRunbooksTool,
    QueryWorkflowsTool,
    // What a workflow can be made of, and whether a draft of one holds together.
    FindWorkflowComponentsTool,
    CheckWorkflowDraftTool,
    QueryProbesTool,
    QueryTeamsTool,
    /*
     * Who is told when a monitor goes down, and where that breaks (#6810's
     * resolver): how Ask AI answers it once a monitor is set up (#6829).
     */
    WhoIsToldTool,
    /*
     * "Is my setup OK?" (#6812): what would stop the right people from
     * being told, each with its fix - the Setup health list, as the
     * person may see it (SetupHealthTools).
     */
    GetSetupHealthTool,
    /*
     * OneUptime itself (#6828): "how do I...?" answered from the docs this
     * installation serves, ending at the page of the project where it is
     * done (DocsTools).
     */
    SearchDocsTool,
    ReadDocsTool,
    FindDashboardPageTool,
    /*
     * The AI's own prior work: autonomous investigation results and insight
     * findings. Chat reads these first instead of re-deriving a root cause
     * the platform already posted.
     */
    GetAIInvestigationTool,
    QueryAIInsightsTool,
    /*
     * Data Security: which stores hold what sensitive data and how exposed
     * they are, what to fix first, and who can reach what - never a
     * finding's samples (DataSecurityTools).
     */
    QueryDataStoresTool,
    QueryDataSecurityIssuesTool,
    QueryDataStoreAccessTool,
    /*
     * Data Observability: whether a watched table is fresh, its open alerts
     * and its writers' latest runs, and what it is built from and what is
     * built from it - also how Slack and Microsoft Teams answer "is the
     * orders table fresh?" and "what feeds it?" (DataObservabilityTools).
     */
    GetDataTableFreshnessTool,
    GetDataTableLineageTool,
    TopExceptionsTool,
    SearchLogsTool,
    SearchSecurityEventsTool,
    SecurityEventSummaryTool,
    /*
     * Security cases and what a case is judged by: the project's threat
     * intel, how unusual an entity's activity is, and the playbooks a case
     * can be handed to (SecurityCaseTools).
     */
    QuerySecurityCasesTool,
    LookupThreatIntelTool,
    SecurityEntityActivityTool,
    QuerySecurityPlaybooksTool,
    LogHistogramTool,
    QueryMetricsTool,
    BaselineAnomalyTool,
    QueryTracesTool,
    GetTraceTool,
    /*
     * Continuous profiling: where a service spends its CPU time and memory,
     * what got slower around a deploy, and one function's callers and
     * callees.
     */
    GetProfileHotspotsTool,
    CompareProfilesTool,
    GetProfileFunctionTool,
    RecentChangesTool,
    GetChangeDetailsTool,
    /*
     * Source code (read-only). Closes the loop from a telemetry signal to the
     * code that produced it — see CodeTools for the narrower trust posture.
     */
    ListCodeRepositoriesTool,
    FindCodeForExceptionTool,
    SearchCodeTool,
    ReadCodeFileTool,
    // Write tools (mutations). Gated by conversation permission mode.
    CreateIncidentTool,
    AcknowledgeIncidentTool,
    ResolveIncidentTool,
    // An alert raised from the conversation, as an incident is declared (#5301).
    CreateAlertTool,
    AcknowledgeAlertTool,
    ResolveAlertTool,
    /*
     * What an incident or alert is about (#5293): the infrastructure and
     * services OneUptime AI investigates and fixes, added as its Affected
     * Resources Edit adds them.
     */
    AddIncidentAffectedResourcesTool,
    AddAlertAffectedResourcesTool,
    // AI action belt (Phase 0) — operate the platform, not just answer.
    PageOnCallPolicyTool,
    RunRunbookTool,
    PostIncidentStatusUpdateTool,
    ChangeIncidentSeverityTool,
    // Private notes (never notify status-page subscribers) + investigations.
    CreateIncidentNoteTool,
    CreateAlertNoteTool,
    StartInvestigationTool,
    /*
     * Security case writes: a note on a case, and a playbook started on
     * one, as the person - whose containment steps still wait for their own
     * approval in the playbook engine.
     */
    AddSecurityCaseNoteTool,
    RunSecurityPlaybookTool,
    /*
     * Code writes (mutations). These never touch the default or a protected
     * branch — every chat-authored commit lands somewhere a human must still
     * merge from. See CodeWriteTools for why that invariant is load-bearing.
     */
    OpenCodePullRequestTool,
    CommitCodeToBranchTool,
    /*
     * Workflows described in the conversation, built and changed as the
     * person (#5945). One starts turned off, and nothing here turns it on.
     */
    CreateWorkflowTool,
    UpdateWorkflowTool,
    /*
     * Setting things up by conversation (#6829): a website monitor, who is
     * paged, a status page and the monitors on it - the guided setups'
     * records, as the person, each part of a plan approved on one card in
     * every mode (SetupTools).
     */
    SetUpPagingTool,
    SetUpWebsiteMonitoringTool,
    PublishStatusPageTool,
    AddMonitorsToStatusPageTool,
  ];

  public static getTools(): Array<ObservabilityTool> {
    return this.tools;
  }

  /*
   * Whether a tool is one of Ask AI's setup actions (#6829): it asks for
   * approval in every permission mode, Auto-run included, and is checked
   * before its card is shown (checkBeforeApproval).
   */
  public static isSetupAction(name: string): boolean {
    return Boolean(this.getToolByName(name)?.setupAction);
  }

  /*
   * Where a setup action runs in its plan once approved (setupAction.
   * planOrder); every other tool keeps its place, after them.
   */
  public static getSetupPlanOrder(name: string): number {
    return (
      this.getToolByName(name)?.setupAction?.planOrder ??
      Number.MAX_SAFE_INTEGER
    );
  }

  /*
   * WHY A SETUP ACTION IS NOT PROPOSED AT ALL, before its card is shown
   * (#6829): the gates a run checks - the request is for this project, there
   * is a signed-in person to act as, and they hold the permissions - and
   * then the tool's own check of what is missing (an address, monitors,
   * paging the project has already). A refused setup is never shown to be
   * approved and then refused: the model is told what is needed, and says
   * it. Null when nothing stops it, and for any other tool.
   */
  public static async checkBeforeApproval(data: {
    name: string;
    args: JSONObject;
    ctx: ToolContext;
  }): Promise<ToolCallOutcome | null> {
    const tool: ObservabilityTool | undefined = this.getToolByName(data.name);

    if (!tool?.setupAction) {
      return null;
    }

    // The same refusal running it would give, without running it.
    const refusedByGates: ToolCallOutcome | null = this.refuseByGates(
      tool,
      data,
    );

    if (refusedByGates) {
      return refusedByGates;
    }

    // A product switched off on the server: no card for it (#6815).
    const refusedAsOff: ToolCallOutcome | null =
      await this.refuseProductsOffOnServer(tool);

    if (refusedAsOff) {
      return refusedAsOff;
    }

    if (!tool.checkBeforeApproval) {
      return null;
    }

    let refused: SetupActionRefusal | null = null;

    try {
      refused = await tool.checkBeforeApproval(data.args, data.ctx);
    } catch (error) {
      // A check that fails lets the card show: running it says what went wrong.
      logger.debug(
        `AI toolbox could not check ${data.name} before its approval: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }

    if (!refused) {
      return null;
    }

    return {
      success: false,
      textForLlm: refused.toldModel,
      errorMessage: refused.toldModel,
      ...(refused.refusal ? { refusal: refused.refusal } : {}),
    };
  }

  /*
   * LLM tool definitions cached per permission mode (ReadOnly hides
   * mutations). Frozen: every run of the process shares them.
   */
  private static llmToolDefinitionsByMode: Map<
    AIChatPermissionMode,
    ReadonlyArray<LLMToolDefinition>
  > = new Map();

  public static getToolByName(name: string): ObservabilityTool | undefined {
    return this.tools.find((tool: ObservabilityTool) => {
      return tool.name === name;
    });
  }

  public static isMutationTool(name: string): boolean {
    const tool: ObservabilityTool | undefined = this.getToolByName(name);
    return Boolean(tool?.isMutation);
  }

  /*
   * The tool definitions offered to the model for a given permission mode. In
   * ReadOnly mode the mutating tools are withheld entirely, so the model never
   * even proposes an action it isn't allowed to take.
   *
   * The list is the process-wide cache itself, so it is read-only and frozen:
   * a run that offers tools of its own copies it first. The chat runner used
   * to push a turn's command tools onto it, and every later turn of every
   * project then saw that turn's run_kubectl and run_infrastructure_command,
   * described with that turn's clusters and resources.
   */
  public static getLlmToolDefinitions(
    mode: AIChatPermissionMode,
  ): ReadonlyArray<LLMToolDefinition> {
    const cached: ReadonlyArray<LLMToolDefinition> | undefined =
      this.llmToolDefinitionsByMode.get(mode);
    if (cached) {
      return cached;
    }

    const includeMutations: boolean = mode !== AIChatPermissionMode.ReadOnly;

    const definitions: ReadonlyArray<LLMToolDefinition> = Object.freeze(
      this.tools
        .filter((tool: ObservabilityTool) => {
          return includeMutations || !tool.isMutation;
        })
        .map((tool: ObservabilityTool) => {
          return {
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          };
        }),
    );

    this.llmToolDefinitionsByMode.set(mode, definitions);
    return definitions;
  }

  /*
   * The grants hasPermissionForTool consults are the caller's grants in
   * props.tenantId, while every tool scopes its query by ctx.projectId — and
   * for the raw-SQL aggregation tools that projectId is the ONLY scope. So
   * for a non-root caller the two must name the same single project, or one
   * project's grants would authorize a query against another. A multi-tenant
   * request is refused for the same reason: its tenant permissions span every
   * project the user belongs to rather than the one the tool will query.
   */
  public static isContextScopedToOneProject(ctx: ToolContext): boolean {
    if (ctx.props.isRoot || ctx.props.isMasterAdmin) {
      return true;
    }

    if (ctx.props.isMultiTenantRequest) {
      return false;
    }

    if (!ctx.props.tenantId || !ctx.projectId) {
      return false;
    }

    return ctx.props.tenantId.toString() === ctx.projectId.toString();
  }

  public static hasPermissionForTool(
    tool: ObservabilityTool,
    ctx: ToolContext,
    args?: JSONObject,
  ): boolean {
    if (ctx.props.isRoot || ctx.props.isMasterAdmin) {
      return true;
    }

    if (!this.isContextScopedToOneProject(ctx)) {
      return false;
    }

    /*
     * Held the way every permission check reads it (CallerPermission), and
     * failing closed on blocks: if any of the tool's permissions is
     * block-listed for this user, labelled or not, deny the tool outright.
     * This is coarser than the label-scoped block filtering the model layer
     * applies, but the raw-SQL aggregation tools have no model layer — this
     * gate is their only authorization.
     */
    const held: HeldPermissions = CallerPermission.getHeld(ctx.props);

    const groups: Array<Array<Permission>> =
      args !== undefined && tool.getRequiredPermissionGroups
        ? tool.getRequiredPermissionGroups(args)
        : [tool.requiredPermissions];
    return (
      groups.length > 0 &&
      groups.every((group: Array<Permission>): boolean => {
        return HeldPermissionsUtil.holdsAnyOf(held, group, {
          labelledBlocksRefuse: true,
        });
      })
    );
  }

  public static async executeTool(data: {
    name: string;
    args: JSONObject;
    ctx: ToolContext;
  }): Promise<ToolCallOutcome> {
    const tool: ObservabilityTool | undefined = this.getToolByName(data.name);

    if (!tool) {
      return {
        success: false,
        textForLlm: `Error: unknown tool "${data.name}". Available tools: ${this.tools
          .map((availableTool: ObservabilityTool) => {
            return availableTool.name;
          })
          .join(", ")}.`,
        errorMessage: `Unknown tool: ${data.name}`,
      };
    }

    const refusedByGates: ToolCallOutcome | null = this.refuseByGates(
      tool,
      data,
    );

    if (refusedByGates) {
      return refusedByGates;
    }

    const refusedAsOff: ToolCallOutcome | null =
      await this.refuseProductsOffOnServer(tool);

    if (refusedAsOff) {
      return refusedAsOff;
    }

    try {
      const result: ToolExecutionResult = await Promise.race([
        tool.execute(data.args, data.ctx),
        new Promise<never>(
          (_resolve: unknown, reject: (err: Error) => void) => {
            setTimeout(() => {
              reject(new Error("Tool execution timed out."));
            }, TOOL_EXECUTION_TIMEOUT_MS);
          },
        ),
      ]);

      return {
        success: true,
        textForLlm: result.dataForLlm,
        result: result,
      };
    } catch (error) {
      const message: string =
        error instanceof Error ? error.message : String(error);

      /*
       * A refusal - the person may not make this change, or the project's
       * plan does not include it - is no mistake in the arguments: retrying
       * cannot help, so the model is told to say what was refused, plainly.
       */
      if (
        error instanceof NotAuthorizedException ||
        error instanceof PaymentRequiredException
      ) {
        logger.debug(`AI toolbox tool ${data.name} was refused: ${message}`);

        return {
          success: false,
          textForLlm: `Refused: ${data.name} was not allowed for the current user. ${message} Do not retry it. Tell the user plainly that it was not done, and why.`,
          errorMessage: message,
          refusal:
            error instanceof PaymentRequiredException
              ? AIToolRefusal.Plan
              : AIToolRefusal.NotAllowed,
        };
      }

      /*
       * What the change was made to moved on before it ran
       * (ConflictException): a workflow saved after Ask AI proposed a change
       * to it that the save touched too (issue #6274). Nothing was done,
       * and nothing in the arguments is wrong: the message says what to do
       * instead - read the record again and propose the change once more.
       * The check doing its job is no fault, so it is not logged as one.
       */
      if (error instanceof ConflictException) {
        logger.debug(`AI toolbox tool ${data.name} was not done: ${message}`);

        return {
          success: false,
          textForLlm: `Not done: ${message}`,
          errorMessage: message,
        };
      }

      logger.error(`AI toolbox tool ${data.name} failed: ${message}`);

      return {
        success: false,
        textForLlm: `Error executing ${data.name}: ${message}. Adjust the arguments and try again, or answer with the data you already have.`,
        errorMessage: message,
      };
    }
  }

  /*
   * The gates every call passes before its tool runs, in order - the
   * request is for this one project, the arguments are an object, a change
   * has a signed-in person to be made as, and they hold the tool's
   * permissions - and the refusal of the first it fails, or null. Shared by
   * executeTool and checkBeforeApproval, which asks them before a setup
   * action's card is shown and never runs the tool.
   */
  private static refuseByGates(
    tool: ObservabilityTool,
    data: { name: string; args: JSONObject; ctx: ToolContext },
  ): ToolCallOutcome | null {
    // Checked first so the refusal names the real problem, not a permission.
    if (!this.isContextScopedToOneProject(data.ctx)) {
      return {
        success: false,
        textForLlm: `Error: ${data.name} can only run inside the single project this request is authorized for. Answer with the data you already have.`,
        errorMessage: `Permission denied for tool: ${data.name} (the request is not scoped to this project)`,
        refusal: AIToolRefusal.NotAllowed,
      };
    }

    /*
     * Tool JSON is untrusted at runtime even though callers are typed. Check
     * the envelope before argument-dependent permission functions read it.
     */
    if (
      !data.args ||
      typeof data.args !== "object" ||
      Array.isArray(data.args)
    ) {
      return {
        success: false,
        textForLlm: `Error: arguments for ${data.name} must be a JSON object. Adjust the arguments and try again.`,
        errorMessage: `Invalid arguments for tool: ${data.name}; expected a JSON object`,
      };
    }

    /*
     * A tool that changes the project writes as the person who asked for it,
     * with their props: what they may not do in the dashboard, it does not
     * do (every write tool makes the dashboard's own write). A run with no
     * such person - a system run as OneUptime - has nobody to write as, so
     * it changes nothing.
     */
    if (tool.isMutation && !this.isPersonContext(data.ctx)) {
      if (this.hasPerson(data.ctx)) {
        return {
          success: false,
          textForLlm: `Error: ${data.name} changes the project, and only runs inside the project the request is for. Answer with the data you already have.`,
          errorMessage: `Permission denied for tool: ${data.name} (the request is not for this project)`,
          refusal: AIToolRefusal.NotAllowed,
        };
      }

      return {
        success: false,
        textForLlm: `Error: ${data.name} changes the project, and only runs for a signed-in person who asked for it. Answer with the data you already have.`,
        errorMessage: `Permission denied for tool: ${data.name} (no signed-in person to act as)`,
        refusal: AIToolRefusal.NotAllowed,
      };
    }

    if (!this.hasPermissionForTool(tool, data.ctx, data.args)) {
      return {
        success: false,
        textForLlm: this.describePermissionRefusal(tool, data.ctx, data.args),
        errorMessage: `Permission denied for tool: ${data.name}`,
        refusal: this.getPermissionRefusal(tool, data.ctx, data.args),
      };
    }

    return null;
  }

  /*
   * A tool of a product switched off on this server (#6815, ToolProducts):
   * not run, and - for a setup action - not proposed. The model is told
   * what happened and who can switch it on, and to say so rather than try
   * again. Null when every product the tool names is on, or it names none.
   */
  public static async refuseProductsOffOnServer(
    tool: ObservabilityTool,
  ): Promise<ToolCallOutcome | null> {
    const products: ReadonlyArray<ProductKey> = getToolProducts(tool.name);

    const off: { product: ProductKey; reason: ServerProductOffReason } | null =
      await ServerProducts.getFirstOff(products);

    if (!off) {
      return null;
    }

    const message: string = getProductOffMessage(off);

    return {
      success: false,
      textForLlm: `Not done: ${message} Do not retry it, and do not offer to set it up another way. Tell the user plainly that it was not done, and who can switch it on.`,
      errorMessage: message,
      refusal: AIToolRefusal.ProductOff,
    };
  }

  /*
   * Whether a tool runs for a signed-in person: a user, not OneUptime
   * itself, whose request is for the project the tool acts in. Only then is
   * there someone a change can be made as - in that project, with their
   * grants there (WorkspaceMemberActions reads the project from the
   * request's tenant).
   */
  public static isPersonContext(ctx: ToolContext): boolean {
    return (
      this.hasPerson(ctx) &&
      Boolean(ctx.props.tenantId) &&
      Boolean(ctx.projectId) &&
      ctx.props.tenantId!.toString() === ctx.projectId.toString()
    );
  }

  // Whether the request is a user's, not OneUptime's own.
  private static hasPerson(ctx: ToolContext): boolean {
    return Boolean(ctx.props.userId) && !ctx.props.isRoot;
  }

  /*
   * Why the gate refused the person a tool, for the run's activity: a team's
   * block, when they hold a permission of the first list they fall short of
   * and a block takes it away (as describePermissionRefusal tells the
   * model), else their role.
   */
  private static getPermissionRefusal(
    tool: ObservabilityTool,
    ctx: ToolContext,
    args: JSONObject,
  ): AIToolRefusal {
    const held: HeldPermissions = CallerPermission.getHeld(ctx.props);
    const groups: Array<Array<Permission>> = tool.getRequiredPermissionGroups
      ? tool.getRequiredPermissionGroups(args)
      : [tool.requiredPermissions];
    const missing: Array<Permission> | undefined = groups.find(
      (group: Array<Permission>): boolean => {
        return !HeldPermissionsUtil.holdsAnyOf(held, group, {
          labelledBlocksRefuse: true,
        });
      },
    );

    return missing &&
      missing.length > 0 &&
      HeldPermissionsUtil.isGrantedAny(held, missing)
      ? AIToolRefusal.TeamBlock
      : AIToolRefusal.Permission;
  }

  /*
   * What the model is told when the person may not use a tool, for the
   * first list of permissions they fall short of: the permissions it needs,
   * when they hold none of them - or, when they hold one, the block that
   * takes it away (a team's block on any permission of the list refuses the
   * tool, one limited to some labels included: hasPermissionForTool), so
   * they are not sent after a role they already have.
   */
  private static describePermissionRefusal(
    tool: ObservabilityTool,
    ctx: ToolContext,
    args: JSONObject,
  ): string {
    const refused: string = `Error: the current user does not have permission to use ${tool.name}. Answer with the data you already have`;

    const held: HeldPermissions = CallerPermission.getHeld(ctx.props);
    const groups: Array<Array<Permission>> = tool.getRequiredPermissionGroups
      ? tool.getRequiredPermissionGroups(args)
      : [tool.requiredPermissions];
    const missing: Array<Permission> | undefined = groups.find(
      (group: Array<Permission>): boolean => {
        return !HeldPermissionsUtil.holdsAnyOf(held, group, {
          labelledBlocksRefuse: true,
        });
      },
    );

    if (!missing || missing.length === 0) {
      return `${refused}, and tell the user which permission is missing.`;
    }

    if (!HeldPermissionsUtil.isGrantedAny(held, missing)) {
      return `${refused}, and tell the user which permission is missing. It needs one of these permissions: ${PermissionHelper.getPermissionTitles(missing).join(", ")}.`;
    }

    const blocked: Array<Permission> = missing.filter(
      (permission: Permission): boolean => {
        return (
          held.blocked.includes(permission) ||
          held.blockedForSomeLabels.includes(permission)
        );
      },
    );
    const blockedOnSomeLabelsOnly: boolean = blocked.every(
      (permission: Permission): boolean => {
        return !held.blocked.includes(permission);
      },
    );

    return `${refused}, and tell the user why: they hold a permission it needs, but a team they belong to blocks ${PermissionHelper.getPermissionTitles(blocked).join(", ")}${blockedOnSomeLabelsOnly ? " on some labels" : ""}, and a block on any permission this tool accepts refuses it${blockedOnSomeLabelsOnly ? " everywhere" : ""}.`;
  }
}
