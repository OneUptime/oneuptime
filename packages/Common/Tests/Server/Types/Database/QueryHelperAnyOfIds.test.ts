import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import ObjectID from "../../../../Types/ObjectID";
import { FindOperator } from "typeorm";
import { describe, expect, it } from "@jest/globals";

/*
 * anyOfIds: rows whose id column holds one of a list of ids, the list sent
 * as ONE array parameter (#10764). Code's list across repositories is held
 * to every repository the reader may read - however many a project has -
 * and `IN (:...ids)` spends a bind value on each id, where Postgres takes at
 * most 65,535 in a statement. CodeRepositorySearchPostgres runs it with
 * 70,000 ids against real rows.
 */

interface RawOperator {
  type: string;
  objectLiteralParameters: Record<string, unknown>;
  getSql: (aliasPath: string) => string;
}

function asRaw(operator: unknown): RawOperator {
  return operator as unknown as RawOperator;
}

const FIRST: ObjectID = new ObjectID("3c9d2f1e-5a6b-4c7d-8e9f-0a1b2c3d4e5f");
const SECOND: string = "6f2a5c4b-8d9e-4f0a-9b1c-3d4e5f6a7b8c";

describe("QueryHelper.anyOfIds", () => {
  it("matches the column against one array of uuids, never one bind value per id", () => {
    const operator: RawOperator = asRaw(QueryHelper.anyOfIds([FIRST, SECOND]));

    expect(operator).toBeInstanceOf(FindOperator);
    expect(operator.type).toBe("raw");

    const sql: string = operator.getSql('"AIRun"."codeRepositoryId"');
    const [name] = Object.keys(operator.objectLiteralParameters);

    expect(sql).toBe(
      `("AIRun"."codeRepositoryId" = ANY(CAST(:${name} AS uuid[])))`,
    );
    // Not a spread list (":...name"): one value, the array.
    expect(sql).not.toContain(":...");
    expect(Object.values(operator.objectLiteralParameters)).toEqual([
      [FIRST.toString(), SECOND],
    ]);
  });

  it("70,000 ids are still one parameter", () => {
    const ids: Array<string> = [];

    for (let index: number = 0; index < 70000; index++) {
      ids.push(ObjectID.generate().toString());
    }

    const operator: RawOperator = asRaw(QueryHelper.anyOfIds(ids));

    expect(Object.keys(operator.objectLiteralParameters)).toHaveLength(1);
    expect(
      (Object.values(operator.objectLiteralParameters)[0] as Array<string>)
        .length,
    ).toBe(70000);
  });

  it("with orNull, the rows whose column is empty match too", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.anyOfIds([FIRST], { orNull: true }),
    );
    const [name] = Object.keys(operator.objectLiteralParameters);

    expect(operator.getSql('"AIRun"."codeRepositoryId"')).toBe(
      `("AIRun"."codeRepositoryId" = ANY(CAST(:${name} AS uuid[])) OR "AIRun"."codeRepositoryId" IS NULL)`,
    );
  });

  it("no ids match no row - or, with orNull, only the empty ones", () => {
    expect(asRaw(QueryHelper.anyOfIds([])).getSql('"t"."c"')).toBe(
      "TRUE = FALSE",
    );
    expect(
      asRaw(QueryHelper.anyOfIds([], { orNull: true })).getSql('"t"."c"'),
    ).toBe('("t"."c" IS NULL)');
  });

  it("does not collide with another call's parameter name", () => {
    const first: RawOperator = asRaw(QueryHelper.anyOfIds([FIRST]));
    const second: RawOperator = asRaw(QueryHelper.anyOfIds([SECOND]));

    expect(Object.keys(first.objectLiteralParameters)[0]).not.toBe(
      Object.keys(second.objectLiteralParameters)[0],
    );
  });
});
