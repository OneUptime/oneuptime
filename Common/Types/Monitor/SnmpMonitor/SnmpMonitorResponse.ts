import ProbeAttempt from "../../Probe/ProbeAttempt";
import SnmpDataType from "./SnmpDataType";
import SnmpInterface from "./SnmpInterface";
import LldpNeighbor from "./LldpNeighbor";
import CdpNeighbor from "./CdpNeighbor";
import ArpEntry from "./ArpEntry";
import FdbEntry from "./FdbEntry";
import SnmpSystemInfo from "./SnmpSystemInfo";
import SnmpEntityInfo from "./SnmpEntityInfo";

export interface SnmpOidResponse {
  oid: string;
  name?: string | undefined;
  value: string | number | null;
  type: SnmpDataType;
}

export default interface SnmpMonitorResponse {
  isOnline: boolean;
  responseTimeInMs: number;
  failureCause: string;
  oidResponses: Array<SnmpOidResponse>;
  isTimeout?: boolean | undefined;
  probeAttempts?: Array<ProbeAttempt> | undefined;
  totalAttempts?: number | undefined;
  /*
   * Populated when interface monitoring is enabled on the monitor step.
   * Undefined on older probes and when the interface walk failed (the
   * failure is recorded in interfaceWalkFailure).
   */
  interfaces?: Array<SnmpInterface> | undefined;
  interfaceWalkFailure?: string | undefined;
  /*
   * System-group identity, collected alongside the interface walk. Used to
   * enrich the NetworkDevice resource. Older probes send only
   * sysDescr/sysName.
   */
  systemInfo?: SnmpSystemInfo | undefined;
  /*
   * ENTITY-MIB hardware identity (manufacturer/model/serial/firmware),
   * collected alongside the interface walk on devices that implement it.
   */
  entityInfo?: SnmpEntityInfo | undefined;
  /*
   * LLDP neighbors discovered during the walk (when interface monitoring is
   * enabled). Used to build the network topology graph.
   */
  lldpNeighbors?: Array<LldpNeighbor> | undefined;
  /*
   * CDP neighbors, walked as a complement to LLDP for Cisco estates.
   * Undefined on older probes and non-CDP devices.
   */
  cdpNeighbors?: Array<CdpNeighbor> | undefined;
  /*
   * ARP / IP-to-media entries, walked when endpoint collection is enabled
   * on the monitor step. Undefined on older probes.
   */
  arpEntries?: Array<ArpEntry> | undefined;
  /*
   * Bridge forwarding-database entries — MAC addresses learned per bridge
   * port. Undefined on older probes and non-bridge devices.
   */
  fdbEntries?: Array<FdbEntry> | undefined;
}
