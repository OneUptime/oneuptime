import SnmpSecurityLevel from "./SnmpSecurityLevel";

export interface SnmpTrapVarbind {
  oid: string;
  value: string;
}

/*
 * An SNMP trap (or inform) received by a probe's trap receiver and forwarded
 * to the server. For v1 traps the trapOid is derived from the standard
 * generic-trap mapping (e.g. linkDown → 1.3.6.1.6.3.1.1.5.3) or
 * enterprise.0.specific for enterprise traps; for v2c/v3 it is the value of
 * the snmpTrapOID.0 varbind.
 *
 * What says who sent it depends on the version: a v1 or v2c trap carries a
 * community string, an SNMPv3 one the user it was authenticated as
 * (securityName) and how (securityLevel). A v3 trap reaches the server only
 * after the probe authenticated it with that user's keys, and decrypted it
 * when it was encrypted; one it could not is refused at the probe and never
 * forwarded (SnmpTrapReceiverReport says how many, and why).
 */
export default interface SnmpTrap {
  sourceIpAddress: string;
  trapOid: string;
  snmpVersion: string;
  community?: string | undefined;
  receivedAt: Date;
  varbinds: Array<SnmpTrapVarbind>;
  /*
   * An inform rather than a trap: the sender asked for an acknowledgement,
   * and the probe sent it. Absent from probes older than SNMPv3 traps.
   */
  isInform?: boolean | undefined;
  // SNMPv3 only: the USM user name the notification was authenticated as.
  securityName?: string | undefined;
  // SNMPv3 only: whether it was authenticated, and encrypted.
  securityLevel?: SnmpSecurityLevel | undefined;
  /*
   * SNMPv3 only: the sending SNMP engine (the scoped PDU's contextEngineID),
   * as hex. Tells apart devices that share one address behind NAT.
   */
  engineId?: string | undefined;
  // SNMPv3 only, when not empty: the context the notification names.
  contextName?: string | undefined;
}
