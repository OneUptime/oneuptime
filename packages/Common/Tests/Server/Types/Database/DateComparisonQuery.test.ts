/** @timezone Asia/Kolkata */

import { afterEach, describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";
import {
  DateComparison,
  readDateComparison,
  RowPredicate,
} from "../../TestingUtils/DateComparisonPredicate";
import SecurityEventConnectionRun from "../../../../Models/DatabaseModels/SecurityEventConnectionRun";
import Query from "../../../../Server/Types/Database/Query";
import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import CompareBase, {
  CompareType,
} from "../../../../Types/Database/CompareBase";
import EqualTo from "../../../../Types/BaseDatabase/EqualTo";
import EqualToOrNull from "../../../../Types/BaseDatabase/EqualToOrNull";
import GreaterThan from "../../../../Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "../../../../Types/BaseDatabase/GreaterThanOrEqual";
import GreaterThanOrNull from "../../../../Types/BaseDatabase/GreaterThanOrNull";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import LessThan from "../../../../Types/BaseDatabase/LessThan";
import LessThanOrEqual from "../../../../Types/BaseDatabase/LessThanOrEqual";
import LessThanOrNull from "../../../../Types/BaseDatabase/LessThanOrNull";
import NotEqual from "../../../../Types/BaseDatabase/NotEqual";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import JSONFunctions from "../../../../Types/JSONFunctions";
import Timezone from "../../../../Types/Timezone";

/*
 * A DATE COMPARED ON THE SERVER REACHES POSTGRES AS THE INSTANT (#8200).
 *
 * QueryUtil.serializeQuery turns a comparison into the SQL TypeORM sends.
 * It used to bind the operator's toString(), its text for people: LessThan
 * and its kin write a Date as its day alone, in the process's zone, so a
 * worker's "updated more than 20 minutes ago" asked Postgres for "updated
 * before today". EqualTo and NotEqual write a Date in a form Postgres
 * refuses. Every comparison now binds a Date as its ISO instant, in UTC,
 * to the millisecond.
 *
 * This file runs in Asia/Kolkata (UTC+05:30), so a bound that leaned on the
 * process's zone would show. The predicate is applied to rows here the way
 * Postgres applies it to a timestamptz column (in a UTC session):
 * DateComparisonPostgres.test.ts runs the same statements on Postgres.
 */

type Key = "updatedAt" | "completedAt";

function serialize(query: JSONObject): Record<string, unknown> {
  return QueryUtil.serializeQuery(
    SecurityEventConnectionRun,
    query as unknown as Query<SecurityEventConnectionRun>,
  ) as unknown as Record<string, unknown>;
}

function bind(key: Key, value: unknown): DateComparison {
  return readDateComparison(serialize({ [key]: value } as JSONObject)[key]);
}

const AT: Date = new Date("2026-11-15T09:40:00.123Z");
const ISO: string = "2026-11-15T09:40:00.123Z";

interface OperatorCase {
  name: string;
  create: (value: CompareType) => CompareBase<CompareType>;
  sql: string;
}

const OPERATORS: Array<OperatorCase> = [
  {
    name: "LessThan",
    create: (value: CompareType) => {
      return new LessThan(value);
    },
    sql: `(col < '${ISO}')`,
  },
  {
    name: "LessThanOrEqual",
    create: (value: CompareType) => {
      return new LessThanOrEqual(value);
    },
    sql: `(col <= '${ISO}')`,
  },
  {
    name: "GreaterThan",
    create: (value: CompareType) => {
      return new GreaterThan(value);
    },
    sql: `(col > '${ISO}')`,
  },
  {
    name: "GreaterThanOrEqual",
    create: (value: CompareType) => {
      return new GreaterThanOrEqual(value);
    },
    sql: `(col >= '${ISO}')`,
  },
  {
    name: "LessThanOrNull",
    create: (value: CompareType) => {
      return new LessThanOrNull(value);
    },
    sql: `(col < '${ISO}' or col IS NULL)`,
  },
  {
    name: "GreaterThanOrNull",
    create: (value: CompareType) => {
      return new GreaterThanOrNull(value);
    },
    sql: `(col > '${ISO}' or col IS NULL)`,
  },
  {
    name: "EqualTo",
    create: (value: CompareType) => {
      return new EqualTo(value);
    },
    sql: `(col = '${ISO}')`,
  },
  {
    name: "NotEqual",
    create: (value: CompareType) => {
      return new NotEqual(value);
    },
    sql: `(col != '${ISO}')`,
  },
  {
    name: "EqualToOrNull",
    create: (value: CompareType) => {
      return new EqualToOrNull(value);
    },
    sql: `(col = '${ISO}' or col IS NULL)`,
  },
];

afterEach(() => {
  OneUptimeDate.setUserTimezone(null);
});

describe("a Date in a comparison binds the instant, to the millisecond", () => {
  test.each(OPERATORS)("$name", (operator: OperatorCase) => {
    const bound: DateComparison = bind("updatedAt", operator.create(AT));

    expect(bound.sql).toBe(operator.sql);
    // Text the driver passes as it is: no zone of the process's in it.
    expect(bound.values).toEqual([ISO]);
  });

  test("on a nullable column too", () => {
    expect(bind("completedAt", new LessThanOrNull(AT)).sql).toBe(
      `(col < '${ISO}' or col IS NULL)`,
    );
  });

  test.each([
    Timezone.UTC,
    Timezone.AmericaNew_York,
    Timezone.AsiaKolkata,
    Timezone.PacificKiritimati,
    Timezone.PacificPago_Pago,
  ])("whatever zone a reader has set (%s)", (zone: Timezone) => {
    OneUptimeDate.setUserTimezone(zone);

    // Late on the 15th in UTC: the 16th in Kiritimati, the 15th in Pago Pago.
    const late: Date = new Date("2026-11-15T23:30:00.000Z");

    for (const operator of OPERATORS) {
      expect(bind("updatedAt", operator.create(late)).values).toEqual([
        "2026-11-15T23:30:00.000Z",
      ]);
    }
  });

  test("is never the day alone, as toString() writes it for people", () => {
    // The text a filter chip shows is unchanged.
    expect(new LessThan(AT).toString()).toBe("2026-11-15");
    expect(bind("updatedAt", new LessThan(AT)).values).not.toEqual([
      "2026-11-15",
    ]);
  });

  test("a date that is not valid is refused with a 400, naming the column", () => {
    for (const operator of OPERATORS) {
      expect(() => {
        bind("updatedAt", operator.create(new Date("not a date")));
      }).toThrow(
        new BadDataException(
          "The filter on updatedAt compares it with a date that is not valid.",
        ),
      );
    }
  });
});

describe("rows minutes apart are told apart", () => {
  const now: Date = new Date("2026-11-15T10:00:00.000Z");
  const twentyMinutesAgo: Date = new Date(now.getTime() - 20 * 60_000);

  function minutesAgo(minutes: number): Date {
    return new Date(now.getTime() - minutes * 60_000);
  }

  test("updated over 20 minutes ago: 25 minutes ago is, 5 minutes ago is not", () => {
    const stale: DateComparison = bind(
      "updatedAt",
      new LessThan(twentyMinutesAgo),
    );

    expect(stale.matches(minutesAgo(25))).toBe(true);
    expect(stale.matches(minutesAgo(21))).toBe(true);
    expect(stale.matches(minutesAgo(19))).toBe(false);
    expect(stale.matches(minutesAgo(5))).toBe(false);
    // Under the day alone, both of these read the other way round.
    expect(stale.matches(new Date("2026-11-14T23:59:00.000Z"))).toBe(true);
    expect(stale.matches(new Date("2026-11-15T00:01:00.000Z"))).toBe(true);
  });

  test("the bound's own millisecond: < and > leave it out, <= and >= keep it", () => {
    const edge: Date = twentyMinutesAgo;
    const before: Date = new Date(edge.getTime() - 1);
    const after: Date = new Date(edge.getTime() + 1);

    expect(
      [before, edge, after].map((row: Date) => {
        return {
          lt: bind("updatedAt", new LessThan(edge)).matches(row),
          lte: bind("updatedAt", new LessThanOrEqual(edge)).matches(row),
          gt: bind("updatedAt", new GreaterThan(edge)).matches(row),
          gte: bind("updatedAt", new GreaterThanOrEqual(edge)).matches(row),
          eq: bind("updatedAt", new EqualTo(edge)).matches(row),
          ne: bind("updatedAt", new NotEqual(edge)).matches(row),
        };
      }),
    ).toEqual([
      { lt: true, lte: true, gt: false, gte: false, eq: false, ne: true },
      { lt: false, lte: true, gt: false, gte: true, eq: true, ne: false },
      { lt: false, lte: false, gt: true, gte: true, eq: false, ne: true },
    ]);
  });

  test("...OrNull keeps the rows with no value and tells the others apart", () => {
    const lessOrNull: DateComparison = bind(
      "completedAt",
      new LessThanOrNull(twentyMinutesAgo),
    );
    const greaterOrNull: DateComparison = bind(
      "completedAt",
      new GreaterThanOrNull(twentyMinutesAgo),
    );

    expect(lessOrNull.matches(null)).toBe(true);
    expect(lessOrNull.matches(minutesAgo(21))).toBe(true);
    expect(lessOrNull.matches(minutesAgo(19))).toBe(false);
    expect(greaterOrNull.matches(null)).toBe(true);
    expect(greaterOrNull.matches(minutesAgo(19))).toBe(true);
    expect(greaterOrNull.matches(minutesAgo(21))).toBe(false);
  });

  test("a window built from two comparisons holds only its minutes", () => {
    const after: DateComparison = bind(
      "updatedAt",
      new GreaterThan(minutesAgo(30)),
    );
    const before: DateComparison = bind(
      "updatedAt",
      new LessThan(minutesAgo(10)),
    );
    const inWindow: RowPredicate = (row: Date | null): boolean => {
      return after.matches(row) && before.matches(row);
    };

    expect(inWindow(minutesAgo(31))).toBe(false);
    expect(inWindow(minutesAgo(29))).toBe(true);
    expect(inWindow(minutesAgo(11))).toBe(true);
    expect(inWindow(minutesAgo(9))).toBe(false);
  });

  test("InBetween, which always bound its Dates as they are, still does", () => {
    const between: DateComparison = bind(
      "updatedAt",
      new InBetween(minutesAgo(30), minutesAgo(10)),
    );

    expect(between.sql).toBe(
      "(col >= '2026-11-15T09:30:00.000Z' and col <= '2026-11-15T09:50:00.000Z')",
    );
    expect(between.values).toEqual([minutesAgo(30), minutesAgo(10)]);
    expect(between.matches(minutesAgo(31))).toBe(false);
    expect(between.matches(minutesAgo(30))).toBe(true);
    expect(between.matches(minutesAgo(10))).toBe(true);
    expect(between.matches(minutesAgo(9))).toBe(false);
  });
});

describe("what is not a Date is bound as before", () => {
  test.each(OPERATORS)(
    "$name: a browser's query, its Date sent as JSON, binds the same instant",
    (operator: OperatorCase) => {
      const wire: JSONObject = JSON.parse(
        JSON.stringify(
          JSONFunctions.serialize({
            updatedAt: operator.create(AT),
          } as unknown as JSONObject),
        ),
      ) as JSONObject;
      const received: JSONObject = JSONFunctions.deserialize(wire);

      expect(bind("updatedAt", received["updatedAt"]).sql).toBe(operator.sql);
    },
  );

  test.each(OPERATORS)(
    "$name: ISO text is bound as it is",
    (operator: OperatorCase) => {
      expect(bind("updatedAt", operator.create(ISO)).values).toEqual([ISO]);
    },
  );

  test.each(OPERATORS)(
    "$name: a day written as text is still that day",
    (operator: OperatorCase) => {
      expect(bind("updatedAt", operator.create("2026-11-15")).values).toEqual([
        "2026-11-15",
      ]);
    },
  );

  test("a number is bound as its text, as before", () => {
    for (const operator of OPERATORS) {
      expect(bind("updatedAt", operator.create(42)).values).toEqual(["42"]);
    }
  });

  test("a status compared as text is unchanged", () => {
    const where: Record<string, unknown> = serialize({
      status: new NotEqual("failed"),
    } as unknown as JSONObject);
    const operator: FindOperator<unknown> = where[
      "status"
    ] as FindOperator<unknown>;

    expect(Object.values(operator.objectLiteralParameters || {})).toEqual([
      "failed",
    ]);
  });
});
