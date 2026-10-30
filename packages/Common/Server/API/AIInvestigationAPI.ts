import InvestigationEligibility from "../Utils/AI/SRE/InvestigationEligibility";
import InvestigationRuleWait, {
  RuleWaitLane,
  StartNowResult,
  WaitingInvestigation,
} from "../Utils/AI/SRE/InvestigationRuleWait";
import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../Types/ObjectID";
import BadDataException from "../../Types/Exception/BadDataException";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import Query from "../../Types/BaseDatabase/Query";
import { JSONArray, JSONObject } from "../../Types/JSON";
import AIRunType from "../../Types/AI/AIRunType";
import AIRunHumanVerdict from "../../Types/AI/AIRunHumanVerdict";
import AIRunStatus from "../../Types/AI/AIRunStatus";
import AIRunEventType from "../../Types/AI/AIRunEventType";
import AIRun from "../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../Models/DatabaseModels/AIRunEvent";
import Incident from "../../Models/DatabaseModels/Incident";
import Alert from "../../Models/DatabaseModels/Alert";
import Service from "../../Models/DatabaseModels/Service";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentService from "../Services/IncidentService";
import AlertService from "../Services/AlertService";
import AIRunService from "../Services/AIRunService";
import AIRunEventService from "../Services/AIRunEventService";
import ServiceService from "../Services/ServiceService";
import FixFromIncidentTaskTrigger from "../Utils/AI/SRE/FixFromIncidentTaskTrigger";
import FixPerformanceTaskTrigger, {
  PerformanceTraceSpans,
} from "../Utils/AI/SRE/FixPerformanceTaskTrigger";
import TelemetryImprovementTaskTrigger from "../Utils/AI/SRE/TelemetryImprovementTaskTrigger";
import ProfileFixTaskTrigger, {
  ProfileFixRequest,
} from "../Utils/AI/SRE/ProfileFixTaskTrigger";
import {
  ProfileFixSuggestion,
  profileFixSuggestionToJSON,
} from "../../Utils/Suggestions/ProfileFixSuggestion";
import {
  InvestigationCodeFixSuggestion,
  investigationCodeFixSuggestionToJSON,
} from "../../Utils/Suggestions/InvestigationCodeFixSuggestion";
import PostedRootCause from "../Utils/AI/SRE/PostedRootCause";
import KubernetesClusterAiAccessService, {
  AI_BALANCE_INSUFFICIENT_NEXT_STEP,
} from "../Services/KubernetesClusterAiAccessService";
import KubernetesClusterService from "../Services/KubernetesClusterService";
import KubernetesCluster from "../../Models/DatabaseModels/KubernetesCluster";
import QueryHelper from "../Types/Database/QueryHelper";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import {
  KubernetesAiAccessGap,
  KubernetesAiAccessGapCode,
  KubernetesAiAccessRunnerSummary,
  KubernetesClusterAiAccessStatus,
  getKubernetesAiAccessTargetKind,
} from "../../Types/Kubernetes/KubernetesClusterAiAccess";
import CodeFixTaskType from "../../Types/AI/CodeFixTaskType";
import {
  TracePerformanceFixSuggestion,
  tracePerformanceFixSuggestionToJSON,
} from "../../Utils/Suggestions/TracePerformanceFixSuggestion";
import {
  TelemetryImprovementSuggestion,
  telemetryImprovementSuggestionToJSON,
} from "../../Utils/Suggestions/TelemetryImprovementSuggestion";
import {
  InvestigationEventReference,
  InvestigationEvidenceItem,
  InvestigationEvidenceRowsResponse,
  InvestigationReferenceKind,
} from "../../Types/AI/InvestigationEvidence";
import {
  buildInvestigationEvidence,
  EVIDENCE_CITATION_ID_REGEX,
} from "../Utils/AI/SRE/InvestigationEvidence";
import { resolveInvestigationReferences } from "../Utils/AI/SRE/InvestigationReferences";
import {
  MAX_EVIDENCE_TEXT_LENGTH,
  pinEvidenceArgumentsToInvestigationTime,
  rerunInvestigationEvidence,
} from "../Utils/AI/SRE/InvestigationEvidenceRerun";
import { AIRunEventResultSummary } from "../../Types/AI/AIChatTypes";
import logger from "../Utils/Logger";

// Where they lived before; tests and callers still import them from here.
export {
  MAX_EVIDENCE_TEXT_LENGTH,
  pinEvidenceArgumentsToInvestigationTime,
  rerunInvestigationEvidence,
};

const router: ExpressRouter = Express.getRouter();

const MAX_EVENTS: number = 500;

/*
 * `aiRunId` is the established dashboard API field. The investigation panel
 * introduced the more explicit `investigationRunId` name while this feature
 * was in flight, so accept either spelling without ever allowing two
 * different ids in one request. Both names identify the exact displayed run.
 */
/*
 * The repository a person picked for a fix, when the body names one
 * (create-performance-fix-task: TracePerformanceFixSuggestion.repositories).
 */
export function readPickedRepositoryId(body: unknown): ObjectID | undefined {
  const repositoryId: unknown =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as JSONObject)["repositoryId"]
      : undefined;

  if (repositoryId === undefined || repositoryId === null) {
    return undefined;
  }

  if (typeof repositoryId !== "string" || !ObjectID.isValidUUID(repositoryId)) {
    throw new BadDataException("repositoryId must be a repository's ID.");
  }

  return new ObjectID(repositoryId);
}

function getDisplayedInvestigationRunId(req: ExpressRequest): ObjectID {
  const aiRunId: string =
    typeof req.body["aiRunId"] === "string"
      ? (req.body["aiRunId"] as string).trim()
      : "";
  const investigationRunId: string =
    typeof req.body["investigationRunId"] === "string"
      ? (req.body["investigationRunId"] as string).trim()
      : "";

  if (!aiRunId && !investigationRunId) {
    throw new BadDataException("investigationRunId (or aiRunId) is required.");
  }

  if (aiRunId && investigationRunId && aiRunId !== investigationRunId) {
    throw new BadDataException(
      "aiRunId and investigationRunId must identify the same displayed investigation.",
    );
  }

  const selectedRunId: string = investigationRunId || aiRunId;
  ObjectID.validateUUID(selectedRunId);
  return new ObjectID(selectedRunId);
}

/*
 * The run wins its Running -> Completed transition before it performs the
 * confidence check and posts the RootCause feed item. A final RunCompleted or
 * RunFailed event is emitted when that finalization settles; failures from
 * retried attempts precede a later RunStarted. This upper bound is a crash
 * failsafe and deliberately leaves ample margin above the bounded confidence
 * classification deadline plus feed publication.
 */
export const ANALYSIS_FINALIZATION_TIMEOUT_MS: number = 10 * 60 * 1000;
// Database/application clocks can differ briefly around the Completed write.
export const ANALYSIS_COMPLETION_CLOCK_SKEW_MS: number = 60 * 1000;

export function isAnalysisPendingForRun(data: {
  run: AIRun;
  events: Array<AIRunEvent>;
  analysisMarkdown: string | null;
  currentDate?: Date | undefined;
}): boolean {
  if (
    data.run.status !== AIRunStatus.Completed ||
    data.analysisMarkdown ||
    !data.run.completedAt
  ) {
    return false;
  }

  /*
   * A retried run retains RunFailed from earlier attempts. Only a settlement
   * event emitted after the latest RunStarted belongs to the attempt that won
   * the Completed transition; an older failure must not stop report polling.
   * sendLatestInvestigation supplies events in sequence order.
   */
  let latestRunStartedIndex: number = -1;
  data.events.forEach((event: AIRunEvent, index: number): void => {
    if (event.eventType === AIRunEventType.RunStarted) {
      latestRunStartedIndex = index;
    }
  });

  const hasFinalizationEvent: boolean = data.events.some(
    (event: AIRunEvent, index: number): boolean => {
      return (
        index > latestRunStartedIndex &&
        (event.eventType === AIRunEventType.RunCompleted ||
          event.eventType === AIRunEventType.RunFailed)
      );
    },
  );

  if (hasFinalizationEvent) {
    return false;
  }

  const currentDate: Date = data.currentDate || new Date();
  const millisecondsSinceCompletion: number =
    currentDate.getTime() - data.run.completedAt.getTime();

  return (
    millisecondsSinceCompletion >= -ANALYSIS_COMPLETION_CLOCK_SKEW_MS &&
    millisecondsSinceCompletion < ANALYSIS_FINALIZATION_TIMEOUT_MS
  );
}

/*
 * Returns the latest AI investigation (the AIRun + its ordered
 * AIRunEvents) for an incident or alert, so the dashboard can render a live
 * "watch it think" panel.
 *
 * Investigation runs are system-authored (userId = null) and are therefore
 * hidden by the per-user privacy pin on the generic AIRun / AIRunEvent CRUD. So
 * we gate access explicitly here: first confirm the caller can read the
 * incident/alert under THEIR permissions, then read the run + events as root.
 */

export async function getLoggedInProps(
  req: ExpressRequest,
): Promise<DatabaseCommonInteractionProps> {
  const props: DatabaseCommonInteractionProps =
    await CommonAPI.getDatabaseCommonInteractionProps(req);

  CommonAPI.assertAuthenticatedUser(props);

  return props;
}

/*
 * The panel routes act inside exactly ONE project: the tenant the request is
 * authenticated for. A request carrying the `is-multi-tenant-query` header
 * makes the model layer answer from any project the user belongs to — so the
 * subject could live in project B while every tenant-keyed permission check
 * (the AI toolbox's grants, the reference lookups) reads the caller's grants
 * in project A. The viewer props are therefore always pinned to the tenant,
 * and the subject is then asserted to belong to it, so "whose grants were
 * checked" and "which project was queried" can never diverge.
 */
export function pinPropsToTenant(
  props: DatabaseCommonInteractionProps,
): DatabaseCommonInteractionProps {
  return { ...props, isMultiTenantRequest: false };
}

/*
 * Access check under the VIEWER's tenant-pinned permissions: throws unless
 * they can read the incident/alert AND it belongs to the tenant.
 */
export async function assertSubjectReadableInTenant(data: {
  subjectType: InvestigationReferenceKind;
  subjectId: ObjectID;
  tenantId: ObjectID;
  viewerProps: DatabaseCommonInteractionProps;
}): Promise<void> {
  const subject: Incident | Alert | null =
    data.subjectType === "incident"
      ? await IncidentService.findOneById({
          id: data.subjectId,
          select: { _id: true, projectId: true },
          props: data.viewerProps,
        })
      : await AlertService.findOneById({
          id: data.subjectId,
          select: { _id: true, projectId: true },
          props: data.viewerProps,
        });

  if (!subject || !subject.projectId) {
    throw new BadDataException(
      `${data.subjectType === "incident" ? "Incident" : "Alert"} not found (or you do not have access to it).`,
    );
  }

  CommonAPI.assertResourceBelongsToProject({
    resourceProjectId: subject.projectId,
    projectId: data.tenantId,
  });
}

/*
 * Whether the viewer may start an investigation of the incident or alert:
 * the one who may change it, held to this record - their labels, owners and
 * team's blocks - as an update of it is held (findOneUpdatableById). The
 * same rule Ask AI's start_investigation follows: an investigation posts its
 * report to the record. Answers false rather than throwing.
 */
export async function canViewerStartInvestigation(data: {
  subjectType: InvestigationReferenceKind;
  subjectId: ObjectID;
  viewerProps: DatabaseCommonInteractionProps;
}): Promise<boolean> {
  try {
    const changeable: Incident | Alert | null =
      data.subjectType === "incident"
        ? await IncidentService.findOneUpdatableById({
            id: data.subjectId,
            select: { _id: true },
            props: data.viewerProps,
          })
        : await AlertService.findOneUpdatableById({
            id: data.subjectId,
            select: { _id: true },
            props: data.viewerProps,
          });

    return Boolean(changeable);
  } catch {
    return false;
  }
}

/*
 * What the panel says while an investigation rule makes OneUptime AI wait
 * before it investigates the incident or alert (issue #5074): when the wait
 * ends - it is investigated then if it is still open - the wait, and
 * whether the viewer may start it now. Null when it does not wait.
 */
export async function getWaitingInvestigationForPanel(data: {
  projectId: ObjectID;
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
  viewerProps: DatabaseCommonInteractionProps;
}): Promise<JSONObject | null> {
  const subjectId: ObjectID | undefined = data.alertId || data.incidentId;

  if (!subjectId) {
    return null;
  }

  const waiting: WaitingInvestigation | null =
    await InvestigationRuleWait.getWaiting({
      lane: data.alertId ? "Alert" : "Incident",
      projectId: data.projectId,
      subjectId,
    });

  if (!waiting) {
    return null;
  }

  return {
    waitUntil: waiting.waitUntil.toISOString(),
    waitMinutes: waiting.waitMinutes,
    canStartNow: await canViewerStartInvestigation({
      subjectType: data.alertId ? "alert" : "incident",
      subjectId,
      viewerProps: data.viewerProps,
    }),
  };
}

/*
 * The event JSON the panel receives keeps its long-standing shape. The run's
 * tool arguments and citation metadata are read only to build `evidence`
 * (which sanitises them); shipping the raw LLM arguments to every viewer in
 * the activity feed would bypass that sanitisation.
 */
function toClientEventJson(eventJson: JSONObject): JSONObject {
  const clientJson: JSONObject = { ...eventJson };
  delete clientJson["toolArguments"];
  delete clientJson["citationId"];

  const resultSummary: unknown = clientJson["resultSummary"];

  if (
    resultSummary &&
    typeof resultSummary === "object" &&
    !Array.isArray(resultSummary)
  ) {
    const clientSummary: AIRunEventResultSummary = {
      ...(resultSummary as AIRunEventResultSummary),
    };
    delete clientSummary.citationLabel;
    delete clientSummary.citationTarget;
    clientJson["resultSummary"] = clientSummary as JSONObject;
  }

  return clientJson;
}

/*
 * Structured evidence for the published report. Pure over the loaded events,
 * but guarded anyway: evidence enriches the panel and must never fail the
 * payload that carries the report itself.
 */
function buildEvidenceForReport(data: {
  events: Array<AIRunEvent>;
  analysisMarkdown: string;
}): Array<InvestigationEvidenceItem> {
  try {
    return buildInvestigationEvidence(data);
  } catch (error) {
    logger.error(
      `AI: could not build investigation evidence for the panel: ${error}`,
    );
    return [];
  }
}

/*
 * Read the latest investigation run + its events as root (bypasses the
 * per-user pin) and send them. Callers must have already access-checked the
 * subject under the USER's permissions.
 */
async function sendLatestInvestigation(
  req: ExpressRequest,
  res: ExpressResponse,
  runQuery: Query<AIRun>,
  subject: {
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
  },
  viewer: {
    subjectType: InvestigationReferenceKind;
    /*
     * The authenticated tenant, which the subject was asserted to belong to;
     * the run, its events and the references are all read inside it only.
     */
    projectId: ObjectID;
    // The VIEWER's tenant-pinned props — references use their permissions.
    props: DatabaseCommonInteractionProps;
  },
): Promise<void> {
  const runs: Array<AIRun> = await AIRunService.findBy({
    query: runQuery,
    select: {
      _id: true,
      status: true,
      startedAt: true,
      completedAt: true,
      errorMessage: true,
      llmCallCount: true,
      toolCallCount: true,
      totalTokens: true,
      createdAt: true,
      codeFixRecommendation: true,
      // The AI-written summary the panel shows above the report.
      analysisTldr: true,
      // Measurement layer: the panel renders verdict/grade state from these.
      humanVerdict: true,
      humanVerdictAt: true,
      autoGrade: true,
      autoGradeAt: true,
    },
    sort: { createdAt: SortOrder.Descending },
    limit: 1,
    skip: 0,
    props: { isRoot: true },
  });

  const run: AIRun | undefined = runs[0];

  /*
   * Which clusters this signal is about and whether OneUptime AI can reach
   * them — evaluated from CURRENT configuration so the panel can tell the
   * reader "we investigated with OneUptime data only; here is what is
   * missing and where to fix it". Enrichment: a failure yields no rows.
   * Present, possibly empty, in every response shape. How much of each row
   * the viewer gets follows THEIR read access to the cluster, not their
   * access to the incident or alert.
   */
  const clusterAccess: Array<InvestigationPanelClusterAccess> =
    await getClusterAccessForPanel({
      projectId: viewer.projectId,
      ...subject,
      viewerProps: viewer.props,
    });

  if (!run) {
    /*
     * An investigation rule makes OneUptime AI wait before it investigates
     * this incident or alert (issue #5074): the panel says until when -
     * nothing has been decided against it, so there is no reason to give.
     */
    const waitingInvestigation: JSONObject | null =
      await getWaitingInvestigationForPanel({
        projectId: viewer.projectId,
        ...subject,
        viewerProps: viewer.props,
      });

    Response.sendJsonObjectResponse(req, res, {
      run: null,
      notInvestigatedReason: waitingInvestigation
        ? null
        : ((await InvestigationEligibility.getNotStartedReason({
            projectId: viewer.projectId,
            ...subject,
          })) as unknown as JSONObject),
      waitingInvestigation,
      events: [],
      analysisMarkdown: null,
      analysisTldr: null,
      isAnalysisPending: false,
      evidence: [],
      references: [],
      clusterAccess: clusterAccess as unknown as JSONArray,
    });
    return;
  }

  /*
   * Evidence is only ever built next to a published report, which requires a
   * Completed run. The panel polls every few seconds while a run is active,
   * so the (potentially large) raw tool arguments are not read until then.
   */
  const isEvidenceEligible: boolean = run.status === AIRunStatus.Completed;

  const events: Array<AIRunEvent> = await AIRunEventService.findBy({
    query: { aiRunId: run.id!, projectId: viewer.projectId },
    select: {
      _id: true,
      sequence: true,
      eventType: true,
      toolName: true,
      resultSummary: true,
      createdAt: true,
      /*
       * Read for the structured evidence list only — toClientEventJson
       * strips both from the event JSON sent to the panel.
       */
      ...(isEvidenceEligible ? { citationId: true, toolArguments: true } : {}),
    },
    sort: { sequence: SortOrder.Ascending },
    limit: MAX_EVENTS,
    skip: 0,
    props: { isRoot: true },
  });

  const runJson: JSONObject | undefined = BaseModel.toJSONArray(
    [run],
    AIRun,
  )[0];

  const eventsJson: JSONArray = BaseModel.toJSONArray(events, AIRunEvent).map(
    (eventJson: JSONObject): JSONObject => {
      return toClientEventJson(eventJson);
    },
  );

  /*
   * RootCause is the canonical persisted investigation result. The explicit
   * aiRunId association is immune to application/database clock skew and to
   * overlapping investigations posting out of order.
   */
  let analysisMarkdown: string | null = null;

  if (run.status === AIRunStatus.Completed && run.completedAt) {
    analysisMarkdown = await PostedRootCause.getForInvestigation({
      ...subject,
      aiRunId: run.id!,
      runCompletedAt: run.completedAt,
    });
  }

  const isAnalysisPending: boolean = isAnalysisPendingForRun({
    run,
    events,
    analysisMarkdown,
  });

  /*
   * The TL;DR summarizes the report, so it is only meaningful alongside one.
   * A run whose report is still settling (or which never published one) must
   * not show a summary of something the reader cannot yet see, and the
   * trimmed empty string is normalized to null so the panel has exactly one
   * "no TL;DR" shape to render.
   */
  const analysisTldr: string | null = analysisMarkdown
    ? (run.analysisTldr || "").trim() || null
    : null;

  /*
   * The selected column also travels inside the serialized run, so the gate
   * above has to be applied there too — otherwise a client reading
   * run.analysisTldr would show a summary of a report the payload does not
   * carry. One field, one rule: the summary exists only next to its report.
   */
  if (runJson) {
    runJson["analysisTldr"] = analysisTldr;
  }

  /*
   * Evidence and references describe the report, so — like the TL;DR — they
   * only travel next to one. References are resolved under the viewer's own
   * tenant-pinned permissions inside the tenant; a failure yields no links.
   */
  const evidence: Array<InvestigationEvidenceItem> = analysisMarkdown
    ? buildEvidenceForReport({ events, analysisMarkdown })
    : [];

  const references: Array<InvestigationEventReference> = analysisMarkdown
    ? await resolveInvestigationReferences({
        markdown: analysisMarkdown,
        subjectType: viewer.subjectType,
        projectId: viewer.projectId,
        props: viewer.props,
      })
    : [];

  Response.sendJsonObjectResponse(req, res, {
    run: runJson || null,
    notInvestigatedReason: null,
    waitingInvestigation: null,
    events: eventsJson,
    analysisMarkdown,
    analysisTldr,
    isAnalysisPending,
    evidence: evidence as unknown as JSONArray,
    references: references as unknown as JSONArray,
    clusterAccess: clusterAccess as unknown as JSONArray,
  });
}

/*
 * The cluster access row the panel receives, rebuilt field by field from
 * the service's status — an allowlist, so a field added to the status (or
 * to the runner summary) never reaches every viewer of an incident by
 * default. The status is computed as root, so the row is cut down to what
 * the VIEWER may read:
 *
 *  - every reader of the incident or alert gets the summary: which cluster,
 *    whether AI can reach it, what AI may do there, and — per gap — the
 *    title and next step, which is what the notice's sentence and link are
 *    built from. The cluster's name is already theirs (it is readable
 *    through the incident's own cluster relation);
 *  - a viewer who can also read the cluster gets the rest the cluster's AI
 *    page would show them: the Runner and its posture, the allowlist, the
 *    last verification and error, and each gap's full description.
 *
 * Anything else the jobs themselves use never leaves.
 */
export type InvestigationPanelClusterAccess = Pick<
  KubernetesClusterAiAccessStatus,
  | "clusterId"
  | "clusterName"
  | "isInvestigationReady"
  | "remediationMode"
  | "isRemediationReady"
  | "gaps"
  | "evaluatedAt"
> &
  Partial<KubernetesClusterAiAccessStatus>;

/*
 * Stands in for a gap description on a row whose viewer cannot read the
 * cluster: descriptions name the Runner and the cluster identifier the
 * Runner reported.
 */
export const RESTRICTED_GAP_DESCRIPTION: string =
  "Someone who can view this Kubernetes cluster can see the details on its AI agent page (AI → Agent).";

/*
 * Stand in for a gap's next step on a row whose viewer cannot read the
 * cluster. The service's next steps are written for the cluster's AI agent
 * page and may name the Runner, the agent's namespace or the cluster
 * identifier — none of which such a viewer is shown — and
 * point at a page they cannot open. A project-level gap is fixed in
 * Project Settings instead.
 */
export const RESTRICTED_GAP_NEXT_STEP: string =
  "Ask someone who can edit this Kubernetes cluster's AI access to fix it on the cluster's AI agent page (AI → Agent).";

export const RESTRICTED_PROJECT_GAP_NEXT_STEP: string =
  "Ask a project owner or admin to change this in Project Settings (AI Features, AI Credits or LLM Providers).";

/*
 * The gaps fixed in Project Settings rather than on the cluster. Every
 * other code — including one added later — gets the cluster-level text,
 * which names nothing, so a new code can never leak its service text.
 */
const PROJECT_LEVEL_GAP_CODES: ReadonlyArray<KubernetesAiAccessGapCode> = [
  "project_ai_disabled",
  "project_auto_remediation_disabled",
  "project_ai_command_execution_disabled",
  "llm_provider_missing",
  "ai_balance_insufficient",
];

/*
 * The next step a viewer who cannot read the cluster sees for a gap. An
 * empty AI balance keeps its own step: it names nothing of the cluster, and
 * says who can add credits - a project owner or someone with Manage
 * Billing, which a project admin is not.
 */
export function getRestrictedGapNextStep(code: string): string {
  if (code === "ai_balance_insufficient") {
    return AI_BALANCE_INSUFFICIENT_NEXT_STEP;
  }

  return PROJECT_LEVEL_GAP_CODES.includes(code as KubernetesAiAccessGapCode)
    ? RESTRICTED_PROJECT_GAP_NEXT_STEP
    : RESTRICTED_GAP_NEXT_STEP;
}

function toPanelRunnerSummary(
  runner: KubernetesAiAccessRunnerSummary | null,
): KubernetesAiAccessRunnerSummary | null {
  if (!runner) {
    return null;
  }

  return {
    id: runner.id,
    name: runner.name,
    /*
     * Which kind of target it is: the panel names the Kubernetes AI agent
     * and a Runner differently, and accessMethod ("in_cluster" for both
     * the agent and the previous in-cluster Runner) cannot tell them apart.
     */
    kind: getKubernetesAiAccessTargetKind(runner) || undefined,
    isOnline: runner.isOnline,
    lastAliveAt: runner.lastAliveAt,
    canRunAiCommands: runner.canRunAiCommands,
    posture: runner.posture
      ? {
          clusterIdentifier: runner.posture.clusterIdentifier,
          inCluster: runner.posture.inCluster,
          allowWrites: runner.posture.allowWrites,
          kubectlVersion: runner.posture.kubectlVersion,
          agentChartVersion: runner.posture.agentChartVersion,
        }
      : undefined,
  };
}

// What the viewer may see of one cluster's row.
export interface PanelClusterAccessVisibility {
  canReadCluster: boolean;
}

export function toPanelClusterAccess(
  status: KubernetesClusterAiAccessStatus,
  visibility: PanelClusterAccessVisibility,
): InvestigationPanelClusterAccess {
  const gaps: Array<KubernetesAiAccessGap> = (status.gaps || []).map(
    (gap: KubernetesAiAccessGap): KubernetesAiAccessGap => {
      return {
        code: gap.code,
        title: gap.title,
        description: !visibility.canReadCluster
          ? RESTRICTED_GAP_DESCRIPTION
          : gap.description,
        /*
         * A reader of the cluster keeps the actionable step. Everyone else
         * gets a generic one: the step can name what the row withholds.
         */
        nextStep: !visibility.canReadCluster
          ? getRestrictedGapNextStep(gap.code)
          : gap.nextStep,
        blocks: gap.blocks,
      };
    },
  );

  // Every reader of the subject: whether AI can reach it, and what to do.
  const summary: InvestigationPanelClusterAccess = {
    clusterId: status.clusterId,
    clusterName: status.clusterName,
    isInvestigationReady: status.isInvestigationReady,
    remediationMode: status.remediationMode,
    isRemediationReady: status.isRemediationReady,
    gaps,
    evaluatedAt: status.evaluatedAt,
  };

  if (!visibility.canReadCluster) {
    return summary;
  }

  return {
    ...summary,
    clusterIdentifier: status.clusterIdentifier,
    runner: toPanelRunnerSummary(status.runner),
    accessMethod: status.accessMethod,
    kubectlAllowlist: [...(status.kubectlAllowlist || [])],
    isInvestigationEnabled: status.isInvestigationEnabled,
    lastVerifiedAt: status.lastVerifiedAt,
    lastError: status.lastError,
  };
}

/*
 * Which of these clusters the viewer can read, decided by the model layer
 * under the viewer's own tenant-pinned props — the same check the cluster
 * AI page's status route makes before it returns any of this. A viewer
 * without read on the cluster table is refused outright (an exception, not
 * an empty list), and any other failure is treated the same way: the rows
 * fall back to the summary instead of disappearing.
 */
async function getClusterIdsReadableByViewer(data: {
  clusterIds: Array<string>;
  projectId: ObjectID;
  viewerProps: DatabaseCommonInteractionProps;
}): Promise<Set<string>> {
  try {
    const clusters: Array<KubernetesCluster> =
      await KubernetesClusterService.findBy({
        query: {
          _id: QueryHelper.any(data.clusterIds),
          projectId: data.projectId,
        },
        select: { _id: true },
        limit: data.clusterIds.length,
        skip: 0,
        props: data.viewerProps,
      });

    return new Set<string>(
      clusters
        .map((cluster: KubernetesCluster): string => {
          return cluster.id?.toString() || "";
        })
        .filter(Boolean),
    );
  } catch (error) {
    if (!(error instanceof NotAuthorizedException)) {
      logger.error(
        `AI: could not check which clusters the viewer can read; showing the cluster access summary only: ${error}`,
      );
    }
    return new Set<string>();
  }
}

async function getClusterAccessForPanel(data: {
  projectId: ObjectID;
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
  viewerProps: DatabaseCommonInteractionProps;
}): Promise<Array<InvestigationPanelClusterAccess>> {
  let statuses: Array<KubernetesClusterAiAccessStatus>;

  try {
    statuses = await KubernetesClusterAiAccessService.getStatusesForSubject({
      projectId: data.projectId,
      ...(data.incidentId ? { incidentId: data.incidentId } : {}),
      ...(data.alertId ? { alertId: data.alertId } : {}),
    });
  } catch (error) {
    logger.error(
      `AI: could not resolve cluster access for the investigation panel: ${error}`,
    );
    return [];
  }

  if (statuses.length === 0) {
    return [];
  }

  const readableClusterIds: Set<string> = await getClusterIdsReadableByViewer({
    clusterIds: statuses.map((status: KubernetesClusterAiAccessStatus) => {
      return status.clusterId;
    }),
    projectId: data.projectId,
    viewerProps: data.viewerProps,
  });

  return statuses.map(
    (
      status: KubernetesClusterAiAccessStatus,
    ): InvestigationPanelClusterAccess => {
      return toPanelClusterAccess(status, {
        canReadCluster: readableClusterIds.has(status.clusterId),
      });
    },
  );
}

router.post(
  "/ai-investigation/incident",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);

      /*
       * Pinned to the authenticated tenant before any read (see
       * pinPropsToTenant). Read authorization itself is the model layer's
       * check on the subject below, which also admits master admins.
       */
      const tenantId: ObjectID = CommonAPI.assertTenantScoped(props);
      const viewerProps: DatabaseCommonInteractionProps =
        pinPropsToTenant(props);

      const incidentIdString: string | undefined = req.body["incidentId"] as
        | string
        | undefined;

      if (!incidentIdString) {
        throw new BadDataException("incidentId is required.");
      }

      const incidentId: ObjectID = new ObjectID(incidentIdString);

      // Access check under the USER's permissions, inside the tenant.
      await assertSubjectReadableInTenant({
        subjectType: "incident",
        subjectId: incidentId,
        tenantId,
        viewerProps,
      });

      await sendLatestInvestigation(
        req,
        res,
        {
          projectId: tenantId,
          triggeredByIncidentId: incidentId,
          runType: AIRunType.Investigation,
        },
        {
          incidentId,
        },
        {
          subjectType: "incident",
          projectId: tenantId,
          props: viewerProps,
        },
      );
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

router.post(
  "/ai-investigation/alert",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);

      /*
       * Pinned to the authenticated tenant before any read (see
       * pinPropsToTenant). Read authorization itself is the model layer's
       * check on the subject below, which also admits master admins.
       */
      const tenantId: ObjectID = CommonAPI.assertTenantScoped(props);
      const viewerProps: DatabaseCommonInteractionProps =
        pinPropsToTenant(props);

      const alertIdString: string | undefined = req.body["alertId"] as
        | string
        | undefined;

      if (!alertIdString) {
        throw new BadDataException("alertId is required.");
      }

      const alertId: ObjectID = new ObjectID(alertIdString);

      // Access check under the USER's permissions, inside the tenant.
      await assertSubjectReadableInTenant({
        subjectType: "alert",
        subjectId: alertId,
        tenantId,
        viewerProps,
      });

      await sendLatestInvestigation(
        req,
        res,
        {
          projectId: tenantId,
          triggeredByAlertId: alertId,
          runType: AIRunType.Investigation,
        },
        {
          alertId,
        },
        {
          subjectType: "alert",
          projectId: tenantId,
          props: viewerProps,
        },
      );
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

/*
 * "Investigate now" on the AI Investigation card, while an investigation
 * rule makes OneUptime AI wait before it investigates the incident or alert
 * (issue #5074): start it now. A manual start ignores the wait - and the
 * rules, the severity floor and the cooldown, as asking OneUptime AI to
 * investigate does - but not AI being off, the provider, the credits or the
 * limits (InvestigationRuleWait.startNow).
 *
 * Only an authenticated member of the tenant who may read the record AND
 * change it may start it: the investigation posts its report to it.
 * Body: { subjectType: "incident" | "alert", subjectId }.
 * Response: { runId }, or 400 with what stopped it.
 */
router.post(
  "/ai-investigation/investigate-now",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);
      const tenantId: ObjectID = CommonAPI.assertTenantScoped(props);
      CommonAPI.assertAuthenticatedProjectMember(props);
      const viewerProps: DatabaseCommonInteractionProps =
        pinPropsToTenant(props);

      const subjectType: unknown = req.body["subjectType"];

      if (subjectType !== "incident" && subjectType !== "alert") {
        throw new BadDataException(
          'subjectType must be "incident" or "alert".',
        );
      }

      const subjectIdRaw: unknown = req.body["subjectId"];

      if (typeof subjectIdRaw !== "string" || !subjectIdRaw.trim()) {
        throw new BadDataException("subjectId is required.");
      }

      ObjectID.validateUUID(subjectIdRaw.trim());

      const subjectId: ObjectID = new ObjectID(subjectIdRaw.trim());

      // Access check under the USER's permissions, inside the tenant.
      await assertSubjectReadableInTenant({
        subjectType,
        subjectId,
        tenantId,
        viewerProps,
      });

      if (
        !(await canViewerStartInvestigation({
          subjectType,
          subjectId,
          viewerProps,
        }))
      ) {
        throw new NotAuthorizedException(
          `You do not have permission to change this ${subjectType}, so you cannot start its investigation.`,
        );
      }

      const lane: RuleWaitLane = subjectType === "alert" ? "Alert" : "Incident";
      const result: StartNowResult = await InvestigationRuleWait.startNow({
        lane,
        projectId: tenantId,
        subjectId,
      });

      if (!result.isStarted) {
        throw new BadDataException(result.message);
      }

      Response.sendJsonObjectResponse(req, res, {
        runId: result.runId.toString(),
      });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

/*
 * "Load rows" for one piece of evidence in the investigation panel: re-runs
 * the query behind a report citation ([C#]) with the VIEWER's permissions.
 *
 * Trust model:
 *   - the caller must be an authenticated member of the request's tenant,
 *     and every read and the tool run are pinned to that tenant (never a
 *     project reached through the multi-tenant header): the toolbox checks
 *     the caller's grants in the tenant, so the query must run there too;
 *   - the subject is access-checked under the viewer's props before any
 *     other read, exactly like the routes above, and must belong to the
 *     tenant;
 *   - the run must be an Investigation of THAT subject in the tenant, so a
 *     citation of another subject's run cannot be replayed through a
 *     subject the viewer can read;
 *   - the tool and its arguments come from the run's own server-recorded
 *     events — never from the request body — and only read-only toolbox
 *     tools are re-runnable;
 *   - the tool executes under the viewer's props (the investigation itself
 *     ran as root), so the viewer only ever sees rows they may read.
 * Body: { subjectType: "incident" | "alert", subjectId,
 * investigationRunId (or its aiRunId alias), citationId: "C1" }.
 * Response: InvestigationEvidenceRowsResponse.
 */
router.post(
  "/ai-investigation/evidence",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);

      /*
       * The re-run executes a toolbox tool whose permission gate reads the
       * caller's grants in props.tenantId, so the caller must be a member of
       * that tenant and everything below happens inside it — never in a
       * project reached through the multi-tenant header.
       */
      const tenantId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);
      const viewerProps: DatabaseCommonInteractionProps =
        pinPropsToTenant(props);

      const subjectType: string | undefined = req.body["subjectType"] as
        | string
        | undefined;

      if (subjectType !== "incident" && subjectType !== "alert") {
        throw new BadDataException(
          'subjectType must be "incident" or "alert".',
        );
      }

      const subjectIdString: string =
        typeof req.body["subjectId"] === "string"
          ? (req.body["subjectId"] as string).trim()
          : "";

      if (!subjectIdString) {
        throw new BadDataException("subjectId is required.");
      }

      if (!ObjectID.isValidUUID(subjectIdString)) {
        throw new BadDataException("subjectId must be a valid ID.");
      }

      const subjectId: ObjectID = new ObjectID(subjectIdString);

      const investigationRunId: ObjectID = getDisplayedInvestigationRunId(req);

      const citationId: string =
        typeof req.body["citationId"] === "string"
          ? (req.body["citationId"] as string).trim()
          : "";

      if (!EVIDENCE_CITATION_ID_REGEX.test(citationId)) {
        throw new BadDataException(
          'citationId must be a citation marker such as "C1".',
        );
      }

      // Access check under the USER's permissions, inside the tenant.
      await assertSubjectReadableInTenant({
        subjectType,
        subjectId,
        tenantId,
        viewerProps,
      });

      const run: AIRun | null = await AIRunService.findOneBy({
        query: {
          _id: investigationRunId,
          projectId: tenantId,
          runType: AIRunType.Investigation,
          ...(subjectType === "incident"
            ? { triggeredByIncidentId: subjectId }
            : { triggeredByAlertId: subjectId }),
        },
        select: { _id: true },
        props: { isRoot: true },
      });

      if (!run) {
        throw new BadDataException(
          `This investigation was not found for this ${subjectType}.`,
        );
      }

      const events: Array<AIRunEvent> = await AIRunEventService.findBy({
        query: { aiRunId: investigationRunId, projectId: tenantId },
        select: {
          _id: true,
          sequence: true,
          eventType: true,
          toolName: true,
          toolArguments: true,
          resultSummary: true,
          citationId: true,
          createdAt: true,
        },
        sort: { sequence: SortOrder.Ascending },
        limit: MAX_EVENTS,
        skip: 0,
        props: { isRoot: true },
      });

      const rowsResponse: InvestigationEvidenceRowsResponse =
        await rerunInvestigationEvidence({
          events,
          citationId,
          tenantId,
          viewerProps,
        });

      Response.sendJsonObjectResponse(
        req,
        res,
        rowsResponse as unknown as JSONObject,
      );
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

/*
 * Human verdict capture (Phase 2 measurement layer): one-click Confirm /
 * Reject on the investigation panel. Applies to the exact COMPLETED
 * investigation run displayed to the user; overwriting is allowed (a user may
 * change their mind), and the request is rejected when no completed
 * investigation exists. The subject is access-checked under the USER's
 * permissions first (same idiom as the read routes above); the run itself is
 * written as root because investigation runs are system-authored.
 * Body: { subjectType: "incident" | "alert", subjectId,
 * aiRunId (or its investigationRunId alias), verdict: "Confirmed" |
 * "Rejected" }. The run id binds the mutation to the analysis currently
 * displayed. Response: { runId, verdict }.
 */
router.post(
  "/ai-investigation/verdict",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);

      const subjectType: string | undefined = req.body["subjectType"] as
        | string
        | undefined;

      if (subjectType !== "incident" && subjectType !== "alert") {
        throw new BadDataException(
          'subjectType must be "incident" or "alert".',
        );
      }

      const subjectIdString: string | undefined = req.body["subjectId"] as
        | string
        | undefined;

      if (!subjectIdString) {
        throw new BadDataException("subjectId is required.");
      }

      const subjectId: ObjectID = new ObjectID(subjectIdString);

      const investigationRunId: ObjectID = getDisplayedInvestigationRunId(req);

      const verdict: string | undefined = req.body["verdict"] as
        | string
        | undefined;

      if (
        verdict !== AIRunHumanVerdict.Confirmed &&
        verdict !== AIRunHumanVerdict.Rejected
      ) {
        throw new BadDataException(
          'verdict must be "Confirmed" or "Rejected".',
        );
      }

      // Access check under the USER's permissions (null when not allowed).
      let projectId: ObjectID | undefined = undefined;

      if (subjectType === "incident") {
        const incident: Incident | null = await IncidentService.findOneById({
          id: subjectId,
          select: { _id: true, projectId: true },
          props,
        });

        if (!incident || !incident.projectId) {
          throw new BadDataException(
            "Incident not found (or you do not have access to it).",
          );
        }

        projectId = incident.projectId;
      } else {
        const alert: Alert | null = await AlertService.findOneById({
          id: subjectId,
          select: { _id: true, projectId: true },
          props,
        });

        if (!alert || !alert.projectId) {
          throw new BadDataException(
            "Alert not found (or you do not have access to it).",
          );
        }

        projectId = alert.projectId;
      }

      const result: { runId: ObjectID; verdict: AIRunHumanVerdict } =
        await AIRunService.applyHumanVerdictToInvestigation({
          aiRunId: investigationRunId,
          projectId,
          ...(subjectType === "incident"
            ? { incidentId: subjectId }
            : { alertId: subjectId }),
          verdict: verdict as AIRunHumanVerdict,
          verdictByUserId: props.userId!,
        });

      Response.sendJsonObjectResponse(req, res, {
        runId: result.runId.toString(),
        verdict: result.verdict,
      });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

/*
 * Human-triggered `code_fix` (the FixFromIncident recipe): after a AI
 * investigation completes on an incident/alert, the user can ask the agent
 * to open a fix pull request from the posted analysis. The subject is
 * access-checked under the USER's permissions first (same idiom as the read
 * routes above); the trigger's gates (completed investigation, GitHub-App
 * repository, per-subject dedupe) fail early with a clear message.
 * Body: { subjectType: "incident" | "alert", subjectId,
 * aiRunId (or its investigationRunId alias) }. The run id rejects stale
 * clicks instead of silently switching to a newer analysis. Response:
 * { aiRunId } — the Queued CodeFix run the agent worker will claim.
 */
router.post(
  "/ai-investigation/create-fix-task",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);

      const subjectType: string | undefined = req.body["subjectType"] as
        | string
        | undefined;

      if (subjectType !== "incident" && subjectType !== "alert") {
        throw new BadDataException(
          'subjectType must be "incident" or "alert".',
        );
      }

      const subjectIdString: string | undefined = req.body["subjectId"] as
        | string
        | undefined;

      if (!subjectIdString) {
        throw new BadDataException("subjectId is required.");
      }

      const subjectId: ObjectID = new ObjectID(subjectIdString);

      const investigationRunId: ObjectID = getDisplayedInvestigationRunId(req);

      // Access check under the USER's permissions (null when not allowed).
      let projectId: ObjectID | undefined = undefined;

      if (subjectType === "incident") {
        const incident: Incident | null = await IncidentService.findOneById({
          id: subjectId,
          select: { _id: true, projectId: true },
          props,
        });

        if (!incident || !incident.projectId) {
          throw new BadDataException(
            "Incident not found (or you do not have access to it).",
          );
        }

        projectId = incident.projectId;
      } else {
        const alert: Alert | null = await AlertService.findOneById({
          id: subjectId,
          select: { _id: true, projectId: true },
          props,
        });

        if (!alert || !alert.projectId) {
          throw new BadDataException(
            "Alert not found (or you do not have access to it).",
          );
        }

        projectId = alert.projectId;
      }

      const run: AIRun =
        await FixFromIncidentTaskTrigger.createFixTaskFromInvestigation({
          projectId,
          ...(subjectType === "incident"
            ? { incidentId: subjectId }
            : { alertId: subjectId }),
          investigationRunId,
          userId: props.userId!,
        });

      Response.sendJsonObjectResponse(req, res, {
        aiRunId: run.id!.toString(),
      });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

/*
 * What the Remediation step of an incident's or alert's AI card says about
 * the fix in the code its investigation recommends
 * (Utils/Suggestions/InvestigationCodeFixSuggestion): the pull request being
 * written or done, the one setup step in the way, or ready to open - and
 * why OneUptime AI did not open it on its own
 * (FixFromIncidentTaskTrigger.getSuggestionForSubject). For whoever may read
 * the record, inside the tenant they asked in.
 * Body: { subjectType: "incident" | "alert", subjectId }. Response: the
 * InvestigationCodeFixSuggestion JSON (offer, fixOutcome, blocker, aiRunId,
 * isAutomatic, automaticBlocker).
 */
router.post(
  "/ai-investigation/code-fix-suggestion",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);
      const tenantId: ObjectID = CommonAPI.assertTenantScoped(props);
      const viewerProps: DatabaseCommonInteractionProps =
        pinPropsToTenant(props);

      const subjectType: unknown = req.body["subjectType"];

      if (subjectType !== "incident" && subjectType !== "alert") {
        throw new BadDataException(
          'subjectType must be "incident" or "alert".',
        );
      }

      const subjectIdRaw: unknown = req.body["subjectId"];

      if (
        typeof subjectIdRaw !== "string" ||
        !ObjectID.isValidUUID(subjectIdRaw.trim())
      ) {
        throw new BadDataException("subjectId must be a valid ID.");
      }

      const subjectId: ObjectID = new ObjectID(subjectIdRaw.trim());

      // Access check under the USER's permissions, inside the tenant.
      await assertSubjectReadableInTenant({
        subjectType,
        subjectId,
        tenantId,
        viewerProps,
      });

      const suggestion: InvestigationCodeFixSuggestion =
        await FixFromIncidentTaskTrigger.getSuggestionForSubject({
          projectId: tenantId,
          ...(subjectType === "incident"
            ? { incidentId: subjectId }
            : { alertId: subjectId }),
        });

      Response.sendJsonObjectResponse(
        req,
        res,
        investigationCodeFixSuggestionToJSON(suggestion),
      );
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

/*
 * What the trace page offers for one trace: "Fix performance with AI" with
 * the finding it would fix (Act), the one step in the way (SetUp: a
 * repository to connect, or what Code's gate says - the plan, AI credits, a
 * Runner online), a link to the fix already on its way (InProgress) or
 * already done (Done, with how it came out), or nothing (None). Decided by
 * FixPerformanceTaskTrigger.getSuggestionForTrace with the very gates the
 * create route below enforces, so the page never offers a fix the server
 * then refuses. The spans are read under the USER's permissions, and only
 * when AI is on. Body: { traceId }. Response: the
 * TracePerformanceFixSuggestion JSON (offer, finding, findingCount,
 * fixOutcome, blocker, aiRunId).
 */
router.post(
  "/ai-investigation/performance-fix-suggestion",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);

      const traceId: string | undefined = req.body["traceId"] as
        | string
        | undefined;

      if (!traceId) {
        throw new BadDataException("traceId is required.");
      }

      const projectId: ObjectID | undefined = props.tenantId;

      if (!projectId) {
        throw new BadDataException("A project scope is required.");
      }

      const suggestion: TracePerformanceFixSuggestion =
        await FixPerformanceTaskTrigger.getSuggestionForTrace({
          projectId,
          traceId,
          loadTrace: (): Promise<PerformanceTraceSpans> => {
            return FixPerformanceTaskTrigger.loadTraceSpans({
              traceId,
              props,
            });
          },
        });

      Response.sendJsonObjectResponse(
        req,
        res,
        tracePerformanceFixSuggestionToJSON(suggestion),
      );
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

/*
 * Human-triggered FixPerformance: from a slow trace, one click opens a
 * performance-fix PR grounded in deterministic span-tree evidence. The
 * spans are loaded under the USER's permissions (the same telemetry-read
 * ACL the trace explorer enforces — a user who cannot read the trace gets
 * "not found"), and the trigger's gates (AI on, a finding worth fixing, a
 * GitHub-App repository, per-trace dedupe, a fix that already did its
 * work, Code's gate, a repository to work in) fail early with a clear
 * message. Body: { traceId, repositoryId? } - the repository the person
 * picked when the suggestion listed repositories to pick from. Response:
 * { aiRunId } — the Queued CodeFix run the agent worker will claim.
 */
router.post(
  "/ai-investigation/create-performance-fix-task",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);

      const traceId: string | undefined = req.body["traceId"] as
        | string
        | undefined;

      if (!traceId) {
        throw new BadDataException("traceId is required.");
      }

      const projectId: ObjectID | undefined = props.tenantId;

      if (!projectId) {
        throw new BadDataException("A project scope is required.");
      }

      // The repository the person picked, when the page asked for one.
      const repositoryId: ObjectID | undefined = readPickedRepositoryId(
        req.body,
      );

      /*
       * Access check + data load in one: no spans back means the trace
       * does not exist or the user may not see it.
       */
      const trace: PerformanceTraceSpans =
        await FixPerformanceTaskTrigger.loadTraceSpans({ traceId, props });

      if (trace.spans.length === 0) {
        throw new BadDataException(
          "Trace not found (or you do not have access to it).",
        );
      }

      /*
       * Best-effort service attribution - only feeds the repository
       * name-match fallback, so null is fine.
       */
      const serviceName: string | undefined =
        await FixPerformanceTaskTrigger.getServiceName(trace.dominantEntityId);

      const run: AIRun =
        await FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace({
          projectId,
          traceId,
          spans: trace.spans,
          serviceName,
          userId: props.userId!,
          repositoryId,
        });

      Response.sendJsonObjectResponse(req, res, {
        aiRunId: run.id!.toString(),
      });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

// The longest window a profile fix reads, in days (the Profiler's longest).
const PROFILE_FIX_MAX_WINDOW_DAYS: number = 7;

/*
 * A profile window off the request: two ISO timestamps, in order, at most
 * PROFILE_FIX_MAX_WINDOW_DAYS apart.
 */
function readProfileWindow(
  rawStart: unknown,
  rawEnd: unknown,
  what: string,
): { startTime: Date; endTime: Date } {
  const startTime: Date | null =
    typeof rawStart === "string" ? new Date(rawStart) : null;
  const endTime: Date | null =
    typeof rawEnd === "string" ? new Date(rawEnd) : null;

  if (
    !startTime ||
    !endTime ||
    isNaN(startTime.getTime()) ||
    isNaN(endTime.getTime())
  ) {
    throw new BadDataException(
      `${what} needs a start and an end, as ISO timestamps.`,
    );
  }

  if (startTime.getTime() >= endTime.getTime()) {
    throw new BadDataException(`${what} must start before it ends.`);
  }

  if (
    endTime.getTime() - startTime.getTime() >
    PROFILE_FIX_MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ) {
    throw new BadDataException(
      `${what} can be at most ${PROFILE_FIX_MAX_WINDOW_DAYS} days long.`,
    );
  }

  return { startTime, endTime };
}

/*
 * The body both profile-fix routes take, read and checked the same way:
 * the project scope, the service, the function and its file, the kind of
 * profile and the window (and the window it was compared with). The
 * trigger reads the profile under the caller's own read scope.
 */
function readProfileFixRequest(
  req: ExpressRequest,
  props: DatabaseCommonInteractionProps,
): ProfileFixRequest {
  const projectId: ObjectID | undefined = props.tenantId;

  if (!projectId) {
    throw new BadDataException("A project scope is required.");
  }

  const body: JSONObject = (req.body as JSONObject) || {};
  const serviceId: unknown = body["serviceId"];

  if (typeof serviceId !== "string" || !ObjectID.isValidUUID(serviceId)) {
    throw new BadDataException("A valid serviceId is required.");
  }

  const functionName: unknown = body["functionName"];

  if (
    typeof functionName !== "string" ||
    functionName.length === 0 ||
    functionName.length > 1000
  ) {
    throw new BadDataException("functionName is required.");
  }

  const fileName: unknown = body["fileName"];

  if (
    fileName !== undefined &&
    fileName !== null &&
    (typeof fileName !== "string" || fileName.length > 1000)
  ) {
    throw new BadDataException("fileName must be text.");
  }

  const profileType: unknown = body["profileType"];

  if (
    profileType !== undefined &&
    profileType !== null &&
    (typeof profileType !== "string" || profileType.length > 64)
  ) {
    throw new BadDataException("profileType must be a kind of profile.");
  }

  const request: ProfileFixRequest = {
    projectId,
    props: pinPropsToTenant(props),
    serviceId: new ObjectID(serviceId),
    functionName,
    fileName: typeof fileName === "string" ? fileName : "",
    window: readProfileWindow(
      body["startTime"],
      body["endTime"],
      "The profile's time range",
    ),
  };

  if (typeof profileType === "string" && profileType.trim()) {
    request.profileType = profileType.trim();
  }

  if (
    body["beforeStartTime"] !== undefined ||
    body["beforeEndTime"] !== undefined
  ) {
    request.beforeWindow = readProfileWindow(
      body["beforeStartTime"],
      body["beforeEndTime"],
      "The time range it is compared with",
    );
  }

  return request;
}

/*
 * What the Profiler's function panel offers for "Fix with AI": the fix
 * (Act, with the repository the function's file is in, or the ones to pick
 * from), a set-up step in Code's own words (SetUp), the task already on its
 * way (InProgress), or nothing (None) - decided by the gates the create
 * route below enforces (ProfileFixTaskTrigger.getSuggestion), so the panel
 * never offers a fix the server then refuses.
 */
router.post(
  "/ai-investigation/profile-fix-suggestion",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);
      const request: ProfileFixRequest = readProfileFixRequest(req, props);

      const suggestion: ProfileFixSuggestion =
        await ProfileFixTaskTrigger.getSuggestion(request);

      Response.sendJsonObjectResponse(
        req,
        res,
        profileFixSuggestionToJSON(suggestion),
      );
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

/*
 * "Fix with AI" from the Profiler: a Code task in the repository that holds
 * the function, asking OneUptime AI to make it lighter, with the profile as
 * its context. Body: the suggestion's, plus the person's own words
 * (message), the repository they picked (repositoryId) when none was found
 * for certain, and the slow-code insight they asked from (insightId), when
 * they did - the task names it and the insight links the task. Response:
 * { taskId } - the task in Code.
 */
router.post(
  "/ai-investigation/create-profile-fix-task",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);
      const request: ProfileFixRequest = readProfileFixRequest(req, props);
      const body: JSONObject = (req.body as JSONObject) || {};

      const repositoryId: unknown = body["repositoryId"];

      if (
        repositoryId !== undefined &&
        repositoryId !== null &&
        (typeof repositoryId !== "string" ||
          !ObjectID.isValidUUID(repositoryId))
      ) {
        throw new BadDataException("repositoryId must be a repository's ID.");
      }

      const insightId: unknown = body["insightId"];

      if (
        insightId !== undefined &&
        insightId !== null &&
        (typeof insightId !== "string" || !ObjectID.isValidUUID(insightId))
      ) {
        throw new BadDataException("insightId must be an insight's ID.");
      }

      const created: { taskId: string } =
        await ProfileFixTaskTrigger.createFixTask({
          ...request,
          ...(typeof body["message"] === "string"
            ? { message: body["message"] as string }
            : {}),
          ...(typeof repositoryId === "string"
            ? { repositoryId: new ObjectID(repositoryId) }
            : {}),
          ...(typeof insightId === "string"
            ? { insightId: new ObjectID(insightId) }
            : {}),
        });

      Response.sendJsonObjectResponse(req, res, {
        taskId: created.taskId,
      });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

/*
 * The body both telemetry-improvement routes take, read and checked the
 * same way: the project scope, the service and the recipe, and the caller's
 * own read access to the service (the trigger re-reads as root afterwards).
 */
interface TelemetryImprovementRequest {
  projectId: ObjectID;
  telemetryServiceId: ObjectID;
  taskType: CodeFixTaskType;
}

async function readTelemetryImprovementRequest(
  req: ExpressRequest,
  props: DatabaseCommonInteractionProps,
): Promise<TelemetryImprovementRequest> {
  const projectId: ObjectID | undefined = props.tenantId;

  if (!projectId) {
    throw new BadDataException("A project scope is required.");
  }

  const telemetryServiceIdParam: string | undefined = req.body[
    "telemetryServiceId"
  ] as string | undefined;

  if (!telemetryServiceIdParam) {
    throw new BadDataException("telemetryServiceId is required.");
  }

  const rawTaskType: string | undefined = req.body["taskType"] as
    | string
    | undefined;

  if (
    rawTaskType !== CodeFixTaskType.ImproveLogging &&
    rawTaskType !== CodeFixTaskType.ImproveTracing
  ) {
    throw new BadDataException(
      `taskType must be ${CodeFixTaskType.ImproveLogging} or ${CodeFixTaskType.ImproveTracing}.`,
    );
  }

  const telemetryServiceId: ObjectID = new ObjectID(telemetryServiceIdParam);

  /*
   * Access check under the USER's permissions: the caller must be able to
   * read the service they are asking the agent to instrument.
   */
  const service: Service | null = await ServiceService.findOneById({
    id: telemetryServiceId,
    select: { _id: true },
    props: props,
  });

  if (!service) {
    throw new BadDataException(
      "Telemetry service not found (or you do not have access to it).",
    );
  }

  return { projectId, telemetryServiceId, taskType: rawTaskType };
}

/*
 * What a service's Logs or Traces page offers for "Improve logging / tracing
 * with AI": the card (Act), a link to the improvement already on its way
 * (InProgress), or nothing (None) - decided by the gates the create route
 * below enforces (TelemetryImprovementTaskTrigger.getSuggestion), so the
 * page never offers an improvement the server then refuses. Body:
 * { telemetryServiceId, taskType }. Response: { offer, aiRunId }.
 */
router.post(
  "/ai-investigation/telemetry-improvement-suggestion",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);
      const request: TelemetryImprovementRequest =
        await readTelemetryImprovementRequest(req, props);

      const suggestion: TelemetryImprovementSuggestion =
        await TelemetryImprovementTaskTrigger.getSuggestion(request);

      Response.sendJsonObjectResponse(
        req,
        res,
        telemetryImprovementSuggestionToJSON(suggestion),
      );
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

/*
 * "Improve logging / tracing with AI" from a telemetry service's Logs or
 * Traces page: gate and enqueue a service-scoped instrumentation-
 * improvement CodeFix run (ImproveLogging / ImproveTracing). Human-
 * triggered — the click is the gate; the AI switch, budget, repository,
 * per-service dedupe and Code's gate are enforced in the trigger. Returns
 * { aiRunId }.
 */
router.post(
  "/ai-investigation/create-telemetry-improvement-task",
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps = await getLoggedInProps(req);
      const request: TelemetryImprovementRequest =
        await readTelemetryImprovementRequest(req, props);

      const run: AIRun =
        await TelemetryImprovementTaskTrigger.createTelemetryImprovementTask({
          projectId: request.projectId,
          telemetryServiceId: request.telemetryServiceId,
          taskType: request.taskType,
          userId: props.userId!,
        });

      Response.sendJsonObjectResponse(req, res, {
        aiRunId: run.id!.toString(),
      });
      return;
    } catch (err) {
      next(err);
      return;
    }
  },
);

export default router;
