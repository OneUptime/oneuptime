import StorageArrayOtlpResource from "../../StorageArrayOtlp";
import {
  MB,
  PowerMaxAlert,
  PowerMaxArrayReading,
  PowerMaxDirector,
  PowerMaxPort,
  PowerMaxSrdfGroup,
  PowerMaxSrp,
  PowerMaxStorageGroup,
  PowerMaxVolume,
  getInstances,
  getSrdfGroupProblem,
  getWorstSrdfState,
  readPortInstanceId,
} from "./PowerMaxReading";
import { UnispherePerformanceInstance } from "./UnisphereClient";
import StorageArrayResourceKind from "Common/Types/StorageArray/StorageArrayResourceKind";
import {
  POWERMAX_ENDPOINTS,
  POWERMAX_LABELS,
  POWERMAX_METRICS,
  POWERMAX_OPERATIONS,
  POWERMAX_PERFORMANCE_CATEGORIES,
  POWERMAX_PORT_KIND,
  POWERMAX_SYMMETRIX_ID_ATTRIBUTE,
  PowerMaxKind,
} from "Common/Types/StorageArray/Platforms/Dell/PowerMax/PowerMaxSeries";

/*
 * One PowerMax reading (PowerMaxReading) as the platform's series
 * (PowerMaxSeries, which the extractor reads with the same names): one
 * OTLP resource per array, named by its Symmetrix ID, every object's
 * labels on its datapoints.
 *
 * Unisphere's milliseconds become microseconds and its MB per second bytes
 * per second here, so every storage platform charts and alerts in one set
 * of units. A kind the collection read in full gets an "inventory listed"
 * series (POWERMAX_METRICS.inventoryListed) naming its endpoint, so its
 * count is written even at 0; a kind it could not read gets none, and keeps
 * its count.
 */

const M: typeof POWERMAX_METRICS = POWERMAX_METRICS;
const L: typeof POWERMAX_LABELS = POWERMAX_LABELS;
const CATEGORY: typeof POWERMAX_PERFORMANCE_CATEGORIES =
  POWERMAX_PERFORMANCE_CATEGORIES;

const USEC_PER_MS: number = 1000;

function usec(value: number | undefined): number | null {
  return typeof value === "number" && value >= 0 ? value * USEC_PER_MS : null;
}

function bytesPerSec(value: number | undefined): number | null {
  return typeof value === "number" && value >= 0 ? value * MB : null;
}

function byId(
  instances: Array<UnispherePerformanceInstance>,
): Map<string, UnispherePerformanceInstance> {
  const map: Map<string, UnispherePerformanceInstance> = new Map();
  for (const instance of instances) {
    map.set(instance.id, instance);
  }
  return map;
}

function portInstances(
  reading: PowerMaxArrayReading,
): Map<string, UnispherePerformanceInstance> {
  const map: Map<string, UnispherePerformanceInstance> = new Map();
  for (const category of [
    CATEGORY.frontEndPort,
    CATEGORY.backEndPort,
    CATEGORY.srdfPort,
  ]) {
    for (const instance of getInstances(reading, category)) {
      const id: string | null = readPortInstanceId(instance.id);
      if (id) {
        map.set(id, instance);
      }
    }
  }
  return map;
}

export default class PowerMaxOtlpBuilder {
  public static build(data: {
    reading: PowerMaxArrayReading;
    unisphereVersion: string;
    timeMs: number;
  }): StorageArrayOtlpResource {
    const reading: PowerMaxArrayReading = data.reading;
    const resource: StorageArrayOtlpResource = new StorageArrayOtlpResource({
      resourceAttributes: {
        [POWERMAX_SYMMETRIX_ID_ATTRIBUTE]: reading.symmetrixId,
      },
      timeMs: data.timeMs,
    });

    PowerMaxOtlpBuilder.writeArray(resource, reading, data.unisphereVersion);
    PowerMaxOtlpBuilder.writeAlerts(resource, reading);
    PowerMaxOtlpBuilder.writeStorageGroups(resource, reading);
    PowerMaxOtlpBuilder.writeVolumes(resource, reading);
    PowerMaxOtlpBuilder.writeSrps(resource, reading);
    PowerMaxOtlpBuilder.writeDirectors(resource, reading);
    PowerMaxOtlpBuilder.writePorts(resource, reading);
    PowerMaxOtlpBuilder.writeSrdfGroups(resource, reading);

    return resource;
  }

  private static listed(
    resource: StorageArrayOtlpResource,
    endpoint: string,
    count: number,
  ): void {
    resource.gauge(M.inventoryListed, count, { [L.scrapeEndpoint]: endpoint });
  }

  private static writeArray(
    resource: StorageArrayOtlpResource,
    reading: PowerMaxArrayReading,
    unisphereVersion: string,
  ): void {
    resource.gauge(M.arrayInfo, 1, {
      [L.symmetrixId]: reading.symmetrixId,
      [L.model]: reading.model || "",
      [L.microcode]: reading.microcode || "",
      [L.unisphereVersion]: unisphereVersion,
    });

    const capacity: PowerMaxArrayReading["capacity"] = reading.capacity;
    if (capacity) {
      // Usable first: the extractor derives the free space from it.
      resource.gauge(M.arrayUsableBytes, capacity.usableBytes);
      resource.gauge(M.arrayUsedBytes, capacity.usedBytes);
      if (
        capacity.usableBytes !== null &&
        capacity.usableBytes > 0 &&
        capacity.usedBytes !== null
      ) {
        resource.gauge(
          M.arrayUsedPercent,
          Math.min(100, (capacity.usedBytes / capacity.usableBytes) * 100),
        );
      }
      resource.gauge(M.arraySubscribedBytes, capacity.subscribedBytes);
      resource.gauge(M.arrayDataReductionRatio, capacity.dataReductionRatio);
    }

    for (const score of reading.healthScores) {
      resource.gauge(M.arrayHealthScore, score.score, {
        [L.healthMetric]: score.metric,
      });
    }

    if (reading.registration.diagnostic !== null) {
      resource.gauge(
        M.arrayPerformanceCollection,
        reading.registration.diagnostic ? 1 : 0,
        {
          [L.realtime]: reading.registration.realtime ? "true" : "false",
        },
      );
    }

    const array: UnispherePerformanceInstance | undefined =
      getInstances(reading, CATEGORY.array).find(
        (instance: UnispherePerformanceInstance): boolean => {
          return instance.id === reading.symmetrixId;
        },
      ) || getInstances(reading, CATEGORY.array)[0];

    if (array) {
      const at: number | undefined = array.timestampMs ?? undefined;
      const m: Record<string, number> = array.metrics;
      const iops: number | undefined = m["HostIOs"];
      const mbs: number | undefined = m["HostMBs"];
      const readShare: number | null =
        typeof m["PercentReads"] === "number" ? m["PercentReads"] / 100 : null;
      const writeShare: number | null =
        typeof m["PercentWrites"] === "number"
          ? m["PercentWrites"] / 100
          : readShare !== null
            ? 1 - readShare
            : null;

      resource.gauge(M.arrayIops, iops, {}, at);
      resource.gauge(M.arrayThroughput, bytesPerSec(mbs), {}, at);
      if (readShare !== null && typeof iops === "number") {
        resource.gauge(M.arrayReadIops, iops * readShare, {}, at);
      }
      if (writeShare !== null && typeof iops === "number") {
        resource.gauge(M.arrayWriteIops, iops * writeShare, {}, at);
      }
      if (readShare !== null && typeof mbs === "number") {
        resource.gauge(M.arrayReadThroughput, mbs * readShare * MB, {}, at);
      }
      if (writeShare !== null && typeof mbs === "number") {
        resource.gauge(M.arrayWriteThroughput, mbs * writeShare * MB, {}, at);
      }
      resource.gauge(
        M.arrayResponseTime,
        usec(m["ReadResponseTime"]),
        { [L.operation]: POWERMAX_OPERATIONS.read },
        at,
      );
      resource.gauge(
        M.arrayResponseTime,
        usec(m["WriteResponseTime"]),
        { [L.operation]: POWERMAX_OPERATIONS.write },
        at,
      );
      resource.gauge(M.arrayCacheHitPercent, m["PercentHit"], {}, at);
      resource.gauge(M.arrayWritePendingPercent, m["PercentCacheWP"], {}, at);
      resource.gauge(M.arrayFrontEndBusyPercent, m["FEUtilization"], {}, at);
      resource.gauge(M.arrayBackEndBusyPercent, m["BEUtilization"], {}, at);
      resource.gauge(M.arraySrdfBusyPercent, m["RDFUtilization"], {}, at);
    }
  }

  private static writeAlerts(
    resource: StorageArrayOtlpResource,
    reading: PowerMaxArrayReading,
  ): void {
    if (!reading.alerts) {
      return;
    }
    // The alerts were read in full: an array with none still says so.
    PowerMaxOtlpBuilder.listed(
      resource,
      POWERMAX_ENDPOINTS.array,
      reading.alerts.length,
    );
    for (const alert of reading.alerts) {
      PowerMaxOtlpBuilder.writeAlert(resource, alert);
    }
  }

  private static writeAlert(
    resource: StorageArrayOtlpResource,
    alert: PowerMaxAlert,
  ): void {
    resource.gauge(M.alertOpen, 1, {
      [L.alertId]: alert.id,
      [L.severity]: alert.severity,
      [L.alertType]: alert.type || "",
      [L.object]: alert.object || "",
      [L.objectType]: alert.objectType || "",
      [L.description]: alert.description,
      [L.created]:
        alert.createdMs !== null ? new Date(alert.createdMs).toISOString() : "",
    });
  }

  private static writeStorageGroups(
    resource: StorageArrayOtlpResource,
    reading: PowerMaxArrayReading,
  ): void {
    const groups: Array<PowerMaxStorageGroup> | null = reading.storageGroups;
    const perf: Map<string, UnispherePerformanceInstance> = byId(
      getInstances(reading, CATEGORY.storageGroup),
    );

    if (groups) {
      if (reading.totals[PowerMaxKind.StorageGroup] === undefined) {
        PowerMaxOtlpBuilder.listed(
          resource,
          POWERMAX_ENDPOINTS.storageGroups,
          groups.length,
        );
      }
      for (const group of groups) {
        const labels: Record<string, string> = { [L.storageGroup]: group.id };
        const state: string | null = getWorstSrdfState(group.srdfStates);
        resource.gauge(M.storageGroupInfo, 1, {
          ...labels,
          [L.storageGroupType]: group.type || "",
          [L.srp]: group.srp || "",
          [L.serviceLevel]: group.serviceLevel || "",
          [L.realtime]: group.isRealtime ? "true" : "false",
          [L.state]: state || "",
          [L.mode]: group.srdfModes.join(", "),
        });
        resource.gauge(
          M.storageGroupCapacityBytes,
          group.capacityBytes,
          labels,
        );
        resource.gauge(M.storageGroupUsedBytes, group.usedBytes, labels);
        resource.gauge(M.storageGroupVolumes, group.volumeCount, labels);
        resource.gauge(
          M.storageGroupDataReductionRatio,
          group.dataReductionRatio,
          labels,
        );
      }
    }

    // Performance for every group Unisphere measured, listed or not.
    for (const instance of perf.values()) {
      const labels: Record<string, string> = { [L.storageGroup]: instance.id };
      const at: number | undefined = instance.timestampMs ?? undefined;
      const m: Record<string, number> = instance.metrics;
      resource.gauge(
        M.storageGroupResponseTime,
        usec(m["ResponseTime"]),
        labels,
        at,
      );
      resource.gauge(
        M.storageGroupReadResponseTime,
        usec(m["ReadResponseTime"]),
        labels,
        at,
      );
      resource.gauge(
        M.storageGroupWriteResponseTime,
        usec(m["WriteResponseTime"]),
        labels,
        at,
      );
      resource.gauge(M.storageGroupIops, m["HostIOs"], labels, at);
      resource.gauge(M.storageGroupReadIops, m["HostReads"], labels, at);
      resource.gauge(M.storageGroupWriteIops, m["HostWrites"], labels, at);
      resource.gauge(
        M.storageGroupThroughput,
        bytesPerSec(m["HostMBs"]),
        labels,
        at,
      );
      resource.gauge(
        M.storageGroupReadThroughput,
        bytesPerSec(m["HostMBReads"]),
        labels,
        at,
      );
      resource.gauge(
        M.storageGroupWriteThroughput,
        bytesPerSec(m["HostMBWritten"]),
        labels,
        at,
      );
      resource.gauge(
        M.storageGroupCacheHitPercent,
        m["PercentHit"],
        labels,
        at,
      );
      resource.gauge(
        M.storageGroupHostIoLimitExceededPercent,
        m["HostIOLimitPercentTimeExceeded"],
        labels,
        at,
      );
    }

    // Every 5 seconds, for the groups registered for real time.
    for (const [groupId, points] of reading.realtimeStorageGroups) {
      const labels: Record<string, string> = { [L.storageGroup]: groupId };
      for (const point of points) {
        const m: Record<string, number> = point.metrics;
        const at: number = point.timestampMs;
        resource.gauge(
          M.storageGroupRealtimeResponseTime,
          usec(m["ResponseTime"]),
          labels,
          at,
        );
        resource.gauge(
          M.storageGroupRealtimeReadResponseTime,
          usec(m["ReadResponseTime"]),
          labels,
          at,
        );
        resource.gauge(
          M.storageGroupRealtimeWriteResponseTime,
          usec(m["WriteResponseTime"]),
          labels,
          at,
        );
        resource.gauge(M.storageGroupRealtimeIops, m["HostIOs"], labels, at);
        resource.gauge(
          M.storageGroupRealtimeThroughput,
          bytesPerSec(m["HostMBs"]),
          labels,
          at,
        );
      }
    }
  }

  private static writeVolumes(
    resource: StorageArrayOtlpResource,
    reading: PowerMaxArrayReading,
  ): void {
    const volumes: Array<PowerMaxVolume> | null = reading.volumes;
    if (volumes) {
      // A list cut at the probe's limit is not the complete list.
      if (reading.totals[StorageArrayResourceKind.Volume] === undefined) {
        PowerMaxOtlpBuilder.listed(
          resource,
          POWERMAX_ENDPOINTS.volumes,
          volumes.length,
        );
      }
      for (const volume of volumes) {
        const labels: Record<string, string> = { [L.volume]: volume.id };
        if (volume.identifier) {
          labels[L.volumeName] = volume.identifier;
        }
        resource.gauge(M.volumeInfo, 1, {
          ...labels,
          [L.storageGroup]: volume.storageGroup || "",
          [L.emulation]: volume.emulation || "",
          [L.status]: volume.status || "",
        });
        resource.gauge(M.volumeCapacityBytes, volume.capacityBytes, labels);
        resource.gauge(M.volumeUsedBytes, volume.usedBytes, labels);
      }
    }

    for (const [volumeId, point] of reading.volumePerformance) {
      const labels: Record<string, string> = { [L.volume]: volumeId };
      const m: Record<string, number> = point.metrics;
      const at: number = point.timestampMs;
      resource.gauge(M.volumeResponseTime, usec(m["ResponseTime"]), labels, at);
      resource.gauge(
        M.volumeReadResponseTime,
        usec(m["ReadResponseTime"]),
        labels,
        at,
      );
      resource.gauge(
        M.volumeWriteResponseTime,
        usec(m["WriteResponseTime"]),
        labels,
        at,
      );
      resource.gauge(M.volumeIops, m["HostIOs"], labels, at);
      resource.gauge(M.volumeThroughput, bytesPerSec(m["HostMBs"]), labels, at);
    }
  }

  private static writeSrps(
    resource: StorageArrayOtlpResource,
    reading: PowerMaxArrayReading,
  ): void {
    const srps: Array<PowerMaxSrp> | null = reading.srps;
    if (srps) {
      PowerMaxOtlpBuilder.listed(
        resource,
        POWERMAX_ENDPOINTS.srps,
        srps.length,
      );
      for (const srp of srps) {
        const labels: Record<string, string> = { [L.srp]: srp.id };
        resource.gauge(M.srpInfo, 1, {
          ...labels,
          [L.emulation]: srp.emulation || "",
        });
        resource.gauge(M.srpUsableBytes, srp.usableBytes, labels);
        resource.gauge(M.srpUsedBytes, srp.usedBytes, labels);
        if (
          srp.usableBytes !== null &&
          srp.usableBytes > 0 &&
          srp.usedBytes !== null
        ) {
          resource.gauge(
            M.srpUsedPercent,
            Math.min(100, (srp.usedBytes / srp.usableBytes) * 100),
            labels,
          );
        }
        resource.gauge(M.srpSubscribedBytes, srp.subscribedBytes, labels);
        resource.gauge(M.srpDataReductionRatio, srp.dataReductionRatio, labels);
      }
    }

    for (const instance of getInstances(reading, CATEGORY.srp)) {
      const labels: Record<string, string> = { [L.srp]: instance.id };
      const at: number | undefined = instance.timestampMs ?? undefined;
      const m: Record<string, number> = instance.metrics;
      resource.gauge(M.srpResponseTime, usec(m["ResponseTime"]), labels, at);
      resource.gauge(M.srpIops, m["HostIOs"], labels, at);
      resource.gauge(M.srpThroughput, bytesPerSec(m["HostMBs"]), labels, at);
    }
  }

  private static writeDirectors(
    resource: StorageArrayOtlpResource,
    reading: PowerMaxArrayReading,
  ): void {
    const directors: Array<PowerMaxDirector> | null = reading.directors;
    if (directors) {
      PowerMaxOtlpBuilder.listed(
        resource,
        POWERMAX_ENDPOINTS.directors,
        directors.length,
      );
      for (const director of directors) {
        const labels: Record<string, string> = {
          [L.director]: director.id,
          [L.component]: director.id,
          [L.role]: director.role,
        };
        resource.gauge(M.directorInfo, 1, {
          ...labels,
          [L.directorType]: director.type,
          [L.status]: director.status || "",
          [L.engine]: director.engine !== null ? String(director.engine) : "",
          [L.slot]: director.slot !== null ? String(director.slot) : "",
        });
        if (!director.isOnline) {
          resource.gauge(M.directorOffline, 1, {
            ...labels,
            [L.status]: director.status || "unknown",
          });
        }
      }
    }

    for (const category of [
      CATEGORY.frontEndDirector,
      CATEGORY.backEndDirector,
      CATEGORY.srdfDirector,
    ]) {
      for (const instance of getInstances(reading, category)) {
        const labels: Record<string, string> = {
          [L.director]: instance.id,
          [L.component]: instance.id,
        };
        const at: number | undefined = instance.timestampMs ?? undefined;
        const m: Record<string, number> = instance.metrics;
        resource.gauge(M.directorBusyPercent, m["PercentBusy"], labels, at);
        resource.gauge(M.directorIops, m["HostIOs"] ?? m["IOs"], labels, at);
        resource.gauge(
          M.directorThroughput,
          bytesPerSec(m["HostMBs"] ?? m["MBs"] ?? m["MBSentAndReceived"]),
          labels,
          at,
        );
        resource.gauge(
          M.directorReadResponseTime,
          usec(m["ReadResponseTime"]),
          labels,
          at,
        );
        resource.gauge(
          M.directorWriteResponseTime,
          usec(m["WriteResponseTime"]),
          labels,
          at,
        );
      }
    }
  }

  private static writePorts(
    resource: StorageArrayOtlpResource,
    reading: PowerMaxArrayReading,
  ): void {
    const ports: Array<PowerMaxPort> | null = reading.ports;
    if (ports) {
      PowerMaxOtlpBuilder.listed(
        resource,
        POWERMAX_ENDPOINTS.ports,
        ports.length,
      );
      for (const port of ports) {
        const labels: Record<string, string> = {
          [L.portId]: port.id,
          [L.component]: port.id,
          [L.director]: port.director,
          [L.port]: port.port,
        };
        resource.gauge(M.portInfo, 1, {
          ...labels,
          [L.protocol]: port.protocol,
          [L.portType]: port.type || "",
          [L.status]: port.status || "",
          [L.inUse]: port.isInUse ? "true" : "false",
        });
        if (port.isInUse && !port.isOnline) {
          resource.gauge(M.portOffline, 1, {
            ...labels,
            [L.protocol]: port.protocol,
            [L.status]: port.status || "unknown",
          });
        }
        if (port.speedGbps !== null && port.speedGbps > 0) {
          // Gb/s of line rate, as bytes per second.
          resource.gauge(
            M.portSpeedBytes,
            (port.speedGbps * 1_000_000_000) / 8,
            labels,
          );
        }
        resource.gauge(M.portRxPowerMilliwatts, port.rxPowerMilliwatts, labels);
        resource.gauge(M.portTxPowerMilliwatts, port.txPowerMilliwatts, labels);
      }
    }

    for (const [id, instance] of portInstances(reading)) {
      const [director, number] = id.split(":") as [string, string];
      const labels: Record<string, string> = {
        [L.portId]: id,
        [L.component]: id,
        [L.director]: director,
        [L.port]: number,
      };
      const at: number | undefined = instance.timestampMs ?? undefined;
      const m: Record<string, number> = instance.metrics;
      resource.gauge(M.portBusyPercent, m["PercentBusy"], labels, at);
      resource.gauge(M.portIops, m["IOs"], labels, at);
      resource.gauge(
        M.portReadThroughput,
        bytesPerSec(m["MBRead"]),
        labels,
        at,
      );
      resource.gauge(
        M.portWriteThroughput,
        bytesPerSec(m["MBWritten"]),
        labels,
        at,
      );
      resource.gauge(M.portResponseTime, usec(m["ResponseTime"]), labels, at);
    }
  }

  private static writeSrdfGroups(
    resource: StorageArrayOtlpResource,
    reading: PowerMaxArrayReading,
  ): void {
    const groups: Array<PowerMaxSrdfGroup> | null = reading.srdfGroups;
    if (groups) {
      PowerMaxOtlpBuilder.listed(
        resource,
        POWERMAX_ENDPOINTS.srdfGroups,
        groups.length,
      );
      for (const group of groups) {
        const labels: Record<string, string> = { [L.srdfGroup]: group.id };
        if (group.label) {
          labels[L.srdfLabel] = group.label;
        }
        const problem: string | null = getSrdfGroupProblem(group);
        const state: string | null = problem || getWorstSrdfState(group.states);
        resource.gauge(M.srdfGroupInfo, 1, {
          ...labels,
          [L.remoteSymmetrixId]: group.remoteSymmetrixId || "",
          [L.remoteSrdfGroup]: group.remoteGroup || "",
          [L.mode]: group.modes.join(", "),
          [L.state]: state || "",
        });
        if (problem) {
          resource.gauge(M.srdfGroupNotHealthy, 1, {
            ...labels,
            [L.state]: problem,
            [L.remoteSymmetrixId]: group.remoteSymmetrixId || "",
          });
        }
        resource.gauge(M.srdfGroupLagSeconds, group.lagSeconds, labels);
        resource.gauge(M.srdfGroupVolumes, group.volumeCount, labels);
        resource.gauge(M.srdfGroupCapacityBytes, group.capacityBytes, labels);
      }
    }

    // SRDF/A (RDFA) and SRDF/S (RDFS) performance, by group number.
    for (const instance of getInstances(reading, CATEGORY.srdfAsync)) {
      const labels: Record<string, string> = { [L.srdfGroup]: instance.id };
      const at: number | undefined = instance.timestampMs ?? undefined;
      const m: Record<string, number> = instance.metrics;
      resource.gauge(
        M.srdfGroupThroughput,
        bytesPerSec(m["RDF_R1_R2_MBs"]),
        labels,
        at,
      );
      resource.gauge(
        M.srdfGroupResponseTime,
        usec(m["RdfResponseTime"]),
        labels,
        at,
      );
      resource.gauge(
        M.srdfGroupCycleTimeSeconds,
        m["AvgCycleTime"],
        labels,
        at,
      );
    }
    for (const instance of getInstances(reading, CATEGORY.srdfSync)) {
      const labels: Record<string, string> = { [L.srdfGroup]: instance.id };
      const at: number | undefined = instance.timestampMs ?? undefined;
      const m: Record<string, number> = instance.metrics;
      resource.gauge(
        M.srdfGroupThroughput,
        bytesPerSec(m["HostMBWritten"] ?? m["HostMBs"]),
        labels,
        at,
      );
      resource.gauge(
        M.srdfGroupResponseTime,
        usec(m["RDFS_WriteResponseTime"] ?? m["WriteResponseTime"]),
        labels,
        at,
      );
    }
  }

  // The kinds counted in a summary, from a reading.
  public static getCounts(
    reading: PowerMaxArrayReading,
  ): Record<string, number> {
    const counts: Record<string, number> = {};
    const set: (kind: string, list: Array<unknown> | null) => void = (
      kind: string,
      list: Array<unknown> | null,
    ): void => {
      if (list) {
        counts[kind] = reading.totals[kind] ?? list.length;
      }
    };
    set(PowerMaxKind.StorageGroup, reading.storageGroups);
    set(StorageArrayResourceKind.Volume, reading.volumes);
    set(PowerMaxKind.StorageResourcePool, reading.srps);
    set(PowerMaxKind.Director, reading.directors);
    set(POWERMAX_PORT_KIND, reading.ports);
    set(PowerMaxKind.SrdfGroup, reading.srdfGroups);
    return counts;
  }
}
