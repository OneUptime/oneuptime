import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import { NAME_WHITE_SPACE_RUN_PATTERN } from "../../../../Types/Database/UniqueName";
import { describe, expect, it } from "@jest/globals";

// A no-break space, as a document pastes one.
const NO_BREAK_SPACE: string = String.fromCharCode(0xa0);

/*
 * QueryHelper.findWithSameName (#9674): a name column holding a name, read
 * the same way on both sides - every run of white space one space, none
 * around it, in lower case - so "Tenants ", "TENANTS" and "Tenants" are one
 * name however each was saved. The typed name and the white space pattern
 * are bound, never written into the SQL: a name is typed by a person, so an
 * interpolated one would be an injection. UniqueNamePostgres runs it on
 * Postgres.
 */

interface RawOperator {
  type: string;
  objectLiteralParameters: Record<string, unknown>;
  getSql: (aliasPath: string) => string;
}

function asRaw(operator: unknown): RawOperator {
  return operator as unknown as RawOperator;
}

const ALIAS: string = '"Team"."name"';

describe("QueryHelper.findWithSameName", () => {
  it("reads the column and the name alike, and compares the two", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.findWithSameName("Platform  Team"),
    );
    const sql: string = operator.getSql(ALIAS);
    const [nameParameter, patternParameter] = Object.keys(
      operator.objectLiteralParameters,
    );

    expect(sql).toBe(
      `(LOWER(BTRIM(REGEXP_REPLACE(${ALIAS}, :${patternParameter}, ' ', 'g'))) = LOWER(BTRIM(REGEXP_REPLACE(CAST(:${nameParameter} AS TEXT), :${patternParameter}, ' ', 'g'))))`,
    );
  });

  it("binds the name as it was written, and the white space pattern", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.findWithSameName(`  Platform${NO_BREAK_SPACE} Team `),
    );

    expect(Object.values(operator.objectLiteralParameters)).toEqual([
      `  Platform${NO_BREAK_SPACE} Team `,
      NAME_WHITE_SPACE_RUN_PATTERN,
    ]);
  });

  it("never writes the name into the SQL", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.findWithSameName('x\'); DROP TABLE "Team"; --'),
    );
    const sql: string = operator.getSql(ALIAS);

    expect(sql).not.toContain("DROP TABLE");
    expect(sql).not.toContain("x')");
  });

  it("names its parameters afresh each time, so two names in one query never share one", () => {
    const first: RawOperator = asRaw(QueryHelper.findWithSameName("a"));
    const second: RawOperator = asRaw(QueryHelper.findWithSameName("b"));

    for (const key of Object.keys(first.objectLiteralParameters)) {
      expect(Object.keys(second.objectLiteralParameters)).not.toContain(key);
    }
  });
});
