import { describe, expect, test } from "@jest/globals";
import EqualTo from "../../../Types/BaseDatabase/EqualTo";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesAll from "../../../Types/BaseDatabase/IncludesAll";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import NotContains from "../../../Types/BaseDatabase/NotContains";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import Search from "../../../Types/BaseDatabase/Search";
import StartsWith from "../../../Types/BaseDatabase/StartsWith";
import EndsWith from "../../../Types/BaseDatabase/EndsWith";
import ObjectID from "../../../Types/ObjectID";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import {
  CompiledCorrelationQueries,
  CorrelationCondition,
  CorrelationFieldDefinition,
  CorrelationFieldDefinitions,
  CorrelationFieldKey,
  CorrelationFilter,
  CorrelationOperator,
  CorrelationOperatorLabels,
  CorrelationQueryOptions,
  compileCorrelationFilter,
  describeCorrelationCondition,
  describeCorrelationFilter,
  getCorrelationFieldDefinition,
  getEqualityObservables,
  parseCorrelationFilter,
  serializeCorrelationFilter,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/SecurityEventCorrelation";

/*
 * The correlation filter compiler is the contract between the Correlate
 * query-builder UI (issue #3395) and the flat analytics query API: AND
 * chains must land in ONE query (with same-column conditions merged into an
 * equivalent single operator or rejected with a friendly error — never
 * silently wrong), OR chains must fan out into one query per condition with
 * same-field equalities collapsed into a single Includes. These tests pin
 * every compilation rule, the URL round-trip, and the tolerance of the
 * parser against malformed input.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const START_DATE: Date = new Date("2026-08-24T00:00:00.000Z");
const END_DATE: Date = new Date("2026-08-25T00:00:00.000Z");

const options: CorrelationQueryOptions = {
  projectId: PROJECT_ID,
  startDate: START_DATE,
  endDate: END_DATE,
};

function condition(
  field: CorrelationFieldKey,
  operator: CorrelationOperator,
  value: string,
): CorrelationCondition {
  return { field, operator, value };
}

function compile(
  conditions: Array<CorrelationCondition>,
  connector: "and" | "or",
): CompiledCorrelationQueries {
  return compileCorrelationFilter({ conditions, connector }, options);
}

type QueryRecord = Record<string, unknown>;

function expectBaseQuery(query: QueryRecord): void {
  expect(query["projectId"]).toBe(PROJECT_ID);
  expect(query["time"]).toBeInstanceOf(InBetween);
  expect((query["time"] as InBetween<Date>).startValue).toBe(START_DATE);
  expect((query["time"] as InBetween<Date>).endValue).toBe(END_DATE);
}

describe("field catalog", () => {
  test("every field offers at least one operator, and only labeled operators", () => {
    for (const definition of CorrelationFieldDefinitions) {
      expect(definition.operators.length).toBeGreaterThan(0);
      for (const operator of definition.operators) {
        expect(CorrelationOperatorLabels[operator]).toBeTruthy();
      }
    }
  });

  test("the observable field targets the observables array column", () => {
    const definition: CorrelationFieldDefinition =
      getCorrelationFieldDefinition(CorrelationFieldKey.Observable);
    expect(definition.columnKey).toBe("observables");
    expect(definition.isArrayColumn).toBe(true);
  });

  test("severity offers a fixed value vocabulary", () => {
    const definition: CorrelationFieldDefinition =
      getCorrelationFieldDefinition(CorrelationFieldKey.Severity);
    expect(definition.valueOptions).toEqual(Object.values(OcsfSeverity));
    expect(definition.operators).toEqual([
      CorrelationOperator.Equals,
      CorrelationOperator.NotEquals,
    ]);
  });

  test("event class suggests the curated OCSF names but stays free-text", () => {
    const definition: CorrelationFieldDefinition =
      getCorrelationFieldDefinition(CorrelationFieldKey.EventClass);
    expect(definition.valueOptions).toBeUndefined();
    expect(definition.valueSuggestions).toContain("Authentication");
    expect(definition.valueSuggestions).toContain("Detection Finding");
  });

  test("getCorrelationFieldDefinition throws for an unknown field", () => {
    expect(() => {
      return getCorrelationFieldDefinition("nope" as CorrelationFieldKey);
    }).toThrow("Unknown correlation field: nope");
  });
});

describe("AND compilation — single conditions", () => {
  test.each<[CorrelationOperator, (value: unknown) => void]>([
    [
      CorrelationOperator.Equals,
      (value: unknown): void => {
        expect(value).toBeInstanceOf(Includes);
        expect((value as Includes).values).toEqual(["wb-ubuntu-03"]);
      },
    ],
    [
      CorrelationOperator.NotEquals,
      (value: unknown): void => {
        expect(value).toBeInstanceOf(IncludesNone);
        expect((value as IncludesNone).values).toEqual(["wb-ubuntu-03"]);
      },
    ],
    [
      CorrelationOperator.Contains,
      (value: unknown): void => {
        expect(value).toBeInstanceOf(Search);
        expect((value as Search<string>).toString()).toBe("wb-ubuntu-03");
      },
    ],
    [
      CorrelationOperator.NotContains,
      (value: unknown): void => {
        expect(value).toBeInstanceOf(NotContains);
      },
    ],
    [
      CorrelationOperator.StartsWith,
      (value: unknown): void => {
        expect(value).toBeInstanceOf(StartsWith);
      },
    ],
    [
      CorrelationOperator.EndsWith,
      (value: unknown): void => {
        expect(value).toBeInstanceOf(EndsWith);
      },
    ],
  ])(
    "observable %s compiles onto the observables column",
    (operator: CorrelationOperator, assertValue: (value: unknown) => void) => {
      const compiled: CompiledCorrelationQueries = compile(
        [condition(CorrelationFieldKey.Observable, operator, "wb-ubuntu-03")],
        "and",
      );
      expect(compiled.error).toBeNull();
      expect(compiled.queries).toHaveLength(1);
      const query: QueryRecord = compiled.queries[0] as QueryRecord;
      expectBaseQuery(query);
      assertValue(query["observables"]);
    },
  );

  test("scalar equals compiles to a bare value (the fast equality path)", () => {
    const compiled: CompiledCorrelationQueries = compile(
      [
        condition(
          CorrelationFieldKey.PrincipalHost,
          CorrelationOperator.Equals,
          "wb-ubuntu-03",
        ),
      ],
      "and",
    );
    expect(compiled.error).toBeNull();
    const query: QueryRecord = compiled.queries[0] as QueryRecord;
    expect(query["principalHost"]).toBe("wb-ubuntu-03");
  });

  test("scalar not-equals compiles to NotEqual", () => {
    const compiled: CompiledCorrelationQueries = compile(
      [
        condition(
          CorrelationFieldKey.PrincipalUser,
          CorrelationOperator.NotEquals,
          "baduser1",
        ),
      ],
      "and",
    );
    const query: QueryRecord = compiled.queries[0] as QueryRecord;
    expect(query["principalUser"]).toBeInstanceOf(NotEqual);
    expect((query["principalUser"] as NotEqual<string>).value).toBe("baduser1");
  });

  test("scalar contains compiles to Search", () => {
    const compiled: CompiledCorrelationQueries = compile(
      [
        condition(
          CorrelationFieldKey.Message,
          CorrelationOperator.Contains,
          "failed password",
        ),
      ],
      "and",
    );
    const query: QueryRecord = compiled.queries[0] as QueryRecord;
    expect(query["message"]).toBeInstanceOf(Search);
  });
});

describe("AND compilation — the issue #3395 shapes", () => {
  test("IP = X AND Hostname = Y (different fields) lands in one query", () => {
    const compiled: CompiledCorrelationQueries = compile(
      [
        condition(
          CorrelationFieldKey.PrincipalIp,
          CorrelationOperator.Equals,
          "192.168.1.20",
        ),
        condition(
          CorrelationFieldKey.PrincipalHost,
          CorrelationOperator.Equals,
          "wb-ubuntu-03",
        ),
      ],
      "and",
    );
    expect(compiled.error).toBeNull();
    expect(compiled.queries).toHaveLength(1);
    const query: QueryRecord = compiled.queries[0] as QueryRecord;
    expectBaseQuery(query);
    expect(query["principalIp"]).toBe("192.168.1.20");
    expect(query["principalHost"]).toBe("wb-ubuntu-03");
  });

  test("Hostname = X AND User != Y mixes equality and exclusion across fields", () => {
    const compiled: CompiledCorrelationQueries = compile(
      [
        condition(
          CorrelationFieldKey.PrincipalHost,
          CorrelationOperator.Equals,
          "wb-ubuntu-03",
        ),
        condition(
          CorrelationFieldKey.PrincipalUser,
          CorrelationOperator.NotEquals,
          "baduser1",
        ),
      ],
      "and",
    );
    expect(compiled.error).toBeNull();
    expect(compiled.queries).toHaveLength(1);
    const query: QueryRecord = compiled.queries[0] as QueryRecord;
    expect(query["principalHost"]).toBe("wb-ubuntu-03");
    expect(query["principalUser"]).toBeInstanceOf(NotEqual);
  });

  test("Observable = X AND Observable = Y merges into IncludesAll (hasAll)", () => {
    const compiled: CompiledCorrelationQueries = compile(
      [
        condition(
          CorrelationFieldKey.Observable,
          CorrelationOperator.Equals,
          "wb-ubuntu-03",
        ),
        condition(
          CorrelationFieldKey.Observable,
          CorrelationOperator.Equals,
          "192.168.1.20",
        ),
      ],
      "and",
    );
    expect(compiled.error).toBeNull();
    expect(compiled.queries).toHaveLength(1);
    const query: QueryRecord = compiled.queries[0] as QueryRecord;
    expect(query["observables"]).toBeInstanceOf(IncludesAll);
    expect((query["observables"] as IncludesAll).values).toEqual([
      "wb-ubuntu-03",
      "192.168.1.20",
    ]);
  });

  test("Observable != X AND Observable != Y merges into IncludesNone", () => {
    const compiled: CompiledCorrelationQueries = compile(
      [
        condition(
          CorrelationFieldKey.Observable,
          CorrelationOperator.NotEquals,
          "known-scanner",
        ),
        condition(
          CorrelationFieldKey.Observable,
          CorrelationOperator.NotEquals,
          "10.0.0.99",
        ),
      ],
      "and",
    );
    expect(compiled.error).toBeNull();
    const query: QueryRecord = compiled.queries[0] as QueryRecord;
    expect(query["observables"]).toBeInstanceOf(IncludesNone);
    expect((query["observables"] as IncludesNone).values).toEqual([
      "known-scanner",
      "10.0.0.99",
    ]);
  });

  test("scalar != X AND != Y merges into IncludesNone (NOT IN)", () => {
    const compiled: CompiledCorrelationQueries = compile(
      [
        condition(
          CorrelationFieldKey.PrincipalUser,
          CorrelationOperator.NotEquals,
          "baduser1",
        ),
        condition(
          CorrelationFieldKey.PrincipalUser,
          CorrelationOperator.NotEquals,
          "baduser2",
        ),
      ],
      "and",
    );
    expect(compiled.error).toBeNull();
    const query: QueryRecord = compiled.queries[0] as QueryRecord;
    expect(query["principalUser"]).toBeInstanceOf(IncludesNone);
    expect((query["principalUser"] as IncludesNone).values).toEqual([
      "baduser1",
      "baduser2",
    ]);
  });
});

describe("AND compilation — impossible or inexpressible chains fail with a friendly error", () => {
  test("two different equalities on a scalar can never match", () => {
    const compiled: CompiledCorrelationQueries = compile(
      [
        condition(
          CorrelationFieldKey.PrincipalHost,
          CorrelationOperator.Equals,
          "host-a",
        ),
        condition(
          CorrelationFieldKey.PrincipalHost,
          CorrelationOperator.Equals,
          "host-b",
        ),
      ],
      "and",
    );
    expect(compiled.queries).toHaveLength(0);
    expect(compiled.error).toContain("can never match");
    expect(compiled.error).toContain("Principal Host");
  });

  test("Observable = X AND Observable != Y compiles to an operator ARRAY (hasAll + NOT hasAny)", () => {
    /*
     * Two predicates on one column don't fit the flat query map's single
     * slot — the compiler emits an array of operators under the key, which
     * the statement generator ANDs. This is the graph's "Exclude" pivot.
     */
    const compiled: CompiledCorrelationQueries = compile(
      [
        condition(
          CorrelationFieldKey.Observable,
          CorrelationOperator.Equals,
          "wb-ubuntu-03",
        ),
        condition(
          CorrelationFieldKey.Observable,
          CorrelationOperator.NotEquals,
          "baduser1",
        ),
      ],
      "and",
    );
    expect(compiled.error).toBeNull();
    expect(compiled.queries).toHaveLength(1);
    const query: QueryRecord = compiled.queries[0] as QueryRecord;
    const operators: Array<unknown> = query["observables"] as Array<unknown>;
    expect(Array.isArray(operators)).toBe(true);
    expect(operators).toHaveLength(2);
    expect(operators[0]).toBeInstanceOf(Includes);
    expect((operators[0] as Includes).values).toEqual(["wb-ubuntu-03"]);
    expect(operators[1]).toBeInstanceOf(IncludesNone);
    expect((operators[1] as IncludesNone).values).toEqual(["baduser1"]);
  });

  test("two equals AND one not-equals on observables → [IncludesAll, IncludesNone]", () => {
    const compiled: CompiledCorrelationQueries = compile(
      [
        condition(
          CorrelationFieldKey.Observable,
          CorrelationOperator.Equals,
          "wb-ubuntu-03",
        ),
        condition(
          CorrelationFieldKey.Observable,
          CorrelationOperator.Equals,
          "192.168.1.20",
        ),
        condition(
          CorrelationFieldKey.Observable,
          CorrelationOperator.NotEquals,
          "baduser1",
        ),
      ],
      "and",
    );
    expect(compiled.error).toBeNull();
    const query: QueryRecord = compiled.queries[0] as QueryRecord;
    const operators: Array<unknown> = query["observables"] as Array<unknown>;
    expect(operators).toHaveLength(2);
    expect(operators[0]).toBeInstanceOf(IncludesAll);
    expect((operators[0] as IncludesAll).values).toEqual([
      "wb-ubuntu-03",
      "192.168.1.20",
    ]);
    expect(operators[1]).toBeInstanceOf(IncludesNone);
  });

  test("two contains conditions on the same field compile to two Search operators ANDed", () => {
    const compiled: CompiledCorrelationQueries = compile(
      [
        condition(
          CorrelationFieldKey.Message,
          CorrelationOperator.Contains,
          "failed",
        ),
        condition(
          CorrelationFieldKey.Message,
          CorrelationOperator.Contains,
          "password",
        ),
      ],
      "and",
    );
    expect(compiled.error).toBeNull();
    const query: QueryRecord = compiled.queries[0] as QueryRecord;
    const operators: Array<unknown> = query["message"] as Array<unknown>;
    expect(operators).toHaveLength(2);
    expect(operators[0]).toBeInstanceOf(Search);
    expect(operators[1]).toBeInstanceOf(Search);
  });

  test("scalar equals AND not-equals on the same field → [EqualTo, NotEqual] array", () => {
    const compiled: CompiledCorrelationQueries = compile(
      [
        condition(
          CorrelationFieldKey.PrincipalUser,
          CorrelationOperator.Equals,
          "alice",
        ),
        condition(
          CorrelationFieldKey.PrincipalUser,
          CorrelationOperator.NotEquals,
          "bob",
        ),
      ],
      "and",
    );
    expect(compiled.error).toBeNull();
    const query: QueryRecord = compiled.queries[0] as QueryRecord;
    const operators: Array<unknown> = query["principalUser"] as Array<unknown>;
    expect(operators).toHaveLength(2);
    expect(operators[0]).toBeInstanceOf(EqualTo);
    expect((operators[0] as EqualTo<string>).value).toBe("alice");
    expect(operators[1]).toBeInstanceOf(NotEqual);
    expect((operators[1] as NotEqual<string>).value).toBe("bob");
  });

  test("an empty condition value is rejected with the field named", () => {
    const compiled: CompiledCorrelationQueries = compile(
      [
        condition(
          CorrelationFieldKey.Observable,
          CorrelationOperator.Equals,
          "   ",
        ),
      ],
      "and",
    );
    expect(compiled.queries).toHaveLength(0);
    expect(compiled.error).toContain("Observable");
    expect(compiled.error).toContain("needs a value");
  });
});

describe("AND compilation — normalization", () => {
  test("values are trimmed", () => {
    const compiled: CompiledCorrelationQueries = compile(
      [
        condition(
          CorrelationFieldKey.PrincipalHost,
          CorrelationOperator.Equals,
          "  wb-ubuntu-03  ",
        ),
      ],
      "and",
    );
    const query: QueryRecord = compiled.queries[0] as QueryRecord;
    expect(query["principalHost"]).toBe("wb-ubuntu-03");
  });

  test("identical duplicate rows collapse instead of erroring", () => {
    const compiled: CompiledCorrelationQueries = compile(
      [
        condition(
          CorrelationFieldKey.PrincipalHost,
          CorrelationOperator.Equals,
          "wb-ubuntu-03",
        ),
        condition(
          CorrelationFieldKey.PrincipalHost,
          CorrelationOperator.Equals,
          "wb-ubuntu-03",
        ),
      ],
      "and",
    );
    expect(compiled.error).toBeNull();
    expect(compiled.queries).toHaveLength(1);
    const query: QueryRecord = compiled.queries[0] as QueryRecord;
    expect(query["principalHost"]).toBe("wb-ubuntu-03");
  });

  test("no conditions compile to no queries and no error", () => {
    const compiled: CompiledCorrelationQueries = compile([], "and");
    expect(compiled.queries).toHaveLength(0);
    expect(compiled.error).toBeNull();
  });
});

describe("OR compilation", () => {
  test("IP = X OR IP = Y collapses into ONE Includes query (hasAny already is an OR)", () => {
    const compiled: CompiledCorrelationQueries = compile(
      [
        condition(
          CorrelationFieldKey.Observable,
          CorrelationOperator.Equals,
          "192.168.1.20",
        ),
        condition(
          CorrelationFieldKey.Observable,
          CorrelationOperator.Equals,
          "192.168.1.21",
        ),
      ],
      "or",
    );
    expect(compiled.error).toBeNull();
    expect(compiled.queries).toHaveLength(1);
    const query: QueryRecord = compiled.queries[0] as QueryRecord;
    expectBaseQuery(query);
    expect(query["observables"]).toBeInstanceOf(Includes);
    expect((query["observables"] as Includes).values).toEqual([
      "192.168.1.20",
      "192.168.1.21",
    ]);
  });

  test("scalar equalities on the same field collapse into one IN query", () => {
    const compiled: CompiledCorrelationQueries = compile(
      [
        condition(
          CorrelationFieldKey.PrincipalUser,
          CorrelationOperator.Equals,
          "alice",
        ),
        condition(
          CorrelationFieldKey.PrincipalUser,
          CorrelationOperator.Equals,
          "bob",
        ),
      ],
      "or",
    );
    expect(compiled.queries).toHaveLength(1);
    const query: QueryRecord = compiled.queries[0] as QueryRecord;
    expect(query["principalUser"]).toBeInstanceOf(Includes);
    expect((query["principalUser"] as Includes).values).toEqual([
      "alice",
      "bob",
    ]);
  });

  test("equalities on DIFFERENT fields fan out into one query each", () => {
    const compiled: CompiledCorrelationQueries = compile(
      [
        condition(
          CorrelationFieldKey.PrincipalHost,
          CorrelationOperator.Equals,
          "wb-ubuntu-03",
        ),
        condition(
          CorrelationFieldKey.TargetHost,
          CorrelationOperator.Equals,
          "db-primary",
        ),
      ],
      "or",
    );
    expect(compiled.error).toBeNull();
    expect(compiled.queries).toHaveLength(2);
    for (const query of compiled.queries as Array<QueryRecord>) {
      expectBaseQuery(query);
    }
    const keys: Array<string> = (compiled.queries as Array<QueryRecord>).map(
      (query: QueryRecord) => {
        return Object.keys(query)
          .filter((key: string) => {
            return key !== "projectId" && key !== "time";
          })
          .join(",");
      },
    );
    expect(keys.sort()).toEqual(["principalHost", "targetHost"]);
  });

  test("non-equality conditions always get their own query", () => {
    const compiled: CompiledCorrelationQueries = compile(
      [
        condition(
          CorrelationFieldKey.Observable,
          CorrelationOperator.Equals,
          "wb-ubuntu-03",
        ),
        condition(
          CorrelationFieldKey.Message,
          CorrelationOperator.Contains,
          "failed password",
        ),
        condition(
          CorrelationFieldKey.Severity,
          CorrelationOperator.Equals,
          "Critical",
        ),
      ],
      "or",
    );
    expect(compiled.error).toBeNull();
    // observable= and severity= are equality groups; contains stands alone.
    expect(compiled.queries).toHaveLength(3);
  });

  test("same-field same-value duplicates collapse before fan-out", () => {
    const compiled: CompiledCorrelationQueries = compile(
      [
        condition(
          CorrelationFieldKey.Observable,
          CorrelationOperator.Equals,
          "wb-ubuntu-03",
        ),
        condition(
          CorrelationFieldKey.Observable,
          CorrelationOperator.Equals,
          "wb-ubuntu-03",
        ),
      ],
      "or",
    );
    expect(compiled.queries).toHaveLength(1);
    const query: QueryRecord = compiled.queries[0] as QueryRecord;
    expect((query["observables"] as Includes).values).toEqual(["wb-ubuntu-03"]);
  });

  test("empty value fails in OR mode too", () => {
    const compiled: CompiledCorrelationQueries = compile(
      [
        condition(
          CorrelationFieldKey.Observable,
          CorrelationOperator.Equals,
          "",
        ),
      ],
      "or",
    );
    expect(compiled.queries).toHaveLength(0);
    expect(compiled.error).toContain("needs a value");
  });
});

describe("descriptions", () => {
  test("describeCorrelationCondition spells out field, operator, and value", () => {
    expect(
      describeCorrelationCondition(
        condition(
          CorrelationFieldKey.Observable,
          CorrelationOperator.Equals,
          "wb-ubuntu-03",
        ),
      ),
    ).toBe('Observable is "wb-ubuntu-03"');
  });

  test("describeCorrelationFilter joins with the connector", () => {
    const filter: CorrelationFilter = {
      conditions: [
        condition(
          CorrelationFieldKey.PrincipalIp,
          CorrelationOperator.Equals,
          "192.168.1.20",
        ),
        condition(
          CorrelationFieldKey.PrincipalUser,
          CorrelationOperator.NotEquals,
          "baduser1",
        ),
      ],
      connector: "and",
    };
    expect(describeCorrelationFilter(filter)).toBe(
      'Principal IP is "192.168.1.20" AND Principal User is not "baduser1"',
    );
  });
});

describe("getEqualityObservables", () => {
  test("returns only observable equality values", () => {
    const filter: CorrelationFilter = {
      conditions: [
        condition(
          CorrelationFieldKey.Observable,
          CorrelationOperator.Equals,
          "wb-ubuntu-03",
        ),
        condition(
          CorrelationFieldKey.Observable,
          CorrelationOperator.NotEquals,
          "excluded",
        ),
        condition(
          CorrelationFieldKey.PrincipalHost,
          CorrelationOperator.Equals,
          "not-an-observable-condition",
        ),
        condition(
          CorrelationFieldKey.Observable,
          CorrelationOperator.Equals,
          " 192.168.1.20 ",
        ),
      ],
      connector: "or",
    };
    expect(getEqualityObservables(filter)).toEqual([
      "wb-ubuntu-03",
      "192.168.1.20",
    ]);
  });
});

describe("URL round-trip", () => {
  test("serialize → parse preserves conditions and connector", () => {
    const filter: CorrelationFilter = {
      conditions: [
        condition(
          CorrelationFieldKey.Observable,
          CorrelationOperator.Equals,
          "wb-ubuntu-03",
        ),
        condition(
          CorrelationFieldKey.PrincipalUser,
          CorrelationOperator.NotEquals,
          "baduser1",
        ),
        condition(
          CorrelationFieldKey.Message,
          CorrelationOperator.Contains,
          "failed password",
        ),
      ],
      connector: "or",
    };
    const parsed: CorrelationFilter | null = parseCorrelationFilter(
      serializeCorrelationFilter(filter),
    );
    expect(parsed).toEqual(filter);
  });

  test.each<[string, string | null]>([
    ["null input", null],
    ["empty string", ""],
    ["not JSON", "{{{{"],
    ["JSON scalar", "42"],
    ["JSON null", "null"],
    ["no conditions", JSON.stringify({ v: 1, j: "and", c: [] })],
    [
      "conditions is not an array",
      JSON.stringify({ v: 1, j: "and", c: "nope" }),
    ],
  ])("tolerates %s by returning null", (_label: string, raw: string | null) => {
    expect(parseCorrelationFilter(raw)).toBeNull();
  });

  test("drops malformed rows but keeps valid ones", () => {
    const raw: string = JSON.stringify({
      v: 1,
      j: "or",
      c: [
        ["observable", "equals", "wb-ubuntu-03"],
        ["unknownField", "equals", "x"],
        ["observable", "unknown-operator", "x"],
        ["observable", "equals", "   "],
        ["observable", "equals"],
        "not-an-array",
        [42, "equals", "x"],
      ],
    });
    const parsed: CorrelationFilter | null = parseCorrelationFilter(raw);
    expect(parsed).toEqual({
      conditions: [
        condition(
          CorrelationFieldKey.Observable,
          CorrelationOperator.Equals,
          "wb-ubuntu-03",
        ),
      ],
      connector: "or",
    });
  });

  test("drops rows whose operator exists but is not offered for that field", () => {
    // Severity only offers equals / not-equals.
    const raw: string = JSON.stringify({
      v: 1,
      j: "and",
      c: [["severityName", "contains", "Crit"]],
    });
    expect(parseCorrelationFilter(raw)).toBeNull();
  });

  test("any connector other than 'or' becomes 'and'", () => {
    const raw: string = JSON.stringify({
      v: 1,
      j: "garbage",
      c: [["observable", "equals", "x"]],
    });
    expect(parseCorrelationFilter(raw)?.connector).toBe("and");
  });
});
