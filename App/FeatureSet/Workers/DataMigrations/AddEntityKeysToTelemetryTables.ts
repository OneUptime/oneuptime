import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsDatabaseService from "Common/Server/Services/AnalyticsDatabaseService";
import Log from "Common/Models/AnalyticsModels/Log";
import Metric from "Common/Models/AnalyticsModels/Metric";
import Span from "Common/Models/AnalyticsModels/Span";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Profile from "Common/Models/AnalyticsModels/Profile";
import ProfileSample from "Common/Models/AnalyticsModels/ProfileSample";
import LogService from "Common/Server/Services/LogService";
import MetricService from "Common/Server/Services/MetricService";
import SpanService from "Common/Server/Services/SpanService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import ProfileService from "Common/Server/Services/ProfileService";
import ProfileSampleService from "Common/Server/Services/ProfileSampleService";
import logger from "Common/Server/Utils/Logger";

/**
 * Adds the additive `entityKeys Array(String)` membership column (plus its
 * `idx_entity_keys` bloom-filter skip index) to every OpenTelemetry signal
 * table. This is the keystone of the multi-entity model
 * (Internal/Docs/OpenTelemetryEntities.md, phase 3): one signal can belong
 * to many entities (service + host + k8s.pod + container + ...), so a
 * cross-cutting read like `has(entityKeys, :hostKey)` finds every signal
 * touching a host — even those primarily owned by a service.
 *
 * Non-key + non-destructive: `ADD COLUMN`/`ADD INDEX` are metadata-only
 * (no re-sort, no part rewrite); old rows read the column's default `[]`.
 * `primaryEntityId`/`primaryEntityType` and the sort/primary key are
 * untouched. `addColumnInDatabase` is idempotent (`IF NOT EXISTS` for both
 * the column and the index), so re-running is safe.
 */
export default class AddEntityKeysToTelemetryTables extends DataMigrationBase {
  public constructor() {
    super("AddEntityKeysToTelemetryTables");
  }

  public override async migrate(): Promise<void> {
    this.failures = [];
    await this.addEntityKeysColumn(new Log(), LogService);
    await this.addEntityKeysColumn(new Metric(), MetricService);
    await this.addEntityKeysColumn(new Span(), SpanService);
    await this.addEntityKeysColumn(
      new ExceptionInstance(),
      ExceptionInstanceService,
    );
    await this.addEntityKeysColumn(new Profile(), ProfileService);
    await this.addEntityKeysColumn(new ProfileSample(), ProfileSampleService);

    /*
     * Fail loudly if any table is missing the column: the runner then
     * retries next boot instead of recording success — downstream
     * migrations (MaterializeEntityKeysIndexOnTelemetryTables) and the
     * ingest stamping path require entityKeys to exist everywhere.
     */
    if (this.failures.length > 0) {
      throw new Error(
        `AddEntityKeysToTelemetryTables failed on: ${this.failures.join(", ")}`,
      );
    }
  }

  private failures: Array<string> = [];

  private async addEntityKeysColumn<TModel extends AnalyticsBaseModel>(
    model: TModel,
    service: AnalyticsDatabaseService<TModel>,
  ): Promise<void> {
    const column: AnalyticsTableColumn | undefined = model.tableColumns.find(
      (item: AnalyticsTableColumn) => {
        return item.key === "entityKeys";
      },
    );

    if (!column) {
      return;
    }

    try {
      // Idempotent: ADD COLUMN IF NOT EXISTS + ADD INDEX IF NOT EXISTS.
      await service.addColumnInDatabase(column);
      logger.info(
        `AddEntityKeysToTelemetryTables: ensured entityKeys on ${model.tableName}`,
      );
    } catch (err) {
      logger.error(
        `AddEntityKeysToTelemetryTables: failed on ${model.tableName}:`,
      );
      logger.error(err as Error);
      this.failures.push(model.tableName);
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
