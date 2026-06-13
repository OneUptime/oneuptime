import Service from "../../Models/DatabaseModels/Service";
import { Gray500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import ServiceType from "../../Types/Telemetry/ServiceType";

/*
 * Telemetry that arrives without an OTel service.name (and with no
 * host / docker / k8s resource signal) is not backed by a Service row.
 * The ingest path tags those analytics rows with the projectId in the
 * `primaryEntityId` column under ServiceType.Unknown (see
 * OtelIngestBaseService.resolveTelemetryResource). The read side has no
 * Service to resolve, so we represent that telemetry with a synthetic,
 * non-persisted Service whose id is the projectId — that way the
 * existing primaryEntityId -> Service lookups in the telemetry views resolve
 * it to a labelled "Unknown Service" entry without any per-view special
 * casing. A real Service._id is never equal to a projectId, so this
 * never collides with a genuine service.
 */
export const UNKNOWN_SERVICE_NAME: string = "Unknown Service";

/*
 * Result of resolving a telemetry row's polymorphic (primaryEntityId,
 * primaryEntityType) to something renderable. Either a Service (a real
 * OpenTelemetry service, or the synthetic "Unknown Service" for the
 * unattributed bucket) — or a plain `label` for infrastructure resource
 * types (Host / DockerHost / KubernetesCluster / ProxmoxCluster /
 * CephCluster) that have no Service row.
 */
export interface ResolvedTelemetryResource {
  service?: Service;
  label?: string;
}

export default class TelemetryServiceUtil {
  /*
   * True when a telemetry row's primaryEntityId is the synthetic "Unknown
   * Service" — i.e. it equals the projectId (ServiceType.Unknown). Used
   * to suppress navigation to a per-service detail page that does not
   * exist for unattributed telemetry.
   */
  public static isUnknownServiceId(
    primaryEntityId: ObjectID | string | null | undefined,
    projectId: ObjectID | null | undefined,
  ): boolean {
    if (!primaryEntityId || !projectId) {
      return false;
    }
    return primaryEntityId.toString() === projectId.toString();
  }

  /*
   * Build the synthetic Service used to render unattributed telemetry.
   * Not persisted — id is the projectId so that primaryEntityId -> Service
   * lookups (which key on the analytics row's primaryEntityId) resolve to it.
   */
  public static getUnknownService(projectId: ObjectID): Service {
    const service: Service = new Service();
    service.id = projectId;
    service.name = UNKNOWN_SERVICE_NAME;
    service.serviceColor = Gray500;
    return service;
  }

  /*
   * Resolve a telemetry row's polymorphic (primaryEntityId, primaryEntityType) to a
   * renderable resource, given the project's loaded Services. Replaces the
   * old server-side `service` ORM relation on TelemetryException: a real
   * Service resolves from the loaded list, the unattributed bucket resolves
   * to the synthetic "Unknown Service", and Host / DockerHost /
   * KubernetesCluster / ProxmoxCluster / CephCluster resolve to a type
   * label (no Service row exists for them). Mirrors how the ClickHouse
   * analytics rows are resolved.
   */
  public static resolveTelemetryResource(data: {
    primaryEntityId: ObjectID | string | null | undefined;
    primaryEntityType: ServiceType | string | null | undefined;
    services: Array<Service>;
    projectId: ObjectID | null | undefined;
  }): ResolvedTelemetryResource {
    const serviceIdStr: string | undefined = data.primaryEntityId?.toString();

    // Real Service (OpenTelemetry) — resolve from the loaded list.
    if (serviceIdStr) {
      const found: Service | undefined = data.services.find((s: Service) => {
        return s.id?.toString() === serviceIdStr;
      });
      if (found) {
        return { service: found };
      }
    }

    // Unattributed (Unknown) bucket — primaryEntityId is the projectId.
    if (
      data.projectId &&
      (data.primaryEntityType === ServiceType.Unknown ||
        this.isUnknownServiceId(data.primaryEntityId, data.projectId))
    ) {
      return { service: this.getUnknownService(data.projectId) };
    }

    // Infrastructure resource types — no Service row; render a type label.
    const typeLabels: Record<string, string> = {
      [ServiceType.Host]: "Host telemetry",
      [ServiceType.DockerHost]: "Docker host telemetry",
      [ServiceType.KubernetesCluster]: "Kubernetes telemetry",
      [ServiceType.ProxmoxCluster]: "Proxmox Cluster",
      [ServiceType.CephCluster]: "Ceph Cluster",
    };
    const label: string | undefined = data.primaryEntityType
      ? typeLabels[data.primaryEntityType.toString()]
      : undefined;
    if (label) {
      return { label: label };
    }

    return { label: "Unknown" };
  }

  /*
   * Append the synthetic "Unknown Service" to a loaded service list, but
   * only when the telemetry in view actually references it (some
   * primaryEntityId equals the projectId). Avoids showing an empty "Unknown
   * Service" entry for projects that always set service.name. Idempotent.
   */
  public static withUnknownServiceIfReferenced(data: {
    services: Array<Service>;
    referencedServiceIds: Iterable<string>;
    projectId: ObjectID;
  }): Array<Service> {
    const projectIdStr: string = data.projectId.toString();

    let isReferenced: boolean = false;
    for (const id of data.referencedServiceIds) {
      if (id === projectIdStr) {
        isReferenced = true;
        break;
      }
    }

    if (!isReferenced) {
      return data.services;
    }

    const alreadyPresent: boolean = data.services.some((service: Service) => {
      return service.id?.toString() === projectIdStr;
    });

    if (alreadyPresent) {
      return data.services;
    }

    return [...data.services, this.getUnknownService(data.projectId)];
  }
}
