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
}
