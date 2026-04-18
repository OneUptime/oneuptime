import { EVERY_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import TraceRecordingRuleService from "Common/Server/Services/TraceRecordingRuleService";
import MetricService from "Common/Server/Services/MetricService";
import TraceRecordingRule from "Common/Models/DatabaseModels/TraceRecordingRule";
import TraceRecordingRuleDefinition, {
  TraceRecordingRuleSource,
} from "Common/Types/Trace/TraceRecordingRuleDefinition";
import TraceAggregationType from "Common/Types/Trace/TraceAggregationType";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
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
 * Trace recording rules — mirror of Metrics/ComputeRecordingRules but source
 * rows come from SpanItemV2 with span-specific aggregations (count, error
 * count, duration percentiles), and the output is still a Metric row so the
 * rest of the system (dashboards, alerts) can use derived values like any
 * other metric.
 */

type PerGroupBindings = Map<string, Record<string, number>>;

// Match the metrics worker: 30s lag lets late-arriving spans land in-bucket.
const EVALUATION_LAG_SECONDS: number = 30;

RunCron(
  "Traces:ComputeRecordingRules",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    try {
      const rules: Array<TraceRecordingRule> =
        await TraceRecordingRuleService.findBy({
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
        `Traces:ComputeRecordingRules: evaluating ${rules.length} enabled rule(s)`,
      );

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
            `Trace recording rule ${rule._id} for project ${rule.projectId?.toString() ?? "?"} failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    } catch (err) {
      logger.error(
        `Traces:ComputeRecordingRules cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);

async function evaluateRuleForBucket(args: {
  rule: TraceRecordingRule;
  startTime: Date;
  endTime: Date;
}): Promise<void> {
  const { rule, startTime, endTime } = args;

  if (!rule.projectId || !rule.outputMetricName || !rule.definition) {
    return;
  }

  let def: TraceRecordingRuleDefinition;
  const raw: unknown = rule.definition as unknown;
  if (typeof raw === "string") {
    try {
      def = JSON.parse(raw) as TraceRecordingRuleDefinition;
    } catch (err) {
      logger.warn(
        `Trace recording rule ${rule._id} has unparseable definition JSON: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return;
    }
  } else {
    def = raw as TraceRecordingRuleDefinition;
  }
  if (!def.sources || def.sources.length === 0 || !def.expression) {
    return;
  }

  const parsed: ParseResult | ParseError = parseExpression(def.expression);
  if (!parsed.ok) {
    logger.warn(
      `Trace recording rule ${rule._id} has invalid expression "${def.expression}": ${parsed.error}`,
    );
    return;
  }
  const ast: ExpressionNode = parsed.ast;

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
    `Trace recording rule ${rule._id?.toString() ?? "?"} wrote ${outRows.length} derived row(s) for bucket ${startTime.toISOString()}`,
  );
}

async function runSourceQuery(args: {
  projectId: ObjectID;
  source: TraceRecordingRuleSource;
  startTime: Date;
  endTime: Date;
  groupByAttribute?: string;
}): Promise<Array<{ group: string; value: number }>> {
  const { projectId, source, startTime, endTime, groupByAttribute } = args;

  const aggregateSql: string = toSpanAggregateSql(source.aggregationType);

  const projectIdStr: string = projectId.toString();
  const startIso: string = OneUptimeDate.toClickhouseDateTime64(startTime);
  const endIso: string = OneUptimeDate.toClickhouseDateTime64(endTime);

  const esc: (s: string) => string = (s: string): string => {
    return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  };

  const filters: Array<string> = [];

  if (source.spanNameRegex) {
    /*
     * Basic regex guard — ClickHouse match() with user input. Input is
     * rule-author controlled, not end-user.
     */
    filters.push(`match(name, '${esc(source.spanNameRegex)}')`);
  }

  if (source.spanKind) {
    filters.push(`kind = '${esc(source.spanKind)}'`);
  }

  if (source.onlyErrors) {
    filters.push(`statusCode = 2`);
  }

  if (source.filterAttributeKey && source.filterAttributeValue) {
    filters.push(
      `attributes['${esc(source.filterAttributeKey)}'] = '${esc(source.filterAttributeValue)}'`,
    );
  }

  const filterSql: string =
    filters.length > 0 ? `AND ${filters.join(" AND ")}` : "";

  let groupSqlSelect: string = "'' AS groupKey";
  let groupSqlGroupBy: string = "";
  if (groupByAttribute) {
    groupSqlSelect = `attributes['${esc(groupByAttribute)}'] AS groupKey`;
    groupSqlGroupBy = "GROUP BY groupKey";
  }

  const sql: string = `
    SELECT ${groupSqlSelect}, ${aggregateSql} AS value
    FROM oneuptime.SpanItemV2
    WHERE projectId = '${esc(projectIdStr)}'
      AND startTime >= toDateTime64('${startIso}', 9)
      AND startTime < toDateTime64('${endIso}', 9)
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

  const parsedResult: {
    data: Array<{ groupKey: string; value: number | string }>;
  } = await resultSet.json();

  const out: Array<{ group: string; value: number }> = [];
  for (const row of parsedResult.data) {
    const n: number =
      typeof row.value === "number" ? row.value : Number(row.value);
    if (!Number.isFinite(n)) {
      continue;
    }
    out.push({ group: row.groupKey ?? "", value: n });
  }
  return out;
}

function toSpanAggregateSql(type: TraceAggregationType): string {
  switch (type) {
    case TraceAggregationType.Count:
      return "count()";
    case TraceAggregationType.ErrorCount:
      return "countIf(statusCode = 2)";
    case TraceAggregationType.AvgDurationSeconds:
      return "avg(durationUnixNano) / 1e9";
    case TraceAggregationType.P50DurationSeconds:
      return "quantile(0.5)(durationUnixNano) / 1e9";
    case TraceAggregationType.P95DurationSeconds:
      return "quantile(0.95)(durationUnixNano) / 1e9";
    case TraceAggregationType.P99DurationSeconds:
      return "quantile(0.99)(durationUnixNano) / 1e9";
    case TraceAggregationType.MaxDurationSeconds:
      return "max(durationUnixNano) / 1e9";
    case TraceAggregationType.MinDurationSeconds:
      return "min(durationUnixNano) / 1e9";
    default:
      return "count()";
  }
}

function buildDerivedMetricRow(args: {
  rule: TraceRecordingRule;
  groupAttribute: string | undefined;
  groupValue: string;
  value: number;
  bucketStart: Date;
}): JSONObject {
  const { rule, groupAttribute, groupValue, value, bucketStart } = args;

  const attributes: Record<string, string> = {
    "oneuptime.derived.trace_rule_id": rule._id?.toString() ?? "",
  };
  if (groupAttribute && groupValue !== "") {
    attributes[groupAttribute] = groupValue;
  }

  const now: Date = OneUptimeDate.getCurrentDate();
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
