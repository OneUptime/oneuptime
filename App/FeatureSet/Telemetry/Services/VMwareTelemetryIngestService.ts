import ObjectID from "Common/Types/ObjectID";
import { JSONArray } from "Common/Types/JSON";
import VMwareSourceService from "Common/Server/Services/VMwareSourceService";
import VMwareResourceService from "Common/Server/Services/VMwareResourceService";
import OpenTelemetryIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  scanVMwareSnapshots,
  VMwareSourceSnapshot,
} from "Common/Server/Utils/Telemetry/VMwareSnapshot";

export default class VMwareTelemetryIngestService {
  public static async ingest(
    projectId: ObjectID,
    resourceMetrics: JSONArray,
  ): Promise<Map<string, TelemetryServiceMetadata>> {
    const result: Map<string, TelemetryServiceMetadata> = new Map();
    const snapshots: Array<VMwareSourceSnapshot> =
      scanVMwareSnapshots(resourceMetrics);
    for (const snapshot of snapshots) {
      const source: { id: ObjectID; isArchived: boolean } | null =
        await VMwareSourceService.ingestSnapshot(projectId, snapshot);
      if (!source) {
        continue;
      }
      if (!source.isArchived) {
        await VMwareResourceService.bulkUpsert({
          projectId,
          sourceId: source.id,
          resources: snapshot.resources,
        });
      }
      result.set(
        snapshot.sourceIdentifier,
        await OpenTelemetryIngestService.buildResourceMetadataForNonService({
          projectId,
          resourceId: source.id,
          primaryEntityType: ServiceType.VMwareSource,
          serviceName: `vmware/${snapshot.sourceIdentifier}`,
        }),
      );
    }
    return result;
  }
}
