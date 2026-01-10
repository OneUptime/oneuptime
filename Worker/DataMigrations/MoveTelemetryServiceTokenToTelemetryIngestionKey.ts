import DataMigrationBase from "./DataMigrationBase";

export default class MoveTelemetryServiceTokenToTelemetryIngestionKey extends DataMigrationBase {
  public constructor() {
    super("MoveTelemetryServiceTokenToTelemetryIngestionKey");
  }

  public override async migrate(): Promise<void> {
    // This migration is no longer needed as the telemetryServiceToken field
    // has been removed from the Service model. The migration was used to move
    // tokens from TelemetryService to TelemetryIngestionKey.
    return;
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
