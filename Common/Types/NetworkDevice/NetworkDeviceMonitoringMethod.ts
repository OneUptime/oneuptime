/*
 * How a NetworkDevice's health is established.
 *
 * A device is the unit; reachability is a built-in capability of every device
 * a probe polls, and SNMP is an enrichment layered on top when credentials
 * exist. That is what `Probe` means: the assigned probe pings the device on
 * its own schedule, and walks it over SNMP as well whenever it has usable
 * credentials (its own, or through a credential profile). A device with no
 * credentials is simply pinged — it still has a status from its first poll,
 * still belongs to a site, still appears on the map.
 *
 * `Monitor` is the override for gear a probe cannot reach at all, or whose
 * health is better judged by an HTTP or port check: no polling; the bound
 * Monitor's status IS the device's status, stamped through the same bridge
 * that stamps every other device.
 *
 * HISTORY. The product started SNMP-first: the first value was "SNMP", and
 * everything that could not be walked had to be `Monitor`-backed, which meant
 * a Ping monitor per phone and per camera (issue #3023, #3447). Rows written
 * in that era hold "SNMP" or NULL, and both read as `Probe` — they were
 * probe-polled devices all along, the probe just did not ping them yet.
 *
 * Stored as free text on the column (the SnmpVersion precedent), so parse it
 * through `NetworkDeviceMonitoringMethodUtil.parse` rather than comparing the
 * raw column: NULL, "", "SNMP" and anything unrecognised must read as
 * `Probe`, and defaulting a device into "monitor-backed" would silently stop
 * it being polled.
 */
export enum NetworkDeviceMonitoringMethod {
  /*
   * The assigned probe pings the device on its schedule, and walks it over
   * SNMP as well whenever it has usable credentials.
   */
  Probe = "Probe",
  // No polling; a bound Monitor (Ping, IP, Port, HTTP, ...) reports its health.
  Monitor = "Monitor",
}

/*
 * The value every device written before ping-first polling carries. Kept as
 * a named constant for the parser, the normalising data migration and tests;
 * it is not a value the product writes any more.
 */
export const LEGACY_SNMP_MONITORING_METHOD: string = "SNMP";

export class NetworkDeviceMonitoringMethodUtil {
  /*
   * NULL, empty, the legacy "SNMP" and anything unrecognised read as Probe —
   * that is what every device created before this column (or before
   * ping-first polling) is, and defaulting a device into "monitor-backed"
   * would silently stop it being polled.
   */
  public static parse(
    value: string | undefined | null,
  ): NetworkDeviceMonitoringMethod {
    if ((value || "").trim().toLowerCase() === "monitor") {
      return NetworkDeviceMonitoringMethod.Monitor;
    }
    return NetworkDeviceMonitoringMethod.Probe;
  }

  public static isMonitorBacked(value: string | undefined | null): boolean {
    return (
      NetworkDeviceMonitoringMethodUtil.parse(value) ===
      NetworkDeviceMonitoringMethod.Monitor
    );
  }

  /** The complement of isMonitorBacked: the assigned probe polls the device. */
  public static isProbePolled(value: string | undefined | null): boolean {
    return !NetworkDeviceMonitoringMethodUtil.isMonitorBacked(value);
  }
}

export default NetworkDeviceMonitoringMethod;
