import DataMigrationBase from "./DataMigrationBase";

export default class AddAttributesColumnToTelemetryAttribute extends DataMigrationBase {
  public constructor() {
    super("AddAttributesColumnToTelemetryAttribute");
  }

  public override runsInClusterMode(): boolean {
    return false;
  }

  public override async migrate(): Promise<void> {
    // Telemetry attributes table has been deprecated; nothing to migrate.
    return;
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
