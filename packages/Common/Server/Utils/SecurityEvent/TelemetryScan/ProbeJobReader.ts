import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorProbe from "../../../../Models/DatabaseModels/MonitorProbe";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiscoveryScan from "../../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import { NetworkDeviceMonitoringMethodUtil } from "../../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "../../../../Types/ObjectID";
import {
  PROBE_JOB_MONITOR_TYPES,
  ProbeJob,
  ProbeJobRange,
  ProbeJobTarget,
  getDevicePollTarget,
  getDiscoveryScanRange,
  getMonitorTargets,
  isDiscoveryScanInWindow,
} from "../../../../Utils/SecurityEvent/TelemetryScan/ProbeJob";
import MonitorProbeService from "../../../Services/MonitorProbeService";
import MonitorService from "../../../Services/MonitorService";
import NetworkDeviceDiscoveryScanService from "../../../Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceService from "../../../Services/NetworkDeviceService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import DnsResolutionCache from "../../Monitor/DnsResolutionCache";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * WHAT A PROBE IS SET TO DO IN A PROJECT, read for one window of its
 * network flows (#10429; Utils/SecurityEvent/TelemetryScan/ProbeJob):
 *
 *   - the network devices it polls, as the poll claim hands them out
 *     (NetworkDeviceService.claimDevicesForPolling): polling on, an address
 *     to dial, not a device a monitor reports for;
 *   - the ranges of its discovery scans that swept while the window's flows
 *     were sent;
 *   - the monitors it checks: enabled for it (MonitorProbe), checked
 *     actively, of a type whose checks are told by a host and a port.
 *
 * Read as OneUptime, in bounded reads. What a read does not reach is not
 * the probe's work, and so is counted as anyone's traffic is: fail toward a
 * person. The DNS names among the destinations are resolved by OneUptime,
 * at most MAX_PROBE_JOB_NAMES_RESOLVED of them; a name that does not
 * resolve here still matches a flow the collecting probe named so.
 */

// The most of each kind of work read for one job.
export const MAX_PROBE_JOB_DEVICES: number = 50000;
export const MAX_PROBE_JOB_DISCOVERY_SCANS: number = 1000;
export const MAX_PROBE_JOB_MONITORS: number = 10000;

// Monitors read a page at a time, by their ids.
const MONITORS_READ_AT_ONCE: number = 500;

// The most names one job resolves, and how many at once.
export const MAX_PROBE_JOB_NAMES_RESOLVED: number = 100;
const NAMES_RESOLVED_AT_ONCE: number = 20;

const ROOT: { isRoot: true } = { isRoot: true };

export interface ProbeJobRead {
  projectId: ObjectID;
  // The probes whose work is read together: those that share an address.
  probeIds: Array<ObjectID>;
  // When the window's flows were sent.
  window: { from: Date; to: Date };
}

function idsOf(probeIds: Array<ObjectID>): Array<string> {
  return probeIds.map((probeId: ObjectID): string => {
    return probeId.toString();
  });
}

export default class ProbeJobReader {
  // Names resolved at most every five minutes, as the trap paths resolve devices.
  private static dnsCache: DnsResolutionCache = new DnsResolutionCache();

  // For tests: how names are resolved.
  public static setDnsCacheForTests(cache: DnsResolutionCache): void {
    this.dnsCache = cache;
  }

  @CaptureSpan()
  public static async read(data: ProbeJobRead): Promise<ProbeJob> {
    const job: ProbeJob = new ProbeJob();

    if (data.probeIds.length === 0) {
      return job;
    }

    const [devices, ranges, monitorTargets]: [
      Array<ProbeJobTarget>,
      Array<ProbeJobRange>,
      Array<ProbeJobTarget>,
    ] = await Promise.all([
      this.readDevices(data),
      this.readDiscoveryRanges(data),
      this.readMonitorTargets(data),
    ]);

    for (const target of [...devices, ...monitorTargets]) {
      job.addTarget(target);
    }

    for (const range of ranges) {
      job.addRange(range);
    }

    await this.resolveNames(job);

    return job;
  }

  // The network devices the probes poll.
  public static async readDevices(
    data: ProbeJobRead,
  ): Promise<Array<ProbeJobTarget>> {
    const devices: Array<NetworkDevice> = await NetworkDeviceService.findAllBy({
      query: {
        projectId: data.projectId,
        probeId: QueryHelper.any(idsOf(data.probeIds)) as never,
        isPollingEnabled: true,
        hostname: QueryHelper.notNull() as never,
      },
      select: {
        _id: true,
        hostname: true,
        snmpPort: true,
        monitoringMethod: true,
      },
      limit: MAX_PROBE_JOB_DEVICES,
      skip: 0,
      props: ROOT,
    });

    const targets: Array<ProbeJobTarget> = [];

    for (const device of devices) {
      if (
        NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
          device.monitoringMethod,
        )
      ) {
        continue;
      }

      const target: ProbeJobTarget | null = getDevicePollTarget(device);

      if (target) {
        targets.push(target);
      }
    }

    return targets;
  }

  // The ranges of the probes' discovery scans that swept in the window.
  public static async readDiscoveryRanges(
    data: ProbeJobRead,
  ): Promise<Array<ProbeJobRange>> {
    const scans: Array<NetworkDeviceDiscoveryScan> =
      await NetworkDeviceDiscoveryScanService.findBy({
        query: {
          projectId: data.projectId,
          probeId: QueryHelper.any(idsOf(data.probeIds)) as never,
        },
        select: {
          _id: true,
          cidr: true,
          status: true,
          startedAt: true,
          completedAt: true,
          isSnmpEnabled: true,
          isNetbiosLookupEnabled: true,
          snmpConfigs: true,
          snmpPort: true,
        },
        skip: 0,
        limit: MAX_PROBE_JOB_DISCOVERY_SCANS,
        props: ROOT,
      });

    const ranges: Array<ProbeJobRange> = [];

    for (const scan of scans) {
      if (!isDiscoveryScanInWindow(scan, data.window)) {
        continue;
      }

      const range: ProbeJobRange | null = getDiscoveryScanRange(scan);

      if (range) {
        ranges.push(range);
      }
    }

    return ranges;
  }

  // The destinations of the monitors the probes check.
  public static async readMonitorTargets(
    data: ProbeJobRead,
  ): Promise<Array<ProbeJobTarget>> {
    const assignments: Array<MonitorProbe> =
      await MonitorProbeService.findAllBy({
        query: {
          projectId: data.projectId,
          probeId: QueryHelper.any(idsOf(data.probeIds)) as never,
          isEnabled: true,
        },
        select: { _id: true, monitorId: true },
        limit: MAX_PROBE_JOB_MONITORS,
        skip: 0,
        props: ROOT,
      });

    const monitorIds: Array<string> = Array.from(
      new Set(
        assignments
          .map((assignment: MonitorProbe): string => {
            return assignment.monitorId?.toString() || "";
          })
          .filter(Boolean),
      ),
    );

    const targets: Array<ProbeJobTarget> = [];

    for (
      let start: number = 0;
      start < monitorIds.length;
      start += MONITORS_READ_AT_ONCE
    ) {
      const monitors: Array<Monitor> = await MonitorService.findBy({
        query: {
          ...MonitorService.getEnabledMonitorQuery(),
          projectId: data.projectId,
          _id: QueryHelper.any(
            monitorIds.slice(start, start + MONITORS_READ_AT_ONCE),
          ) as never,
          monitorType: QueryHelper.any([...PROBE_JOB_MONITOR_TYPES]) as never,
        },
        select: { _id: true, monitorType: true, monitorSteps: true },
        skip: 0,
        limit: MONITORS_READ_AT_ONCE,
        props: ROOT,
      });

      for (const monitor of monitors) {
        targets.push(
          ...getMonitorTargets(monitor.monitorType, monitor.monitorSteps),
        );
      }
    }

    return targets;
  }

  /*
   * The job's DNS names, resolved here, at most MAX_PROBE_JOB_NAMES_RESOLVED
   * of them: each address a name resolves to is reached as the name is. A
   * name that does not resolve adds nothing.
   */
  public static async resolveNames(job: ProbeJob): Promise<void> {
    const names: Array<string> = job
      .getNames()
      .slice(0, MAX_PROBE_JOB_NAMES_RESOLVED);

    for (
      let start: number = 0;
      start < names.length;
      start += NAMES_RESOLVED_AT_ONCE
    ) {
      const batch: Array<string> = names.slice(
        start,
        start + NAMES_RESOLVED_AT_ONCE,
      );

      const resolved: Array<Array<string>> = await Promise.all(
        batch.map((name: string): Promise<Array<string>> => {
          return this.dnsCache.resolve(name);
        }),
      );

      batch.forEach((name: string, index: number): void => {
        job.addResolvedAddresses(name, resolved[index] || []);
      });
    }
  }
}
