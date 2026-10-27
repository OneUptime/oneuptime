import { JSONObject } from "../JSON";
import ExternalStatusPageProviderType from "./ExternalStatusPageProviderType";
import { parseMonitorStepRetries } from "./MonitorStepRetries";
import ExternalStatusPageComponentNames from "../../Utils/Monitor/ExternalStatusPageComponentNames";

export default interface MonitorStepExternalStatusPageMonitor {
  statusPageUrl: string;
  provider: ExternalStatusPageProviderType;
  componentGroupName?: string | undefined; // optional: scope to a specific component group (e.g. "APIs")
  /*
   * The components the monitor watches, by name; none, the whole page (or
   * group). A name watches the component of exactly that name, and a "*" in
   * it stands for any text (ExternalStatusPageComponentNames). Read through
   * getComponentNames: a monitor saved before this list has only
   * componentName.
   */
  componentNames?: Array<string> | undefined;
  /*
   * The one Component Name Filter a monitor had before it could watch
   * several components: every component whose name contains it. Kept, and
   * written for the list (withComponentNames), because a probe that has not
   * been upgraded reads only this: getComponentNames reads it as that name
   * between stars, which watches the same components.
   */
  componentName?: string | undefined;
  timeout: number;
  retries: number;
}

export class MonitorStepExternalStatusPageMonitorUtil {
  public static getDefault(): MonitorStepExternalStatusPageMonitor {
    return {
      statusPageUrl: "",
      provider: ExternalStatusPageProviderType.Auto,
      componentGroupName: undefined,
      componentNames: [],
      componentName: undefined,
      timeout: 10000,
      retries: 3,
    };
  }

  /*
   * The names of the components a monitor watches: its list, or for a
   * monitor saved before the list, its one name filter between stars
   * (ExternalStatusPageComponentNames.fromLegacyName). None: the whole page.
   */
  public static getComponentNames(
    monitor:
      | Pick<
          MonitorStepExternalStatusPageMonitor,
          "componentNames" | "componentName"
        >
      | JSONObject
      | undefined
      | null,
  ): Array<string> {
    if (!monitor) {
      return [];
    }

    const record: Record<string, unknown> = monitor as Record<string, unknown>;

    if (Array.isArray(record["componentNames"])) {
      return ExternalStatusPageComponentNames.normalize(
        record["componentNames"],
      );
    }

    return ExternalStatusPageComponentNames.fromLegacyName(
      record["componentName"],
    );
  }

  /*
   * The monitor watching these components: the list, and the one name a
   * probe that has not been upgraded reads in its place
   * (ExternalStatusPageComponentNames.toLegacyName).
   */
  public static withComponentNames(
    monitor: MonitorStepExternalStatusPageMonitor,
    names: Array<string>,
  ): MonitorStepExternalStatusPageMonitor {
    const componentNames: Array<string> =
      ExternalStatusPageComponentNames.normalize(names);

    return {
      ...monitor,
      componentNames: componentNames,
      componentName:
        ExternalStatusPageComponentNames.toLegacyName(componentNames),
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
      componentNames:
        MonitorStepExternalStatusPageMonitorUtil.getComponentNames(json),
      componentName: (json["componentName"] as string) || undefined,
      timeout: (json["timeout"] as number) || 10000,
      // 0 retries is a real answer and must survive the round-trip.
      retries: parseMonitorStepRetries(json["retries"], 3),
    };
  }

  public static toJSON(
    monitor: MonitorStepExternalStatusPageMonitor,
  ): JSONObject {
    /*
     * A monitor saved before the list is written with it: its one name
     * filter, between stars. One that names nothing leaves the list out.
     */
    const hasNames: boolean =
      Array.isArray(monitor.componentNames) || Boolean(monitor.componentName);

    return {
      statusPageUrl: monitor.statusPageUrl,
      provider: monitor.provider,
      componentGroupName: monitor.componentGroupName,
      componentNames: hasNames
        ? MonitorStepExternalStatusPageMonitorUtil.getComponentNames(monitor)
        : undefined,
      componentName: monitor.componentName,
      timeout: monitor.timeout,
      retries: monitor.retries,
    };
  }
}
