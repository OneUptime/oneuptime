import AIInsightStatus, {
  AIInsightStatusHelper,
} from "Common/Types/AI/AIInsightStatus";
import AIInsightType from "Common/Types/AI/AIInsightType";
import {
  TelemetryAiLane,
  getTelemetryAiLaneOfInsightType,
} from "Common/Types/AI/TelemetryAi";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * "FIX WITH AI" ON A LANE'S FINDING - what the strip on a finding's page
 * says (TelemetryAiFixStrip), and which findings draw it. React-free, so
 * App's tests and the offline browser suite read these exact strings.
 *
 * The strip is the person's way to the pull request OneUptime AI would
 * open on its own: what an AI rule that asks before fixing leaves to them,
 * and what anyone may ask for on any open finding with no fix yet. The
 * server decides what it offers (POST /telemetry-ai/fix-suggestion) by the
 * gates its create route checks.
 */

/*
 * The lanes whose findings draw this strip: Traces and Metrics. The
 * Profiler's draw the Profiler's own Fix with AI (ProfileFixStrip), which
 * starts from the function rather than the finding.
 */
export const TELEMETRY_AI_FIX_LANES: ReadonlyArray<TelemetryAiLane> = [
  TelemetryAiLane.Trace,
  TelemetryAiLane.Metric,
];

/*
 * Whether a finding draws the strip: one of those lanes' kinds, still open,
 * with no fix linked yet - a finding with one links its task instead.
 */
export function doesInsightOfferTelemetryAiFix(insight: {
  insightType?: string | undefined;
  status?: AIInsightStatus | null | undefined;
  fixAiRunId?: unknown;
}): boolean {
  const lane: TelemetryAiLane | null = getTelemetryAiLaneOfInsightType(
    insight.insightType,
  );

  return (
    Boolean(lane && TELEMETRY_AI_FIX_LANES.includes(lane)) &&
    !insight.fixAiRunId &&
    Boolean(insight.status) &&
    !AIInsightStatusHelper.isTerminalStatus(insight.status as AIInsightStatus)
  );
}

// What Fix with AI does, said once above it, by kind of finding.
export const TELEMETRY_AI_FIX_LEADS: Readonly<
  Partial<Record<AIInsightType, string>>
> = {
  [AIInsightType.TraceSlowOperation]: translationKey(
    "OneUptime AI opens a pull request that makes this operation faster, for you to review.",
  ),
  [AIInsightType.TraceFailingOperation]: translationKey(
    "OneUptime AI opens a pull request that fixes why this operation fails, for you to review.",
  ),
  [AIInsightType.TraceMissingTracing]: translationKey(
    "OneUptime AI opens a pull request that adds the tracing this lacks, for you to review.",
  ),
  [AIInsightType.MetricHighCardinality]: translationKey(
    "OneUptime AI opens a pull request that stops recording these values on the metric, for you to review.",
  ),
  [AIInsightType.MetricHistogramBuckets]: translationKey(
    "OneUptime AI opens a pull request that gives this histogram buckets that fit its values, for you to review.",
  ),
  [AIInsightType.MetricMissingMetrics]: translationKey(
    "OneUptime AI opens a pull request that adds metrics to this service, for you to review.",
  ),
};

// When a finding's kind has no line of its own.
export const TELEMETRY_AI_FIX_LEAD: string = translationKey(
  "OneUptime AI opens a pull request that fixes this, for you to review.",
);

export function getTelemetryAiFixLead(insightType: unknown): string {
  return (
    TELEMETRY_AI_FIX_LEADS[insightType as AIInsightType] ||
    TELEMETRY_AI_FIX_LEAD
  );
}

// The strip's other words: the Profiler's, said the same way.
export const TELEMETRY_AI_FIX_COPY: {
  button: string;
  pickRepository: string;
  pickRepositoryPlaceholder: string;
  working: string;
  viewTask: string;
  couldNotStart: string;
  connectRepository: string;
} = {
  button: translationKey("Fix with AI"),
  pickRepository: translationKey("Which repository holds this code?"),
  pickRepositoryPlaceholder: translationKey("Pick a repository"),
  working: translationKey("OneUptime AI is working on it."),
  viewTask: translationKey("View the task"),
  couldNotStart: translationKey("Could not start the fix: {{reason}}"),
  connectRepository: translationKey("Connect a repository to fix this with AI"),
};

/*
 * How a Fix with AI strip lays out its picker and its button - this one and
 * the Profiler's (ProfileFixStrip). Side by side only where the strip itself
 * is wide enough for both (a container query, not the window's width): in
 * a finding page's narrow rail beside the evidence they stack, and the
 * button keeps its words on one line - side by side there at 1280 the
 * button was squeezed into "Fix / with / AI" and the picker into two lines.
 */
export const FIX_STRIP_ACTION_CONTAINER_CLASS_NAME: string =
  "[container-type:inline-size]";
export const FIX_STRIP_ACTION_ROW_CLASS_NAME: string =
  "flex flex-col gap-2 [@container(min-width:26rem)]:flex-row [@container(min-width:26rem)]:items-end";
export const FIX_STRIP_PICKER_CLASS_NAME: string =
  "w-full [@container(min-width:26rem)]:w-64";
export const FIX_STRIP_BUTTON_CLASS_NAME: string =
  "self-start whitespace-nowrap md:!ml-0 disabled:cursor-not-allowed disabled:opacity-50 [@container(min-width:26rem)]:self-end";

// The data-testids of the strip's parts.
export const TELEMETRY_AI_FIX_TEST_IDS: {
  strip: string;
  lead: string;
  button: string;
  repository: string;
  progress: string;
  taskLink: string;
  connect: string;
  error: string;
} = {
  strip: "telemetry-ai-fix",
  lead: "telemetry-ai-fix-lead",
  button: "telemetry-ai-fix-with-ai",
  repository: "telemetry-ai-fix-repository",
  progress: "telemetry-ai-fix-progress",
  taskLink: "telemetry-ai-fix-task-link",
  connect: "telemetry-ai-fix-connect",
  error: "telemetry-ai-fix-error",
};
