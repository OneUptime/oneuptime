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
  /*
   * SNMPv3 only, when not empty: the context the notification names - for
   * a logical switch of a Brocade Virtual Fabric, "VF:<fabric ID>". It says
   * which of the devices sharing the address the trap is about
   * (SnmpTrapContextRouting). Filled in by probes that receive SNMPv3
   * traps (#11005); absent from every other.
   */
  contextName?: string | undefined;
  /*
   * The name of the interface the trap is about, when the trap names it only
   * by its ifIndex - a link trap, or an RMON alarm on a port's counter (an
   * MDS port-monitor alarm): the name the device's last walk recorded for
   * that index. Filled in by the server for each device the trap matched,
   * never by a probe.
   */
  interfaceName?: string | undefined;
}
