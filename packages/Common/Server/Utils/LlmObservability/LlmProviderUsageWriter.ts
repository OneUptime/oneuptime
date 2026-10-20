import MetricType from "../../../Models/DatabaseModels/MetricType";
import Service from "../../../Models/DatabaseModels/Service";
import { MetricPointType } from "../../../Models/AnalyticsModels/Metric";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import { LlmUsageRecord } from "../../../Types/LlmObservability/LlmConnectionRecords";
import {
  LLM_CONNECTION_ID_ATTRIBUTE,
  LLM_CONNECTION_NAME_ATTRIBUTE,
  LLM_PROVIDER_API_KEY_ATTRIBUTE,
  LLM_PROVIDER_COST_ESTIMATED_ATTRIBUTE,
  LLM_PROVIDER_COST_METRIC_NAME,
  LLM_PROVIDER_COST_UNIT,
  LLM_PROVIDER_MODEL_ATTRIBUTE,
  LLM_PROVIDER_NAME_ATTRIBUTE,
  LLM_PROVIDER_PERSON_ATTRIBUTE,
  LLM_PROVIDER_PROJECT_ATTRIBUTE,
  LLM_PROVIDER_REQUESTS_METRIC_NAME,
  LLM_PROVIDER_REQUESTS_UNIT,
  LLM_PROVIDER_TOKENS_METRIC_NAME,
  LLM_PROVIDER_TOKENS_UNIT,
  LLM_PROVIDER_TOKEN_TYPE_ATTRIBUTE,
  LlmProviderSeriesAttributeKeys,
  LlmProviderTokenType,
  LlmProviderUsageMetricNames,
} from "../../../Types/LlmObservability/LlmProviderUsageMetrics";
import ObjectID from "../../../Types/ObjectID";
import { LlmModelPrice } from "../../../Types/Telemetry/LlmCostCatalog";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import { keyForService } from "../../../Utils/Telemetry/EntityKey";
import { DbJSONResponse, Results } from "../../Services/AnalyticsDatabaseService";
import MetricService from "../../Services/MetricService";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import logger from "../Logger";
import TelemetryUtil from "../Telemetry/Telemetry";
import { LlmUsageWindow } from "./LlmConnectorTypes";
import LlmUsageCost from "./LlmUsageCost";

/*
 * KEEPS A PROVIDER ACCOUNT'S DAILY FIGURES AS METRICS, EXACTLY.
 *
 * A read returns the provider's figure for every day of its window, and a
 * day is read many times: today grows all day, and the days before it can
 * still be corrected. The metric table only ever appends, so the writer
 * never writes a figure twice - it reads what is already stored for the
 * window (one sum per day and series), and writes only the DIFFERENCE
 * between the provider's figure and that sum. The sum of a day's points is
 * then always the provider's latest figure.
 *
 * That makes it heal on its own: a write that was lost is written again by
 * the next read (the stored sum is short), and a write that landed twice -
 * two reads racing, a retry of an insert that had in fact worked - is taken
 * back by the next read with a negative point. A series the provider no
 * longer reports for a day it still covers (a correction to zero) gets a
 * point that cancels it.
 *
 * Points are stamped at the start of their UTC day and belong to the
 * connection's telemetry service, so who may read them, how long they are
 * kept and which charts list them follow that service.
 */

const METRIC_TABLE: string = AnalyticsTableName.Metric;

const READ_QUERY_SETTINGS: string = getQuerySettings({
  maxExecutionTimeInSeconds: 60,
  timeoutOverflowMode: "throw",
});

// Differences smaller than these are float noise, not usage.
const TOKEN_EPSILON: number = 0.5;
const COST_EPSILON: number = 0.000001;

export interface LlmProviderUsageWriteTarget {
  projectId: ObjectID;
  connectionId: ObjectID;
  connectionName: string;
  genAiProviderName: string;
  serviceId: ObjectID;
  serviceName: string;
  // How long the service keeps metrics, in days.
  retentionInDays: number;
  // The provider reports tokens and no money: price the tokens.
  costIsEstimated: boolean;
  projectPriceOverrides: Array<LlmModelPrice>;
}

// One series of one day: what the metric point's identity is made of.
export interface LlmProviderSeriesPoint {
  day: Date;
  metricName: string;
  // The series attributes (LlmProviderSeriesAttributeKeys); "" when absent.
  attributes: Dictionary<string>;
  value: number;
}

export interface LlmProviderUsageWriteResult {
  // Day-series the provider reported.
  seriesCount: number;
  // Points written (only series whose figure changed).
  pointsWritten: number;
  // The window's totals, as the provider now reports them.
  inputTokens: number;
  outputTokens: number;
  requests: number;
  costUsd: number;
  // Days of the window with any usage.
  daysWithUsage: number;
}

export default class LlmProviderUsageWriter {
  /*
   * The series points a set of records stands for: tokens by type, requests
   * when the provider counts them, and the cost - the provider's when it
   * reports money, else an estimate from the tokens when the provider never
   * does. Records of the same series add up.
   */
  public static toSeriesPoints(data: {
    records: Array<LlmUsageRecord>;
    costIsEstimated: boolean;
    projectPriceOverrides: Array<LlmModelPrice>;
  }): Array<LlmProviderSeriesPoint> {
    const points: Map<string, LlmProviderSeriesPoint> = new Map();

    const add: (
      day: Date,
      metricName: string,
      attributes: Dictionary<string>,
      value: number,
    ) => void = (
      day: Date,
      metricName: string,
      attributes: Dictionary<string>,
      value: number,
    ): void => {
      if (!Number.isFinite(value) || value === 0) {
        return;
      }

      const key: string = LlmProviderUsageWriter.seriesKey(
        day,
        metricName,
        attributes,
      );
      const existing: LlmProviderSeriesPoint | undefined = points.get(key);

      if (existing) {
        existing.value += value;
        return;
      }

      points.set(key, {
        day: day,
        metricName: metricName,
        attributes: attributes,
        value: value,
      });
    };

    for (const record of data.records) {
      const base: Dictionary<string> = {
        [LLM_PROVIDER_MODEL_ATTRIBUTE]: record.model || "",
        [LLM_PROVIDER_PERSON_ATTRIBUTE]: record.person || "",
        [LLM_PROVIDER_PROJECT_ATTRIBUTE]: record.project || "",
        [LLM_PROVIDER_API_KEY_ATTRIBUTE]: record.apiKey || "",
        [LLM_PROVIDER_TOKEN_TYPE_ATTRIBUTE]: "",
        [LLM_PROVIDER_COST_ESTIMATED_ATTRIBUTE]: "",
      };

      const tokens: Array<[LlmProviderTokenType, number]> = [
        [LlmProviderTokenType.Input, record.inputTokens],
        [LlmProviderTokenType.Output, record.outputTokens],
        [LlmProviderTokenType.CacheRead, record.cacheReadTokens],
        [LlmProviderTokenType.CacheWrite, record.cacheWriteTokens],
      ];

      for (const [tokenType, count] of tokens) {
        add(
          record.day,
          LLM_PROVIDER_TOKENS_METRIC_NAME,
          { ...base, [LLM_PROVIDER_TOKEN_TYPE_ATTRIBUTE]: tokenType },
          count,
        );
      }

      if (record.requests !== null && record.requests !== undefined) {
        add(record.day, LLM_PROVIDER_REQUESTS_METRIC_NAME, base, record.requests);
      }

      if (record.costUsd !== null && record.costUsd !== undefined) {
        add(
          record.day,
          LLM_PROVIDER_COST_METRIC_NAME,
          { ...base, [LLM_PROVIDER_COST_ESTIMATED_ATTRIBUTE]: "false" },
          record.costUsd,
        );
      } else if (data.costIsEstimated) {
        const estimate: number | null = LlmUsageCost.estimateDailyCostUsd({
          model: record.model,
          inputTokens: record.inputTokens,
          outputTokens: record.outputTokens,
          cacheReadTokens: record.cacheReadTokens,
          cacheWriteTokens: record.cacheWriteTokens,
          projectPriceOverrides: data.projectPriceOverrides,
        });

        if (estimate !== null) {
          add(
            record.day,
            LLM_PROVIDER_COST_METRIC_NAME,
            { ...base, [LLM_PROVIDER_COST_ESTIMATED_ATTRIBUTE]: "true" },
            estimate,
          );
        }
      }
    }

    return Array.from(points.values());
  }

  /*
   * A day-series' identity: the day, the metric and every series attribute
   * in LlmProviderSeriesAttributeKeys order ("" for one it lacks). A point
   * read back from storage and one built from a record compare equal when
   * they are the same series.
   */
  public static seriesKey(
    day: Date,
    metricName: string,
    attributes: Dictionary<string>,
  ): string {
    const values: Array<string> = LlmProviderSeriesAttributeKeys.map(
      (key: string): string => {
        return attributes[key] || "";
      },
    );

    return JSON.stringify([day.getTime(), metricName, ...values]);
  }

  /*
   * The points to write so storage matches the provider: for every
   * day-series the provider reports or storage holds within the window,
   * the provider's figure minus the stored sum, where they differ.
   */
  public static computeDeltas(data: {
    desired: Array<LlmProviderSeriesPoint>;
    stored: Array<LlmProviderSeriesPoint>;
    window: LlmUsageWindow;
  }): Array<LlmProviderSeriesPoint> {
    const inWindow: (point: LlmProviderSeriesPoint) => boolean = (
      point: LlmProviderSeriesPoint,
    ): boolean => {
      return (
        point.day.getTime() >= data.window.startDay.getTime() &&
        point.day.getTime() < data.window.endDay.getTime()
      );
    };

    const desired: Map<string, LlmProviderSeriesPoint> = new Map();

    for (const point of data.desired.filter(inWindow)) {
      desired.set(
        LlmProviderUsageWriter.seriesKey(
          point.day,
          point.metricName,
          point.attributes,
        ),
        point,
      );
    }

    const stored: Map<string, LlmProviderSeriesPoint> = new Map();

    for (const point of data.stored.filter(inWindow)) {
      const key: string = LlmProviderUsageWriter.seriesKey(
        point.day,
        point.metricName,
        point.attributes,
      );
      const existing: LlmProviderSeriesPoint | undefined = stored.get(key);

      if (existing) {
        existing.value += point.value;
      } else {
        stored.set(key, { ...point });
      }
    }

    const deltas: Array<LlmProviderSeriesPoint> = [];
    const keys: Set<string> = new Set<string>([
      ...Array.from(desired.keys()),
      ...Array.from(stored.keys()),
    ]);

    for (const key of keys) {
      const want: LlmProviderSeriesPoint | undefined = desired.get(key);
      const have: LlmProviderSeriesPoint | undefined = stored.get(key);
      const template: LlmProviderSeriesPoint = (want || have)!;
      const delta: number = (want?.value || 0) - (have?.value || 0);
      const epsilon: number =
        template.metricName === LLM_PROVIDER_COST_METRIC_NAME
          ? COST_EPSILON
          : TOKEN_EPSILON;

      if (Math.abs(delta) < epsilon) {
        continue;
      }

      deltas.push({
        day: template.day,
        metricName: template.metricName,
        attributes: template.attributes,
        value: delta,
      });
    }

    return deltas;
  }

  /*
   * The stored sums of a connection's series over a window: one row per
   * day, metric and series attributes.
   */
  public static buildStoredSumsStatement(data: {
    projectId: ObjectID;
    serviceId: ObjectID;
    connectionId: ObjectID;
    window: LlmUsageWindow;
  }): Statement {
    const statement: Statement = new Statement();

    statement.append(
      "SELECT toUnixTimestamp(toStartOfDay(time, 'UTC')) AS daySeconds, name AS metricName",
    );

    LlmProviderSeriesAttributeKeys.forEach((key: string, index: number) => {
      statement.append(SQL`, attributes[${{
        type: TableColumnType.Text,
        value: key,
      }}]`);
      statement.append(` AS attribute${index}`);
    });

    statement.append(", sum(value) AS total");
    statement.append(` FROM ${METRIC_TABLE}`);
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND primaryEntityId = ${{
        type: TableColumnType.ObjectID,
        value: data.serviceId,
      }} AND name IN ${{
        type: TableColumnType.ArrayText,
        value: LlmProviderUsageMetricNames,
      }} AND time >= ${{
        type: TableColumnType.Date,
        value: data.window.startDay,
      }} AND time < ${{
        type: TableColumnType.Date,
        value: data.window.endDay,
      }} AND attributes[${{
        type: TableColumnType.Text,
        value: LLM_CONNECTION_ID_ATTRIBUTE,
      }}] = ${{
        type: TableColumnType.Text,
        value: data.connectionId.toString(),
      }}`,
    );
    statement.append(" GROUP BY daySeconds, metricName");

    LlmProviderSeriesAttributeKeys.forEach((_key: string, index: number) => {
      statement.append(`, attribute${index}`);
    });

    statement.append(READ_QUERY_SETTINGS);

    return statement;
  }

  // Rows of the stored-sums query, read back as series points.
  public static readStoredSums(
    rows: Array<JSONObject>,
  ): Array<LlmProviderSeriesPoint> {
    const points: Array<LlmProviderSeriesPoint> = [];

    for (const row of rows) {
      const daySeconds: number = Number(row["daySeconds"]);
      const total: number = Number(row["total"]);
      const metricName: string =
        typeof row["metricName"] === "string" ? row["metricName"] : "";

      if (!Number.isFinite(daySeconds) || !Number.isFinite(total)) {
        continue;
      }

      if (!LlmProviderUsageMetricNames.includes(metricName)) {
        continue;
      }

      const attributes: Dictionary<string> = {};

      LlmProviderSeriesAttributeKeys.forEach((key: string, index: number) => {
        const value: unknown = row[`attribute${index}`];
        attributes[key] = typeof value === "string" ? value : "";
      });

      points.push({
        day: new Date(daySeconds * 1000),
        metricName: metricName,
        attributes: attributes,
        value: total,
      });
    }

    return points;
  }

  // The metric rows of a set of delta points, in the Metric table's shape.
  public static buildRows(data: {
    target: LlmProviderUsageWriteTarget;
    deltas: Array<LlmProviderSeriesPoint>;
    now: Date;
  }): Array<JSONObject> {
    const serviceEntityKey: string = keyForService(
      data.target.projectId.toString(),
      data.target.serviceName,
    );
    const createdAt: string = OneUptimeDate.toClickhouseDateTime(data.now);
    const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
      OneUptimeDate.addRemoveDays(data.now, data.target.retentionInDays),
    );

    return data.deltas.map((delta: LlmProviderSeriesPoint): JSONObject => {
      const attributes: Dictionary<string> = {
        [LLM_CONNECTION_ID_ATTRIBUTE]: data.target.connectionId.toString(),
        [LLM_CONNECTION_NAME_ATTRIBUTE]: data.target.connectionName,
        [LLM_PROVIDER_NAME_ATTRIBUTE]: data.target.genAiProviderName,
      };

      for (const key of LlmProviderSeriesAttributeKeys) {
        const value: string | undefined = delta.attributes[key];

        if (value) {
          attributes[key] = value;
        }
      }

      return {
        _id: ObjectID.generateTimeOrdered().toString(),
        projectId: data.target.projectId.toString(),
        primaryEntityId: data.target.serviceId.toString(),
        primaryEntityType: ServiceType.OpenTelemetry,
        entityKeys: [serviceEntityKey],
        serviceEntityKey: serviceEntityKey,
        hostEntityKey: "",
        k8sPodEntityKey: "",
        k8sNodeEntityKey: "",
        k8sClusterEntityKey: "",
        containerEntityKey: "",
        createdAt: createdAt,
        name: delta.metricName,
        time: OneUptimeDate.toClickhouseDateTime(delta.day),
        timeUnixNano: (delta.day.getTime() * 1_000_000).toString(),
        startTime: OneUptimeDate.toClickhouseDateTime(delta.day),
        startTimeUnixNano: (delta.day.getTime() * 1_000_000).toString(),
        metricPointType: MetricPointType.Sum,
        aggregationTemporality: "Delta",
        // A correction can be negative, so the series is not monotonic.
        isMonotonic: false,
        value: delta.value,
        attributes: attributes,
        attributeKeys: Object.keys(attributes).sort(),
        retentionDate: retentionDate,
      };
    });
  }

  /*
   * Bring storage in line with what the provider reports for the window:
   * read the stored sums, write the differences, and register the metric
   * names so they show in the metric picker.
   */
  public static async write(data: {
    target: LlmProviderUsageWriteTarget;
    window: LlmUsageWindow;
    records: Array<LlmUsageRecord>;
    now: Date;
  }): Promise<LlmProviderUsageWriteResult> {
    const desired: Array<LlmProviderSeriesPoint> =
      LlmProviderUsageWriter.toSeriesPoints({
        records: data.records,
        costIsEstimated: data.target.costIsEstimated,
        projectPriceOverrides: data.target.projectPriceOverrides,
      });

    const result: Results = await MetricService.executeQuery(
      LlmProviderUsageWriter.buildStoredSumsStatement({
        projectId: data.target.projectId,
        serviceId: data.target.serviceId,
        connectionId: data.target.connectionId,
        window: data.window,
      }),
    );
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();
    const stored: Array<LlmProviderSeriesPoint> =
      LlmProviderUsageWriter.readStoredSums(
        (response.data || []) as Array<JSONObject>,
      );

    const deltas: Array<LlmProviderSeriesPoint> =
      LlmProviderUsageWriter.computeDeltas({
        desired: desired,
        stored: stored,
        window: data.window,
      });

    if (deltas.length > 0) {
      await MetricService.insertJsonRows(
        LlmProviderUsageWriter.buildRows({
          target: data.target,
          deltas: deltas,
          now: data.now,
        }),
      );
    }

    await LlmProviderUsageWriter.registerMetricTypes(data.target);

    return LlmProviderUsageWriter.summarize(desired, deltas.length);
  }

  public static summarize(
    desired: Array<LlmProviderSeriesPoint>,
    pointsWritten: number,
  ): LlmProviderUsageWriteResult {
    const summary: LlmProviderUsageWriteResult = {
      seriesCount: desired.length,
      pointsWritten: pointsWritten,
      inputTokens: 0,
      outputTokens: 0,
      requests: 0,
      costUsd: 0,
      daysWithUsage: 0,
    };
    const days: Set<number> = new Set<number>();

    for (const point of desired) {
      days.add(point.day.getTime());

      if (point.metricName === LLM_PROVIDER_COST_METRIC_NAME) {
        summary.costUsd += point.value;
      } else if (point.metricName === LLM_PROVIDER_REQUESTS_METRIC_NAME) {
        summary.requests += point.value;
      } else if (
        point.attributes[LLM_PROVIDER_TOKEN_TYPE_ATTRIBUTE] ===
        LlmProviderTokenType.Input
      ) {
        summary.inputTokens += point.value;
      } else if (
        point.attributes[LLM_PROVIDER_TOKEN_TYPE_ATTRIBUTE] ===
        LlmProviderTokenType.Output
      ) {
        summary.outputTokens += point.value;
      }
    }

    summary.daysWithUsage = days.size;
    summary.costUsd = Math.round(summary.costUsd * 1e6) / 1e6;

    return summary;
  }

  /*
   * Registration is what lists the names in the metric picker and the
   * Metrics monitor builder. It must never fail a read.
   */
  private static async registerMetricTypes(
    target: LlmProviderUsageWriteTarget,
  ): Promise<void> {
    const service: Service = new Service();
    service.id = target.serviceId;

    const build: (
      name: string,
      description: string,
      unit: string,
    ) => MetricType = (
      name: string,
      description: string,
      unit: string,
    ): MetricType => {
      const metricType: MetricType = new MetricType();
      metricType.name = name;
      metricType.description = description;
      metricType.unit = unit;
      metricType.services = [service];
      return metricType;
    };

    try {
      await TelemetryUtil.indexMetricNameServiceNameMap({
        projectId: target.projectId,
        metricNameServiceNameMap: {
          [LLM_PROVIDER_COST_METRIC_NAME]: build(
            LLM_PROVIDER_COST_METRIC_NAME,
            "What a connected AI provider account cost, in USD, per UTC day. Sum it over a day; oneuptime.llm.cost.estimated says whether OneUptime priced the tokens.",
            LLM_PROVIDER_COST_UNIT,
          ),
          [LLM_PROVIDER_TOKENS_METRIC_NAME]: build(
            LLM_PROVIDER_TOKENS_METRIC_NAME,
            "Tokens a connected AI provider account used per UTC day, by gen_ai.token.type (input counts cached tokens too).",
            LLM_PROVIDER_TOKENS_UNIT,
          ),
          [LLM_PROVIDER_REQUESTS_METRIC_NAME]: build(
            LLM_PROVIDER_REQUESTS_METRIC_NAME,
            "Requests a connected AI provider account served per UTC day.",
            LLM_PROVIDER_REQUESTS_UNIT,
          ),
        },
      });
    } catch (error) {
      logger.warn(
        `LLM connection metric registration failed for project ${target.projectId.toString()}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
