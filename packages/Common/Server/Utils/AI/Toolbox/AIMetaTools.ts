import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIInsight from "../../../../Models/DatabaseModels/AIInsight";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Alert from "../../../../Models/DatabaseModels/Alert";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import BadDataException from "../../../../Types/Exception/BadDataException";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import Query from "../../../../Types/BaseDatabase/Query";
import OneUptimeDate from "../../../../Types/Date";
import AIRunType from "../../../../Types/AI/AIRunType";
import AIRunStatus, {
  AIRunStatusHelper,
} from "../../../../Types/AI/AIRunStatus";
import AIInsightStatus from "../../../../Types/AI/AIInsightStatus";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import AIRunService from "../../../Services/AIRunService";
import AIInsightService from "../../../Services/AIInsightService";
import IncidentService from "../../../Services/IncidentService";
import AlertService from "../../../Services/AlertService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import PostedRootCause from "../SRE/PostedRootCause";
import AIInvestigationQueue from "../SRE/InvestigationQueue";
import { DEFAULT_INCIDENT_DEDUPE_WINDOW_MINUTES } from "../SRE/IncidentInvestigationRunner";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import WidgetBuilder from "./WidgetBuilder";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

/*
 * AI meta tools — make the chat aware of OneUptime's OTHER AI lanes.
 *
 * The platform already runs autonomous investigations (cited RCAs posted to
 * incident/alert timelines) and preventive AI Insights (deterministic
 * detector findings with AI triage), but the chat could neither see them nor
 * start one — so it would happily re-derive a root cause from raw telemetry
 * that an investigation had already analyzed. These tools close that gap:
 *   - get_ai_investigation reads the investigation run(s) for one subject,
 *   - query_ai_insights lists recent preventive findings,
 *   - start_investigation enqueues a run through the SAME durable queue the
 *     automatic lanes use (AIInvestigationQueue), for subjects the automatic
 *     gates skipped.
 */

// How many investigation runs one get_ai_investigation call returns at most.
const MAX_INVESTIGATION_RUNS_RETURNED: number = 5;

/*
 * Detects the analysis' own "the evidence was inconclusive" verdict in the
 * posted prose/TL;DR. Purely informational (the note tells the model to be
 * honest about the uncertainty) — nothing operational branches on it, so a
 * false negative only omits a hint.
 */
const INCONCLUSIVE_RE: RegExp = /inconclusive/i;

/*
 * Derived from the model ACLs so the tool gates can never drift from RBAC.
 * Resolved lazily rather than at module load: this module is pulled in
 * through the service import graph before the model classes are fully wired
 * up, so calling a model method at import time throws a circular-dependency
 * TypeError. By the time a tool actually executes, every module is loaded.
 */
let cachedAiRunReadPermissions: Array<Permission> | null = null;
const resolveAiRunReadPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedAiRunReadPermissions) {
      cachedAiRunReadPermissions = new AIRun().getReadPermissions();
    }
    return cachedAiRunReadPermissions;
  };

let cachedAiInsightReadPermissions: Array<Permission> | null = null;
const resolveAiInsightReadPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedAiInsightReadPermissions) {
      cachedAiInsightReadPermissions = new AIInsight().getReadPermissions();
    }
    return cachedAiInsightReadPermissions;
  };

/*
 * AIRun rows are server-authored (empty create ACL), so gating the mutation
 * on AIRun.getCreatePermissions() would make it unrunnable. Starting an
 * investigation operates on the incident/alert (it posts an RCA to that
 * subject's timeline), so gate on the subject models' update ACLs — the same
 * proxy AIActionTools uses for page_on_call_policy.
 */
let cachedStartInvestigationPermissions: Array<Permission> | null = null;
const resolveStartInvestigationPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedStartInvestigationPermissions) {
      const combined: Array<Permission> = [
        ...new Incident().getUpdatePermissions(),
        ...new Alert().getUpdatePermissions(),
      ];
      cachedStartInvestigationPermissions = Array.from(new Set(combined));
    }
    return cachedStartInvestigationPermissions;
  };

/*
 * The incident/alert an investigation tool call is about, resolved UNDER THE
 * USER'S RBAC (ctx.props) — this is the tenancy + visibility check that lets
 * the isRoot reads inside PostedRootCause stay safe, and it rejects a
 * cross-project id outright.
 */
interface AIInvestigationSubject {
  incidentId: ObjectID | undefined;
  alertId: ObjectID | undefined;
  // "Incident #12" / "Alert #7" — falls back to the raw id when no number exists.
  label: string;
  citationType: AIChatCitationTargetType;
  citationParams: { [key: string]: string };
  // First affected monitor — the dedupe key the automatic investigation lanes record.
  monitorId: ObjectID | undefined;
}

const fetchInvestigationSubject: (
  incidentId: ObjectID | undefined,
  alertId: ObjectID | undefined,
  ctx: ToolContext,
) => Promise<AIInvestigationSubject | null> = async (
  incidentId: ObjectID | undefined,
  alertId: ObjectID | undefined,
  ctx: ToolContext,
): Promise<AIInvestigationSubject | null> => {
  if (incidentId) {
    const incident: Incident | null = await IncidentService.findOneById({
      id: incidentId,
      select: {
        _id: true,
        incidentNumber: true,
        monitors: {
          _id: true,
        },
      },
      props: ctx.props,
    });

    if (!incident) {
      return null;
    }

    const firstMonitorIdString: string | undefined =
      incident.monitors && incident.monitors.length > 0
        ? incident.monitors[0]?._id
        : undefined;

    return {
      incidentId: incidentId,
      alertId: undefined,
      label: incident.incidentNumber
        ? `Incident #${incident.incidentNumber}`
        : `Incident ${incidentId.toString()}`,
      citationType: AIChatCitationTargetType.IncidentView,
      citationParams: { incidentId: incidentId.toString() },
      monitorId: firstMonitorIdString
        ? new ObjectID(firstMonitorIdString)
        : undefined,
    };
  }

  if (alertId) {
    const alert: Alert | null = await AlertService.findOneById({
      id: alertId,
      select: {
        _id: true,
        alertNumber: true,
        monitorId: true,
      },
      props: ctx.props,
    });

    if (!alert) {
      return null;
    }

    return {
      incidentId: undefined,
      alertId: alertId,
      label: alert.alertNumber
        ? `Alert #${alert.alertNumber}`
        : `Alert ${alertId.toString()}`,
      citationType: AIChatCitationTargetType.AlertView,
      citationParams: { alertId: alertId.toString() },
      monitorId: alert.monitorId,
    };
  }

  return null;
};

/*
 * The AIRun rows that ARE the investigation lane for one incident/alert.
 * projectId is pinned to the tenant from ctx because the subject ids are
 * untrusted model arguments — same defense IncidentTools uses for its
 * owner join-table lookups.
 */
const buildSubjectRunQuery: (
  incidentId: ObjectID | undefined,
  alertId: ObjectID | undefined,
  ctx: ToolContext,
) => Query<AIRun> = (
  incidentId: ObjectID | undefined,
  alertId: ObjectID | undefined,
  ctx: ToolContext,
): Query<AIRun> => {
  if (incidentId) {
    return {
      projectId: ctx.projectId,
      runType: AIRunType.Investigation,
      triggeredByIncidentId: incidentId,
    };
  }

  if (alertId) {
    return {
      projectId: ctx.projectId,
      runType: AIRunType.Investigation,
      triggeredByAlertId: alertId,
    };
  }

  // Callers validate "exactly one of" before building the query.
  throw new BadDataException(
    "An investigation subject requires an incidentId or an alertId.",
  );
};

/*
 * ---------------------------------------------------------------------------
 * get_ai_investigation — the autonomous RCA for one incident/alert.
 * ---------------------------------------------------------------------------
 */
export const GetAIInvestigationTool: ObservabilityTool = {
  name: "get_ai_investigation",
  description:
    "Get the autonomous AI investigation (root cause analysis) for one incident or alert. ALWAYS call this FIRST — before re-deriving a root cause from raw telemetry — when the user asks about an incident or alert: an autonomous investigation may already have analyzed it and posted a cited RCA to its timeline. Pass exactly one of incidentId (from query_incidents) or alertId (from query_alerts). Returns the latest investigation runs with their status (Queued/Running/Completed/Error/Cancelled/Stale), the AI's TL;DR, the full posted root-cause analysis of the latest completed run, the code-fix recommendation, any human verdict and auto-grade, and started/completed timestamps. It also says honestly when the analysis was inconclusive (posted in quiet mode) or when no investigation exists — in which case you can offer start_investigation.",
  inputSchema: {
    type: "object",
    properties: {
      incidentId: {
        type: "string",
        description:
          "The incident's ID (find it with query_incidents). Pass exactly one of incidentId or alertId.",
      },
      alertId: {
        type: "string",
        description:
          "The alert's ID (find it with query_alerts). Pass exactly one of incidentId or alertId.",
      },
    },
  },
  get requiredPermissions(): Array<Permission> {
    return resolveAiRunReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const incidentId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "incidentId",
    );
    const alertId: ObjectID | undefined = ToolArgs.getObjectID(args, "alertId");

    if ((incidentId && alertId) || (!incidentId && !alertId)) {
      return {
        dataForLlm:
          "Error: pass exactly one of incidentId or alertId — an investigation belongs to a single incident OR a single alert.",
        rowCount: 0,
        citationLabel: "AI investigation (invalid arguments)",
        redactionCount: 0,
        isTruncated: false,
      };
    }

    const subject: AIInvestigationSubject | null =
      await fetchInvestigationSubject(incidentId, alertId, ctx);

    if (!subject) {
      return {
        dataForLlm: `Error: ${incidentId ? "incident" : "alert"} not found (or you do not have access to it).`,
        rowCount: 0,
        citationLabel: "AI investigation (subject not found)",
        redactionCount: 0,
        isTruncated: false,
      };
    }

    const runs: Array<AIRun> = await AIRunService.findBy({
      query: buildSubjectRunQuery(incidentId, alertId, ctx),
      select: {
        _id: true,
        status: true,
        analysisTldr: true,
        codeFixRecommendation: true,
        humanVerdict: true,
        autoGrade: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        attemptCount: true,
        errorMessage: true,
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
      limit: MAX_INVESTIGATION_RUNS_RETURNED,
      skip: 0,
      /*
       * Root props by design: AIRunPrivacyFilter pins non-root reads to
       * (runType=CodeFix OR userId=caller), and autonomous investigation
       * runs carry no userId — under user props this query matches zero
       * rows for every regular member, defeating the tool. Access is
       * already authorized above: the subject incident/alert was fetched
       * under the USER's props (honest not-found on no access), the query
       * pins projectId to the authenticated tenant, and the analysis this
       * returns is the same text the investigation posted to the incident
       * feed, which project members can read.
       */
      props: { isRoot: true },
    });

    if (runs.length === 0) {
      return {
        dataForLlm: `No AI investigation runs exist for ${subject.label}. The automatic gates may have skipped it (severity floor, dedupe window, the project's automatic-investigation opt-in, or the daily AI budget). You can offer to start one with start_investigation.`,
        rowCount: 0,
        citationLabel: `AI investigation for ${subject.label} (none found)`,
        citationTarget: {
          type: subject.citationType,
          params: subject.citationParams,
        },
        redactionCount: 0,
        isTruncated: false,
      };
    }

    /*
     * The posted RCA is the payload the model actually needs, and it lives
     * on the subject's feed (PostedRootCause is its single reader). Subject
     * visibility was already verified under the user's RBAC above, so the
     * isRoot read inside PostedRootCause cannot cross a tenant boundary.
     */
    const latestCompletedRun: AIRun | undefined = runs.find((run: AIRun) => {
      return run.status === AIRunStatus.Completed;
    });

    let postedAnalysis: string | null = null;
    if (latestCompletedRun && latestCompletedRun.id) {
      postedAnalysis = await PostedRootCause.getForInvestigation({
        incidentId: incidentId,
        alertId: alertId,
        aiRunId: latestCompletedRun.id,
        runCompletedAt: latestCompletedRun.completedAt,
      });
    }

    const rows: Array<JSONObject> = runs.map((run: AIRun) => {
      return {
        runId: run.id?.toString(),
        status: run.status,
        queuedAt: run.createdAt,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        attemptCount: run.attemptCount,
        analysisTldr: run.analysisTldr,
        codeFixRecommendation: run.codeFixRecommendation,
        humanVerdict: run.humanVerdict,
        autoGrade: run.autoGrade,
        errorMessage: run.errorMessage,
      };
    });

    // Tell the model plainly what state the LATEST run is in.
    const latestRun: AIRun = runs[0] as AIRun;
    let statusNote: string;
    switch (latestRun.status) {
      case AIRunStatus.Queued:
        statusNote =
          "The latest investigation is still QUEUED — no worker has claimed it yet. Check again shortly with get_ai_investigation.";
        break;
      case AIRunStatus.Running:
      case AIRunStatus.WaitingForApproval:
        statusNote =
          "The latest investigation is still RUNNING — its analysis has not been posted yet. Check again in a minute or two.";
        break;
      case AIRunStatus.Completed:
        statusNote = postedAnalysis
          ? "The latest investigation COMPLETED and posted the root cause analysis below. Use and cite it instead of re-deriving the analysis from raw telemetry (verify against current telemetry only where the user asks you to)."
          : "The latest investigation COMPLETED, but no posted analysis could be found on the timeline.";
        break;
      default:
        // Error / Cancelled / Stale — the row's errorMessage says why.
        statusNote =
          `The latest investigation did NOT produce an analysis (status: ${latestRun.status}). ${latestRun.errorMessage || ""}`.trim();
        break;
    }

    /*
     * Quiet-mode honesty: an inconclusive analysis is posted to the timeline
     * WITHOUT the loud workspace/on-call ping. Surface that so the model
     * repeats the uncertainty instead of presenting the hypothesis as fact.
     */
    const isInconclusive: boolean = INCONCLUSIVE_RE.test(
      `${latestCompletedRun?.analysisTldr || ""}\n${postedAnalysis || ""}`,
    );
    if (isInconclusive) {
      statusNote = `${statusNote} NOTE: the investigation reported the evidence was INCONCLUSIVE — it was posted in quiet mode (timeline only, no loud workspace notification). Be honest about that uncertainty.`;
    }

    const serializedRuns: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    const parts: Array<string> = [statusNote, serializedRuns.text];

    let analysisRedactionCount: number = 0;
    let analysisIsTruncated: boolean = false;
    if (postedAnalysis && latestCompletedRun) {
      const serializedAnalysis: SerializedResult =
        ToolResultSerializer.serializeText(postedAnalysis, 1);
      analysisRedactionCount = serializedAnalysis.redactionCount;
      analysisIsTruncated = serializedAnalysis.isTruncated;
      parts.push(
        `--- Posted root cause analysis (run ${latestCompletedRun.id?.toString()}) ---\n${serializedAnalysis.text}`,
      );
    }

    return {
      dataForLlm: parts.join("\n\n"),
      rowCount: serializedRuns.rowCount,
      citationLabel: `AI investigation for ${subject.label} (${runs.length} ${runs.length === 1 ? "run" : "runs"})`,
      citationTarget: {
        type: subject.citationType,
        params: subject.citationParams,
      },
      redactionCount: serializedRuns.redactionCount + analysisRedactionCount,
      isTruncated: serializedRuns.isTruncated || analysisIsTruncated,
      widget: WidgetBuilder.table({
        title: `AI investigations — ${subject.label}`,
        columns: [
          { key: "status", title: "Status" },
          { key: "analysisTldr", title: "TL;DR" },
          { key: "startedAt", title: "Started", type: "date" },
          { key: "completedAt", title: "Completed", type: "date" },
        ],
        rows: rows,
        link: {
          type: subject.citationType,
          params: subject.citationParams,
        },
      }),
    };
  },
};

/*
 * ---------------------------------------------------------------------------
 * query_ai_insights — recent preventive findings ("any early warnings?").
 * ---------------------------------------------------------------------------
 */
export const QueryAIInsightsTool: ObservabilityTool = {
  name: "query_ai_insights",
  description:
    "List recent AI Insights — preventive findings from OneUptime AI's deterministic telemetry sensors (new/spiking exceptions, error-log spikes, trace-latency regressions, metric drift), each optionally triaged by AI. Use this to answer 'any early warnings for this service?' or to correlate an incident with warnings that pre-dated it. Optional filters: serviceId (a telemetry service id) and status (Detected, ActionRequired, FixOpened, Resolved, Dismissed). Returns each insight's type, severity, status, AI triage classification and summary, affected service and first/last-seen times, most recently seen first (default: seen in the last 7 days).",
  inputSchema: {
    type: "object",
    properties: {
      serviceId: {
        type: "string",
        description:
          "Only insights about this telemetry service (optional). Find service ids with lookup_context.",
      },
      status: {
        type: "string",
        description:
          "Only insights in this status (optional). One of: Detected, ActionRequired, FixOpened, Resolved, Dismissed.",
      },
      lookbackDays: {
        type: "number",
        description:
          "Only insights last seen within this many days (default 7, max 90).",
      },
      limit: {
        type: "number",
        description: "Maximum insights to return (default 10, max 25).",
      },
      skip: {
        type: "number",
        description: "Rows to skip for pagination (default 0).",
      },
    },
  },
  get requiredPermissions(): Array<Permission> {
    return resolveAiInsightReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const statusArg: string | undefined = ToolArgs.getString(args, "status");
    let statusFilter: AIInsightStatus | undefined = undefined;

    if (statusArg) {
      statusFilter = Object.values(AIInsightStatus).find(
        (value: AIInsightStatus) => {
          return value.toLowerCase() === statusArg.toLowerCase();
        },
      );

      if (!statusFilter) {
        return {
          dataForLlm: `Error: status "${statusArg}" is not a valid AI insight status. Valid statuses: ${Object.values(
            AIInsightStatus,
          ).join(", ")}.`,
          rowCount: 0,
          citationLabel: "AI insights (invalid status filter)",
          redactionCount: 0,
          isTruncated: false,
        };
      }
    }

    const serviceId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "serviceId",
    );
    const lookbackDays: number = ToolArgs.getNumber(args, "lookbackDays", {
      defaultValue: 7,
      min: 1,
      max: 90,
    });
    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 10,
      min: 1,
      max: 25,
    });
    const skip: number = ToolArgs.getNumber(args, "skip", {
      defaultValue: 0,
      min: 0,
      max: 500,
    });

    const endTime: Date = OneUptimeDate.getCurrentDate();
    const startTime: Date = OneUptimeDate.getSomeDaysAgo(lookbackDays);

    /*
     * lastSeenAt (not createdAt): a finding first detected weeks ago that
     * the scanner is STILL re-detecting today is exactly the live early
     * warning this tool exists to surface.
     */
    const query: Query<AIInsight> = {
      projectId: ctx.projectId,
      lastSeenAt: QueryHelper.inBetween(startTime, endTime),
    };
    if (serviceId) {
      query.telemetryServiceId = serviceId;
    }
    if (statusFilter) {
      query.status = statusFilter;
    }

    const totalCount: number = (
      await AIInsightService.countBy({
        query: query,
        props: ctx.props,
      })
    ).toNumber();

    const insights: Array<AIInsight> = await AIInsightService.findBy({
      query: query,
      select: {
        _id: true,
        insightType: true,
        status: true,
        severity: true,
        classification: true,
        title: true,
        serviceName: true,
        telemetryServiceId: true,
        metricName: true,
        occurrenceCount: true,
        firstSeenAt: true,
        lastSeenAt: true,
        triageSummaryMarkdown: true,
        humanVerdict: true,
      },
      sort: {
        lastSeenAt: SortOrder.Descending,
      },
      limit: limit,
      skip: skip,
      props: ctx.props,
    });

    const rows: Array<JSONObject> = insights.map((insight: AIInsight) => {
      return {
        id: insight.id?.toString(),
        insightType: insight.insightType,
        status: insight.status,
        severity: insight.severity,
        classification: insight.classification,
        title: insight.title,
        serviceName: insight.serviceName,
        telemetryServiceId: insight.telemetryServiceId?.toString(),
        metricName: insight.metricName,
        occurrenceCount: insight.occurrenceCount,
        firstSeenAt: insight.firstSeenAt,
        lastSeenAt: insight.lastSeenAt,
        humanVerdict: insight.humanVerdict,
        triageSummary: insight.triageSummaryMarkdown,
      };
    });

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    let dataForLlm: string = serialized.text;
    if (rows.length > 0 && totalCount > rows.length) {
      dataForLlm = `Showing rows ${skip + 1}–${skip + rows.length} of ${totalCount} total. Pass skip to page further.\n${dataForLlm}`;
    }

    // No dedicated dashboard page target exists for insights — no deep link.
    return {
      dataForLlm: dataForLlm,
      rowCount: serialized.rowCount,
      citationLabel: `AI insights, last ${lookbackDays}d (${totalCount} found)`,
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.table({
              title: `AI insights (${totalCount})`,
              description: `Preventive findings seen in the last ${lookbackDays}d`,
              columns: [
                { key: "severity", title: "Severity" },
                { key: "title", title: "Finding" },
                { key: "serviceName", title: "Service" },
                { key: "status", title: "Status" },
                { key: "classification", title: "Triage" },
                { key: "lastSeenAt", title: "Last seen", type: "date" },
              ],
              rows: rows,
            })
          : undefined,
    };
  },
};

/*
 * ---------------------------------------------------------------------------
 * start_investigation — enqueue an AI RCA the automatic gates skipped.
 * ---------------------------------------------------------------------------
 */
export const StartInvestigationTool: ObservabilityTool = {
  name: "start_investigation",
  description:
    "Start (enqueue) an autonomous AI investigation for one incident or alert. Use this when get_ai_investigation shows no investigation exists — the automatic gates (severity floor, dedupe window) may have skipped the subject — and the user wants an AI root cause analysis. Pass exactly one of incidentId (from query_incidents) or alertId (from query_alerts). The run is queued durably, usually completes within a few minutes, and posts a cited RCA to the subject's timeline. If an investigation is already queued/running for the subject, or one was started within the last 30 minutes, no duplicate is started and the result says so. Read the outcome with get_ai_investigation.",
  inputSchema: {
    type: "object",
    properties: {
      incidentId: {
        type: "string",
        description:
          "The incident's ID to investigate (find it with query_incidents). Pass exactly one of incidentId or alertId.",
      },
      alertId: {
        type: "string",
        description:
          "The alert's ID to investigate (find it with query_alerts). Pass exactly one of incidentId or alertId.",
      },
    },
  },
  get requiredPermissions(): Array<Permission> {
    return resolveStartInvestigationPermissions();
  },
  isMutation: true,
  buildActionTitle: (args: JSONObject): string => {
    const incidentId: string | undefined = ToolArgs.getString(
      args,
      "incidentId",
    );
    if (incidentId) {
      return `Start AI investigation for incident ${incidentId}`;
    }

    const alertId: string | undefined = ToolArgs.getString(args, "alertId");
    if (alertId) {
      return `Start AI investigation for alert ${alertId}`;
    }

    return "Start AI investigation";
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const incidentId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "incidentId",
    );
    const alertId: ObjectID | undefined = ToolArgs.getObjectID(args, "alertId");

    if ((incidentId && alertId) || (!incidentId && !alertId)) {
      throw new BadDataException(
        "Pass exactly one of incidentId or alertId — an investigation belongs to a single incident OR a single alert.",
      );
    }

    const subject: AIInvestigationSubject | null =
      await fetchInvestigationSubject(incidentId, alertId, ctx);

    if (!subject) {
      throw new BadDataException(
        `${incidentId ? "Incident" : "Alert"} not found (or you do not have access to it).`,
      );
    }

    const subjectRunQuery: Query<AIRun> = buildSubjectRunQuery(
      incidentId,
      alertId,
      ctx,
    );

    /*
     * Per-subject dedupe, mirrored from the automatic lanes but keyed on the
     * exact entity: never stack a second live run on the same subject.
     * (The severity floor is deliberately NOT applied — an explicit user
     * request overrides that automatic cost gate.)
     */
    const activeRunCount: number = (
      await AIRunService.countBy({
        query: {
          ...subjectRunQuery,
          status: QueryHelper.notIn(AIRunStatusHelper.terminalStatuses()),
        },
        /*
         * Root props: investigation runs carry no userId, so the AIRun
         * privacy pin would zero this count for regular members and the
         * dedupe guard would never fire (see get_ai_investigation for the
         * full rationale — subject access was checked under user props and
         * the query pins projectId).
         */
        props: { isRoot: true },
      })
    ).toNumber();

    if (activeRunCount > 0) {
      return {
        dataForLlm: `An AI investigation is already queued or running for ${subject.label} — not starting another. Follow it with get_ai_investigation.`,
        rowCount: 0,
        citationLabel: `Investigation already in progress for ${subject.label}`,
        citationTarget: {
          type: subject.citationType,
          params: subject.citationParams,
        },
        redactionCount: 0,
        isTruncated: false,
      };
    }

    /*
     * Cooldown: reuse the automatic lane's default dedupe window (30
     * minutes). A run that recently settled for this exact subject already
     * answered — or errored on — the same question; point the model at it
     * instead of double-spending the budget.
     */
    const cooldownStart: Date = OneUptimeDate.getSomeMinutesAgo(
      DEFAULT_INCIDENT_DEDUPE_WINDOW_MINUTES,
    );
    const recentRunCount: number = (
      await AIRunService.countBy({
        query: {
          ...subjectRunQuery,
          createdAt: QueryHelper.greaterThan(cooldownStart),
        },
        // Root props for the same reason as the active-run guard above.
        props: { isRoot: true },
      })
    ).toNumber();

    if (recentRunCount > 0) {
      return {
        dataForLlm: `A recent AI investigation already exists for ${subject.label} (started within the last ${DEFAULT_INCIDENT_DEDUPE_WINDOW_MINUTES} minutes) — not starting a duplicate. Read it with get_ai_investigation.`,
        rowCount: 0,
        citationLabel: `Recent investigation exists for ${subject.label}`,
        citationTarget: {
          type: subject.citationType,
          params: subject.citationParams,
        },
        redactionCount: 0,
        isTruncated: false,
      };
    }

    /*
     * The SAME durable enqueue path the automatic lanes use: an AIRun in
     * status Queued that the worker poller claims (with an inline kick for
     * happy-path latency). projectId comes from ctx — never from an
     * argument. enqueue never throws; null means the daily autonomous AI
     * budget quiet-skipped it or the enqueue failed.
     */
    const enqueuedRunId: ObjectID | null = await AIInvestigationQueue.enqueue({
      projectId: ctx.projectId,
      subjectIncidentId: incidentId,
      subjectAlertId: alertId,
      subjectMonitorId: subject.monitorId,
    });

    if (!enqueuedRunId) {
      return {
        dataForLlm: `The investigation for ${subject.label} could not be enqueued — the project's daily autonomous AI token budget may be exhausted, or the enqueue failed. Try again later.`,
        rowCount: 0,
        citationLabel: `Investigation not enqueued for ${subject.label}`,
        citationTarget: {
          type: subject.citationType,
          params: subject.citationParams,
        },
        redactionCount: 0,
        isTruncated: false,
      };
    }

    const serialized: SerializedResult = ToolResultSerializer.serializeRows([
      {
        runId: enqueuedRunId.toString(),
        subject: subject.label,
        status: AIRunStatus.Queued,
      },
    ]);

    return {
      dataForLlm: `Queued AI investigation run ${enqueuedRunId.toString()} for ${subject.label}. It usually completes within a few minutes and posts a cited root-cause analysis to the ${incidentId ? "incident" : "alert"} timeline. Read the result with get_ai_investigation.\n${serialized.text}`,
      rowCount: 1,
      citationLabel: `AI investigation queued for ${subject.label}`,
      citationTarget: {
        type: subject.citationType,
        params: subject.citationParams,
      },
      redactionCount: serialized.redactionCount,
      isTruncated: false,
      widget: WidgetBuilder.resourceCard({
        title: "AI investigation queued",
        resourceType: "AIRun",
        heading: subject.label,
        subheading: "Investigation queued",
        fields: [
          { label: "Run", value: enqueuedRunId.toString() },
          { label: "Subject", value: subject.label },
        ],
        link: {
          type: subject.citationType,
          params: subject.citationParams,
        },
      }),
    };
  },
};
