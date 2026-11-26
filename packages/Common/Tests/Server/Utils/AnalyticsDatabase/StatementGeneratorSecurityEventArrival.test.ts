import { ClickhouseAppInstance } from "../../../../Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "../../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  DETECTION_RUN_LATE_EVENT_SECONDS,
  isDetectionArrivalCandidate,
} from "../../../../Server/Utils/SecurityEvent/DetectionArrivalRead";
import "../../TestingUtils/Init";
import AnalyticsBaseModel from "../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import SecurityEvent from "../../../../Models/AnalyticsModels/SecurityEvent";
import Route from "../../../../Types/API/Route";
import AnalyticsTableEngine from "../../../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableColumn from "../../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import Search from "../../../../Types/BaseDatabase/Search";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import {
  SECURITY_EVENT_ARRIVAL_QUERY_KEY,
  getArrivalEventTimeBounds,
} from "../../../../Types/SecurityEvent/SecurityEventArrival";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHAT ARRIVED IN A RANGE, COMPILED (#10488).
 *
 * A scheduled hunt counts the events that arrived in its run's window
 * through the Events page's own read, as the person it runs as, and its
 * notification opens that page on the same events. Both carry the range
 * under the synthetic key `securityEventArrival`, which the generator
 * compiles with the condition a scheduled detection rule judges what
 * arrived by (isDetectionArrivalCandidate) - the one condition, not a second
 * one beside it - every column through the generator's own reference, every
 * value bound. A range it cannot read, or a table without the two columns,
 * matches nothing: the key narrows a read, and never widens one.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const AFTER: string = "2026-10-29T10:58:00.000Z";
const UNTIL: string = "2026-10-29T11:58:00.000Z";

function column(key: string, type: TableColumnType): AnalyticsTableColumn {
  return new AnalyticsTableColumn({
    key,
    title: "<title>",
    description: "<description>",
    required: true,
    type,
  });
}

// A table of rows that happened at one time and arrived at another.
class ArrivalModel extends AnalyticsBaseModel {
  public constructor() {
    super({
      tableName: "<arrival-table>",
      singularName: "<singular>",
      pluralName: "<plural>",
      tableColumns: [
        column("time", TableColumnType.DateTime64),
        column("message", TableColumnType.Text),
      ],
      crudApiPath: new Route("route"),
      primaryKeys: ["_id"],
      sortKeys: ["_id"],
      partitionKey: "_id",
      tableEngine: AnalyticsTableEngine.MergeTree,
    });
  }
}

// A table whose rows have no time of their own, only when they were written.
class NoTimeModel extends AnalyticsBaseModel {
  public constructor() {
    super({
      tableName: "<no-time-table>",
      singularName: "<singular>",
      pluralName: "<plural>",
      tableColumns: [column("message", TableColumnType.Text)],
      crudApiPath: new Route("route"),
      primaryKeys: ["_id"],
      sortKeys: ["_id"],
      partitionKey: "_id",
      tableEngine: AnalyticsTableEngine.MergeTree,
    });
  }
}

// A table with no createdAt of its own.
class NoBaseColumnsModel extends AnalyticsBaseModel {
  public constructor() {
    super({
      tableName: "<no-base-columns-table>",
      singularName: "<singular>",
      pluralName: "<plural>",
      tableColumns: [
        column("_id", TableColumnType.ObjectID),
        column("time", TableColumnType.DateTime64),
      ],
      crudApiPath: new Route("route"),
      primaryKeys: ["_id"],
      sortKeys: ["_id"],
      partitionKey: "_id",
      tableEngine: AnalyticsTableEngine.MergeTree,
      includeBaseColumns: false,
      defaultSortColumn: "time",
    });
  }
}

describe("the securityEventArrival synthetic key", () => {
  let generator: StatementGenerator<ArrivalModel>;

  beforeEach(() => {
    generator = new StatementGenerator<ArrivalModel>({
      modelType: ArrivalModel,
      database: ClickhouseAppInstance,
    });
  });

  function where(
    range: unknown,
    rest: Record<string, unknown> = {},
  ): Statement {
    return generator.toWhereStatement({
      ...rest,
      [SECURITY_EVENT_ARRIVAL_QUERY_KEY]: range,
    } as any);
  }

  test("arrived after the start, up to and including the end, within a day of when it happened", () => {
    const statement: Statement = where({
      arrivedAfter: AFTER,
      arrivedUntil: UNTIL,
    });

    expect(statement.query).toBe(
      "AND ({p0:Identifier} > {p1:DateTime} AND {p2:Identifier} <= {p3:DateTime} AND {p4:Identifier} >= {p5:Identifier} - toIntervalSecond({p6:Int32}))",
    );
    expect(statement.query_params).toStrictEqual({
      p0: "createdAt",
      p1: OneUptimeDate.toClickhouseDateTime(new Date(AFTER)),
      p2: "createdAt",
      p3: OneUptimeDate.toClickhouseDateTime(new Date(UNTIL)),
      p4: "time",
      p5: "createdAt",
      p6: DETECTION_RUN_LATE_EVENT_SECONDS,
    });
    expect(DETECTION_RUN_LATE_EVENT_SECONDS).toBe(24 * 60 * 60);
  });

  test("is the condition a scheduled detection rule judges what arrived with, column for column", () => {
    const range: { arrivedAfter: Date; arrivedUntil: Date } = {
      arrivedAfter: new Date(AFTER),
      arrivedUntil: new Date(UNTIL),
    };
    const rule: Statement = isDetectionArrivalCandidate(
      {
        kind: "run",
        ...range,
        candidateStartTime: getArrivalEventTimeBounds(range).happenedAfter,
        candidateEndTime: getArrivalEventTimeBounds(range).happenedBefore,
      },
      (name: string): string => {
        return name;
      },
    );
    const compiled: Statement = where({
      arrivedAfter: AFTER,
      arrivedUntil: UNTIL,
    });

    expect(compiled.query).toBe(`AND ${rule.query}`);
    expect(compiled.query_params).toStrictEqual(rule.query_params);
  });

  test("a range kept to the millisecond is read on its whole seconds, as createdAt keeps them", () => {
    const statement: Statement = where({
      arrivedAfter: "2026-10-29T10:58:00.900Z",
      arrivedUntil: "2026-10-29T11:58:00.100Z",
    });

    expect(statement.query_params["p1"]).toBe("2026-10-29 10:58:00");
    expect(statement.query_params["p3"]).toBe("2026-10-29 11:58:00");
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a string", AFTER],
    ["a list", [AFTER, UNTIL]],
    ["no end", { arrivedAfter: AFTER }],
    ["no start", { arrivedUntil: UNTIL }],
    ["a start that is no date", { arrivedAfter: "x", arrivedUntil: UNTIL }],
    ["an empty range", { arrivedAfter: UNTIL, arrivedUntil: UNTIL }],
    ["a range turned round", { arrivedAfter: UNTIL, arrivedUntil: AFTER }],
  ])(
    "%s matches nothing - never every event",
    (_case: string, range: unknown) => {
      const statement: Statement = where(range);

      expect(statement.query).toBe("AND 0");
      expect(statement.query_params).toStrictEqual({});
    },
  );

  test("ANDs with the rest of the query, which never takes it off", () => {
    const statement: Statement = where(
      { arrivedAfter: AFTER, arrivedUntil: UNTIL },
      {
        message: new Search("denied"),
        time: new InBetween<Date>(
          new Date("2026-10-28T10:58:00.000Z"),
          new Date("2026-10-29T12:59:00.000Z"),
        ),
      },
    );

    expect(statement.query).toContain("AND {p0:Identifier} ILIKE {p1:String}");
    expect(statement.query).toMatch(
      /AND \(\{p\d+:Identifier\} > \{p\d+:DateTime\} AND /,
    );
    expect(statement.query.endsWith("toIntervalSecond({p12:Int32}))")).toBe(
      true,
    );
  });

  test("a range that matches nothing still separates the predicates around it", () => {
    const statement: Statement = generator.toWhereStatement({
      message: new Search("denied"),
      [SECURITY_EVENT_ARRIVAL_QUERY_KEY]: {},
      _id: "<value>",
    } as any);

    expect(statement.query).toBe(
      "AND {p0:Identifier} ILIKE {p1:String} AND 0 AND {p2:Identifier} = {p3:String}",
    );
  });

  test("qualifies every column under a table alias, so a select's own time never stands in for the row's", () => {
    const statement: Statement = generator.toWhereStatement(
      {
        [SECURITY_EVENT_ARRIVAL_QUERY_KEY]: {
          arrivedAfter: AFTER,
          arrivedUntil: UNTIL,
        },
      } as any,
      { tableAlias: "e" },
    );

    expect(statement.query).toBe(
      "AND ({p0_t:Identifier}.{p0_c:Identifier} > {p1:DateTime} AND {p2_t:Identifier}.{p2_c:Identifier} <= {p3:DateTime} AND {p4_t:Identifier}.{p4_c:Identifier} >= {p5_t:Identifier}.{p5_c:Identifier} - toIntervalSecond({p6:Int32}))",
    );
    expect(statement.query_params["p0_t"]).toBe("e");
    expect(statement.query_params["p0_c"]).toBe("createdAt");
    expect(statement.query_params["p4_c"]).toBe("time");
  });

  test("every value is bound, never written into the statement", () => {
    const statement: Statement = where({
      arrivedAfter: "2026-10-29T10:58:00.000Z') OR 1=1 --",
      arrivedUntil: UNTIL,
    });

    expect(statement.query).not.toContain("1=1");
    expect(statement.query).toBe("AND 0");
  });
});

describe("the key on other tables", () => {
  test("a table whose rows have no time of their own matches nothing", () => {
    const generator: StatementGenerator<NoTimeModel> =
      new StatementGenerator<NoTimeModel>({
        modelType: NoTimeModel,
        database: ClickhouseAppInstance,
      });

    expect(
      generator.toWhereStatement({
        [SECURITY_EVENT_ARRIVAL_QUERY_KEY]: {
          arrivedAfter: AFTER,
          arrivedUntil: UNTIL,
        },
      } as any).query,
    ).toBe("AND 0");
  });

  test("a table with no createdAt matches nothing", () => {
    const generator: StatementGenerator<NoBaseColumnsModel> =
      new StatementGenerator<NoBaseColumnsModel>({
        modelType: NoBaseColumnsModel,
        database: ClickhouseAppInstance,
      });

    expect(
      generator.toWhereStatement({
        [SECURITY_EVENT_ARRIVAL_QUERY_KEY]: {
          arrivedAfter: AFTER,
          arrivedUntil: UNTIL,
        },
      } as any).query,
    ).toBe("AND 0");
  });

  test("the SecurityEvent table reads it beside its project and time range, as a hunt's run does", () => {
    const generator: StatementGenerator<SecurityEvent> =
      new StatementGenerator<SecurityEvent>({
        modelType: SecurityEvent,
        database: ClickhouseAppInstance,
      });

    const statement: Statement = generator.toWhereStatement({
      projectId: PROJECT_ID,
      time: new InBetween<Date>(
        new Date("2026-10-28T10:58:00.000Z"),
        new Date("2026-10-29T12:59:00.000Z"),
      ),
      [SECURITY_EVENT_ARRIVAL_QUERY_KEY]: {
        arrivedAfter: AFTER,
        arrivedUntil: UNTIL,
      },
    } as any);

    expect(statement.query).toContain(
      "{p6:Identifier} > {p7:DateTime} AND {p8:Identifier} <= {p9:DateTime} AND {p10:Identifier} >= {p11:Identifier} - toIntervalSecond({p12:Int32})",
    );
    expect(statement.query_params["p6"]).toBe("createdAt");
    expect(statement.query_params["p10"]).toBe("time");
  });
});
