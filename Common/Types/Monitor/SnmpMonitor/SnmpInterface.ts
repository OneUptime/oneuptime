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
  speedInBitsPerSecond?: number | undefined;
  inOctets?: number | undefined;
  outOctets?: number | undefined;
  inErrors?: number | undefined;
  outErrors?: number | undefined;
  inDiscards?: number | undefined;
  outDiscards?: number | undefined;

  // Computed server-side from the previous check. See note above.
  inBitsPerSecond?: number | undefined;
  outBitsPerSecond?: number | undefined;
  utilizationPercent?: number | undefined;
  errorsPerSecond?: number | undefined;
}
