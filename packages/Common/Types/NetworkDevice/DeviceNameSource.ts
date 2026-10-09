/*
 * Where a network device's name came from, when discovery chose it
 * (OneUptime issue #4518).
 *
 * Discovery names a device by the best name it can find for it, and the four
 * places a name can come from are ranked: the device's own name first, the
 * name DNS gives it next, its address last (DeviceNameRule.ts says why). The
 * rank is what lets a later scan IMPROVE a name discovery chose — a device
 * imported by its address, or by its DNS name, takes the device's own name
 * when a scan finds it — without ever trading a name for a worse one, and
 * without ever touching a name a person typed (see
 * NetworkDevice.discoveredName).
 *
 * Short kebab-case strings, like the discovery naming-status codes beside
 * this file: the value is stored on the device and read back out of rows and
 * API payloads, so every reader goes through readDeviceNameSource below,
 * which answers undefined for anything that is not one of these exact
 * strings.
 */
export enum DeviceNameSource {
  /*
   * The name the device reports for itself over SNMP (sysName). Configured
   * on the device by whoever runs it.
   */
  SystemName = "system-name",
  /*
   * The name a Windows or Samba host reports for itself over NetBIOS — its
   * computer name, as Windows shows it (OneUptime issues #3677, #4518).
   */
  NetbiosName = "netbios-name",
  /*
   * The device's reverse-DNS (PTR) record, published by whoever runs DNS for
   * its address (OneUptime issue #3529). Shortened to its first label when the
   * scan asks for short names.
   */
  DnsName = "dns-name",
  // The device's IP address, when nothing names it.
  Address = "address",
}

/*
 * Best first. The device's own names lead because they are the names the
 * people who run the device use for it; DNS follows because it is a name
 * someone published for the address, not one the device answers to; the
 * address is what is left.
 */
export const DEVICE_NAME_SOURCES_BEST_FIRST: ReadonlyArray<DeviceNameSource> = [
  DeviceNameSource.SystemName,
  DeviceNameSource.NetbiosName,
  DeviceNameSource.DnsName,
  DeviceNameSource.Address,
];

const KNOWN_SOURCES: ReadonlySet<string> = new Set<string>(
  DEVICE_NAME_SOURCES_BEST_FIRST,
);

/**
 * The source a stored value names, or undefined for anything else: null, a
 * number, a different spelling, a source a newer release added. Undefined is
 * read everywhere as "discovery did not choose this name", which is the safe
 * answer — a device whose source cannot be read is never renamed.
 */
export function readDeviceNameSource(
  value: unknown,
): DeviceNameSource | undefined {
  if (typeof value !== "string" || !KNOWN_SOURCES.has(value)) {
    return undefined;
  }

  return value as DeviceNameSource;
}

/**
 * How good a source's names are: higher is better, the address is 1. Only
 * the ORDER means anything; the numbers are not stored anywhere.
 */
export function getDeviceNameSourceRank(source: DeviceNameSource): number {
  const index: number = DEVICE_NAME_SOURCES_BEST_FIRST.indexOf(source);

  if (index < 0) {
    return 0;
  }

  return DEVICE_NAME_SOURCES_BEST_FIRST.length - index;
}

/**
 * True when a name from `candidate` is strictly better than one from
 * `current`. Equal sources are not better: a name is improved, never merely
 * changed, so a device whose DNS record changes keeps the name discovery
 * gave it, and two answers that disagree from one scan to the next cannot
 * make a device's name flap.
 */
export function isBetterDeviceNameSource(
  candidate: DeviceNameSource,
  current: DeviceNameSource,
): boolean {
  return getDeviceNameSourceRank(candidate) > getDeviceNameSourceRank(current);
}

export default DeviceNameSource;
