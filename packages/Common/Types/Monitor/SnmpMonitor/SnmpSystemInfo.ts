/*
 * The SNMPv2 system group (1.3.6.1.2.1.1), read by the probe alongside the
 * interface walk and by subnet discovery. sysObjectId is the vendor's
 * registered enterprise OID — the canonical device fingerprint used to
 * suggest a vendor OID template and derive the vendor name without MIBs.
 * sysUpTimeSeconds is converted from TimeTicks (hundredths of a second) on
 * the probe.
 */
export default interface SnmpSystemInfo {
  sysDescr?: string | undefined;
  sysName?: string | undefined;
  sysObjectId?: string | undefined;
  sysLocation?: string | undefined;
  sysContact?: string | undefined;
  sysUpTimeSeconds?: number | undefined;
  /*
   * The agent's SNMP engine ID, as hex in capitals, when it was polled over
   * SNMPv3: what its SNMPv3 traps are sent as (NetworkDevice.snmpEngineId,
   * #11172). Learned from the walk's own engine discovery, never asked for;
   * absent from a v1 or v2c poll and from probes older than #11172.
   */
  snmpEngineId?: string | undefined;
}
