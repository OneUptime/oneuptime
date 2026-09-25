import Dictionary from "../../Types/Dictionary";
import MonitorType from "../../Types/Monitor/MonitorType";
import { getCephMetricByMetricName } from "../../Types/Monitor/CephMetricCatalog";
import { getDockerMetricByMetricName } from "../../Types/Monitor/DockerMetricCatalog";
import { getDockerSwarmMetricByMetricName } from "../../Types/Monitor/DockerSwarmMetricCatalog";
import { getHostMetricByMetricName } from "../../Types/Monitor/HostMetricCatalog";
import { getIoTMetricByMetricName } from "../../Types/Monitor/IotMetricCatalog";
import { getKubernetesMetricByMetricName } from "../../Types/Monitor/KubernetesMetricCatalog";
import { getPodmanMetricByMetricName } from "../../Types/Monitor/PodmanMetricCatalog";
import { getProxmoxMetricByMetricName } from "../../Types/Monitor/ProxmoxMetricCatalog";
import { getVMwareMetricByMetricName } from "../../Types/Monitor/VMwareMetricCatalog";

/*
 * The platforms that ship their own metric catalog. Each catalog names the
 * unit its metrics' stored values are in.
 */
export type MetricCatalogPlatform =
  | "kubernetes"
  | "proxmox"
  | "vmware"
  | "dockerSwarm"
  | "ceph"
  | "docker"
  | "podman"
  | "host"
  | "iot";

/*
 * What unit a platform monitor's metric values are in.
 *
 * Two sources can answer that, and they disagree often enough to matter:
 *
 *  - the unit the OpenTelemetry exporter DECLARED, stored on MetricType
 *    (k8s.node.allocatable_memory → "By");
 *  - the unit the platform's metric catalog SAYS the values are in
 *    (KubernetesMetricCatalog, DockerMetricCatalog, ...).
 *
 * The catalog wins. It was written against what each agent actually sends,
 * and the exporters are not always right about their own numbers:
 * docker_stats declares container.cpu.utilization and
 * container.memory.percent with the unit "1" but sends 0–100. Taking the
 * declared "1" would render 85.3 as "8530.00%", and — worse — a threshold
 * typed in "%" would convert every sample ×100 and fire forever. kubeletstats
 * declares k8s.node.cpu.utilization as "1" but it is a cores gauge.
 *
 * The declared unit is the fallback for everything the catalog does not
 * know, which is how k8s.node.allocatable_memory reads "258 GB" instead of
 * "257760964608" even before it has a catalog entry.
 */
export default class PlatformMetricUnitUtil {
  /**
   * The catalog platform a monitor type reads its metrics from, or null for
   * monitor types without one (generic Metrics monitors keep the exporter's
   * declared unit).
   */
  public static getPlatformForMonitorType(
    monitorType: MonitorType | undefined,
  ): MetricCatalogPlatform | null {
    switch (monitorType) {
      case MonitorType.Kubernetes:
        return "kubernetes";
      case MonitorType.Proxmox:
        return "proxmox";
      case MonitorType.VMware:
        return "vmware";
      case MonitorType.DockerSwarm:
        return "dockerSwarm";
      case MonitorType.Ceph:
        return "ceph";
      case MonitorType.Docker:
        return "docker";
      case MonitorType.Podman:
        return "podman";
      case MonitorType.Host:
        return "host";
      case MonitorType.IoTDevice:
        return "iot";
      default:
        return null;
    }
  }

  /**
   * The unit the platform's catalog declares for a metric, exactly as the
   * catalog spells it ("bytes", "cores", "ratio", "count", "%"), or
   * undefined when the catalog does not know the metric or gives it no
   * unit.
   */
  public static getCatalogUnit(input: {
    platform: MetricCatalogPlatform;
    metricName: string;
  }): string | undefined {
    const unit: string | undefined = PlatformMetricUnitUtil.lookupCatalogUnit(
      input.platform,
      input.metricName,
    );

    return unit && unit.trim() ? unit.trim() : undefined;
  }

  /**
   * The unit a platform metric's values are in, spelled so the rest of the
   * pipeline can convert it: the catalog unit when the catalog has a real
   * one, else the exporter-declared unit, else undefined.
   *
   * The catalogs spell two dimensionless concepts in English. "ratio" (and
   * "fraction") becomes UCUM's "1", which MetricUnitUtil can convert to a
   * "%" threshold and MetricValueFormatter renders as a percentage.
   * "count" names no dimension at all, so it defers to the declared unit
   * ("{restart}", which renders bare the same way) instead of hiding it.
   */
  public static getMetricUnit(input: {
    platform: MetricCatalogPlatform | null;
    metricName: string;
    declaredUnit?: string | null | undefined;
  }): string | undefined {
    const catalogUnit: string | undefined = input.platform
      ? PlatformMetricUnitUtil.toConvertibleUnit(
          PlatformMetricUnitUtil.getCatalogUnit({
            platform: input.platform,
            metricName: input.metricName,
          }),
        )
      : undefined;

    if (catalogUnit) {
      return catalogUnit;
    }

    const declaredUnit: string = (input.declaredUnit || "").trim();

    return declaredUnit || undefined;
  }

  /**
   * The unit map a platform monitor hands the criteria evaluator: one entry
   * per metric name, keyed lowercased like MetricMonitorResponse's
   * `nativeUnitsByMetricName`, holding getMetricUnit's answer. Metrics with
   * no known unit are left out rather than mapped to "".
   */
  public static buildUnitsByMetricName(input: {
    platform: MetricCatalogPlatform | null;
    metricNames: Array<string>;
    declaredUnitsByMetricName: Map<string, string>;
  }): Dictionary<string> {
    const unitsByMetricName: Dictionary<string> = {};

    for (const metricName of input.metricNames) {
      if (!metricName) {
        continue;
      }

      const unit: string | undefined = PlatformMetricUnitUtil.getMetricUnit({
        platform: input.platform,
        metricName: metricName,
        declaredUnit: input.declaredUnitsByMetricName.get(
          metricName.toLowerCase(),
        ),
      });

      if (unit) {
        unitsByMetricName[metricName.toLowerCase()] = unit;
      }
    }

    return unitsByMetricName;
  }

  private static toConvertibleUnit(
    unit: string | undefined,
  ): string | undefined {
    if (!unit) {
      return undefined;
    }

    switch (unit.toLowerCase()) {
      case "ratio":
      case "fraction":
        return "1";
      case "count":
      case "counts":
        return undefined;
      default:
        return unit;
    }
  }

  private static lookupCatalogUnit(
    platform: MetricCatalogPlatform,
    metricName: string,
  ): string | undefined {
    switch (platform) {
      case "kubernetes":
        return getKubernetesMetricByMetricName(metricName)?.unit;
      case "proxmox":
        return getProxmoxMetricByMetricName(metricName)?.unit;
      case "vmware":
        return getVMwareMetricByMetricName(metricName)?.unit;
      case "dockerSwarm":
        return getDockerSwarmMetricByMetricName(metricName)?.unit;
      case "ceph":
        return getCephMetricByMetricName(metricName)?.unit;
      case "docker":
        return getDockerMetricByMetricName(metricName)?.unit;
      case "podman":
        return getPodmanMetricByMetricName(metricName)?.unit;
      case "host":
        return getHostMetricByMetricName(metricName)?.unit;
      case "iot":
        return getIoTMetricByMetricName(metricName)?.unit;
      default:
        return undefined;
    }
  }
}
