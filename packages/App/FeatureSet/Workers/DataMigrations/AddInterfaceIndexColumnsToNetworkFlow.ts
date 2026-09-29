import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import NetworkFlowService from "Common/Server/Services/NetworkFlowService";
import NetworkFlow from "Common/Models/AnalyticsModels/NetworkFlow";

/*
 * Adds inputInterfaceIndex / outputInterfaceIndex to the NetworkFlow table.
 * The NetFlow parser has extracted these since day one and the receiver
 * forwarded them, but ingest dropped them — making per-interface traffic
 * attribution impossible. Existing rows default to 0 ("unknown"), the same
 * value exporters send when they cannot report an ifIndex.
 */
export default class AddInterfaceIndexColumnsToNetworkFlow extends DataMigrationBase {
  public constructor() {
    super("AddInterfaceIndexColumnsToNetworkFlow");
  }

  public override runsInClusterMode(): boolean {
    return false;
  }

  public override async migrate(): Promise<void> {
    await this.addColumnIfMissing("inputInterfaceIndex");
    await this.addColumnIfMissing("outputInterfaceIndex");
  }

  public async addColumnIfMissing(columnName: string): Promise<void> {
    const column: AnalyticsTableColumn | undefined =
      new NetworkFlow().tableColumns.find((column: AnalyticsTableColumn) => {
        return column.key === columnName;
      });

    if (!column) {
      return;
    }

    const columnType: TableColumnType | null =
      await NetworkFlowService.getColumnTypeInDatabase(column);

    if (columnType) {
      // Already present — never drop a flow column; rows are immutable facts.
      return;
    }

    await NetworkFlowService.addColumnInDatabase(column);
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
