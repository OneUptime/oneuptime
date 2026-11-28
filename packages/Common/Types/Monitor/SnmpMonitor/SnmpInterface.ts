import { SnmpFibreChannelPort } from "./SnmpFibreChannel";

/*
 * One row of the IF-MIB interface tables (ifTable + ifXTable), walked by the
 * probe when interface monitoring is enabled on an SNMP monitor.
 *
 * Octet/error/discard counters are cumulative since device boot (64-bit HC
 * counters preferred, 32-bit fallback). The `*PerSecond` and
 * `utilizationPercent` fields are NOT collected from the device — the server
 * computes them from the delta against the previous check before the
 * response is persisted, so they are absent on the first check after a
 * monitor is created and after a counter wrap or device reboot.
 */
export default interface SnmpInterface {
  interfaceIndex: number;
  name: string;
  alias?: string | undefined;
  isOperationallyUp: boolean;
  isAdministrativelyUp: boolean;
  /*
   * ifPhysAddress formatted as lowercase colon-separated hex
   * ("aa:bb:cc:dd:ee:ff"); undefined for interfaces with no MAC (loopbacks,
   * tunnels) or when the device returns an empty octet string.
   */
  macAddress?: string | undefined;
  // IANAifType number (ifType column) — 6 = ethernetCsmacd, 24 = loopback...
  interfaceType?: number | undefined;
  speedInBitsPerSecond?: number | undefined;
  inOctets?: number | undefined;
  outOctets?: number | undefined;
  inErrors?: number | undefined;
  outErrors?: number | undefined;
  inDiscards?: number | undefined;
  outDiscards?: number | undefined;

  /*
   * A Fibre Channel port's own state and error counters, read from the
   * switch vendor's MIB (Brocade's SW-MIB and FCMGMT-MIB, Cisco's
   * CISCO-FC-FE-MIB) and joined to this interface. Undefined on any other
   * port, and from probes that predate it.
   */
  fibreChannel?: SnmpFibreChannelPort | undefined;

  // Computed server-side from the previous check. See note above.
  inBitsPerSecond?: number | undefined;
  outBitsPerSecond?: number | undefined;
  utilizationPercent?: number | undefined;
  /*
   * ifInErrors and ifOutErrors per second - and, on a Fibre Channel port,
   * its error counters' rates (SnmpFibreChannelUtil.sumErrorRates).
   */
  errorsPerSecond?: number | undefined;
}
