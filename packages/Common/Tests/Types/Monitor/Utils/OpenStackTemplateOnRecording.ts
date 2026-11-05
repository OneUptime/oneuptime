import { RecordedSeries } from "../../../Helpers/OpenStackRecordedRows";
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../../Types/Metrics/MetricsAggregationType";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import {
  OpenStackAlertTemplate,
  getOpenStackAlertTemplateById,
} from "../../../../Types/Monitor/OpenStackAlertTemplates";
import ObjectID from "../../../../Types/ObjectID";
import RollingTimeUtil from "../../../../Types/RollingTime/RollingTimeUtil";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import {
  SamplesByAlias,
  WINDOW_END_MS,
  evaluateTemplateCriteria,
} from "./TemplateCriteriaEvaluation";

/*
 * WHAT A TEMPLATE MAKES OF WHAT A REAL CLOUD SAID.
 *
 * A template's own table says what it fires on in made-up values. This reads the values off a
 * recording instead: each query keeps the series its metric name and attributes pick out, split by
 * what the template groups by, as a monitor's read would, and each group goes through the real
 * evaluator as a whole window of that reading. So a template that asks for a label nobody sends, or
 * reads a value that is really 0, fails here. Not a test file itself.
 */

export interface OpenStackTemplateReading {
  // What it groups by, as the series said it. Empty for a series with no labels.
  group: Record<string, string>;
  breached: boolean;
  healthy: boolean;
}

// The region is stamped on by the collector, so a recording of the exporter's own text has none.
const REGION_LABEL: string = "openstack.region.name";

function matches(
  series: RecordedSeries,
  query: MetricQueryConfigData,
): boolean {
  const filter: Record<string, unknown> = query.metricQueryData
    .filterData as unknown as Record<string, unknown>;
  if (series.name !== filter["metricName"]) {
    return false;
  }
  const attributes: Record<string, string> = (filter["attributes"] ||
    {}) as Record<string, string>;
  return Object.keys(attributes).every((key: string): boolean => {
    /*
     * The agent's own job label is stamped on by the collector too. Attributes a recording of the
     * exporter's text can't hold say nothing about whether the query reads the series.
     */
    return (
      key === "openstack_service" || series.labels[key] === attributes[key]
    );
  });
}

function groupKeysOf(query: MetricQueryConfigData): Array<string> {
  const keys: Array<string> =
    (query.metricQueryData as unknown as { groupByAttributeKeys?: Array<string> })
      .groupByAttributeKeys || [];
  return keys.filter((key: string): boolean => {
    return key !== REGION_LABEL;
  });
}

export async function readOpenStackTemplateOnRecording(data: {
  templateId: string;
  series: ReadonlyArray<RecordedSeries>;
}): Promise<Array<OpenStackTemplateReading>> {
  const template: OpenStackAlertTemplate | undefined =
    getOpenStackAlertTemplateById(data.templateId);
  if (!template) {
    throw new Error(`No template called ${data.templateId}`);
  }
  const step: MonitorStep = template.getMonitorStep({
    cloudIdentifier: "devstack",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Recorded",
  });
  const monitor: NonNullable<NonNullable<MonitorStep["data"]>["openstackMonitor"]> =
    step.data!.openstackMonitor!;
  const window: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
    monitor.rollingTime,
    new Date(WINDOW_END_MS),
  );
  const windowMinutes: number =
    ((window.endValue as Date).getTime() -
      (window.startValue as Date).getTime()) /
    60000;

  const samplesByGroup: Map<
    string,
    { group: Record<string, string>; samples: SamplesByAlias }
  > = new Map();

  for (const query of monitor.metricViewConfig.queryConfigs) {
    const alias: string = query.metricAliasData?.metricVariable || "";
    const keys: Array<string> = groupKeysOf(query);
    for (const series of data.series) {
      if (!matches(series, query)) {
        continue;
      }
      const group: Record<string, string> = {};
      for (const key of keys) {
        group[key] = series.labels[key] || "";
      }
      const groupKey: string = JSON.stringify(group);
      const held: { group: Record<string, string>; samples: SamplesByAlias } =
        samplesByGroup.get(groupKey) || { group, samples: {} };
      /*
       * A Count reads how many series the group holds in a collection, whatever their values: a status
       * code of 0 is still a row. Anything else reads the series' value, the last one winning as a
       * recording holds one collection.
       */
      const isCount: boolean =
        (query.metricQueryData.filterData as unknown as Record<string, unknown>)[
          "aggegationType"
        ] === MetricsAggregationType.Count;
      held.samples[alias] = new Array<number>(windowMinutes).fill(
        isCount ? (held.samples[alias]?.[0] || 0) + 1 : series.value,
      );
      samplesByGroup.set(groupKey, held);
    }
  }

  const readings: Array<OpenStackTemplateReading> = [];
  for (const held of samplesByGroup.values()) {
    readings.push({
      group: held.group,
      ...(await evaluateTemplateCriteria({
        step,
        viewConfig: monitor.metricViewConfig,
        samplesByAlias: held.samples,
        windowMinutes,
      })),
    });
  }
  return readings;
}

// What fired, by what the template groups by: `name` when a group has one.
export function namesFiredBy(
  readings: ReadonlyArray<OpenStackTemplateReading>,
): Array<string> {
  return readings
    .filter((reading: OpenStackTemplateReading): boolean => {
      return reading.breached;
    })
    .map((reading: OpenStackTemplateReading): string => {
      return reading.group["name"] || JSON.stringify(reading.group);
    })
    .sort();
}

/*
 * A monitor with no series left to read is what a recovered part leaves, and the evaluator reads that
 * as recovered: every template's table says so. So a scene with nothing for this template to read has
 * nothing firing, which is the only way a word's own series can recover.
 */
export function isAnythingFiring(
  readings: ReadonlyArray<OpenStackTemplateReading>,
): boolean {
  return readings.some((reading: OpenStackTemplateReading): boolean => {
    return reading.breached;
  });
}
