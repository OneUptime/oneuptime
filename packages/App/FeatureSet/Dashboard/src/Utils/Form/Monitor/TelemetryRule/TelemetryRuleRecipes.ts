import { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import IconProp from "Common/Types/Icon/IconProp";
import LogSeverity from "Common/Types/Log/LogSeverity";
import { CriteriaAlert } from "Common/Types/Monitor/CriteriaAlert";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import { CriteriaIncident } from "Common/Types/Monitor/CriteriaIncident";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorStepLogMonitor, {
  MonitorStepLogMonitorUtil,
} from "Common/Types/Monitor/MonitorStepLogMonitor";
import MonitorStepTraceMonitor, {
  MonitorStepTraceMonitorUtil,
} from "Common/Types/Monitor/MonitorStepTraceMonitor";
import MonitorType from "Common/Types/Monitor/MonitorType";
import TelemetryAlertRuleUtil, {
  TelemetryAlertRule,
  TelemetryAlertRuleAction,
  TelemetryAlertRuleReadResult,
  TelemetryAlertRuleRecovery,
} from "Common/Types/Monitor/TelemetryAlertRule";
import ObjectID from "Common/Types/ObjectID";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import CriteriaNameUtil from "../CriteriaName";

/*
 * What a new telemetry monitor can be set up to tell you, in your words:
 * "Too many errors", "A message appears", "Logs stop". Each recipe is a
 * rule (a condition, a value, a window, what happens) and the part of the
 * monitor's query that goes with it (Error and Fatal logs for "Too many
 * errors"). Create Monitor starts a Logs, Traces or Exceptions monitor on
 * the first one and offers the others above the form; picking one fills
 * the form in, and everything stays editable.
 *
 * A Metrics monitor has no recipe to pick - what is "too high" depends on
 * the metric - and starts on "above a value", with the value to enter.
 */

export enum TelemetryRuleRecipeKey {
  ErrorLogs = "error-logs",
  LogMessage = "log-message",
  LogsStop = "logs-stop",
  FailedSpans = "failed-spans",
  SpansStop = "spans-stop",
  AnyException = "any-exception",
  ExceptionSpike = "exception-spike",
  MetricAbove = "metric-above",
  // Nothing to fill in: the person sets the rule up themselves.
  Custom = "custom",
}

export interface TelemetryRuleRecipe {
  key: TelemetryRuleRecipeKey;
  monitorType: MonitorType;
  title: string;
  description: string;
  icon: IconProp;
  // The rule.
  windowInSeconds: number;
  rollingTime?: RollingTime | undefined;
  filterType: FilterType;
  threshold: number | undefined;
  action: TelemetryAlertRuleAction;
  metricAggregationType?: EvaluateOverTimeType | undefined;
  // The part of the query that goes with it.
  severityTexts?: Array<LogSeverity> | undefined;
  spanStatuses?: Array<SpanStatus> | undefined;
  // The title of what it opens, with {{monitorName}}.
  openedTitle: string;
}

/*
 * The statuses and severities a new rule is made with: the project's own,
 * read by the criteria form (MonitorSteps).
 */
export interface TelemetryRuleSeeds {
  monitorName: string;
  operationalStatusId?: ObjectID | undefined;
  // The first status between operational and offline, such as Degraded.
  degradedStatusId?: ObjectID | undefined;
  offlineStatusId?: ObjectID | undefined;
  // The most severe incident and alert severities the project has.
  incidentSeverityId?: ObjectID | undefined;
  alertSeverityId?: ObjectID | undefined;
}

const LOG_RECIPES: Array<TelemetryRuleRecipe> = [
  {
    key: TelemetryRuleRecipeKey.ErrorLogs,
    monitorType: MonitorType.Logs,
    title: translationKey("Too many errors"),
    description: translationKey(
      "Error and fatal logs go above a number, such as 10 in 5 minutes.",
    ),
    icon: IconProp.Fire,
    windowInSeconds: 300,
    filterType: FilterType.GreaterThan,
    threshold: 10,
    action: TelemetryAlertRuleAction.Alert,
    severityTexts: [LogSeverity.Error, LogSeverity.Fatal],
    openedTitle: translationKey("{{monitorName}}: too many errors"),
  },
  {
    key: TelemetryRuleRecipeKey.LogMessage,
    monitorType: MonitorType.Logs,
    title: translationKey("A message appears"),
    description: translationKey(
      "Any log with the words you choose, such as payment declined.",
    ),
    icon: IconProp.Search,
    windowInSeconds: 300,
    filterType: FilterType.GreaterThan,
    threshold: 0,
    action: TelemetryAlertRuleAction.Alert,
    severityTexts: [],
    openedTitle: translationKey("{{monitorName}}: a matching log arrived"),
  },
  {
    key: TelemetryRuleRecipeKey.LogsStop,
    monitorType: MonitorType.Logs,
    title: translationKey("Logs stop"),
    description: translationKey(
      "No logs arrive for a while, such as 10 minutes.",
    ),
    icon: IconProp.SignalSlash,
    windowInSeconds: 600,
    filterType: FilterType.EqualTo,
    threshold: 0,
    action: TelemetryAlertRuleAction.Incident,
    severityTexts: [],
    openedTitle: translationKey("{{monitorName}}: logs stopped"),
  },
];

const TRACE_RECIPES: Array<TelemetryRuleRecipe> = [
  {
    key: TelemetryRuleRecipeKey.FailedSpans,
    monitorType: MonitorType.Traces,
    title: translationKey("Too many failed requests"),
    description: translationKey(
      "Spans with an error status go above a number, such as 10 in 5 minutes.",
    ),
    icon: IconProp.Fire,
    windowInSeconds: 300,
    filterType: FilterType.GreaterThan,
    threshold: 10,
    action: TelemetryAlertRuleAction.Alert,
    spanStatuses: [SpanStatus.Error],
    openedTitle: translationKey("{{monitorName}}: too many failed requests"),
  },
  {
    key: TelemetryRuleRecipeKey.SpansStop,
    monitorType: MonitorType.Traces,
    title: translationKey("Requests stop"),
    description: translationKey(
      "No spans arrive for a while, such as 10 minutes.",
    ),
    icon: IconProp.SignalSlash,
    windowInSeconds: 600,
    filterType: FilterType.EqualTo,
    threshold: 0,
    action: TelemetryAlertRuleAction.Incident,
    spanStatuses: [],
    openedTitle: translationKey("{{monitorName}}: requests stopped"),
  },
];

const EXCEPTION_RECIPES: Array<TelemetryRuleRecipe> = [
  {
    key: TelemetryRuleRecipeKey.AnyException,
    monitorType: MonitorType.Exceptions,
    title: translationKey("Any exception"),
    description: translationKey(
      "An exception you have not resolved or archived happens, or a resolved one comes back.",
    ),
    icon: IconProp.Bug,
    windowInSeconds: 300,
    filterType: FilterType.GreaterThan,
    threshold: 0,
    action: TelemetryAlertRuleAction.Alert,
    openedTitle: translationKey("{{monitorName}}: an exception happened"),
  },
  {
    key: TelemetryRuleRecipeKey.ExceptionSpike,
    monitorType: MonitorType.Exceptions,
    title: translationKey("Too many exceptions"),
    description: translationKey(
      "Exceptions go above a number, such as 20 in 5 minutes.",
    ),
    icon: IconProp.Fire,
    windowInSeconds: 300,
    filterType: FilterType.GreaterThan,
    threshold: 20,
    action: TelemetryAlertRuleAction.Alert,
    openedTitle: translationKey("{{monitorName}}: too many exceptions"),
  },
];

/*
 * A new Metrics monitor's rule: the average over 5 minutes above a value
 * the person enters - the form asks for it before the monitor is created.
 */
export const METRIC_ABOVE_RECIPE: TelemetryRuleRecipe = {
  key: TelemetryRuleRecipeKey.MetricAbove,
  monitorType: MonitorType.Metrics,
  title: translationKey("Goes above a value"),
  description: translationKey("The metric's average goes above a value."),
  icon: IconProp.ArrowTrendingUp,
  windowInSeconds: 300,
  rollingTime: RollingTime.Past5Minutes,
  filterType: FilterType.GreaterThan,
  threshold: undefined,
  action: TelemetryAlertRuleAction.Alert,
  metricAggregationType: EvaluateOverTimeType.Average,
  openedTitle: translationKey("{{monitorName}}: metric above the limit"),
};

export const CUSTOM_RECIPE_COPY: { title: string; description: string } = {
  title: translationKey("Something else"),
  description: translationKey("Choose the filters and the rule yourself."),
};

export const RECIPE_PICKER_COPY: { title: string; description: string } = {
  title: translationKey("What should this monitor tell you about?"),
  description: translationKey(
    "Pick one to start. Everything below can be changed.",
  ),
};

// The recipes a monitor type offers, the default first.
export const getRecipes: (
  monitorType: MonitorType,
) => Array<TelemetryRuleRecipe> = (
  monitorType: MonitorType,
): Array<TelemetryRuleRecipe> => {
  switch (monitorType) {
    case MonitorType.Logs:
      return LOG_RECIPES;
    case MonitorType.Traces:
      return TRACE_RECIPES;
    case MonitorType.Exceptions:
      return EXCEPTION_RECIPES;
    default:
      return [];
  }
};

/*
 * The rule a new monitor of this type starts on: its first recipe, or a
 * Metrics monitor's "above a value". None for any other type.
 */
export const getDefaultRecipe: (
  monitorType: MonitorType,
) => TelemetryRuleRecipe | null = (
  monitorType: MonitorType,
): TelemetryRuleRecipe | null => {
  if (monitorType === MonitorType.Metrics) {
    return METRIC_ABOVE_RECIPE;
  }

  return getRecipes(monitorType)[0] || null;
};

export const getRecipe: (
  key: TelemetryRuleRecipeKey,
) => TelemetryRuleRecipe | null = (
  key: TelemetryRuleRecipeKey,
): TelemetryRuleRecipe | null => {
  return (
    [
      ...LOG_RECIPES,
      ...TRACE_RECIPES,
      ...EXCEPTION_RECIPES,
      METRIC_ABOVE_RECIPE,
    ].find((recipe: TelemetryRuleRecipe) => {
      return recipe.key === key;
    }) || null
  );
};

/*
 * The status a rule's monitor shows while it matches: Degraded (the first
 * status between operational and offline) for an alert, Offline for an
 * incident. A project without a status between the two uses Offline for
 * both.
 */
export const getStatusForAction: (data: {
  action: TelemetryAlertRuleAction;
  seeds: TelemetryRuleSeeds;
}) => ObjectID | undefined = (data: {
  action: TelemetryAlertRuleAction;
  seeds: TelemetryRuleSeeds;
}): ObjectID | undefined => {
  if (data.action === TelemetryAlertRuleAction.Alert) {
    return data.seeds.degradedStatusId || data.seeds.offlineStatusId;
  }

  return data.seeds.offlineStatusId || data.seeds.degradedStatusId;
};

export const buildIncident: (data: {
  title: string;
  seeds: TelemetryRuleSeeds;
}) => CriteriaIncident = (data: {
  title: string;
  seeds: TelemetryRuleSeeds;
}): CriteriaIncident => {
  return {
    id: ObjectID.generate().toString(),
    title: data.title,
    description: "",
    incidentSeverityId: data.seeds.incidentSeverityId,
    autoResolveIncident: true,
    onCallPolicyIds: [],
  };
};

export const buildAlert: (data: {
  title: string;
  seeds: TelemetryRuleSeeds;
}) => CriteriaAlert = (data: {
  title: string;
  seeds: TelemetryRuleSeeds;
}): CriteriaAlert => {
  return {
    id: ObjectID.generate().toString(),
    title: data.title,
    description: "",
    alertSeverityId: data.seeds.alertSeverityId,
    autoResolveAlert: true,
    onCallPolicyIds: [],
  };
};

/*
 * The name a rule's criteria takes from its filter, as every criteria
 * named after its filters does (CriteriaNameUtil): "Log Count is above
 * 10". It follows the rule until someone types a name of their own.
 */
export const getRuleNameFromFilter: (data: {
  monitorType: MonitorType;
  filterType: FilterType;
  threshold: number | undefined;
  metricAlias?: string | undefined;
}) => string = (data: {
  monitorType: MonitorType;
  filterType: FilterType;
  threshold: number | undefined;
  metricAlias?: string | undefined;
}): string => {
  const checkOn: CheckOn | null = TelemetryAlertRuleUtil.getMeasureCheckOn(
    data.monitorType,
  );

  if (!checkOn) {
    return CriteriaNameUtil.FALLBACK_NAME;
  }

  const filter: CriteriaFilter = {
    checkOn,
    filterType: data.filterType,
    value: data.threshold,
    ...(data.monitorType === MonitorType.Metrics && data.metricAlias
      ? { metricMonitorOptions: { metricAlias: data.metricAlias } }
      : {}),
  };

  return CriteriaNameUtil.getNameFromFilters({
    filters: [filter],
    filterCondition: FilterCondition.Any,
  });
};

// The rule a recipe makes, with the project's statuses and severities.
export const buildRecipeRule: (data: {
  recipe: TelemetryRuleRecipe;
  seeds: TelemetryRuleSeeds;
  translator: Translator;
}) => TelemetryAlertRule = (data: {
  recipe: TelemetryRuleRecipe;
  seeds: TelemetryRuleSeeds;
  translator: Translator;
}): TelemetryAlertRule => {
  const { recipe, seeds } = data;

  const title: string = data.translator.translateTemplate(recipe.openedTitle, {
    monitorName: seeds.monitorName || "",
  });

  const opensIncident: boolean =
    recipe.action === TelemetryAlertRuleAction.Incident ||
    recipe.action === TelemetryAlertRuleAction.AlertAndIncident;
  const opensAlert: boolean =
    recipe.action === TelemetryAlertRuleAction.Alert ||
    recipe.action === TelemetryAlertRuleAction.AlertAndIncident;

  return {
    filterType: recipe.filterType,
    threshold: recipe.threshold,
    windowInSeconds:
      recipe.monitorType === MonitorType.Metrics
        ? undefined
        : recipe.windowInSeconds,
    rollingTime: recipe.rollingTime,
    metricAlias: undefined,
    metricAggregationType: recipe.metricAggregationType,
    onNoDataPolicy: undefined,
    thresholdUnit: undefined,
    anomalyDetection: undefined,
    action: recipe.action,
    monitorStatusId: getStatusForAction({ action: recipe.action, seeds }),
    incident: opensIncident ? buildIncident({ title, seeds }) : undefined,
    alert: opensAlert ? buildAlert({ title, seeds }) : undefined,
    name: getRuleNameFromFilter({
      monitorType: recipe.monitorType,
      filterType: recipe.filterType,
      threshold: recipe.threshold,
    }),
    // Not one of the step's criteria: the rule takes the criteria's place.
    ruleCriteriaId: ObjectID.generate().toString(),
    recovery: TelemetryAlertRuleRecovery.DefaultStatus,
  };
};

/*
 * A recipe applied to a step: the query part it goes with (only the
 * severities or span statuses it names; services, attributes and text are
 * left as they are) and its rule in place of the criteria.
 */
export const applyRecipe: (data: {
  monitorStep: MonitorStep;
  recipe: TelemetryRuleRecipe;
  seeds: TelemetryRuleSeeds;
  translator: Translator;
}) => MonitorStep = (data: {
  monitorStep: MonitorStep;
  recipe: TelemetryRuleRecipe;
  seeds: TelemetryRuleSeeds;
  translator: Translator;
}): MonitorStep => {
  const { recipe } = data;
  const step: MonitorStep = MonitorStep.clone(data.monitorStep);

  if (recipe.monitorType === MonitorType.Logs && recipe.severityTexts) {
    const logMonitor: MonitorStepLogMonitor =
      step.data?.logMonitor || MonitorStepLogMonitorUtil.getDefault();
    step.setLogMonitor({
      ...logMonitor,
      severityTexts: [...recipe.severityTexts],
    });
  }

  if (recipe.monitorType === MonitorType.Traces && recipe.spanStatuses) {
    const traceMonitor: MonitorStepTraceMonitor =
      step.data?.traceMonitor || MonitorStepTraceMonitorUtil.getDefault();
    step.setTraceMonitor({
      ...traceMonitor,
      spanStatuses: [...recipe.spanStatuses],
    });
  }

  return TelemetryAlertRuleUtil.write({
    monitorType: recipe.monitorType,
    monitorStep: step,
    rule: buildRecipeRule(data),
  });
};

const sameMembers: <T>(a: Array<T> | undefined, b: Array<T>) => boolean = <T>(
  a: Array<T> | undefined,
  b: Array<T>,
): boolean => {
  const left: Array<T> = a || [];

  return (
    left.length === b.length &&
    left.every((item: T) => {
      return b.includes(item);
    })
  );
};

/*
 * The recipe a step's rule is, as it stands: its rule and its query part
 * are the recipe's. Custom when it is none of them, or not a rule.
 */
export const findRecipe: (data: {
  monitorType: MonitorType;
  monitorStep: MonitorStep;
  defaultMonitorStatusId: ObjectID | undefined;
}) => TelemetryRuleRecipeKey = (data: {
  monitorType: MonitorType;
  monitorStep: MonitorStep;
  defaultMonitorStatusId: ObjectID | undefined;
}): TelemetryRuleRecipeKey => {
  const result: TelemetryAlertRuleReadResult =
    TelemetryAlertRuleUtil.read(data);

  if (!result.rule) {
    return TelemetryRuleRecipeKey.Custom;
  }

  const rule: TelemetryAlertRule = result.rule;

  const match: TelemetryRuleRecipe | undefined = getRecipes(
    data.monitorType,
  ).find((recipe: TelemetryRuleRecipe): boolean => {
    if (
      rule.filterType !== recipe.filterType ||
      rule.threshold !== recipe.threshold ||
      rule.windowInSeconds !== recipe.windowInSeconds ||
      rule.action !== recipe.action
    ) {
      return false;
    }

    if (recipe.severityTexts) {
      return sameMembers(
        data.monitorStep.data?.logMonitor?.severityTexts,
        recipe.severityTexts,
      );
    }

    if (recipe.spanStatuses) {
      return sameMembers(
        data.monitorStep.data?.traceMonitor?.spanStatuses,
        recipe.spanStatuses,
      );
    }

    return true;
  });

  return match?.key || TelemetryRuleRecipeKey.Custom;
};
