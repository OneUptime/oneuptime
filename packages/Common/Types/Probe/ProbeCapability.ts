/*
 * What a probe build can do. A probe declares its capabilities on every
 * control-plane request (`probeCapabilities` in the request body), so the
 * server can tailor what it hands a probe, and read what comes back from
 * it, by what that probe understands. A probe that predates a capability
 * never declares it.
 *
 * Add a capability only in the build whose code honours it.
 */
enum ProbeCapability {
  /*
   * The network-device poll job pings devices and reports a top-level
   * isOnline plus pingResponse, so the server may hand this probe
   * credential-less (ping-only) devices.
   */
  NetworkDevicePing = "networkDevicePing",
  /*
   * The probe walks the SNMP tables a device's poll config lists, and every
   * SNMP walk it reports for such a config carries `tableResults`: one
   * entry per table, with its rows or why it could not be walked. A walk
   * WITHOUT `tableResults` from a probe that declares this was handed no
   * tables. Probes from before SNMP tables (version 14.0.18) walk a
   * device's OIDs and interfaces but not its tables; probes from 14.0.18
   * until this capability was added walk them but do not declare it.
   */
  SnmpTables = "snmpTables",
}

// The first probe release that walks SNMP tables.
export const FIRST_PROBE_VERSION_WITH_SNMP_TABLES: string = "14.0.18";

// How many capabilities, of how many characters, a request is read for.
export const MAX_PROBE_CAPABILITIES: number = 32;
export const MAX_PROBE_CAPABILITY_LENGTH: number = 64;

export class ProbeCapabilityUtil {
  /*
   * The capabilities a request body declares, as the server keeps them:
   * strings only, trimmed, de-duplicated and bounded. Anything that is not
   * a list reads as no capabilities at all - an older probe sends none.
   */
  public static parse(value: unknown): Array<string> {
    if (!Array.isArray(value)) {
      return [];
    }

    const capabilities: Array<string> = [];

    for (const entry of value) {
      if (capabilities.length >= MAX_PROBE_CAPABILITIES) {
        break;
      }

      if (typeof entry !== "string") {
        continue;
      }

      const capability: string = entry.trim();

      if (
        !capability ||
        capability.length > MAX_PROBE_CAPABILITY_LENGTH ||
        capabilities.includes(capability)
      ) {
        continue;
      }

      capabilities.push(capability);
    }

    return capabilities;
  }

  public static has(
    capabilities: Array<string> | undefined,
    capability: ProbeCapability,
  ): boolean {
    return Array.isArray(capabilities) && capabilities.includes(capability);
  }
}

export default ProbeCapability;
