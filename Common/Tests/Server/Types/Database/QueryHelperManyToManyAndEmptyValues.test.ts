import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import ObjectID from "../../../../Types/ObjectID";
import { FindOperator } from "typeorm";
import { describe, expect, it } from "@jest/globals";

/*
 * QueryHelper's many-to-many builders turn a request like "teams tagged with
 * any of these labels" into a correlated subquery over the join table, and its
 * array builders (all / any / notIn / notInOrNull / equalToOrNull) each have a
 * dedicated empty-input branch that decides whether an empty list fails OPEN
 * (matches everything) or CLOSED (matches nothing).
 *
 * None of that is visible from the operator's JSON: TypeORM's Raw keeps the SQL
 * behind a `getSql(alias)` generator and the bound values behind
 * `objectLiteralParameters`. So every test here reaches through the FindOperator
 * to those two surfaces. Two properties recur and both are load-bearing:
 *
 *  1. IDENTIFIERS ARE ESCAPED, VALUES ARE BOUND. The join table / column names
 *     are embedded in the SQL text (doubling any `"`), while the ids the caller
 *     is filtering on must appear ONLY in the parameter bag — never in the SQL
 *     string, or an id would be an injection vector.
 *
 *  2. EMPTY MEANS A SENTINEL, NOT A CRASH. An empty `IN ()` is a Postgres
 *     syntax error, so each builder short-circuits an empty list to a constant
 *     predicate whose direction (TRUE=TRUE vs TRUE=FALSE) is the point.
 */

interface RawOperator {
  type: string;
  objectLiteralParameters: Record<string, unknown>;
  /* TypeORM renders the SQL through this, given the column alias. */
  getSql: (aliasPath: string) => string;
}

type AsRawFunction = (operator: unknown) => RawOperator;

const asRaw: AsRawFunction = (operator: unknown): RawOperator => {
  return operator as unknown as RawOperator;
};

/* The alias a many-to-many filter is applied to: the owner's primary id. */
const OWNER_ID_ALIAS: string = '"Team"."_id"';

describe("QueryHelper.anyOfEntitiesInManyToMany", () => {
  it("emits an IN-subquery over the join table, correlated on the relation column", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.anyOfEntitiesInManyToMany({
        values: ["label-1", "label-2"],
        joinTableName: "team_label",
        ownerColumnName: "teamId",
        relationColumnName: "labelId",
      }),
    );

    expect(operator).toBeInstanceOf(FindOperator);
    expect(operator.type).toBe("raw");

    const sql: string = operator.getSql(OWNER_ID_ALIAS);

    /* Owner id is IN the set of owners linked to any requested relation id. */
    expect(sql).toContain(`(${OWNER_ID_ALIAS} IN (SELECT`);
    expect(sql).not.toContain("NOT IN");
    expect(sql).toContain('SELECT "team_label"."teamId"');
    expect(sql).toContain('FROM "team_label"');
    expect(sql).toContain('WHERE "team_label"."labelId" IN (:...');
  });

  it("binds the relation ids as one array parameter, leaving none in the SQL text", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.anyOfEntitiesInManyToMany({
        values: ["label-1", "label-2"],
        joinTableName: "team_label",
        ownerColumnName: "teamId",
        relationColumnName: "labelId",
      }),
    );

    const sql: string = operator.getSql(OWNER_ID_ALIAS);

    expect(sql).not.toContain("label-1");
    expect(sql).not.toContain("label-2");

    const boundValues: Array<unknown> = Object.values(
      operator.objectLiteralParameters,
    );
    expect(boundValues).toEqual([["label-1", "label-2"]]);
  });

  it("stringifies ObjectID values and never leaks them into the SQL", () => {
    const relationId: ObjectID = ObjectID.generate();

    const operator: RawOperator = asRaw(
      QueryHelper.anyOfEntitiesInManyToMany({
        values: [relationId],
        joinTableName: "team_label",
        ownerColumnName: "teamId",
        relationColumnName: "labelId",
      }),
    );

    const sql: string = operator.getSql(OWNER_ID_ALIAS);

    expect(sql).not.toContain(relationId.toString());
    expect(Object.values(operator.objectLiteralParameters)).toEqual([
      [relationId.toString()],
    ]);
  });

  it("fails CLOSED on an empty list: a constant-false predicate with no parameters", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.anyOfEntitiesInManyToMany({
        values: [],
        joinTableName: "team_label",
        ownerColumnName: "teamId",
        relationColumnName: "labelId",
      }),
    );

    /*
     * "linked to any of nothing" is nobody, so the operator must match no rows
     * rather than compile an illegal `IN ()`.
     */
    expect(operator.getSql(OWNER_ID_ALIAS)).toBe("TRUE = FALSE");
    expect(Object.keys(operator.objectLiteralParameters)).toHaveLength(0);
  });

  it("doubles embedded double-quotes in the join-table and column identifiers", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.anyOfEntitiesInManyToMany({
        values: ["label-1"],
        joinTableName: 'weird"table',
        ownerColumnName: 'owner"col',
        relationColumnName: 'rel"col',
      }),
    );

    const sql: string = operator.getSql(OWNER_ID_ALIAS);

    /* A raw `"` inside an identifier would end the quoted name early. */
    expect(sql).toContain('"weird""table"');
    expect(sql).toContain('"owner""col"');
    expect(sql).toContain('"rel""col"');
  });
});

describe("QueryHelper.noneEntitiesInManyToMany", () => {
  it("emits a NOT IN-subquery over the join table", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.noneEntitiesInManyToMany({
        values: ["label-1", "label-2"],
        joinTableName: "team_label",
        ownerColumnName: "teamId",
        relationColumnName: "labelId",
      }),
    );

    expect(operator.type).toBe("raw");

    const sql: string = operator.getSql(OWNER_ID_ALIAS);

    expect(sql).toContain(`(${OWNER_ID_ALIAS} NOT IN (SELECT`);
    expect(sql).toContain('WHERE "team_label"."labelId" IN (:...');
    expect(Object.values(operator.objectLiteralParameters)).toEqual([
      ["label-1", "label-2"],
    ]);
  });

  it("fails OPEN on an empty list: a constant-true predicate with no parameters", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.noneEntitiesInManyToMany({
        values: [],
        joinTableName: "team_label",
        ownerColumnName: "teamId",
        relationColumnName: "labelId",
      }),
    );

    /*
     * "linked to none of nothing" is everybody, so this is the one value-taking
     * many-to-many builder whose empty case matches ALL rows.
     */
    expect(operator.getSql(OWNER_ID_ALIAS)).toBe("TRUE = TRUE");
    expect(Object.keys(operator.objectLiteralParameters)).toHaveLength(0);
  });

  it("escapes identifiers and keeps the filtered ids out of the SQL text", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.noneEntitiesInManyToMany({
        values: ["label-1"],
        joinTableName: 'a"b',
        ownerColumnName: "teamId",
        relationColumnName: "labelId",
      }),
    );

    const sql: string = operator.getSql(OWNER_ID_ALIAS);

    expect(sql).toContain('"a""b"');
    expect(sql).not.toContain("label-1");
  });
});

describe("QueryHelper.allEntitiesInManyToMany", () => {
  it("groups by owner and requires a DISTINCT relation count of every requested id", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.allEntitiesInManyToMany({
        values: ["label-1", "label-2", "label-3"],
        joinTableName: "team_label",
        ownerColumnName: "teamId",
        relationColumnName: "labelId",
      }),
    );

    const sql: string = operator.getSql(OWNER_ID_ALIAS);

    expect(sql).toContain(`(${OWNER_ID_ALIAS} IN (SELECT`);
    expect(sql).toContain('GROUP BY "team_label"."teamId"');
    expect(sql).toContain('HAVING COUNT(DISTINCT "team_label"."labelId") >= :');
  });

  it("binds both the relation-id array and the required count (= number of values)", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.allEntitiesInManyToMany({
        values: ["label-1", "label-2", "label-3"],
        joinTableName: "team_label",
        ownerColumnName: "teamId",
        relationColumnName: "labelId",
      }),
    );

    const boundValues: Array<unknown> = Object.values(
      operator.objectLiteralParameters,
    );

    /* One parameter is the id array; the other is the HAVING threshold. */
    expect(boundValues).toEqual(
      expect.arrayContaining([["label-1", "label-2", "label-3"], 3]),
    );
    expect(Object.keys(operator.objectLiteralParameters)).toHaveLength(2);
  });

  it("counts duplicate values verbatim — the threshold is the list length, not the distinct size", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.allEntitiesInManyToMany({
        values: ["label-1", "label-1"],
        joinTableName: "team_label",
        ownerColumnName: "teamId",
        relationColumnName: "labelId",
      }),
    );

    const boundValues: Array<unknown> = Object.values(
      operator.objectLiteralParameters,
    );

    expect(boundValues).toEqual(
      expect.arrayContaining([["label-1", "label-1"], 2]),
    );
  });

  it("fails CLOSED on an empty list: a constant-false predicate with no parameters", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.allEntitiesInManyToMany({
        values: [],
        joinTableName: "team_label",
        ownerColumnName: "teamId",
        relationColumnName: "labelId",
      }),
    );

    expect(operator.getSql(OWNER_ID_ALIAS)).toBe("TRUE = FALSE");
    expect(Object.keys(operator.objectLiteralParameters)).toHaveLength(0);
  });
});

describe("QueryHelper.anyEntitiesInManyToMany / noEntitiesInManyToMany", () => {
  it("anyEntitiesInManyToMany matches owners that have at least one non-null join row", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.anyEntitiesInManyToMany({
        joinTableName: "team_label",
        ownerColumnName: "teamId",
      }),
    );

    const sql: string = operator.getSql(OWNER_ID_ALIAS);

    expect(sql).toContain(`(${OWNER_ID_ALIAS} IN (SELECT`);
    expect(sql).toContain('WHERE "team_label"."teamId" IS NOT NULL');
    expect(sql).not.toContain("NOT IN");
    /* This overload takes no values, so it binds nothing. */
    expect(Object.keys(operator.objectLiteralParameters)).toHaveLength(0);
  });

  it("noEntitiesInManyToMany matches owners with no join rows at all", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.noEntitiesInManyToMany({
        joinTableName: "team_label",
        ownerColumnName: "teamId",
      }),
    );

    const sql: string = operator.getSql(OWNER_ID_ALIAS);

    expect(sql).toContain(`(${OWNER_ID_ALIAS} NOT IN (SELECT`);
    expect(sql).toContain('WHERE "team_label"."teamId" IS NOT NULL');
    expect(Object.keys(operator.objectLiteralParameters)).toHaveLength(0);
  });

  it("neither presence-check references a relation column — only the owner column", () => {
    const anyOperator: RawOperator = asRaw(
      QueryHelper.anyEntitiesInManyToMany({
        joinTableName: "team_label",
        ownerColumnName: "teamId",
      }),
    );
    const noneOperator: RawOperator = asRaw(
      QueryHelper.noEntitiesInManyToMany({
        joinTableName: "team_label",
        ownerColumnName: "teamId",
      }),
    );

    /* A presence check is purely about the owner side of the join. */
    expect(anyOperator.getSql(OWNER_ID_ALIAS)).not.toContain("labelId");
    expect(noneOperator.getSql(OWNER_ID_ALIAS)).not.toContain("labelId");
  });

  it("escapes identifiers in the value-free presence checks too", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.anyEntitiesInManyToMany({
        joinTableName: 'j"t',
        ownerColumnName: 'o"c',
      }),
    );

    const sql: string = operator.getSql(OWNER_ID_ALIAS);

    expect(sql).toContain('"j""t"');
    expect(sql).toContain('"o""c"');
  });
});

describe("QueryHelper many-to-many — fail-open vs fail-closed on empty input", () => {
  it("directs each empty case to the correct sentinel", () => {
    const emptyValueData: {
      values: Array<string>;
      joinTableName: string;
      ownerColumnName: string;
      relationColumnName: string;
    } = {
      values: [],
      joinTableName: "team_label",
      ownerColumnName: "teamId",
      relationColumnName: "labelId",
    };

    /*
     * "any of" and "all of" nothing select nobody (fail closed); "none of"
     * nothing selects everybody (fail open). Locking all three together makes
     * an accidental flip of one obvious.
     */
    expect(
      asRaw(QueryHelper.anyOfEntitiesInManyToMany(emptyValueData)).getSql(
        OWNER_ID_ALIAS,
      ),
    ).toBe("TRUE = FALSE");
    expect(
      asRaw(QueryHelper.allEntitiesInManyToMany(emptyValueData)).getSql(
        OWNER_ID_ALIAS,
      ),
    ).toBe("TRUE = FALSE");
    expect(
      asRaw(QueryHelper.noneEntitiesInManyToMany(emptyValueData)).getSql(
        OWNER_ID_ALIAS,
      ),
    ).toBe("TRUE = TRUE");
  });

  it("mints a fresh parameter name per call so two filters can share one query", () => {
    const first: RawOperator = asRaw(
      QueryHelper.anyOfEntitiesInManyToMany({
        values: ["a"],
        joinTableName: "team_label",
        ownerColumnName: "teamId",
        relationColumnName: "labelId",
      }),
    );
    const second: RawOperator = asRaw(
      QueryHelper.anyOfEntitiesInManyToMany({
        values: ["b"],
        joinTableName: "team_label",
        ownerColumnName: "teamId",
        relationColumnName: "labelId",
      }),
    );

    expect(Object.keys(first.objectLiteralParameters)[0]).not.toBe(
      Object.keys(second.objectLiteralParameters)[0],
    );
  });
});

describe("QueryHelper.all — empty values fail closed", () => {
  it("compiles a non-empty list into an `= ALL(:param)` predicate", () => {
    const operator: RawOperator = asRaw(QueryHelper.all(["a", "b"]));

    const sql: string = operator.getSql('"Alert"."monitorId"');

    expect(sql).toContain('("Alert"."monitorId" = ALL(:');
    expect(Object.values(operator.objectLiteralParameters)).toEqual([
      ["a", "b"],
    ]);
  });

  it("stringifies ObjectID members before binding them", () => {
    const id: ObjectID = ObjectID.generate();

    const operator: RawOperator = asRaw(QueryHelper.all([id]));

    expect(Object.values(operator.objectLiteralParameters)).toEqual([
      [id.toString()],
    ]);
  });

  it("returns the constant-false sentinel with no parameters for an empty list", () => {
    const operator: RawOperator = asRaw(QueryHelper.all([]));

    expect(operator.getSql('"Alert"."monitorId"')).toBe("TRUE = FALSE");
    expect(Object.keys(operator.objectLiteralParameters)).toHaveLength(0);
  });
});

describe("QueryHelper.any / in — empty values fail closed", () => {
  it("compiles a non-empty list into an `IN (:...param)` predicate", () => {
    const operator: RawOperator = asRaw(QueryHelper.any(["a", "b"]));

    const sql: string = operator.getSql('"Alert"."monitorId"');

    expect(sql).toContain('("Alert"."monitorId" IN (:...');
    expect(Object.values(operator.objectLiteralParameters)).toEqual([
      ["a", "b"],
    ]);
  });

  it("coerces numeric members to strings (any delegates to the private in())", () => {
    const operator: RawOperator = asRaw(QueryHelper.any([1, 2, 3]));

    expect(Object.values(operator.objectLiteralParameters)).toEqual([
      ["1", "2", "3"],
    ]);
  });

  it("returns the constant-false sentinel with no parameters for an empty list", () => {
    const operator: RawOperator = asRaw(QueryHelper.any([]));

    expect(operator.getSql('"Alert"."monitorId"')).toBe("TRUE = FALSE");
    expect(Object.keys(operator.objectLiteralParameters)).toHaveLength(0);
  });
});

describe("QueryHelper.notIn / notInOrNull — empty values fail open", () => {
  it("compiles a non-empty notIn into a `NOT IN (:...param)` predicate", () => {
    const operator: RawOperator = asRaw(QueryHelper.notIn(["a", "b"]));

    const sql: string = operator.getSql('"Alert"."monitorId"');

    expect(sql).toContain('("Alert"."monitorId" NOT IN (:...');
    expect(sql).not.toContain("IS NULL");
    expect(Object.values(operator.objectLiteralParameters)).toEqual([
      ["a", "b"],
    ]);
  });

  it("notInOrNull adds an `IS NULL` arm so unset rows are kept", () => {
    const operator: RawOperator = asRaw(QueryHelper.notInOrNull(["a"]));

    const sql: string = operator.getSql('"Alert"."monitorId"');

    expect(sql).toContain("NOT IN (:...");
    expect(sql).toContain('or "Alert"."monitorId" IS NULL');
  });

  it("both fail OPEN on an empty list: constant-true, no parameters", () => {
    const notInOperator: RawOperator = asRaw(QueryHelper.notIn([]));
    const notInOrNullOperator: RawOperator = asRaw(QueryHelper.notInOrNull([]));

    /*
     * "not in nothing" excludes nothing, so an empty exclusion list must keep
     * every row rather than emit an illegal `NOT IN ()`.
     */
    expect(notInOperator.getSql('"Alert"."monitorId"')).toBe("TRUE = TRUE");
    expect(notInOrNullOperator.getSql('"Alert"."monitorId"')).toBe(
      "TRUE = TRUE",
    );
    expect(Object.keys(notInOperator.objectLiteralParameters)).toHaveLength(0);
    expect(
      Object.keys(notInOrNullOperator.objectLiteralParameters),
    ).toHaveLength(0);
  });
});

describe("QueryHelper.equalToOrNull — single, array, and empty-array shapes", () => {
  it("ORs a single value against an `IS NULL` check", () => {
    const operator: RawOperator = asRaw(QueryHelper.equalToOrNull("v"));

    const sql: string = operator.getSql('"Alert"."monitorId"');

    expect(sql).toContain('"Alert"."monitorId" = :');
    expect(sql).toContain('or "Alert"."monitorId" IS NULL)');
    expect(Object.values(operator.objectLiteralParameters)).toEqual(["v"]);
  });

  it("binds one distinct parameter per array member, OR-joined, then IS NULL", () => {
    const operator: RawOperator = asRaw(QueryHelper.equalToOrNull(["a", "b"]));

    const sql: string = operator.getSql('"Alert"."monitorId"');

    /* Two members mean two equality arms plus the trailing null arm. */
    expect(sql.match(/[=] :/g) || []).toHaveLength(2);
    expect(sql).toContain("IS NULL)");

    const boundValues: Array<unknown> = Object.values(
      operator.objectLiteralParameters,
    );
    expect(boundValues).toEqual(expect.arrayContaining(["a", "b"]));
    expect(Object.keys(operator.objectLiteralParameters)).toHaveLength(2);
  });

  it("stringifies ObjectID members of the array", () => {
    const id: ObjectID = ObjectID.generate();

    const operator: RawOperator = asRaw(QueryHelper.equalToOrNull([id]));

    expect(Object.values(operator.objectLiteralParameters)).toEqual([
      id.toString(),
    ]);
  });

  it("an empty array degrades to a null-only check that binds nothing", () => {
    const operator: RawOperator = asRaw(QueryHelper.equalToOrNull([]));

    const sql: string = operator.getSql('"Alert"."monitorId"');

    /*
     * With no members the equality arms collapse away; what survives is the
     * IS NULL tail, and no value is ever bound.
     */
    expect(sql).toContain("IS NULL)");
    expect(Object.keys(operator.objectLiteralParameters)).toHaveLength(0);
  });
});
