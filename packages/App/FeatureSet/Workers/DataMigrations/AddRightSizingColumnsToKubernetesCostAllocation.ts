import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import KubernetesCostAllocationService from "Common/Server/Services/KubernetesCostAllocationService";
import KubernetesCostAllocation from "Common/Models/AnalyticsModels/KubernetesCostAllocation";

/*
 * Adds the three measures right-sizing needs beyond request-vs-usage
 * averages: the CPU and RAM limits (which the cost engine already reports
 * and the agent previously ignored) and the RAM peak (which the engine
 * cannot report at all, so the agent reads it from Prometheus).
 *
 * The peak is the load-bearing one. Recommending a memory request from an
 * hourly average is how you cause OOMKills — the burst that kills a
 * container disappears into the mean.
 *
 * Metadata-only and idempotent: ADD COLUMN IF NOT EXISTS, no part rewrite,
 * sort keys untouched. Existing rows read back 0, which every consumer must
 * treat as "unknown" rather than as a real measurement.
 */
export default class AddRightSizingColumnsToKubernetesCostAllocation extends DataMigrationBase {
  public constructor() {
    super("AddRightSizingColumnsToKubernetesCostAllocation");
  }

  public override runsInClusterMode(): boolean {
    return false;
  }

  public override async migrate(): Promise<void> {
    await this.addColumnIfMissing("cpuCoreLimitAverage");
    await this.addColumnIfMissing("ramBytesLimitAverage");
    await this.addColumnIfMissing("ramBytesUsageMax");
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
