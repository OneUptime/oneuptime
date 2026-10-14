import { HomeCounts } from "./HomeOverviewData";
import IconProp from "Common/Types/Icon/IconProp";
import {
  PluralTemplate,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The one-line answer Home leads with: is anything wrong in this project,
 * and if so, how badly. The strip under it has the five numbers; this picks
 * the one that matters most and says it in words.
 *
 * Pure, so every combination of counts can be tested without a renderer.
 * The copy is English, looked up where it is drawn (ProjectHealthCard), so a
 * language switch re-renders it.
 */

export enum ProjectHealthKind {
  // At least one incident is open: users are affected.
  Incidents = "incidents",
  // No incident, but alerts, monitors or SLOs need someone to look.
  NeedsAttention = "needs-attention",
  // Nothing is wrong, and maintenance is in progress.
  Maintenance = "maintenance",
  // Monitors exist, and nothing is open.
  Operational = "operational",
  // Nothing is monitored yet, and nothing is open.
  NotSetUp = "not-set-up",
}

export enum ProjectHealthTone {
  Danger = "danger",
  Warning = "warning",
  Info = "info",
  Success = "success",
  Neutral = "neutral",
}

/*
 * Copy that is either fixed or depends on a count. A fixed sentence is never
 * written as a plural: a language whose "one" form also covers 21 (Russian)
 * would otherwise be handed an English "one" sentence that cannot be right.
 */
export type ProjectHealthText =
  | { text: string }
  | { plural: PluralTemplate; count: number };

export interface ProjectHealth {
  kind: ProjectHealthKind;
  tone: ProjectHealthTone;
  icon: IconProp;
  headline: ProjectHealthText;
  summary: ProjectHealthText;
}

export const INCIDENTS_HEADLINE: PluralTemplate = {
  one: "{{count}} active incident",
  other: "{{count}} active incidents",
};

export const INCIDENTS_SUMMARY: string = translationKey(
  "Your users are affected. Open an incident to see who is responding and to post updates.",
);

export const NEEDS_ATTENTION_HEADLINE: PluralTemplate = {
  one: "{{count}} issue needs attention",
  other: "{{count}} issues need attention",
};

export const NEEDS_ATTENTION_SUMMARY: string = translationKey(
  "No incident is open, but your team should take a look before users notice.",
);

export const MAINTENANCE_HEADLINE: PluralTemplate = {
  one: "{{count}} maintenance event in progress",
  other: "{{count}} maintenance events in progress",
};

export const MAINTENANCE_SUMMARY: string = translationKey(
  "Everything else is operational, and there are no open incidents or alerts.",
);

export const OPERATIONAL_HEADLINE: string = translationKey(
  "All systems operational",
);

export const OPERATIONAL_SUMMARY: PluralTemplate = {
  one: "{{count}} monitor is operational, and there are no open incidents or alerts.",
  other:
    "{{count}} monitors are operational, and there are no open incidents or alerts.",
};

export const NOT_SET_UP_HEADLINE: string = translationKey(
  "Nothing is being monitored yet",
);

export const NOT_SET_UP_SUMMARY: string = translationKey(
  "Create a monitor and OneUptime will check your website, API or server around the clock, and tell you the moment something goes wrong.",
);

/*
 * Alerts, monitors that are not operational and SLOs whose budget is burning:
 * the problems for the team, not yet for users. The strip shows each.
 */
export const getIssuesNeedingAttentionCount: (counts: HomeCounts) => number = (
  counts: HomeCounts,
): number => {
  return (
    Math.max(0, counts.activeAlerts) +
    Math.max(0, counts.notOperationalMonitors) +
    Math.max(0, counts.slosNeedingAttention)
  );
};

export const getProjectHealth: (counts: HomeCounts) => ProjectHealth = (
  counts: HomeCounts,
): ProjectHealth => {
  const activeIncidents: number = Math.max(0, counts.activeIncidents);

  if (activeIncidents > 0) {
    return {
      kind: ProjectHealthKind.Incidents,
      tone: ProjectHealthTone.Danger,
      icon: IconProp.Alert,
      headline: { plural: INCIDENTS_HEADLINE, count: activeIncidents },
      summary: { text: INCIDENTS_SUMMARY },
    };
  }

  const issues: number = getIssuesNeedingAttentionCount(counts);

  if (issues > 0) {
    return {
      kind: ProjectHealthKind.NeedsAttention,
      tone: ProjectHealthTone.Warning,
      icon: IconProp.ExclaimationCircle,
      headline: { plural: NEEDS_ATTENTION_HEADLINE, count: issues },
      summary: { text: NEEDS_ATTENTION_SUMMARY },
    };
  }

  const ongoingMaintenance: number = Math.max(0, counts.ongoingMaintenance);

  if (ongoingMaintenance > 0) {
    return {
      kind: ProjectHealthKind.Maintenance,
      tone: ProjectHealthTone.Info,
      icon: IconProp.Clock,
      headline: { plural: MAINTENANCE_HEADLINE, count: ongoingMaintenance },
      summary: { text: MAINTENANCE_SUMMARY },
    };
  }

  const totalMonitors: number = Math.max(0, counts.totalMonitors);

  /*
   * "All systems operational" over zero monitors would read as though
   * something were watching and had found nothing wrong - the wrong
   * impression for someone who has not created a monitor. Say so instead.
   */
  if (totalMonitors === 0) {
    return {
      kind: ProjectHealthKind.NotSetUp,
      tone: ProjectHealthTone.Neutral,
      icon: IconProp.AltGlobe,
      headline: { text: NOT_SET_UP_HEADLINE },
      summary: { text: NOT_SET_UP_SUMMARY },
    };
  }

  return {
    kind: ProjectHealthKind.Operational,
    tone: ProjectHealthTone.Success,
    icon: IconProp.CheckCircle,
    headline: { text: OPERATIONAL_HEADLINE },
    summary: { plural: OPERATIONAL_SUMMARY, count: totalMonitors },
  };
};

// The copy in the reader's language.
export const translateProjectHealthText: (
  translator: Translator,
  value: ProjectHealthText,
) => string = (translator: Translator, value: ProjectHealthText): string => {
  if ("plural" in value) {
    return translator.translatePlural(value.plural, value.count);
  }

  return translator.translateText(value.text) || value.text;
};
