import { ClickhouseAppInstance } from "../../../../Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "../../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import "../../TestingUtils/Init";
import AnalyticsBaseModel from "../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Route from "../../../../Types/API/Route";
import AnalyticsTableEngine from "../../../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableColumn, {
  SkipIndexType,
} from "../../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import EqualTo from "../../../../Types/BaseDatabase/EqualTo";
import NotEqual from "../../../../Types/BaseDatabase/NotEqual";

/**
 * Fix 6 — granule pruning for attribute-value equality. When a telemetry model
 * carries a bloom-filter-indexed `attributeKeys` sibling of its `attributes`
 * Map column, a positive equality on an attribute value should be prefixed with
 * has(attributeKeys, key) so the bloom index prunes granules where the key
 * never appears. Models without that indexed sibling must be unchanged.
 */
describe("StatementGenerator attributeKeys bloom guard", () => {
  // Model WITH a bloom-indexed attributeKeys column (mirrors Log / Span).
  class IndexedModel extends AnalyticsBaseModel {
    public constructor() {
      super({
        tableName: "<indexed-table>",
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
            skipIndex: {
              name: "idx_attribute_keys",
              type: SkipIndexType.BloomFilter,
              params: [0.01],
              granularity: 1,
            },
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

  // Model WITHOUT an attributeKeys column (no granule-pruning sibling).
  class PlainMapModel extends AnalyticsBaseModel {
    public constructor() {
      super({
        tableName: "<plain-table>",
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

  let indexedGenerator: StatementGenerator<IndexedModel>;
  let plainGenerator: StatementGenerator<PlainMapModel>;

  beforeEach(() => {
    indexedGenerator = new StatementGenerator<IndexedModel>({
      modelType: IndexedModel,
      database: ClickhouseAppInstance,
    });
    plainGenerator = new StatementGenerator<PlainMapModel>({
      modelType: PlainMapModel,
      database: ClickhouseAppInstance,
    });
  });

  test("prepends has(attributeKeys, key) for a bare-value equality when indexed", () => {
    const statement: Statement = indexedGenerator.toWhereStatement({
      attributes: { requestId: "uuid-123" },
    } as never);

    expect(statement.query).toBe(
      "AND has({p0:Identifier}, {p1:String}) AND {p2:Identifier}[{p3:String}] = {p4:String}",
    );
    expect(statement.query_params).toStrictEqual({
      p0: "attributeKeys",
      p1: "requestId",
      p2: "attributes",
      p3: "requestId",
      p4: "uuid-123",
    });
  });

  test("prepends has(attributeKeys, key) for an EqualTo wrapper when indexed", () => {
    const statement: Statement = indexedGenerator.toWhereStatement({
      attributes: { requestId: new EqualTo("uuid-123") },
    } as never);

    expect(statement.query).toBe(
      "AND has({p0:Identifier}, {p1:String}) AND {p2:Identifier}[{p3:String}] = {p4:String}",
    );
    expect(statement.query_params).toStrictEqual({
      p0: "attributeKeys",
      p1: "requestId",
      p2: "attributes",
      p3: "requestId",
      p4: "uuid-123",
    });
  });

  test("does NOT add the guard for an empty-string value (would change semantics)", () => {
    const statement: Statement = indexedGenerator.toWhereStatement({
      attributes: { requestId: "" },
    } as never);

    expect(statement.query).toBe(
      "AND {p0:Identifier}[{p1:String}] = {p2:String}",
    );
    expect(statement.query_params).toStrictEqual({
      p0: "attributes",
      p1: "requestId",
      p2: "",
    });
  });

  test("does NOT add the guard for NotEqual (missing-key rows must still match)", () => {
    const statement: Statement = indexedGenerator.toWhereStatement({
      attributes: { requestId: new NotEqual("uuid-123") },
    } as never);

    expect(statement.query).toBe(
      "AND {p0:Identifier}[{p1:String}] != {p2:String}",
    );
  });

  test("leaves a model without an indexed attributeKeys column unchanged", () => {
    const statement: Statement = plainGenerator.toWhereStatement({
      attributes: { requestId: "uuid-123" },
    } as never);

    expect(statement.query).toBe(
      "AND {p0:Identifier}[{p1:String}] = {p2:String}",
    );
    expect(statement.query_params).toStrictEqual({
      p0: "attributes",
      p1: "requestId",
      p2: "uuid-123",
    });
  });
});
