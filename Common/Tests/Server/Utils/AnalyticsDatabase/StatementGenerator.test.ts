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
import Includes from "../../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../../Types/BaseDatabase/IncludesNone";
import Search from "../../../../Types/BaseDatabase/Search";
import StartsWith from "../../../../Types/BaseDatabase/StartsWith";

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

      describe("attributeKeys pruning", () => {
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

        let mapGeneratorWithAttributeKeys: StatementGenerator<MapModelWithAttributeKeys>;

        beforeEach(() => {
          mapGeneratorWithAttributeKeys =
            new StatementGenerator<MapModelWithAttributeKeys>({
              modelType: MapModelWithAttributeKeys,
              database: ClickhouseAppInstance,
            });
        });

        test("adds attributeKeys bloom-index predicate for positive equality filters", () => {
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

        test("does not add attributeKeys predicate for empty equality because missing keys also match", () => {
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

        test("adds attributeKeys bloom-index predicate for positive Includes filters", () => {
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

        test("does not add attributeKeys predicate for Includes containing empty string", () => {
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

        test("does not add attributeKeys predicate for NotEqual because missing keys still match", () => {
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
