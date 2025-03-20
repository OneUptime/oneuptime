import DataMigrationBase from "./DataMigrationBase";
import TelemetryAttributeService from "Common/Server/Services/TelemetryAttributeService";

export default class DeleteAllTelemetryAttributes extends DataMigrationBase {
  public constructor() {
    super("DeleteAllTelemetryAttributes");
  }

  public override async migrate(): Promise<void> {
    await TelemetryAttributeService.deleteBy({
      query: {},
      props: {
        isRoot: true,
      },
    });
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
