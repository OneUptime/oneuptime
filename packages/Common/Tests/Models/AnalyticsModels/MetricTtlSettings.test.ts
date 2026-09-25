import { ClickhouseAppInstance } from "../../../Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import "../../Server/TestingUtils/Init";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Metric from "../../../Models/AnalyticsModels/Metric";
import MetricItemAggMV1m from "../../../Models/AnalyticsModels/MetricItemAggMV1m";
import MetricItemAggMV1mByContainer from "../../../Models/AnalyticsModels/MetricItemAggMV1mByContainer";
import MetricItemAggMV1mByHostV2 from "../../../Models/AnalyticsModels/MetricItemAggMV1mByHostV2";
import MetricItemAggMV1mByK8sCluster from "../../../Models/AnalyticsModels/MetricItemAggMV1mByK8sCluster";
import MetricItemAggMV1mByService from "../../../Models/AnalyticsModels/MetricItemAggMV1mByService";

/*
 * Boot-time schema reconciliation is purely additive — it never issues MODIFY
 * SETTING — so what these two models declare is what a fresh install lives with
 * for good, and changing it back needs a data migration, not a redeploy.
 *
 * ttl_only_drop_parts drops a part only once EVERY row in it has expired. A
 * daily metric partition holds telemetry rows (retention per service) next to
 * monitor rows (GlobalConfig.monitorMetricRetentionInDays), so it never expires
 * as a whole: with the setting on, TTL evicts nothing at all and the tables grow
 * without limit. That is not hypothetical — it filled a production disk.
 */
function createStatementFor(modelType: { new (): AnalyticsBaseModel }): string {
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: modelType,
      database: ClickhouseAppInstance,
    });

  const statement: Statement | string = generator.toTableCreateStatement();

  return typeof statement === "string" ? statement : statement.query;
}

describe("Metric tables and ttl_only_drop_parts", () => {
  it("the raw metric table does not declare it, and keeps the dedup window", () => {
    const model: Metric = new Metric();

    expect(model.tableSettings).not.toContain("ttl_only_drop_parts");
    expect(model.tableSettings).toContain(
      "non_replicated_deduplication_window = 10000",
    );
  });

  it("the minute rollup does not declare it either", () => {
    const model: MetricItemAggMV1m = new MetricItemAggMV1m();

    expect(model.tableSettings).not.toContain("ttl_only_drop_parts");
  });

  it("generates a CREATE TABLE without it", () => {
    expect(createStatementFor(Metric)).not.toContain("ttl_only_drop_parts");
  });

  it("keeps it on the per-dimension rollups, which monitor metrics never reach", () => {
    /*
     * Monitor metrics carry no service / host / container / cluster dimension,
     * so these MVs see telemetry rows only and their partitions ARE uniform in
     * lifetime — the cheap whole-part drop is correct there. Guards the fix
     * above from being widened into a blanket removal.
     */
    const models: Array<AnalyticsBaseModel> = [
      new MetricItemAggMV1mByService(),
      new MetricItemAggMV1mByHostV2(),
      new MetricItemAggMV1mByContainer(),
      new MetricItemAggMV1mByK8sCluster(),
    ];

    for (const model of models) {
      expect(model.tableSettings).toContain("ttl_only_drop_parts = 1");
    }
  });
});
