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
