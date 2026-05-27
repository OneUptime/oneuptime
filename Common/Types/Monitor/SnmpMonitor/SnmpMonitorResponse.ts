import ProbeAttempt from "../../Probe/ProbeAttempt";
import SnmpDataType from "./SnmpDataType";

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
}
