import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import NetworkDeviceHydrationUtil from "../Monitor/NetworkDeviceHydrationUtil";
import NetworkFlowDeviceMatcher, {
  FlowProbe,
} from "../NetworkFlow/NetworkFlowDeviceMatcher";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import IP from "../../../Types/IP/IP";
import SnmpVendorTemplateUtil from "../../../Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import ObjectID from "../../../Types/ObjectID";
import { SyslogDeviceMatchKind } from "../../../Types/Syslog/SyslogAttribute";
import IpCanonicalUtil from "../../../Utils/IpCanonicalUtil";
import { normalizeMac } from "../../../Utils/Monitor/EndpointAttachmentUtil";
import NetworkDeviceOtherAddressesUtil from "../../../Utils/NetworkDevice/NetworkDeviceOtherAddresses";
import { SyslogDeviceIdentity } from "../../../Utils/Syslog/SyslogVendorParser";

/*
 * WHOSE SYSLOG THIS IS.
 *
 * A probe forwards each message with the address it came from. That
 * address is the strongest thing known about a message - a line can say
 * anything about itself - so it is asked first, and what the message says
 * only decides what the address cannot:
 *
 *   1. THE ADDRESS IS A DEVICE THIS PROBE POLLS (its hostname, one of its
 *      Other Addresses, or what its DNS name resolves to - the rule traps
 *      and flow records follow). The message is that device's.
 *
 *      Unless it names another device of the same project by something a
 *      line cannot get wrong by accident: a MAC address, a serial number,
 *      or an address. Then the sender is passing it on - a UniFi console
 *      for an access point, a controller for a switch - and the message is
 *      the named device's, with the sender recorded as its relay. A
 *      controller's NAME for a device it manages counts too; the host name
 *      of the syslog header does not, because a sender's own name for
 *      itself is too often a factory default another device carries as
 *      well ("MikroTik", "switch").
 *
 *   2. THE ADDRESS IS NO DEVICE OF THIS PROBE, and the probe is a
 *      project's own. Then the project's devices are asked: one with that
 *      address (polled by another of the project's probes), else one the
 *      message names - by MAC address, serial number, address, and here by
 *      name too: a device behind NAT, or one that sends from an interface
 *      nobody registered, is found by the host name it sends when exactly
 *      one device of the project has that name.
 *
 *   3. NOBODY. On a project's own probe the message is kept for the
 *      project, marked as from no device yet (the trap and flow paths do
 *      the same); a global probe has no project to keep it for, and drops
 *      it.
 *
 * A name is matched only when it is one device's alone: two devices that
 * share it match neither.
 *
 * Syslog arrives by the hundred a second, so answers are cached per
 * process for CACHE_TTL_MS: a device added, renamed or given another
 * address starts receiving its messages within that long.
 */

export const CACHE_TTL_MS: number = 60 * 1000;

// What a host name never is: a name that tells two machines apart.
const NAMES_THAT_NAME_NOBODY: ReadonlyArray<string> = [
  "localhost",
  "localhost.localdomain",
  "(none)",
  "none",
  "unknown",
  "-",
];

// How much of a device's vendor and system description is kept for parsers.
const MAX_VENDOR_TEXT_LENGTH: number = 512;

export interface SyslogDevice {
  id: ObjectID;
  projectId: ObjectID;
  // The device's name; empty when it has none.
  name: string;
  /*
   * Everything that says who made the device: its Vendor, the maker its
   * sysObjectID belongs to, and its system description. Handed to the
   * syslog parsers as the device's vendor.
   */
  vendorText: string;
}

export interface SyslogDeviceAttribution {
  device: SyslogDevice;
  matchedBy: SyslogDeviceMatchKind;
  // The device that passed the message on, when it is about another one.
  relay: SyslogDevice | null;
}

export interface SyslogAttribution {
  // The devices the message is stored for: one log each.
  devices: Array<SyslogDeviceAttribution>;
  /*
   * The project that keeps a message no device claims; null when there is
   * a device, or no project to keep it for.
   */
  unmatchedProjectId: ObjectID | null;
}

export interface SyslogSender {
  // The address the message came from, as the probe saw it.
  sourceIpAddress: string;
  // Who the message's own fields say it is about.
  identity?: SyslogDeviceIdentity | undefined;
  // The host name of its syslog header.
  headerHostname?: string | undefined;
}

interface ProjectDeviceIndex {
  byId: Map<string, SyslogDevice>;
  byAddress: Map<string, Array<SyslogDevice>>;
  byMac: Map<string, Array<SyslogDevice>>;
  bySerial: Map<string, Array<SyslogDevice>>;
  byName: Map<string, Array<SyslogDevice>>;
}

interface SourceDevice {
  id: ObjectID;
  projectId: ObjectID;
  name: string;
}

interface IdentityMatch {
  device: SyslogDevice;
  matchedBy: SyslogDeviceMatchKind;
}

const sourceCache: InMemoryTTLCache<Array<SourceDevice>> = new InMemoryTTLCache(
  50_000,
);
const indexCache: InMemoryTTLCache<ProjectDeviceIndex> = new InMemoryTTLCache(
  2_000,
);

function addTo(
  map: Map<string, Array<SyslogDevice>>,
  key: string,
  device: SyslogDevice,
): void {
  if (!key) {
    return;
  }

  const entries: Array<SyslogDevice> = map.get(key) || [];

  if (
    !entries.some((entry: SyslogDevice): boolean => {
      return entry.id.toString() === device.id.toString();
    })
  ) {
    entries.push(device);
  }

  map.set(key, entries);
}

// A name as it is compared: trimmed, lower case, without a trailing dot.
function normalizeName(value: string | null | undefined): string {
  let name: string = (value || "").trim().toLowerCase();

  while (name.endsWith(".")) {
    name = name.slice(0, -1);
  }

  return name;
}

// "sw-core-1" of "sw-core-1.example.com"; empty when the name has no domain.
function shortName(name: string): string {
  const dot: number = name.indexOf(".");

  return dot > 0 ? name.slice(0, dot) : "";
}

function isIpAddress(value: string): boolean {
  return IP.isIP(value.trim());
}

// The one device a key names, or null when none or several do.
function onlyDevice(
  map: Map<string, Array<SyslogDevice>>,
  key: string,
): SyslogDevice | null {
  if (!key) {
    return null;
  }

  const devices: Array<SyslogDevice> | undefined = map.get(key);

  return devices && devices.length === 1 ? devices[0]! : null;
}

export default class SyslogDeviceMatcher {
  /*
   * Where a message goes. `probe` is the probe that received it (null
   * when the probe is not known: the message is nobody's).
   */
  public static async attribute(
    probe: FlowProbe | null,
    sender: SyslogSender,
  ): Promise<SyslogAttribution> {
    if (!probe) {
      return { devices: [], unmatchedProjectId: null };
    }

    const sourceDevices: Array<SourceDevice> =
      await SyslogDeviceMatcher.getSourceDevices(
        probe.id,
        sender.sourceIpAddress,
      );

    if (sourceDevices.length > 0) {
      return {
        devices: await SyslogDeviceMatcher.attributeFromSource(
          sourceDevices,
          sender,
        ),
        unmatchedProjectId: null,
      };
    }

    // A global probe has no project whose devices could be asked.
    if (!probe.projectId) {
      return { devices: [], unmatchedProjectId: null };
    }

    const index: ProjectDeviceIndex = await SyslogDeviceMatcher.getProjectIndex(
      probe.projectId,
    );

    /*
     * A device of the project another of its probes polls - when the
     * address is one device's alone. Sites that reuse the same private
     * addresses each have a device at 192.168.1.1, and a message from that
     * address through a probe that polls none of them is not known to be
     * any of theirs.
     */
    const source: string = sender.sourceIpAddress.trim();

    if (isIpAddress(source)) {
      const byAddress: SyslogDevice | null = onlyDevice(
        index.byAddress,
        IpCanonicalUtil.canonicalize(source),
      );

      if (byAddress) {
        return {
          devices: [
            {
              device: byAddress,
              matchedBy: SyslogDeviceMatchKind.SourceAddress,
              relay: null,
            },
          ],
          unmatchedProjectId: null,
        };
      }
    }

    const named: IdentityMatch | null =
      SyslogDeviceMatcher.findByWhatCannotBeMistaken(index, sender) ||
      SyslogDeviceMatcher.findByName(index, [
        sender.identity?.hostname,
        sender.headerHostname,
      ]);

    if (named) {
      return {
        devices: [
          { device: named.device, matchedBy: named.matchedBy, relay: null },
        ],
        unmatchedProjectId: null,
      };
    }

    return { devices: [], unmatchedProjectId: probe.projectId };
  }

  /*
   * The device of a project a message names, for syslog that arrives with
   * no address to go by (posted to /syslog/v1/logs by a relay): by MAC
   * address, serial number or address, else by name - the message's own,
   * then its header's. Null when it names no device, or more than one.
   */
  public static async findDeviceInProject(
    projectId: ObjectID,
    sender: Pick<SyslogSender, "identity" | "headerHostname">,
  ): Promise<SyslogDeviceAttribution | null> {
    const hasSomethingToGoBy: boolean = Boolean(
      sender.headerHostname ||
        sender.identity?.hostname ||
        sender.identity?.macAddress ||
        sender.identity?.serialNumber ||
        sender.identity?.ipAddress,
    );

    // Most lines name nobody: do not read the project for them.
    if (!hasSomethingToGoBy) {
      return null;
    }

    const index: ProjectDeviceIndex =
      await SyslogDeviceMatcher.getProjectIndex(projectId);

    if (index.byId.size === 0) {
      return null;
    }

    const lookup: SyslogSender = { sourceIpAddress: "", ...sender };
    const named: IdentityMatch | null =
      SyslogDeviceMatcher.findByWhatCannotBeMistaken(index, lookup) ||
      SyslogDeviceMatcher.findByName(index, [
        sender.identity?.hostname,
        sender.headerHostname,
      ]);

    return named
      ? { device: named.device, matchedBy: named.matchedBy, relay: null }
      : null;
  }

  /*
   * The devices of a probe the address belongs to, each attributed to
   * itself - or to the device of its project the message names instead.
   */
  private static async attributeFromSource(
    sourceDevices: Array<SourceDevice>,
    sender: SyslogSender,
  ): Promise<Array<SyslogDeviceAttribution>> {
    const attributions: Array<SyslogDeviceAttribution> = [];
    const seen: Set<string> = new Set();

    for (const sourceDevice of sourceDevices) {
      const index: ProjectDeviceIndex =
        await SyslogDeviceMatcher.getProjectIndex(sourceDevice.projectId);

      const self: SyslogDevice = index.byId.get(sourceDevice.id.toString()) || {
        id: sourceDevice.id,
        projectId: sourceDevice.projectId,
        name: sourceDevice.name,
        vendorText: "",
      };

      const named: IdentityMatch | null =
        SyslogDeviceMatcher.findByWhatCannotBeMistaken(index, sender) ||
        // A controller's name for a device it manages; never the header's.
        (sender.identity?.managedDevice
          ? SyslogDeviceMatcher.findByName(index, [sender.identity.hostname])
          : null);

      const isRelayed: boolean =
        named !== null && named.device.id.toString() !== self.id.toString();

      const attribution: SyslogDeviceAttribution = isRelayed
        ? { device: named!.device, matchedBy: named!.matchedBy, relay: self }
        : {
            device: self,
            matchedBy: SyslogDeviceMatchKind.SourceAddress,
            relay: null,
          };

      const key: string = attribution.device.id.toString();

      if (!seen.has(key)) {
        seen.add(key);
        attributions.push(attribution);
      }
    }

    return attributions;
  }

  /*
   * The device a message names by a MAC address, a serial number or an
   * address - when exactly one device of the project has it.
   */
  private static findByWhatCannotBeMistaken(
    index: ProjectDeviceIndex,
    sender: SyslogSender,
  ): IdentityMatch | null {
    const mac: string | undefined = normalizeMac(sender.identity?.macAddress);
    const byMac: SyslogDevice | null = mac
      ? onlyDevice(index.byMac, mac)
      : null;

    if (byMac) {
      return { device: byMac, matchedBy: SyslogDeviceMatchKind.MacAddress };
    }

    const serial: string = (sender.identity?.serialNumber || "")
      .trim()
      .toUpperCase();
    const bySerial: SyslogDevice | null = onlyDevice(index.bySerial, serial);

    if (bySerial) {
      return {
        device: bySerial,
        matchedBy: SyslogDeviceMatchKind.SerialNumber,
      };
    }

    /*
     * An address the message gives for its device: a field of its own, or
     * an address written where the header's host name goes (RFC 3164
     * allows either there).
     */
    for (const candidate of [
      sender.identity?.ipAddress,
      sender.identity?.hostname,
      sender.headerHostname,
    ]) {
      const address: string = (candidate || "").trim();

      if (!address || !isIpAddress(address)) {
        continue;
      }

      const byAddress: SyslogDevice | null = onlyDevice(
        index.byAddress,
        IpCanonicalUtil.canonicalize(address),
      );

      if (byAddress) {
        return { device: byAddress, matchedBy: SyslogDeviceMatchKind.Address };
      }
    }

    return null;
  }

  /*
   * The device a name is the name of - its own name, its system name, its
   * DNS name - whole, or without its domain. Only when it is one device's
   * alone.
   */
  private static findByName(
    index: ProjectDeviceIndex,
    candidates: Array<string | undefined>,
  ): IdentityMatch | null {
    for (const candidate of candidates) {
      const name: string = normalizeName(candidate);

      if (!name || isIpAddress(name) || NAMES_THAT_NAME_NOBODY.includes(name)) {
        continue;
      }

      const device: SyslogDevice | null =
        onlyDevice(index.byName, name) ||
        onlyDevice(index.byName, shortName(name));

      if (device) {
        return { device: device, matchedBy: SyslogDeviceMatchKind.Hostname };
      }
    }

    return null;
  }

  private static async getSourceDevices(
    probeId: ObjectID,
    sourceIpAddress: string,
  ): Promise<Array<SourceDevice>> {
    const address: string = sourceIpAddress.trim();
    const key: string = `${probeId.toString()}|${address}`;
    const cached: Array<SourceDevice> | undefined = sourceCache.get(key);

    if (cached) {
      return cached;
    }

    const found: Array<NetworkDevice> =
      await NetworkDeviceHydrationUtil.findDevicesByProbeAndSource({
        probeId: probeId,
        sourceIpAddress: address,
        select: {
          name: true,
        },
      });

    const devices: Array<SourceDevice> = [];

    for (const device of found) {
      if (device.id && device.projectId) {
        devices.push({
          id: device.id,
          projectId: device.projectId,
          name: device.name?.trim() || "",
        });
      }
    }

    sourceCache.set(key, devices, CACHE_TTL_MS);

    return devices;
  }

  /*
   * Everything a project's devices are known by, read once per project per
   * CACHE_TTL_MS: a burst of messages from many senders costs one read.
   */
  public static async getProjectIndex(
    projectId: ObjectID,
  ): Promise<ProjectDeviceIndex> {
    const key: string = projectId.toString();
    const cached: ProjectDeviceIndex | undefined = indexCache.get(key);

    if (cached) {
      return cached;
    }

    const rows: Array<NetworkDevice> = await NetworkDeviceService.findBy({
      query: {
        projectId: projectId,
      },
      select: {
        _id: true,
        projectId: true,
        name: true,
        hostname: true,
        dnsName: true,
        otherAddresses: true,
        discoveredName: true,
        macAddress: true,
        sysName: true,
        sysDescr: true,
        sysObjectId: true,
        vendor: true,
        serialNumber: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const index: ProjectDeviceIndex = {
      byId: new Map(),
      byAddress: new Map(),
      byMac: new Map(),
      bySerial: new Map(),
      byName: new Map(),
    };

    for (const row of rows) {
      if (!row.id || !row.projectId) {
        continue;
      }

      const device: SyslogDevice = {
        id: row.id,
        projectId: row.projectId,
        name: row.name?.trim() || "",
        vendorText: SyslogDeviceMatcher.getVendorText(row),
      };

      index.byId.set(device.id.toString(), device);

      const hostname: string = row.hostname?.trim() || "";

      if (hostname && isIpAddress(hostname)) {
        addTo(index.byAddress, IpCanonicalUtil.canonicalize(hostname), device);
      }

      for (const address of NetworkDeviceOtherAddressesUtil.parse(
        row.otherAddresses,
      ).addresses) {
        addTo(index.byAddress, address, device);
      }

      const mac: string | undefined = normalizeMac(row.macAddress || undefined);

      if (mac) {
        addTo(index.byMac, mac, device);
      }

      addTo(
        index.bySerial,
        (row.serialNumber || "").trim().toUpperCase(),
        device,
      );

      for (const candidate of [
        row.name,
        row.sysName,
        row.dnsName,
        row.discoveredName,
        // A device registered by name is known by that name too.
        hostname && !isIpAddress(hostname) ? hostname : "",
      ]) {
        const name: string = normalizeName(candidate);

        if (!name || isIpAddress(name)) {
          continue;
        }

        addTo(index.byName, name, device);
        addTo(index.byName, shortName(name), device);
      }
    }

    indexCache.set(key, index, CACHE_TTL_MS);

    return index;
  }

  private static getVendorText(device: NetworkDevice): string {
    const parts: Array<string> = [];

    for (const part of [
      device.vendor,
      SnmpVendorTemplateUtil.getVendorName({
        sysObjectId: device.sysObjectId || undefined,
        sysDescr: device.sysDescr || undefined,
      }),
      device.sysDescr,
    ]) {
      const text: string = (part || "").trim();

      if (text && !parts.includes(text)) {
        parts.push(text);
      }
    }

    return parts.join(" ").slice(0, MAX_VENDOR_TEXT_LENGTH);
  }

  // The probe a message came through, with the project it belongs to.
  public static async getProbe(probeId: ObjectID): Promise<FlowProbe | null> {
    return NetworkFlowDeviceMatcher.getProbe(probeId);
  }

  // Forget cached answers (tests, and a device edited in this process).
  public static clearCaches(): void {
    sourceCache.clear();
    indexCache.clear();
  }
}
