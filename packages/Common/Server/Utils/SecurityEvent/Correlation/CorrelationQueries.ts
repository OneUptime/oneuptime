import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import SigmaRule from "../../../../Types/SecurityEvent/SigmaRule";
import {
  SigmaComparison,
  SigmaComparisonOperator,
  SigmaCorrelation,
  SigmaCorrelationStep,
} from "../../../../Types/SecurityEvent/SigmaCorrelation";
import SecurityEventService from "../../../Services/SecurityEventService";
import {
  Results,
  DbJSONResponse,
} from "../../../Services/AnalyticsDatabaseService";
import { getQuerySettings } from "../../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../../AnalyticsDatabase/Statement";
import SigmaClickhouseCompiler, {
  buildSigmaDistinctCountExpression,
  buildSigmaFieldExpression,
} from "../Sigma/SigmaClickhouseCompiler";
import { assertDetectionReadFits } from "../Watchlists/SecurityWatchlistMatch";

/*
 * The ClickHouse reads behind correlation rules. Each builds one Statement
 * over the SecurityEvent table - always one project's rows, the project the
 * first condition - from the steps' compiled Sigma conditions, so every
 * value a rule holds is a bound parameter, as in single rules.
 *
 *   - Counts (event_count, value_count): each group's events, or different
 *     values, over the timespan that ends now, kept when the condition holds
 *     and the group has an event since the last run (so one burst is
 *     reported once, by the run that saw it complete).
 *   - Temporal (temporal, temporal_ordered): each group's latest times per
 *     step, for CorrelationTimeline to find the steps together or in order.
 *     The read keeps only groups with an event since the last run and every
 *     step it needs, so the arrays are read for candidates only.
 *   - New values (new_value): the (group, value) pairs of this run the
 *     history never held, for groups the history did hold - a new address
 *     for a known account, not every address of an account never seen.
 *
 * Group values are read as text; a group whose value is empty is not a
 * group (a sequence "by the same user" of events naming no user is not one).
 */

// The latest times read per step and group, for the temporal arithmetic.
export const CORRELATION_STEP_TIMES_LIMIT: number = 500;
// Groups read per temporal run, the most recently active first.
export const CORRELATION_TEMPORAL_CANDIDATE_LIMIT: number = 2000;
// New values named per group in one finding.
export const CORRELATION_NEW_VALUES_PER_GROUP: number = 10;
// Background reads: under the ClickHouse client's own timeout, and failing loudly.
const CORRELATION_READ_TIME_LIMIT_IN_SECONDS: number = 45;

const SQL_OPERATORS: Record<SigmaComparisonOperator, string> = {
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  eq: "=",
  neq: "!=",
};

export interface CorrelationReadWindow {
  projectId: ObjectID;
  // Events from here on are read.
  readFrom: Date;
  // Where this run's window starts: a group must have an event since.
  startTime: Date;
  // Exclusive.
  endTime: Date;
  // ANDed into every read, for a setup test that reads only its own events.
  restrictTo?: Statement | undefined;
}

export interface CorrelationGroupKey {
  // Each group-by field's value, in group-by order.
  values: Array<string>;
}

export interface CorrelationCountRow extends CorrelationGroupKey {
  // The highest count of any timespan ending in this run.
  matchCount: number;
  // value_count: the highest number of different values in any such timespan.
  distinctCount: number;
  // The group's events in this run itself.
  eventsInRun: number;
  sampleMessage: string;
  sampleObservables: Array<string>;
}

/*
 * How a count correlation's rolling window is stepped: the timespan in steps
 * of a sixtieth of it (a second at the finest), the steps before each one
 * its window holds, and the step this run's window starts in.
 */
export interface CorrelationRollingWindow {
  bucketSeconds: number;
  precedingBuckets: number;
  startBucket: number;
  // Where the read starts: the start of the step a timespan before the run.
  readFrom: Date;
}

export const CORRELATION_ROLLING_STEPS_PER_TIMESPAN: number = 60;

export function getCorrelationRollingWindow(data: {
  timespanInSeconds: number;
  startTime: Date;
}): CorrelationRollingWindow {
  const timespan: number = Math.max(1, Math.floor(data.timespanInSeconds));
  const bucketSeconds: number = Math.max(
    1,
    Math.floor(timespan / CORRELATION_ROLLING_STEPS_PER_TIMESPAN),
  );
  const buckets: number = Math.ceil(timespan / bucketSeconds);
  const startSeconds: number = Math.floor(data.startTime.getTime() / 1000);
  const startBucket: number = Math.floor(startSeconds / bucketSeconds);
  const readFromSeconds: number = (startBucket - (buckets - 1)) * bucketSeconds;

  return {
    bucketSeconds,
    precedingBuckets: buckets - 1,
    startBucket,
    readFrom: new Date(readFromSeconds * 1000),
  };
}

export interface CorrelationTemporalRow extends CorrelationGroupKey {
  // Events per step in the read window.
  stepCounts: Array<number>;
  // The latest times per step (ms), at most CORRELATION_STEP_TIMES_LIMIT, any order.
  stepTimes: Array<Array<number>>;
  matchCount: number;
  lastMatchAt: Date | null;
  sampleMessage: string;
  sampleObservables: Array<string>;
}

export interface CorrelationNewValueRow extends CorrelationGroupKey {
  // The new values, each as its field(s) joined with " / ".
  newValues: Array<string>;
  newValueCount: number;
  matchCount: number;
  firstSeenAt: Date | null;
  sampleMessage: string;
  sampleObservables: Array<string>;
}

function readDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const text: string = String(value);
  // ClickHouse renders DateTime64 as "2026-10-14 09:00:00.000000000", in UTC.
  const date: Date = new Date(
    text.includes("T") ? text : `${text.replace(" ", "T")}Z`,
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

function readStringArray(value: unknown): Array<string> {
  return Array.isArray(value)
    ? value.map((item: unknown): string => {
        return String(item);
      })
    : [];
}

function readNumberArray(value: unknown): Array<number> {
  return Array.isArray(value)
    ? value
        .map((item: unknown): number => {
          return Number(item);
        })
        .filter((item: number): boolean => {
          return Number.isFinite(item);
        })
    : [];
}

function wrap(inner: Statement): Statement {
  const statement: Statement = SQL`(`;
  statement.append(inner);
  statement.append(")");
  return statement;
}

function orAll(parts: Array<Statement>): Statement {
  const statement: Statement = new Statement();

  parts.forEach((part: Statement, index: number): void => {
    if (index > 0) {
      statement.append(" OR ");
    }

    statement.append(wrap(part));
  });

  return statement;
}

function numberParam(value: number): Statement {
  return SQL`${{ type: TableColumnType.Number, value: value }}`;
}

/*
 * What a step's events are: its Sigma rule's compiled condition, or - for an
 * event_count step - any of the rules it counts.
 */
export function compileStepCondition(step: SigmaCorrelationStep): Statement {
  if (step.rule) {
    return wrap(SigmaClickhouseCompiler.compile(step.rule));
  }

  if (step.count) {
    return wrap(
      orAll(
        step.count.rules.map((rule: SigmaRule): Statement => {
          return SigmaClickhouseCompiler.compile(rule);
        }),
      ),
    );
  }

  throw new Error(
    `Correlation step "${step.reference}" is not resolved to a rule.`,
  );
}

/*
 * The value one group-by entry takes on an event: the field itself, or -
 * for an alias - the field of the step the event matched (the first step it
 * matched, when it matches several).
 */
export function buildGroupExpression(data: {
  field: string;
  correlation: SigmaCorrelation;
  steps: Array<SigmaCorrelationStep>;
  stepConditions: Array<Statement>;
}): Statement {
  const aliases: Dictionary<string> | undefined =
    Object.prototype.hasOwnProperty.call(data.correlation.aliases, data.field)
      ? data.correlation.aliases[data.field]
      : undefined;

  if (!aliases) {
    return buildSigmaFieldExpression(data.field);
  }

  const statement: Statement = SQL`multiIf(`;

  data.steps.forEach((step: SigmaCorrelationStep, index: number): void => {
    statement.append(data.stepConditions[index]!);
    statement.append(", ");
    statement.append(buildSigmaFieldExpression(aliases[step.reference]!));
    statement.append(", ");
  });

  statement.append("'')");

  return statement;
}

// "projectId = ? AND time >= ? AND time < ?", and a setup test's own restriction.
function baseWhere(data: {
  projectId: ObjectID;
  from: Date;
  until: Date;
  restrictTo?: Statement | undefined;
}): Statement {
  const statement: Statement = SQL`projectId = ${{
    type: TableColumnType.ObjectID,
    value: data.projectId,
  }} AND time >= ${{
    type: TableColumnType.DateTime64,
    value: data.from,
  }} AND time < ${{
    type: TableColumnType.DateTime64,
    value: data.until,
  }}`;

  if (data.restrictTo) {
    statement.append(" AND ");
    statement.append(wrap(data.restrictTo));
  }

  return statement;
}

function comparisonsOn(
  column: string,
  comparisons: Array<SigmaComparison>,
): Statement {
  const statement: Statement = new Statement();

  comparisons.forEach((comparison: SigmaComparison, index: number): void => {
    if (index > 0) {
      statement.append(" AND ");
    }

    statement.append(`${column} ${SQL_OPERATORS[comparison.operator]} `);
    statement.append(numberParam(comparison.value));
  });

  return statement;
}

function groupColumns(count: number): Array<string> {
  const columns: Array<string> = [];

  for (let index: number = 0; index < count; index++) {
    columns.push(`__g${index}`);
  }

  return columns;
}

function selectGroups(
  expressions: Array<Statement>,
  statement: Statement,
): void {
  expressions.forEach((expression: Statement, index: number): void => {
    statement.append("toString(");
    statement.append(expression);
    statement.append(`) AS __g${index}, `);
  });
}

function nonEmptyGroups(columns: Array<string>): string {
  return columns
    .map((column: string): string => {
      return `${column} != ''`;
    })
    .join(" AND ");
}

function readGroupValues(row: JSONObject, count: number): Array<string> {
  const values: Array<string> = [];

  for (let index: number = 0; index < count; index++) {
    values.push(String(row[`__g${index}`] ?? ""));
  }

  return values;
}

const SAMPLE_COLUMNS: string =
  "any(message) AS sampleMessage, arrayDistinct(arrayFlatten(groupArray(20)(observables))) AS sampleObservables";

export default class CorrelationQueries {
  private static tableName(): string {
    const service: typeof SecurityEventService = SecurityEventService;

    if (!service.database) {
      service.useDefaultDatabase();
    }

    const databaseName: string =
      service.database!.getDatasourceOptions().database!;

    return `${databaseName}.${service.model.tableName}`;
  }

  private static settings(): string {
    return getQuerySettings({
      maxExecutionTimeInSeconds: CORRELATION_READ_TIME_LIMIT_IN_SECONDS,
      timeoutOverflowMode: "throw",
    });
  }

  private static async read(statement: Statement): Promise<Array<JSONObject>> {
    // A step's watchlists travel with every read that names the step.
    assertDetectionReadFits(statement);

    const result: Results = await SecurityEventService.executeQuery(statement);
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return response.data || [];
  }

  /*
   * event_count and value_count, as a rolling window: each group's events
   * (or different values) are counted in steps of a sixtieth of the
   * timespan, and every step of this run is checked with the timespan that
   * ends at it - so a burst is counted whole whichever run it straddles, and
   * however long the run's window is (a rule run every hour still sees a
   * five-minute burst). The highest count of any window ending in this run
   * is what the condition is checked against; a group fires only with
   * events in this run.
   */
  public static buildCountStatement(data: {
    window: CorrelationReadWindow;
    correlation: SigmaCorrelation;
    steps: Array<SigmaCorrelationStep>;
    countDistinct: boolean;
    tableName: string;
    limit: number;
  }): Statement {
    const stepConditions: Array<Statement> =
      data.steps.map(compileStepCondition);
    const groups: Array<Statement> = data.correlation.groupBy.map(
      (field: string): Statement => {
        return buildGroupExpression({
          field,
          correlation: data.correlation,
          steps: data.steps,
          stepConditions,
        });
      },
    );
    const columns: Array<string> = groupColumns(groups.length);
    const rolling: CorrelationRollingWindow = getCorrelationRollingWindow({
      timespanInSeconds: data.correlation.timespanInSeconds,
      startTime: data.window.startTime,
    });

    // Per group and step: the events, their latest time, a sample, and the distinct values' state.
    const inner: Statement = SQL`SELECT `;
    selectGroups(groups, inner);
    inner.append(
      `intDiv(toUnixTimestamp(time), ${rolling.bucketSeconds}) AS __b, count() AS __c, any(message) AS __m, arrayDistinct(arrayFlatten(groupArray(5)(observables))) AS __o`,
    );

    if (data.countDistinct) {
      const values: Array<Statement> = data.correlation.condition.fields.map(
        (field: string): Statement => {
          const expression: Statement = SQL`toString(ifNull(`;
          expression.append(buildSigmaDistinctCountExpression(field));
          expression.append(", ''))");
          return expression;
        },
      );

      inner.append(", uniqExactStateIf(");

      if (values.length === 1) {
        inner.append(values[0]!);
      } else {
        inner.append("tuple(");
        values.forEach((value: Statement, index: number): void => {
          if (index > 0) {
            inner.append(", ");
          }
          inner.append(value);
        });
        inner.append(")");
      }

      inner.append(", ");
      values.forEach((value: Statement, index: number): void => {
        if (index > 0) {
          inner.append(" AND ");
        }
        inner.append(value);
        inner.append(" != ''");
      });
      inner.append(") AS __s");
    }

    inner.append(` FROM ${data.tableName} WHERE `);
    inner.append(
      baseWhere({
        projectId: data.window.projectId,
        from: data.window.readFrom,
        until: data.window.endTime,
        restrictTo: data.window.restrictTo,
      }),
    );
    inner.append(" AND (");
    inner.append(orAll(stepConditions));
    inner.append(`) GROUP BY ${[...columns, "__b"].join(", ")}`);

    // Every step's count over the timespan that ends at it.
    const frame: string = `(${
      columns.length > 0 ? `PARTITION BY ${columns.join(", ")} ` : ""
    }ORDER BY __b ASC RANGE BETWEEN ${rolling.precedingBuckets} PRECEDING AND CURRENT ROW)`;

    const windowed: Statement = SQL`SELECT `;
    windowed.append(
      [...columns, "__b", "__c", "__m", "__o"]
        .map((column: string): string => {
          return `${column}, `;
        })
        .join(""),
    );
    windowed.append(`sum(__c) OVER ${frame} AS __rolling`);

    if (data.countDistinct) {
      windowed.append(
        `, uniqExactMerge(__s) OVER ${frame} AS __rollingDistinct`,
      );
    }

    windowed.append(" FROM (");
    windowed.append(inner);
    windowed.append(")");

    const statement: Statement = SQL`SELECT `;
    statement.append(
      columns
        .map((column: string): string => {
          return `${column}, `;
        })
        .join(""),
    );
    statement.append(
      `max(__rolling) AS matchCount, ${
        data.countDistinct ? "max(__rollingDistinct)" : "0"
      } AS distinctCount, sum(__c) AS eventsInRun, any(__m) AS sampleMessage, arrayDistinct(arrayFlatten(groupArray(4)(__o))) AS sampleObservables FROM (`,
    );
    statement.append(windowed);
    statement.append(`) WHERE __b >= ${rolling.startBucket}`);

    if (columns.length > 0) {
      statement.append(` GROUP BY ${columns.join(", ")}`);
    }

    statement.append(" HAVING ");

    if (columns.length > 0) {
      statement.append(`${nonEmptyGroups(columns)} AND `);
    }

    statement.append("eventsInRun > 0 AND ");
    statement.append(
      comparisonsOn(
        data.countDistinct ? "distinctCount" : "matchCount",
        data.correlation.condition.comparisons,
      ),
    );
    statement.append(
      ` ORDER BY ${data.countDistinct ? "distinctCount" : "matchCount"} DESC LIMIT `,
    );
    statement.append(numberParam(Math.max(1, Math.trunc(data.limit))));
    statement.append(this.settings());

    return statement;
  }

  public static async findCountGroups(data: {
    window: CorrelationReadWindow;
    correlation: SigmaCorrelation;
    steps: Array<SigmaCorrelationStep>;
    countDistinct: boolean;
    limit: number;
  }): Promise<Array<CorrelationCountRow>> {
    const rows: Array<JSONObject> = await this.read(
      this.buildCountStatement({ ...data, tableName: this.tableName() }),
    );

    return rows.map((row: JSONObject): CorrelationCountRow => {
      return {
        values: readGroupValues(row, data.correlation.groupBy.length),
        matchCount: Number(row["matchCount"] || 0),
        distinctCount: Number(row["distinctCount"] || 0),
        eventsInRun: Number(row["eventsInRun"] || 0),
        sampleMessage: String(row["sampleMessage"] ?? ""),
        sampleObservables: readStringArray(row["sampleObservables"]),
      };
    });
  }

  /*
   * temporal and temporal_ordered: per group, how many events each step
   * matched and the latest times of each, for the groups that had an event
   * since startTime and at least `minimumSteps` steps with the events each
   * needs (a step that counts needs its count).
   */
  public static buildTemporalStatement(data: {
    window: CorrelationReadWindow;
    correlation: SigmaCorrelation;
    steps: Array<SigmaCorrelationStep>;
    // Events each step needs before it can have happened.
    stepMinimums: Array<number>;
    minimumSteps: number;
    tableName: string;
    limit: number;
  }): Statement {
    const stepConditions: Array<Statement> =
      data.steps.map(compileStepCondition);
    const groups: Array<Statement> = data.correlation.groupBy.map(
      (field: string): Statement => {
        return buildGroupExpression({
          field,
          correlation: data.correlation,
          steps: data.steps,
          stepConditions,
        });
      },
    );
    const columns: Array<string> = groupColumns(groups.length);

    const statement: Statement = SQL`SELECT `;
    selectGroups(groups, statement);

    stepConditions.forEach((condition: Statement, index: number): void => {
      statement.append("countIf(");
      statement.append(condition);
      statement.append(`) AS __n${index}, `);
      /*
       * The latest times: the smallest negated milliseconds. Bounded per
       * group, however busy the group is.
       */
      statement.append(
        `groupArraySortedIf(${CORRELATION_STEP_TIMES_LIMIT})(0 - toUnixTimestamp64Milli(time), `,
      );
      statement.append(condition);
      statement.append(`) AS __t${index}, `);
    });

    statement.append(
      `count() AS matchCount, max(time) AS lastMatchAt, ${SAMPLE_COLUMNS} FROM ${data.tableName} WHERE `,
    );
    statement.append(
      baseWhere({
        projectId: data.window.projectId,
        from: data.window.readFrom,
        until: data.window.endTime,
        restrictTo: data.window.restrictTo,
      }),
    );
    statement.append(" AND (");
    statement.append(orAll(stepConditions));
    statement.append(")");

    if (columns.length > 0) {
      statement.append(` GROUP BY ${columns.join(", ")}`);
    }

    statement.append(" HAVING ");

    if (columns.length > 0) {
      statement.append(`${nonEmptyGroups(columns)} AND `);
    }

    statement.append(
      SQL`lastMatchAt >= ${{
        type: TableColumnType.DateTime64,
        value: data.window.startTime,
      }} AND (`,
    );

    data.stepMinimums.forEach((minimum: number, index: number): void => {
      if (index > 0) {
        statement.append(" + ");
      }

      statement.append(`(__n${index} >= `);
      statement.append(numberParam(Math.max(1, Math.trunc(minimum))));
      statement.append(")");
    });

    statement.append(") >= ");
    statement.append(numberParam(Math.max(1, Math.trunc(data.minimumSteps))));
    statement.append(" ORDER BY lastMatchAt DESC LIMIT ");
    statement.append(numberParam(Math.max(1, Math.trunc(data.limit))));
    statement.append(this.settings());

    return statement;
  }

  public static async findTemporalGroups(data: {
    window: CorrelationReadWindow;
    correlation: SigmaCorrelation;
    steps: Array<SigmaCorrelationStep>;
    stepMinimums: Array<number>;
    minimumSteps: number;
    limit: number;
  }): Promise<Array<CorrelationTemporalRow>> {
    const rows: Array<JSONObject> = await this.read(
      this.buildTemporalStatement({ ...data, tableName: this.tableName() }),
    );

    return rows.map((row: JSONObject): CorrelationTemporalRow => {
      const stepCounts: Array<number> = [];
      const stepTimes: Array<Array<number>> = [];

      data.steps.forEach((_step: SigmaCorrelationStep, index: number): void => {
        stepCounts.push(Number(row[`__n${index}`] || 0));
        stepTimes.push(
          readNumberArray(row[`__t${index}`]).map((negated: number): number => {
            return -negated;
          }),
        );
      });

      return {
        values: readGroupValues(row, data.correlation.groupBy.length),
        stepCounts,
        stepTimes,
        matchCount: Number(row["matchCount"] || 0),
        lastMatchAt: readDate(row["lastMatchAt"]),
        sampleMessage: String(row["sampleMessage"] ?? ""),
        sampleObservables: readStringArray(row["sampleObservables"]),
      };
    });
  }

  /*
   * new_value: per group, the values of the condition's field(s) that this
   * run's events show and the history before startTime never did, for the
   * groups the history did hold. The history read is narrowed to this run's
   * groups, which the bloom indexes of the typed columns can skip by.
   */
  public static buildNewValueStatement(data: {
    window: CorrelationReadWindow;
    // How far back "seen before" reaches.
    historyFrom: Date;
    correlation: SigmaCorrelation;
    steps: Array<SigmaCorrelationStep>;
    tableName: string;
    limit: number;
  }): Statement {
    const stepConditions: Array<Statement> =
      data.steps.map(compileStepCondition);
    const condition: Statement = orAll(stepConditions);
    const groups: Array<Statement> = data.correlation.groupBy.map(
      (field: string): Statement => {
        return buildGroupExpression({
          field,
          correlation: data.correlation,
          steps: data.steps,
          stepConditions,
        });
      },
    );
    const values: Array<Statement> = data.correlation.condition.fields.map(
      (field: string): Statement => {
        return buildSigmaDistinctCountExpression(field);
      },
    );
    const groupNames: Array<string> = groupColumns(groups.length);
    const valueNames: Array<string> = values.map(
      (_value: Statement, index: number): string => {
        return `__v${index}`;
      },
    );

    // The expressions, as text, in the order the IN tuples compare them.
    const appendExpressions: (
      target: Statement,
      expressions: Array<Statement>,
    ) => void = (target: Statement, expressions: Array<Statement>): void => {
      expressions.forEach((expression: Statement, index: number): void => {
        if (index > 0) {
          target.append(", ");
        }

        target.append("toString(ifNull(");
        target.append(expression);
        target.append(", ''))");
      });
    };

    // The history of this run's groups, as an IN set: the group's columns, and its values.
    const history: (withValues: boolean) => Statement = (
      withValues: boolean,
    ): Statement => {
      const statement: Statement = SQL`SELECT `;
      appendExpressions(
        statement,
        withValues ? [...groups, ...values] : groups,
      );
      statement.append(` FROM ${data.tableName} WHERE `);
      statement.append(
        baseWhere({
          projectId: data.window.projectId,
          from: data.historyFrom,
          until: data.window.startTime,
          restrictTo: data.window.restrictTo,
        }),
      );
      statement.append(" AND (");
      statement.append(condition);
      statement.append(") AND (");
      appendExpressions(statement, groups);
      statement.append(`) IN (SELECT ${groupNames.join(", ")} FROM __recent)`);
      return statement;
    };

    // The CTE's select list, each expression named: the outer read and the IN sets compare them by name.
    const recentSelect: Statement = new Statement();
    [...groups, ...values].forEach(
      (expression: Statement, index: number): void => {
        if (index > 0) {
          recentSelect.append(", ");
        }

        recentSelect.append("toString(ifNull(");
        recentSelect.append(expression);
        recentSelect.append(
          `, '')) AS ${index < groups.length ? groupNames[index] : valueNames[index - groups.length]}`,
        );
      },
    );

    const query: Statement = SQL`WITH __recent AS (SELECT `;
    query.append(recentSelect);
    query.append(
      `, min(time) AS __firstSeenAt, count() AS __matchCount, any(message) AS __sampleMessage, groupArray(5)(observables) AS __sampleObservables FROM ${data.tableName} WHERE `,
    );
    query.append(
      baseWhere({
        projectId: data.window.projectId,
        from: data.window.startTime,
        until: data.window.endTime,
        restrictTo: data.window.restrictTo,
      }),
    );
    query.append(" AND (");
    query.append(condition);
    query.append(
      `) GROUP BY ${[...groupNames, ...valueNames].join(", ")} HAVING ${nonEmptyGroups([...groupNames, ...valueNames])}) SELECT `,
    );
    query.append(groupNames.join(", "));
    query.append(
      `, groupArray(${CORRELATION_NEW_VALUES_PER_GROUP})(${
        valueNames.length === 1
          ? valueNames[0]
          : `arrayStringConcat([${valueNames.join(", ")}], ' / ')`
      }) AS newValues, count() AS newValueCount, sum(__matchCount) AS matchCount, min(__firstSeenAt) AS firstSeenAt, any(__sampleMessage) AS sampleMessage, arrayDistinct(arrayFlatten(groupArray(4)(arrayFlatten(__sampleObservables)))) AS sampleObservables FROM __recent WHERE (`,
    );
    query.append(groupNames.join(", "));
    query.append(") IN (");
    query.append(history(false));
    query.append(") AND (");
    query.append([...groupNames, ...valueNames].join(", "));
    query.append(") NOT IN (");
    query.append(history(true));
    query.append(
      `) GROUP BY ${groupNames.join(", ")} ORDER BY firstSeenAt DESC LIMIT `,
    );
    query.append(numberParam(Math.max(1, Math.trunc(data.limit))));
    query.append(this.settings());

    return query;
  }

  public static async findNewValueGroups(data: {
    window: CorrelationReadWindow;
    historyFrom: Date;
    correlation: SigmaCorrelation;
    steps: Array<SigmaCorrelationStep>;
    limit: number;
  }): Promise<Array<CorrelationNewValueRow>> {
    const rows: Array<JSONObject> = await this.read(
      this.buildNewValueStatement({ ...data, tableName: this.tableName() }),
    );

    return rows.map((row: JSONObject): CorrelationNewValueRow => {
      return {
        values: readGroupValues(row, data.correlation.groupBy.length),
        newValues: readStringArray(row["newValues"]),
        newValueCount: Number(row["newValueCount"] || 0),
        matchCount: Number(row["matchCount"] || 0),
        firstSeenAt: readDate(row["firstSeenAt"]),
        sampleMessage: String(row["sampleMessage"] ?? ""),
        sampleObservables: readStringArray(row["sampleObservables"]),
      };
    });
  }
}
