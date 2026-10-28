import { CriteriaAlert } from "Common/Types/Monitor/CriteriaAlert";
import { CriteriaIncident } from "Common/Types/Monitor/CriteriaIncident";
import MonitorType from "Common/Types/Monitor/MonitorType";
import {
  TelemetryAlertRule,
  TelemetryAlertRuleAction,
} from "Common/Types/Monitor/TelemetryAlertRule";
import ObjectID from "Common/Types/ObjectID";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  buildAlert,
  buildIncident,
  getRecipes,
  getRuleNameFromFilter,
  getStatusForAction,
  TelemetryRuleRecipe,
  TelemetryRuleSeeds,
} from "./TelemetryRuleRecipes";

/*
 * How a rule's other words follow an edit of the rule.
 *
 * A rule's criteria name and the title of what it opens were written for
 * the rule they came with: "Log Count is above 10", "Checkout: too many
 * errors", or - on a monitor made before the rule editor - "Check if
 * Checkout is offline" and "Checkout is offline". Change the rule, and a
 * name or title OneUptime wrote follows it, so a monitor never opens an
 * incident called "is offline" for too many errors. Words a person typed
 * are theirs, and stay.
 */

export const opensIncident: (action: TelemetryAlertRuleAction) => boolean = (
  action: TelemetryAlertRuleAction,
): boolean => {
  return (
    action === TelemetryAlertRuleAction.Incident ||
    action === TelemetryAlertRuleAction.AlertAndIncident
  );
};

export const opensAlert: (action: TelemetryAlertRuleAction) => boolean = (
  action: TelemetryAlertRuleAction,
): boolean => {
  return (
    action === TelemetryAlertRuleAction.Alert ||
    action === TelemetryAlertRuleAction.AlertAndIncident
  );
};

/*
 * The names the out-of-the-box criteria gave a telemetry monitor's rule and
 * its opposite (MonitorCriteriaInstance's defaults), for this monitor.
 */
export const getLegacyRuleNames: (monitorName: string) => Array<string> = (
  monitorName: string,
): Array<string> => {
  return [
    `Check if ${monitorName} is offline`,
    `Check if ${monitorName} is online`,
    `Check if ${monitorName} has exceptions`,
    `Check if ${monitorName} has no exceptions`,
  ];
};

// The titles the out-of-the-box criteria gave what they open.
export const getLegacyTitles: (monitorName: string) => Array<string> = (
  monitorName: string,
): Array<string> => {
  return [`${monitorName} is offline`, `${monitorName} has exceptions`];
};

const getRuleName: (
  monitorType: MonitorType,
  rule: Pick<TelemetryAlertRule, "filterType" | "threshold" | "metricAlias">,
) => string = (
  monitorType: MonitorType,
  rule: Pick<TelemetryAlertRule, "filterType" | "threshold" | "metricAlias">,
): string => {
  return getRuleNameFromFilter({
    monitorType,
    filterType: rule.filterType,
    threshold: rule.threshold,
    metricAlias: rule.metricAlias,
  });
};

/*
 * The title a rule's alert or incident gets: the title of the recipe the
 * rule is (same condition, value and window), or the monitor's name with
 * the rule's.
 */
export const getGeneratedTitle: (data: {
  monitorType: MonitorType;
  rule: Pick<
    TelemetryAlertRule,
    "filterType" | "threshold" | "windowInSeconds" | "metricAlias"
  >;
  monitorName: string;
  translator: Translator;
}) => string = (data: {
  monitorType: MonitorType;
  rule: Pick<
    TelemetryAlertRule,
    "filterType" | "threshold" | "windowInSeconds" | "metricAlias"
  >;
  monitorName: string;
  translator: Translator;
}): string => {
  const recipe: TelemetryRuleRecipe | undefined = getRecipes(
    data.monitorType,
  ).find((candidate: TelemetryRuleRecipe): boolean => {
    return (
      candidate.filterType === data.rule.filterType &&
      candidate.threshold === data.rule.threshold &&
      candidate.windowInSeconds === data.rule.windowInSeconds
    );
  });

  if (recipe) {
    return data.translator.translateTemplate(recipe.openedTitle, {
      monitorName: data.monitorName,
    });
  }

  return data.translator.translateTemplate("{{monitorName}}: {{ruleName}}", {
    monitorName: data.monitorName,
    ruleName: getRuleName(data.monitorType, data.rule),
  });
};

/*
 * Every title OneUptime may have written for a rule of this monitor, in
 * the reader's language and in English.
 */
const getWrittenTitles: (data: {
  monitorType: MonitorType;
  previous: TelemetryAlertRule;
  monitorName: string;
  translator: Translator;
}) => Array<string> = (data: {
  monitorType: MonitorType;
  previous: TelemetryAlertRule;
  monitorName: string;
  translator: Translator;
}): Array<string> => {
  return [
    ...getLegacyTitles(data.monitorName),
    ...getRecipes(data.monitorType).map((recipe: TelemetryRuleRecipe) => {
      return data.translator.translateTemplate(recipe.openedTitle, {
        monitorName: data.monitorName,
      });
    }),
    getGeneratedTitle({
      monitorType: data.monitorType,
      rule: data.previous,
      monitorName: data.monitorName,
      translator: data.translator,
    }),
  ];
};

/*
 * The rule after its condition, value, window or query changed, with the
 * name and titles OneUptime wrote following it.
 */
export const applyConditionChange: (data: {
  monitorType: MonitorType;
  previous: TelemetryAlertRule;
  next: TelemetryAlertRule;
  monitorName: string;
  translator: Translator;
}) => TelemetryAlertRule = (data: {
  monitorType: MonitorType;
  previous: TelemetryAlertRule;
  next: TelemetryAlertRule;
  monitorName: string;
  translator: Translator;
}): TelemetryAlertRule => {
  const { previous, next } = data;
  const result: TelemetryAlertRule = { ...next };

  const previousName: string = (previous.name || "").trim();
  const isWrittenName: boolean =
    !previousName ||
    previousName === getRuleName(data.monitorType, previous) ||
    getLegacyRuleNames(data.monitorName).includes(previousName);

  if (isWrittenName) {
    result.name = getRuleName(data.monitorType, next);
  }

  const writtenTitles: Array<string> = getWrittenTitles({
    monitorType: data.monitorType,
    previous,
    monitorName: data.monitorName,
    translator: data.translator,
  });

  const newTitle: string = getGeneratedTitle({
    monitorType: data.monitorType,
    rule: next,
    monitorName: data.monitorName,
    translator: data.translator,
  });

  if (next.incident && isWrittenTitle(next.incident.title, writtenTitles)) {
    result.incident = { ...next.incident, title: newTitle };
  }

  if (next.alert && isWrittenTitle(next.alert.title, writtenTitles)) {
    result.alert = { ...next.alert, title: newTitle };
  }

  return result;
};

const isWrittenTitle: (
  title: string | undefined,
  writtenTitles: Array<string>,
) => boolean = (
  title: string | undefined,
  writtenTitles: Array<string>,
): boolean => {
  const trimmed: string = (title || "").trim();

  return !trimmed || writtenTitles.includes(trimmed);
};

/*
 * The rule after what it opens changed: an alert or an incident to open is
 * made when the rule had none (titled like the one it already opens), and
 * the status follows the action while it was the one the action came with
 * - Degraded for an alert, Offline for an incident.
 */
export const applyActionChange: (data: {
  monitorType: MonitorType;
  rule: TelemetryAlertRule;
  action: TelemetryAlertRuleAction;
  seeds: TelemetryRuleSeeds;
  translator: Translator;
}) => TelemetryAlertRule = (data: {
  monitorType: MonitorType;
  rule: TelemetryAlertRule;
  action: TelemetryAlertRuleAction;
  seeds: TelemetryRuleSeeds;
  translator: Translator;
}): TelemetryAlertRule => {
  const { rule, action, seeds } = data;
  const result: TelemetryAlertRule = { ...rule, action };

  const title: string =
    rule.alert?.title ||
    rule.incident?.title ||
    getGeneratedTitle({
      monitorType: data.monitorType,
      rule,
      monitorName: seeds.monitorName,
      translator: data.translator,
    });

  if (opensIncident(action) && !rule.incident) {
    const incident: CriteriaIncident = buildIncident({ title, seeds });
    result.incident = incident;
  }

  if (opensAlert(action) && !rule.alert) {
    const alert: CriteriaAlert = buildAlert({ title, seeds });
    result.alert = alert;
  }

  const previousStatus: ObjectID | undefined = getStatusForAction({
    action: rule.action,
    seeds,
  });

  if (
    action !== TelemetryAlertRuleAction.StatusOnly &&
    (!rule.monitorStatusId ||
      rule.monitorStatusId.toString() === previousStatus?.toString())
  ) {
    result.monitorStatusId = getStatusForAction({ action, seeds });
  }

  return result;
};
