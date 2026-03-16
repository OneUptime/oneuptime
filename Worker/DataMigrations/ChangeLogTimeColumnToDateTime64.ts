import DataMigrationBase from "./DataMigrationBase";
import LogService from "Common/Server/Services/LogService";

export default class ChangeLogTimeColumnToDateTime64 extends DataMigrationBase {
  public constructor() {
    super("ChangeLogTimeColumnToDateTime64");
  }

  public override async migrate(): Promise<void> {
    // ALTER TABLE ... MODIFY COLUMN is a metadata-only operation in ClickHouse MergeTree tables.
    // It changes the column type without rewriting data on disk.
    await LogService.execute(
      `ALTER TABLE ${LogService.model.tableName} MODIFY COLUMN time DateTime64(9)`,
    );
  }

  public override async rollback(): Promise<void> {
    await LogService.execute(
      `ALTER TABLE ${LogService.model.tableName} MODIFY COLUMN time DateTime`,
    );
  }
}
