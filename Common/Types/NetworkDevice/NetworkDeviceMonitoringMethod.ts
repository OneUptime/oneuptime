/*
 * How a NetworkDevice's health is established.
 *
 * The network product was built around SNMP: a device is a thing an assigned
 * probe walks on a schedule, and everything downstream — the status pill, the
 * site rollup, the topology map — reads freshness off `lastSeenAt`, which only
 * a successful walk ever stamps.
 *
 * Plenty of real gear cannot be walked. Consumer APs, PDUs, cameras, anything
 * with SNMP disabled by policy: an operator tracks those with an ordinary Ping
 * or IP monitor. They are as real a part of the network as the switch they
 * hang off, and before this existed they could not be recorded as devices at
 * all — so they were absent from the site hierarchy and from the topology map,
 * which is what issue #3023 is about.
 *
 * `Monitor` is that second answer: no probe, no credentials, no polling; the
 * bound Monitor's status IS the device's status, stamped through the same
 * bridge that already stamps SNMP devices watched by a Network Device monitor.
 *
 * Stored as free text on the column (the SnmpVersion precedent), so parse it
 * through `NetworkDeviceMonitoringMethodUtil.parse` rather than comparing the
 * raw column: rows written before this existed hold NULL and must read as
 * `Snmp`, which is what they are.
 */
export enum NetworkDeviceMonitoringMethod {
  // An assigned probe walks the device over SNMP on its own schedule.
  Snmp = "SNMP",
  // No polling; a bound Monitor (Ping, IP, Port, ...) reports its health.
  Monitor = "Monitor",
}

export class NetworkDeviceMonitoringMethodUtil {
  /*
   * NULL, empty and anything unrecognised read as Snmp — that is what every
   * device created before this column existed is, and defaulting a device
   * into "monitor-backed" would silently stop it being polled.
   */
  public static parse(
    value: string | undefined | null,
  ): NetworkDeviceMonitoringMethod {
    if ((value || "").trim().toLowerCase() === "monitor") {
      return NetworkDeviceMonitoringMethod.Monitor;
    }
    return NetworkDeviceMonitoringMethod.Snmp;
  }

  public static isMonitorBacked(value: string | undefined | null): boolean {
    return (
      NetworkDeviceMonitoringMethodUtil.parse(value) ===
      NetworkDeviceMonitoringMethod.Monitor
    );
  }
}

export default NetworkDeviceMonitoringMethod;
