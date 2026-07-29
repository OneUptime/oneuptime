import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import KubernetesCostAllocationService from "Common/Server/Services/KubernetesCostAllocationService";
import KubernetesCostAllocation from "Common/Models/AnalyticsModels/KubernetesCostAllocation";

/*
 * Adds shipmentId / shipmentChunk so the cost ingest can tell one agent
 * delivery of a window from another. Without them a window wider than the
 * agent's batch size arrives as several jobs and every job after the first
 * saw the earlier one's rows and dropped itself, so clusters above
 * SHIP_BATCH_SIZE containers stored only a fraction of each hour.
 *
 * Metadata-only and idempotent: ADD COLUMN IF NOT EXISTS, no part rewrite,
 * sort keys untouched. Existing rows read back "" / 0, which the ingest
 * service treats as "no shipment identity" and handles with the original
 * whole-window guard.
 */
export default class AddShipmentColumnsToKubernetesCostAllocation extends DataMigrationBase {
  public constructor() {
    super("AddShipmentColumnsToKubernetesCostAllocation");
  }

  public override runsInClusterMode(): boolean {
    return false;
  }

  public override async migrate(): Promise<void> {
    await this.addColumnIfMissing("shipmentId");
    await this.addColumnIfMissing("shipmentChunk");
  }

  public async addColumnIfMissing(columnName: string): Promise<void> {
    const column: AnalyticsTableColumn | undefined =
      new KubernetesCostAllocation().tableColumns.find(
        (column: AnalyticsTableColumn) => {
          return column.key === columnName;
        },
      );

    if (!column) {
      return;
    }

    const columnType: TableColumnType | null =
      await KubernetesCostAllocationService.getColumnTypeInDatabase(column);

    if (columnType) {
      // Already present — never drop it; cost rows are immutable facts.
      return;
    }

    await KubernetesCostAllocationService.addColumnInDatabase(column);
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
