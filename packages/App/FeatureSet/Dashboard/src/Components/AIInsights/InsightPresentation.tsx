import AIInsightHumanVerdict from "Common/Types/AI/AIInsightHumanVerdict";
import { EMPTY_VALUE_MARK } from "Common/Types/EmptyValueMark";
import AIInsightSeverity from "Common/Types/AI/AIInsightSeverity";
import AIInsightStatus from "Common/Types/AI/AIInsightStatus";
import AIInsightType from "Common/Types/AI/AIInsightType";
import {
  AI_INSIGHT_SEVERITY_LABELS,
  AI_INSIGHT_STATUS_LABELS,
} from "Common/Types/AI/AIReadTableWords";
import IconProp from "Common/Types/Icon/IconProp";
import { CodeTaskSummaryJSON } from "Common/Types/AI/CodeTask";
import CodeTaskStageUtil from "Common/Types/AI/CodeTaskStage";
import CodeTaskStageBadge from "../Code/CodeTaskStageBadge";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Everything that decides how an insight LOOKS lives here — one label, one
 * glyph and one color per enum value — so the inbox list and the insight
 * detail page can never drift apart.
 *
 * The labels are English keys: the badges below translate them when they
 * are drawn, and a caller that shows a label itself translates it there.
 */

// Human labels for the wire-contract enum values (e.g. "NewException").
export const INSIGHT_TYPE_LABELS: Record<AIInsightType, string> = {
  [AIInsightType.NewException]: translationKey("New Exception"),
  [AIInsightType.ExceptionSpike]: translationKey("Exception Spike"),
  [AIInsightType.ErrorLogSpike]: translationKey("Error Log Spike"),
  [AIInsightType.TraceLatencyRegression]: translationKey("Latency Regression"),
  [AIInsightType.MetricDrift]: translationKey("Metric Drift"),
  [AIInsightType.DataDrift]: translationKey("Data Drift"),
  [AIInsightType.DeployRegression]: translationKey("Deploy Regression"),
  [AIInsightType.ProfileHotspot]: translationKey("Slow Code"),
  [AIInsightType.TraceSlowOperation]: translationKey("Slow Operation"),
  [AIInsightType.TraceFailingOperation]: translationKey("Failing Operation"),
  [AIInsightType.TraceMissingTracing]: translationKey("Missing Tracing"),
  [AIInsightType.ExceptionMissingStackTrace]: translationKey(
    "Missing Stack Trace",
  ),
  [AIInsightType.LogErrorPattern]: translationKey("Error Log"),
  [AIInsightType.LogMissingLogging]: translationKey("Missing Logging"),
  [AIInsightType.LogNoisyPattern]: translationKey("Noisy Log"),
  [AIInsightType.MetricHighCardinality]: translationKey("High Cardinality"),
  [AIInsightType.MetricHistogramBuckets]: translationKey(
    "Wrong Histogram Buckets",
  ),
  [AIInsightType.MetricMissingMetrics]: translationKey("Missing Metrics"),
  [AIInsightType.MetricMissingRequestMetrics]: translationKey(
    "Missing Request Metrics",
  ),
};

/*
 * Human labels for the wire-contract status values (e.g. "ActionRequired"):
 * one copy, in Common, so Ask AI's insights table says the same words
 * (Types/AI/AIReadTableWords, issue #8313).
 */
export const STATUS_LABELS: Record<AIInsightStatus, string> =
  AI_INSIGHT_STATUS_LABELS;

// The severity values are words too; this is how each one reads.
const SEVERITY_LABELS: Record<AIInsightSeverity, string> =
  AI_INSIGHT_SEVERITY_LABELS;

// A severity in the reader's language.
const SeverityLabel: FunctionComponent<{
  severity: AIInsightSeverity;
}> = (props: { severity: AIInsightSeverity }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <>
      {translator.translateText(
        SEVERITY_LABELS[props.severity] || props.severity,
      )}
    </>
  );
};

const SEVERITY_TONES: Record<AIInsightSeverity, PillTone> = {
  [AIInsightSeverity.High]: PillTone.Danger,
  [AIInsightSeverity.Medium]: PillTone.Warning,
  [AIInsightSeverity.Low]: PillTone.Info,
};

// The inline (badge-less) severity used in the dense list rows.
const SEVERITY_TEXT_CLASSES: Record<AIInsightSeverity, string> = {
  [AIInsightSeverity.High]: "text-red-700",
  [AIInsightSeverity.Medium]: "text-amber-700",
  [AIInsightSeverity.Low]: "text-blue-700",
};

const SEVERITY_DOT_CLASSES: Record<AIInsightSeverity, string> = {
  [AIInsightSeverity.High]: "bg-red-500",
  [AIInsightSeverity.Medium]: "bg-amber-500",
  [AIInsightSeverity.Low]: "bg-blue-500",
};

// The severity-tinted icon tile shown on each insight row.
const SEVERITY_TILE_CLASSES: Record<AIInsightSeverity, string> = {
  [AIInsightSeverity.High]: "bg-red-50 text-red-600",
  [AIInsightSeverity.Medium]: "bg-amber-50 text-amber-600",
  [AIInsightSeverity.Low]: "bg-blue-50 text-blue-600",
};

/*
 * ActionRequired is the attention state, FixOpened means the AI agent is on
 * it, the terminal human states are calm (green/gray), and Detected — a
 * transient state the scanner routes out of in the same tick — stays gray.
 */
const STATUS_TONES: Record<AIInsightStatus, PillTone> = {
  [AIInsightStatus.Detected]: PillTone.Neutral,
  [AIInsightStatus.ActionRequired]: PillTone.Warning,
  [AIInsightStatus.FixOpened]: PillTone.Info,
  [AIInsightStatus.Resolved]: PillTone.Success,
  [AIInsightStatus.Dismissed]: PillTone.Paused,
};

const STATUS_DOT_CLASSES: Record<AIInsightStatus, string> = {
  [AIInsightStatus.Detected]: "bg-gray-400",
  [AIInsightStatus.ActionRequired]: "bg-orange-500",
  [AIInsightStatus.FixOpened]: "bg-purple-500",
  [AIInsightStatus.Resolved]: "bg-green-500",
  [AIInsightStatus.Dismissed]: "bg-gray-400",
};

// Each detector gets its own glyph so a row is recognizable at a glance.
const INSIGHT_TYPE_ICONS: Record<AIInsightType, IconProp> = {
  [AIInsightType.NewException]: IconProp.Bug,
  [AIInsightType.ExceptionSpike]: IconProp.Fire,
  [AIInsightType.ErrorLogSpike]: IconProp.Logs,
  [AIInsightType.TraceLatencyRegression]: IconProp.Clock,
  [AIInsightType.MetricDrift]: IconProp.ArrowTrendingUp,
  [AIInsightType.DataDrift]: IconProp.Database,
  [AIInsightType.DeployRegression]: IconProp.CloudArrowUp,
  [AIInsightType.ProfileHotspot]: IconProp.Gauge,
  [AIInsightType.TraceSlowOperation]: IconProp.Waterfall,
  [AIInsightType.TraceFailingOperation]: IconProp.XCircle,
  [AIInsightType.TraceMissingTracing]: IconProp.EyeSlash,
  [AIInsightType.ExceptionMissingStackTrace]: IconProp.EyeSlash,
  [AIInsightType.LogErrorPattern]: IconProp.ExclaimationCircle,
  [AIInsightType.LogMissingLogging]: IconProp.DocumentMinus,
  [AIInsightType.LogNoisyPattern]: IconProp.SpeakerWave,
  [AIInsightType.MetricHighCardinality]: IconProp.Squares,
  [AIInsightType.MetricHistogramBuckets]: IconProp.ChartBar,
  [AIInsightType.MetricMissingMetrics]: IconProp.EyeSlash,
  [AIInsightType.MetricMissingRequestMetrics]: IconProp.SignalSlash,
};

export function getInsightTypeLabel(
  insightType: AIInsightType | undefined,
): string {
  if (!insightType) {
    return EMPTY_VALUE_MARK;
  }
  return INSIGHT_TYPE_LABELS[insightType] || insightType;
}

export function getStatusLabel(status: AIInsightStatus | undefined): string {
  if (!status) {
    return EMPTY_VALUE_MARK;
  }
  return STATUS_LABELS[status] || status;
}

export function getInsightTypeIcon(
  insightType: AIInsightType | undefined,
): IconProp {
  if (!insightType) {
    return IconProp.LightBulb;
  }
  return INSIGHT_TYPE_ICONS[insightType] || IconProp.LightBulb;
}

export function getSeverityTileClasses(
  severity: AIInsightSeverity | undefined,
): string {
  if (!severity) {
    return "bg-gray-100 text-gray-500";
  }
  return SEVERITY_TILE_CLASSES[severity] || "bg-gray-100 text-gray-500";
}

export function getStatusDotClasses(status: AIInsightStatus): string {
  return STATUS_DOT_CLASSES[status] || "bg-gray-400";
}

export function getInsightTypeElement(
  insightType: AIInsightType | undefined,
): ReactElement {
  if (!insightType) {
    return <></>;
  }
  return (
    <Pill
      text={getInsightTypeLabel(insightType)}
      tone={PillTone.Info}
      isDotHidden={true}
    />
  );
}

export function getSeverityElement(
  severity: AIInsightSeverity | undefined,
): ReactElement {
  if (!severity) {
    return <></>;
  }
  return (
    <Pill
      text={SEVERITY_LABELS[severity] || severity}
      tone={SEVERITY_TONES[severity] || PillTone.Neutral}
    />
  );
}

/*
 * The list-row severity: a colored dot and the word, with no pill around it.
 * A row already carries a status pill, and stacking a second pill next to it
 * is what turned the old card list into badge soup.
 */
export function getSeverityInlineElement(
  severity: AIInsightSeverity | undefined,
): ReactElement {
  if (!severity) {
    return <></>;
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-medium ${
        SEVERITY_TEXT_CLASSES[severity] || "text-gray-500"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          SEVERITY_DOT_CLASSES[severity] || "bg-gray-400"
        }`}
      />
      <SeverityLabel severity={severity} />
    </span>
  );
}

export function getStatusElement(
  status: AIInsightStatus | undefined,
  /*
   * The insight's fix task, when it was read: an insight with one says
   * where the task stands ("Task in progress", "Pull request open", "Task
   * failed") instead of only that it has one.
   */
  fixTask?: CodeTaskSummaryJSON | null | undefined,
): ReactElement {
  if (!status) {
    return <></>;
  }

  if (status === AIInsightStatus.FixOpened && fixTask) {
    return (
      <CodeTaskStageBadge
        stage={CodeTaskStageUtil.fromSummary(fixTask)}
        dataTestId="ai-insight-fix-status"
      />
    );
  }

  return (
    <Pill
      text={getStatusLabel(status)}
      tone={STATUS_TONES[status] || PillTone.Neutral}
    />
  );
}

export function getHumanVerdictElement(
  verdict: AIInsightHumanVerdict | undefined | null,
): ReactElement {
  if (verdict === AIInsightHumanVerdict.Confirmed) {
    return (
      <Pill text="Confirmed" tone={PillTone.Success} icon={IconProp.Check} />
    );
  }
  if (verdict === AIInsightHumanVerdict.Dismissed) {
    return (
      <Pill text="Dismissed" tone={PillTone.Paused} icon={IconProp.Close} />
    );
  }
  return <></>;
}
