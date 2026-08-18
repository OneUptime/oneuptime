import { ClickhouseAppInstance } from "../../../../Server/Infrastructure/ClickhouseDatabase";
import UpdateBy from "../../../../Server/Types/AnalyticsDatabase/UpdateBy";
import {
  SQL,
  Statement,
} from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "../../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import logger from "../../../../Server/Utils/Logger";
import "../../TestingUtils/Init";
import AnalyticsBaseModel from "../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Route from "../../../../Types/API/Route";
import AnalyticsTableEngine from "../../../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableColumn from "../../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import OneUptimeDate from "../../../../Types/Date";
import EqualTo from "../../../../Types/BaseDatabase/EqualTo";
import NotEqual from "../../../../Types/BaseDatabase/NotEqual";
import IsNull from "../../../../Types/BaseDatabase/IsNull";
import NotNull from "../../../../Types/BaseDatabase/NotNull";
import GreaterThan from "../../../../Types/BaseDatabase/GreaterThan";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../../Types/BaseDatabase/IncludesNone";
import MultiSearch from "../../../../Types/BaseDatabase/MultiSearch";
import Search from "../../../../Types/BaseDatabase/Search";
import StartsWith from "../../../../Types/BaseDatabase/StartsWith";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../../Types/Exception/BadDataException";

function expectStatement(actual: Statement, expected: Statement): void {
  expect(actual.query).toBe(expected.query);
  expect(actual.query_params).toStrictEqual(expected.query_params);
}

describe("StatementGenerator", () => {
  class TestModel extends AnalyticsBaseModel {
    public constructor() {
      super({
        tableName: "<table-name>",
        singularName: "<singular-name>",
        pluralName: "<plural-name>",
        tableColumns: [
          new AnalyticsTableColumn({
            key: `column_ObjectID`,
            title: "<title>",
            description: "<description>",
            required: true,
            type: TableColumnType.ObjectID,
          }),
          new AnalyticsTableColumn({
            key: `column_1`,
            title: "<title>",
            description: "<description>",
            required: false,
            type: TableColumnType.Text,
          }),
          new AnalyticsTableColumn({
            key: `column_2`,
            title: "<title>",
            description: "<description>",
            required: false,
            type: TableColumnType.Number,
          }),
        ],
        crudApiPath: new Route("route"),
        primaryKeys: ["column_ObjectID"],
        sortKeys: ["column_ObjectID"],
        partitionKey: "column_ObjectID",
        tableEngine: AnalyticsTableEngine.MergeTree,
      });
    }
  }

  let generator: StatementGenerator<TestModel>;
  beforeEach(async () => {
    generator = new StatementGenerator<TestModel>({
      modelType: TestModel,
      database: ClickhouseAppInstance,
    });
  });

  describe("toUpdateStatement", () => {
    let updateBy: UpdateBy<TestModel>;
    beforeEach(() => {
      updateBy = {
        data: new TestModel(),
        query: {},
        props: {},
      };
      generator.toSetStatement = jest.fn(() => {
        return SQL`<set-statement>`;
      });
      generator.toWhereStatement = jest.fn(() => {
        return SQL`<where-statement>`;
      });
      jest.spyOn(logger, "debug").mockImplementation(() => {
        return undefined!;
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("should return ALTER TABLE UPDATE statement", () => {
      const statement: Statement = generator.toUpdateStatement(updateBy);

      expect(generator.toSetStatement).toBeCalledWith(updateBy.data);
      expect(generator.toWhereStatement).toBeCalledWith(updateBy.query);

      expect(jest.mocked(logger.debug)).toHaveBeenCalledTimes(2);
      expect(jest.mocked(logger.debug)).toHaveBeenNthCalledWith(
        1,
        "<table-name> Update Statement",
      );
      expect(jest.mocked(logger.debug)).toHaveBeenNthCalledWith(2, statement);

      /* eslint-disable prettier/prettier */
      // Cluster mode: mutation targets the local table and dispatches ON CLUSTER.
      expectStatement(
        statement,
        SQL`
                ALTER TABLE ${"oneuptime"}.${"<table-name>Local"} ON CLUSTER 'oneuptime'
                UPDATE <set-statement>
                WHERE TRUE <where-statement>
            `,
      );
      /* eslint-enable prettier/prettier */
    });
  });

  describe("toSetStatement", () => {
    let model: TestModel;
    beforeEach(() => {
      model = new TestModel();
    });

    test("should return the contents of a SET statement", () => {
      model.setColumnValue("column_1", "<value>");
      const statement: Statement = generator.toSetStatement(model);
      expect(statement.query).toBe("column_1 = {p0:String}");
      expect(statement.query_params).toStrictEqual({
        p0: "<value>",
      });
    });

    test("should set multiple columns", () => {
      model.setColumnValue("column_1", "<value>");
      model.setColumnValue("column_2", 123);
      const statement: Statement = generator.toSetStatement(model);
      expect(statement.query).toBe(
        "column_1 = {p0:String}, column_2 = {p1:Int32}",
      );
      expect(statement.query_params).toStrictEqual({
        p0: "<value>",
        p1: 123,
      });
    });

    test("should set column to NULL", () => {
      model.setColumnValue("column_1", null);
      const statement: Statement = generator.toSetStatement(model);
      expect(statement.query).toBe("column_1 = {p0:String}");
      expect(statement.query_params).toStrictEqual({
        p0: null,
      });
    });
  });

  describe("toWhereStatement", () => {
    test("should return the contents of a WHERE statement", () => {
      const statement: Statement = generator.toWhereStatement({
        _id: "<value>",
      });
      expect(statement.query).toBe("AND {p0:Identifier} = {p1:String}");
      expect(statement.query_params).toStrictEqual({
        p0: "_id",
        p1: "<value>",
      });
    });

    test("should check multiple columns", () => {
      const date: Date = new Date(9876543210);

      const statement: Statement = generator.toWhereStatement({
        _id: "<value>",
        createdAt: date,
      });
      expect(statement.query).toBe(
        "AND {p0:Identifier} = {p1:String} AND {p2:Identifier} = {p3:DateTime}",
      );
      expect(statement.query_params).toStrictEqual({
        p0: "_id",
        p1: "<value>",
        p2: "createdAt",
        p3: OneUptimeDate.toClickhouseDateTime(date),
      });
    });

    test("table-qualifies every column reference when tableAlias is set", () => {
      /*
       * Aggregate statements alias expressions to real column names
       * (`sum(col) as col`), and ClickHouse substitutes those aliases
       * into same-level unqualified WHERE references. Qualified
       * references always resolve to the table column.
       */
      const statement: Statement = generator.toWhereStatement(
        {
          _id: "<value>",
          column_1: "<text>",
        } as any,
        { tableAlias: "<table-name>" },
      );
      expect(statement.query).toBe(
        "AND {p0_t:Identifier}.{p0_c:Identifier} = {p1:String} AND {p2_t:Identifier}.{p2_c:Identifier} = {p3:String}",
      );
      expect(statement.query_params).toStrictEqual({
        p0_t: "<table-name>",
        p0_c: "_id",
        p1: "<value>",
        p2_t: "<table-name>",
        p2_c: "column_1",
        p3: "<text>",
      });
    });

    describe("MapStringString columns", () => {
      class MapModel extends AnalyticsBaseModel {
        public constructor() {
          super({
            tableName: "<map-table>",
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

      let mapGenerator: StatementGenerator<MapModel>;
      beforeEach(() => {
        mapGenerator = new StatementGenerator<MapModel>({
          modelType: MapModel,
          database: ClickhouseAppInstance,
        });
      });

      test("uses direct map subscript for bare-value equality", () => {
        const statement: Statement = mapGenerator.toWhereStatement({
          attributes: { requestId: "uuid-123" },
        } as any);
        /*
         * Programmatic callers pass canonical keys, so bare-value
         * equality compiles to `attributes['k'] = v` — an O(1) Map
         * subscript that the planner can push into PREWHERE. The
         * slower case-insensitive arrayExists form is reserved for
         * the user-typed Search/StartsWith/EndsWith/NotContains
         * operators below.
         */
        expect(statement.query).toBe(
          "AND {p0:Identifier}[{p1:String}] = {p2:String}",
        );
        expect(statement.query_params).toStrictEqual({
          p0: "attributes",
          p1: "requestId",
          p2: "uuid-123",
        });
      });

      test("uses direct map subscript for EqualTo wrapper", () => {
        const statement: Statement = mapGenerator.toWhereStatement({
          attributes: { requestId: new EqualTo("uuid-123") },
        } as any);
        expect(statement.query).toBe(
          "AND {p0:Identifier}[{p1:String}] = {p2:String}",
        );
        expect(statement.query_params).toStrictEqual({
          p0: "attributes",
          p1: "requestId",
          p2: "uuid-123",
        });
      });

      test("uses direct map subscript for NotEqual wrapper", () => {
        const statement: Statement = mapGenerator.toWhereStatement({
          attributes: { requestId: new NotEqual("uuid-123") },
        } as any);
        expect(statement.query).toBe(
          "AND {p0:Identifier}[{p1:String}] != {p2:String}",
        );
      });

      test("uses mapContains+subscript for IsNull wrapper", () => {
        const statement: Statement = mapGenerator.toWhereStatement({
          attributes: { requestId: new IsNull() },
        } as any);
        expect(statement.query).toBe(
          "AND ((NOT mapContains({p0:Identifier}, {p1:String})) OR {p2:Identifier}[{p3:String}] = '')",
        );
      });

      test("uses mapContains+subscript for NotNull wrapper", () => {
        const statement: Statement = mapGenerator.toWhereStatement({
          attributes: { requestId: new NotNull() },
        } as any);
        expect(statement.query).toBe(
          "AND mapContains({p0:Identifier}, {p1:String}) AND {p2:Identifier}[{p3:String}] != ''",
        );
      });

      test("uses direct map subscript for numeric GreaterThan wrapper", () => {
        const statement: Statement = mapGenerator.toWhereStatement({
          attributes: { httpStatus: new GreaterThan(500) },
        } as any);
        expect(statement.query).toBe(
          "AND toFloat64OrNull({p0:Identifier}[{p1:String}]) > {p2:Int32}",
        );
      });

      test("keeps case-insensitive arrayExists for Search wrapper", () => {
        const statement: Statement = mapGenerator.toWhereStatement({
          attributes: { requestId: new Search("uuid") },
        } as any);
        /*
         * Search comes from the user-typed search bar — keep the
         * case-insensitive ILIKE form so the user doesn't have to
         * remember whether the stored key is `requestId` or
         * `requestid`.
         */
        expect(statement.query).toContain("arrayExists");
        expect(statement.query).toContain("lowerUTF8");
        expect(statement.query).toContain("ILIKE");
      });

      test("keeps case-insensitive arrayExists for StartsWith wrapper", () => {
        const statement: Statement = mapGenerator.toWhereStatement({
          attributes: { requestId: new StartsWith("uuid") },
        } as any);
        expect(statement.query).toContain("arrayExists");
        expect(statement.query).toContain("lowerUTF8");
        expect(statement.query).toContain("ILIKE");
      });

      test("emits direct map subscript IN(...) for Includes wrapper", () => {
        const statement: Statement = mapGenerator.toWhereStatement({
          attributes: {
            "k8s.cluster.name": new Includes(["prod-east", "prod-west"]),
          },
        } as any);
        /*
         * Multi-value dashboard variables emit Includes on a map column;
         * the generator must produce an O(1) Map subscript followed by
         * IN, matching the fast-path used for bare-value equality.
         */
        expect(statement.query).toBe(
          "AND {p0:Identifier}[{p1:String}] IN {p2:Array(String)}",
        );
        expect(statement.query_params).toStrictEqual({
          p0: "attributes",
          p1: "k8s.cluster.name",
          p2: ["prod-east", "prod-west"],
        });
      });

      test("drops empty Includes wrapper instead of producing IN ()", () => {
        const statement: Statement = mapGenerator.toWhereStatement({
          attributes: {
            "k8s.cluster.name": new Includes([]),
          },
        } as any);
        /*
         * An empty multi-select is the user's "All" — must not emit
         * `IN ()` (which ClickHouse treats as match-nothing).
         */
        expect(statement.query).toBe("");
        expect(statement.query_params).toStrictEqual({});
      });

      test("emits direct map subscript NOT IN(...) for IncludesNone wrapper", () => {
        const statement: Statement = mapGenerator.toWhereStatement({
          attributes: {
            "k8s.cluster.name": new IncludesNone(["prod-east", "prod-west"]),
          },
        } as any);
        /*
         * "is none of" emits the same O(1) Map subscript fast path as
         * IN, negated. Missing keys (subscript returns '') pass NOT IN,
         * matching NotEqual's map semantics.
         */
        expect(statement.query).toBe(
          "AND {p0:Identifier}[{p1:String}] NOT IN {p2:Array(String)}",
        );
        expect(statement.query_params).toStrictEqual({
          p0: "attributes",
          p1: "k8s.cluster.name",
          p2: ["prod-east", "prod-west"],
        });
      });

      test("drops empty IncludesNone wrapper instead of producing NOT IN ()", () => {
        const statement: Statement = mapGenerator.toWhereStatement({
          attributes: {
            "k8s.cluster.name": new IncludesNone([]),
          },
        } as any);
        expect(statement.query).toBe("");
        expect(statement.query_params).toStrictEqual({});
      });

      describe("map key-array pruning", () => {
        class MapModelWithAttributeKeys extends AnalyticsBaseModel {
          public constructor() {
            super({
              tableName: "<map-table-with-attribute-keys>",
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
                  key: "attributes",
                  title: "<title>",
                  description: "<description>",
                  required: true,
                  defaultValue: {},
                  type: TableColumnType.MapStringString,
                  mapKeysColumn: "attributeKeys",
                }),
                new AnalyticsTableColumn({
                  key: "attributeKeys",
                  title: "<title>",
                  description: "<description>",
                  required: true,
                  defaultValue: [],
                  type: TableColumnType.ArrayText,
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

        class MapModelWithCustomMapKeys extends AnalyticsBaseModel {
          public constructor() {
            super({
              tableName: "<map-table-with-custom-key-column>",
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
                  key: "tags",
                  title: "<title>",
                  description: "<description>",
                  required: true,
                  defaultValue: {},
                  type: TableColumnType.MapStringString,
                  mapKeysColumn: "tagKeys",
                }),
                new AnalyticsTableColumn({
                  key: "tagKeys",
                  title: "<title>",
                  description: "<description>",
                  required: true,
                  defaultValue: [],
                  type: TableColumnType.ArrayText,
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

        let mapGeneratorWithAttributeKeys: StatementGenerator<MapModelWithAttributeKeys>;

        beforeEach(() => {
          mapGeneratorWithAttributeKeys =
            new StatementGenerator<MapModelWithAttributeKeys>({
              modelType: MapModelWithAttributeKeys,
              database: ClickhouseAppInstance,
            });
        });

        test("adds linked key-array bloom-index predicate for positive equality filters", () => {
          const statement: Statement =
            mapGeneratorWithAttributeKeys.toWhereStatement({
              attributes: { requestId: "uuid-123" },
            } as any);

          expect(statement.query).toBe(
            "AND (empty({p0:Identifier}) OR hasAny({p1:Identifier}, {p2:Array(String)})) AND {p3:Identifier}[{p4:String}] = {p5:String}",
          );
          expect(statement.query_params).toStrictEqual({
            p0: "attributeKeys",
            p1: "attributeKeys",
            p2: ["requestId"],
            p3: "attributes",
            p4: "requestId",
            p5: "uuid-123",
          });
        });

        test("does not add linked key-array predicate for empty equality because missing keys also match", () => {
          const statement: Statement =
            mapGeneratorWithAttributeKeys.toWhereStatement({
              attributes: { requestId: "" },
            } as any);

          expect(statement.query).toBe(
            "AND {p0:Identifier}[{p1:String}] = {p2:String}",
          );
          expect(statement.query_params).toStrictEqual({
            p0: "attributes",
            p1: "requestId",
            p2: "",
          });
        });

        test("adds linked key-array bloom-index predicate for positive Includes filters", () => {
          const statement: Statement =
            mapGeneratorWithAttributeKeys.toWhereStatement({
              attributes: {
                "k8s.cluster.name": new Includes(["prod-east", "prod-west"]),
              },
            } as any);

          expect(statement.query).toBe(
            "AND (empty({p0:Identifier}) OR hasAny({p1:Identifier}, {p2:Array(String)})) AND {p3:Identifier}[{p4:String}] IN {p5:Array(String)}",
          );
          expect(statement.query_params).toStrictEqual({
            p0: "attributeKeys",
            p1: "attributeKeys",
            p2: ["k8s.cluster.name"],
            p3: "attributes",
            p4: "k8s.cluster.name",
            p5: ["prod-east", "prod-west"],
          });
        });

        test("does not add linked key-array predicate for Includes containing empty string", () => {
          const statement: Statement =
            mapGeneratorWithAttributeKeys.toWhereStatement({
              attributes: {
                "k8s.cluster.name": new Includes(["", "prod-east"]),
              },
            } as any);

          expect(statement.query).toBe(
            "AND {p0:Identifier}[{p1:String}] IN {p2:Array(String)}",
          );
          expect(statement.query_params).toStrictEqual({
            p0: "attributes",
            p1: "k8s.cluster.name",
            p2: ["", "prod-east"],
          });
        });

        test("does not add linked key-array predicate for NotEqual because missing keys still match", () => {
          const statement: Statement =
            mapGeneratorWithAttributeKeys.toWhereStatement({
              attributes: { requestId: new NotEqual("uuid-123") },
            } as any);

          expect(statement.query).toBe(
            "AND {p0:Identifier}[{p1:String}] != {p2:String}",
          );
          expect(statement.query_params).toStrictEqual({
            p0: "attributes",
            p1: "requestId",
            p2: "uuid-123",
          });
        });

        test("uses mapKeysColumn metadata instead of hardcoded telemetry column names", () => {
          const customMapGenerator: StatementGenerator<MapModelWithCustomMapKeys> =
            new StatementGenerator<MapModelWithCustomMapKeys>({
              modelType: MapModelWithCustomMapKeys,
              database: ClickhouseAppInstance,
            });

          const statement: Statement = customMapGenerator.toWhereStatement({
            tags: { region: "us-east" },
          } as any);

          expect(statement.query).toBe(
            "AND (empty({p0:Identifier}) OR hasAny({p1:Identifier}, {p2:Array(String)})) AND {p3:Identifier}[{p4:String}] = {p5:String}",
          );
          expect(statement.query_params).toStrictEqual({
            p0: "tagKeys",
            p1: "tagKeys",
            p2: ["region"],
            p3: "tags",
            p4: "region",
            p5: "us-east",
          });
        });
      });
    });

    describe("ArrayText columns", () => {
      class ArrayModel extends AnalyticsBaseModel {
        public constructor() {
          super({
            tableName: "<array-table>",
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
                key: "entityKeys",
                title: "<title>",
                description: "<description>",
                required: true,
                defaultValue: [],
                type: TableColumnType.ArrayText,
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

      let arrayGenerator: StatementGenerator<ArrayModel>;
      beforeEach(() => {
        arrayGenerator = new StatementGenerator<ArrayModel>({
          modelType: ArrayModel,
          database: ClickhouseAppInstance,
        });
      });

      test("emits hasAny(...) for Includes on an Array(String) column", () => {
        const statement: Statement = arrayGenerator.toWhereStatement({
          entityKeys: new Includes(["210dac24142f1baa", "8a238f41aaf2c179"]),
        } as any);
        /*
         * Entity-membership reads (`has any of these entity keys`) compile
         * to `hasAny(col, [...])` so the bloom_filter skip index on the
         * Array(String) column can prune granules — not the scalar
         * `col IN (...)` form, which is invalid for an array column.
         */
        expect(statement.query).toBe(
          "AND hasAny({p0:Identifier}, {p1:Array(String)})",
        );
        expect(statement.query_params).toStrictEqual({
          p0: "entityKeys",
          p1: ["210dac24142f1baa", "8a238f41aaf2c179"],
        });
      });

      test("drops empty Includes instead of hasAny(col, [])", () => {
        const statement: Statement = arrayGenerator.toWhereStatement({
          entityKeys: new Includes([]),
        } as any);
        expect(statement.query).toBe("");
        expect(statement.query_params).toStrictEqual({});
      });

      test("emits NOT hasAny(...) for IncludesNone on an Array(String) column", () => {
        const statement: Statement = arrayGenerator.toWhereStatement({
          entityKeys: new IncludesNone(["210dac24142f1baa"]),
        } as any);
        expect(statement.query).toBe(
          "AND NOT hasAny({p0:Identifier}, {p1:Array(String)})",
        );
        expect(statement.query_params).toStrictEqual({
          p0: "entityKeys",
          p1: ["210dac24142f1baa"],
        });
      });

      test("drops empty IncludesNone instead of NOT hasAny(col, [])", () => {
        const statement: Statement = arrayGenerator.toWhereStatement({
          entityKeys: new IncludesNone([]),
        } as any);
        expect(statement.query).toBe("");
        expect(statement.query_params).toStrictEqual({});
      });
    });

    describe("scalar IncludesNone exclusion", () => {
      /*
       * "is none of" on a scalar column compiles to `col NOT IN (...)` —
       * the exception monitor uses this to exclude occurrences of
       * resolved/archived exception groups by fingerprint.
       */
      test("emits NOT IN (...) for IncludesNone on a Text column", () => {
        const statement: Statement = generator.toWhereStatement({
          column_1: new IncludesNone(["<fingerprint-1>", "<fingerprint-2>"]),
        } as any);
        expect(statement.query).toBe(
          "AND {p0:Identifier} NOT IN {p1:Array(String)}",
        );
        expect(statement.query_params).toStrictEqual({
          p0: "column_1",
          p1: ["<fingerprint-1>", "<fingerprint-2>"],
        });
      });

      test("drops empty IncludesNone instead of producing NOT IN ()", () => {
        const statement: Statement = generator.toWhereStatement({
          column_1: new IncludesNone([]),
        } as any);
        expect(statement.query).toBe("");
        expect(statement.query_params).toStrictEqual({});
      });
    });

    describe("entityScope synthetic key", () => {
      class EntityScopeModel extends AnalyticsBaseModel {
        public constructor() {
          super({
            tableName: "<entity-scope-table>",
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
                key: "entityKeys",
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

      let scopeGenerator: StatementGenerator<EntityScopeModel>;
      beforeEach(() => {
        scopeGenerator = new StatementGenerator<EntityScopeModel>({
          modelType: EntityScopeModel,
          database: ClickhouseAppInstance,
        });
      });

      test("compiles to (hasAny(...) OR attributes[...] = ...) with bound params", () => {
        const statement: Statement = scopeGenerator.toWhereStatement({
          entityScope: {
            entityKeys: ["210dac24142f1baa"],
            attributeKey: "resource.host.name",
            attributeValue: "web-1",
          },
        } as any);
        /*
         * The phase-4 read-switch: new rows match via the bloom-indexed
         * `entityKeys` membership column, old (pre-column, no-backfill)
         * rows via the resource attribute — same results either way, so
         * the OR keeps the swap behavior-identical until the fallback is
         * dropped post-retention.
         */
        expect(statement.query).toBe(
          "AND (hasAny({p0:Identifier}, {p1:Array(String)}) OR {p2:Identifier}[{p3:String}] = {p4:String})",
        );
        expect(statement.query_params).toStrictEqual({
          p0: "entityKeys",
          p1: ["210dac24142f1baa"],
          p2: "attributes",
          p3: "resource.host.name",
          p4: "web-1",
        });
      });

      test("composes with regular column predicates", () => {
        const statement: Statement = scopeGenerator.toWhereStatement({
          _id: "<value>",
          entityScope: {
            entityKeys: ["210dac24142f1baa"],
            attributeKey: "resource.host.name",
            attributeValue: "web-1",
          },
        } as any);
        expect(statement.query).toBe(
          "AND {p0:Identifier} = {p1:String} AND (hasAny({p2:Identifier}, {p3:Array(String)}) OR {p4:Identifier}[{p5:String}] = {p6:String})",
        );
        expect(statement.query_params).toStrictEqual({
          p0: "_id",
          p1: "<value>",
          p2: "entityKeys",
          p3: ["210dac24142f1baa"],
          p4: "attributes",
          p5: "resource.host.name",
          p6: "web-1",
        });
      });

      test("falls back to the attribute equality alone when entityKeys is empty", () => {
        const statement: Statement = scopeGenerator.toWhereStatement({
          entityScope: {
            entityKeys: [],
            attributeKey: "resource.host.name",
            attributeValue: "web-1",
          },
        } as any);
        expect(statement.query).toBe(
          "AND {p0:Identifier}[{p1:String}] = {p2:String}",
        );
        expect(statement.query_params).toStrictEqual({
          p0: "attributes",
          p1: "resource.host.name",
          p2: "web-1",
        });
      });

      test("is a no-op for models without an entityKeys column", () => {
        // TestModel (outer generator) has no entityKeys column.
        const statement: Statement = generator.toWhereStatement({
          entityScope: {
            entityKeys: ["210dac24142f1baa"],
            attributeKey: "resource.host.name",
            attributeValue: "web-1",
          },
        } as any);
        expect(statement.query).toBe("");
        expect(statement.query_params).toStrictEqual({});
      });

      test("no-op entityScope does not break separators for later predicates", () => {
        const statement: Statement = generator.toWhereStatement({
          entityScope: {
            entityKeys: ["210dac24142f1baa"],
            attributeKey: "resource.host.name",
            attributeValue: "web-1",
          },
          _id: "<value>",
        } as any);
        expect(statement.query).toBe("AND {p0:Identifier} = {p1:String}");
        expect(statement.query_params).toStrictEqual({
          p0: "_id",
          p1: "<value>",
        });
      });

      test("emits hasAny alone when the model has no attributes map column", () => {
        class NoAttributesModel extends AnalyticsBaseModel {
          public constructor() {
            super({
              tableName: "<no-attributes-table>",
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
                  key: "entityKeys",
                  title: "<title>",
                  description: "<description>",
                  required: true,
                  defaultValue: [],
                  type: TableColumnType.ArrayText,
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

        const noAttributesGenerator: StatementGenerator<NoAttributesModel> =
          new StatementGenerator<NoAttributesModel>({
            modelType: NoAttributesModel,
            database: ClickhouseAppInstance,
          });

        const statement: Statement = noAttributesGenerator.toWhereStatement({
          entityScope: {
            entityKeys: ["210dac24142f1baa"],
            attributeKey: "resource.host.name",
            attributeValue: "web-1",
          },
        } as any);
        expect(statement.query).toBe(
          "AND hasAny({p0:Identifier}, {p1:Array(String)})",
        );
        expect(statement.query_params).toStrictEqual({
          p0: "entityKeys",
          p1: ["210dac24142f1baa"],
        });
      });
    });

    /*
     * resourceEntityScopes: the compiled form of a resource-facet selection
     * (a Kubernetes cluster, a host, ...). Unlike entityScope it carries an
     * `entityIds` branch, because the same resource can be a row's PRIMARY
     * entity (agent-ingested telemetry) or merely one of its memberships
     * (OTLP telemetry primary-keyed on its Service). Matching only
     * primaryEntityId is what made a cluster filter return zero rows for
     * collector-ingested logs.
     */
    describe("resourceEntityScopes synthetic key", () => {
      class ResourceScopeModel extends AnalyticsBaseModel {
        public constructor() {
          super({
            tableName: "<resource-scope-table>",
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
                key: "primaryEntityId",
                title: "<title>",
                description: "<description>",
                required: true,
                type: TableColumnType.ObjectID,
              }),
              new AnalyticsTableColumn({
                key: "entityKeys",
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

      const CLUSTER_ID: string = "8c0f2f1e-2e4f-4a8c-9a1a-2f5b6c7d8e9f";
      const HOST_ID: string = "5f4e3d2c-1b0a-4998-8776-655443322110";

      let resourceGenerator: StatementGenerator<ResourceScopeModel>;
      beforeEach(() => {
        resourceGenerator = new StatementGenerator<ResourceScopeModel>({
          modelType: ResourceScopeModel,
          database: ClickhouseAppInstance,
        });
      });

      test("ORs the three membership branches inside one scope", () => {
        const statement: Statement = resourceGenerator.toWhereStatement({
          resourceEntityScopes: [
            {
              entityIds: [CLUSTER_ID],
              entityKeys: ["210dac24142f1baa"],
              attributeKey: "resource.k8s.cluster.name",
              attributeValues: ["prod-eu"],
            },
          ],
        } as any);

        expect(statement.query).toBe(
          "AND ({p0:Identifier} IN {p1:Array(String)} OR hasAny({p2:Identifier}, {p3:Array(String)}) OR {p4:Identifier}[{p5:String}] IN {p6:Array(String)})",
        );
        expect(statement.query_params).toStrictEqual({
          p0: "primaryEntityId",
          p1: [CLUSTER_ID],
          p2: "entityKeys",
          p3: ["210dac24142f1baa"],
          p4: "attributes",
          p5: "resource.k8s.cluster.name",
          p6: ["prod-eu"],
        });
      });

      test("ANDs separate scopes so two facets intersect", () => {
        const statement: Statement = resourceGenerator.toWhereStatement({
          resourceEntityScopes: [
            { entityIds: [CLUSTER_ID], entityKeys: ["210dac24142f1baa"] },
            { entityIds: [HOST_ID], entityKeys: ["9f8e7d6c5b4a3928"] },
          ],
        } as any);

        expect(statement.query).toBe(
          "AND ({p0:Identifier} IN {p1:Array(String)} OR hasAny({p2:Identifier}, {p3:Array(String)})) " +
            "AND ({p4:Identifier} IN {p5:Array(String)} OR hasAny({p6:Identifier}, {p7:Array(String)}))",
        );
      });

      test("composes with a Services predicate — cluster AND service", () => {
        const statement: Statement = resourceGenerator.toWhereStatement({
          primaryEntityId: "<service-id>",
          resourceEntityScopes: [
            { entityIds: [CLUSTER_ID], entityKeys: ["210dac24142f1baa"] },
          ],
        } as any);

        /*
         * The regression the issue reports: these two used to be coalesced
         * into ONE primaryEntityId IN (...) list, so adding a service made
         * results reappear while silently dropping the cluster.
         */
        expect(statement.query).toBe(
          "AND {p0:Identifier} = {p1:String} " +
            "AND ({p2:Identifier} IN {p3:Array(String)} OR hasAny({p4:Identifier}, {p5:Array(String)}))",
        );
      });

      test("a scope that resolved to ids only still narrows by primaryEntityId", () => {
        const statement: Statement = resourceGenerator.toWhereStatement({
          resourceEntityScopes: [{ entityIds: [CLUSTER_ID], entityKeys: [] }],
        } as any);

        expect(statement.query).toBe(
          "AND ({p0:Identifier} IN {p1:Array(String)})",
        );
      });

      test("an empty scope emits no predicate rather than an empty IN", () => {
        const statement: Statement = resourceGenerator.toWhereStatement({
          resourceEntityScopes: [{ entityIds: [], entityKeys: [] }],
        } as any);

        expect(statement.query).toBe("");
        expect(statement.query_params).toStrictEqual({});
      });

      test("an empty scope does not break separators for later predicates", () => {
        const statement: Statement = resourceGenerator.toWhereStatement({
          resourceEntityScopes: [{ entityIds: [], entityKeys: [] }],
          _id: "<value>",
        } as any);

        expect(statement.query).toBe("AND {p0:Identifier} = {p1:String}");
      });

      test("a non-array value carries no predicate", () => {
        const statement: Statement = resourceGenerator.toWhereStatement({
          resourceEntityScopes: { entityIds: [CLUSTER_ID] },
        } as any);

        expect(statement.query).toBe("");
      });

      test("blank ids and keys are filtered out of their branches", () => {
        const statement: Statement = resourceGenerator.toWhereStatement({
          resourceEntityScopes: [
            { entityIds: ["", CLUSTER_ID], entityKeys: [""] },
          ],
        } as any);

        expect(statement.query).toBe(
          "AND ({p0:Identifier} IN {p1:Array(String)})",
        );
        expect(statement.query_params).toStrictEqual({
          p0: "primaryEntityId",
          p1: [CLUSTER_ID],
        });
      });

      test("drops the branches whose backing column the model lacks", () => {
        // TestModel (outer generator) has neither primaryEntityId nor entityKeys.
        const statement: Statement = generator.toWhereStatement({
          resourceEntityScopes: [
            { entityIds: [CLUSTER_ID], entityKeys: ["210dac24142f1baa"] },
          ],
        } as any);

        expect(statement.query).toBe("");
      });

      test("qualifies every branch when a table alias is in play", () => {
        const statement: Statement = resourceGenerator.toWhereStatement(
          {
            resourceEntityScopes: [
              {
                entityIds: [CLUSTER_ID],
                entityKeys: ["210dac24142f1baa"],
                attributeKey: "resource.k8s.cluster.name",
                attributeValues: ["prod-eu"],
              },
            ],
          } as any,
          { tableAlias: "t" },
        );

        expect(statement.query).toBe(
          "AND ({p0_t:Identifier}.{p0_c:Identifier} IN {p1:Array(String)} OR " +
            "hasAny({p2_t:Identifier}.{p2_c:Identifier}, {p3:Array(String)}) OR " +
            "{p4_t:Identifier}.{p4_c:Identifier}[{p5:String}] IN {p6:Array(String)})",
        );
      });
    });

    /*
     * Table qualification (tableAlias option). Aggregate statements
     * alias expressions to real column names (`sum(col) as col`, and
     * `min(ts) as ts` under Total), and ClickHouse substitutes those
     * SELECT aliases into same-level unqualified WHERE references —
     * which injects an aggregate into WHERE (ILLEGAL_AGGREGATION; this
     * 500'd the Kubernetes Costs page) or silently changes the filter.
     * Table-qualified references always resolve to the real column, so
     * every operator branch must qualify when the option is set.
     */
    describe("table qualification (tableAlias)", () => {
      class QualModel extends AnalyticsBaseModel {
        public constructor() {
          super({
            tableName: "<qual-table>",
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
                key: "text_col",
                title: "<title>",
                description: "<description>",
                required: false,
                type: TableColumnType.Text,
              }),
              new AnalyticsTableColumn({
                key: "num_col",
                title: "<title>",
                description: "<description>",
                required: false,
                type: TableColumnType.Number,
              }),
              new AnalyticsTableColumn({
                key: "time_col",
                title: "<title>",
                description: "<description>",
                required: false,
                type: TableColumnType.DateTime64,
              }),
              new AnalyticsTableColumn({
                key: "arr_col",
                title: "<title>",
                description: "<description>",
                required: false,
                defaultValue: [],
                type: TableColumnType.ArrayText,
              }),
              new AnalyticsTableColumn({
                key: "json_col",
                title: "<title>",
                description: "<description>",
                required: false,
                type: TableColumnType.JSON,
              }),
              new AnalyticsTableColumn({
                key: "attrKeys",
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
                mapKeysColumn: "attrKeys",
              }),
              new AnalyticsTableColumn({
                key: "entityKeys",
                title: "<title>",
                description: "<description>",
                required: true,
                defaultValue: [],
                type: TableColumnType.ArrayText,
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

      const ALIAS: string = "<qual-table>";

      let qualGenerator: StatementGenerator<QualModel>;
      beforeEach(() => {
        qualGenerator = new StatementGenerator<QualModel>({
          modelType: QualModel,
          database: ClickhouseAppInstance,
        });
      });

      type QualifiedWhere = (query: Record<string, unknown>) => Statement;
      const qualifiedWhere: QualifiedWhere = (
        query: Record<string, unknown>,
      ): Statement => {
        return qualGenerator.toWhereStatement(query as any, {
          tableAlias: ALIAS,
        });
      };

      /**
       * Every `pN_t` qualifier param must carry the table alias, and the
       * set of qualified column names must be exactly `expectedColumns`
       * (order-insensitive, duplicates preserved).
       */
      type ExpectQualifiers = (
        statement: Statement,
        expectedColumns: Array<string>,
      ) => void;
      const expectQualifiers: ExpectQualifiers = (
        statement: Statement,
        expectedColumns: Array<string>,
      ): void => {
        const params: Record<string, unknown> = statement.query_params;
        const tableEntries: Array<unknown> = Object.entries(params)
          .filter(([key]: [string, unknown]) => {
            return key.endsWith("_t");
          })
          .map(([, value]: [string, unknown]) => {
            return value;
          });
        const columnEntries: Array<unknown> = Object.entries(params)
          .filter(([key]: [string, unknown]) => {
            return key.endsWith("_c");
          })
          .map(([, value]: [string, unknown]) => {
            return value;
          });

        expect(tableEntries).toHaveLength(expectedColumns.length);
        for (const table of tableEntries) {
          expect(table).toBe(ALIAS);
        }
        expect([...columnEntries].sort()).toStrictEqual(
          [...expectedColumns].sort(),
        );
        // No unqualified bare-identifier column references may remain.
        expect(statement.query).not.toMatch(/AND \{p\d+:Identifier\}/);
      };

      test("qualifies bare equality", () => {
        const statement: Statement = qualifiedWhere({ _id: "<value>" });
        expect(statement.query).toBe(
          "AND {p0_t:Identifier}.{p0_c:Identifier} = {p1:String}",
        );
        expect(statement.query_params).toStrictEqual({
          p0_t: ALIAS,
          p0_c: "_id",
          p1: "<value>",
        });
      });

      test("qualifies scalar comparison operators", () => {
        const statement: Statement = qualifiedWhere({
          text_col: new NotEqual("<x>"),
          num_col: new GreaterThan(5),
        });
        expect(statement.query).toBe(
          "AND {p0_t:Identifier}.{p0_c:Identifier} != {p1:String} " +
            "AND {p2_t:Identifier}.{p2_c:Identifier} > {p3:Int32}",
        );
        expectQualifiers(statement, ["text_col", "num_col"]);
      });

      test("qualifies both bounds of an InBetween (the costs-page window filter)", () => {
        const start: Date = new Date("2026-07-18T10:00:00.000Z");
        const end: Date = new Date("2026-07-25T10:00:00.000Z");
        const statement: Statement = qualifiedWhere({
          time_col: new InBetween(start, end),
        });
        expect(statement.query).toBe(
          "AND {p0_t:Identifier}.{p0_c:Identifier} >= {p1:DateTime64(9)} " +
            "AND {p2_t:Identifier}.{p2_c:Identifier} <= {p3:DateTime64(9)}",
        );
        expectQualifiers(statement, ["time_col", "time_col"]);
      });

      test("qualifies ILIKE search", () => {
        const statement: Statement = qualifiedWhere({
          text_col: new Search("needle"),
        });
        expect(statement.query).toBe(
          "AND {p0_t:Identifier}.{p0_c:Identifier} ILIKE {p1:String}",
        );
        expectQualifiers(statement, ["text_col"]);
      });

      test("qualifies scalar IN / NOT IN", () => {
        const statement: Statement = qualifiedWhere({
          text_col: new Includes(["a", "b"]),
        });
        expect(statement.query).toBe(
          "AND {p0_t:Identifier}.{p0_c:Identifier} IN {p1:Array(String)}",
        );
        expectQualifiers(statement, ["text_col"]);

        const exclusion: Statement = qualifiedWhere({
          text_col: new IncludesNone(["a", "b"]),
        });
        expect(exclusion.query).toBe(
          "AND {p0_t:Identifier}.{p0_c:Identifier} NOT IN {p1:Array(String)}",
        );
        expectQualifiers(exclusion, ["text_col"]);
      });

      test("qualifies hasAny membership on ArrayText columns", () => {
        const statement: Statement = qualifiedWhere({
          arr_col: new Includes(["k1"]),
        });
        expect(statement.query).toBe(
          "AND hasAny({p0_t:Identifier}.{p0_c:Identifier}, {p1:Array(String)})",
        );
        expectQualifiers(statement, ["arr_col"]);

        const exclusion: Statement = qualifiedWhere({
          arr_col: new IncludesNone(["k1"]),
        });
        expect(exclusion.query).toBe(
          "AND NOT hasAny({p0_t:Identifier}.{p0_c:Identifier}, {p1:Array(String)})",
        );
        expectQualifiers(exclusion, ["arr_col"]);
      });

      test("qualifies both references of a Text IS NULL check", () => {
        const statement: Statement = qualifiedWhere({
          text_col: new IsNull(),
        });
        expect(statement.query).toBe(
          "AND ({p0_t:Identifier}.{p0_c:Identifier} IS NULL OR {p1_t:Identifier}.{p1_c:Identifier} = '')",
        );
        expectQualifiers(statement, ["text_col", "text_col"]);
      });

      test("qualifies map subscripts and the key-presence prefilter", () => {
        const statement: Statement = qualifiedWhere({
          attributes: { "service.name": "web" },
        });
        /*
         * The presence prefilter reads the denormalized `attrKeys`
         * column and must be qualified too — it is part of the same
         * WHERE level as the aggregate aliases.
         */
        expect(statement.query).toBe(
          "AND (empty({p0_t:Identifier}.{p0_c:Identifier}) OR hasAny({p1_t:Identifier}.{p1_c:Identifier}, {p2:Array(String)})) " +
            "AND {p3_t:Identifier}.{p3_c:Identifier}[{p4:String}] = {p5:String}",
        );
        expectQualifiers(statement, ["attrKeys", "attrKeys", "attributes"]);
      });

      test("qualifies map numeric comparisons", () => {
        const statement: Statement = qualifiedWhere({
          attributes: { latency: new GreaterThan(100) },
        });
        expect(statement.query).toBe(
          "AND (empty({p0_t:Identifier}.{p0_c:Identifier}) OR hasAny({p1_t:Identifier}.{p1_c:Identifier}, {p2:Array(String)})) " +
            "AND toFloat64OrNull({p3_t:Identifier}.{p3_c:Identifier}[{p4:String}]) > {p5:Int32}",
        );
        expectQualifiers(statement, ["attrKeys", "attrKeys", "attributes"]);
      });

      test("qualifies map null checks", () => {
        const isNull: Statement = qualifiedWhere({
          attributes: { k: new IsNull() },
        });
        expect(isNull.query).toBe(
          "AND ((NOT mapContains({p0_t:Identifier}.{p0_c:Identifier}, {p1:String})) OR {p2_t:Identifier}.{p2_c:Identifier}[{p3:String}] = '')",
        );
        expectQualifiers(isNull, ["attributes", "attributes"]);

        const notNull: Statement = qualifiedWhere({
          attributes: { k: new NotNull() },
        });
        expect(notNull.query).toBe(
          "AND (empty({p0_t:Identifier}.{p0_c:Identifier}) OR hasAny({p1_t:Identifier}.{p1_c:Identifier}, {p2:Array(String)})) " +
            "AND mapContains({p3_t:Identifier}.{p3_c:Identifier}, {p4:String}) AND {p5_t:Identifier}.{p5_c:Identifier}[{p6:String}] != ''",
        );
        expectQualifiers(notNull, [
          "attrKeys",
          "attrKeys",
          "attributes",
          "attributes",
        ]);
      });

      test("qualifies the case-insensitive arrayExists search over map keys/values", () => {
        const statement: Statement = qualifiedWhere({
          attributes: { k: new Search("needle") },
        });
        expect(statement.query).toBe(
          "AND arrayExists((k, v) -> lowerUTF8(k) = lowerUTF8({p0:String}) AND v ILIKE {p1:String}, " +
            "mapKeys({p2_t:Identifier}.{p2_c:Identifier}), mapValues({p3_t:Identifier}.{p3_c:Identifier}))",
        );
        expectQualifiers(statement, ["attributes", "attributes"]);
      });

      test("qualifies JSON extraction filters", () => {
        const statement: Statement = qualifiedWhere({
          json_col: { field: "<v>", flag: true, count: 3 },
        });
        // JSON-extract fragments append back-to-back with no separator.
        expect(statement.query).toBe(
          "AND JSONExtractString({p0_t:Identifier}.{p0_c:Identifier}, {p1:String}) = {p2:String}" +
            "AND JSONExtractBool({p3_t:Identifier}.{p3_c:Identifier}, {p4:String}) = {p5:Bool}" +
            "AND JSONExtractInt({p6_t:Identifier}.{p6_c:Identifier}, {p7:String}) = {p8:Int32}",
        );
        expectQualifiers(statement, ["json_col", "json_col", "json_col"]);
      });

      test("qualifies every column of a MultiSearch fan-out", () => {
        const statement: Statement = qualifiedWhere({
          multiSearch: new MultiSearch({
            fields: ["text_col", "num_col"],
            value: "needle",
          }),
        });
        // The search value binds with each column's own type (num_col → Int32).
        expect(statement.query).toBe(
          "AND ({p0_t:Identifier}.{p0_c:Identifier} ILIKE {p1:String} OR {p2_t:Identifier}.{p2_c:Identifier} ILIKE {p3:Int32})",
        );
        expectQualifiers(statement, ["text_col", "num_col"]);
      });

      test("qualifies both sides of the entityScope OR-fallback", () => {
        const statement: Statement = qualifiedWhere({
          entityScope: {
            entityKeys: ["210dac24142f1baa"],
            attributeKey: "resource.host.name",
            attributeValue: "web-1",
          },
        });
        expect(statement.query).toBe(
          "AND (hasAny({p0_t:Identifier}.{p0_c:Identifier}, {p1:Array(String)}) OR {p2_t:Identifier}.{p2_c:Identifier}[{p3:String}] = {p4:String})",
        );
        expectQualifiers(statement, ["entityKeys", "attributes"]);
      });

      test("omitting the option produces the exact unqualified statement", () => {
        const query: Record<string, unknown> = {
          _id: "<value>",
          attributes: { "service.name": "web" },
        };
        const unqualified: Statement = qualGenerator.toWhereStatement(
          query as any,
        );
        expect(unqualified.query).not.toContain("_t:Identifier");
        expect(unqualified.query).toBe(
          "AND {p0:Identifier} = {p1:String} " +
            "AND (empty({p2:Identifier}) OR hasAny({p3:Identifier}, {p4:Array(String)})) " +
            "AND {p5:Identifier}[{p6:String}] = {p7:String}",
        );
      });

      test("still rejects unknown columns when qualifying", () => {
        expect(() => {
          return qualifiedWhere({ nonexistent: "<value>" });
        }).toThrow(BadDataException);
      });
    });
  });

  describe("toCreateStatement", () => {
    /*
     * Regression test for the escapeStringLiteral undefined/null guard.
     * An ArrayText (Array(String)) column whose value array carried
     * undefined/null members at runtime used to throw
     * "TypeError: Cannot read properties of undefined (reading 'replace')"
     * inside escapeStringLiteral while building the INSERT. The member is
     * now rendered as the empty string literal '' so the statement still
     * serializes to a valid ClickHouse Array(String).
     */
    class ArrayTextModel extends AnalyticsBaseModel {
      public constructor() {
        super({
          tableName: "<array-create-table>",
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
              key: "entityKeys",
              title: "<title>",
              description: "<description>",
              required: true,
              defaultValue: [],
              type: TableColumnType.ArrayText,
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

    let arrayTextGenerator: StatementGenerator<ArrayTextModel>;
    beforeEach(() => {
      arrayTextGenerator = new StatementGenerator<ArrayTextModel>({
        modelType: ArrayTextModel,
        database: ClickhouseAppInstance,
      });
    });

    test("renders undefined/null ArrayText elements as '' instead of throwing", () => {
      const item: ArrayTextModel = new ArrayTextModel();
      item.setColumnValue("_id", "210dac24142f1baa");
      /*
       * Simulate runtime data where the Array(String) column carries
       * undefined/null members. The type system models the column as
       * string[], hence the cast — this is exactly what crashed before
       * the guard was added.
       */
      item.setColumnValue("entityKeys", [
        "alpha",
        undefined,
        null,
        "beta",
      ] as unknown as Array<string>);

      let statement: string = "";
      expect(() => {
        statement = arrayTextGenerator.toCreateStatement({ item: [item] });
      }).not.toThrow();

      expect(statement).toContain("['alpha', '', '', 'beta']");
    });
  });

  describe("toSelectStatement", () => {
    test("should return the contents of a SELECT statement", () => {
      const { statement, columns } = generator.toSelectStatement({
        _id: true,
      });
      expect(statement.query).toBe("{p0:Identifier}");
      expect(statement.query_params).toStrictEqual({
        p0: "_id",
      });
      expect(columns).toStrictEqual(["_id"]);
    });

    test("should SELECT multiple columns", () => {
      const { statement, columns } = generator.toSelectStatement({
        _id: true,
        createdAt: true,
      });
      expect(statement.query).toBe("{p0:Identifier}, {p1:Identifier}");
      expect(statement.query_params).toStrictEqual({
        p0: "_id",
        p1: "createdAt",
      });
      expect(columns).toStrictEqual(["_id", "createdAt"]);
    });
  });

  /*
   * The separator here is load-bearing for pagination. `toSortStatement`
   * used to append sort keys with no delimiter, so anything past the first
   * key produced a malformed term (`col_1 DESCcol_2 ASC`) — which meant a
   * multi-key ORDER BY was unusable and, in practice, every paginated read
   * ran on a single, non-unique sort column. See the pagination-stability
   * suite in Tests/Server/Services/AnalyticsDatabasePaginationStability.
   */
  describe("toSortStatement", () => {
    /*
     * TestModel declares its columns through `tableColumns`, not as TS
     * properties, so a `Sort<TestModel>` literal would fail excess-property
     * checking on every key. Funnelling through one helper keeps the cast
     * in a single place instead of on each call.
     */
    const sortStatementFor: (sort: Record<string, SortOrder>) => Statement = (
      sort: Record<string, SortOrder>,
    ): Statement => {
      return generator.toSortStatement(sort as any);
    };

    test("renders a single ascending key with no trailing separator", () => {
      const statement: Statement = sortStatementFor({
        column_1: SortOrder.Ascending,
      });

      expect(statement.query).toBe("{p0:Identifier} ASC");
      expect(statement.query_params).toStrictEqual({ p0: "column_1" });
    });

    test("renders a single descending key", () => {
      const statement: Statement = sortStatementFor({
        column_1: SortOrder.Descending,
      });

      expect(statement.query).toBe("{p0:Identifier} DESC");
      expect(statement.query_params).toStrictEqual({ p0: "column_1" });
    });

    test("comma separates two keys", () => {
      const statement: Statement = sortStatementFor({
        column_1: SortOrder.Descending,
        column_2: SortOrder.Ascending,
      });

      expect(statement.query).toBe("{p0:Identifier} DESC, {p1:Identifier} ASC");
      expect(statement.query_params).toStrictEqual({
        p0: "column_1",
        p1: "column_2",
      });
    });

    test("comma separates three keys and preserves declaration order", () => {
      const statement: Statement = sortStatementFor({
        column_2: SortOrder.Ascending,
        column_1: SortOrder.Descending,
        column_ObjectID: SortOrder.Ascending,
      });

      expect(statement.query).toBe(
        "{p0:Identifier} ASC, {p1:Identifier} DESC, {p2:Identifier} ASC",
      );
      expect(statement.query_params).toStrictEqual({
        p0: "column_2",
        p1: "column_1",
        p2: "column_ObjectID",
      });
    });

    /*
     * Regression guard for the exact malformed shape. Asserting on the
     * rendered text rather than the param map is deliberate: the old bug
     * produced correct PARAMS and broken SQL, so a params-only assertion
     * would have passed straight through it.
     */
    test("never concatenates a direction into the next identifier", () => {
      const statement: Statement = sortStatementFor({
        column_1: SortOrder.Descending,
        column_2: SortOrder.Ascending,
      });

      expect(statement.query).not.toContain("DESC{");
      expect(statement.query).not.toContain("ASC{");
      expect(statement.query).toContain(", ");
    });

    test("separator count is always one fewer than the key count", () => {
      const statement: Statement = sortStatementFor({
        column_ObjectID: SortOrder.Ascending,
        column_1: SortOrder.Ascending,
        column_2: SortOrder.Ascending,
      });

      expect(statement.query.split(", ")).toHaveLength(3);
    });

    test("an empty sort produces an empty statement", () => {
      const statement: Statement = sortStatementFor({});

      expect(statement.query).toBe("");
      expect(statement.query_params).toStrictEqual({});
    });

    test("still rejects an unknown column", () => {
      expect(() => {
        return sortStatementFor({ not_a_column: SortOrder.Ascending });
      }).toThrow(BadDataException);
    });

    test("rejects an unknown column that appears after a valid one", () => {
      expect(() => {
        return sortStatementFor({
          column_1: SortOrder.Ascending,
          not_a_column: SortOrder.Descending,
        });
      }).toThrow(BadDataException);
    });
  });

  describe("toColumnsCreateStatement", () => {
    test("should return the columns of a CREATE TABLE statement", () => {
      const statement: Statement = generator.toColumnsCreateStatement([
        new AnalyticsTableColumn({
          key: "column_1",
          title: "<title>",
          description: "<description>",
          required: true,
          type: TableColumnType.Text,
        }),
        new AnalyticsTableColumn({
          key: "column_2",
          title: "<title>",
          description: "<description>",
          required: false,
          type: TableColumnType.Number,
        }),
      ]);

      expectStatement(
        statement,
        SQL`column_1 String, column_2 Nullable(Int32)`,
      );
    });

    test("should not add NULL|NOT NULL to Array types", () => {
      const statement: Statement = generator.toColumnsCreateStatement([
        new AnalyticsTableColumn({
          key: "column_1",
          title: "<title>",
          description: "<description>",
          required: true,
          type: TableColumnType.ArrayText,
        }),
        new AnalyticsTableColumn({
          key: "column_2",
          title: "<title>",
          description: "<description>",
          required: false,
          type: TableColumnType.ArrayNumber,
        }),
      ]);

      expectStatement(
        statement,
        SQL`column_1 Array(String), column_2 Nullable(Array(Int32))`,
      );
    });

    test("wraps LowCardinality columns and respects nullability", () => {
      const statement: Statement = generator.toColumnsCreateStatement([
        new AnalyticsTableColumn({
          key: "col_lc_req",
          title: "<title>",
          description: "<description>",
          required: true,
          type: TableColumnType.Text,
          isLowCardinality: true,
        }),
        new AnalyticsTableColumn({
          key: "col_lc_null",
          title: "<title>",
          description: "<description>",
          required: false,
          type: TableColumnType.Text,
          isLowCardinality: true,
        }),
      ]);

      expectStatement(
        statement,
        SQL`col_lc_req LowCardinality(String), col_lc_null LowCardinality(Nullable(String))`,
      );
    });

    test("emits AggregateFunction and scalar SimpleAggregateFunction measures", () => {
      const statement: Statement = generator.toColumnsCreateStatement([
        new AnalyticsTableColumn({
          key: "retentionDate",
          title: "<title>",
          description: "<description>",
          required: false,
          type: TableColumnType.Date,
          simpleAggregateFunction: "max",
        }),
        new AnalyticsTableColumn({
          key: "valueState",
          title: "<title>",
          description: "<description>",
          required: true,
          type: TableColumnType.AggregateFunction,
          aggregateFunctionDefinition: "sum, Float64",
        }),
      ]);

      expectStatement(
        statement,
        SQL`retentionDate SimpleAggregateFunction(max, DateTime), valueState AggregateFunction(sum, Float64)`,
      );
    });

    test("supports SimpleAggregateFunction on non-DateTime scalar types and codecs", () => {
      const statement: Statement = generator.toColumnsCreateStatement([
        new AnalyticsTableColumn({
          key: "sampleCount",
          title: "<title>",
          description: "<description>",
          required: true,
          type: TableColumnType.UInt64,
          simpleAggregateFunction: "sum",
          codec: { codec: "ZSTD", level: 1 },
        }),
      ]);

      expectStatement(
        statement,
        SQL`sampleCount SimpleAggregateFunction(sum, UInt64) CODEC(ZSTD(1))`,
      );
    });

    test("rejects a column that declares both aggregate representations", () => {
      expect(() => {
        return generator.toColumnsCreateStatement([
          new AnalyticsTableColumn({
            key: "ambiguousState",
            title: "<title>",
            description: "<description>",
            required: true,
            type: TableColumnType.AggregateFunction,
            aggregateFunctionDefinition: "sum, Float64",
            simpleAggregateFunction: "sum",
          }),
        ]);
      }).toThrow(
        "Column ambiguousState cannot declare both AggregateFunction and SimpleAggregateFunction",
      );
    });

    test.each(["", " max", "max ", "max)", "max, DateTime"])(
      "rejects unsafe SimpleAggregateFunction name %p",
      (functionName: string) => {
        expect(() => {
          return generator.toColumnsCreateStatement([
            new AnalyticsTableColumn({
              key: "invalidMeasure",
              title: "<title>",
              description: "<description>",
              required: true,
              type: TableColumnType.Date,
              simpleAggregateFunction: functionName,
            }),
          ]);
        }).toThrow(
          `Column invalidMeasure has invalid simpleAggregateFunction "${functionName}"`,
        );
      },
    );

    test("rejects AggregateFunction without its state definition", () => {
      expect(() => {
        return generator.toColumnsCreateStatement([
          new AnalyticsTableColumn({
            key: "missingStateDefinition",
            title: "<title>",
            description: "<description>",
            required: true,
            type: TableColumnType.AggregateFunction,
          }),
        ]);
      }).toThrow(
        "Column missingStateDefinition is AggregateFunction but missing aggregateFunctionDefinition",
      );
    });

    test("emits single and pipelined CODEC clauses", () => {
      const statement: Statement = generator.toColumnsCreateStatement([
        new AnalyticsTableColumn({
          key: "col_zstd",
          title: "<title>",
          description: "<description>",
          required: true,
          type: TableColumnType.Text,
          codec: { codec: "ZSTD", level: 1 },
        }),
        new AnalyticsTableColumn({
          key: "col_pipe",
          title: "<title>",
          description: "<description>",
          required: true,
          type: TableColumnType.DateTime64,
          codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
        }),
      ]);

      expectStatement(
        statement,
        SQL`col_zstd String CODEC(ZSTD(1)), col_pipe DateTime64(9) CODEC(DoubleDelta, ZSTD(1))`,
      );
    });
  });

  describe("toTableCreateStatement", () => {
    beforeEach(() => {
      generator.toColumnsCreateStatement = jest.fn(() => {
        return SQL`                <columns-create-statement>`;
      });
      jest.spyOn(logger, "debug").mockImplementation(() => {
        return undefined!;
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("should return CREATE TABLE statement", () => {
      const statement: Statement = generator.toTableCreateStatement();

      expect(generator.toColumnsCreateStatement).toBeCalledWith(
        generator.model.tableColumns,
      );

      expect(jest.mocked(logger.debug)).toHaveBeenCalledTimes(2);
      expect(jest.mocked(logger.debug)).toHaveBeenNthCalledWith(
        1,
        "<table-name> Table Create Statement",
      );
      expect(jest.mocked(logger.debug)).toHaveBeenNthCalledWith(2, statement);

      /* eslint-disable prettier/prettier */
      // Cluster mode: the local <table>Local table, Replicated engine, ON CLUSTER.
      const expectedStatement: Statement = SQL`
            CREATE TABLE IF NOT EXISTS ${"oneuptime"}.${"<table-name>Local"} ON CLUSTER 'oneuptime'
    (
        <columns-create-statement>
    )
    ENGINE = ReplicatedMergeTree
PARTITION BY (column_ObjectID)

    PRIMARY KEY (${"column_ObjectID"})
    ORDER BY (${"column_ObjectID"})
    `;
      /* eslint-enable prettier/prettier */

      // Normalize whitespace for comparison to avoid formatting issues
      const normalizeWhitespace: (s: string) => string = (
        s: string,
      ): string => {
        return s.replace(/\s+/g, " ").trim();
      };
      expect(normalizeWhitespace(statement.query)).toBe(
        normalizeWhitespace(expectedStatement.query),
      );
      expect(statement.query_params).toStrictEqual(
        expectedStatement.query_params,
      );
    });
  });
});
