import NetworkDevice from "../../Models/DatabaseModels/NetworkDevice";
import { DiscoveredNetworkDevice } from "../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkDeviceMonitoringMethod from "../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "../../Types/ObjectID";
import SnmpScanConfigUtil, {
  DiscoveryScanSnmpConfig,
} from "./SnmpScanConfigUtil";
import { monitoringMethodForDiscoveredHost } from "./DiscoveryImportEligibility";
import { normalizeReverseDnsName } from "./ReverseDnsNameUtil";

/*
 * One discovered host -> one NetworkDevice, the same way everywhere.
 *
 * This mapping used to live inline in the Dashboard's Discovery page import
 * loop. The server-side auto-import rule engine needs the identical recipe —
 * a host imported by a rule and the same host imported by hand must be the
 * same device — so the recipe lives here and both callers use it. Anything
 * added to one path by editing this file is automatically added to the other.
 */

/*
 * Longest device name the builder will emit.
 *
 * The name column is varchar(100) and the create path THROWS on overflow (no
 * truncation), but the real ceiling is the slug: it is slugify(name) plus a
 * dash and ten random digits into its own varchar(100), so a name over ~88
 * characters fails the create with a slug-length error even though the name
 * itself fits. SNMP sysName is a DisplayString of up to 255 octets, so
 * over-long names are routine on real gear, and the collision fallback below
 * appends up to 18 more characters (" (255.255.255.255)"). 80 leaves headroom
 * for both.
 */
export const MAX_DEVICE_NAME_LENGTH: number = 80;

// NetworkDevice.description is stored to 500 characters; sysDescr can be 255+.
export const MAX_DEVICE_DESCRIPTION_LENGTH: number = 500;

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.substring(0, maxLength) : value;
}

/**
 * What a discovered host is CALLED — in the Review dialog, and (clamped by
 * `buildDeviceName`) on the device it imports as.
 *
 * Three sources, in this order, first non-empty wins:
 *
 *   1. `sysName`, the name the device gives for itself over SNMP. It stays
 *      first because it always has been, and because it is the one name the
 *      device itself asserts: demoting it would silently rename devices that
 *      import correctly today, which nobody asked for.
 *   2. `dnsHostname`, its reverse-DNS (PTR) name (OneUptime issue #3529).
 *      This is the whole point of the addition, and it lands exactly where
 *      the complaint was: a host with no readable SNMP has no sysName, so
 *      before this it fell straight through to its address. On an estate that
 *      keeps DNS records — the reporter's does — that turns a review list of
 *      "10.18.166.51, 10.18.166.53, ..." into names an operator recognises.
 *   3. The address, unchanged, when neither name exists.
 *
 * Split out of `buildDeviceName` so the dashboard row and the device it
 * creates cannot disagree: the operator ticks a box next to a name, and that
 * is the name the device gets. Returned UNTRUNCATED — the display has its own
 * ellipsis and the 80-character ceiling exists for the slug, not the eye.
 */
export function getDiscoveredHostDisplayName(
  host: DiscoveredNetworkDevice,
): string {
  /*
   * The PTR name is re-normalised here rather than trusted from the column.
   * `discoveredDevices` is jsonb stored verbatim from the probe's payload, so
   * "the probe already checked it" holds only for the probe version that
   * wrote the row — not for a result from an older or a modified probe, and
   * not for a row written straight through the API. This function is the last
   * point before the value becomes a rendered line and a slugified device
   * name, so it is the right place to be sure. See ReverseDnsNameUtil.
   */
  return (
    (host.sysName || "").trim() ||
    normalizeReverseDnsName(host.dnsHostname) ||
    host.ipAddress
  );
}

/** The name a discovered host imports under, clamped to the slug's ceiling. */
export function buildDeviceName(host: DiscoveredNetworkDevice): string {
  return truncate(getDiscoveredHostDisplayName(host), MAX_DEVICE_NAME_LENGTH);
}

/**
 * The fallback name when `buildDeviceName`'s answer is already taken.
 *
 * Device names are unique per project, and two devices legitimately sharing a
 * sysName (a factory default, a cloned config) is common on real estates. The
 * address is what tells them apart, so it goes into the name — with the
 * sysName cut down first so the composed string still fits under the same
 * ceiling.
 */
export function buildFallbackDeviceName(host: DiscoveredNetworkDevice): string {
  const suffix: string = ` (${host.ipAddress})`;
  const baseName: string = buildDeviceName(host);

  return (
    truncate(baseName, Math.max(1, MAX_DEVICE_NAME_LENGTH - suffix.length)) +
    suffix
  );
}

/*
 * The scan columns the builder copies onto an SNMP device. The
 * NetworkDeviceDiscoveryScan model satisfies this structurally, so both the
 * dashboard (holding a scan model) and the rule engine (holding a scan row it
 * selected itself) can pass their scan straight in.
 *
 * `snmpConfigs` is the scan's ordered list of credential sets; the flattened
 * columns beside it are the single set a scan carried before that list existed
 * (and are still mirrored from the list's first entry). Neither is read
 * directly here — SnmpScanConfigUtil reconciles the two — but BOTH have to be
 * SELECTED by every caller, or the credentials silently arrive undefined and
 * the device is created unable to poll. That is what
 * Common/Tests/Server/Services/AutoImportScanCredentialSelect.test.ts pins.
 */
export interface DiscoveredDeviceScanSource {
  probeId?: ObjectID | undefined;
  snmpConfigs?: Array<DiscoveryScanSnmpConfig> | null | undefined;
  snmpVersion?: string | undefined;
  snmpCommunityString?: string | undefined;
  snmpPort?: number | undefined;
  snmpV3SecurityLevel?: string | undefined;
  snmpV3Username?: string | undefined;
  snmpV3AuthProtocol?: string | undefined;
  snmpV3AuthKey?: string | undefined;
  snmpV3PrivProtocol?: string | undefined;
  snmpV3PrivKey?: string | undefined;
}

/**
 * The NetworkDevice a discovered host imports as.
 *
 * An SNMP-reachable host becomes a polled device carrying the scan's probe
 * and credentials. A ping-only host becomes a monitor-backed device with no
 * probe, no credentials and polling off: it is recorded so it can belong to a
 * site and appear on the topology map, and binding a monitor to it stays a
 * separate, deliberate step.
 *
 * The caller supplies the name (normally `buildDeviceName(host)`) so the
 * name-collision retry can rebuild the same device under
 * `buildFallbackDeviceName(host)` without re-deciding anything else.
 */
export function buildNetworkDeviceFromDiscoveredHost(data: {
  projectId: ObjectID;
  host: DiscoveredNetworkDevice;
  scan: DiscoveredDeviceScanSource;
  name?: string | undefined;
  /*
   * Turn on the device's vendor-health-template auto-apply. The rule
   * engine sets this — a zero-touch import should end with health metrics,
   * not an empty OID list waiting for a click. The manual Review dialog
   * leaves it unset: an operator importing by hand gets the vendor banner
   * and decides, which is the existing contract for hand-made devices.
   */
  autoApplyVendorHealthTemplate?: boolean | undefined;
  /*
   * The OID Collection Template an auto-import rule linked this device to.
   * Set at create so the device collects its type's OIDs from its very first
   * poll, with nobody having to touch it afterwards.
   */
  oidTemplateId?: ObjectID | undefined;
}): NetworkDevice {
  const host: DiscoveredNetworkDevice = data.host;

  const device: NetworkDevice = new NetworkDevice();
  device.projectId = data.projectId;
  device.name = data.name || buildDeviceName(host);
  /*
   * The address is the device's hostname AND the registered-host dedup key.
   *
   * It stays the ADDRESS even when the host resolved a PTR name, which is
   * what issue #3529 asked for in as many words ("retain the IP address as
   * the address/IP field"), and what the rest of the system needs: this
   * column is what the ingest path matches a scan's results against
   * (NetworkDeviceService.getRegisteredHostnames), what the SNMP poller
   * dials, and what a trap's source IP is correlated to. Storing a name here
   * would make a device stop polling the day its reverse zone changed, and
   * would make the same host import twice — once by address, once by name.
   * The PTR record names the device; it does not address it.
   */
  device.hostname = host.ipAddress;

  if (host.sysDescr) {
    device.description = truncate(host.sysDescr, MAX_DEVICE_DESCRIPTION_LENGTH);
  }

  const monitoringMethod: NetworkDeviceMonitoringMethod =
    monitoringMethodForDiscoveredHost(host);
  device.monitoringMethod = monitoringMethod;

  if (monitoringMethod === NetworkDeviceMonitoringMethod.Monitor) {
    /*
     * A ping-only host is never SNMP-polled, so the vendor-template
     * auto-apply (which keys off a polled sysObjectID) stays off too.
     */
    device.isPollingEnabled = false;
    return device;
  }

  if (data.oidTemplateId) {
    device.oidTemplateId = data.oidTemplateId;
  }

  if (data.autoApplyVendorHealthTemplate) {
    device.autoApplyVendorHealthTemplate = true;
  }

  if (data.scan.probeId) {
    // Re-wrapped: the scan may hold a serialized id rather than an ObjectID.
    device.probeId = new ObjectID(data.scan.probeId.toString());
  }

  /*
   * THE credential set that answered this host, not the scan's first one.
   *
   * A scan can now try several, and the probe records which one worked as
   * `host.snmpConfigId`. Copying the scan's first set regardless would create
   * a device carrying a community string its device rejects — a device that
   * polls red forever, with nothing on it to say the credential is simply the
   * wrong one of several the scan holds.
   *
   * resolveForHost falls back to the first config when the host names none,
   * which is every result stored before this existed and every result from an
   * older probe; for a scan with no `snmpConfigs` that first config IS the
   * flattened columns, so those cases import exactly as they always did.
   */
  const snmpConfig: DiscoveryScanSnmpConfig = SnmpScanConfigUtil.resolveForHost(
    data.scan,
    host.snmpConfigId,
  );

  if (snmpConfig.snmpVersion) {
    device.snmpVersion = snmpConfig.snmpVersion;
  }

  if (snmpConfig.snmpCommunityString) {
    device.snmpCommunityString = snmpConfig.snmpCommunityString;
  }

  if (snmpConfig.snmpPort) {
    device.snmpPort = snmpConfig.snmpPort;
  }

  // Carry the v3 credentials so a v3 scan imports as a v3 device.
  if (snmpConfig.snmpV3SecurityLevel) {
    device.snmpV3SecurityLevel = snmpConfig.snmpV3SecurityLevel;
  }

  if (snmpConfig.snmpV3Username) {
    device.snmpV3Username = snmpConfig.snmpV3Username;
  }

  if (snmpConfig.snmpV3AuthProtocol) {
    device.snmpV3AuthProtocol = snmpConfig.snmpV3AuthProtocol;
  }

  if (snmpConfig.snmpV3AuthKey) {
    device.snmpV3AuthKey = snmpConfig.snmpV3AuthKey;
  }

  if (snmpConfig.snmpV3PrivProtocol) {
    device.snmpV3PrivProtocol = snmpConfig.snmpV3PrivProtocol;
  }

  if (snmpConfig.snmpV3PrivKey) {
    device.snmpV3PrivKey = snmpConfig.snmpV3PrivKey;
  }

  return device;
}
