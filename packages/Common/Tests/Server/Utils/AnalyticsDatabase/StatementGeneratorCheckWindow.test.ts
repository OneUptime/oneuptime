import { ClickhouseAppInstance } from "../../../../Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "../../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import "../../TestingUtils/Init";
import AnalyticsBaseModel from "../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ExceptionInstance from "../../../../Models/AnalyticsModels/ExceptionInstance";
import Log from "../../../../Models/AnalyticsModels/Log";
import Metric from "../../../../Models/AnalyticsModels/Metric";
import Profile from "../../../../Models/AnalyticsModels/Profile";
import SecurityEvent from "../../../../Models/AnalyticsModels/SecurityEvent";
import Span from "../../../../Models/AnalyticsModels/Span";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import TelemetryCheckWindow from "../../../../Types/Monitor/TelemetryCheckWindow";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * THE ANALYTICS QUERY BUILDER WRITES A CHECK'S WINDOW WITH ITS END LEFT OUT
 * (issue #11334).
 *
 * Every telemetry check counts or aggregates through StatementGenerator's
 * WHERE: a range that holds both ends is `col >= start AND col <= end`, as
 * every range was; a check's window (TelemetryCheckWindow) is `col >= start
 * AND col < end`, so a record stamped on the instant one window ends and
 * the next begins is counted by one check, the later. Pinned for the time
 * column of every model a telemetry check reads.
 */

const START: Date = new Date("2026-11-27T10:00:07.123Z");
const END: Date = new Date("2026-11-27T10:01:07.123Z");
const START_IN_CLICKHOUSE: string = "2026-11-27 10:00:07.123000000";
const END_IN_CLICKHOUSE: string = "2026-11-27 10:01:07.123000000";

// The statement with its parameters written in.
function inline(statement: Statement): string {
  let text: string = statement.query;

  for (const [name, value] of Object.entries(statement.query_params)) {
    const marker: string = `{${name}:`;

    for (
      let at: number = text.indexOf(marker);
      at !== -1;
      at = text.indexOf(marker)
    ) {
      const close: number = text.indexOf("}", at);
      text = text.slice(0, at) + JSON.stringify(value) + text.slice(close + 1);
    }
  }

  return text;
}

function whereOf<TBaseModel extends AnalyticsBaseModel>(
  modelType: { new (): TBaseModel },
  query: Record<string, unknown>,
  options?: { tableAlias?: string },
): string {
  const generator: StatementGenerator<TBaseModel> =
    new StatementGenerator<TBaseModel>({
      modelType: modelType,
      database: ClickhouseAppInstance,
    });

  return inline(
    options
      ? generator.toWhereStatement(query as never, options as never)
      : generator.toWhereStatement(query as never),
  );
}

const READS: Array<{
  name: string;
  modelType: { new (): AnalyticsBaseModel };
  column: string;
}> = [
  { name: "Logs", modelType: Log, column: "time" },
  { name: "Traces and AI", modelType: Span, column: "startTime" },
  { name: "Exceptions", modelType: ExceptionInstance, column: "time" },
  { name: "Profiles", modelType: Profile, column: "startTime" },
  { name: "Security Events", modelType: SecurityEvent, column: "time" },
  {
    name: "Metrics and every infrastructure monitor",
    modelType: Metric,
    column: "time",
  },
];

describe.each(READS)(
  "the $name check's time column",
  (read: {
    name: string;
    modelType: { new (): AnalyticsBaseModel };
    column: string;
  }) => {
    test("a check's window: from its start, up to but not including its end", () => {
      const where: string = whereOf(read.modelType, {
        projectId: ObjectID.generate(),
        [read.column]: TelemetryCheckWindow.from(START, END),
      });

      expect(where).toContain(
        `"${read.column}" >= "${START_IN_CLICKHOUSE}" AND "${read.column}" < "${END_IN_CLICKHOUSE}"`,
      );
      expect(where).not.toContain(`"${read.column}" <=`);
    });

    test("a range a person filters by holds both ends, as before", () => {
      const where: string = whereOf(read.modelType, {
        projectId: ObjectID.generate(),
        [read.column]: new InBetween<Date>(START, END),
      });

      expect(where).toContain(
        `"${read.column}" >= "${START_IN_CLICKHOUSE}" AND "${read.column}" <= "${END_IN_CLICKHOUSE}"`,
      );
    });
  },
);

describe("a check's window through the builder's other forms", () => {
  test("qualified by a table's alias, as a dedup subquery's outer WHERE reads it", () => {
    const generator: StatementGenerator<Metric> =
      new StatementGenerator<Metric>({
        modelType: Metric,
        database: ClickhouseAppInstance,
      });

    const statement: Statement = generator.toWhereStatement(
      {
        projectId: ObjectID.generate(),
        time: TelemetryCheckWindow.from(START, END),
      } as never,
      { tableAlias: "mutable_metric_latest" },
    );

    expect(statement.query).toContain(
      "{p2_t:Identifier}.{p2_c:Identifier} >= {p3:DateTime64(9)} AND {p4_t:Identifier}.{p4_c:Identifier} < {p5:DateTime64(9)}",
    );
    expect(statement.query_params["p2_t"]).toBe("mutable_metric_latest");
    expect(statement.query_params["p2_c"]).toBe("time");
    expect(statement.query_params["p3"]).toBe(START_IN_CLICKHOUSE);
    expect(statement.query_params["p5"]).toBe(END_IN_CLICKHOUSE);
  });

  test("a window that crossed JSON, its ends as text, still leaves its end out", () => {
    const crossed: InBetween<Date> = InBetween.fromJSON<Date>(
      JSON.parse(
        JSON.stringify(TelemetryCheckWindow.from(START, END).toJSON()),
      ),
    );

    const where: string = whereOf(Log, {
      projectId: ObjectID.generate(),
      time: crossed,
    });

    expect(crossed.includesEnd).toBe(false);
    expect(where).toContain(
      `"time" >= "${START_IN_CLICKHOUSE}" AND "time" < "${END_IN_CLICKHOUSE}"`,
    );
  });

  test("binds both ends as parameters, never into the text", () => {
    const generator: StatementGenerator<Log> = new StatementGenerator<Log>({
      modelType: Log,
      database: ClickhouseAppInstance,
    });

    const statement: Statement = generator.toWhereStatement({
      projectId: ObjectID.generate(),
      time: TelemetryCheckWindow.from(START, END),
    } as never);

    expect(statement.query).not.toContain("2026");
    expect(Object.values(statement.query_params)).toEqual(
      expect.arrayContaining([START_IN_CLICKHOUSE, END_IN_CLICKHOUSE]),
    );
  });
});
