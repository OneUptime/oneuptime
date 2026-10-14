import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import QueryIdCondition from "../../../../Server/Utils/Database/QueryIdCondition";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";
import { FindOperator, Raw } from "typeorm";

/*
 * A condition added to a query on the row's own id, beside what the query
 * already says there: how DatabaseService narrows a delete by query to the
 * rows it may take. What the query asked must never be dropped - that would
 * widen the delete - and the condition must reach the table the statement
 * reads the row by.
 */

const ROW_A: string = "7a000000-0000-4000-8000-00000000000a";
const ROW_B: string = "7a000000-0000-4000-8000-00000000000b";

const OWN: FindOperator<unknown> = Raw((column: string): string => {
  return `(${column} IS NOT NULL)`;
}) as FindOperator<unknown>;

// The SQL a condition holds, for a column, "and"s spelled out.
function sqlOf(condition: unknown, column: string): string {
  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;

  if (operator.type === "and") {
    return (operator.value as unknown as Array<FindOperator<unknown>>)
      .map((each: FindOperator<unknown>): string => {
        return sqlOf(each, column);
      })
      .join(" AND ");
  }

  return (operator.getSql as (column: string) => string)(column);
}

describe("QueryIdCondition.withIdCondition", () => {
  test("puts the condition on the id of a query that names none, and keeps the rest", () => {
    const startsBefore: unknown = QueryHelper.lessThan(new Date());
    const query: Record<string, unknown> = QueryIdCondition.withIdCondition(
      { startsAt: startsBefore } as never,
      OWN,
    ) as Record<string, unknown>;

    expect(query["startsAt"]).toBe(startsBefore);
    expect(query["_id"]).toBe(OWN);
  });

  test("keeps a condition the query already puts on the id beside its own", () => {
    const asked: unknown = QueryHelper.any([ROW_A, ROW_B]);
    const query: Record<string, unknown> = QueryIdCondition.withIdCondition(
      { _id: asked } as never,
      OWN,
    ) as Record<string, unknown>;
    const both: FindOperator<unknown> = query["_id"] as FindOperator<unknown>;

    expect(both.type).toBe("and");
    expect(both.value as unknown as Array<unknown>).toEqual([asked, OWN]);
  });

  test("keeps a plain id beside it, written as a string or an ObjectID", () => {
    for (const asked of [ROW_A, new ObjectID(ROW_A)]) {
      const query: Record<string, unknown> = QueryIdCondition.withIdCondition(
        { _id: asked } as never,
        OWN,
      ) as Record<string, unknown>;
      const both: FindOperator<unknown> = query["_id"] as FindOperator<unknown>;
      const [equal, own] = both.value as unknown as Array<
        FindOperator<unknown>
      >;

      expect(both.type).toBe("and");
      expect(sqlOf(equal, "t._id")).toContain("t._id = :");
      expect(Object.values(equal!.objectLiteralParameters || {})).toEqual([
        ROW_A,
      ]);
      expect(own).toBe(OWN);
    }
  });

  test("keeps a list of ids beside it, as any of them", () => {
    const query: Record<string, unknown> = QueryIdCondition.withIdCondition(
      { _id: [ROW_A, new ObjectID(ROW_B)] } as never,
      OWN,
    ) as Record<string, unknown>;
    const both: FindOperator<unknown> = query["_id"] as FindOperator<unknown>;
    const [anyOf] = both.value as unknown as Array<FindOperator<unknown>>;

    expect(both.type).toBe("and");
    expect(
      Object.values(anyOf!.objectLiteralParameters || {})
        .flat()
        .map((id: unknown): string => {
          return String(id);
        })
        .sort(),
    ).toEqual([ROW_A, ROW_B]);
  });

  test("refuses a condition on the id it cannot keep, rather than drop it", () => {
    for (const asked of [null, 42, { not: ROW_A }, [ROW_A, 7]]) {
      expect(() => {
        QueryIdCondition.withIdCondition({ _id: asked } as never, OWN);
      }).toThrow(BadDataException);
    }
  });

  test("does not change the query it was handed", () => {
    const asked: Record<string, unknown> = { _id: ROW_A, monitorId: ROW_B };

    QueryIdCondition.withIdCondition(asked as never, OWN);

    expect(asked).toEqual({ _id: ROW_A, monitorId: ROW_B });
  });
});

describe("QueryIdCondition.rowAliasOf", () => {
  test("answers the table of a column path, quoted, however TypeORM wrote it", () => {
    expect(
      QueryIdCondition.rowAliasOf("MonitorStatusTimeline._id", "_id"),
    ).toBe('"MonitorStatusTimeline"');
    expect(
      QueryIdCondition.rowAliasOf('"MonitorStatusTimeline"."_id"', "_id"),
    ).toBe('"MonitorStatusTimeline"');
    expect(
      QueryIdCondition.rowAliasOf('"MonitorStatusTimeline"._id', "_id"),
    ).toBe('"MonitorStatusTimeline"');
  });

  test("refuses a path that is not a plain table's own column", () => {
    for (const path of [
      "_id",
      "MonitorStatusTimeline.monitorId",
      "schema.MonitorStatusTimeline._id",
      '"x"; DROP TABLE "Project"; --"._id',
      "1table._id",
      "._id",
    ]) {
      expect(() => {
        QueryIdCondition.rowAliasOf(path, "_id");
      }).toThrow(BadDataException);
    }
  });
});
