import DataMigrationBase from "./DataMigrationBase";
import TelemetryServiceService from "CommonServer/Services/TelemetryServiceService";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import TelemetryService from "Model/Models/TelemetryService";
import TelemetryIngestionKey from "Model/Models/TelemetryIngestionKey";
import TelemetryIngestionKeyService from "CommonServer/Services/TelemetryIngestionKeyService";

export default class MoveTelemetryServiceTokenToTelemetryIngestionKey extends DataMigrationBase {
  public constructor() {
    super("MoveTelemetryServiceTokenToTelemetryIngestionKey");
  }

  public override async migrate(): Promise<void> {
    // get all telemetry services

    const telemetryService: TelemetryService[] =
      await TelemetryServiceService.findBy({
        query: {},
        props: {
          isRoot: true,
        },
        select: {
          projectId: true,
          telemetryServiceToken: true,
          name: true,
          description: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
      });

    for (const service of telemetryService) {
      const telemetryIngestionKey: TelemetryIngestionKey =
        new TelemetryIngestionKey();
      telemetryIngestionKey.projectId = service.projectId!;
      telemetryIngestionKey.secretKey = service.telemetryServiceToken!;
      telemetryIngestionKey.name = service.name!;
      telemetryIngestionKey.description = service.description!;

      await TelemetryIngestionKeyService.create({
        data: telemetryIngestionKey,
        props: {
          isRoot: true,
        },
      });
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
