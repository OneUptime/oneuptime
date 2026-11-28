import DataMigrationBase from "./DataMigrationBase";
import NonHostTelemetryHostRepair, {
  NonHostTelemetryRepairResult,
} from "Common/Server/Utils/Host/NonHostTelemetryHostRepair";
import logger from "Common/Server/Utils/Logger";

/*
 * Archives the Hosts an earlier release registered from telemetry that is
 * not a host's own - a Docker or Podman host's, a Kubernetes node's or pod's,
 * an application's in a pod - and clears the container runtime the Docker
 * and Podman agents wrote onto the Hosts it keeps (issue #11257). The ingest
 * no longer registers them, so they would sit under Infrastructure → Hosts
 * as Not reporting for ever. Which rows, and why each one is kept or
 * archived: NonHostTelemetryHostRepair. Each archived host's feed says why,
 * and Unarchive brings it back; its telemetry is untouched.
 *
 * Postgres only. Idempotent, and safe to run twice at once.
 */
export default class ArchiveHostsRegisteredFromNonHostTelemetry extends DataMigrationBase {
  public constructor() {
    super("ArchiveHostsRegisteredFromNonHostTelemetry");
  }

  public override async migrate(): Promise<void> {
    const result: NonHostTelemetryRepairResult =
      await NonHostTelemetryHostRepair.run();

    if (result.archivedCount > 0 || result.clearedContainerRuntimeCount > 0) {
      logger.info(
        `ArchiveHostsRegisteredFromNonHostTelemetry: archived ${result.archivedCount} host(s) registered from a Docker or Podman host's, Kubernetes' or an application's telemetry, and cleared the container runtime of ${result.clearedContainerRuntimeCount} host(s) kept.`,
      );
    }
  }

  public override async rollback(): Promise<void> {
    // An archived host is brought back with Unarchive, one by one or in bulk.
    return;
  }
}
