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
}
