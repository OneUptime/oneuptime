import { JSONObject } from "../JSON";
import ExternalStatusPageProviderType from "./ExternalStatusPageProviderType";

export default interface MonitorStepExternalStatusPageMonitor {
  statusPageUrl: string;
  provider: ExternalStatusPageProviderType;
  componentGroupName?: string | undefined; // optional: scope to a specific component group (e.g. "APIs")
  componentName?: string | undefined; // optional: filter to a specific component (applied within the group when a group is set)
  timeout: number;
  retries: number;
}

export class MonitorStepExternalStatusPageMonitorUtil {
  public static getDefault(): MonitorStepExternalStatusPageMonitor {
    return {
      statusPageUrl: "",
      provider: ExternalStatusPageProviderType.Auto,
      componentGroupName: undefined,
      componentName: undefined,
      timeout: 10000,
      retries: 3,
    };
  }

  public static fromJSON(
    json: JSONObject,
  ): MonitorStepExternalStatusPageMonitor {
    return {
      statusPageUrl: (json["statusPageUrl"] as string) || "",
      provider:
        (json["provider"] as ExternalStatusPageProviderType) ||
        ExternalStatusPageProviderType.Auto,
      componentGroupName: (json["componentGroupName"] as string) || undefined,
      componentName: (json["componentName"] as string) || undefined,
      timeout: (json["timeout"] as number) || 10000,
      retries: (json["retries"] as number) || 3,
    };
  }

  public static toJSON(
    monitor: MonitorStepExternalStatusPageMonitor,
  ): JSONObject {
    return {
      statusPageUrl: monitor.statusPageUrl,
      provider: monitor.provider,
      componentGroupName: monitor.componentGroupName,
      componentName: monitor.componentName,
      timeout: monitor.timeout,
      retries: monitor.retries,
    };
  }
}
