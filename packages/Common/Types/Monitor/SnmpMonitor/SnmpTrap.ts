import SnmpSecurityLevel from "./SnmpSecurityLevel";
import { SnmpV3CredentialHolders } from "../../Probe/SnmpV3CredentialHolders";

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
   * SNMPv3 only: the sending SNMP engine, as hex - the engine a trap was
   * authenticated as, or an inform's contextEngineID. Tells apart devices
   * that share one address behind NAT, by the engine ID each one's polls
   * report (NetworkDevice.snmpEngineId, #11172).
   */
  engineId?: string | undefined;
  /*
   * SNMPv3 only, and only for a trap the probe authenticated: the records
   * that hold the credential it was signed with, as OneUptime handed them
   * to the probe (SnmpV3CredentialHolders). Says which projects may keep
   * the trap, which of the devices at its address carry that credential
   * (#11172), and which site a device not added yet belongs to (#11174).
   * Absent from probes older than #11172, and for a noAuthNoPriv trap,
   * whose user name proves nothing.
   */
  signedBy?: SnmpV3CredentialHolders | undefined;
  /*
   * SNMPv3 only, when not empty: the context the notification names. For a
   * logical switch of a Brocade Virtual Fabric it is "VF:<fabric ID>", and
   * it says which of the devices sharing the chassis' address the trap is
   * about (SnmpTrapContextRouting).
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
