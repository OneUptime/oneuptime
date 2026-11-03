import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { DatabaseAlertTemplateCategory } from "Common/Types/Monitor/DatabaseAlertTemplates";
import {
  DATABASE_HEALTH_CATEGORY_TITLES,
  DatabaseHealthAssessment,
  DatabaseHealthFinding,
  DatabaseHealthSeverity,
  DatabaseHealthText,
} from "Common/Types/DatabaseServer/DatabaseHealth";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
} from "../../../Components/ResourcePart/ResourceAttention";
import { ResourceOverviewHealth } from "../../../Components/TelemetryResource/ResourceOverviewHealth";
import { RESOURCE_HEALTH_UNKNOWN_LABEL } from "../../../Components/TelemetryResource/ResourceHeroStatus";
import { formatRelativeTime } from "../../../Components/Home/HomeRelativeTime";

/*
 * HOW THE DATABASES PAGES SAY A DATABASE'S HEALTH.
 *
 * The rules are Common/Types/DatabaseServer/DatabaseHealth: its engine's
 * recommended alerts' lines, judged against what its engine last reported.
 * This turns their verdict into what the pages draw - the Overview's health
 * pill and its Needs attention rows, the Databases list's Status cell and
 * its Needs attention card - so every page says the same thing in the same
 * words.
 *
 * Plain logic, free of React, so App/Tests can read it.
 */

// What the health pill's (i) says it is judged by.
export const DATABASE_HEALTH_DESCRIPTION: string = translationKey(
  "Judged by the lines its engine's recommended alerts fire at - connections near the limit, a replica behind, memory near its limit, a restart and the rest - against what its engine last reported. Health Unknown while its engine metrics have stopped.",
);

// What the Databases list's Status column says, in an (i) beside its header.
export const DATABASE_STATUS_COLUMN_DESCRIPTION: string = translationKey(
  "Healthy, Degraded or Unhealthy by the lines its engine's recommended alerts fire at, with the first reason. Engine metrics stopped when its Database Agent or collector stopped sending, No engine metrics when none ever has, and Reporting when its engine has no recommended alerts.",
);

// The (i)'s own name beside the hero's health pill.
export const DATABASE_HEALTH_LABEL: string = translationKey("Database Health");

/*
 * Each finding's icon, by what it is about - the template categories the
 * alerts are grouped by on the Recommendations page.
 */
export const DATABASE_HEALTH_CATEGORY_ICONS: Record<
  DatabaseAlertTemplateCategory,
  IconProp
> = {
  Availability: IconProp.Heartbeat,
  Connections: IconProp.Link,
  Replication: IconProp.ArrowPath,
  Memory: IconProp.CPUChip,
  Performance: IconProp.Bolt,
  Storage: IconProp.Database,
};

// A database whose engine metrics stopped: what its row's icon says.
export const DATABASE_ENGINE_METRICS_STOPPED_ICON: IconProp =
  IconProp.SignalSlash;

function toAttentionSeverity(
  severity: DatabaseHealthSeverity,
): ResourceAttentionSeverity {
  return severity === DatabaseHealthSeverity.Critical
    ? ResourceAttentionSeverity.Critical
    : ResourceAttentionSeverity.Warning;
}

/*
 * The hero's health pill: Healthy, Degraded or Unhealthy by the rules,
 * "Health Unknown" while its engine metrics have stopped (what it reported
 * last is no longer the truth), and no pill at all when there is nothing to
 * judge - no engine metrics, or an engine without recommended alerts -
 * where "Healthy" would be a guess.
 */
export function getDatabaseHealthPill(
  assessment: DatabaseHealthAssessment,
): ResourceOverviewHealth | undefined {
  const pill: (
    label: string,
    tone: ResourceOverviewHealth["tone"],
  ) => ResourceOverviewHealth = (
    label: string,
    tone: ResourceOverviewHealth["tone"],
  ): ResourceOverviewHealth => {
    return {
      label: label,
      tone: tone,
      state: assessment.state,
      description: DATABASE_HEALTH_DESCRIPTION,
      descriptionLabel: DATABASE_HEALTH_LABEL,
    };
  };

  switch (assessment.state) {
    case "healthy":
      return pill(assessment.status.text, "positive");
    case "degraded":
      return pill(assessment.status.text, "warning");
    case "unhealthy":
      return pill(assessment.status.text, "danger");
    case "stopped":
      return pill(RESOURCE_HEALTH_UNKNOWN_LABEL, "neutral");
    default:
      return undefined;
  }
}

/*
 * The Overview's Needs attention: one row per category of what crossed a
 * line - Connections, Replication, Memory - named in the reader's language,
 * the most urgent first, each opening where its numbers are. A database
 * whose engine metrics stopped has one row, saying when they last arrived,
 * that opens its setup guide and diagnostic script.
 */
export function getDatabaseOwnAttentionItems(data: {
  assessment: DatabaseHealthAssessment;
  translator: Translator;
  metricsRoute: Route;
  documentationRoute: Route;
}): Array<ResourceAttentionItem> {
  return data.assessment.findings.map(
    (finding: DatabaseHealthFinding): ResourceAttentionItem => {
      const title: string = DATABASE_HEALTH_CATEGORY_TITLES[finding.category];
      const isStopped: boolean = finding.key === "engine-metrics";
      return {
        key: finding.key,
        kind: title,
        icon: isStopped
          ? DATABASE_ENGINE_METRICS_STOPPED_ICON
          : DATABASE_HEALTH_CATEGORY_ICONS[finding.category],
        name: data.translator.translateText(title) || title,
        severity: toAttentionSeverity(finding.severity),
        reasons: finding.reasons,
        lastReportAt: isStopped ? finding.lastReportAt : undefined,
        route: isStopped ? data.documentationRoute : data.metricsRoute,
      };
    },
  );
}

/*
 * The Needs attention row a list of databases gives one database: its name,
 * its engine, why (every reason, the most urgent first) and its page.
 */
export function getDatabaseFleetAttentionItem(data: {
  id: string;
  name: string;
  engineLabel: string;
  assessment: DatabaseHealthAssessment;
  route: Route;
}): ResourceAttentionItem | null {
  if (!data.assessment.severity) {
    return null;
  }
  const isStopped: boolean = data.assessment.state === "stopped";
  return {
    key: data.id,
    // The engine's own name ("PostgreSQL"), the same in every language.
    kind: data.engineLabel,
    kindAsWritten: true,
    icon: isStopped
      ? DATABASE_ENGINE_METRICS_STOPPED_ICON
      : DATABASE_HEALTH_CATEGORY_ICONS[
          data.assessment.findings[0]?.category || "Availability"
        ],
    name: data.name,
    severity: toAttentionSeverity(data.assessment.severity),
    reasons: data.assessment.reasons,
    lastReportAt:
      isStopped && data.assessment.lastReportAt
        ? data.assessment.lastReportAt
        : undefined,
    route: data.route,
  };
}

/*
 * The Databases list's Status cell, as ResourceStatusCell draws it: the
 * word in its colour, and under it why - the first reason, the rest
 * counted. A database whose engine metrics stopped says when they last
 * arrived instead of repeating its word.
 */
export interface DatabaseStatusCell {
  status: string;
  statusTone: "positive" | "warning" | "danger" | "neutral";
  statusText: DatabaseHealthText;
  statusReasons: Array<DatabaseHealthText>;
}

export const DATABASE_LAST_REPORTED: string = translationKey(
  "Last reported {{time}}",
);

export function getDatabaseStatusCell(data: {
  assessment: DatabaseHealthAssessment;
  language: string;
  now: Date;
}): DatabaseStatusCell {
  const assessment: DatabaseHealthAssessment = data.assessment;
  let reasons: Array<DatabaseHealthText> = assessment.reasons;

  if (assessment.state === "stopped") {
    reasons = assessment.lastReportAt
      ? [
          {
            text: DATABASE_LAST_REPORTED,
            values: {
              time: formatRelativeTime({
                date: assessment.lastReportAt,
                now: data.now,
                language: data.language,
              }),
            },
          },
        ]
      : [];
  }

  return {
    status: assessment.status.text,
    statusTone: assessment.tone,
    statusText: assessment.status,
    statusReasons: reasons,
  };
}
