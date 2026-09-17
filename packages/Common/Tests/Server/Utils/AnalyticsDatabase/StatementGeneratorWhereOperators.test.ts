import { ClickhouseAppInstance } from "../../../../Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "../../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import "../../TestingUtils/Init";
import AnalyticsBaseModel from "../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Route from "../../../../Types/API/Route";
import AnalyticsTableEngine from "../../../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableColumn from "../../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import EqualTo from "../../../../Types/BaseDatabase/EqualTo";
import EqualToOrNull from "../../../../Types/BaseDatabase/EqualToOrNull";
import EndsWith from "../../../../Types/BaseDatabase/EndsWith";
import IncludesAll from "../../../../Types/BaseDatabase/IncludesAll";
import IncludesNone from "../../../../Types/BaseDatabase/IncludesNone";
import IsNull from "../../../../Types/BaseDatabase/IsNull";
import NotContains from "../../../../Types/BaseDatabase/NotContains";
import NotEqual from "../../../../Types/BaseDatabase/NotEqual";
import NotNull from "../../../../Types/BaseDatabase/NotNull";
import Search from "../../../../Types/BaseDatabase/Search";
import StartsWith from "../../../../Types/BaseDatabase/StartsWith";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { describe, expect, test, beforeEach } from "@jest/globals";

/*
 * WHERE-clause coverage for the operator branches added for the Security
 * Events correlation query builder (issue #3395): explicit EqualTo /
 * EqualToOrNull / NotNull, prefix/suffix/negated-substring matching on
 * scalar AND Array(String) columns, substring Search over Array(String)
 * (previously bound a single pattern against an Array(String) parameter —
 * a guaranteed ClickHouse parse error), hasAll conjunction, and the loud
 * failure for operators that have no branch for a column type (previously
 * the operator OBJECT was bound as an equality value — a silent
 * match-nothing filter).
 *
 * The shape of the model mirrors SecurityEvent where it matters: Text
 * scalars like principalHost, an Array(String) observables column, and a
 * Number column to pin non-Text NotNull/EqualToOrNull behavior.
 */

describe("StatementGenerator toWhereStatement operator branches", () => {
  class OperatorModel extends AnalyticsBaseModel {
    public constructor() {
      super({
        tableName: "<operator-table>",
        singularName: "<singular>",
        pluralName: "<plural>",
        tableColumns: [
          new AnalyticsTableColumn({
            key: "_id",
            title: "<title>",
            description: "<description>",
            required: true,
            type: TableColumnType.ObjectID,
          }),
          new AnalyticsTableColumn({
            key: "principalHost",
            title: "<title>",
            description: "<description>",
            required: false,
            type: TableColumnType.Text,
          }),
          new AnalyticsTableColumn({
            key: "targetPort",
            title: "<title>",
            description: "<description>",
            required: false,
            type: TableColumnType.Number,
          }),
          new AnalyticsTableColumn({
            key: "observables",
            title: "<title>",
            description: "<description>",
            required: true,
            defaultValue: [],
            type: TableColumnType.ArrayText,
          }),
          new AnalyticsTableColumn({
            key: "attributes",
            title: "<title>",
            description: "<description>",
            required: true,
            defaultValue: {},
            type: TableColumnType.MapStringString,
          }),
        ],
        crudApiPath: new Route("route"),
        primaryKeys: ["_id"],
        sortKeys: ["_id"],
        partitionKey: "_id",
        tableEngine: AnalyticsTableEngine.MergeTree,
      });
    }
  }

  let generator: StatementGenerator<OperatorModel>;
  beforeEach(() => {
    generator = new StatementGenerator<OperatorModel>({
      modelType: OperatorModel,
      database: ClickhouseAppInstance,
    });
  });

  describe("EqualTo wrapper on scalar columns", () => {
    test("binds the WRAPPED value, exactly like bare equality", () => {
      const statement: Statement = generator.toWhereStatement({
        principalHost: new EqualTo("wb-ubuntu-03"),
      } as any);
      expect(statement.query).toBe("AND {p0:Identifier} = {p1:String}");
      expect(statement.query_params).toStrictEqual({
        p0: "principalHost",
        p1: "wb-ubuntu-03",
      });
    });

    test("matches the SQL produced by a bare value", () => {
      const wrapped: Statement = generator.toWhereStatement({
        principalHost: new EqualTo("wb-ubuntu-03"),
      } as any);
      const bare: Statement = generator.toWhereStatement({
        principalHost: "wb-ubuntu-03",
      } as any);
      expect(wrapped.query).toBe(bare.query);
      expect(wrapped.query_params).toStrictEqual(bare.query_params);
    });

    test("binds a numeric EqualTo against a Number column", () => {
      const statement: Statement = generator.toWhereStatement({
        targetPort: new EqualTo(443),
      } as any);
      expect(statement.query).toBe("AND {p0:Identifier} = {p1:Int32}");
      expect(statement.query_params).toStrictEqual({
        p0: "targetPort",
        p1: 443,
      });
    });
  });

  describe("EqualToOrNull wrapper", () => {
    test("Text column also accepts the empty-string 'not set' default", () => {
      const statement: Statement = generator.toWhereStatement({
        principalHost: new EqualToOrNull("wb-ubuntu-03"),
      } as any);
      expect(statement.query).toBe(
        "AND ({p0:Identifier} = {p1:String} OR {p2:Identifier} IS NULL OR {p3:Identifier} = '')",
      );
      expect(statement.query_params).toStrictEqual({
        p0: "principalHost",
        p1: "wb-ubuntu-03",
        p2: "principalHost",
        p3: "principalHost",
      });
    });

    test("non-Text column only accepts NULL as 'not set'", () => {
      const statement: Statement = generator.toWhereStatement({
        targetPort: new EqualToOrNull(443),
      } as any);
      expect(statement.query).toBe(
        "AND ({p0:Identifier} = {p1:Int32} OR {p2:Identifier} IS NULL)",
      );
      expect(statement.query_params).toStrictEqual({
        p0: "targetPort",
        p1: 443,
        p2: "targetPort",
      });
    });
  });

  describe("NotNull wrapper", () => {
    test("Text column rejects both NULL and the empty-string default (mirror of IsNull)", () => {
      const statement: Statement = generator.toWhereStatement({
        principalHost: new NotNull(),
      } as any);
      expect(statement.query).toBe(
        "AND ({p0:Identifier} IS NOT NULL AND {p1:Identifier} != '')",
      );
      expect(statement.query_params).toStrictEqual({
        p0: "principalHost",
        p1: "principalHost",
      });
    });

    test("non-Text column checks NULL only", () => {
      const statement: Statement = generator.toWhereStatement({
        targetPort: new NotNull(),
      } as any);
      expect(statement.query).toBe("AND {p0:Identifier} IS NOT NULL");
      expect(statement.query_params).toStrictEqual({
        p0: "targetPort",
      });
    });
  });

  describe("StartsWith / EndsWith / NotContains on scalar columns", () => {
    test("StartsWith compiles to ILIKE 'v%'", () => {
      const statement: Statement = generator.toWhereStatement({
        principalHost: new StartsWith("wb-"),
      } as any);
      expect(statement.query).toBe("AND {p0:Identifier} ILIKE {p1:String}");
      expect(statement.query_params).toStrictEqual({
        p0: "principalHost",
        p1: "wb-%",
      });
    });

    test("EndsWith compiles to ILIKE '%v'", () => {
      const statement: Statement = generator.toWhereStatement({
        principalHost: new EndsWith("-03"),
      } as any);
      expect(statement.query).toBe("AND {p0:Identifier} ILIKE {p1:String}");
      expect(statement.query_params).toStrictEqual({
        p0: "principalHost",
        p1: "%-03",
      });
    });

    test("NotContains compiles to NOT ILIKE with a NULL passthrough", () => {
      /*
       * A row with no value at all trivially "does not contain" the
       * needle — without the IS NULL disjunct, `NOT (NULL ILIKE ...)`
       * evaluates to NULL and drops the row.
       */
      const statement: Statement = generator.toWhereStatement({
        principalHost: new NotContains("ubuntu"),
      } as any);
      expect(statement.query).toBe(
        "AND (NOT ({p0:Identifier} ILIKE {p1:String}) OR {p2:Identifier} IS NULL)",
      );
      expect(statement.query_params).toStrictEqual({
        p0: "principalHost",
        p1: "%ubuntu%",
        p2: "principalHost",
      });
    });
  });

  describe("Array(String) columns — per-element matching", () => {
    test("Search compiles to arrayExists ILIKE, binding the pattern as String (not Array(String))", () => {
      /*
       * Before this branch the generic Search path declared the bound
       * parameter with the COLUMN's type — Array(String) — while carrying
       * a single '%v%' pattern string, which ClickHouse rejects at
       * parameter-parse time. This is what makes a plain text filter on
       * `observables` work.
       */
      const statement: Statement = generator.toWhereStatement({
        observables: new Search("ubuntu"),
      } as any);
      expect(statement.query).toBe(
        "AND arrayExists(x -> x ILIKE {p0:String}, {p1:Identifier})",
      );
      expect(statement.query_params).toStrictEqual({
        p0: "%ubuntu%",
        p1: "observables",
      });
    });

    test("StartsWith compiles to arrayExists ILIKE 'v%'", () => {
      const statement: Statement = generator.toWhereStatement({
        observables: new StartsWith("192.168."),
      } as any);
      expect(statement.query).toBe(
        "AND arrayExists(x -> x ILIKE {p0:String}, {p1:Identifier})",
      );
      expect(statement.query_params).toStrictEqual({
        p0: "192.168.%",
        p1: "observables",
      });
    });

    test("EndsWith compiles to arrayExists ILIKE '%v'", () => {
      const statement: Statement = generator.toWhereStatement({
        observables: new EndsWith(".example.com"),
      } as any);
      expect(statement.query).toBe(
        "AND arrayExists(x -> x ILIKE {p0:String}, {p1:Identifier})",
      );
      expect(statement.query_params).toStrictEqual({
        p0: "%.example.com",
        p1: "observables",
      });
    });

    test("NotContains compiles to NOT arrayExists", () => {
      const statement: Statement = generator.toWhereStatement({
        observables: new NotContains("baduser"),
      } as any);
      expect(statement.query).toBe(
        "AND NOT arrayExists(x -> x ILIKE {p0:String}, {p1:Identifier})",
      );
      expect(statement.query_params).toStrictEqual({
        p0: "%baduser%",
        p1: "observables",
      });
    });

    test("IncludesAll compiles to hasAll — the 'mentions X AND Y' conjunction", () => {
      const statement: Statement = generator.toWhereStatement({
        observables: new IncludesAll(["wb-ubuntu-03", "192.168.1.20"]),
      } as any);
      expect(statement.query).toBe(
        "AND hasAll({p0:Identifier}, {p1:Array(String)})",
      );
      expect(statement.query_params).toStrictEqual({
        p0: "observables",
        p1: ["wb-ubuntu-03", "192.168.1.20"],
      });
    });

    test("empty IncludesAll drops the predicate instead of hasAll(col, [])", () => {
      const statement: Statement = generator.toWhereStatement({
        observables: new IncludesAll([]),
      } as any);
      expect(statement.query).toBe("");
      expect(statement.query_params).toStrictEqual({});
    });
  });

  describe("ILIKE metacharacter escaping", () => {
    /*
     * User values must match literally: "svc_" is a service-account prefix,
     * not "svc followed by any character". The relational (Postgres) query
     * path has escaped LIKE metacharacters for a while — these pin the
     * ClickHouse path to the same contract.
     */
    test("StartsWith escapes _ so it cannot act as a single-char wildcard", () => {
      const statement: Statement = generator.toWhereStatement({
        principalHost: new StartsWith("svc_"),
      } as any);
      expect(statement.query_params).toStrictEqual({
        p0: "principalHost",
        p1: "svc\\_%",
      });
    });

    test("EndsWith escapes % so a literal percent stays literal", () => {
      const statement: Statement = generator.toWhereStatement({
        principalHost: new EndsWith("50%"),
      } as any);
      expect(statement.query_params).toStrictEqual({
        p0: "principalHost",
        p1: "%50\\%",
      });
    });

    test("NotContains escapes % — '100%' must not exclude every '100'", () => {
      const statement: Statement = generator.toWhereStatement({
        principalHost: new NotContains("100%"),
      } as any);
      expect(statement.query_params).toStrictEqual({
        p0: "principalHost",
        p1: "%100\\%%",
        p2: "principalHost",
      });
    });

    test("Search escapes % _ and backslash in the bound pattern", () => {
      const statement: Statement = generator.toWhereStatement({
        principalHost: new Search("a_b%"),
      } as any);
      expect(statement.query_params).toStrictEqual({
        p0: "principalHost",
        p1: "%a\\_b\\%%",
      });
    });

    test("Search over Array(String) escapes a Windows-path backslash", () => {
      const statement: Statement = generator.toWhereStatement({
        observables: new Search("C:\\"),
      } as any);
      expect(statement.query_params).toStrictEqual({
        p0: "%C:\\\\%",
        p1: "observables",
      });
    });
  });

  describe("array-aware equality and presence", () => {
    test("EqualTo on an Array(String) column means membership (has)", () => {
      /*
       * This is the events-table Observable filter's 'Equal To' operator —
       * the scalar `col = v` form would bind a single string against an
       * Array(String) parameter and fail at ClickHouse parse time.
       */
      const statement: Statement = generator.toWhereStatement({
        observables: new EqualTo("wb-ubuntu-03"),
      } as any);
      expect(statement.query).toBe("AND has({p0:Identifier}, {p1:String})");
      expect(statement.query_params).toStrictEqual({
        p0: "observables",
        p1: "wb-ubuntu-03",
      });
    });

    test("NotEqual on an Array(String) column means does-not-mention (NOT has)", () => {
      const statement: Statement = generator.toWhereStatement({
        observables: new NotEqual("baduser1"),
      } as any);
      expect(statement.query).toBe("AND NOT has({p0:Identifier}, {p1:String})");
      expect(statement.query_params).toStrictEqual({
        p0: "observables",
        p1: "baduser1",
      });
    });

    test("IsNull on an Array(String) column means the empty array", () => {
      // Arrays are non-Nullable — `IS NULL` would be constant-false.
      const statement: Statement = generator.toWhereStatement({
        observables: new IsNull(),
      } as any);
      expect(statement.query).toBe("AND empty({p0:Identifier})");
      expect(statement.query_params).toStrictEqual({ p0: "observables" });
    });

    test("NotNull on an Array(String) column means at-least-one-element", () => {
      // `IS NOT NULL` would be constant-true — a silent match-everything.
      const statement: Statement = generator.toWhereStatement({
        observables: new NotNull(),
      } as any);
      expect(statement.query).toBe("AND notEmpty({p0:Identifier})");
      expect(statement.query_params).toStrictEqual({ p0: "observables" });
    });

    test("EqualToOrNull on an Array(String) column throws", () => {
      expect(() => {
        return generator.toWhereStatement({
          observables: new EqualToOrNull("x"),
        } as any);
      }).toThrow(
        "Unsupported query operator EqualToOrNull on column: observables",
      );
    });
  });

  describe("map/JSON column guards", () => {
    /*
     * Scalar operators applied to a whole Map column have per-sub-key
     * forms instead; applying them to the column itself must fail with a
     * BadDataException, not a cryptic ClickHouse type error.
     */
    test.each<[string, () => Statement]>([
      [
        "StartsWith",
        (): Statement => {
          return generator.toWhereStatement({
            attributes: new StartsWith("a"),
          } as any);
        },
      ],
      [
        "EqualTo",
        (): Statement => {
          return generator.toWhereStatement({
            attributes: new EqualTo("a"),
          } as any);
        },
      ],
      [
        "NotContains",
        (): Statement => {
          return generator.toWhereStatement({
            attributes: new NotContains("a"),
          } as any);
        },
      ],
    ])(
      "%s on a Map(String,String) column throws BadDataException",
      (operatorName: string, compile: () => Statement) => {
        expect(compile).toThrow(
          `Unsupported query operator ${operatorName} on column: attributes`,
        );
      },
    );
  });

  describe("unsupported operator instances fail loudly", () => {
    test("IncludesAll on a scalar column throws instead of binding the operator object", () => {
      expect(() => {
        return generator.toWhereStatement({
          principalHost: new IncludesAll(["a", "b"]),
        } as any);
      }).toThrow(BadDataException);
      expect(() => {
        return generator.toWhereStatement({
          principalHost: new IncludesAll(["a", "b"]),
        } as any);
      }).toThrow(
        "Unsupported query operator IncludesAll on column: principalHost",
      );
    });

    test("bare values still compile to equality through the fallback", () => {
      const statement: Statement = generator.toWhereStatement({
        principalHost: "wb-ubuntu-03",
      } as any);
      expect(statement.query).toBe("AND {p0:Identifier} = {p1:String}");
      expect(statement.query_params).toStrictEqual({
        p0: "principalHost",
        p1: "wb-ubuntu-03",
      });
    });
  });

  describe("operator arrays — several predicates AND-ed on ONE column", () => {
    test("Includes + IncludesNone on an Array(String) column → hasAll-style conjunction", () => {
      /*
       * "mentions wb-ubuntu-03 AND does not mention baduser1" — the
       * correlate builder's Exclude pivot. One column, two predicates,
       * expressed as an array of operators under the key.
       */
      const statement: Statement = generator.toWhereStatement({
        observables: [
          new IncludesAll(["wb-ubuntu-03", "192.168.1.20"]),
          new IncludesNone(["baduser1"]),
        ],
      } as any);
      expect(statement.query).toBe(
        "AND hasAll({p0:Identifier}, {p1:Array(String)}) " +
          "AND NOT hasAny({p2:Identifier}, {p3:Array(String)})",
      );
      expect(statement.query_params).toStrictEqual({
        p0: "observables",
        p1: ["wb-ubuntu-03", "192.168.1.20"],
        p2: "observables",
        p3: ["baduser1"],
      });
    });

    test("EqualTo + NotEqual on a scalar column", () => {
      const statement: Statement = generator.toWhereStatement({
        principalHost: [new EqualTo("wb-ubuntu-03"), new NotEqual("db-01")],
      } as any);
      expect(statement.query).toBe(
        "AND {p0:Identifier} = {p1:String} AND {p2:Identifier} != {p3:String}",
      );
      expect(statement.query_params).toStrictEqual({
        p0: "principalHost",
        p1: "wb-ubuntu-03",
        p2: "principalHost",
        p3: "db-01",
      });
    });

    test("two Search operators AND two ILIKEs", () => {
      const statement: Statement = generator.toWhereStatement({
        principalHost: [new Search("wb"), new Search("ubuntu")],
      } as any);
      expect(statement.query).toBe(
        "AND {p0:Identifier} ILIKE {p1:String} AND {p2:Identifier} ILIKE {p3:String}",
      );
      expect(statement.query_params).toStrictEqual({
        p0: "principalHost",
        p1: "%wb%",
        p2: "principalHost",
        p3: "%ubuntu%",
      });
    });

    test("elements whose predicate drops (empty Includes) contribute nothing", () => {
      const statement: Statement = generator.toWhereStatement({
        observables: [new IncludesAll([]), new IncludesNone(["baduser1"])],
      } as any);
      expect(statement.query).toBe(
        "AND NOT hasAny({p0:Identifier}, {p1:Array(String)})",
      );
      expect(statement.query_params).toStrictEqual({
        p0: "observables",
        p1: ["baduser1"],
      });
    });

    test("operator array composes with other columns", () => {
      const statement: Statement = generator.toWhereStatement({
        observables: [new IncludesAll(["a", "b"]), new IncludesNone(["c"])],
        principalHost: "wb-ubuntu-03",
      } as any);
      expect(statement.query).toBe(
        "AND hasAll({p0:Identifier}, {p1:Array(String)}) " +
          "AND NOT hasAny({p2:Identifier}, {p3:Array(String)}) " +
          "AND {p4:Identifier} = {p5:String}",
      );
    });

    test("a bare string array still means exact-array equality (not operator dispatch)", () => {
      const statement: Statement = generator.toWhereStatement({
        observables: ["a", "b"],
      } as any);
      expect(statement.query).toBe("AND {p0:Identifier} = {p1:Array(String)}");
      expect(statement.query_params).toStrictEqual({
        p0: "observables",
        p1: ["a", "b"],
      });
    });

    test("operator arrays qualify every column reference under a table alias", () => {
      /*
       * The recursion forwards options, so an Exclude-pivot query embedded
       * in an aggregate statement (which aliases the table) must qualify
       * every fragment's column refs — no bare {pN:Identifier} columns.
       */
      const statement: Statement = generator.toWhereStatement(
        {
          observables: [new IncludesAll(["a"]), new IncludesNone(["b"])],
        } as any,
        { tableAlias: "<operator-table>" },
      );
      expect(statement.query).toBe(
        "AND hasAll({p0_t:Identifier}.{p0_c:Identifier}, {p1:Array(String)}) " +
          "AND NOT hasAny({p2_t:Identifier}.{p2_c:Identifier}, {p3:Array(String)})",
      );
      expect(statement.query_params).toStrictEqual({
        p0_t: "<operator-table>",
        p0_c: "observables",
        p1: ["a"],
        p2_t: "<operator-table>",
        p2_c: "observables",
        p3: ["b"],
      });
    });

    test("an unsupported operator inside the array still throws", () => {
      expect(() => {
        return generator.toWhereStatement({
          principalHost: [new EqualTo("x"), new IncludesAll(["a"])],
        } as any);
      }).toThrow(
        "Unsupported query operator IncludesAll on column: principalHost",
      );
    });
  });

  describe("composition — the shapes the correlation builder emits", () => {
    test("AND across different columns, mixing new and old branches", () => {
      const statement: Statement = generator.toWhereStatement({
        observables: new IncludesAll(["wb-ubuntu-03", "192.168.1.20"]),
        principalHost: new StartsWith("wb-"),
        targetPort: new NotEqual(22),
      } as any);
      expect(statement.query).toBe(
        "AND hasAll({p0:Identifier}, {p1:Array(String)}) " +
          "AND {p2:Identifier} ILIKE {p3:String} " +
          "AND {p4:Identifier} != {p5:Int32}",
      );
      expect(statement.query_params).toStrictEqual({
        p0: "observables",
        p1: ["wb-ubuntu-03", "192.168.1.20"],
        p2: "principalHost",
        p3: "wb-%",
        p4: "targetPort",
        p5: 22,
      });
    });

    test("table alias qualifies the new branches too", () => {
      const statement: Statement = generator.toWhereStatement(
        {
          observables: new Search("ubuntu"),
          principalHost: new NotNull(),
        } as any,
        { tableAlias: "<operator-table>" },
      );
      expect(statement.query).toBe(
        "AND arrayExists(x -> x ILIKE {p0:String}, {p1_t:Identifier}.{p1_c:Identifier}) " +
          "AND ({p2_t:Identifier}.{p2_c:Identifier} IS NOT NULL AND {p3_t:Identifier}.{p3_c:Identifier} != '')",
      );
      expect(statement.query_params).toStrictEqual({
        p0: "%ubuntu%",
        p1_t: "<operator-table>",
        p1_c: "observables",
        p2_t: "<operator-table>",
        p2_c: "principalHost",
        p3_t: "<operator-table>",
        p3_c: "principalHost",
      });
    });
  });
});
