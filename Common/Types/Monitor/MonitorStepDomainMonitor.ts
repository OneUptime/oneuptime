import { JSONObject } from "../JSON";
import DomainLookupMethod from "./DomainMonitor/DomainLookupMethod";

export default interface MonitorStepDomainMonitor {
  domainName: string;
  lookupMethod: DomainLookupMethod;
  timeout: number;
  retries: number;
}

export class MonitorStepDomainMonitorUtil {
  public static getDefault(): MonitorStepDomainMonitor {
    return {
      domainName: "",
      lookupMethod: DomainLookupMethod.Auto,
      timeout: 10000,
      retries: 3,
    };
  }

  public static fromJSON(json: JSONObject): MonitorStepDomainMonitor {
    return {
      domainName: (json["domainName"] as string) || "",
      /*
       * Monitors saved before RDAP support existed carry no lookupMethod at
       * all, and Auto is the behaviour they should get.
       */
      lookupMethod: MonitorStepDomainMonitorUtil.parseLookupMethod(
        json["lookupMethod"],
      ),
      timeout: (json["timeout"] as number) || 10000,
      retries: (json["retries"] as number) || 3,
    };
  }

  public static toJSON(monitor: MonitorStepDomainMonitor): JSONObject {
    return {
      domainName: monitor.domainName,
      lookupMethod: monitor.lookupMethod,
      timeout: monitor.timeout,
      retries: monitor.retries,
    };
  }

  public static parseLookupMethod(value: unknown): DomainLookupMethod {
    const values: Array<string> = Object.values(DomainLookupMethod);

    if (typeof value === "string" && values.includes(value)) {
      return value as DomainLookupMethod;
    }

    return DomainLookupMethod.Auto;
  }
}
