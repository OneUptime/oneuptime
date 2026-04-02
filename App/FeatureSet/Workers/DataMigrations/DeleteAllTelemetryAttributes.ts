import DataMigrationBase from "./DataMigrationBase";

export default class DeleteAllTelemetryAttributes extends DataMigrationBase {
  public constructor() {
    super("DeleteAllTelemetryAttributes");
  }

  public override async migrate(): Promise<void> {
    // Telemetry attributes now reside directly within telemetry data tables.
    return;
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
