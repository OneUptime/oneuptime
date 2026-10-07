import { EVERY_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import logger from "Common/Server/Utils/Logger";
import LogRecordingRuleService from "Common/Server/Services/LogRecordingRuleService";
import LogService from "Common/Server/Services/LogService";
import MetricService from "Common/Server/Services/MetricService";
import {
  DbJSONResponse,
  Results,
} from "Common/Server/Services/AnalyticsDatabaseService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import LogRecordingRuleQuery, {
  LogRecordingRulePoints,
} from "Common/Server/Utils/Telemetry/LogRecordingRuleQuery";
import LogRecordingRuleMetric from "Common/Server/Utils/Telemetry/LogRecordingRuleMetric";
import LogRecordingRule from "Common/Models/DatabaseModels/LogRecordingRule";
import LogRecordingRuleDefinition, {
  LogRecordingRuleDefinitionUtil,
} from "Common/Types/Log/LogRecordingRuleDefinition";
import LogRecordingRuleWindowUtil, {
  LOG_RECORDING_RULE_MAX_CATCH_UP_IN_MINUTES,
  LogRecordingRuleWindow,
} from "Common/Utils/Telemetry/LogRecordingRuleWindow";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";

/*
 * Log recording rules - logs in, metrics out. The sibling of
 * Metrics/ComputeRecordingRules and Traces/ComputeTraceRecordingRules: every
 * minute, every enabled rule aggregates the logs its filter matches (a
 * count, or the sum / average / min / max / a percentile of a numeric
 * attribute) per 1-minute bucket and per group-by series, and the result is
 * written as Metric rows under the rule's output metric name, so charts,
 * dashboards and Metrics monitors read it like any other metric.
 *
 * Unlike those two it does not compute "the previous minute" blindly: a
 * rule remembers the end of the last minute it wrote
 * (LogRecordingRule.computedUntil) and each run computes the minutes since
 * then (Common/Utils/Telemetry/LogRecordingRuleWindow), so downtime of up to
 * an hour leaves no gap and no minute is written twice. A run claims its
 * window with a compare-and-set on that watermark before it queries
 * anything - two overlapping runs cannot both write it - and hands the
 * window back when the query or the write fails, for the next run to retry.
 */

RunCron(
  "Logs:ComputeRecordingRules",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    try {
      const rules: Array<LogRecordingRule> =
        await LogRecordingRuleService.findBy({
          query: { isEnabled: true },
          skip: 0,
          limit: LIMIT_MAX,
          select: {
            _id: true,
            projectId: true,
            name: true,
            description: true,
            outputMetricName: true,
            definition: true,
            computedUntil: true,
          },
          props: { isRoot: true },
        });

      if (rules.length === 0) {
        return;
      }

      logger.debug(
        `Logs:ComputeRecordingRules: evaluating ${rules.length} enabled rule(s)`,
      );

      const now: Date = OneUptimeDate.getCurrentDate();

      for (const rule of rules) {
        try {
          await computeRule({ rule, now });
        } catch (err) {
          logger.error(
            `Log recording rule ${rule._id} for project ${rule.projectId?.toString() ?? "?"} failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    } catch (err) {
      logger.error(
        `Logs:ComputeRecordingRules cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);

async function computeRule(args: {
  rule: LogRecordingRule;
  now: Date;
}): Promise<void> {
  const { rule, now } = args;

  if (
    !rule.id ||
    !rule.projectId ||
    !rule.outputMetricName ||
    !rule.definition
  ) {
    return;
  }

  /*
   * The service refuses an invalid definition, so this only catches a row
   * written around it. Such a rule is skipped, not claimed: once it is
   * fixed, its missed minutes are still within reach of the catch-up.
   */
  const validationError: string | null =
    LogRecordingRuleDefinitionUtil.getValidationError(rule.definition);

  if (validationError) {
    logger.warn(
      `Log recording rule ${rule.id.toString()} has an invalid definition and was skipped: ${validationError}`,
    );
    return;
  }

  const definition: LogRecordingRuleDefinition =
    LogRecordingRuleDefinitionUtil.normalize(
      LogRecordingRuleDefinitionUtil.fromJSON(rule.definition)!,
    );

  const computedUntil: Date | null = rule.computedUntil || null;

  const window: LogRecordingRuleWindow | null =
    LogRecordingRuleWindowUtil.getWindow({ now, computedUntil });

  if (!window) {
    return;
  }

  if (window.skippedMinutes > 0) {
    logger.warn(
      `Log recording rule ${rule.id.toString()} last ran more than ${LOG_RECORDING_RULE_MAX_CATCH_UP_IN_MINUTES} minutes ago: ${window.skippedMinutes} minute(s) before ${window.startTime.toISOString()} were not computed.`,
    );
  }

  /*
   * Claim the window: the watermark moves only if it still holds what this
   * run read. Another run that got there first wins, and this one leaves
   * the window to it.
   */
  const claimed: boolean =
    await LogRecordingRuleService.compareAndSetColumnsByIdWithoutHooks({
      id: rule.id,
      data: { computedUntil: window.endTime },
      expectedData: { computedUntil: computedUntil },
      skipUpdateDateColumn: true,
    });

  if (!claimed) {
    logger.debug(
      `Log recording rule ${rule.id.toString()}: another run claimed the window ending ${window.endTime.toISOString()}.`,
    );
    return;
  }

  try {
    await computeWindow({ rule, definition, window, now });
  } catch (err) {
    await releaseWindow({ ruleId: rule.id, computedUntil, window });
    throw err;
  }
}

async function computeWindow(args: {
  rule: LogRecordingRule;
  definition: LogRecordingRuleDefinition;
  window: LogRecordingRuleWindow;
  now: Date;
}): Promise<void> {
  const { rule, definition, window, now } = args;

  const statement: Statement = LogRecordingRuleQuery.buildStatement({
    projectId: rule.projectId!,
    definition,
    window,
  });

  const result: Results = await LogService.executeQuery(statement);
  const response: DbJSONResponse = await result.json<{
    data?: Array<JSONObject>;
  }>();

  const { points, truncatedMinutes }: LogRecordingRulePoints =
    LogRecordingRuleQuery.readPoints({
      rows: response.data || [],
      definition,
      window,
    });

  if (truncatedMinutes.length > 0) {
    logger.warn(
      `Log recording rule ${rule.id!.toString()} reached the series cap in ${truncatedMinutes.length} minute(s) starting ${truncatedMinutes[0]!.toISOString()}; only the busiest series were written. Group by fewer or lower-cardinality attributes.`,
    );
  }

  if (points.length === 0) {
    return;
  }

  const rows: Array<JSONObject> = LogRecordingRuleMetric.buildRows({
    ruleId: rule.id!,
    projectId: rule.projectId!,
    outputMetricName: rule.outputMetricName!,
    points,
    now,
  });

  await MetricService.insertJsonRows(rows);

  /*
   * Registering the name is what lists the metric in the metric pickers.
   * Fire-and-forget, like the other derived-metric writers: the catalogue is
   * fenced by a cache and reconciles on the next run, so a slow or failed
   * index write must not fail - and so hand back - a window already written.
   */
  TelemetryUtil.indexMetricNameServiceNameMap({
    projectId: rule.projectId!,
    metricNameServiceNameMap: {
      [rule.outputMetricName!]: LogRecordingRuleMetric.buildMetricType({
        outputMetricName: rule.outputMetricName!,
        ruleName: rule.name,
        ruleDescription: rule.description,
        definition,
      }),
    },
  }).catch((err: Error) => {
    logger.error(err);
  });

  logger.debug(
    `Log recording rule ${rule.id!.toString()} wrote ${rows.length} point(s) for ${window.startTime.toISOString()} - ${window.endTime.toISOString()}`,
  );
}

/*
 * Moves the watermark back to where this run found it, if it is still where
 * this run put it, so the next run computes the window again instead of
 * leaving a gap. Best effort: if it fails too, the window is lost - logged.
 */
async function releaseWindow(args: {
  ruleId: ObjectID;
  computedUntil: Date | null;
  window: LogRecordingRuleWindow;
}): Promise<void> {
  try {
    await LogRecordingRuleService.compareAndSetColumnsByIdWithoutHooks({
      id: args.ruleId,
      data: { computedUntil: args.computedUntil },
      expectedData: { computedUntil: args.window.endTime },
      skipUpdateDateColumn: true,
    });
  } catch (err) {
    logger.error(
      `Log recording rule ${args.ruleId.toString()} could not hand back the window ${args.window.startTime.toISOString()} - ${args.window.endTime.toISOString()}; those minutes will not be computed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
