import { ClickhouseAppInstance } from "../../../../Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "../../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import "../../TestingUtils/Init";
import AnalyticsBaseModel from "../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Route from "../../../../Types/API/Route";
import AnalyticsTableEngine from "../../../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableColumn from "../../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import NotWildcard from "../../../../Types/BaseDatabase/NotWildcard";
import Search from "../../../../Types/BaseDatabase/Search";
import Wildcard from "../../../../Types/BaseDatabase/Wildcard";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { describe, expect, test, beforeEach } from "@jest/globals";

/*
 * The SQL a wildcard filter compiles to. This is the layer the customer bug
 * ended at: `@platform.team:a*` against a stored `platform.team = abc`
 * returned nothing because the map branch had no glob operator and the value
 * fell through to `attributes['platform.team'] = 'a*'`.
 *
 * Three column shapes have to be covered because they need genuinely
 * different SQL, and getting one wrong fails at the database rather than in
 * review: a scalar takes a plain ILIKE, an Array(String) needs arrayExists
 * (a scalar form there binds one pattern against an Array(String) parameter,
 * which ClickHouse rejects at parameter-parse time), and a Map sub-key needs
 * the case-insensitive arrayExists over mapKeys/mapValues.
 *
 * The negated forms are asserted separately because they are NOT simply the
 * positive form under a NOT: a NULL scalar and a row missing the map key both
 * have to PASS a "does not match" filter.
 */

describe("StatementGenerator - Wildcard / NotWildcard", () => {
  class WildcardModel extends AnalyticsBaseModel {
    public constructor() {
      super({
        tableName: "<wildcard-table>",
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
            key: "serviceName",
            title: "<title>",
            description: "<description>",
            required: false,
            type: TableColumnType.Text,
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

  let generator: StatementGenerator<WildcardModel>;

  beforeEach(() => {
    generator = new StatementGenerator<WildcardModel>({
      modelType: WildcardModel,
      database: ClickhouseAppInstance,
    });
  });

  describe("Map(String,String) sub-key — the customer's case", () => {
    test("a prefix glob matches a value that only STARTS with the text", () => {
      const statement: Statement = generator.toWhereStatement({
        attributes: { "platform.team": new Wildcard("a*") },
      } as any);

      expect(statement.query).toBe(
        "AND arrayExists((k, v) -> lowerUTF8(k) = lowerUTF8({p0:String}) AND (v ILIKE {p1:String}), mapKeys({p2:Identifier}), mapValues({p3:Identifier}))",
      );
      expect(statement.query_params).toStrictEqual({
        p0: "platform.team",
        p1: "a%",
        p2: "attributes",
        p3: "attributes",
      });
    });

    test.each([
      ["a*", "a%"],
      ["*a", "%a"],
      ["a*b", "a%b"],
      ["a?c", "a_c"],
      ["*", "%"],
    ])("the glob %p binds the pattern %p", (glob: string, pattern: string) => {
      const statement: Statement = generator.toWhereStatement({
        attributes: { k: new Wildcard(glob) },
      } as any);

      expect(Object.values(statement.query_params)).toContain(pattern);
    });

    test("the key is matched case-insensitively, because a person typed it", () => {
      const statement: Statement = generator.toWhereStatement({
        attributes: { RequestId: new Wildcard("a*") },
      } as any);

      expect(statement.query).toContain("lowerUTF8(k) = lowerUTF8(");
    });

    test("no attributeKeys pre-filter is emitted — it would prune on exact case", () => {
      /*
       * `hasAny(attributeKeys, ['RequestId'])` is an exact-case match, so
       * pruning on the user's casing would drop rows whose stored key differs
       * only in case, silently defeating the case-insensitivity above.
       */
      const statement: Statement = generator.toWhereStatement({
        attributes: { RequestId: new Wildcard("a*") },
      } as any);

      expect(statement.query).not.toContain("hasAny");
    });

    test("several globs OR together inside one key match", () => {
      const statement: Statement = generator.toWhereStatement({
        attributes: { k: new Wildcard(["a*", "b*"]) },
      } as any);

      expect(statement.query).toBe(
        "AND arrayExists((k, v) -> lowerUTF8(k) = lowerUTF8({p0:String}) AND (v ILIKE {p1:String} OR v ILIKE {p2:String}), mapKeys({p3:Identifier}), mapValues({p4:Identifier}))",
      );
      expect(Object.values(statement.query_params)).toEqual([
        "k",
        "a%",
        "b%",
        "attributes",
        "attributes",
      ]);
    });

    test("the negated form is NOT arrayExists, so a row without the key passes", () => {
      /*
       * A span that carries no `platform.team` at all trivially does not
       * match `a*`, so it must survive `-@platform.team:a*`. Negating the
       * existence test is what achieves that; negating only the value
       * comparison would drop those rows.
       */
      const statement: Statement = generator.toWhereStatement({
        attributes: { "platform.team": new NotWildcard("a*") },
      } as any);

      expect(statement.query.startsWith("AND NOT arrayExists(")).toBe(true);
      expect(Object.values(statement.query_params)).toContain("a%");
    });

    test("an empty glob list constrains nothing rather than matching nothing", () => {
      const statement: Statement = generator.toWhereStatement({
        attributes: { k: new Wildcard([]) },
      } as any);

      expect(statement.query).toBe("");
    });

    test("several operators on ONE key AND together", () => {
      /*
       * The attributes map has a single slot per key, so before this the
       * second predicate either replaced the first or the array reached the
       * bare-value branch and bound as `String(array)` — a silent
       * match-nothing.
       */
      const statement: Statement = generator.toWhereStatement({
        attributes: { k: [new Wildcard("a*"), new Wildcard("*b")] },
      } as any);

      expect(Object.values(statement.query_params)).toContain("a%");
      expect(Object.values(statement.query_params)).toContain("%b");
    });
  });

  describe("scalar Text column", () => {
    test("compiles to a plain ILIKE", () => {
      const statement: Statement = generator.toWhereStatement({
        serviceName: new Wildcard("api-*"),
      } as any);

      expect(statement.query).toBe("AND ({p0:Identifier} ILIKE {p1:String})");
      expect(statement.query_params).toStrictEqual({
        p0: "serviceName",
        p1: "api-%",
      });
    });

    test("several globs OR together", () => {
      const statement: Statement = generator.toWhereStatement({
        serviceName: new Wildcard(["api-*", "web-*"]),
      } as any);

      expect(statement.query).toBe(
        "AND ({p0:Identifier} ILIKE {p1:String} OR {p2:Identifier} ILIKE {p3:String})",
      );
      expect(Object.values(statement.query_params)).toEqual([
        "serviceName",
        "api-%",
        "serviceName",
        "web-%",
      ]);
    });

    test("the negated form lets NULL through", () => {
      /*
       * `NOT (NULL ILIKE 'api-%')` is NULL, which filters the row out — but a
       * row with no service name at all does not match `api-*`, so it belongs
       * in the result of "not api-*".
       */
      const statement: Statement = generator.toWhereStatement({
        serviceName: new NotWildcard("api-*"),
      } as any);

      expect(statement.query).toBe(
        "AND (NOT ({p0:Identifier} ILIKE {p1:String}) OR {p2:Identifier} IS NULL)",
      );
    });
  });

  describe("Array(String) column", () => {
    test("compiles to arrayExists over the elements", () => {
      const statement: Statement = generator.toWhereStatement({
        observables: new Wildcard("10.0.*"),
      } as any);

      expect(statement.query).toBe(
        "AND arrayExists(x -> (x ILIKE {p0:String}), {p1:Identifier})",
      );
      expect(statement.query_params).toStrictEqual({
        p0: "10.0.%",
        p1: "observables",
      });
    });

    test("the negated form is NOT arrayExists", () => {
      const statement: Statement = generator.toWhereStatement({
        observables: new NotWildcard("10.0.*"),
      } as any);

      expect(statement.query).toBe(
        "AND NOT arrayExists(x -> (x ILIKE {p0:String}), {p1:Identifier})",
      );
    });
  });

  describe("LIKE metacharacters in the user's own value", () => {
    test("a percent is escaped, so 100%* is not a double match-anything", () => {
      const statement: Statement = generator.toWhereStatement({
        attributes: { k: new Wildcard("100%*") },
      } as any);

      expect(Object.values(statement.query_params)).toContain("100\\%%");
    });

    test("an underscore is escaped, so req_id* does not match reqXid", () => {
      const statement: Statement = generator.toWhereStatement({
        attributes: { k: new Wildcard("req_id*") },
      } as any);

      expect(Object.values(statement.query_params)).toContain("req\\_id%");
    });

    test("an escaped star is a literal asterisk in the pattern", () => {
      const statement: Statement = generator.toWhereStatement({
        attributes: { k: new Wildcard("a\\*b") },
      } as any);

      expect(Object.values(statement.query_params)).toContain("a*b");
    });
  });

  describe("injection safety", () => {
    test("the value is bound, never interpolated", () => {
      const hostile: string = "'; DROP TABLE log; --*";
      const statement: Statement = generator.toWhereStatement({
        attributes: { k: new Wildcard(hostile) },
      } as any);

      expect(statement.query).not.toContain("DROP TABLE");
      expect(Object.values(statement.query_params)).toContain(
        "'; DROP TABLE log; --%",
      );
    });
  });

  describe("resource guards", () => {
    test("an absurd number of globs is refused rather than compiled", () => {
      /*
       * Every glob is its own ILIKE predicate, so unlike `IN (...)` the cost
       * is multiplicative — and the filter arrives straight off a request
       * body. Refusing with a 400 that names the limit beats either building
       * the query or silently truncating it into a narrower filter than the
       * one that was asked for.
       */
      const tooMany: Array<string> = Array.from(
        { length: 51 },
        (_v: unknown, index: number) => {
          return `p${index}*`;
        },
      );

      expect(() => {
        return generator.toWhereStatement({
          attributes: { k: new Wildcard(tooMany) },
        } as any);
      }).toThrow(BadDataException);
    });

    test("exactly at the limit still compiles", () => {
      const atLimit: Array<string> = Array.from(
        { length: 50 },
        (_v: unknown, index: number) => {
          return `p${index}*`;
        },
      );

      expect(
        generator.toWhereStatement({
          attributes: { k: new Wildcard(atLimit) },
        } as any).query,
      ).toContain("ILIKE");
    });
  });

  describe("column-type guards", () => {
    test("a whole-map wildcard is refused rather than compiled to nonsense", () => {
      /*
       * `{attributes: new Wildcard("a*")}` means nothing — a glob cannot be
       * compared against a whole Map column. Refusing loudly beats emitting
       * `attributes ILIKE ...`, which fails at ClickHouse with a parse error
       * nobody can trace back to a search box.
       */
      expect(() => {
        return generator.toWhereStatement({
          attributes: new Wildcard("a*"),
        } as any);
      }).toThrow(BadDataException);
    });
  });

  describe("parity with the operators it sits beside", () => {
    test("a glob-free Wildcard is an anchored match, unlike Search", () => {
      /*
       * The whole point of the fix: `a*` used to become `Search("a")`, i.e.
       * `%a%`, so it matched "xax" as readily as "abc". These two must not
       * produce the same pattern.
       */
      const wildcard: Statement = generator.toWhereStatement({
        attributes: { k: new Wildcard("a*") },
      } as any);
      const search: Statement = generator.toWhereStatement({
        attributes: { k: new Search("a") },
      } as any);

      expect(Object.values(wildcard.query_params)).toContain("a%");
      expect(Object.values(search.query_params)).toContain("%a%");
    });
  });
});
