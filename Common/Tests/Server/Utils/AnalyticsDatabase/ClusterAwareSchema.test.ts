import { ClickhouseAppInstance } from "../../../../Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "../../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import {
  SQL,
  Statement,
} from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import UpdateBy from "../../../../Server/Types/AnalyticsDatabase/UpdateBy";
import {
  adaptTableSettingsForStorage,
  applyClusterToMaterializedViewQuery,
  getClickhouseClusterName,
  getClickhouseShardingKey,
  getDistributedEngine,
  getStorageEngine,
  getStorageTableName,
  isClickhouseClustered,
  onClusterClause,
} from "../../../../Server/Utils/AnalyticsDatabase/ClusterConfig";
import "../../TestingUtils/Init";
import AnalyticsBaseModel from "../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Route from "../../../../Types/API/Route";
import AnalyticsTableEngine from "../../../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableColumn, {
  SkipIndexType,
} from "../../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";

const CLUSTER_ENV_KEY: string = "CLICKHOUSE_CLUSTER_NAME";
const SHARDING_ENV_KEY: string = "CLICKHOUSE_SHARDING_KEY";

// Flatten a Statement into a single string (raw SQL + serialized identifier
// params) so assertions don't have to care whether a name landed in the query
// text or in query_params as a {pN:Identifier} parameter.
function fullText(statement: Statement | string): string {
  if (typeof statement === "string") {
    return statement;
  }
  return statement.query + " :: " + JSON.stringify(statement.query_params);
}

describe("ClickHouse cluster-aware schema", () => {
  const originalCluster: string | undefined = process.env[CLUSTER_ENV_KEY];
  const originalSharding: string | undefined = process.env[SHARDING_ENV_KEY];

  function enableCluster(name: string = "test_cluster"): void {
    process.env[CLUSTER_ENV_KEY] = name;
  }

  afterEach(() => {
    if (originalCluster === undefined) {
      delete process.env[CLUSTER_ENV_KEY];
    } else {
      process.env[CLUSTER_ENV_KEY] = originalCluster;
    }
    if (originalSharding === undefined) {
      delete process.env[SHARDING_ENV_KEY];
    } else {
      process.env[SHARDING_ENV_KEY] = originalSharding;
    }
  });

  describe("ClusterConfig helpers", () => {
    test("single-node mode is the default (cluster name unset)", () => {
      delete process.env[CLUSTER_ENV_KEY];
      expect(isClickhouseClustered()).toBe(false);
      expect(getClickhouseClusterName()).toBe("");
      expect(onClusterClause()).toBe("");
      expect(getStorageTableName("SpanItemV3")).toBe("SpanItemV3");
      expect(getStorageEngine(AnalyticsTableEngine.MergeTree)).toBe(
        "MergeTree",
      );
      expect(getStorageEngine(AnalyticsTableEngine.AggregatingMergeTree)).toBe(
        "AggregatingMergeTree",
      );
      expect(
        adaptTableSettingsForStorage(
          "non_replicated_deduplication_window = 10000",
        ),
      ).toBe("non_replicated_deduplication_window = 10000");
    });

    test("cluster mode flips naming, engines, ON CLUSTER and dedup setting", () => {
      enableCluster("prod_cluster");
      expect(isClickhouseClustered()).toBe(true);
      expect(onClusterClause()).toBe(" ON CLUSTER 'prod_cluster'");
      expect(getStorageTableName("SpanItemV3")).toBe("SpanItemV3Local");
      expect(getStorageEngine(AnalyticsTableEngine.MergeTree)).toBe(
        "ReplicatedMergeTree",
      );
      expect(getStorageEngine(AnalyticsTableEngine.AggregatingMergeTree)).toBe(
        "ReplicatedAggregatingMergeTree",
      );
      expect(
        adaptTableSettingsForStorage(
          "ttl_only_drop_parts = 1, non_replicated_deduplication_window = 10000",
        ),
      ).toBe(
        "ttl_only_drop_parts = 1, replicated_deduplication_window = 10000",
      );
    });

    test("distributed engine uses cluster, db, local table and sharding key", () => {
      enableCluster("prod_cluster");
      const engine: string = getDistributedEngine("SpanItemV3Local");
      expect(engine).toContain("Distributed('prod_cluster'");
      expect(engine).toContain("SpanItemV3Local");
      expect(engine).toContain("cityHash64(projectId)");
    });

    test("sharding key default is cityHash64(projectId), overridable via env", () => {
      enableCluster();
      expect(getClickhouseShardingKey()).toBe("cityHash64(projectId)");
      process.env[SHARDING_ENV_KEY] = "rand()";
      expect(getClickhouseShardingKey()).toBe("rand()");
      expect(getDistributedEngine("LogItemV3Local")).toContain("rand()");
    });

    test("whitespace-only cluster name is treated as single-node", () => {
      process.env[CLUSTER_ENV_KEY] = "   ";
      expect(isClickhouseClustered()).toBe(false);
      expect(getStorageTableName("SpanItemV3")).toBe("SpanItemV3");
    });
  });

  describe("applyClusterToMaterializedViewQuery", () => {
    const MV_QUERY: string = `CREATE MATERIALIZED VIEW IF NOT EXISTS MetricItemAggMV1m_mv
TO MetricItemAggMV1m
AS
SELECT
  projectId,
  toStartOfMinute(time) AS bucketTime,
  sumState(toFloat64(coalesce(value, sum, 0))) AS valueSumState
FROM MetricItemV3
GROUP BY projectId, bucketTime`;

    test("single-node: returns the query unchanged", () => {
      delete process.env[CLUSTER_ENV_KEY];
      expect(applyClusterToMaterializedViewQuery(MV_QUERY)).toBe(MV_QUERY);
    });

    test("clustered: injects ON CLUSTER and retargets TO/FROM at local tables", () => {
      enableCluster("prod_cluster");
      const out: string = applyClusterToMaterializedViewQuery(MV_QUERY);
      expect(out).toContain(
        "CREATE MATERIALIZED VIEW IF NOT EXISTS MetricItemAggMV1m_mv ON CLUSTER 'prod_cluster'",
      );
      expect(out).toContain("TO MetricItemAggMV1mLocal");
      expect(out).toContain("FROM MetricItemV3Local");
      // aggregate columns / time bucketing must NOT be rewritten
      expect(out).toContain("toStartOfMinute(time) AS bucketTime");
      expect(out).toContain("sumState(toFloat64(coalesce(value, sum, 0)))");
      // no double-suffixing or stray edits
      expect(out).not.toContain("MetricItemAggMV1mLocalLocal");
      expect(out).not.toContain("MetricItemV3LocalLocal");
    });
  });

  describe("StatementGenerator DDL", () => {
    class MergeTreeModel extends AnalyticsBaseModel {
      public constructor() {
        super({
          tableName: "SpanItemV3",
          singularName: "Span",
          pluralName: "Spans",
          tableColumns: [
            new AnalyticsTableColumn({
              key: "projectId",
              title: "Project",
              description: "Project",
              required: true,
              type: TableColumnType.ObjectID,
            }),
            new AnalyticsTableColumn({
              key: "traceId",
              title: "Trace",
              description: "Trace",
              required: true,
              type: TableColumnType.Text,
              skipIndex: {
                name: "idx_trace_id",
                type: SkipIndexType.BloomFilter,
                params: [0.01],
                granularity: 1,
              },
            }),
          ],
          crudApiPath: new Route("span"),
          primaryKeys: ["projectId"],
          sortKeys: ["projectId"],
          partitionKey: "toYYYYMMDD(startTime)",
          tableEngine: AnalyticsTableEngine.MergeTree,
          ttlExpression: "retentionDate DELETE",
          tableSettings:
            "ttl_only_drop_parts = 1, non_replicated_deduplication_window = 10000",
        });
      }
    }

    class AggregatingModel extends AnalyticsBaseModel {
      public constructor() {
        super({
          tableName: "MetricItemAggMV1m",
          singularName: "Agg",
          pluralName: "Aggs",
          tableColumns: [
            new AnalyticsTableColumn({
              key: "projectId",
              title: "Project",
              description: "Project",
              required: true,
              type: TableColumnType.ObjectID,
            }),
          ],
          crudApiPath: new Route("agg"),
          primaryKeys: ["projectId"],
          sortKeys: ["projectId"],
          partitionKey: "toYYYYMM(bucketTime)",
          tableEngine: AnalyticsTableEngine.AggregatingMergeTree,
        });
      }
    }

    let mergeTreeGen: StatementGenerator<MergeTreeModel>;
    let aggregatingGen: StatementGenerator<AggregatingModel>;

    beforeEach(() => {
      mergeTreeGen = new StatementGenerator<MergeTreeModel>({
        modelType: MergeTreeModel,
        database: ClickhouseAppInstance,
      });
      aggregatingGen = new StatementGenerator<AggregatingModel>({
        modelType: AggregatingModel,
        database: ClickhouseAppInstance,
      });
    });

    describe("single-node (default)", () => {
      test("CREATE TABLE keeps plain engine, no ON CLUSTER, base table name", () => {
        delete process.env[CLUSTER_ENV_KEY];
        const text: string = fullText(mergeTreeGen.toTableCreateStatement());
        expect(text).toContain("ENGINE = MergeTree");
        expect(text).not.toContain("ReplicatedMergeTree");
        expect(text).not.toContain("ON CLUSTER");
        expect(text).toContain("non_replicated_deduplication_window = 10000");
        expect(text).toContain("SpanItemV3");
        expect(text).not.toContain("SpanItemV3Local");
      });

      test("no Distributed table is generated", () => {
        delete process.env[CLUSTER_ENV_KEY];
        expect(mergeTreeGen.toDistributedTableCreateStatement()).toBeNull();
      });

      test("ALTER ADD COLUMN targets the base table name", () => {
        delete process.env[CLUSTER_ENV_KEY];
        const column: AnalyticsTableColumn = new MergeTreeModel()
          .tableColumns[1]!;
        const text: string = fullText(mergeTreeGen.toAddColumnStatement(column));
        expect(text).toContain("ADD COLUMN IF NOT EXISTS");
        expect(text).toContain("SpanItemV3");
        expect(text).not.toContain("SpanItemV3Local");
      });
    });

    describe("clustered", () => {
      test("CREATE TABLE builds local Replicated table ON CLUSTER with replicated dedup", () => {
        enableCluster("prod_cluster");
        const stmt: Statement = mergeTreeGen.toTableCreateStatement();
        const text: string = fullText(stmt);
        // engine + clause live in raw query text
        expect(stmt.query).toContain("ENGINE = ReplicatedMergeTree");
        expect(stmt.query).toContain("ON CLUSTER 'prod_cluster'");
        expect(stmt.query).toContain("replicated_deduplication_window = 10000");
        expect(stmt.query).not.toContain("non_replicated_deduplication_window");
        // local storage table name is a {pN:Identifier} param
        expect(text).toContain("SpanItemV3Local");
      });

      test("AggregatingMergeTree maps to ReplicatedAggregatingMergeTree", () => {
        enableCluster();
        const stmt: Statement = aggregatingGen.toTableCreateStatement();
        expect(stmt.query).toContain("ENGINE = ReplicatedAggregatingMergeTree");
        expect(fullText(stmt)).toContain("MetricItemAggMV1mLocal");
      });

      test("Distributed wrapper points at local table with sharding key", () => {
        enableCluster("prod_cluster");
        const stmt: Statement | null =
          mergeTreeGen.toDistributedTableCreateStatement();
        expect(stmt).not.toBeNull();
        const q: string = stmt!.query;
        expect(q).toContain("ON CLUSTER 'prod_cluster'");
        expect(q).toContain("Distributed('prod_cluster'");
        expect(q).toContain("SpanItemV3Local");
        expect(q).toContain("cityHash64(projectId)");
        // app-facing distributed table keeps the model's tableName
        expect(q).toContain("SpanItemV3 ");
        expect(q).toContain("AS ");
      });

      test("ALTER ADD COLUMN targets the local table", () => {
        enableCluster();
        const column: AnalyticsTableColumn = new MergeTreeModel()
          .tableColumns[1]!;
        const text: string = fullText(mergeTreeGen.toAddColumnStatement(column));
        expect(text).toContain("ADD COLUMN IF NOT EXISTS");
        expect(text).toContain("SpanItemV3Local");
      });

      test("ADD INDEX, DROP COLUMN and DROP INDEX target the local table", () => {
        enableCluster();
        const column: AnalyticsTableColumn = new MergeTreeModel()
          .tableColumns[1]!;
        expect(fullText(mergeTreeGen.toAddSkipIndexStatement(column)!)).toContain(
          "SpanItemV3Local",
        );
        expect(mergeTreeGen.toDropColumnStatement("traceId")).toContain(
          "SpanItemV3Local",
        );
        expect(mergeTreeGen.toDropSkipIndexStatement("idx_trace_id")).toContain(
          "SpanItemV3Local",
        );
      });

      test("ALTER UPDATE mutates the local table with ON CLUSTER", () => {
        enableCluster("prod_cluster");
        mergeTreeGen.toSetStatement = jest.fn(() => {
          return SQL`name = 'x'`;
        });
        mergeTreeGen.toWhereStatement = jest.fn(() => {
          return SQL` AND projectId = 'p'`;
        });
        const updateBy: UpdateBy<MergeTreeModel> = {
          data: new MergeTreeModel(),
          query: {},
          props: {},
        };
        const stmt: Statement = mergeTreeGen.toUpdateStatement(updateBy);
        expect(stmt.query).toContain("ON CLUSTER 'prod_cluster'");
        expect(stmt.query).toContain("UPDATE");
        expect(fullText(stmt)).toContain("SpanItemV3Local");
      });
    });

    describe("single-node DML stays unchanged", () => {
      test("ALTER UPDATE has no ON CLUSTER and targets the base table", () => {
        delete process.env[CLUSTER_ENV_KEY];
        mergeTreeGen.toSetStatement = jest.fn(() => {
          return SQL`name = 'x'`;
        });
        mergeTreeGen.toWhereStatement = jest.fn(() => {
          return SQL` AND projectId = 'p'`;
        });
        const updateBy: UpdateBy<MergeTreeModel> = {
          data: new MergeTreeModel(),
          query: {},
          props: {},
        };
        const stmt: Statement = mergeTreeGen.toUpdateStatement(updateBy);
        expect(stmt.query).not.toContain("ON CLUSTER");
        expect(fullText(stmt)).not.toContain("SpanItemV3Local");
      });
    });
  });
});
