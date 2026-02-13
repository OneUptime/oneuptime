import DnsRecordType from "./DnsRecordType";

export interface DnsRecordResponse {
  type: DnsRecordType;
  value: string;
  ttl?: number | undefined;
}

export default interface DnsMonitorResponse {
  isOnline: boolean;
  responseTimeInMs: number;
  failureCause: string;
  records: Array<DnsRecordResponse>;
  isDnssecValid?: boolean | undefined;
  isTimeout?: boolean | undefined;
}
