import { MetricPointType } from "../../../Models/AnalyticsModels/Metric";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import LogRecordingRuleDefinition, {
  LOG_RECORDING_RULE_ID_ATTRIBUTE,
  LogRecordingRuleDefinitionUtil,
} from "../../../Types/Log/LogRecordingRuleDefinition";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import { LogRecordingRulePoint } from "./LogRecordingRuleQuery";

/*
 * What a log recording rule writes: the metric rows for its points, in the
 * shape the metric and trace recording rule workers write theirs
 * (Workers/Jobs/Metrics/ComputeRecordingRules), so the Metric Explorer,
 * dashboards and Metrics monitors read them like any other metric - and the
 * metric catalogue entry (MetricType) that puts the output metric in the
 * metric pickers, with its unit.
 *
 * Each row is a Gauge point at the start of its minute, named after the
 * rule's output metric, carrying the series' group-by values as attributes
 * (a log that lacked one is written without it, as the other recording
 * rules write a missing group value) and the rule's id under
 * oneuptime.derived.log_rule_id.
 */

// Derived rows keep the default telemetry retention, as the other recording rules' do.
export const LOG_RECORDING_RULE_METRIC_RETENTION_IN_DAYS: number = 15;

export default class LogRecordingRuleMetric {
  public static buildRows(input: {
    ruleId: ObjectID;
    projectId: ObjectID;
    outputMetricName: string;
    points: Array<LogRecordingRulePoint>;
    now: Date;
  }): Array<JSONObject> {
    const retentionDate: Date = OneUptimeDate.addRemoveDays(
      input.now,
      LOG_RECORDING_RULE_METRIC_RETENTION_IN_DAYS,
    );

    return input.points.map((point: LogRecordingRulePoint): JSONObject => {
      const attributes: Record<string, string> = {};

      for (const [key, value] of Object.entries(point.groupValues)) {
        if (value !== "") {
          attributes[key] = value;
        }
      }

      // Set last, so no group-by value can stand in for the rule's id.
      attributes[LOG_RECORDING_RULE_ID_ATTRIBUTE] = input.ruleId.toString();

      return {
        _id: ObjectID.generateTimeOrdered().toString(),
        projectId: input.projectId.toString(),
        createdAt: OneUptimeDate.toClickhouseDateTime(input.now),
        time: OneUptimeDate.toClickhouseDateTime(point.bucketStart),
        timeUnixNano: (point.bucketStart.getTime() * 1_000_000).toString(),
        primaryEntityType: ServiceType.OpenTelemetry,
        name: input.outputMetricName,
        metricPointType: MetricPointType.Gauge,
        value: point.value,
        attributes: attributes,
        attributeKeys: Object.keys(attributes).sort(),
        retentionDate: OneUptimeDate.toClickhouseDateTime(retentionDate),
      };
    });
  }

  /*
   * The catalogue entry for the output metric. Registering it is what lists
   * the metric in the Metric Explorer's and the Metrics monitor's metric
   * pickers (they read MetricType rows), with the rule's unit.
   */
  public static buildMetricType(input: {
    outputMetricName: string;
    ruleName?: string | undefined;
    ruleDescription?: string | undefined;
    definition: LogRecordingRuleDefinition;
  }): MetricType {
    const metricType: MetricType = new MetricType();
    metricType.name = input.outputMetricName;

    const ruleDescription: string = (input.ruleDescription || "").trim();

    metricType.description =
      ruleDescription ||
      `Written every minute by the log recording rule "${(
        input.ruleName || input.outputMetricName
      ).trim()}": ${LogRecordingRuleDefinitionUtil.describe(
        input.definition,
      )} of the logs it matches.`;

    metricType.unit = (input.definition.unit || "").trim();

    return metricType;
  }
}
