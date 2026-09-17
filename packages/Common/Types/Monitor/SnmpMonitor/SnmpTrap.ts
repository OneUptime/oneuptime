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
 */
export default interface SnmpTrap {
  sourceIpAddress: string;
  trapOid: string;
  snmpVersion: string;
  community?: string | undefined;
  receivedAt: Date;
  varbinds: Array<SnmpTrapVarbind>;
}
