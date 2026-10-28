import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  SecurityEntityType,
  inferSecurityEntityType,
  securityEntityTypeForField,
} from "../../../Types/SecurityCase/SecurityEntity";
import {
  DETECTION_MATCH_COUNT_THRESHOLD_MAX,
  DETECTION_MATCH_COUNT_THRESHOLD_MIN,
  DETECTION_EVALUATION_INTERVAL_MAX_IN_MINUTES,
  DETECTION_EVALUATION_INTERVAL_MIN_IN_MINUTES,
} from "../../../Types/SecurityEvent/DetectionFindingConstants";
import {
  DETECTION_RETROHUNT_MAX_GROUPS,
  DetectionRetrohuntGroup,
  DetectionRetrohuntResult,
  isDetectionRetrohuntPeriod,
} from "../../../Types/SecurityEvent/DetectionRetrohunt";
import { DetectionRuleExceptionShape } from "../../../Types/SecurityEvent/DetectionRuleException";
import { DetectionRuleDefinition } from "../../../Types/SecurityEvent/SigmaCorrelation";
import SigmaRule from "../../../Types/SecurityEvent/SigmaRule";
import SigmaRuleSetParser, {
  sigmaRulesOf,
} from "../../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import {
  DbJSONResponse,
  Results,
} from "../../Services/AnalyticsDatabaseService";
import SecurityEventService, {
  DetectionMatchGroup,
} from "../../Services/SecurityEventService";
import {
  INTERACTIVE_READ_TIME_LIMIT,
  getQuerySettings,
} from "../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import CaptureSpan from "../Telemetry/CaptureSpan";
import TelemetryReadScopeUtil, {
  TelemetryServiceFilter,
} from "../Telemetry/TelemetryReadScope";
import { CORRELATION_TEMPORAL_CANDIDATE_LIMIT } from "./Correlation/CorrelationQueries";
import CorrelationRuleMatcher, {
  CorrelationMatchResult,
} from "./Correlation/CorrelationRuleMatcher";
import ProjectSigmaRules from "./Correlation/ProjectSigmaRules";
import DetectionRuleExceptions, {
  andRestrictions,
  buildDetectionRuleExceptionsFilter,
  buildDetectionRuleExceptionsMatch,
} from "./DetectionRuleExceptions";
import SigmaClickhouseCompiler, {
  buildSigmaDistinctCountExpression,
  buildSigmaFieldExpression,
} from "./Sigma/SigmaClickhouseCompiler";

/*
 * RETROHUNT: a detection rule run over past events, to see what it would
 * have found (Types/SecurityEvent/DetectionRetrohunt).
 *
 * The rule is the one the person is looking at: a saved rule, or the rule
 * as it stands in the form, saved or not. Its exceptions - a saved rule's -
 * skip what they name, as in its runs. It reads only the sources the person
 * may read, stops at INTERACTIVE_READ_TIME_LIMIT (an answer that took too
 * long says so, as 504), and writes nothing anywhere.
 *
 * A single rule is read in one statement, in three steps:
 *
 *   1. per window as long as the rule's interval and per group: its
 *      events, and those its exceptions leave, and whether the group fires
 *      in the window - with the exceptions, and without them;
 *   2. per group: the windows it fires in, the events behind them, the
 *      first and the last, the latest sample, the firings the exceptions
 *      prevented, the events they skipped, and every event it matched;
 *   3. the groups that fired most, with the totals over every group - one
 *      that never fired included, so a rule that would not have fired
 *      still says how many events it matched.
 *
 * A correlation is read once over the whole period by its own matcher,
 * with the exceptions in every read.
 */

// What a retrohunt is asked: the rule, as saved or as the form holds it.
export interface DetectionRetrohuntRule {
  // A saved rule's id: its exceptions apply, and a correlation never reads the rule itself.
  id?: ObjectID | undefined;
  sigmaRuleYaml: string;
  groupByField?: string | undefined;
  distinctCountField?: string | undefined;
  matchCountThreshold?: number | undefined;
  evaluationIntervalInMinutes?: number | undefined;
}

export interface DetectionRetrohuntRequest {
  projectId: ObjectID;
  rule: DetectionRetrohuntRule;
  periodInHours: number;
  // The sources the person may read (TelemetryReadAccess.getServiceFilter).
  serviceFilter: TelemetryServiceFilter;
  // When the run is made; the period ends here.
  now?: Date | undefined;
}

// How a single rule is counted, read from the request and checked.
export interface DetectionRetrohuntCounting {
  windowInMinutes: number;
  threshold: number;
  groupByField: string;
  distinctCountField: string;
}

// The rows the single rule's statement answers with.
interface SingleRuleRow {
  groupValue: string;
  firedCount: number;
  eventCount: number;
  firstFiredAt: Date | null;
  lastFiredAt: Date | null;
  sampleMessage: string;
  preventedCount: number;
  skippedCount: number;
  matchedCount: number;
  totalFired: number;
  totalGroups: number;
  totalEvents: number;
  totalPrevented: number;
  totalSkipped: number;
  totalMatched: number;
}

function readCount(value: unknown): number {
  const count: number = Number(value);
  return Number.isFinite(count) ? count : 0;
}

/*
 * A DateTime as ClickHouse writes it ("2026-10-21 14:05:00", UTC). The
 * epoch - what minIf answers for a group that never fired - is none.
 */
function readDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const text: string = String(value);
  const date: Date = new Date(
    text.includes("T") ? text : `${text.replace(" ", "T")}Z`,
  );

  if (Number.isNaN(date.getTime()) || date.getTime() <= 0) {
    return null;
  }

  return date;
}

// A whole number in a range, or the default when none was given; a 400 out of range.
function readWholeNumber(data: {
  value: number | undefined;
  defaultValue: number;
  min: number;
  max: number;
  message: string;
}): number {
  if (data.value === undefined || data.value === null) {
    return data.defaultValue;
  }

  if (
    !Number.isInteger(data.value) ||
    data.value < data.min ||
    data.value > data.max
  ) {
    throw new BadDataException(data.message);
  }

  return data.value;
}

export function readDetectionRetrohuntCounting(
  rule: DetectionRetrohuntRule,
): DetectionRetrohuntCounting {
  return {
    windowInMinutes: readWholeNumber({
      value: rule.evaluationIntervalInMinutes,
      defaultValue: 1,
      min: DETECTION_EVALUATION_INTERVAL_MIN_IN_MINUTES,
      max: DETECTION_EVALUATION_INTERVAL_MAX_IN_MINUTES,
      message: `Evaluation interval must be a whole number of minutes between ${DETECTION_EVALUATION_INTERVAL_MIN_IN_MINUTES} and ${DETECTION_EVALUATION_INTERVAL_MAX_IN_MINUTES}.`,
    }),
    threshold: readWholeNumber({
      value: rule.matchCountThreshold,
      defaultValue: 1,
      min: DETECTION_MATCH_COUNT_THRESHOLD_MIN,
      max: DETECTION_MATCH_COUNT_THRESHOLD_MAX,
      message: `Match count threshold must be a whole number between ${DETECTION_MATCH_COUNT_THRESHOLD_MIN} and ${DETECTION_MATCH_COUNT_THRESHOLD_MAX}.`,
    }),
    groupByField: (rule.groupByField || "").trim(),
    distinctCountField: (rule.distinctCountField || "").trim(),
  };
}

/*
 * The single rule's statement (see the top of this file). `skipped` is the
 * condition an event meets when an exception skips it (null: none does).
 */
export function buildSingleRuleRetrohuntStatement(data: {
  projectId: ObjectID;
  tableName: string;
  ruleWhere: Statement;
  counting: DetectionRetrohuntCounting;
  skipped: Statement | null;
  serviceFilter: TelemetryServiceFilter;
  startTime: Date;
  endTime: Date;
  maxGroups: number;
}): Statement {
  const { counting } = data;
  const groupExpression: Statement | null = counting.groupByField
    ? buildSigmaFieldExpression(counting.groupByField)
    : null;
  const distinctExpression: Statement | null = counting.distinctCountField
    ? buildSigmaDistinctCountExpression(counting.distinctCountField)
    : null;

  // 1. Per window and group.
  const windows: Statement = SQL`WITH `;
  if (data.skipped) {
    windows.append(SQL`(`);
    windows.append(data.skipped);
    windows.append(")");
  } else {
    windows.append("false");
  }
  windows.append(
    SQL` AS __skipped SELECT toStartOfInterval(time, toIntervalMinute(${{
      type: TableColumnType.Number,
      value: counting.windowInMinutes,
    }})) AS __window, `,
  );

  if (groupExpression) {
    windows.append("toString(");
    windows.append(groupExpression);
    windows.append(")");
  } else {
    windows.append("''");
  }

  windows.append(
    " AS __group, countIf(NOT __skipped) AS __kept, count() AS __all, anyIf(message, NOT __skipped) AS __sample, ",
  );

  if (distinctExpression) {
    windows.append("uniqExactIf(nullIf(");
    windows.append(distinctExpression);
    windows.append(
      ", ''), NOT __skipped) AS __keptDistinct, uniqExact(nullIf(",
    );
    windows.append(distinctExpression);
    windows.append(", '')) AS __allDistinct, ");
  } else {
    windows.append("__kept AS __keptDistinct, __all AS __allDistinct, ");
  }

  // A group fires in a window when its count there reaches the threshold, as a run's does.
  windows.append(
    SQL`(__kept > 0 AND __keptDistinct >= ${{
      type: TableColumnType.Number,
      value: counting.threshold,
    }}) AS __fired, (__all > 0 AND __allDistinct >= ${{
      type: TableColumnType.Number,
      value: counting.threshold,
    }}) AS __firedWithout FROM `,
  );
  windows.append(data.tableName);
  windows.append(
    SQL` WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND time >= ${{
      type: TableColumnType.DateTime64,
      value: data.startTime,
    }} AND time < ${{
      type: TableColumnType.DateTime64,
      value: data.endTime,
    }} AND (`,
  );
  windows.append(data.ruleWhere);
  windows.append(")");
  TelemetryReadScopeUtil.appendServiceFilter(windows, data.serviceFilter);
  windows.append(" GROUP BY __window, __group");

  // 2. Per group.
  const groups: Statement = SQL`SELECT __group AS groupValue, countIf(__fired) AS firedCount, sumIf(__kept, __fired) AS eventCount, minIf(__window, __fired) AS firstFiredAt, maxIf(__window, __fired) AS lastFiredAt, argMaxIf(__sample, __window, __fired) AS sampleMessage, countIf(__firedWithout AND NOT __fired) AS preventedCount, sum(__all - __kept) AS skippedCount, sum(__kept) AS matchedCount FROM (`;
  groups.append(windows);
  groups.append(") GROUP BY __group");

  /*
   * 3. The groups that fired most, and the totals over every group. Every
   * group has an event (the read is of the rule's matches), so none is
   * left out of the totals; the ones that fired sort first.
   */
  const statement: Statement = SQL`SELECT groupValue, firedCount, eventCount, firstFiredAt, lastFiredAt, sampleMessage, preventedCount, skippedCount, matchedCount, sum(firedCount) OVER () AS totalFired, countIf(firedCount > 0) OVER () AS totalGroups, sum(eventCount) OVER () AS totalEvents, sum(preventedCount) OVER () AS totalPrevented, sum(skippedCount) OVER () AS totalSkipped, sum(matchedCount) OVER () AS totalMatched FROM (`;
  statement.append(groups);
  statement.append(
    SQL`) ORDER BY firedCount DESC, eventCount DESC, groupValue ASC LIMIT ${{
      type: TableColumnType.Number,
      value: data.maxGroups,
    }}`,
  );
  statement.append(getQuerySettings(INTERACTIVE_READ_TIME_LIMIT));

  return statement;
}

// The rows of the single rule's statement, read.
export function readSingleRuleRetrohuntRows(
  rows: Array<JSONObject>,
): Array<SingleRuleRow> {
  return rows.map((row: JSONObject): SingleRuleRow => {
    return {
      groupValue: String(row["groupValue"] ?? ""),
      firedCount: readCount(row["firedCount"]),
      eventCount: readCount(row["eventCount"]),
      firstFiredAt: readDate(row["firstFiredAt"]),
      lastFiredAt: readDate(row["lastFiredAt"]),
      sampleMessage: String(row["sampleMessage"] ?? ""),
      preventedCount: readCount(row["preventedCount"]),
      skippedCount: readCount(row["skippedCount"]),
      matchedCount: readCount(row["matchedCount"]),
      totalFired: readCount(row["totalFired"]),
      totalGroups: readCount(row["totalGroups"]),
      totalEvents: readCount(row["totalEvents"]),
      totalPrevented: readCount(row["totalPrevented"]),
      totalSkipped: readCount(row["totalSkipped"]),
      totalMatched: readCount(row["totalMatched"]),
    };
  });
}

/*
 * The kind of entity a group's value is: by the field the rule groups by
 * when that field says, else by the value's shape ("" when it is none).
 */
export function getRetrohuntEntityType(
  groupByField: string | undefined,
  value: string,
): string {
  if (!value) {
    return "";
  }

  const type: SecurityEntityType =
    securityEntityTypeForField(groupByField) || inferSecurityEntityType(value);

  return type === SecurityEntityType.Other ? "" : type;
}

/*
 * What a single rule's rows say: the groups that fired, the most first,
 * and the totals. The rows may hold one more group than are listed (the
 * statement reads one more than it lists, to tell there are more), and
 * groups that never fired - only kept from it by the exceptions, or only
 * skipped - which count in the totals and are not listed.
 */
export function summarizeSingleRuleRetrohunt(data: {
  rows: Array<SingleRuleRow>;
  counting: DetectionRetrohuntCounting;
  exceptionCount: number;
  startTime: Date;
  endTime: Date;
  periodInHours: number;
  maxGroups: number;
}): DetectionRetrohuntResult {
  const first: SingleRuleRow | undefined = data.rows[0];

  const fired: Array<SingleRuleRow> = data.rows.filter(
    (row: SingleRuleRow): boolean => {
      return row.firedCount > 0;
    },
  );

  const totalGroups: number = first ? first.totalGroups : 0;

  return {
    startTime: data.startTime,
    endTime: data.endTime,
    periodInHours: data.periodInHours,
    isCorrelation: false,
    windowInMinutes: data.counting.windowInMinutes,
    threshold: data.counting.threshold,
    firedCount: first ? first.totalFired : 0,
    groupCount: totalGroups,
    eventCount: first ? first.totalEvents : 0,
    matchedEventCount: first ? first.totalMatched : 0,
    exceptionCount: data.exceptionCount,
    skippedEventCount: first ? first.totalSkipped : 0,
    preventedFiredCount: first ? first.totalPrevented : 0,
    groups: fired
      .slice(0, data.maxGroups)
      .map((row: SingleRuleRow): DetectionRetrohuntGroup => {
        return {
          value: row.groupValue,
          entityType: getRetrohuntEntityType(
            data.counting.groupByField,
            row.groupValue,
          ),
          firedCount: row.firedCount,
          eventCount: row.eventCount,
          firstFiredAt: row.firstFiredAt,
          lastFiredAt: row.lastFiredAt,
          sampleMessage: row.sampleMessage,
          summary: "",
        };
      }),
    hasMoreGroups: totalGroups > Math.min(fired.length, data.maxGroups),
    candidateLimit: null,
  };
}

// What a correlation's groups say.
export function summarizeCorrelationRetrohunt(data: {
  match: CorrelationMatchResult;
  exceptionCount: number;
  startTime: Date;
  endTime: Date;
  periodInHours: number;
  maxGroups: number;
  groupByFields: Array<string>;
}): DetectionRetrohuntResult {
  const groups: Array<DetectionMatchGroup> = data.match.groups;

  let eventCount: number = 0;

  for (const group of groups) {
    eventCount += group.matchCount;
  }

  return {
    startTime: data.startTime,
    endTime: data.endTime,
    periodInHours: data.periodInHours,
    isCorrelation: true,
    windowInMinutes: 0,
    threshold: null,
    firedCount: Math.min(groups.length, data.maxGroups),
    groupCount: Math.min(groups.length, data.maxGroups),
    eventCount,
    matchedEventCount: null,
    exceptionCount: data.exceptionCount,
    skippedEventCount: null,
    preventedFiredCount: null,
    groups: groups
      .slice(0, data.maxGroups)
      .map((group: DetectionMatchGroup): DetectionRetrohuntGroup => {
        // A group of one field is typed by it; a group of several, by its first.
        const firstField: { field: string; value: string } | undefined =
          group.groupFields?.[0];

        return {
          value: group.groupValue,
          entityType:
            group.groupFields && group.groupFields.length === 1 && firstField
              ? getRetrohuntEntityType(firstField.field, firstField.value)
              : getRetrohuntEntityType(
                  data.groupByFields.length === 1
                    ? data.groupByFields[0]
                    : undefined,
                  group.groupValue,
                ),
          firedCount: 1,
          eventCount: group.matchCount,
          firstFiredAt: null,
          lastFiredAt: null,
          sampleMessage: group.sampleMessage,
          summary: group.summary || "",
        };
      }),
    hasMoreGroups: groups.length > data.maxGroups,
    candidateLimit: data.match.candidatesCapped
      ? CORRELATION_TEMPORAL_CANDIDATE_LIMIT
      : null,
  };
}

// The sources a person may read, as a restriction on a correlation's reads; null for every source.
function sourceRestriction(filter: TelemetryServiceFilter): Statement | null {
  const hasFilter: boolean =
    Boolean(filter.serviceIds && filter.serviceIds.length > 0) ||
    Boolean(filter.excludedServiceIds && filter.excludedServiceIds.length > 0);

  if (!hasFilter) {
    return null;
  }

  const statement: Statement = SQL`1 = 1`;
  TelemetryReadScopeUtil.appendServiceFilter(statement, filter);
  return statement;
}

export default class DetectionRuleRetrohunt {
  /*
   * The rule's definition: parsed and checked as a save checks it (every
   * rule it reads compiled), so a mistake in the form's YAML is answered
   * with what to change - as a 400, never as an empty result.
   */
  public static async loadDefinition(data: {
    projectId: ObjectID;
    rule: DetectionRetrohuntRule;
  }): Promise<DetectionRuleDefinition> {
    if (!data.rule.sigmaRuleYaml || !data.rule.sigmaRuleYaml.trim()) {
      throw new BadDataException("Sigma rule YAML is required.");
    }

    let definition: DetectionRuleDefinition = SigmaRuleSetParser.parse(
      data.rule.sigmaRuleYaml,
    );

    /*
     * A correlation naming rules its file does not hold reads them from the
     * project's detection rules, as its runs do - never from the rule
     * itself.
     */
    if (
      definition.kind === "correlation" &&
      definition.unresolvedReferences.length > 0
    ) {
      definition = SigmaRuleSetParser.parse(data.rule.sigmaRuleYaml, {
        resolveReference: await ProjectSigmaRules.load(data.projectId, {
          excludeRuleId: data.rule.id,
        }),
      });
    }

    for (const sigmaRule of sigmaRulesOf(definition)) {
      SigmaClickhouseCompiler.compile(sigmaRule);
    }

    return definition;
  }

  @CaptureSpan()
  public static async run(
    request: DetectionRetrohuntRequest,
  ): Promise<DetectionRetrohuntResult> {
    if (!isDetectionRetrohuntPeriod(request.periodInHours)) {
      throw new BadDataException(
        "Choose the last day, the last 7 days or the last 30 days.",
      );
    }

    const counting: DetectionRetrohuntCounting = readDetectionRetrohuntCounting(
      request.rule,
    );

    const definition: DetectionRuleDefinition = await this.loadDefinition({
      projectId: request.projectId,
      rule: request.rule,
    });

    const endTime: Date = request.now || OneUptimeDate.getCurrentDate();
    const startTime: Date = OneUptimeDate.addRemoveHours(
      endTime,
      -request.periodInHours,
    );

    // A saved rule's exceptions, as its runs read them; a rule not saved yet has none.
    const exceptions: Array<DetectionRuleExceptionShape> = request.rule.id
      ? await DetectionRuleExceptions.loadForRule({
          projectId: request.projectId,
          ruleId: request.rule.id,
          from: startTime,
          until: endTime,
          now: endTime,
        })
      : [];

    const skipped: Statement | null =
      buildDetectionRuleExceptionsMatch(exceptions);
    const exceptionCount: number = skipped ? exceptions.length : 0;

    if (definition.kind === "correlation") {
      const match: CorrelationMatchResult =
        await CorrelationRuleMatcher.findMatches({
          projectId: request.projectId,
          correlation: definition.correlation,
          steps: definition.steps,
          startTime,
          endTime,
          // One more than it lists, to tell there are more.
          maxGroups: DETECTION_RETROHUNT_MAX_GROUPS + 1,
          restrictTo: andRestrictions(
            sourceRestriction(request.serviceFilter),
            buildDetectionRuleExceptionsFilter(exceptions),
          ),
        });

      return summarizeCorrelationRetrohunt({
        match,
        exceptionCount,
        startTime,
        endTime,
        periodInHours: request.periodInHours,
        maxGroups: DETECTION_RETROHUNT_MAX_GROUPS,
        groupByFields: definition.correlation.groupBy,
      });
    }

    const parsedRule: SigmaRule = definition.rule;

    if (!SecurityEventService.database) {
      SecurityEventService.useDefaultDatabase();
    }

    const databaseName: string =
      SecurityEventService.database!.getDatasourceOptions().database!;

    const statement: Statement = buildSingleRuleRetrohuntStatement({
      projectId: request.projectId,
      tableName: `${databaseName}.${SecurityEventService.model.tableName}`,
      ruleWhere: SigmaClickhouseCompiler.compile(parsedRule),
      counting,
      skipped,
      serviceFilter: request.serviceFilter,
      startTime,
      endTime,
      // One more than it lists, to tell there are more.
      maxGroups: DETECTION_RETROHUNT_MAX_GROUPS + 1,
    });

    const result: Results = await SecurityEventService.executeQuery(statement);
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return summarizeSingleRuleRetrohunt({
      rows: readSingleRuleRetrohuntRows(response.data || []),
      counting,
      exceptionCount,
      startTime,
      endTime,
      periodInHours: request.periodInHours,
      maxGroups: DETECTION_RETROHUNT_MAX_GROUPS,
    });
  }
}
