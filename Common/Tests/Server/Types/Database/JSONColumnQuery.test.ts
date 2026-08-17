import buildJSONColumnQuery, {
  JSONColumnQuery,
  MAX_JSON_QUERY_KEYS,
  MAX_JSON_QUERY_KEY_LENGTH,
  MAX_JSON_QUERY_VALUES_PER_KEY,
  escapeLikePattern,
} from "../../../../Server/Types/Database/JSONColumnQuery";
import EndsWith from "../../../../Types/BaseDatabase/EndsWith";
import EqualTo from "../../../../Types/BaseDatabase/EqualTo";
import EqualToOrNull from "../../../../Types/BaseDatabase/EqualToOrNull";
import GreaterThan from "../../../../Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "../../../../Types/BaseDatabase/GreaterThanOrEqual";
import GreaterThanOrNull from "../../../../Types/BaseDatabase/GreaterThanOrNull";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IncludesAll from "../../../../Types/BaseDatabase/IncludesAll";
import IncludesNone from "../../../../Types/BaseDatabase/IncludesNone";
import IsNull from "../../../../Types/BaseDatabase/IsNull";
import LessThan from "../../../../Types/BaseDatabase/LessThan";
import LessThanOrEqual from "../../../../Types/BaseDatabase/LessThanOrEqual";
import NotContains from "../../../../Types/BaseDatabase/NotContains";
import NotEqual from "../../../../Types/BaseDatabase/NotEqual";
import NotNull from "../../../../Types/BaseDatabase/NotNull";
import Search from "../../../../Types/BaseDatabase/Search";
import StartsWith from "../../../../Types/BaseDatabase/StartsWith";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * This module compiles the WHERE clause for "filter incidents by the value of
 * a custom field", so two whole classes of bug live here and nowhere else.
 *
 * The first is injection. A custom field's name is text a project member
 * types, and it used to be spliced straight into the SQL string — every test
 * below that inspects `parameters` rather than the SQL is guarding the fix.
 *
 * The second is silent wrong answers. A multi-select stores its value as a
 * JSON array, a Number custom field stores its value as a *string*, and a row
 * that never had the field at all has no key. Each of those, read naively,
 * produces a filter that runs, returns rows, and is wrong — the worst possible
 * failure for something people use to report on their incidents.
 *
 * The tests use a deterministic parameter-name generator so the emitted SQL
 * can be asserted verbatim. Production uses random names purely so two
 * operators in one query cannot collide.
 */

const COLUMN: string = '"Incident"."customFields"';

type SequentialNamesFunction = () => () => string;

const sequentialNames: SequentialNamesFunction = (): (() => string) => {
  let index: number = 0;

  return (): string => {
    index++;
    return `p${index}`;
  };
};

type BuildFunction = (value: JSONObject) => JSONColumnQuery;

const build: BuildFunction = (value: JSONObject): JSONColumnQuery => {
  return buildJSONColumnQuery({
    value: value,
    generateParameterName: sequentialNames(),
  });
};

type SqlOfFunction = (value: JSONObject) => string;

const sqlOf: SqlOfFunction = (value: JSONObject): string => {
  return build(value).toSql(COLUMN);
};

describe("buildJSONColumnQuery — the shape of a key lookup", () => {
  test("reads the key through a bound parameter, never through the SQL text", () => {
    const query: JSONColumnQuery = build({ Team: "Payments" });
    const sql: string = query.toSql(COLUMN);

    // The key appears as a parameter value...
    expect(query.parameters["p1"]).toBe("Team");
    // ...and never as a literal in the statement.
    expect(sql).not.toContain("'Team'");
    expect(sql).toContain("->> CAST(:p1 AS TEXT)");
    expect(sql).toContain("-> CAST(:p1 AS TEXT)");
  });

  test("casts the key so the overloaded -> / ->> operators resolve", () => {
    /*
     * `jsonb -> text` and `jsonb -> integer` are both defined. An untyped bind
     * parameter leaves Postgres unable to pick one and the query fails with
     * "operator is not unique" — which only shows up against a real database,
     * so it is pinned here.
     */
    expect(sqlOf({ Team: "Payments" })).toContain("CAST(:p1 AS TEXT)");
  });

  test("quotes nothing itself — the caller supplies the column reference", () => {
    const query: JSONColumnQuery = build({ Team: "Payments" });

    expect(query.toSql('"Alert"."customFields"')).toContain(
      '"Alert"."customFields"',
    );
  });
});

describe("buildJSONColumnQuery — SQL injection through the key", () => {
  test("a key that closes the quote and appends a predicate is inert", () => {
    const key: string = "a' = 'a' OR 1=1 OR 'x";
    const query: JSONColumnQuery = build({ [key]: "v" });
    const sql: string = query.toSql(COLUMN);

    expect(sql).not.toContain("OR 1=1");
    expect(sql).not.toContain(key);
    expect(Object.values(query.parameters)).toContain(key);
  });

  test("a key carrying a statement terminator is inert", () => {
    const key: string = '"; DROP TABLE "Incident"; --';
    const query: JSONColumnQuery = build({ [key]: "v" });
    const sql: string = query.toSql(COLUMN);

    expect(sql).not.toContain("DROP TABLE");
    expect(Object.values(query.parameters)).toContain(key);
  });

  test("a value that closes the quote is inert", () => {
    const value: string = "x' OR 'a'='a";
    const query: JSONColumnQuery = build({ Team: value });

    expect(query.toSql(COLUMN)).not.toContain("OR 'a'='a");
    expect(Object.values(query.parameters)).toContain(value);
  });

  test("the emitted statement contains no single-quoted user data at all", () => {
    const sql: string = sqlOf({
      "'quoted'": new Includes(["'also quoted'"]),
      "%wild%": new Search("'sneaky'"),
    });

    /*
     * Every literal the builder writes is one it authored: the jsonb type
     * names, the empty string, and the numeric guard's regex. Anything else
     * between quotes is user data that reached the statement text.
     */
    const authored: Set<string> = new Set<string>([
      "''",
      "'array'",
      "'null'",
      `'^\\s*-?[0-9]+(\\.[0-9]+)?\\s*$'`,
    ]);

    for (const literal of sql.match(/'[^']*'/g) || []) {
      expect(authored.has(literal)).toBe(true);
    }
  });

  test("the numeric guard's regex is the only literal a comparison writes", () => {
    const sql: string = sqlOf({ "'k'": new GreaterThan(1) });

    for (const literal of sql.match(/'[^']*'/g) || []) {
      expect(literal).toBe(`'^\\s*-?[0-9]+(\\.[0-9]+)?\\s*$'`);
    }
  });
});

describe("buildJSONColumnQuery — statelessness", () => {
  test("renders the same SQL when asked twice", () => {
    /*
     * The previous implementation rewrote its captured template inside the
     * Raw callback, so the second render (findBy and countBy each resolve the
     * operator) saw an already-substituted string. Pinning both calls keeps
     * that from coming back.
     */
    const query: JSONColumnQuery = build({ Team: "Payments" });

    expect(query.toSql(COLUMN)).toBe(query.toSql(COLUMN));
  });

  test("renders correctly for a second, different column reference", () => {
    const query: JSONColumnQuery = build({ Team: "Payments" });

    query.toSql('"Incident"."customFields"');
    const second: string = query.toSql('"Alert"."customFields"');

    expect(second).toContain('"Alert"."customFields"');
    expect(second).not.toContain('"Incident"');
  });

  test("does not mint new parameters on render", () => {
    const query: JSONColumnQuery = build({ Team: "Payments" });
    const before: number = Object.keys(query.parameters).length;

    query.toSql(COLUMN);
    query.toSql(COLUMN);

    expect(Object.keys(query.parameters).length).toBe(before);
  });
});

describe("buildJSONColumnQuery — equality", () => {
  test("matches a scalar value", () => {
    const query: JSONColumnQuery = build({ Team: "Payments" });

    expect(query.toSql(COLUMN)).toContain(
      `${COLUMN} ->> CAST(:p1 AS TEXT) = CAST(:p2 AS TEXT)`,
    );
    expect(query.parameters["p2"]).toBe("Payments");
  });

  test("also matches a value stored inside an array", () => {
    /*
     * A multi-select stores ["Payments","Billing"]. Without the containment
     * arm, `->>` returns the literal text '["Payments", "Billing"]' and the
     * filter quietly returns nothing — the highest-value assertion in the file.
     */
    const query: JSONColumnQuery = build({ Team: "Payments" });
    const sql: string = query.toSql(COLUMN);

    expect(sql).toContain("jsonb_typeof(");
    expect(sql).toContain("= 'array'");
    expect(sql).toContain("@> CAST(:p3 AS JSONB)");
    expect(query.parameters["p3"]).toBe('["Payments"]');
  });

  test("keeps a number a number in the containment literal", () => {
    const query: JSONColumnQuery = build({ Count: 42 });

    expect(query.parameters["p2"]).toBe("42");
    expect(query.parameters["p3"]).toBe("[42]");
  });

  test("keeps a boolean a boolean in the containment literal", () => {
    const query: JSONColumnQuery = build({ Regulated: true });

    expect(query.parameters["p2"]).toBe("true");
    expect(query.parameters["p3"]).toBe("[true]");
  });

  test("EqualTo compiles the same predicate as a bare value", () => {
    expect(sqlOf({ Team: new EqualTo("Payments") })).toBe(
      sqlOf({ Team: "Payments" }),
    );
  });

  test("EqualToOrNull also matches rows with no value", () => {
    const sql: string = sqlOf({ Team: new EqualToOrNull("Payments") });

    expect(sql).toContain("IS NULL");
    expect(sql).toContain(" OR ");
  });
});

describe("buildJSONColumnQuery — negation includes rows without the key", () => {
  test("NotEqual uses IS NOT TRUE rather than NOT", () => {
    /*
     * A row without the key compares to NULL. `NOT NULL` is NULL, which drops
     * exactly the rows "Team is not Payments" is asked about; `IS NOT TRUE`
     * keeps them.
     */
    const sql: string = sqlOf({ Team: new NotEqual("Payments") });

    expect(sql).toContain("IS NOT TRUE");
    expect(sql).not.toMatch(/NOT\s+\(/);
  });

  test("IncludesNone negates the whole any-of predicate", () => {
    const sql: string = sqlOf({ Team: new IncludesNone(["a", "b"]) });

    expect(sql).toContain(" OR ");
    expect(sql).toContain("IS NOT TRUE");
  });

  test("NotContains negates the ILIKE", () => {
    const sql: string = sqlOf({ Team: new NotContains("pay") });

    expect(sql).toContain("ILIKE");
    expect(sql).toContain("IS NOT TRUE");
  });
});

describe("buildJSONColumnQuery — multi-value operators", () => {
  test("Includes ORs one equality per value", () => {
    const query: JSONColumnQuery = build({
      Team: new Includes(["Payments", "Billing"]),
    });
    const sql: string = query.toSql(COLUMN);

    expect(sql).toContain(" OR ");
    expect(query.parameters["p2"]).toBe("Payments");
    expect(query.parameters["p4"]).toBe("Billing");
  });

  test("IncludesAll ANDs one equality per value", () => {
    const sql: string = sqlOf({
      Team: new IncludesAll(["Payments", "Billing"]),
    });

    expect(sql).toContain(" AND ");
    expect(sql).not.toContain(" OR CAST");
  });

  test("a bare array reads as is-any-of", () => {
    expect(sqlOf({ Team: ["a", "b"] })).toBe(
      sqlOf({ Team: new Includes(["a", "b"]) }),
    );
  });

  test("ObjectID values stringify", () => {
    const id: ObjectID = ObjectID.generate();
    const query: JSONColumnQuery = build({ Owner: new Includes([id]) });

    expect(query.parameters["p2"]).toBe(id.toString());
  });

  test("an empty selection constrains nothing rather than matching nothing", () => {
    /*
     * A cleared multi-select must not hide the table. `(1 = 1)` is the honest
     * compilation of "the user selected nothing".
     */
    expect(sqlOf({ Team: new Includes([]) })).toBe("(1 = 1)");
    expect(sqlOf({ Team: new IncludesNone([]) })).toBe("(1 = 1)");
    expect(sqlOf({ Team: new IncludesAll([]) })).toBe("(1 = 1)");
    expect(sqlOf({ Team: [] })).toBe("(1 = 1)");
  });

  test("an empty selection alongside a real one leaves the real one", () => {
    const sql: string = sqlOf({
      Team: new Includes([]),
      Region: "us-east-1",
    });

    expect(sql).not.toBe("(1 = 1)");
    expect(sql).toContain("CAST(:p3 AS TEXT)");
  });
});

describe("buildJSONColumnQuery — text search", () => {
  test("Search wraps the needle on both sides", () => {
    const query: JSONColumnQuery = build({ Notes: new Search("outage") });

    expect(query.toSql(COLUMN)).toContain("ILIKE :p2");
    expect(query.parameters["p2"]).toBe("%outage%");
  });

  test("StartsWith and EndsWith anchor the pattern", () => {
    expect(build({ Notes: new StartsWith("out") }).parameters["p2"]).toBe(
      "out%",
    );
    expect(build({ Notes: new EndsWith("age") }).parameters["p2"]).toBe("%age");
  });

  test("wildcards inside the needle are escaped", () => {
    /*
     * "contains 100%" must not become "contains 100 followed by anything".
     */
    expect(build({ Notes: new Search("100%") }).parameters["p2"]).toBe(
      "%100\\%%",
    );
    expect(build({ Notes: new Search("a_b") }).parameters["p2"]).toBe(
      "%a\\_b%",
    );
    expect(build({ Notes: new Search("c:\\tmp") }).parameters["p2"]).toBe(
      "%c:\\\\tmp%",
    );
  });

  test("escapeLikePattern doubles the escape character first", () => {
    expect(escapeLikePattern("\\%")).toBe("\\\\\\%");
  });
});

describe("buildJSONColumnQuery — numeric comparison", () => {
  test("guards the cast with a CASE, not an AND", () => {
    /*
     * A Number custom field is stored as text, and the column holds every
     * field's value, so a comparison meets arbitrary strings. Postgres does
     * not promise to evaluate an AND guard before the cast, and one
     * "invalid input syntax for type numeric" aborts the whole request.
     */
    const sql: string = sqlOf({ Count: new GreaterThan(5) });

    expect(sql).toContain("CASE WHEN");
    expect(sql).toContain("AS NUMERIC");
    expect(sql).toContain("ELSE NULL END");
  });

  test("emits the right operator for each comparison", () => {
    expect(sqlOf({ Count: new GreaterThan(5) })).toContain(") > CAST(");
    expect(sqlOf({ Count: new GreaterThanOrEqual(5) })).toContain(") >= CAST(");
    expect(sqlOf({ Count: new LessThan(5) })).toContain(") < CAST(");
    expect(sqlOf({ Count: new LessThanOrEqual(5) })).toContain(") <= CAST(");
  });

  test("binds the comparand as a number", () => {
    expect(build({ Count: new GreaterThan(5) }).parameters["p2"]).toBe(5);
  });

  test("InBetween over numbers compares numerically", () => {
    const sql: string = sqlOf({ Count: new InBetween(1, 10) });

    expect(sql).toContain("AS NUMERIC");
    expect(sql).toContain(" >= ");
    expect(sql).toContain(" <= ");
  });

  test("InBetween over non-numbers compares as text", () => {
    /*
     * ISO-8601 dates sort lexicographically in calendar order, so a text
     * BETWEEN is exact for them — and does not risk a cast error on a row
     * holding something else.
     */
    const sql: string = sqlOf({
      Window: new InBetween("2026-01-01", "2026-02-01"),
    });

    expect(sql).not.toContain("AS NUMERIC");
    expect(sql).toContain("AS TEXT");
  });
});

describe("buildJSONColumnQuery — emptiness", () => {
  test("IsNull covers absent, JSON null, empty string and empty array", () => {
    const sql: string = sqlOf({ Team: new IsNull() });

    expect(sql).toContain("IS NULL");
    expect(sql).toContain("jsonb_typeof");
    expect(sql).toContain("'null'");
    expect(sql).toContain("= ''");
    expect(sql).toContain("jsonb_array_length");
  });

  test("NotNull is the negation of that", () => {
    const sql: string = sqlOf({ Team: new NotNull() });

    expect(sql).toContain("jsonb_array_length");
    expect(sql).toContain("IS NOT TRUE");
  });

  test("an explicit null value reads as is-empty", () => {
    expect(sqlOf({ Team: null } as unknown as JSONObject)).toBe(
      sqlOf({ Team: new IsNull() }),
    );
  });
});

describe("buildJSONColumnQuery — backwards compatibility", () => {
  test("an empty object still means the whole column is empty", () => {
    /*
     * Every JSON filter that has ever been cleared sends `{}`. Retargeting it
     * would silently change what those saved filters mean.
     */
    expect(sqlOf({})).toBe(`(${COLUMN} IS NULL OR ${COLUMN} = '{}')`);
  });

  test("several plain keys AND together, as they always have", () => {
    const query: JSONColumnQuery = build({ a: "1", b: "2" });
    const sql: string = query.toSql(COLUMN);

    expect(sql).toContain(" AND ");
    expect(query.parameters["p1"]).toBe("a");
    expect(query.parameters["p2"]).toBe("1");
    expect(query.parameters["p4"]).toBe("b");
    expect(query.parameters["p5"]).toBe("2");
  });

  test("a JSON string argument is parsed", () => {
    const query: JSONColumnQuery = buildJSONColumnQuery({
      value: '{"Team":"Payments"}',
      generateParameterName: sequentialNames(),
    });

    expect(query.parameters["p1"]).toBe("Team");
    expect(query.parameters["p2"]).toBe("Payments");
  });

  test("an unparseable string degrades to the empty-column predicate", () => {
    const query: JSONColumnQuery = buildJSONColumnQuery({
      value: "not json at all",
      generateParameterName: sequentialNames(),
    });

    expect(query.toSql(COLUMN)).toBe(`(${COLUMN} IS NULL OR ${COLUMN} = '{}')`);
  });

  test("a nested object reads as containment", () => {
    const query: JSONColumnQuery = build({
      Address: { city: "Berlin" } as unknown as string,
    });

    expect(query.toSql(COLUMN)).toContain("@> CAST(:p2 AS JSONB)");
    expect(query.parameters["p2"]).toBe('{"city":"Berlin"}');
  });

  test("an empty key is skipped", () => {
    expect(sqlOf({ "": "x" })).toBe("(1 = 1)");
  });
});

describe("buildJSONColumnQuery — limits", () => {
  test("refuses more keys than the cap", () => {
    const value: JSONObject = {};

    for (let i: number = 0; i <= MAX_JSON_QUERY_KEYS; i++) {
      value[`key${i}`] = "v";
    }

    expect(() => {
      return build(value);
    }).toThrow(BadDataException);
  });

  test("refuses more values on one key than the cap", () => {
    const values: Array<string> = [];

    for (let i: number = 0; i <= MAX_JSON_QUERY_VALUES_PER_KEY; i++) {
      values.push(`v${i}`);
    }

    expect(() => {
      return build({ Team: new Includes(values) });
    }).toThrow(BadDataException);
  });

  test("refuses a key longer than the cap", () => {
    expect(() => {
      return build({ ["k".repeat(MAX_JSON_QUERY_KEY_LENGTH + 1)]: "v" });
    }).toThrow(BadDataException);
  });

  test("accepts a payload exactly at the caps", () => {
    const values: Array<string> = [];

    for (let i: number = 0; i < MAX_JSON_QUERY_VALUES_PER_KEY; i++) {
      values.push(`v${i}`);
    }

    expect(() => {
      return build({
        ["k".repeat(MAX_JSON_QUERY_KEY_LENGTH)]: new Includes(values),
      });
    }).not.toThrow();
  });
});

describe("buildJSONColumnQuery — parameter hygiene", () => {
  test("mints a distinct parameter for every bound value", () => {
    const query: JSONColumnQuery = build({
      Team: new Includes(["a", "b"]),
      Region: "us-east-1",
    });

    const names: Array<string> = Object.keys(query.parameters);

    expect(new Set(names).size).toBe(names.length);
  });

  test("production names do not collide across keys", () => {
    const query: JSONColumnQuery = buildJSONColumnQuery({
      value: { a: "1", b: "2", c: "3" },
    });

    const names: Array<string> = Object.keys(query.parameters);

    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBe(9);
  });

  test("every placeholder in the SQL has a parameter behind it", () => {
    const query: JSONColumnQuery = buildJSONColumnQuery({
      value: {
        Team: new Includes(["a", "b"]),
        Count: new GreaterThan(3),
        Notes: new Search("x"),
        Cleared: new IsNull(),
      },
    });

    const placeholders: Array<string> = (
      query.toSql(COLUMN).match(/:[A-Za-z]+/g) || []
    ).map((placeholder: string) => {
      return placeholder.slice(1);
    });

    expect(placeholders.length).toBeGreaterThan(0);

    for (const placeholder of placeholders) {
      expect(query.parameters).toHaveProperty(placeholder);
    }
  });
});

/*
 * ---------------------------------------------------------------------------
 * Ordering comparisons over a Date custom field
 * ---------------------------------------------------------------------------
 *
 * A Date / DateTime custom field stores its value as an ISO-8601 UTC string,
 * because jsonb has no date type and the column is shared by every field the
 * project defines. "Renewal is after 2026-08-17" therefore reaches this module
 * as `GreaterThan("2026-08-17T00:00:00.000Z")` — a string operand on an
 * operator that, until compareOrdered existed, cast unconditionally to NUMERIC.
 *
 * The failure that produced was the quiet kind. `Number("2026-08-17T...")` is
 * NaN, so the bound parameter rendered as `CAST(NaN AS NUMERIC)`, and
 * numericExpression independently returns NULL for text that does not match the
 * numeric regex. Every row was evaluated as `NULL > NaN` — never an error,
 * never true — so the product showed a lit filter chip above an empty table and
 * nothing anywhere said why. These tests exist so that shape cannot return.
 */

type OrderedOperatorCase = {
  name: string;
  sqlOperator: string;
  operatorFor: (value: string) => JSONObject[string];
};

const ORDERED_OPERATORS: Array<OrderedOperatorCase> = [
  {
    name: "GreaterThan",
    sqlOperator: ">",
    operatorFor: (value: string): JSONObject[string] => {
      return new GreaterThan(value);
    },
  },
  {
    name: "GreaterThanOrEqual",
    sqlOperator: ">=",
    operatorFor: (value: string): JSONObject[string] => {
      return new GreaterThanOrEqual(value);
    },
  },
  {
    name: "LessThan",
    sqlOperator: "<",
    operatorFor: (value: string): JSONObject[string] => {
      return new LessThan(value);
    },
  },
  {
    name: "LessThanOrEqual",
    sqlOperator: "<=",
    operatorFor: (value: string): JSONObject[string] => {
      return new LessThanOrEqual(value);
    },
  },
];

const ISO_INSTANT: string = "2026-08-17T00:00:00.000Z";

describe("buildJSONColumnQuery — ordered comparison against an ISO-8601 date", () => {
  test("GreaterThan reads the key as text and compares against TEXT", () => {
    const query: JSONColumnQuery = build({
      Renewal: new GreaterThan(ISO_INSTANT),
    });

    expect(query.toSql(COLUMN)).toContain(
      `${COLUMN} ->> CAST(:p1 AS TEXT) > CAST(:p2 AS TEXT)`,
    );
    expect(query.parameters["p2"]).toBe(ISO_INSTANT);
  });

  test("GreaterThanOrEqual reads the key as text and compares against TEXT", () => {
    const query: JSONColumnQuery = build({
      Renewal: new GreaterThanOrEqual(ISO_INSTANT),
    });

    expect(query.toSql(COLUMN)).toContain(
      `${COLUMN} ->> CAST(:p1 AS TEXT) >= CAST(:p2 AS TEXT)`,
    );
    expect(query.parameters["p2"]).toBe(ISO_INSTANT);
  });

  test("LessThan reads the key as text and compares against TEXT", () => {
    const query: JSONColumnQuery = build({
      Renewal: new LessThan(ISO_INSTANT),
    });

    expect(query.toSql(COLUMN)).toContain(
      `${COLUMN} ->> CAST(:p1 AS TEXT) < CAST(:p2 AS TEXT)`,
    );
    expect(query.parameters["p2"]).toBe(ISO_INSTANT);
  });

  test("LessThanOrEqual reads the key as text and compares against TEXT", () => {
    const query: JSONColumnQuery = build({
      Renewal: new LessThanOrEqual(ISO_INSTANT),
    });

    expect(query.toSql(COLUMN)).toContain(
      `${COLUMN} ->> CAST(:p1 AS TEXT) <= CAST(:p2 AS TEXT)`,
    );
    expect(query.parameters["p2"]).toBe(ISO_INSTANT);
  });

  test("a date-only value compares as text too", () => {
    /*
     * A Date (rather than DateTime) custom field stores "2026-08-17" with no
     * time part. It is still not a number, so it still has to take the text
     * arm — the Date and DateTime variants of the same field must not disagree
     * about whether their filter works.
     */
    const query: JSONColumnQuery = build({
      Renewal: new GreaterThan("2026-08-17"),
    });

    expect(query.toSql(COLUMN)).toContain("> CAST(:p2 AS TEXT)");
    expect(query.parameters["p2"]).toBe("2026-08-17");
  });
});

describe("buildJSONColumnQuery — the date-as-NaN regression", () => {
  test.each(ORDERED_OPERATORS)(
    "$name binds the ISO string itself, never NaN",
    (operatorCase: OrderedOperatorCase) => {
      /*
       * The single most important assertion for this change. The old code path
       * bound `Number(value)`, which for any ISO-8601 string is NaN, so the
       * emitted predicate was `NULL > NaN`. Postgres is perfectly happy to
       * evaluate that — it is NULL, not an error — so the filter returned zero
       * rows on every table and no log line anywhere recorded a problem.
       */
      const query: JSONColumnQuery = build({
        Renewal: operatorCase.operatorFor(ISO_INSTANT),
      });

      expect(query.parameters["p2"]).toBe(ISO_INSTANT);
      expect(Number.isNaN(query.parameters["p2"] as unknown as number)).toBe(
        false,
      );
    },
  );

  test.each(ORDERED_OPERATORS)(
    "$name does not emit the numeric CASE expression for a date",
    (operatorCase: OrderedOperatorCase) => {
      /*
       * numericExpression is the other half of the old bug: it returns NULL for
       * any text that fails the numeric regex, which every ISO-8601 string
       * does. Seeing `CASE WHEN ... AS NUMERIC` in a date predicate means the
       * left-hand side has gone back to being unconditionally NULL.
       */
      const sql: string = sqlOf({
        Renewal: operatorCase.operatorFor(ISO_INSTANT),
      });

      expect(sql).not.toContain("CASE WHEN");
      expect(sql).not.toContain("AS NUMERIC");
      expect(sql).toContain(`${operatorCase.sqlOperator} CAST(:p2 AS TEXT)`);
    },
  );

  test("no parameter anywhere in a date query is NaN", () => {
    /*
     * Swept across the whole bag rather than one name, so a future refactor
     * that renumbers or reorders the binds cannot let a NaN back in unnoticed.
     */
    const query: JSONColumnQuery = build({
      Opened: new GreaterThan(ISO_INSTANT),
      Closed: new LessThan("2026-12-31T23:59:59.999Z"),
    });

    for (const parameterValue of Object.values(query.parameters)) {
      expect(Number.isNaN(parameterValue as unknown as number)).toBe(false);
    }
  });
});

describe("buildJSONColumnQuery — ordered comparison against a number stays numeric", () => {
  test.each(ORDERED_OPERATORS)(
    "$name over a numeric string still casts to NUMERIC",
    (operatorCase: OrderedOperatorCase) => {
      /*
       * The guard in the other direction. A Number custom field arrives as text
       * from the form, so "42" is the normal shape of a numeric operand — if it
       * fell through to the text arm, "9" would sort above "10" and every
       * numeric threshold filter in the product would be quietly wrong.
       */
      const query: JSONColumnQuery = build({
        Count: operatorCase.operatorFor("42"),
      });

      expect(query.toSql(COLUMN)).toContain("AS NUMERIC");
      expect(query.parameters["p2"]).toBe(42);
    },
  );

  test("a real number operand still casts to NUMERIC and binds as a number", () => {
    const query: JSONColumnQuery = build({
      Count: new GreaterThan(5),
    });

    expect(query.toSql(COLUMN)).toContain("CASE WHEN");
    expect(query.toSql(COLUMN)).toContain(") > CAST(:p2 AS NUMERIC)");
    expect(query.parameters["p2"]).toBe(5);
  });

  test('the "9 versus 10" case is the reason numbers must not go through text', () => {
    /*
     * Written as an assertion about JavaScript rather than about SQL because
     * Postgres' text collation orders these the same way: as text "9" > "10",
     * as numbers 9 < 10. Anyone tempted to simplify compareOrdered down to a
     * single text comparison should have to delete this test first.
     */
    expect("9" > "10").toBe(true);
    expect(Number("9") > Number("10")).toBe(false);

    expect(sqlOf({ Count: new GreaterThan("9") })).toContain("AS NUMERIC");
  });

  test("a negative or fractional numeric string is still numeric", () => {
    expect(build({ Count: new LessThan("-3.5") }).parameters["p2"]).toBe(-3.5);
    expect(build({ Count: new GreaterThan("0.25") }).parameters["p2"]).toBe(
      0.25,
    );
    expect(sqlOf({ Count: new LessThan("-3.5") })).toContain("AS NUMERIC");
  });

  test("whitespace around a numeric string does not push it to the text arm", () => {
    /*
     * isNumericValue trims before Number(), and NUMERIC_TEXT_REGEX allows
     * surrounding whitespace on the stored side, so both halves of the
     * comparison agree that " 7 " is seven. If only one of them trimmed, the
     * operand and the column would be compared under different rules.
     */
    const query: JSONColumnQuery = build({ Count: new GreaterThan(" 7 ") });

    expect(query.toSql(COLUMN)).toContain("AS NUMERIC");
    expect(query.parameters["p2"]).toBe(7);
  });
});

describe("buildJSONColumnQuery — InBetween keeps its existing branch", () => {
  test("two ISO dates compare as text on both bounds", () => {
    /*
     * InBetween has always chosen text for non-numeric bounds; this pins it so
     * that the four operators which just joined it cannot drift apart from it
     * again. A date range facet and a date threshold facet over the same field
     * must agree about what "after" means.
     */
    const query: JSONColumnQuery = build({
      Window: new InBetween(ISO_INSTANT, "2026-09-01T00:00:00.000Z"),
    });
    const sql: string = query.toSql(COLUMN);

    expect(sql).toContain(">= CAST(:p2 AS TEXT)");
    expect(sql).toContain("<= CAST(:p3 AS TEXT)");
    expect(sql).not.toContain("AS NUMERIC");
    expect(query.parameters["p2"]).toBe(ISO_INSTANT);
    expect(query.parameters["p3"]).toBe("2026-09-01T00:00:00.000Z");
  });

  test("a numeric start with a date end falls to text", () => {
    /*
     * The branch is `isNumericValue(start) && isNumericValue(end)`, so one
     * non-numeric bound demotes the whole range. That is the safe direction:
     * casting a date bound to NUMERIC reproduces the NaN bug, whereas comparing
     * a number as text merely mis-sorts a range nothing in the product builds.
     */
    const query: JSONColumnQuery = build({
      Window: new InBetween(1 as unknown as string, "2026-01-01"),
    });

    expect(query.toSql(COLUMN)).not.toContain("AS NUMERIC");
    expect(query.parameters["p2"]).toBe("1");
    expect(query.parameters["p3"]).toBe("2026-01-01");
  });

  test("a date start with a numeric end falls to text as well", () => {
    const query: JSONColumnQuery = build({
      Window: new InBetween("2026-01-01", 10 as unknown as string),
    });

    expect(query.toSql(COLUMN)).not.toContain("AS NUMERIC");
    expect(query.parameters["p2"]).toBe("2026-01-01");
    expect(query.parameters["p3"]).toBe("10");
  });

  test("two numeric bounds stay numeric", () => {
    const query: JSONColumnQuery = build({ Count: new InBetween(1, 10) });

    expect(query.toSql(COLUMN)).toContain("AS NUMERIC");
    expect(query.parameters["p2"]).toBe(1);
    expect(query.parameters["p3"]).toBe(10);
  });
});

describe("buildJSONColumnQuery — a Date instance reduces to its ISO string", () => {
  test("GreaterThan(Date) binds the exact ISO-8601 instant", () => {
    /*
     * toScalar used to fall through to String(value) for a Date, which yields
     * "Sun Aug 17 2026 00:00:00 GMT+0000 (Coordinated Universal Time)". Text
     * comparison over that sorts by weekday name — "Fri" before "Mon" before
     * "Sat" — which is not wrong in an obvious way, it is wrong in a way that
     * looks like a plausible result set.
     */
    const query: JSONColumnQuery = build({
      Renewal: new GreaterThan(new Date(ISO_INSTANT)),
    });

    expect(query.parameters["p2"]).toBe("2026-08-17T00:00:00.000Z");
  });

  test("LessThan(Date) binds the exact ISO-8601 instant", () => {
    const query: JSONColumnQuery = build({
      Renewal: new LessThan(new Date("2026-12-31T23:59:59.999Z")),
    });

    expect(query.parameters["p2"]).toBe("2026-12-31T23:59:59.999Z");
  });

  test("no locale-formatted date text reaches the parameter bag", () => {
    const query: JSONColumnQuery = build({
      Renewal: new GreaterThanOrEqual(new Date(ISO_INSTANT)),
    });
    const bound: string = String(query.parameters["p2"]);

    expect(bound).not.toContain("GMT");
    expect(bound).not.toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/);
    expect(bound).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("a Date and its own ISO string compile identically", () => {
    /*
     * The same filter reaches the server two ways: built server-side it still
     * holds a Date, and round-tripped through the browser it has already been
     * JSON-stringified to an ISO string. Both must produce the same predicate,
     * or a saved view would mean something different from the one the user is
     * looking at.
     */
    const fromDate: JSONColumnQuery = build({
      Renewal: new GreaterThan(new Date(ISO_INSTANT)),
    });
    const fromString: JSONColumnQuery = build({
      Renewal: new GreaterThan(ISO_INSTANT),
    });

    expect(fromDate.toSql(COLUMN)).toBe(fromString.toSql(COLUMN));
    expect(fromDate.parameters).toEqual(fromString.parameters);
  });

  test("InBetween over two Dates binds both bounds as ISO strings", () => {
    const query: JSONColumnQuery = build({
      Window: new InBetween(
        new Date("2026-01-01T00:00:00.000Z"),
        new Date("2026-02-01T00:00:00.000Z"),
      ),
    });

    expect(query.parameters["p2"]).toBe("2026-01-01T00:00:00.000Z");
    expect(query.parameters["p3"]).toBe("2026-02-01T00:00:00.000Z");
    expect(query.toSql(COLUMN)).not.toContain("AS NUMERIC");
  });
});

describe("buildJSONColumnQuery — why comparing dates as text is sound", () => {
  test("lexicographic order over ISO-8601 is chronological order", () => {
    /*
     * This is the justification for the whole change, so it is asserted rather
     * than left in a comment. ISO-8601 is fixed-width, zero-padded and
     * big-endian, which is exactly the property that makes a byte-wise string
     * comparison agree with an instant comparison. Nothing else about the
     * stored format may change without this test failing first.
     */
    const shuffled: Array<string> = [
      "2026-08-17T12:00:00.000Z",
      "2025-12-31T23:59:59.999Z",
      "2026-08-17T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      "2026-09-01T00:00:00.000Z",
    ];

    const byText: Array<string> = [...shuffled].sort();
    const byInstant: Array<string> = [...shuffled].sort(
      (left: string, right: string): number => {
        return new Date(left).getTime() - new Date(right).getTime();
      },
    );

    expect(byText).toEqual(byInstant);
  });

  test("the zero padding is what makes it hold", () => {
    /*
     * September is "09", not "9". Were it not padded, "2026-9-01" would sort
     * below "2026-10-01" as text and above it as a date, and the text
     * comparison this module now relies on would be wrong for a quarter of the
     * year.
     */
    expect("2026-09-01" < "2026-10-01").toBe(true);
    expect("2026-9-01" < "2026-10-01").toBe(false);
  });

  test("date-only and full-timestamp values still order against each other", () => {
    /*
     * A field switched from Date to DateTime leaves both shapes in the column.
     * The date-only string is a prefix of the timestamp for the same day, and a
     * prefix sorts first, so "2026-08-17" reads as the start of that day —
     * which is the reading the UI already gives it.
     */
    expect("2026-08-17" < "2026-08-17T00:00:00.000Z").toBe(true);
    expect("2026-08-17" < "2026-08-18").toBe(true);
  });
});

describe("buildJSONColumnQuery — other operands to the ordered operators", () => {
  test("a boolean operand compares as text rather than crashing", () => {
    /*
     * Nothing in the product builds "Regulated is greater than true", but the
     * column is untyped and a hand-built query can send anything. compareOrdered
     * must have a defined answer for every scalar, not just the two it was
     * designed for.
     */
    const query: JSONColumnQuery = build({
      Regulated: new GreaterThan(true as unknown as string),
    });

    expect(query.toSql(COLUMN)).toContain("> CAST(:p2 AS TEXT)");
    expect(query.parameters["p2"]).toBe("true");
  });

  test("an ordinary word compares as text", () => {
    const query: JSONColumnQuery = build({
      Severity: new GreaterThanOrEqual("medium"),
    });

    expect(query.toSql(COLUMN)).toContain(">= CAST(:p2 AS TEXT)");
    expect(query.parameters["p2"]).toBe("medium");
  });

  test("an empty operand compares as text and binds the empty string", () => {
    /*
     * Number("") is 0, so an empty operand used to compile to "greater than
     * zero" — a filter the user never asked for. isNumericValue rejects the
     * empty string explicitly to stop that.
     */
    const query: JSONColumnQuery = build({ Renewal: new GreaterThan("") });

    expect(query.toSql(COLUMN)).toContain("> CAST(:p2 AS TEXT)");
    expect(query.parameters["p2"]).toBe("");
  });

  test("a non-finite operand never reaches the numeric cast", () => {
    /*
     * Number.isFinite, not isNaN: Infinity is a number and would bind as one,
     * and `CAST(Infinity AS NUMERIC)` is an error rather than a NULL — an
     * aborted request instead of an empty table.
     */
    expect(sqlOf({ Count: new GreaterThan(Infinity) })).not.toContain(
      "AS NUMERIC",
    );
    expect(sqlOf({ Count: new GreaterThan(NaN) })).not.toContain("AS NUMERIC");
  });

  test("GreaterThanOrNull is still numeric-only", () => {
    /*
     * Deliberately pinned at the edge of the change. The or-null variants were
     * left on compareNumeric, and nothing in the custom field facet vocabulary
     * emits them, so no date reaches them today. If a date-capable "or null"
     * filter is ever added, this test fails first and points at the gap rather
     * than letting the NaN predicate reappear somewhere new.
     */
    expect(sqlOf({ Renewal: new GreaterThanOrNull(ISO_INSTANT) })).toContain(
      "AS NUMERIC",
    );
  });

  test("two date keys AND together and each keeps its own parameters", () => {
    const query: JSONColumnQuery = build({
      Opened: new GreaterThanOrEqual("2026-01-01T00:00:00.000Z"),
      Closed: new LessThan("2026-02-01T00:00:00.000Z"),
    });
    const sql: string = query.toSql(COLUMN);

    expect(sql).toContain(" AND ");
    expect(query.parameters["p1"]).toBe("Opened");
    expect(query.parameters["p2"]).toBe("2026-01-01T00:00:00.000Z");
    expect(query.parameters["p3"]).toBe("Closed");
    expect(query.parameters["p4"]).toBe("2026-02-01T00:00:00.000Z");
  });

  test("a date filter still routes the key through a parameter", () => {
    /*
     * The date branch is new SQL, and new SQL is where an interpolated key
     * creeps back in. The name of a Date custom field is user text like any
     * other.
     */
    const key: string = "Renew' OR 1=1 --";
    const query: JSONColumnQuery = build({
      [key]: new GreaterThan(ISO_INSTANT),
    });
    const sql: string = query.toSql(COLUMN);

    expect(sql).not.toContain("OR 1=1");
    expect(sql).not.toContain(key);
    expect(query.parameters["p1"]).toBe(key);
  });
});
