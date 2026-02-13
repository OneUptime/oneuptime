import { JSONObject } from "../JSON";
import DnsRecordType from "./DnsMonitor/DnsRecordType";

export default interface MonitorStepDnsMonitor {
  queryName: string;
  recordType: DnsRecordType;
  hostname?: string | undefined; // DNS server (e.g. "8.8.8.8"), empty = system default
  port: number;
  timeout: number;
  retries: number;
}

export class MonitorStepDnsMonitorUtil {
  public static getDefault(): MonitorStepDnsMonitor {
    return {
      queryName: "",
      recordType: DnsRecordType.A,
      hostname: "",
      port: 53,
      timeout: 5000,
      retries: 3,
    };
  }

  public static fromJSON(json: JSONObject): MonitorStepDnsMonitor {
    return {
      queryName: (json["queryName"] as string) || "",
      recordType: (json["recordType"] as DnsRecordType) || DnsRecordType.A,
      hostname: (json["hostname"] as string) || undefined,
      port: (json["port"] as number) || 53,
      timeout: (json["timeout"] as number) || 5000,
      retries: (json["retries"] as number) || 3,
    };
  }

  public static toJSON(monitor: MonitorStepDnsMonitor): JSONObject {
    return {
      queryName: monitor.queryName,
      recordType: monitor.recordType,
      hostname: monitor.hostname,
      port: monitor.port,
      timeout: monitor.timeout,
      retries: monitor.retries,
    };
  }
}
