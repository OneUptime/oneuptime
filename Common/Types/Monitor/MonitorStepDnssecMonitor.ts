import { JSONObject } from "../JSON";

export default interface MonitorStepDnssecMonitor {
  domainName: string;
  resolvers: Array<string>;
  checkNameserverConsistency: boolean;
  signatureExpiryWarningDays: number;
  timeout: number;
  retries: number;
}

export class MonitorStepDnssecMonitorUtil {
  public static getDefault(): MonitorStepDnssecMonitor {
    return {
      domainName: "",
      resolvers: ["1.1.1.1", "8.8.8.8", "9.9.9.9"],
      checkNameserverConsistency: true,
      signatureExpiryWarningDays: 7,
      timeout: 10000,
      retries: 3,
    };
  }

  public static fromJSON(json: JSONObject): MonitorStepDnssecMonitor {
    const defaults: MonitorStepDnssecMonitor =
      MonitorStepDnssecMonitorUtil.getDefault();

    const resolvers: Array<string> = Array.isArray(json["resolvers"])
      ? (json["resolvers"] as Array<string>).filter((value: unknown) => {
          return typeof value === "string" && value.length > 0;
        })
      : defaults.resolvers;

    return {
      domainName: (json["domainName"] as string) || "",
      resolvers: resolvers.length > 0 ? resolvers : defaults.resolvers,
      checkNameserverConsistency:
        typeof json["checkNameserverConsistency"] === "boolean"
          ? (json["checkNameserverConsistency"] as boolean)
          : defaults.checkNameserverConsistency,
      signatureExpiryWarningDays:
        (json["signatureExpiryWarningDays"] as number) ||
        defaults.signatureExpiryWarningDays,
      timeout: (json["timeout"] as number) || defaults.timeout,
      retries: (json["retries"] as number) || defaults.retries,
    };
  }

  public static toJSON(monitor: MonitorStepDnssecMonitor): JSONObject {
    return {
      domainName: monitor.domainName,
      resolvers: monitor.resolvers,
      checkNameserverConsistency: monitor.checkNameserverConsistency,
      signatureExpiryWarningDays: monitor.signatureExpiryWarningDays,
      timeout: monitor.timeout,
      retries: monitor.retries,
    };
  }
}
