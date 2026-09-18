import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import Log from "Common/Models/AnalyticsModels/Log";
import Span from "Common/Models/AnalyticsModels/Span";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Profile from "Common/Models/AnalyticsModels/Profile";
import ProfileSample from "Common/Models/AnalyticsModels/ProfileSample";
import LogService from "Common/Server/Services/LogService";
import SpanService from "Common/Server/Services/SpanService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import ProfileService from "Common/Server/Services/ProfileService";
import ProfileSampleService from "Common/Server/Services/ProfileSampleService";

/*
 * Adds the `serviceType` discriminator column to every telemetry table
 * that already carries `serviceId`. Metric already had this column
 * (AddServiceTypeColumnToMetricsTable) — this fills in the rest so
 * host / docker / k8s telemetry can reuse the `serviceId` slot without
 * the read side having to guess which Postgres table a given id points
 * at. See [[Common/Types/Telemetry/ServiceType.ts]].
 */
export default class AddServiceTypeColumnToTelemetryTables extends DataMigrationBase {
  public constructor() {
    super("AddServiceTypeColumnToTelemetryTables");
  }

  public override runsInClusterMode(): boolean {
    return false;
  }

  public override async migrate(): Promise<void> {
    await this.addServiceTypeColumn(new Log(), LogService);
    await this.addServiceTypeColumn(new Span(), SpanService);
    await this.addServiceTypeColumn(
      new ExceptionInstance(),
      ExceptionInstanceService,
    );
    await this.addServiceTypeColumn(new Profile(), ProfileService);
    await this.addServiceTypeColumn(new ProfileSample(), ProfileSampleService);
  }

  private async addServiceTypeColumn(
    model: { tableColumns: Array<AnalyticsTableColumn> },
    service: {
      getColumnTypeInDatabase: (
        column: AnalyticsTableColumn,
      ) => Promise<TableColumnType | null>;
      addColumnInDatabase: (column: AnalyticsTableColumn) => Promise<void>;
    },
  ): Promise<void> {
    const column: AnalyticsTableColumn | undefined = model.tableColumns.find(
      (item: AnalyticsTableColumn) => {
        return item.key === "serviceType";
      },
    );

    if (!column) {
      return;
    }

    const columnType: TableColumnType | null =
      await service.getColumnTypeInDatabase(column);

    if (!columnType) {
      await service.addColumnInDatabase(column);
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
