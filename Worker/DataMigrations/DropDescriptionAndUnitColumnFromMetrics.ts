import DataMigrationBase from "./DataMigrationBase";
import MetricService from "Common/Server/Services/MetricService";

export default class DropDescriptionAndUnitColumnFromMetrics extends DataMigrationBase {
  public constructor() {
    super("DropDescriptionAndUnitColumnFromMetrics");
  }

  public override async migrate(): Promise<void> {
    await MetricService.dropColumnInDatabase("unit");
    await MetricService.dropColumnInDatabase("description");
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
