import { EVERY_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import MetricRecordingRuleService from "Common/Server/Services/MetricRecordingRuleService";
import MetricService from "Common/Server/Services/MetricService";
import MetricRecordingRule from "Common/Models/DatabaseModels/MetricRecordingRule";
import RecordingRuleDefinition, {
  RecordingRuleSource,
} from "Common/Types/Metrics/RecordingRuleDefinition";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import {
  MetricPointType,
  ServiceType,
} from "Common/Models/AnalyticsModels/Metric";
import { JSONObject } from "Common/Types/JSON";
import {
  evaluate,
  parse as parseExpression,
  type Node as ExpressionNode,
  type ParseError,
  type ParseResult,
} from "Common/Utils/Metrics/RecordingRuleExpression";

/*
 * ClickHouse side: we reach into AnalyticsDatabaseService.executeQuery
 * (inherited by MetricService) to run the grouped aggregation per source.
 * Using SQL directly keeps the cron tight and avoids bending the existing
 * AggregateBy type (which is designed for charting, not rule-compute).
 */

/*
 * The empty string is used as the "no-group" group key when the rule has no
 * groupByAttribute set. We round source timestamps to the evaluation bucket
 * so a cron tick that arrives late still aggregates the full 1-minute slice.
 */

type PerGroupBindings = Map<string, Record<string, number>>;

/*
 * Evaluate-window lag: we wait this long before computing the window so late
 * data points (up to this amount late) still get included. Trades point
 * freshness for completeness. Kept small since a long lag defeats the point
 * of sub-minute cadence.
 */
const EVALUATION_LAG_SECONDS: number = 30;

RunCron(
  "Metrics:ComputeRecordingRules",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    try {
      const rules: Array<MetricRecordingRule> =
        await MetricRecordingRuleService.findBy({
          query: { isEnabled: true },
          skip: 0,
          limit: LIMIT_MAX,
          select: {
            _id: true,
            projectId: true,
            outputMetricName: true,
            definition: true,
          },
          props: { isRoot: true },
        });

      if (rules.length === 0) {
        return;
      }

      logger.debug(
        `ComputeRecordingRules: evaluating ${rules.length} enabled rule(s)`,
      );

      /*
       * Compute one 1-minute bucket that ends EVALUATION_LAG_SECONDS ago,
       * rounded to the prior minute boundary.
       */
      const now: Date = OneUptimeDate.getCurrentDate();
      const endTime: Date = startOfMinute(
        OneUptimeDate.addRemoveSeconds(now, -EVALUATION_LAG_SECONDS),
      );
      const startTime: Date = OneUptimeDate.addRemoveMinutes(endTime, -1);

      for (const rule of rules) {
        try {
          await evaluateRuleForBucket({ rule, startTime, endTime });
        } catch (err) {
          logger.error(
            `Recording rule ${rule._id} for project ${rule.projectId?.toString() ?? "?"} failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    } catch (err) {
      logger.error(
        `ComputeRecordingRules cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);

async function evaluateRuleForBucket(args: {
  rule: MetricRecordingRule;
  startTime: Date;
  endTime: Date;
}): Promise<void> {
  const { rule, startTime, endTime } = args;

  if (!rule.projectId || !rule.outputMetricName || !rule.definition) {
    return;
  }

  /*
   * The FormFieldSchemaType.JSON field in the Dashboard stores the value
   * JSON-encoded as a string inside the JSONB column, so we handle both
   * shapes defensively.
   */
  let def: RecordingRuleDefinition;
  const raw: unknown = rule.definition as unknown;
  if (typeof raw === "string") {
    try {
      def = JSON.parse(raw) as RecordingRuleDefinition;
    } catch (err) {
      logger.warn(
        `Recording rule ${rule._id} has unparseable definition JSON: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return;
    }
  } else {
    def = raw as RecordingRuleDefinition;
  }
  if (!def.sources || def.sources.length === 0 || !def.expression) {
    return;
  }

  /*
   * Parse the expression once per rule evaluation — cheap, and lets us bail
   * early on bad input without touching ClickHouse.
   */
  const parsed: ParseResult | ParseError = parseExpression(def.expression);
  if (!parsed.ok) {
    logger.warn(
      `Recording rule ${rule._id} has invalid expression "${def.expression}": ${parsed.error}`,
    );
    return;
  }
  const ast: ExpressionNode = parsed.ast;

  /*
   * Query each source separately and collect per-group values. For simple
   * v1 volumes this is fine; if per-cron query count becomes the bottleneck
   * later, we can union them into one query.
   */
  const bindingsByGroup: PerGroupBindings = new Map();

  for (const source of def.sources) {
    const rows: Array<{ group: string; value: number }> = await runSourceQuery({
      projectId: rule.projectId,
      source,
      startTime,
      endTime,
      ...(def.groupByAttribute
        ? { groupByAttribute: def.groupByAttribute }
        : {}),
    });

    for (const row of rows) {
      let bucket: Record<string, number> | undefined = bindingsByGroup.get(
        row.group,
      );
      if (!bucket) {
        bucket = {};
        bindingsByGroup.set(row.group, bucket);
      }
      bucket[source.alias] = row.value;
    }
  }

  if (bindingsByGroup.size === 0) {
    return;
  }

  /*
   * Evaluate the expression per group. Skip groups with a non-finite result
   * (division by zero, missing binding, overflow) — we don't want to write
   * bad data points.
   */
  const outRows: Array<JSONObject> = [];
  for (const [groupValue, bindings] of bindingsByGroup.entries()) {
    const result: number | null = evaluate(ast, bindings);
    if (result === null) {
      continue;
    }
    outRows.push(
      buildDerivedMetricRow({
        rule,
        groupAttribute: def.groupByAttribute,
        groupValue,
        value: result,
        bucketStart: startTime,
      }),
    );
  }

  if (outRows.length === 0) {
    return;
  }

  await MetricService.insertJsonRows(outRows);

  logger.debug(
    `Recording rule ${rule._id?.toString() ?? "?"} wrote ${outRows.length} derived row(s) for bucket ${startTime.toISOString()}`,
  );
}

async function runSourceQuery(args: {
  projectId: ObjectID;
  source: RecordingRuleSource;
  startTime: Date;
  endTime: Date;
  groupByAttribute?: string;
}): Promise<Array<{ group: string; value: number }>> {
  const { projectId, source, startTime, endTime, groupByAttribute } = args;

  const aggregateSql: string = toAggregateSql(source.aggregationType);

  /*
   * We build a plain SQL string with values escaped ourselves. Inputs are
   * tightly constrained (UUID projectId, validated metric name, ISO dates,
   * optional single-attribute key/value from the same user who authored the
   * rule). No untrusted end-user data reaches this path.
   */
  const projectIdStr: string = projectId.toString();
  const startIso: string = OneUptimeDate.toClickhouseDateTime64(startTime);
  const endIso: string = OneUptimeDate.toClickhouseDateTime64(endTime);

  const esc: (s: string) => string = (s: string): string => {
    return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  };

  let filterSql: string = "";
  if (source.filterAttributeKey && source.filterAttributeValue) {
    filterSql = `AND attributes['${esc(source.filterAttributeKey)}'] = '${esc(source.filterAttributeValue)}'`;
  }

  let groupSqlSelect: string = "'' AS groupKey";
  let groupSqlGroupBy: string = "";
  if (groupByAttribute) {
    groupSqlSelect = `attributes['${esc(groupByAttribute)}'] AS groupKey`;
    groupSqlGroupBy = "GROUP BY groupKey";
  }

  const sql: string = `
    SELECT ${groupSqlSelect}, ${aggregateSql} AS value
    FROM oneuptime.MetricItemV2
    WHERE projectId = '${esc(projectIdStr)}'
      AND name = '${esc(source.metricName)}'
      AND time >= toDateTime64('${startIso}', 9)
      AND time < toDateTime64('${endIso}', 9)
      ${filterSql}
    ${groupSqlGroupBy}
  `;

  const resultSet: {
    json: () => Promise<{
      data: Array<{ groupKey: string; value: number | string }>;
    }>;
  } = (await MetricService.executeQuery(sql)) as unknown as {
    json: () => Promise<{
      data: Array<{ groupKey: string; value: number | string }>;
    }>;
  };

  const parsed: {
    data: Array<{ groupKey: string; value: number | string }>;
  } = await resultSet.json();

  const out: Array<{ group: string; value: number }> = [];
  for (const row of parsed.data) {
    const n: number =
      typeof row.value === "number" ? row.value : Number(row.value);
    if (!Number.isFinite(n)) {
      continue;
    }
    out.push({ group: row.groupKey ?? "", value: n });
  }
  return out;
}

function toAggregateSql(type: AggregationType): string {
  switch (type) {
    case AggregationType.Sum:
      return "sum(value)";
    case AggregationType.Avg:
      return "avg(value)";
    case AggregationType.Count:
      return "count()";
    case AggregationType.Max:
      return "max(value)";
    case AggregationType.Min:
      return "min(value)";
    /*
     * Percentile recording rules materialize against the per-row `value`
     * column. For Sum/Gauge metrics this is the right thing. For
     * histograms it gives a percentile-of-aggregated-value rather than a
     * percentile-of-distribution; users who want bucket-derived
     * percentiles in materialized rules should pre-flatten with
     * MetricService's percentile aggregation instead.
     */
    case AggregationType.P50:
      return "quantile(0.5)(value)";
    case AggregationType.P90:
      return "quantile(0.9)(value)";
    case AggregationType.P95:
      return "quantile(0.95)(value)";
    case AggregationType.P99:
      return "quantile(0.99)(value)";
  }
}

function buildDerivedMetricRow(args: {
  rule: MetricRecordingRule;
  groupAttribute: string | undefined;
  groupValue: string;
  value: number;
  bucketStart: Date;
}): JSONObject {
  const { rule, groupAttribute, groupValue, value, bucketStart } = args;

  const attributes: Record<string, string> = {
    "oneuptime.derived.rule_id": rule._id?.toString() ?? "",
  };
  if (groupAttribute && groupValue !== "") {
    attributes[groupAttribute] = groupValue;
  }

  const now: Date = OneUptimeDate.getCurrentDate();
  /*
   * Derived rows inherit project default retention since they may span
   * many services. 15 days matches the Service default.
   */
  const retentionDate: Date = OneUptimeDate.addRemoveDays(now, 15);

  return {
    _id: ObjectID.generate().toString(),
    projectId: rule.projectId!.toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(now),
    updatedAt: OneUptimeDate.toClickhouseDateTime(now),
    time: OneUptimeDate.toClickhouseDateTime(bucketStart),
    timeUnixNano: (bucketStart.getTime() * 1_000_000).toString(),
    serviceType: ServiceType.OpenTelemetry,
    name: rule.outputMetricName,
    metricPointType: MetricPointType.Gauge,
    value: value,
    attributes: attributes,
    attributeKeys: Object.keys(attributes).sort(),
    retentionDate: OneUptimeDate.toClickhouseDateTime(retentionDate),
  };
}

function startOfMinute(d: Date): Date {
  const r: Date = new Date(d.getTime());
  r.setSeconds(0, 0);
  return r;
}
