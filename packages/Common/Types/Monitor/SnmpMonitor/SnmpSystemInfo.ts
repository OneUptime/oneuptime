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
   * The agent's SNMP engine ID, as hex in capitals: what its SNMPv3 traps
   * are sent as (NetworkDevice.snmpEngineId, #11172). An SNMPv3 poll learns
   * it from its own engine discovery; a network device's v1 or v2c poll
   * reads it from the device's own agent, as snmpEngineID.0 over its
   * community or by SNMPv3 discovery at its polling address (#11405).
   * Absent when the agent says none, and from older probes.
   */
  snmpEngineId?: string | undefined;
}
