import VMwareResource from "../../../Models/DatabaseModels/VMwareResource";
import VMwareSource from "../../../Models/DatabaseModels/VMwareSource";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import { JSONObject } from "../../../Types/JSON";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricSeriesResult from "../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorStepVmwareMonitor, {
  MonitorStepVmwareMonitorUtil,
  VMWARE_RESOURCE_ATTRIBUTE,
  VMWARE_RESOURCE_TYPE_ATTRIBUTE,
  VMWARE_SOURCE_ATTRIBUTE,
} from "../../../Types/Monitor/MonitorStepVmwareMonitor";
import MetricSeriesFingerprint from "../../../Utils/Metrics/MetricSeriesFingerprint";

export interface VmwareSeriesResult {
  series: Array<MetricSeriesResult>;
  unavailableSeriesFingerprints: Array<string>;
}

/** Policy layer for VMware snapshots. Missing telemetry cannot affirm recovery. */
export default class VmwareMonitorSeries {
  public static isSourceFresh(source: VMwareSource, now: Date): boolean {
    const interval: number = Math.max(
      30,
      source.collectionIntervalSeconds || 120,
    );
    const timestamp: Date | undefined = source.lastCollectionAt;
    return Boolean(
      timestamp &&
        new Date(timestamp).getTime() >= now.getTime() - interval * 3 * 1000 &&
        new Date(timestamp).getTime() <= now.getTime() + 60000,
    );
  }

  public static labels(source: string, resource: VMwareResource): JSONObject {
    return {
      [VMWARE_SOURCE_ATTRIBUTE]: source,
      [VMWARE_RESOURCE_TYPE_ATTRIBUTE]: resource.resourceType || "",
      [VMWARE_RESOURCE_ATTRIBUTE]: resource.resourceIdentifier || "",
    };
  }

  public static apply(input: {
    config: MonitorStepVmwareMonitor;
    source: VMwareSource;
    resources: Array<VMwareResource>;
    series: Array<MetricSeriesResult>;
    now: Date;
  }): VmwareSeriesResult {
    const sourceMonitor: boolean = MonitorStepVmwareMonitorUtil.isSourceMonitor(
      input.config,
    );
    if (sourceMonitor) {
      const labels: JSONObject = {
        [VMWARE_SOURCE_ATTRIBUTE]: input.config.sourceIdentifier,
      };
      const fingerprint: string =
        MetricSeriesFingerprint.computeFingerprint(labels);
      const available: boolean = this.isSourceFresh(input.source, input.now);
      const series: MetricSeriesResult = {
        labels,
        fingerprint,
        aggregatedResults: input.config.metricViewConfig.queryConfigs.map(
          (query: MetricQueryConfigData, index: number): AggregatedResult => {
            const rawName: unknown =
              query.metricQueryData.filterData.metricName;
            const name: string = typeof rawName === "string" ? rawName : "";
            if (
              !available ||
              typeof input.source.metrics?.[name] !== "number"
            ) {
              return { data: [] };
            }
            const rows: AggregatedResult | undefined =
              input.series[0]?.aggregatedResults[index];
            if (rows?.data.length) {
              return rows;
            }
            /*
             * Collection intervals may be longer than the metric query window.
             * The source freshness budget remains the authority between polls.
             */
            return {
              data: [
                {
                  timestamp: input.source.lastCollectionAt!,
                  value: input.source.metrics![name] as number,
                  attributes: labels,
                },
              ],
            };
          },
        ),
      };
      return { series: [series], unavailableSeriesFingerprints: [] };
    }
    const sourceHealthy: boolean =
      this.isSourceFresh(input.source, input.now) &&
      input.source.metrics?.["oneuptime.vmware.source.up"] === 1 &&
      input.source.metrics?.["oneuptime.vmware.source.inventory.complete"] ===
        1;
    const interval: number = Math.max(
      30,
      input.source.collectionIntervalSeconds || 120,
    );
    const existing: Map<string, MetricSeriesResult> = new Map(
      input.series.map((series: MetricSeriesResult) => {
        return [series.fingerprint, series];
      }),
    );
    const result: VmwareSeriesResult = {
      series: [],
      unavailableSeriesFingerprints: [],
    };
    for (const resource of input.resources) {
      if (
        resource.isArchived ||
        resource.metadata?.["oneuptime.vmware.resource.retired"] === true ||
        resource.metrics?.["oneuptime.vmware.resource.retired"] === 1 ||
        (input.config.resourceFilters.resourceType &&
          resource.resourceType !==
            input.config.resourceFilters.resourceType) ||
        (input.config.resourceFilters.resourceIdentifier &&
          resource.resourceIdentifier !==
            input.config.resourceFilters.resourceIdentifier)
      ) {
        continue;
      }
      const labels: JSONObject = this.labels(
        input.config.sourceIdentifier,
        resource,
      );
      const fingerprint: string =
        MetricSeriesFingerprint.computeFingerprint(labels);
      /*
       * Reconstruct only the selected inventory. A datapoint-only filter that
       * inventory cannot verify must not synthesize absence for unrelated VMs.
       */
      const selected: boolean =
        input.config.metricViewConfig.queryConfigs.every(
          (query: MetricQueryConfigData) => {
            return Object.entries(
              query.metricQueryData.filterData.attributes || {},
            ).every(([key, value]: [string, unknown]) => {
              /*
               * These filters are rebuilt from the authoritative selection before SQL
               * evaluation; older saved attributes must not override that selection.
               */
              if (
                [
                  VMWARE_SOURCE_ATTRIBUTE,
                  VMWARE_RESOURCE_TYPE_ATTRIBUTE,
                  VMWARE_RESOURCE_ATTRIBUTE,
                ].includes(key)
              ) {
                return true;
              }
              const actual: unknown =
                resource.metadata?.[key.replace(/^resource\./, "")];
              return actual !== undefined
                ? String(actual) === String(value)
                : existing.has(fingerprint);
            });
          },
        );
      if (!selected) {
        continue;
      }
      const reportedAt: number = resource.lastReportedAt
        ? new Date(resource.lastReportedAt).getTime()
        : 0;
      const reportFresh: boolean =
        reportedAt >= input.now.getTime() - interval * 3 * 1000 &&
        reportedAt <= input.now.getTime() + 60000;
      const metrics: JSONObject = resource.metrics || {};
      const inMaintenance: boolean =
        resource.maintenanceMode ??
        metrics["oneuptime.vmware.host.maintenance"] === 1;
      const current: MetricSeriesResult | undefined = existing.get(fingerprint);
      let unavailable: boolean = !sourceHealthy || inMaintenance;
      const series: MetricSeriesResult = {
        labels,
        fingerprint,
        aggregatedResults: input.config.metricViewConfig.queryConfigs.map(
          (query: MetricQueryConfigData, index: number): AggregatedResult => {
            const rawName: unknown =
              query.metricQueryData.filterData.metricName;
            const name: string = typeof rawName === "string" ? rawName : "";
            const rows: AggregatedResult = current?.aggregatedResults[
              index
            ] || { data: [] };
            if (!sourceHealthy || inMaintenance) {
              return { data: [] };
            }
            /*
             * An explicit missing observation from a current collection is evidence
             * of disappearance. A delayed resource batch is only unknown.
             */
            if (
              name === "oneuptime.vmware.resource.observed" &&
              reportFresh &&
              metrics[name] === 0
            ) {
              return {
                data: [{ timestamp: input.now, value: 0, attributes: labels }],
              };
            }
            if (
              !reportFresh ||
              metrics["oneuptime.vmware.resource.observed"] !== 1
            ) {
              unavailable = true;
              return { data: [] };
            }
            if (
              (name.endsWith("resource.state") ||
                name.endsWith("resource.power_state") ||
                name.endsWith("resource.connection_state")) &&
              metrics[name] === 0
            ) {
              unavailable = true;
              return { data: [] };
            }
            if (
              name === "oneuptime.vmware.vm.unexpected_power_off" &&
              resource.expectedRunning !== null &&
              resource.expectedRunning !== undefined
            ) {
              const power: unknown =
                metrics["oneuptime.vmware.resource.power_state"];
              if (typeof power !== "number" || power === 0) {
                unavailable = true;
                return { data: [] };
              }
              return {
                data: [
                  {
                    timestamp: input.now,
                    value: resource.expectedRunning && power !== 1 ? 1 : 0,
                    attributes: labels,
                  },
                ],
              };
            }
            if (
              name === "oneuptime.vmware.host.unavailable" &&
              resource.maintenanceMode === false
            ) {
              const connection: unknown =
                metrics["oneuptime.vmware.resource.connection_state"];
              if (typeof connection !== "number" || connection === 0) {
                unavailable = true;
                return { data: [] };
              }
              return {
                data: [
                  {
                    timestamp: input.now,
                    value: connection === 1 ? 0 : 1,
                    attributes: labels,
                  },
                ],
              };
            }
            /*
             * A retained historical sample cannot substitute for a signal omitted
             * from the latest authoritative snapshot (for example a powered-off VM).
             */
            if (typeof metrics[name] !== "number") {
              unavailable = true;
              return { data: [] };
            }
            if (rows.data.length === 0) {
              unavailable = true;
            }
            return rows;
          },
        ),
      };
      if (unavailable) {
        result.unavailableSeriesFingerprints.push(fingerprint);
      }
      /*
       * An entirely unavailable source/resource is omitted from evaluation,
       * including custom NoDataPolicy.Trigger, to prevent a fleet-wide incident
       * storm. Its existing incidents remain open through the explicit guard.
       */
      if (sourceHealthy && !inMaintenance) {
        result.series.push(series);
      }
    }
    /*
     * Series that raced ahead of inventory ingest are held unknown rather than
     * evaluated without lifecycle/policy information. Never drop their guards.
     */
    const known: Set<string> = new Set(
      input.resources.map((resource: VMwareResource) => {
        return MetricSeriesFingerprint.computeFingerprint(
          this.labels(input.config.sourceIdentifier, resource),
        );
      }),
    );
    for (const series of input.series) {
      if (!known.has(series.fingerprint)) {
        result.unavailableSeriesFingerprints.push(series.fingerprint);
      }
    }
    return result;
  }
}
