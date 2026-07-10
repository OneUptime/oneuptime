import ProbeAttempt from "../../Probe/ProbeAttempt";
import SnmpDataType from "./SnmpDataType";
import SnmpInterface from "./SnmpInterface";

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
   * System-group identity (sysDescr / sysName), collected alongside the
   * interface walk. Used to enrich the NetworkDevice resource.
   */
  systemInfo?:
    | {
        sysDescr?: string | undefined;
        sysName?: string | undefined;
      }
    | undefined;
}
