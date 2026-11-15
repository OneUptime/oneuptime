import MetricType from "Common/Models/DatabaseModels/MetricType";
import Service from "Common/Models/DatabaseModels/Service";
import { TelemetryServiceMetadata } from "Common/Server/Services/OpenTelemetryIngestService";
import Dictionary from "Common/Types/Dictionary";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { readOwnValue, writeOwnValue } from "Common/Utils/LookupTable";

/*
 * One catalog per ingest request. A collector can export the same metric
 * from thousands of services; searching its growing services array on
 * every resource makes catalog construction quadratic. The membership
 * sets keep that work linear while the arrays retain first-seen order
 * for the existing catalog writer. Both are released with the request.
 */
export default class MetricCatalog {
  public readonly metricNameServiceNameMap: Dictionary<MetricType> = {};

  /*
   * Most exports carry one service: avoid allocating a Set for every metric
   * until the collector actually combines distinct services in this request.
   */
  private readonly serviceIdsByMetricName: Map<string, string | Set<string>> =
    new Map();

  public addMetric(data: {
    name: string;
    description: string | undefined;
    unit: string | undefined;
    serviceMetadata: Pick<
      TelemetryServiceMetadata,
      "primaryEntityId" | "primaryEntityType"
    >;
  }): void {
    if (!data.name) {
      return;
    }

    /*
     * The catalog's own entries only, keyed as its own: a metric's name is
     * whatever the exporter wrote. A plain read of a metric named
     * constructor or __proto__ found what every object inherits, so no
     * entry was made, and the ingest then wrote the metric's counter
     * semantics onto that - the Object function, or the prototype every
     * object of the process shares.
     */
    let metricType: MetricType | undefined = readOwnValue(
      this.metricNameServiceNameMap,
      data.name,
    );
    if (!metricType) {
      metricType = new MetricType();
      metricType.name = data.name;
      if (data.description !== undefined) {
        metricType.description = data.description;
      }
      if (data.unit !== undefined) {
        metricType.unit = data.unit;
      }
      metricType.services = [];
      writeOwnValue(this.metricNameServiceNameMap, data.name, metricType);
    }

    /*
     * MetricType.services references real Service rows only. Hosts,
     * clusters and other primary entities still get a metric catalog
     * entry, but must never be linked through this Service foreign key.
     */
    if (data.serviceMetadata.primaryEntityType !== ServiceType.OpenTelemetry) {
      return;
    }

    const serviceId: string = data.serviceMetadata.primaryEntityId.toString();
    const serviceIds: string | Set<string> | undefined =
      this.serviceIdsByMetricName.get(data.name);
    if (
      typeof serviceIds === "string"
        ? serviceIds === serviceId
        : serviceIds?.has(serviceId)
    ) {
      return;
    }

    const service: Service = new Service();
    service.id = data.serviceMetadata.primaryEntityId;
    metricType.services!.push(service);
    if (serviceIds === undefined) {
      this.serviceIdsByMetricName.set(data.name, serviceId);
    } else if (typeof serviceIds === "string") {
      this.serviceIdsByMetricName.set(
        data.name,
        new Set([serviceIds, serviceId]),
      );
    } else {
      serviceIds.add(serviceId);
    }
  }
}
