import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import URL from "../../../Types/API/URL";
import IP from "../../../Types/IP/IP";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import Port from "../../../Types/Port";
import { DiscoveryScanStatus } from "../../NetworkDiscovery/DiscoveryScanStatus";
import ScanTargetUtil, {
  ScanTarget,
} from "../../NetworkDiscovery/ScanTargetUtil";
import SnmpScanConfigUtil, {
  DiscoveryScanSnmpConfig,
  SnmpScanConfigSource,
} from "../../NetworkDiscovery/SnmpScanConfigUtil";
import NetworkAddressBlockUtil from "../../NetworkTraffic/NetworkAddressBlock";

/*
 * WHAT A PROBE IS SET TO DO, AS THE NETWORK SEES IT (#10429).
 *
 * A probe's polls, discovery sweeps and port checks look, in a network
 * flow, exactly like someone scanning: one address reaching port 161 on
 * forty hosts in five minutes is a network sweep, and twenty-five Port
 * monitors on one host are a port scan. Security Events sets such traffic
 * aside as OneUptime's own only when it is what the probe is set to do, so
 * this describes that, destination by destination:
 *
 *   - device polling: every network device the probe polls
 *     (NetworkDevice.probeId), pinged and asked over SNMP on its port
 *     (Probe/Jobs/NetworkDevice/FetchList: a poll is ping-first);
 *   - discovery: the range each of its discovery scans sweeps, while the
 *     scan runs - an ICMP sweep of every address, then SNMP on each of the
 *     scan's ports, and NBSTAT on UDP 137 when the scan looks up NetBIOS
 *     names (Probe/Utils/Discovery/SubnetScanner);
 *   - monitors: the destination of each monitor it checks - a Port
 *     monitor's port over TCP, a Ping or IP monitor's ICMP (and TCP 80,
 *     where the probe's host blocks ping), a Website, API or SSL
 *     Certificate monitor's host on its URL's port.
 *
 * A destination is an address, a name, or a discovery range. A name is
 * matched when the flow names its destination so (the collecting probe's
 * own lookup, NetworkFlow.dstName), and by the addresses OneUptime resolves
 * it to (TelemetryScan/ProbeJobReader).
 *
 * A flow is the probe's work only when its protocol and port are what the
 * probe sends that destination. ICMP is matched whatever its port: NetFlow
 * v5 writes an ICMP message's type and code where the port goes (an echo
 * request is "port" 2048), and a probe pings what it polls. Anything else -
 * another port on a polled device, a host outside the scan's range, a
 * protocol the flow does not name - is not the probe's work, and is
 * counted as anyone's traffic is.
 *
 * Pure: the scan reads what the probe is set to do and hands it here.
 */

export enum ProbeWork {
  DevicePolling = "device-polling",
  Discovery = "discovery",
  Monitor = "monitor",
}

// Every kind of work, in the order a sentence names them.
export const PROBE_WORKS: ReadonlyArray<ProbeWork> = [
  ProbeWork.DevicePolling,
  ProbeWork.Discovery,
  ProbeWork.Monitor,
];

export enum ProbeJobProtocol {
  Tcp = "tcp",
  Udp = "udp",
  Icmp = "icmp",
}

// What a probe sends a destination: a transport port, or ICMP (any message).
export interface ProbeJobService {
  protocol: ProbeJobProtocol;
  // 0 for ICMP.
  port: number;
  work: ProbeWork;
}

// A destination the probe reaches: an address or a name.
export interface ProbeJobTarget {
  host: string;
  services: Array<ProbeJobService>;
}

// A discovery scan's range, and what the scan sends each address in it.
export interface ProbeJobRange {
  // As the scan writes it: CIDR or octet ranges (ScanTargetUtil).
  target: string;
  services: Array<ProbeJobService>;
}

// What a flow says of its destination, as the job matches it.
export interface ProbeJobFlow {
  dstIp: string;
  // The destination's DNS name, as the collecting probe looked it up; "" when none.
  dstName: string;
  dstPort: number;
  // The IANA protocol number the flow records.
  protocol: number;
}

export const SNMP_PORT: number = 161;
export const NETBIOS_NAME_SERVICE_PORT: number = 137;
export const HTTP_PORT: number = 80;
export const HTTPS_PORT: number = 443;

/*
 * How long after a discovery scan's run ended its flows may still arrive:
 * an exporter sends a flow once it ends, and the scan reads flows by when
 * they arrived.
 */
export const DISCOVERY_FLOW_GRACE_IN_MINUTES: number = 15;

// The monitor types whose checks reach a host the probe can be told by.
export const PROBE_JOB_MONITOR_TYPES: ReadonlyArray<MonitorType> = [
  MonitorType.Port,
  MonitorType.Ping,
  MonitorType.IP,
  MonitorType.Website,
  MonitorType.API,
  MonitorType.SSLCertificate,
];

// The IANA protocol numbers flows record, as what a probe sends.
export function getProbeJobProtocol(protocol: number): ProbeJobProtocol | null {
  switch (protocol) {
    case 6:
      return ProbeJobProtocol.Tcp;
    case 17:
      return ProbeJobProtocol.Udp;
    case 1:
    case 58:
      return ProbeJobProtocol.Icmp;
    default:
      return null;
  }
}

// A DNS name as the job keys it: lower case, without the root's dot.
export function normalizeProbeJobName(name: string | undefined | null): string {
  const text: string = (name || "").trim().toLowerCase();

  return text.endsWith(".") ? text.slice(0, -1) : text;
}

function service(
  protocol: ProbeJobProtocol,
  port: number,
  work: ProbeWork,
): ProbeJobService {
  return {
    protocol,
    port: protocol === ProbeJobProtocol.Icmp ? 0 : port,
    work,
  };
}

function isPort(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= 65535
  );
}

function sameService(a: ProbeJobService, b: ProbeJobService): boolean {
  return a.protocol === b.protocol && a.port === b.port && a.work === b.work;
}

function addServices(
  map: Map<string, Array<ProbeJobService>>,
  key: string,
  services: ReadonlyArray<ProbeJobService>,
): void {
  const kept: Array<ProbeJobService> = map.get(key) || [];

  for (const candidate of services) {
    if (
      !kept.some((existing: ProbeJobService): boolean => {
        return sameService(existing, candidate);
      })
    ) {
      kept.push(candidate);
    }
  }

  map.set(key, kept);
}

// The service among these a flow of this protocol and port is, if any.
function serviceFor(
  services: ReadonlyArray<ProbeJobService> | undefined,
  protocol: ProbeJobProtocol,
  port: number,
): ProbeJobService | null {
  return (
    (services || []).find((candidate: ProbeJobService): boolean => {
      return (
        candidate.protocol === protocol &&
        (protocol === ProbeJobProtocol.Icmp || candidate.port === port)
      );
    }) || null
  );
}

interface ParsedRange {
  range: ProbeJobRange;
  parsed: ScanTarget;
}

export class ProbeJob {
  private addresses: Map<string, Array<ProbeJobService>> = new Map();
  private names: Map<string, Array<ProbeJobService>> = new Map();
  private ranges: Array<ParsedRange> = [];

  // A destination the probe reaches: an address, or a name to resolve.
  public addTarget(target: ProbeJobTarget): void {
    if (target.services.length === 0) {
      return;
    }

    const address: string | null = NetworkAddressBlockUtil.canonicalAddress(
      target.host,
    );

    if (address) {
      addServices(this.addresses, address, target.services);
      return;
    }

    const name: string = normalizeProbeJobName(target.host);

    if (name) {
      addServices(this.names, name, target.services);
    }
  }

  // A discovery scan's range; one that does not parse adds nothing.
  public addRange(range: ProbeJobRange): void {
    const parsed: ScanTarget | null = ScanTargetUtil.parse(range.target);

    if (parsed && range.services.length > 0) {
      this.ranges.push({ range, parsed });
    }
  }

  /*
   * The addresses a name resolved to: each is reached as the name is. Only
   * what OneUptime resolved itself is added here, never an address a flow
   * names.
   */
  public addResolvedAddresses(name: string, addresses: Array<string>): void {
    const services: Array<ProbeJobService> | undefined = this.names.get(
      normalizeProbeJobName(name),
    );

    if (!services) {
      return;
    }

    for (const value of addresses) {
      const address: string | null =
        NetworkAddressBlockUtil.canonicalAddress(value);

      if (address) {
        addServices(this.addresses, address, services);
      }
    }
  }

  // Another job, as part of this one: probes that share an address.
  public merge(other: ProbeJob): void {
    for (const [address, services] of other.addresses) {
      addServices(this.addresses, address, services);
    }

    for (const [name, services] of other.names) {
      addServices(this.names, name, services);
    }

    for (const range of other.ranges) {
      this.ranges.push(range);
    }
  }

  // The names to resolve, each once.
  public getNames(): Array<string> {
    return Array.from(this.names.keys());
  }

  public isEmpty(): boolean {
    return (
      this.addresses.size === 0 &&
      this.names.size === 0 &&
      this.ranges.length === 0
    );
  }

  /*
   * The work a flow is, or null when it is none of the probe's: its
   * destination is one the probe reaches - by address, by the name the
   * flow gives it, or in a discovery range - and its protocol and port are
   * what the probe sends there.
   */
  public findWork(flow: ProbeJobFlow): ProbeWork | null {
    const protocol: ProbeJobProtocol | null = getProbeJobProtocol(
      flow.protocol,
    );

    if (!protocol) {
      return null;
    }

    const address: string | null = NetworkAddressBlockUtil.canonicalAddress(
      flow.dstIp,
    );

    if (address) {
      const byAddress: ProbeJobService | null = serviceFor(
        this.addresses.get(address),
        protocol,
        flow.dstPort,
      );

      if (byAddress) {
        return byAddress.work;
      }
    }

    const name: string = normalizeProbeJobName(flow.dstName);

    if (name) {
      const byName: ProbeJobService | null = serviceFor(
        this.names.get(name),
        protocol,
        flow.dstPort,
      );

      if (byName) {
        return byName.work;
      }
    }

    if (address) {
      for (const { range, parsed } of this.ranges) {
        const inRange: ProbeJobService | null = serviceFor(
          range.services,
          protocol,
          flow.dstPort,
        );

        if (inRange && ScanTargetUtil.targetContains(parsed, address)) {
          return inRange.work;
        }
      }
    }

    return null;
  }
}

/*
 * A network device the probe polls: pinged, and asked over SNMP on its
 * port. Null for a device with no address to dial.
 */
export function getDevicePollTarget(device: {
  hostname?: string | undefined | null;
  snmpPort?: number | undefined | null;
}): ProbeJobTarget | null {
  const host: string = (device.hostname || "").trim();

  if (!host) {
    return null;
  }

  return {
    host,
    services: [
      service(ProbeJobProtocol.Icmp, 0, ProbeWork.DevicePolling),
      service(
        ProbeJobProtocol.Udp,
        isPort(device.snmpPort) ? device.snmpPort : SNMP_PORT,
        ProbeWork.DevicePolling,
      ),
    ],
  };
}

export interface ProbeJobDiscoveryScan extends SnmpScanConfigSource {
  cidr?: string | undefined | null;
  status?: string | undefined | null;
  startedAt?: Date | undefined | null;
  completedAt?: Date | undefined | null;
  isSnmpEnabled?: boolean | undefined | null;
  isNetbiosLookupEnabled?: boolean | undefined | null;
}

/*
 * A discovery scan's range, and what it sends each address: ICMP always,
 * SNMP on each of its ports unless it is an ICMP scan (ScanModeUtil reads
 * only an explicit false as off), and NBSTAT on UDP 137 when it looks up
 * NetBIOS names (only an explicit true is on). Null for a scan with no
 * range that parses.
 */
export function getDiscoveryScanRange(
  scan: ProbeJobDiscoveryScan,
): ProbeJobRange | null {
  const target: string = (scan.cidr || "").trim();

  if (!target || !ScanTargetUtil.parse(target)) {
    return null;
  }

  const services: Array<ProbeJobService> = [
    service(ProbeJobProtocol.Icmp, 0, ProbeWork.Discovery),
  ];

  if (scan.isSnmpEnabled !== false) {
    for (const config of SnmpScanConfigUtil.resolve(scan)) {
      const port: number = isPort((config as DiscoveryScanSnmpConfig).snmpPort)
        ? (config.snmpPort as number)
        : SNMP_PORT;

      if (
        !services.some((existing: ProbeJobService): boolean => {
          return (
            existing.protocol === ProbeJobProtocol.Udp && existing.port === port
          );
        })
      ) {
        services.push(service(ProbeJobProtocol.Udp, port, ProbeWork.Discovery));
      }
    }
  }

  if (scan.isNetbiosLookupEnabled === true) {
    services.push(
      service(
        ProbeJobProtocol.Udp,
        NETBIOS_NAME_SERVICE_PORT,
        ProbeWork.Discovery,
      ),
    );
  }

  return { target, services };
}

/*
 * Whether a discovery scan swept while a window's flows were sent: its run
 * started by the window's end, and is running still (In Progress), or
 * ended no more than DISCOVERY_FLOW_GRACE_IN_MINUTES before the window
 * began. A scan that has not run, or ran long before, swept nothing in it.
 */
export function isDiscoveryScanInWindow(
  scan: ProbeJobDiscoveryScan,
  window: { from: Date; to: Date },
): boolean {
  const startedAt: Date | null = scan.startedAt
    ? new Date(scan.startedAt)
    : null;
  const completedAt: Date | null = scan.completedAt
    ? new Date(scan.completedAt)
    : null;
  const graceStart: number =
    window.from.getTime() - DISCOVERY_FLOW_GRACE_IN_MINUTES * 60 * 1000;

  if (
    scan.status === DiscoveryScanStatus.InProgress &&
    startedAt &&
    startedAt.getTime() <= window.to.getTime()
  ) {
    return true;
  }

  /*
   * A run that ended: the last one, whose times the row keeps until the
   * next run starts.
   */
  return Boolean(
    startedAt &&
      completedAt &&
      startedAt.getTime() <= window.to.getTime() &&
      completedAt.getTime() >= graceStart,
  );
}

// A host as a URL writes it, without the brackets an IPv6 address wears there.
function bareHost(host: string): string {
  const text: string = host.trim();

  return text.startsWith("[") && text.endsWith("]") ? text.slice(1, -1) : text;
}

/*
 * A URL's authority - "app.example.com:8443", "[2001:db8::1]" - as its host
 * and its port, apart: a URL keeps the two together.
 */
function urlAuthorityOf(destination: URL): Hostname | null {
  try {
    return Hostname.fromAuthority(destination.hostname?.toString() || "");
  } catch {
    return null;
  }
}

// The host a monitor step's destination names, or "" for none.
function hostOf(destination: unknown): string {
  if (destination instanceof URL) {
    return bareHost(urlAuthorityOf(destination)?.hostname || "");
  }

  if (destination instanceof Hostname) {
    return bareHost(destination.hostname || "");
  }

  if (destination instanceof IP) {
    return destination.toString();
  }

  return "";
}

// A URL's port: the one it names, else its scheme's.
function urlPortOf(destination: URL): number {
  const named: number | null = portOf(urlAuthorityOf(destination)?.port);

  if (named) {
    return named;
  }

  return destination.protocol === Protocol.HTTP ? HTTP_PORT : HTTPS_PORT;
}

function portOf(port: Port | undefined): number | null {
  const value: unknown = port?.toNumber?.();

  return isPort(value) ? value : null;
}

// What one step of a monitor reaches, as the probe checks it.
function getStepTarget(
  monitorType: MonitorType,
  step: MonitorStep,
): ProbeJobTarget | null {
  const destination: unknown = step.data?.monitorDestination;
  const host: string = hostOf(destination);

  if (!host) {
    return null;
  }

  switch (monitorType) {
    case MonitorType.Port: {
      const port: number | null = portOf(step.data?.monitorDestinationPort);

      return port
        ? {
            host,
            services: [service(ProbeJobProtocol.Tcp, port, ProbeWork.Monitor)],
          }
        : null;
    }
    case MonitorType.Ping:
    case MonitorType.IP:
      return {
        host,
        services: [
          service(ProbeJobProtocol.Icmp, 0, ProbeWork.Monitor),
          // Where the probe's host blocks ping, it checks port 80 instead.
          service(ProbeJobProtocol.Tcp, HTTP_PORT, ProbeWork.Monitor),
        ],
      };
    case MonitorType.Website:
    case MonitorType.API:
    case MonitorType.SSLCertificate: {
      const port: number =
        destination instanceof URL
          ? urlPortOf(destination)
          : portOf(step.data?.monitorDestinationPort) ?? HTTPS_PORT;

      return {
        host,
        services: [service(ProbeJobProtocol.Tcp, port, ProbeWork.Monitor)],
      };
    }
    default:
      return null;
  }
}

/*
 * What a monitor reaches when the probe checks it: one destination a step.
 * None for a monitor type whose checks are not told by a host and port
 * (synthetic and custom code monitors run whatever their script does).
 */
export function getMonitorTargets(
  monitorType: MonitorType | undefined | null,
  monitorSteps: MonitorSteps | undefined | null,
): Array<ProbeJobTarget> {
  if (!monitorType || !PROBE_JOB_MONITOR_TYPES.includes(monitorType)) {
    return [];
  }

  const targets: Array<ProbeJobTarget> = [];

  for (const step of monitorSteps?.data?.monitorStepsInstanceArray || []) {
    const target: ProbeJobTarget | null = getStepTarget(monitorType, step);

    if (target) {
      targets.push(target);
    }
  }

  return targets;
}
