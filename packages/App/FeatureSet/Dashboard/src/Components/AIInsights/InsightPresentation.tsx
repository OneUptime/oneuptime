import AIInsightHumanVerdict from "Common/Types/AI/AIInsightHumanVerdict";
import AIInsightSeverity from "Common/Types/AI/AIInsightSeverity";
import AIInsightStatus from "Common/Types/AI/AIInsightStatus";
import AIInsightType from "Common/Types/AI/AIInsightType";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { ReactElement } from "react";

/*
 * Everything that decides how an insight LOOKS lives here — one label, one
 * glyph and one color per enum value — so the inbox list and the insight
 * detail page can never drift apart.
 */

// Human labels for the wire-contract enum values (e.g. "NewException").
export const INSIGHT_TYPE_LABELS: Record<AIInsightType, string> = {
  [AIInsightType.NewException]: "New Exception",
  [AIInsightType.ExceptionSpike]: "Exception Spike",
  [AIInsightType.ErrorLogSpike]: "Error Log Spike",
  [AIInsightType.TraceLatencyRegression]: "Latency Regression",
  [AIInsightType.MetricDrift]: "Metric Drift",
};

// Human labels for the wire-contract status values (e.g. "ActionRequired").
export const STATUS_LABELS: Record<AIInsightStatus, string> = {
  [AIInsightStatus.Detected]: "Detected",
  [AIInsightStatus.ActionRequired]: "Needs Attention",
  [AIInsightStatus.FixOpened]: "Fix Opened",
  [AIInsightStatus.Resolved]: "Resolved",
  [AIInsightStatus.Dismissed]: "Dismissed",
};

const SEVERITY_BADGE_CLASSES: Record<AIInsightSeverity, string> = {
  [AIInsightSeverity.High]: "bg-red-50 text-red-700 ring-red-600/20",
  [AIInsightSeverity.Medium]: "bg-amber-50 text-amber-700 ring-amber-600/20",
  [AIInsightSeverity.Low]: "bg-blue-50 text-blue-700 ring-blue-600/20",
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
const STATUS_BADGE_CLASSES: Record<AIInsightStatus, string> = {
  [AIInsightStatus.Detected]: "bg-gray-100 text-gray-600 ring-gray-500/20",
  [AIInsightStatus.ActionRequired]:
    "bg-orange-50 text-orange-700 ring-orange-600/20",
  [AIInsightStatus.FixOpened]:
    "bg-purple-50 text-purple-700 ring-purple-600/20",
  [AIInsightStatus.Resolved]: "bg-green-50 text-green-700 ring-green-600/20",
  [AIInsightStatus.Dismissed]: "bg-gray-100 text-gray-600 ring-gray-500/20",
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
};

export function getInsightTypeLabel(
  insightType: AIInsightType | undefined,
): string {
  if (!insightType) {
    return "-";
  }
  return INSIGHT_TYPE_LABELS[insightType] || insightType;
}

export function getStatusLabel(status: AIInsightStatus | undefined): string {
  if (!status) {
    return "-";
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
    <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-600/20">
      {getInsightTypeLabel(insightType)}
    </span>
  );
}

export function getSeverityElement(
  severity: AIInsightSeverity | undefined,
): ReactElement {
  if (!severity) {
    return <></>;
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
        SEVERITY_BADGE_CLASSES[severity] ||
        "bg-gray-100 text-gray-600 ring-gray-500/20"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          SEVERITY_DOT_CLASSES[severity] || "bg-gray-400"
        }`}
      />
      {severity}
    </span>
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
      {severity}
    </span>
  );
}

export function getStatusElement(
  status: AIInsightStatus | undefined,
): ReactElement {
  if (!status) {
    return <></>;
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
        STATUS_BADGE_CLASSES[status] ||
        "bg-gray-100 text-gray-600 ring-gray-500/20"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          STATUS_DOT_CLASSES[status] || "bg-gray-400"
        }`}
      />
      {getStatusLabel(status)}
    </span>
  );
}

export function getHumanVerdictElement(
  verdict: AIInsightHumanVerdict | undefined | null,
): ReactElement {
  if (verdict === AIInsightHumanVerdict.Confirmed) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">
        <Icon icon={IconProp.Check} className="h-3 w-3" />
        Confirmed
      </span>
    );
  }
  if (verdict === AIInsightHumanVerdict.Dismissed) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-500/20">
        <Icon icon={IconProp.Close} className="h-3 w-3" />
        Dismissed
      </span>
    );
  }
  return <></>;
}
