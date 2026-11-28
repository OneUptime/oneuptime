import MetricType from "../../../Models/DatabaseModels/MetricType";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import { VMwareResourceKind } from "../../../Types/Monitor/MonitorStepVMwareMonitor";
import ObjectID from "../../../Types/ObjectID";
import {
  VMWARE_SWAP_RATE_METRICS,
  VMWARE_SWAP_RATE_METRIC_UNIT,
  VMWARE_SWAP_RATE_SOURCE_ATTRIBUTE,
  VMWARE_SWAP_RATE_SOURCE_VALUES,
  VMwareSwapRateMetric,
  getVMwareSwapRateMetricDescription,
} from "../../../Types/VMware/VMwareSwapRates";
import { TelemetryServiceMetadata } from "../../Services/OpenTelemetryIngestService";
import { VMwareResourceSwapRateReading } from "../../Services/VMwareResourceService";
import TelemetryUtil, { AttributeType } from "./Telemetry";
import {
  VMwareResourceIdentity,
  resolveVMwareResourceIdentity,
} from "./VMwareSnapshotScan";

/*
 * THE SWAP RATES ONEUPTIME WRITES FROM A VCENTER'S REPORTS (#11468).
 *
 * The VMware flush leaves on each VM's and resource pool's row the swap
 * rates it judges by: vSphere's own counters where a probe sent them, else
 * worked out from the swapped amount (VMwareResourceService). The VM Memory
 * Swapping alert template has to read the same rate, whichever collector a
 * vCenter has, and an alert template reads metrics, not rows. So the flush
 * writes them as OneUptime's own metrics (VMwareSwapRateMetric), one point
 * per part and direction at the report's time, with a `source` datapoint
 * attribute that says which it is.
 *
 * Each point is stored exactly as the part's own metrics are: under the
 * resource block's attributes (resource.vmware.vcenter.name, which every
 * VMware monitor scopes on, and resource.vcenter.vm.name, which its
 * templates group by) and its resource (its primary entity, entity keys and
 * retention). The ingest loop remembers those per part as it reads the
 * blocks (rememberRowContext); a part whose block it did not read this
 * batch gets no point.
 *
 * Pure but for registerCatalog, so the points are unit-testable.
 */

// What a VM's or resource pool's own metrics are stored under.
export interface VMwareSwapRateRowContext {
  baseAttributes: Dictionary<AttributeType | Array<AttributeType>>;
  serviceMetadata: TelemetryServiceMetadata;
}

// One point to write, as an OTLP Gauge datapoint and what it is stored under.
export interface VMwareSwapRatePoint {
  metricName: VMwareSwapRateMetric;
  datapoint: JSONObject;
  context: VMwareSwapRateRowContext;
}

function contextKey(kind: string, externalId: string): string {
  return `${kind}|${externalId}`;
}

// Unix nanoseconds, as the string OTLP/JSON writes a fixed64.
function toUnixNanoString(date: Date): string {
  return (BigInt(date.getTime()) * BigInt(1_000_000)).toString();
}

export default class VMwareSwapRateMetrics {
  // Projects whose catalog this process has written the metrics into.
  private static registeredProjects: Set<string> = new Set<string>();

  // For tests: forget which catalogs were written.
  public static forgetRegisteredCatalogs(): void {
    this.registeredProjects.clear();
  }

  /*
   * Remember what a VM's or a resource pool's metrics are stored under, the
   * first block of it in the batch. Any other part, a VM template (it never
   * swaps) and a block with no vSphere identity are left out.
   */
  public static rememberRowContext(data: {
    contexts: Map<string, Map<string, VMwareSwapRateRowContext>>;
    vcenterIdStr: string;
    vmwareResourceAttributes: Record<string, unknown>;
    context: VMwareSwapRateRowContext;
  }): void {
    const identity: VMwareResourceIdentity | null =
      resolveVMwareResourceIdentity(data.vmwareResourceAttributes);

    if (
      !identity ||
      identity.isTemplate === true ||
      (identity.kind !== VMwareResourceKind.VirtualMachine &&
        identity.kind !== VMwareResourceKind.ResourcePool)
    ) {
      return;
    }

    let perVCenter: Map<string, VMwareSwapRateRowContext> | undefined =
      data.contexts.get(data.vcenterIdStr);

    if (!perVCenter) {
      perVCenter = new Map();
      data.contexts.set(data.vcenterIdStr, perVCenter);
    }

    const key: string = contextKey(identity.kind, identity.externalId);

    if (!perVCenter.has(key)) {
      perVCenter.set(key, data.context);
    }
  }

  // The metric a part's rate in one direction is written as.
  public static getMetricName(
    kind: string,
    direction: "out" | "in",
  ): VMwareSwapRateMetric | null {
    if (kind === VMwareResourceKind.VirtualMachine) {
      return direction === "out"
        ? VMwareSwapRateMetric.VirtualMachineSwapOut
        : VMwareSwapRateMetric.VirtualMachineSwapIn;
    }
    if (kind === VMwareResourceKind.ResourcePool) {
      return direction === "out"
        ? VMwareSwapRateMetric.ResourcePoolSwapOut
        : VMwareSwapRateMetric.ResourcePoolSwapIn;
    }
    return null;
  }

  /*
   * The points to write for what the flush left on the rows: a known rate
   * of a part whose block this batch read, in either direction. A rate the
   * row does not know (one direction of vSphere's counters missing) is no
   * point.
   */
  public static getPoints(data: {
    readings: Array<VMwareResourceSwapRateReading>;
    contexts: Map<string, VMwareSwapRateRowContext>;
  }): Array<VMwareSwapRatePoint> {
    const points: Array<VMwareSwapRatePoint> = [];

    for (const reading of data.readings) {
      const context: VMwareSwapRateRowContext | undefined = data.contexts.get(
        contextKey(reading.kind, reading.externalId),
      );

      if (!context) {
        continue;
      }

      const directions: Array<{
        direction: "out" | "in";
        value: number | null;
      }> = [
        { direction: "out", value: reading.swapOutBytesPerSecond },
        { direction: "in", value: reading.swapInBytesPerSecond },
      ];

      for (const each of directions) {
        const metricName: VMwareSwapRateMetric | null = this.getMetricName(
          reading.kind,
          each.direction,
        );

        if (
          !metricName ||
          each.value === null ||
          !Number.isFinite(each.value) ||
          each.value < 0
        ) {
          continue;
        }

        points.push({
          metricName,
          context,
          datapoint: {
            timeUnixNano: toUnixNanoString(reading.observedAt),
            asDouble: each.value,
            attributes: [
              {
                key: VMWARE_SWAP_RATE_SOURCE_ATTRIBUTE,
                value: {
                  stringValue: VMWARE_SWAP_RATE_SOURCE_VALUES[reading.source],
                },
              },
            ],
          },
        });
      }
    }

    return points;
  }

  // The catalog entries: what each metric is, and its unit.
  public static getCatalog(): Dictionary<MetricType> {
    const catalog: Dictionary<MetricType> = {};

    for (const metric of VMWARE_SWAP_RATE_METRICS) {
      const metricType: MetricType = new MetricType();
      metricType.name = metric;
      metricType.description = getVMwareSwapRateMetricDescription(metric);
      metricType.unit = VMWARE_SWAP_RATE_METRIC_UNIT;
      catalog[metric] = metricType;
    }

    return catalog;
  }

  /*
   * Put the metrics in the project's metric catalog, so the Metrics explorer,
   * dashboards and monitors list them by name with their unit. Once a
   * process for each project.
   */
  public static async registerCatalog(projectId: ObjectID): Promise<void> {
    const key: string = projectId.toString();

    if (this.registeredProjects.has(key)) {
      return;
    }

    await TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: projectId,
      metricNameServiceNameMap: this.getCatalog(),
    });

    this.registeredProjects.add(key);
  }
}
