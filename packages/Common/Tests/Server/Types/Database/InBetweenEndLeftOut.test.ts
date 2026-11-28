import buildJSONColumnQuery from "../../../../Server/Types/Database/JSONColumnQuery";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import Incident from "../../../../Models/DatabaseModels/Incident";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import { DatabaseBaseModelType } from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import TelemetryCheckWindow from "../../../../Types/Monitor/TelemetryCheckWindow";
import { describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * POSTGRES READS A TELEMETRY CHECK'S WINDOW WITH ITS END LEFT OUT (issue
 * #11334).
 *
 * A check's window holds its start and not its end (TelemetryCheckWindow,
 * InBetween.includesEnd). Its Postgres reads are written by QueryHelper:
 * the Exceptions monitor's new and regressed exception groups are those
 * first seen, or back, in the window, so a group first seen on the instant
 * one window ends and the next begins was new in both checks. Every range
 * that holds both ends - every filter a person sets - is written as before.
 */

interface RawOperator {
  objectLiteralParameters: Record<string, unknown>;
  getSql: (aliasPath: string) => string;
}

// The SQL a Raw operator writes for a column, its parameters as :p1, :p2.
function sqlOf(operator: unknown, alias: string): string {
  expect(operator).toBeInstanceOf(FindOperator);

  const raw: RawOperator = operator as RawOperator;
  let sql: string = raw.getSql(alias);

  Object.keys(raw.objectLiteralParameters).forEach(
    (name: string, index: number) => {
      sql = sql.split(`:${name}`).join(`:p${index + 1}`);
    },
  );

  return sql;
}

function boundOf(operator: unknown): Array<unknown> {
  return Object.values((operator as RawOperator).objectLiteralParameters);
}

function serialize(
  modelType: DatabaseBaseModelType,
  query: Record<string, unknown>,
): Record<string, unknown> {
  return QueryUtil.serializeQuery(modelType, query as never) as Record<
    string,
    unknown
  >;
}

const START: Date = new Date("2026-11-27T10:00:07.123Z");
const END: Date = new Date("2026-11-27T10:01:07.123Z");
const COLUMN: string = '"TelemetryException"."firstSeenAt"';

describe("QueryHelper.inBetween", () => {
  test("holds both ends by default, as every range did", () => {
    expect(sqlOf(QueryHelper.inBetween(START, END), COLUMN)).toBe(
      `(${COLUMN} >= :p1 and ${COLUMN} <= :p2)`,
    );
  });

  test("holds both ends when asked to", () => {
    expect(
      sqlOf(QueryHelper.inBetween(START, END, { includesEnd: true }), COLUMN),
    ).toBe(`(${COLUMN} >= :p1 and ${COLUMN} <= :p2)`);
  });

  test("a check's window: its start, and up to its end but not the end itself", () => {
    const operator: unknown = QueryHelper.inBetween(START, END, {
      includesEnd: false,
    });

    expect(sqlOf(operator, COLUMN)).toBe(
      `(${COLUMN} >= :p1 and ${COLUMN} < :p2)`,
    );
    expect(boundOf(operator)).toEqual([START, END]);
  });

  test("binds the two ends as parameters, never into the text", () => {
    const sql: string = (
      QueryHelper.inBetween(START, END, {
        includesEnd: false,
      }) as unknown as RawOperator
    ).getSql(COLUMN);

    expect(sql).not.toContain("2026");
  });
});

describe("QueryUtil writes an InBetween of a query as it says", () => {
  test("a range a person filters by holds both ends", () => {
    const query: Record<string, unknown> = serialize(TelemetryException, {
      firstSeenAt: new InBetween<Date>(START, END),
    });

    expect(sqlOf(query["firstSeenAt"], COLUMN)).toBe(
      `(${COLUMN} >= :p1 and ${COLUMN} <= :p2)`,
    );
  });

  test("a check's window leaves its end out", () => {
    const query: Record<string, unknown> = serialize(TelemetryException, {
      firstSeenAt: TelemetryCheckWindow.from(START, END),
    });

    expect(sqlOf(query["firstSeenAt"], COLUMN)).toBe(
      `(${COLUMN} >= :p1 and ${COLUMN} < :p2)`,
    );
    expect(boundOf(query["firstSeenAt"])).toEqual([START, END]);
  });

  test("an id range keeps which end it holds, through the id check", () => {
    const first: string = "5f0e8e3a-1f24-4a2f-9e4c-2b1d3c4e5f60";
    const last: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
    const alias: string = '"Incident"."currentIncidentStateId"';

    const closed: Record<string, unknown> = serialize(Incident, {
      currentIncidentStateId: new InBetween<string>(first, last),
    });
    const open: Record<string, unknown> = serialize(Incident, {
      currentIncidentStateId: new InBetween<string>(first, last, {
        includesEnd: false,
      }),
    });

    expect(sqlOf(closed["currentIncidentStateId"], alias)).toContain(
      `${alias} <= :p2`,
    );
    expect(sqlOf(open["currentIncidentStateId"], alias)).toContain(
      `${alias} < :p2`,
    );
    expect(boundOf(open["currentIncidentStateId"])).toEqual([first, last]);
  });
});

describe("a custom field's range (JSONColumnQuery)", () => {
  const sqlOfField: (value: InBetween<number | string>) => string = (
    value: InBetween<number | string>,
  ): string => {
    let index: number = 0;

    return buildJSONColumnQuery({
      value: { Count: value },
      generateParameterName: (): string => {
        index++;
        return `p${index}`;
      },
    }).toSql('"Incident"."customFields"');
  };

  test("holds both ends unless the range says otherwise, over numbers", () => {
    const closed: string = sqlOfField(new InBetween<number>(1, 10));
    const open: string = sqlOfField(
      new InBetween<number>(1, 10, { includesEnd: false }),
    );

    expect(closed).toContain(" <= CAST(");
    expect(open).not.toContain(" <= CAST(");
    expect(open).toContain(" < CAST(");
    expect(open).toContain(" >= CAST(");
    expect(open).toContain("AS NUMERIC");
  });

  test("and over text", () => {
    const closed: string = sqlOfField(
      new InBetween<string>("2026-01-01", "2026-02-01"),
    );
    const open: string = sqlOfField(
      new InBetween<string>("2026-01-01", "2026-02-01", {
        includesEnd: false,
      }),
    );

    expect(closed).toContain(" <= CAST(");
    expect(open).not.toContain(" <= CAST(");
    expect(open).toContain(" < CAST(");
    expect(open).toContain("AS TEXT");
  });
});
