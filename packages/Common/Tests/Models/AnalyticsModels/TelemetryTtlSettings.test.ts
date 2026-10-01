import { ClickhouseAppInstance } from "../../../Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import "../../Server/TestingUtils/Init";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "../../../Models/AnalyticsModels/Log";
import Metric from "../../../Models/AnalyticsModels/Metric";
import MetricItemAggMV1m from "../../../Models/AnalyticsModels/MetricItemAggMV1m";

/*
 * ttl_only_drop_parts drops a part only once EVERY row in it has expired. The
 * partitions of these tables hold rows with different retentions side by
 * side: a metric partition holds telemetry rows (retention per service) next
 * to monitor rows (GlobalConfig.monitorMetricRetentionInDays), and a log
 * partition holds severities whose retention a project can override one by
 * one (TelemetryRetentionConfig.logs.bySeverity). With the setting on, the
 * longest-lived row keeps every other row of its part on disk - that filled a
 * production disk.
 *
 * Boot-time schema reconciliation is purely additive - it never issues
 * MODIFY SETTING - so what these models declare is what a fresh install lives
 * with for good, and an existing install is repaired by a data migration
 * (DropTtlOnlyDropPartsFromMixedRetentionTables, tested with App), not by a
 * redeploy.
 *
 * What is pinned: none of the three declares the setting, in the model or in
 * the CREATE TABLE generated from it, and each still expires rows by
 * retentionDate and keeps its insert dedup window. The fix must not be
 * "completed" by dropping the TTL itself.
 */

type ModelType = { new (): AnalyticsBaseModel };

interface MixedRetentionTable {
  label: string;
  modelType: ModelType;
  tableName: string;
}

const MIXED_RETENTION_TABLES: Array<MixedRetentionTable> = [
  {
    label: "the raw metric table",
    modelType: Metric,
    tableName: "MetricItemV3",
  },
  {
    label: "the minute rollup of it",
    modelType: MetricItemAggMV1m,
    tableName: "MetricItemAggMV1m",
  },
  {
    label: "the log table",
    modelType: Log,
    tableName: "LogItemV3",
  },
];

function createStatementFor(modelType: ModelType): string {
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: modelType,
      database: ClickhouseAppInstance,
    });

  const statement: Statement | string = generator.toTableCreateStatement();

  return typeof statement === "string" ? statement : statement.query;
}

describe("Telemetry tables whose partitions mix retentions", () => {
  describe.each(MIXED_RETENTION_TABLES)(
    "$label",
    ({ modelType, tableName }: MixedRetentionTable) => {
      test(`is ${tableName}, the table the clearing migration names`, () => {
        expect(new modelType().tableName).toBe(tableName);
      });

      test("does not declare ttl_only_drop_parts", () => {
        expect(new modelType().tableSettings).not.toContain(
          "ttl_only_drop_parts",
        );
      });

      test("still expires each row at its own retentionDate", () => {
        expect(new modelType().ttlExpression).toBe("retentionDate DELETE");
      });

      test("keeps its insert dedup window", () => {
        expect(new modelType().tableSettings).toContain(
          "non_replicated_deduplication_window = 10000",
        );
      });

      test("is created with the TTL and the dedup window, and without the setting", () => {
        const createStatement: string = createStatementFor(modelType);

        expect(createStatement).not.toContain("ttl_only_drop_parts");
        expect(createStatement).toMatch(/\bTTL retentionDate DELETE\b/);

        /*
         * The local tables are ReplicatedMergeTree, so the model's
         * non-replicated window is rewritten to its replicated equivalent.
         */
        const settingsClause: RegExpMatchArray | null = createStatement.match(
          /\bSETTINGS ([^\n]+)\s*$/,
        );

        expect(settingsClause).not.toBeNull();
        expect(settingsClause![1]).toContain(
          "replicated_deduplication_window = 10000",
        );
        expect(settingsClause![1]).not.toContain(
          "non_replicated_deduplication_window",
        );
      });
    },
  );
});
