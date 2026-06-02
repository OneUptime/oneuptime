import Service from "../../Models/DatabaseModels/Service";
import { Gray500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";

/*
 * Telemetry that arrives without an OTel service.name (and with no
 * host / docker / k8s resource signal) is not backed by a Service row.
 * The ingest path tags those analytics rows with the projectId in the
 * `serviceId` column under ServiceType.Unknown (see
 * OtelIngestBaseService.resolveTelemetryResource). The read side has no
 * Service to resolve, so we represent that telemetry with a synthetic,
 * non-persisted Service whose id is the projectId — that way the
 * existing serviceId -> Service lookups in the telemetry views resolve
 * it to a labelled "Unknown Service" entry without any per-view special
 * casing. A real Service._id is never equal to a projectId, so this
 * never collides with a genuine service.
 */
export const UNKNOWN_SERVICE_NAME: string = "Unknown Service";

export default class TelemetryServiceUtil {
  /*
   * True when a telemetry row's serviceId is the synthetic "Unknown
   * Service" — i.e. it equals the projectId (ServiceType.Unknown). Used
   * to suppress navigation to a per-service detail page that does not
   * exist for unattributed telemetry.
   */
  public static isUnknownServiceId(
    serviceId: ObjectID | string | null | undefined,
    projectId: ObjectID | null | undefined,
  ): boolean {
    if (!serviceId || !projectId) {
      return false;
    }
    return serviceId.toString() === projectId.toString();
  }

  /*
   * Build the synthetic Service used to render unattributed telemetry.
   * Not persisted — id is the projectId so that serviceId -> Service
   * lookups (which key on the analytics row's serviceId) resolve to it.
   */
  public static getUnknownService(projectId: ObjectID): Service {
    const service: Service = new Service();
    service.id = projectId;
    service.name = UNKNOWN_SERVICE_NAME;
    service.serviceColor = Gray500;
    return service;
  }

  /*
   * Append the synthetic "Unknown Service" to a loaded service list, but
   * only when the telemetry in view actually references it (some
   * serviceId equals the projectId). Avoids showing an empty "Unknown
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
