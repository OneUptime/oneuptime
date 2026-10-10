import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import ProbeService from "../../Services/ProbeService";
import NetworkDeviceHydrationUtil from "../Monitor/NetworkDeviceHydrationUtil";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import Probe from "../../../Models/DatabaseModels/Probe";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import IP from "../../../Types/IP/IP";
import ObjectID from "../../../Types/ObjectID";
import IpCanonicalUtil from "../../../Utils/IpCanonicalUtil";
import NetworkDeviceOtherAddressesUtil from "../../../Utils/NetworkDevice/NetworkDeviceOtherAddresses";

/*
 * WHOSE FLOWS THESE ARE.
 *
 * A probe forwards flow records named by their exporter - the address the
 * router or switch sent them from (or calls itself). On ingest each exporter
 * is matched to the Network Devices it is:
 *
 *   1. devices this probe polls whose hostname is the address, or lists it
 *      in its Other Addresses, or resolves to it in DNS - the rule traps and
 *      syslog follow (NetworkDeviceHydrationUtil.findDevicesByProbeAndSource);
 *   2. on a project's own probe, any device of that project with the
 *      address as its hostname or among its Other Addresses - a router
 *      polled by one probe may export to another of the project's probes.
 *      Devices of the receiving probe win, so two sites that reuse private
 *      addresses each keep their own flows;
 *   3. otherwise, on a project's own probe, nobody yet: the flows are kept
 *      for the project (its ID in place of a device ID), and the Traffic
 *      pages offer to add the device or say which device it is. A global
 *      probe has no project to keep them for, so they are dropped.
 *
 * On a global probe the same address can be a device in several projects;
 * each gets its own copy of the flow (the trap path's policy).
 *
 * Flows arrive every few seconds from every exporter, so answers are cached
 * per process for CACHE_TTL_MS: a device added, or an address added to one,
 * starts receiving flows within that long.
 */

export const CACHE_TTL_MS: number = 60 * 1000;

export interface FlowProbe {
  id: ObjectID;
  // Null on a global probe.
  projectId: ObjectID | null;
}

export interface FlowDeviceMatch {
  networkDeviceId: ObjectID;
  projectId: ObjectID;
}

/*
 * Where an exporter's flows go: its devices, or the probe's project when it
 * is nobody's yet (null: dropped).
 */
export interface FlowExporterAttribution {
  devices: Array<FlowDeviceMatch>;
  unmatchedProjectId: ObjectID | null;
}

const probeCache: InMemoryTTLCache<FlowProbe | null> = new InMemoryTTLCache(
  10_000,
);
const matchCache: InMemoryTTLCache<Array<FlowDeviceMatch>> =
  new InMemoryTTLCache(50_000);
const projectAddressIndexCache: InMemoryTTLCache<
  Map<string, Array<FlowDeviceMatch>>
> = new InMemoryTTLCache(2_000);

export default class NetworkFlowDeviceMatcher {
  public static async getProbe(probeId: ObjectID): Promise<FlowProbe | null> {
    const key: string = probeId.toString();
    const cached: FlowProbe | null | undefined = probeCache.get(key);

    if (cached !== undefined) {
      return cached;
    }

    const probe: Probe | null = await ProbeService.findOneById({
      id: probeId,
      select: {
        _id: true,
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    const value: FlowProbe | null = probe
      ? { id: probeId, projectId: probe.projectId || null }
      : null;

    probeCache.set(key, value, CACHE_TTL_MS);

    return value;
  }

  public static async attribute(
    probe: FlowProbe,
    exporterAddress: string,
  ): Promise<FlowExporterAttribution> {
    const devices: Array<FlowDeviceMatch> =
      await NetworkFlowDeviceMatcher.findDevices(probe, exporterAddress);

    return {
      devices: devices,
      unmatchedProjectId: devices.length === 0 ? probe.projectId : null,
    };
  }

  public static async findDevices(
    probe: FlowProbe,
    exporterAddress: string,
  ): Promise<Array<FlowDeviceMatch>> {
    const address: string = exporterAddress.trim();
    const key: string = `${probe.id.toString()}|${address}`;
    const cached: Array<FlowDeviceMatch> | undefined = matchCache.get(key);

    if (cached) {
      return cached;
    }

    const probeDevices: Array<NetworkDevice> =
      await NetworkDeviceHydrationUtil.findDevicesByProbeAndSource({
        probeId: probe.id,
        sourceIpAddress: address,
      });

    let matches: Array<FlowDeviceMatch> =
      NetworkFlowDeviceMatcher.toMatches(probeDevices);

    if (matches.length === 0 && probe.projectId && IP.isIP(address)) {
      const index: Map<
        string,
        Array<FlowDeviceMatch>
      > = await NetworkFlowDeviceMatcher.getProjectAddressIndex(
        probe.projectId,
      );

      matches = index.get(IpCanonicalUtil.canonicalize(address)) || [];
    }

    matchCache.set(key, matches, CACHE_TTL_MS);

    return matches;
  }

  /*
   * Every address a project's devices are known by - hostnames that are IP
   * addresses, and Other Addresses - to the devices known by it. Built once
   * per project per CACHE_TTL_MS, so a project with many unrecognised
   * exporters costs one read, not one per exporter.
   */
  public static async getProjectAddressIndex(
    projectId: ObjectID,
  ): Promise<Map<string, Array<FlowDeviceMatch>>> {
    const key: string = projectId.toString();
    const cached: Map<string, Array<FlowDeviceMatch>> | undefined =
      projectAddressIndexCache.get(key);

    if (cached) {
      return cached;
    }

    const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy({
      query: {
        projectId: projectId,
      },
      select: {
        _id: true,
        projectId: true,
        hostname: true,
        otherAddresses: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const index: Map<string, Array<FlowDeviceMatch>> = new Map();

    const add: (address: string, device: NetworkDevice) => void = (
      address: string,
      device: NetworkDevice,
    ): void => {
      if (!device.id || !device.projectId) {
        return;
      }

      const entries: Array<FlowDeviceMatch> = index.get(address) || [];

      if (
        !entries.some((entry: FlowDeviceMatch): boolean => {
          return entry.networkDeviceId.toString() === device.id!.toString();
        })
      ) {
        entries.push({
          networkDeviceId: device.id,
          projectId: device.projectId,
        });
      }

      index.set(address, entries);
    };

    for (const device of devices) {
      const hostname: string = device.hostname?.trim() || "";

      if (hostname && IP.isIP(hostname)) {
        add(IpCanonicalUtil.canonicalize(hostname), device);
      }

      for (const address of NetworkDeviceOtherAddressesUtil.parse(
        device.otherAddresses,
      ).addresses) {
        add(address, device);
      }
    }

    projectAddressIndexCache.set(key, index, CACHE_TTL_MS);

    return index;
  }

  // Forget cached answers (tests, and a device edited in this process).
  public static clearCaches(): void {
    probeCache.clear();
    matchCache.clear();
    projectAddressIndexCache.clear();
  }

  private static toMatches(
    devices: Array<NetworkDevice>,
  ): Array<FlowDeviceMatch> {
    const matches: Array<FlowDeviceMatch> = [];

    for (const device of devices) {
      if (device.id && device.projectId) {
        matches.push({
          networkDeviceId: device.id,
          projectId: device.projectId,
        });
      }
    }

    return matches;
  }
}
