import Dictionary from "Common/Types/Dictionary";
import {
  DictionaryEntryValue,
  formatDictionaryValueForDisplay,
} from "Common/UI/Components/Dictionary/DictionaryFilterOperator";
import { ActiveFilter } from "Common/UI/Components/LogsViewer/types";

/*
 * The read-only chips the logs viewer shows for the attribute filters its
 * host page pinned in `logQuery.attributes` (a resource detail page, a
 * dashboard log chart, the log monitor's criteria preview).
 */

/*
 * OTEL resource keys read as machine names in a chip. Give the ones resource
 * pages scope by the label a person would use — a Host page's logs tab pins
 * `resource.host.name`, which should read "Host: web-01", not
 * "resource.host.name: web-01".
 */
export const ATTRIBUTE_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  // Kubernetes (cluster, pod, container and workload detail pages).
  "resource.k8s.cluster.name": "Cluster",
  "resource.k8s.pod.name": "Pod",
  "resource.k8s.container.name": "Container",
  "resource.k8s.namespace.name": "Namespace",
  "resource.k8s.node.name": "Node",
  "resource.k8s.deployment.name": "Deployment",
  "resource.k8s.statefulset.name": "StatefulSet",
  "resource.k8s.daemonset.name": "DaemonSet",
  "resource.k8s.job.name": "Job",
  "resource.k8s.cronjob.name": "CronJob",
  // Hosts, Docker / Podman hosts and their containers.
  "resource.host.name": "Host",
  "resource.container.id": "Container",
  "resource.container.name": "Container",
  "resource.container.runtime": "Runtime",
  "resource.container.image.name": "Image",
  // Services and serverless functions.
  "resource.service.name": "Service",
  "resource.faas.name": "Function",
  // Cloud resources (CloudResourceTelemetryScope).
  "resource.cloud.platform": "Platform",
  "resource.cloud.account.id": "Account",
  "resource.cloud.region": "Region",
  // Infrastructure clusters.
  "resource.ceph.cluster.name": "Cluster",
  "resource.proxmox.cluster.name": "Cluster",
  "resource.docker.swarm.cluster.name": "Cluster",
  "resource.vmware.vcenter.name": "vCenter",
  "resource.iot.fleet.name": "Fleet",
  /*
   * Network device logs are scoped by the device's own id (see
   * Pages/NetworkDevice/View/Logs.tsx); the page overrides the value with
   * the device name, and this gives the key a readable label.
   */
  "networkDevice.id": "Network Device",
};

type GetAttributeDisplayNameFunction = (attributeKey: string) => string;

/**
 * The chip key for an attribute: its friendly label when it is one of the
 * resource keys pages scope by, else the attribute key itself.
 */
export const getAttributeDisplayName: GetAttributeDisplayNameFunction = (
  attributeKey: string,
): string => {
  if (
    Object.prototype.hasOwnProperty.call(ATTRIBUTE_DISPLAY_NAMES, attributeKey)
  ) {
    return ATTRIBUTE_DISPLAY_NAMES[attributeKey] as string;
  }

  return attributeKey;
};

export interface AttributeFilterChipDisplayOptions {
  /*
   * Display-only chip key per attribute key, e.g.
   * `{ "resource.host.name": "Host" }`. Wins over ATTRIBUTE_DISPLAY_NAMES.
   */
  displayKeys?: Record<string, string> | undefined;
  /*
   * Display-only chip value per attribute key. A host page scopes by a
   * machine identifier (`hostIdentifier`, `clusterIdentifier`, a device
   * UUID) because that is what the telemetry carries, but it already has
   * the friendly name loaded — this lets the chip show that name while the
   * filter keeps matching on the identifier.
   */
  displayValues?: Record<string, string> | undefined;
}

type BuildAttributeFilterChipsFunction = (
  attributes: Dictionary<DictionaryEntryValue> | undefined,
  options?: AttributeFilterChipDisplayOptions | undefined,
) => Array<ActiveFilter>;

type ReadOverrideFunction = (
  overrides: Record<string, string> | undefined,
  attributeKey: string,
) => string | undefined;

/*
 * Only an own, non-blank override counts: a page that has not loaded its
 * resource yet hands over "" and the chip should keep showing the real
 * value rather than an empty label.
 */
const readOverride: ReadOverrideFunction = (
  overrides: Record<string, string> | undefined,
  attributeKey: string,
): string | undefined => {
  if (
    !overrides ||
    !Object.prototype.hasOwnProperty.call(overrides, attributeKey)
  ) {
    return undefined;
  }

  const override: unknown = overrides[attributeKey];

  if (typeof override !== "string" || !override.trim()) {
    return undefined;
  }

  return override;
};

/**
 * Turn pinned attribute filters into read-only chips.
 *
 * The values are NOT all strings. An attribute filter row stores a bare
 * scalar only for the implicit `=`; every other operator stores an operator
 * instance (`Includes`, `Search`, `NotEqual`, ...) — see
 * `buildDictionaryValue`. Handing one of those to React as a child throws
 * "Objects are not valid as a React child (found: object with keys
 * {_values})", and since the log monitor's criteria modal renders this
 * preview inside itself, that error replaced the whole form with the generic
 * error card and left no way to reach Save. Every value goes through the
 * shared formatter so a chip is always text.
 *
 * `options` only changes what the chip SHOWS. `facetKey` and `value` stay
 * the attribute key and the formatted filter value, so removal keys, React
 * keys and anything reading the chip back still see the real filter.
 */
export const buildAttributeFilterChips: BuildAttributeFilterChipsFunction = (
  attributes: Dictionary<DictionaryEntryValue> | undefined,
  options?: AttributeFilterChipDisplayOptions | undefined,
): Array<ActiveFilter> => {
  if (!attributes) {
    return [];
  }

  const chips: Array<ActiveFilter> = [];

  for (const [attributeKey, attributeValue] of Object.entries(attributes)) {
    const text: string = formatDictionaryValueForDisplay(attributeValue);

    chips.push({
      facetKey: `attributes.${attributeKey}`,
      value: text,
      displayKey:
        readOverride(options?.displayKeys, attributeKey) ||
        getAttributeDisplayName(attributeKey),
      displayValue: readOverride(options?.displayValues, attributeKey) || text,
      readOnly: true,
    });
  }

  return chips;
};
