import NetworkControllerProvider from "../../Types/NetworkController/NetworkControllerProvider";
import {
  NetworkDeviceControllerReading,
  NetworkDeviceDiscoveredValue,
  NetworkDeviceDiscoveryMethod,
  NetworkDeviceDiscoveryReader,
} from "../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";

/*
 * Where one asset detail came from, and when it was read (OneUptime issue
 * #5185: "users should be able to see when details were last discovered and,
 * where possible, which source supplied them").
 *
 * One vocabulary for hosts and network devices, so the Asset Details card
 * says it the same way for both. Pure data: the Dashboard turns it into a
 * sentence in the reader's language (Components/Inventory/AssetFactSourceText).
 */
export enum AssetFactSourceKind {
  // A network device's own SNMP poll; `readAt` is its last successful walk.
  SnmpPoll = "snmpPoll",
  /*
   * A value discovery read about the device: a discovery scan, a walked
   * router's ARP table, its probe's DNS lookup. `method`, `readBy` and
   * `readAt` say which, who and when.
   */
  Discovered = "discovered",
  /*
   * A MAC address learned from a walked router's ARP table before OneUptime
   * recorded which router or when (issue #5185 started recording both).
   */
  LearnedFromArp = "learnedFromArp",
  /*
   * A value saved on the device record: typed by a person, set through the
   * API or Terraform, or kept from the scan it was imported from. Never
   * overwritten by discovery.
   */
  Saved = "saved",
  // The address the device's probe polls it at.
  PolledAddress = "polledAddress",
  // The device role someone assigned.
  AssignedRole = "assignedRole",
  // The Network Site the device is assigned to.
  Site = "site",
  /*
   * Worked out from what the machine reports and what it is called (a
   * device's type when nobody assigned a role, a host's from its OS).
   */
  Classified = "classified",
  // A host's OpenTelemetry collector; `readAt` is its last report.
  Collector = "collector",
  // A host's cloud zone, standing in for a location it does not report.
  CloudPlacement = "cloudPlacement",
  /*
   * What the device's network controller says it is - the Meraki dashboard
   * of an organization the project reads. `readBy` is the connection that
   * read it, `readAt` when, and `provider` which controller.
   */
  Controller = "controller",
}

export interface AssetFactSource {
  kind: AssetFactSourceKind;
  // How a discovered value was read.
  method?: NetworkDeviceDiscoveryMethod | undefined;
  // Who read it: the scan, the walked device, the probe, the connection.
  readBy?: NetworkDeviceDiscoveryReader | undefined;
  // When it was read (ISO-8601), when that is known.
  readAt?: string | undefined;
  // Which controller, for a controller's reading ("meraki").
  provider?: NetworkControllerProvider | undefined;
}

/*
 * A value discovery read that differs from the one saved on the device. The
 * saved value is what is shown, and kept; this is shown beside it so nobody
 * has to wonder whether discovery saw the same thing.
 */
export interface AssetFactDifference {
  value: string;
  source: AssetFactSource;
}

// The source of a value discovery read.
export function sourceOfDiscoveredValue(
  entry: NetworkDeviceDiscoveredValue,
): AssetFactSource {
  return {
    kind: AssetFactSourceKind.Discovered,
    method: entry.method,
    readBy: entry.readBy,
    readAt: entry.readAt,
  };
}

// The source of what a device's controller says about it.
export function sourceOfControllerReading(
  reading: NetworkDeviceControllerReading,
): AssetFactSource {
  return {
    kind: AssetFactSourceKind.Controller,
    readBy: reading.readBy,
    readAt: reading.readAt,
    provider: reading.provider,
  };
}

/*
 * True when the source is something OneUptime read by itself, which is what
 * makes it replaceable by a newer reading. A saved value, an assigned role or
 * site, and the polled address are a person's (or the API's) and never are.
 */
export function isAutomaticAssetFactSource(
  source: AssetFactSource | undefined,
): boolean {
  if (!source) {
    return false;
  }

  return (
    source.kind === AssetFactSourceKind.SnmpPoll ||
    source.kind === AssetFactSourceKind.Discovered ||
    source.kind === AssetFactSourceKind.LearnedFromArp ||
    source.kind === AssetFactSourceKind.Collector ||
    source.kind === AssetFactSourceKind.Controller
  );
}

export default AssetFactSource;
