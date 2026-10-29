import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import { MonitorStepMetricMonitorUtil } from "Common/Types/Monitor/MonitorStepMetricMonitor";
import MonitorType from "Common/Types/Monitor/MonitorType";
import TelemetryAlertRuleUtil, {
  TelemetryAlertRule,
} from "Common/Types/Monitor/TelemetryAlertRule";
import MetricUnitUtil, { UnitOption } from "Common/Utils/MetricUnitUtil";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { getRuleSentence } from "./TelemetryRuleText";

/*
 * The metric a Metrics monitor's rule reads, by the names a person knows it
 * by, and the one sentence a telemetry rule is said in on a monitor's
 * step - shared by the rule's editor (TelemetryRuleEditor) and the
 * monitor's Criteria page (TelemetryRuleSummary). React-free, so
 * App/Tests read it.
 */

type MetricViewConfig = {
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs: Array<MetricFormulaConfigData>;
};

/*
 * The name a rule's alias goes by: its title, else its metric's name, else
 * the formula. Undefined for a query with no metric picked yet.
 */
export const getMetricAliasName: (data: {
  monitorStep: MonitorStep;
  alias: string;
}) => string | undefined = (data: {
  monitorStep: MonitorStep;
  alias: string;
}): string | undefined => {
  const viewConfig: MetricViewConfig =
    MonitorStepMetricMonitorUtil.getMetricViewConfig(
      data.monitorStep.data?.metricMonitor,
    );

  const query: MetricQueryConfigData | undefined = viewConfig.queryConfigs.find(
    (candidate: MetricQueryConfigData) => {
      return candidate.metricAliasData?.metricVariable === data.alias;
    },
  );

  if (query) {
    const metricName: unknown = query.metricQueryData?.filterData?.metricName;

    return (
      query.metricAliasData?.title?.trim() ||
      (typeof metricName === "string" ? metricName : "") ||
      undefined
    );
  }

  const formula: MetricFormulaConfigData | undefined =
    viewConfig.formulaConfigs.find((candidate: MetricFormulaConfigData) => {
      return candidate.metricAliasData?.metricVariable === data.alias;
    });

  return (
    formula?.metricAliasData?.title?.trim() ||
    formula?.metricFormulaData?.metricFormula ||
    undefined
  );
};

// As getMetricAliasName, else the alias itself ("a"): a picker's label.
export const getMetricAliasLabel: (data: {
  monitorStep: MonitorStep;
  alias: string;
}) => string = (data: { monitorStep: MonitorStep; alias: string }): string => {
  return getMetricAliasName(data) || data.alias;
};

// The unit the metric a rule's alias reads is shown in.
export const getMetricAliasUnit: (data: {
  monitorStep: MonitorStep;
  alias: string | undefined;
}) => string | undefined = (data: {
  monitorStep: MonitorStep;
  alias: string | undefined;
}): string | undefined => {
  const viewConfig: MetricViewConfig =
    MonitorStepMetricMonitorUtil.getMetricViewConfig(
      data.monitorStep.data?.metricMonitor,
    );

  const aliasData:
    | MetricQueryConfigData["metricAliasData"]
    | MetricFormulaConfigData["metricAliasData"]
    | undefined =
    viewConfig.queryConfigs.find((query: MetricQueryConfigData) => {
      return query.metricAliasData?.metricVariable === data.alias;
    })?.metricAliasData ||
    viewConfig.formulaConfigs.find((formula: MetricFormulaConfigData) => {
      return formula.metricAliasData?.metricVariable === data.alias;
    })?.metricAliasData;

  return aliasData?.legendUnit || undefined;
};

// The alias a metric rule reads: the one it names, else the step's first.
export const getRuleMetricAlias: (data: {
  monitorStep: MonitorStep;
  rule: Pick<TelemetryAlertRule, "metricAlias">;
}) => string | undefined = (data: {
  monitorStep: MonitorStep;
  rule: Pick<TelemetryAlertRule, "metricAlias">;
}): string | undefined => {
  return (
    data.rule.metricAlias ||
    TelemetryAlertRuleUtil.getMetricAliases(data.monitorStep)[0]
  );
};

/*
 * The units a metric rule's value can be entered in, and the one it is in:
 * the unit it stores, else the metric's own.
 */
export const getRuleUnits: (data: {
  monitorStep: MonitorStep;
  rule: Pick<TelemetryAlertRule, "metricAlias" | "thresholdUnit">;
}) => { options: Array<UnitOption>; value: string | undefined } = (data: {
  monitorStep: MonitorStep;
  rule: Pick<TelemetryAlertRule, "metricAlias" | "thresholdUnit">;
}): { options: Array<UnitOption>; value: string | undefined } => {
  const metricUnit: string | undefined = getMetricAliasUnit({
    monitorStep: data.monitorStep,
    alias: getRuleMetricAlias(data),
  });

  return {
    options: MetricUnitUtil.getCompatibleUnits(metricUnit),
    value:
      data.rule.thresholdUnit ||
      MetricUnitUtil.getCanonicalUnitValue(metricUnit),
  };
};

// The symbol a unit picker's label ends with: "Percent (%)" says "%".
const UNIT_SYMBOL_IN_LABEL: RegExp = /\(([^()]+)\)$/;

/*
 * The unit a metric rule's sentence says after its value, as short as the
 * value is written with: "80 %", "250 ms", "2 hours". None for a fraction
 * from 0 to 1, which has no unit to say, nor for an annotation
 * ("{message}"), which names what is counted, not a unit.
 */
export const getRuleSentenceUnit: (data: {
  monitorStep: MonitorStep;
  rule: Pick<TelemetryAlertRule, "metricAlias" | "thresholdUnit">;
}) => string | undefined = (data: {
  monitorStep: MonitorStep;
  rule: Pick<TelemetryAlertRule, "metricAlias" | "thresholdUnit">;
}): string | undefined => {
  const units: { options: Array<UnitOption>; value: string | undefined } =
    getRuleUnits(data);

  const value: string | undefined = units.value;

  if (!value || value === "1") {
    return undefined;
  }

  const label: string =
    units.options.find((option: UnitOption) => {
      return option.value === value;
    })?.label || value;

  if (label.startsWith("{") && label.endsWith("}")) {
    return undefined;
  }

  return UNIT_SYMBOL_IN_LABEL.exec(label)?.[1] || value;
};

// The whole rule in one sentence, with the metric and unit of its step.
export const getRuleSentenceForStep: (data: {
  monitorType: MonitorType;
  monitorStep: MonitorStep;
  rule: TelemetryAlertRule;
  translator: Translator;
}) => string = (data: {
  monitorType: MonitorType;
  monitorStep: MonitorStep;
  rule: TelemetryAlertRule;
  translator: Translator;
}): string => {
  const isMetric: boolean = data.monitorType === MonitorType.Metrics;
  const alias: string | undefined = isMetric
    ? getRuleMetricAlias(data)
    : undefined;

  return getRuleSentence({
    monitorType: data.monitorType,
    rule: data.rule,
    translator: data.translator,
    metricName: alias
      ? getMetricAliasName({ monitorStep: data.monitorStep, alias })
      : undefined,
    unit: isMetric ? getRuleSentenceUnit(data) : undefined,
  });
};
