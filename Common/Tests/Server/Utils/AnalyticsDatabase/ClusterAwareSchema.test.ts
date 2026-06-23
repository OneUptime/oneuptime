import { ClickhouseAppInstance } from "../../../../Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "../../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import {
  SQL,
  Statement,
} from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  adaptTableSettingsForStorage,
  applyClusterToMaterializedViewQuery,
  getClickhouseClusterName,
  getDistributedEngine,
  getStorageEngine,
  getStorageTableName,
  onClusterClause,
} from "../../../../Server/Utils/AnalyticsDatabase/ClusterConfig";
import UpdateBy from "../../../../Server/Types/AnalyticsDatabase/UpdateBy";
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

describe("ClickHouse cluster-aware schema (always-on)", () => {
  const originalCluster: string | undefined = process.env[CLUSTER_ENV_KEY];
  const originalSharding: string | undefined = process.env[SHARDING_ENV_KEY];

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
    test("cluster name defaults to 'oneuptime' and is overridable", () => {
      delete process.env[CLUSTER_ENV_KEY];
      expect(getClickhouseClusterName()).toBe("oneuptime");
      expect(onClusterClause()).toBe(" ON CLUSTER 'oneuptime'");

      process.env[CLUSTER_ENV_KEY] = "ext_cluster";
      expect(getClickhouseClusterName()).toBe("ext_cluster");
      expect(onClusterClause()).toBe(" ON CLUSTER 'ext_cluster'");

      // whitespace-only falls back to the default
      process.env[CLUSTER_ENV_KEY] = "   ";
      expect(getClickhouseClusterName()).toBe("oneuptime");
    });

    test("storage table name always gets the Local suffix", () => {
      expect(getStorageTableName("SpanItemV3")).toBe("SpanItemV3Local");
    });

    test("engines always map to their Replicated variant", () => {
      expect(getStorageEngine(AnalyticsTableEngine.MergeTree)).toBe(
        "ReplicatedMergeTree",
      );
      expect(getStorageEngine(AnalyticsTableEngine.AggregatingMergeTree)).toBe(
        "ReplicatedAggregatingMergeTree",
      );
    });

    test("table settings always swap to the replicated dedup window", () => {
      expect(
        adaptTableSettingsForStorage(
          "ttl_only_drop_parts = 1, non_replicated_deduplication_window = 10000",
        ),
      ).toBe(
        "ttl_only_drop_parts = 1, replicated_deduplication_window = 10000",
      );
    });

    test("distributed engine: model key, with global override winning", () => {
      delete process.env[SHARDING_ENV_KEY];
      // model sharding key is used
      expect(
        getDistributedEngine("SpanItemV3Local", "cityHash64(traceId)"),
      ).toContain("SpanItemV3Local, cityHash64(traceId))");
      // no model key -> default cityHash64(projectId)
      expect(getDistributedEngine("LogItemV3Local")).toContain(
        "cityHash64(projectId))",
      );
      // global override wins over the model key
      process.env[SHARDING_ENV_KEY] = "rand()";
      expect(
        getDistributedEngine("SpanItemV3Local", "cityHash64(traceId)"),
      ).toContain("SpanItemV3Local, rand())");
    });
  });

  describe("StatementGenerator DDL", () => {
    class SpanModel extends AnalyticsBaseModel {
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
          shardingKey: "cityHash64(traceId)",
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

    let spanGen: StatementGenerator<SpanModel>;
    let aggregatingGen: StatementGenerator<AggregatingModel>;

    beforeEach(() => {
      delete process.env[CLUSTER_ENV_KEY];
      delete process.env[SHARDING_ENV_KEY];
      spanGen = new StatementGenerator<SpanModel>({
        modelType: SpanModel,
        database: ClickhouseAppInstance,
      });
      aggregatingGen = new StatementGenerator<AggregatingModel>({
        modelType: AggregatingModel,
        database: ClickhouseAppInstance,
      });
    });

    test("CREATE TABLE builds the local Replicated table ON CLUSTER with replicated dedup", () => {
      const stmt: Statement = spanGen.toTableCreateStatement();
      expect(stmt.query).toContain("ENGINE = ReplicatedMergeTree");
      expect(stmt.query).toContain("ON CLUSTER 'oneuptime'");
      expect(stmt.query).toContain("replicated_deduplication_window = 10000");
      expect(stmt.query).not.toContain("non_replicated_deduplication_window");
      expect(fullText(stmt)).toContain("SpanItemV3Local");
    });

    test("cluster name override flows into the DDL", () => {
      process.env[CLUSTER_ENV_KEY] = "ext_cluster";
      expect(spanGen.toTableCreateStatement().query).toContain(
        "ON CLUSTER 'ext_cluster'",
      );
    });

    test("AggregatingMergeTree maps to ReplicatedAggregatingMergeTree", () => {
      const stmt: Statement = aggregatingGen.toTableCreateStatement();
      expect(stmt.query).toContain("ENGINE = ReplicatedAggregatingMergeTree");
      expect(fullText(stmt)).toContain("MetricItemAggMV1mLocal");
    });

    test("Distributed wrapper uses the model sharding key and local table", () => {
      const q: string = spanGen.toDistributedTableCreateStatement().query;
      expect(q).toContain("ON CLUSTER 'oneuptime'");
      expect(q).toContain(
        "Distributed('oneuptime', oneuptime, SpanItemV3Local, cityHash64(traceId))",
      );
      expect(q).toContain("AS ");
      expect(q).toContain("SpanItemV3 "); // the app-facing distributed name
    });

    test("global sharding-key override beats the model key in the Distributed engine", () => {
      process.env[SHARDING_ENV_KEY] = "rand()";
      expect(spanGen.toDistributedTableCreateStatement().query).toContain(
        "SpanItemV3Local, rand())",
      );
    });

    test("schema ALTERs target the local table", () => {
      const column: AnalyticsTableColumn = new SpanModel().tableColumns[1]!;
      expect(fullText(spanGen.toAddColumnStatement(column))).toContain(
        "SpanItemV3Local",
      );
      expect(fullText(spanGen.toAddSkipIndexStatement(column)!)).toContain(
        "SpanItemV3Local",
      );
      expect(spanGen.toDropColumnStatement("traceId")).toContain(
        "SpanItemV3Local",
      );
      expect(spanGen.toDropSkipIndexStatement("idx_trace_id")).toContain(
        "SpanItemV3Local",
      );
    });

    test("ALTER UPDATE mutates the local table with ON CLUSTER", () => {
      spanGen.toSetStatement = jest.fn(() => {
        return SQL`name = 'x'`;
      });
      spanGen.toWhereStatement = jest.fn(() => {
        return SQL` AND projectId = 'p'`;
      });
      const updateBy: UpdateBy<SpanModel> = {
        data: new SpanModel(),
        query: {},
        props: {},
      };
      const stmt: Statement = spanGen.toUpdateStatement(updateBy);
      expect(stmt.query).toContain("ON CLUSTER 'oneuptime'");
      expect(stmt.query).toContain("UPDATE");
      expect(fullText(stmt)).toContain("SpanItemV3Local");
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

    test("injects ON CLUSTER and retargets TO/FROM at local tables", () => {
      delete process.env[CLUSTER_ENV_KEY];
      const out: string = applyClusterToMaterializedViewQuery(MV_QUERY);
      expect(out).toContain(
        "CREATE MATERIALIZED VIEW IF NOT EXISTS MetricItemAggMV1m_mv ON CLUSTER 'oneuptime'",
      );
      expect(out).toContain("TO MetricItemAggMV1mLocal");
      expect(out).toContain("FROM MetricItemV3Local");
      // aggregate columns / time bucketing must NOT be rewritten
      expect(out).toContain("toStartOfMinute(time) AS bucketTime");
      expect(out).toContain("sumState(toFloat64(coalesce(value, sum, 0)))");
      expect(out).not.toContain("MetricItemAggMV1mLocalLocal");
      expect(out).not.toContain("MetricItemV3LocalLocal");
    });
  });
});
