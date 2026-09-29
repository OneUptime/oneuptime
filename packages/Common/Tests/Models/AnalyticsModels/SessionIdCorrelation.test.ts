import { ClickhouseAppInstance } from "../../../Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import "../../Server/TestingUtils/Init";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsTableColumn, {
  SkipIndexType,
} from "../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import Log from "../../../Models/AnalyticsModels/Log";
import Span from "../../../Models/AnalyticsModels/Span";
import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";

/*
 * `sessionId` is the join key for the whole session replay feature: "show
 * me the recording behind this exception". These assertions guard two
 * different classes of failure.
 *
 * 1. THE COLUMN MUST EXIST ON THE MODEL. Boot-time schema reconciliation
 *    and App/FeatureSet/Workers/DataMigrations/
 *    AddSessionIdToTelemetryTables.ts both work by looking the column up
 *    in `model.tableColumns` and calling addColumnInDatabase on what they
 *    find. The migration does not throw when the column is absent (a throw
 *    would halt the entire data-migration chain) — it logs a warning and
 *    returns. So without a model declaration the migration is a permanent,
 *    SILENT no-op and correlation never works. That is exactly the bug
 *    these tests were written for, and the "declares a sessionId column"
 *    assertion below is the one that catches it.
 *
 * 2. THE COLUMN SHAPE CANNOT BE CHANGED LATER. Reconciliation is purely
 *    additive (ADD COLUMN IF NOT EXISTS / ADD INDEX IF NOT EXISTS);
 *    nothing in this repo issues MODIFY COLUMN. Shipping Nullable, or
 *    without the bloom filter, means living with it on billions of rows.
 */

const CORRELATED_MODELS: Array<{
  name: string;
  modelType: { new (): AnalyticsBaseModel };
}> = [
  { name: "Log", modelType: Log },
  { name: "Span", modelType: Span },
  { name: "ExceptionInstance", modelType: ExceptionInstance },
];

function fullText(statement: Statement | string): string {
  if (typeof statement === "string") {
    return statement;
  }
  return statement.query + " :: " + JSON.stringify(statement.query_params);
}

function createStatementFor(modelType: { new (): AnalyticsBaseModel }): string {
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: modelType,
      database: ClickhouseAppInstance,
    });

  return fullText(generator.toTableCreateStatement());
}

function findColumn(
  model: AnalyticsBaseModel,
  key: string,
): AnalyticsTableColumn | undefined {
  return model.tableColumns.find((column: AnalyticsTableColumn): boolean => {
    return column.key === key;
  });
}

describe("Session replay correlation column on the telemetry tables", () => {
  describe.each(CORRELATED_MODELS)(
    "$name",
    (entry: { name: string; modelType: { new (): AnalyticsBaseModel } }) => {
      const model: AnalyticsBaseModel = new entry.modelType();

      const sessionId: AnalyticsTableColumn | undefined = findColumn(
        model,
        "sessionId",
      );

      it("declares a sessionId column, so the migration and boot reconciliation actually add it", () => {
        /*
         * The lookup below is literally what
         * AddSessionIdToTelemetryTables.addSessionIdColumn does. If this
         * fails, that migration warns and returns without adding anything,
         * and no test anywhere else notices.
         */
        expect(sessionId).toBeDefined();
      });

      it("is a non-Nullable Text column defaulting to ''", () => {
        /*
         * required: true is what makes it non-Nullable, and the ''
         * defaultValue is what lets historical rows read back as "no
         * session" with NO backfill. Nullable is not an option:
         * StatementGenerator has to assumeNotNull-wrap Nullable columns
         * for skip indexes, which defeats the point of having one.
         */
        expect(sessionId?.type).toBe(TableColumnType.Text);
        expect(sessionId?.required).toBe(true);
        expect(sessionId?.defaultValue).toBe("");
      });

      it("carries a bloom_filter(0.01) GRANULARITY 1 skip index", () => {
        /*
         * A column added by reconciliation can never join the sort key, so
         * the bloom filter is the only granule pruning a
         * `sessionId = ?` predicate will ever get.
         */
        expect(sessionId?.skipIndex?.type).toBe(SkipIndexType.BloomFilter);
        expect(sessionId?.skipIndex?.params).toEqual([0.01]);
        expect(sessionId?.skipIndex?.granularity).toBe(1);
      });

      it("is NOT part of the sort key or the sharding key", () => {
        /*
         * Sort keys are fixed at CREATE TABLE and nothing issues MODIFY
         * ORDER BY, so a sessionId that reconciliation adds later could
         * never be in the key on an existing install — declaring it would
         * fork the schema between new and existing deployments.
         */
        expect(model.sortKeys).not.toContain("sessionId");
        expect(model.primaryKeys).not.toContain("sessionId");
        expect(model.shardingKey ?? "").not.toContain("sessionId");
      });

      it("generates a non-Nullable String column with its index in CREATE TABLE", () => {
        const sql: string = createStatementFor(entry.modelType);

        expect(sql).toContain("sessionId");
        expect(sql).not.toContain("sessionId Nullable");
        expect(sql).toContain("idx_session_id");
      });
    },
  );

  it("uses the SAME column key on all three tables, because it is a join key", () => {
    /*
     * A per-table rename (sessionID / session_id) would compile fine and
     * break every cross-signal query silently.
     */
    for (const entry of CORRELATED_MODELS) {
      const keys: Array<string> = new entry.modelType().tableColumns.map(
        (column: AnalyticsTableColumn): string => {
          return column.key;
        },
      );

      expect(keys).toContain("sessionId");
      expect(
        keys.filter((key: string): boolean => {
          return key === "sessionId";
        }),
      ).toHaveLength(1);
    }
  });
});
