import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import { ALL_ENTITY_MEMBERSHIP_COLUMNS } from "Common/Models/AnalyticsModels/EntityMembershipColumns";
import Log from "Common/Models/AnalyticsModels/Log";
import Span from "Common/Models/AnalyticsModels/Span";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Profile from "Common/Models/AnalyticsModels/Profile";
import ProfileSample from "Common/Models/AnalyticsModels/ProfileSample";
import LogService from "Common/Server/Services/LogService";
import SpanService from "Common/Server/Services/SpanService";
import MetricService from "Common/Server/Services/MetricService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import ProfileService from "Common/Server/Services/ProfileService";
import ProfileSampleService from "Common/Server/Services/ProfileSampleService";

interface MigratableAnalyticsService {
  getColumnTypeInDatabase: (
    column: AnalyticsTableColumn,
  ) => Promise<TableColumnType | null>;
  addColumnInDatabase: (column: AnalyticsTableColumn) => Promise<void>;
}

/*
 * Adds the OpenTelemetry-entity membership columns — `entityKeys`
 * Array(String) (+ bloom index) and the scalar per-type key columns
 * (serviceEntityKey, hostEntityKey, k8sPodEntityKey, k8sNodeEntityKey,
 * k8sClusterEntityKey, containerEntityKey, each + bloom index) — to every
 * telemetry signal table. These are NON-key, additive columns: a
 * metadata-only ALTER TABLE ADD COLUMN / ADD INDEX. `serviceId` and the
 * sort/primary key are unchanged, so no part rewrite happens; existing
 * rows read the type default (empty array / NULL) until merged.
 *
 * `addColumnInDatabase` issues `ADD COLUMN IF NOT EXISTS` followed by
 * `ADD INDEX IF NOT EXISTS` for the column's skip index, so this is
 * idempotent. Fresh tables already pick the columns up from the model
 * definition via the boot-time createTables() path; this migration backs
 * that up for already-provisioned tables.
 *
 * See Internal/Docs/OpenTelemetryEntities.md §3 (Entity membership on
 * signals). Columns are defined once in
 * [[Common/Models/AnalyticsModels/EntityMembershipColumns.ts]].
 */
export default class AddEntityMembershipColumnsToTelemetryTables extends DataMigrationBase {
  public constructor() {
    super("AddEntityMembershipColumnsToTelemetryTables");
  }

  public override async migrate(): Promise<void> {
    await this.addEntityColumns(new Log(), LogService);
    await this.addEntityColumns(new Span(), SpanService);
    await this.addEntityColumns(new Metric(), MetricService);
    await this.addEntityColumns(
      new ExceptionInstance(),
      ExceptionInstanceService,
    );
    await this.addEntityColumns(new Profile(), ProfileService);
    await this.addEntityColumns(new ProfileSample(), ProfileSampleService);
  }

  private async addEntityColumns(
    model: { tableColumns: Array<AnalyticsTableColumn> },
    service: MigratableAnalyticsService,
  ): Promise<void> {
    for (const columnKey of ALL_ENTITY_MEMBERSHIP_COLUMNS) {
      const column: AnalyticsTableColumn | undefined = model.tableColumns.find(
        (item: AnalyticsTableColumn) => {
          return item.key === columnKey;
        },
      );

      if (!column) {
        continue;
      }

      const columnType: TableColumnType | null =
        await service.getColumnTypeInDatabase(column);

      if (!columnType) {
        await service.addColumnInDatabase(column);
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
