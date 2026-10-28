import MonitorStepMetricMonitor, {
  MonitorStepMetricMonitorUtil,
} from "Common/Types/Monitor/MonitorStepMetricMonitor";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import MetricView from "../../../Metrics/MetricView";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import TelemetryAlertRuleUtil, {
  TelemetryAlertRule,
} from "Common/Types/Monitor/TelemetryAlertRule";
import TelemetryRulePreviewUtil, {
  TelemetryRulePreviewRange,
} from "Common/Types/Monitor/TelemetryRulePreview";
import OneUptimeDate from "Common/Types/Date";
import { getRollingTimeInSeconds } from "../../../../Utils/Form/Monitor/TelemetryRule/TelemetryRuleText";

/*
 * The metric a Metrics monitor reads: the query editor and its chart.
 *
 * The window the monitor reads over is the rule's ("When to alert", below),
 * so the chart shows the hours before it - as many windows of that length
 * as a Logs rule's preview reads (TelemetryRulePreviewUtil) - with the
 * rule's value drawn across the metric it compares, so a value is picked
 * from what the metric does.
 */

export interface ComponentProps {
  monitorStepMetricMonitor: MonitorStepMetricMonitor;
  onChange: (monitorStepMetricMonitor: MonitorStepMetricMonitor) => void;
  // The monitor's rule, when its criteria are one: its value is drawn.
  previewRule?: TelemetryAlertRule | null | undefined;
}

/*
 * The chart's view of the queries: the rule's value as the critical line of
 * the query or formula it compares, unless that one has a line of its own.
 * Only ever drawn: what the form hands back never carries it
 * (withoutPreviewLine).
 */
export const withPreviewLine: (data: {
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs: Array<MetricFormulaConfigData>;
  alias: string | undefined;
  threshold: number | undefined;
}) => {
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs: Array<MetricFormulaConfigData>;
} = (data: {
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs: Array<MetricFormulaConfigData>;
  alias: string | undefined;
  threshold: number | undefined;
}): {
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs: Array<MetricFormulaConfigData>;
} => {
  if (data.threshold === undefined) {
    return {
      queryConfigs: data.queryConfigs,
      formulaConfigs: data.formulaConfigs,
    };
  }

  const alias: string | undefined =
    data.alias ||
    data.queryConfigs[0]?.metricAliasData?.metricVariable ||
    undefined;

  return {
    queryConfigs: data.queryConfigs.map((query: MetricQueryConfigData) => {
      return query.metricAliasData?.metricVariable === alias &&
        query.criticalThreshold === undefined
        ? { ...query, criticalThreshold: data.threshold }
        : query;
    }),
    formulaConfigs: data.formulaConfigs.map(
      (formula: MetricFormulaConfigData) => {
        return formula.metricAliasData?.metricVariable === alias &&
          formula.criticalThreshold === undefined
          ? { ...formula, criticalThreshold: data.threshold }
          : formula;
      },
    ),
  };
};

/*
 * What the chart hands back, without the rule's line: each query and
 * formula keeps the critical line it was stored with, or none.
 */
export const withoutPreviewLine: (data: {
  changed: {
    queryConfigs: Array<MetricQueryConfigData>;
    formulaConfigs: Array<MetricFormulaConfigData>;
  };
  stored: {
    queryConfigs: Array<MetricQueryConfigData>;
    formulaConfigs: Array<MetricFormulaConfigData>;
  };
  threshold: number | undefined;
}) => {
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs: Array<MetricFormulaConfigData>;
} = (data: {
  changed: {
    queryConfigs: Array<MetricQueryConfigData>;
    formulaConfigs: Array<MetricFormulaConfigData>;
  };
  stored: {
    queryConfigs: Array<MetricQueryConfigData>;
    formulaConfigs: Array<MetricFormulaConfigData>;
  };
  threshold: number | undefined;
}): {
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs: Array<MetricFormulaConfigData>;
} => {
  const storedLineOf: (alias: string | undefined) => number | undefined = (
    alias: string | undefined,
  ): number | undefined => {
    return (
      data.stored.queryConfigs.find((query: MetricQueryConfigData) => {
        return query.metricAliasData?.metricVariable === alias;
      })?.criticalThreshold ??
      data.stored.formulaConfigs.find((formula: MetricFormulaConfigData) => {
        return formula.metricAliasData?.metricVariable === alias;
      })?.criticalThreshold
    );
  };

  type WithLine = {
    criticalThreshold?: number | undefined;
    metricAliasData?: { metricVariable?: string | undefined } | undefined;
  };

  const restore: <T extends WithLine>(config: T) => T = <T extends WithLine>(
    config: T,
  ): T => {
    if (
      data.threshold === undefined ||
      config.criticalThreshold !== data.threshold
    ) {
      return config;
    }

    const stored: number | undefined = storedLineOf(
      config.metricAliasData?.metricVariable,
    );

    if (stored !== undefined) {
      return { ...config, criticalThreshold: stored };
    }

    const copy: T = { ...config };
    delete copy.criticalThreshold;
    return copy;
  };

  return {
    queryConfigs: data.changed.queryConfigs.map(restore),
    formulaConfigs: data.changed.formulaConfigs.map(restore),
  };
};

const MetricMonitorStepForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const monitorStepMetricMonitor: MonitorStepMetricMonitor =
    props.monitorStepMetricMonitor || MonitorStepMetricMonitorUtil.getDefault();

  const stored: {
    queryConfigs: Array<MetricQueryConfigData>;
    formulaConfigs: Array<MetricFormulaConfigData>;
  } = MonitorStepMetricMonitorUtil.getMetricViewConfig(
    monitorStepMetricMonitor,
  );

  const threshold: number | undefined =
    props.previewRule &&
    !TelemetryAlertRuleUtil.isAnomaly(props.previewRule.filterType)
      ? props.previewRule.threshold
      : undefined;

  /*
   * The hours before the rule's window, read once per window length: a new
   * range on every render would read the metric again on every keystroke.
   */
  const rollingTime: RollingTime =
    monitorStepMetricMonitor.rollingTime || RollingTime.Past1Minute;

  const startAndEndTime: InBetween<Date> = useMemo(() => {
    const range: TelemetryRulePreviewRange = TelemetryRulePreviewUtil.getRange({
      windowInSeconds: getRollingTimeInSeconds(rollingTime),
      now: OneUptimeDate.getCurrentDate(),
    });

    return new InBetween<Date>(range.startTime, range.endTime);
  }, [rollingTime]);

  const drawn: {
    queryConfigs: Array<MetricQueryConfigData>;
    formulaConfigs: Array<MetricFormulaConfigData>;
  } = withPreviewLine({
    queryConfigs: stored.queryConfigs,
    formulaConfigs: stored.formulaConfigs,
    alias: props.previewRule?.metricAlias,
    threshold,
  });

  return (
    <div className="mt-3">
      <MetricView
        hideStartAndEndDate={true}
        data={{
          startAndEndDate: startAndEndTime,
          queryConfigs: drawn.queryConfigs,
          formulaConfigs: drawn.formulaConfigs,
        }}
        hideCardInQueryElements={true}
        hideCardInCharts={true}
        chartCssClass="rounded-lg border border-gray-200 shadow-sm"
        /*
         * A drag zooms the preview alone and never reaches the form; a
         * double-click (or Reset zoom) brings the preview's hours back.
         */
        localChartZoom={true}
        onChange={(data: MetricViewData) => {
          // The window is the rule's, set in When to alert, not here.
          const changed: {
            queryConfigs: Array<MetricQueryConfigData>;
            formulaConfigs: Array<MetricFormulaConfigData>;
          } = withoutPreviewLine({
            changed: {
              queryConfigs: data.queryConfigs,
              formulaConfigs: data.formulaConfigs,
            },
            stored,
            threshold,
          });

          props.onChange({
            ...monitorStepMetricMonitor,
            metricViewConfig: changed,
          });
        }}
      />
    </div>
  );
};

export default MetricMonitorStepForm;
