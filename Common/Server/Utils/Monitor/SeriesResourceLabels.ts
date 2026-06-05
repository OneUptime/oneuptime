import { JSONObject } from "../../../Types/JSON";

/*
 * A grouped metric monitor (e.g. group-by `resource.host.name`) emits
 * one series per group, and each series carries the group's identity in
 * its labels. Resource identity shows up under several key spellings:
 *
 *   - the raw OTel resource attribute            (`host.name`)
 *   - the ClickHouse `resource.`-prefixed form   (`resource.host.name`)
 *   - the OneUptime stamps added at ingest        (`oneuptime.host.id`
 *     / `oneuptime.host.name` and their `resource.`-prefixed twins)
 *
 * This module is the single source of truth for "which label keys
 * identify which resource type", so that everything keying off series
 * identity — incident/alert resource linking AND scheduled-maintenance
 * suppression — stays in agreement. If the two ever diverged, a series
 * could be linked to a host it is not suppressed for (or vice versa).
 *
 * Multi-value labels are flattened, so a series that groups by a
 * multi-valued attribute references every value it carries.
 */

export const HostIdLabelKeys: ReadonlyArray<string> = [
  "resource.oneuptime.host.id",
  "oneuptime.host.id",
];

export const HostNameLabelKeys: ReadonlyArray<string> = [
  "resource.oneuptime.host.name",
  "oneuptime.host.name",
  "resource.host.name",
  "host.name",
];

/*
 * For Docker hosts we deliberately ignore raw `host.name` /
 * `oneuptime.host.name`: those are the Host's territory. The ingest
 * pipeline stamps `oneuptime.docker.host.*` independently when the
 * source is a docker host, so only those keys identify a DockerHost.
 */
export const DockerHostIdLabelKeys: ReadonlyArray<string> = [
  "resource.oneuptime.docker.host.id",
  "oneuptime.docker.host.id",
];

export const DockerHostNameLabelKeys: ReadonlyArray<string> = [
  "resource.oneuptime.docker.host.name",
  "oneuptime.docker.host.name",
];

export const KubernetesClusterIdLabelKeys: ReadonlyArray<string> = [
  "resource.oneuptime.kubernetes.cluster.id",
  "oneuptime.kubernetes.cluster.id",
];

export const KubernetesClusterNameLabelKeys: ReadonlyArray<string> = [
  "resource.oneuptime.kubernetes.cluster.name",
  "oneuptime.kubernetes.cluster.name",
  "resource.k8s.cluster.name",
  "k8s.cluster.name",
];

/*
 * Services come from OTel-ingested telemetry. The ingest pipeline
 * auto-creates a Service row keyed by `service.name`, so any series
 * label carrying that attribute (raw or prefixed) tells us the emitting
 * service. The `oneuptime.service.id` stamp is also accepted for callers
 * that resolved the ID upstream.
 */
export const ServiceIdLabelKeys: ReadonlyArray<string> = [
  "resource.oneuptime.service.id",
  "oneuptime.service.id",
];

export const ServiceNameLabelKeys: ReadonlyArray<string> = [
  "resource.service.name",
  "service.name",
];

/*
 * The identifiers carried by one series, split by resource type and by
 * id-vs-name. Ids are OneUptime database ids (the `oneuptime.*.id`
 * stamps); names are the human/telemetry identifiers (host.name,
 * k8s.cluster.name, service.name) that map to a resource's identifier
 * column (`hostIdentifier`, `clusterIdentifier`, `name`).
 */
export interface SeriesResourceRefs {
  hostIds: Array<string>;
  hostNames: Array<string>;
  dockerHostIds: Array<string>;
  dockerHostNames: Array<string>;
  kubernetesClusterIds: Array<string>;
  kubernetesClusterNames: Array<string>;
  serviceIds: Array<string>;
  serviceNames: Array<string>;
}

export default class SeriesResourceLabels {
  /*
   * Collect every non-empty string value held at any of `keys` in the
   * series labels, flattening multi-valued (array) labels. Returns a
   * deduped list.
   */
  public static collectLabelValues(
    seriesLabels: JSONObject,
    keys: ReadonlyArray<string>,
  ): Array<string> {
    const found: Set<string> = new Set<string>();

    for (const key of keys) {
      const value: unknown = seriesLabels[key];

      if (typeof value === "string" && value.length > 0) {
        found.add(value);
        continue;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string" && item.length > 0) {
            found.add(item);
          }
        }
      }
    }

    return Array.from(found);
  }

  public static extractResourceRefs(
    seriesLabels: JSONObject,
  ): SeriesResourceRefs {
    return {
      hostIds: this.collectLabelValues(seriesLabels, HostIdLabelKeys),
      hostNames: this.collectLabelValues(seriesLabels, HostNameLabelKeys),
      dockerHostIds: this.collectLabelValues(
        seriesLabels,
        DockerHostIdLabelKeys,
      ),
      dockerHostNames: this.collectLabelValues(
        seriesLabels,
        DockerHostNameLabelKeys,
      ),
      kubernetesClusterIds: this.collectLabelValues(
        seriesLabels,
        KubernetesClusterIdLabelKeys,
      ),
      kubernetesClusterNames: this.collectLabelValues(
        seriesLabels,
        KubernetesClusterNameLabelKeys,
      ),
      serviceIds: this.collectLabelValues(seriesLabels, ServiceIdLabelKeys),
      serviceNames: this.collectLabelValues(seriesLabels, ServiceNameLabelKeys),
    };
  }
}
