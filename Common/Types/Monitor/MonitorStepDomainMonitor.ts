import { JSONObject } from "../JSON";

export default interface MonitorStepDomainMonitor {
  domainName: string;
  timeout: number;
  retries: number;
}

export class MonitorStepDomainMonitorUtil {
  public static getDefault(): MonitorStepDomainMonitor {
    return {
      domainName: "",
      timeout: 10000,
      retries: 3,
    };
  }

  public static fromJSON(json: JSONObject): MonitorStepDomainMonitor {
    return {
      domainName: (json["domainName"] as string) || "",
      timeout: (json["timeout"] as number) || 10000,
      retries: (json["retries"] as number) || 3,
    };
  }

  public static toJSON(monitor: MonitorStepDomainMonitor): JSONObject {
    return {
      domainName: monitor.domainName,
      timeout: monitor.timeout,
      retries: monitor.retries,
    };
  }
}
