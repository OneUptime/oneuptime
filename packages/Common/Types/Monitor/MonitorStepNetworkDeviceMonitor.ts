import { JSONObject } from "../JSON";
import SnmpOid from "./SnmpMonitor/SnmpOid";

/*
 * Step configuration for Network Device monitors. The step is purely a
 * device reference: the NetworkDevice resource owns the hostname,
 * credentials, polling schedule, interface walks, endpoint discovery, and
 * health OIDs. The monitor is the alerting layer — it is evaluated
 * server-side against the device's walk results and traps.
 */
export default interface MonitorStepNetworkDeviceMonitor {
  networkDeviceId: string | undefined;
  /*
   * DEPRECATED: interface walking is now configured on the NetworkDevice
   * (walkInterfaces). Retained so steps saved before the move still parse;
   * never written by the dashboard anymore.
   */
  monitorInterfaces: boolean;
  /*
   * DEPRECATED: endpoint collection is now configured on the NetworkDevice
   * (collectEndpoints). Retained for parsing legacy steps only.
   */
  collectEndpoints?: boolean | undefined;
  /*
   * DEPRECATED: health OIDs are now configured on the NetworkDevice
   * (snmpOids). Retained for parsing legacy steps only.
   */
  oids: Array<SnmpOid>;
}

export class MonitorStepNetworkDeviceMonitorUtil {
  public static getDefault(): MonitorStepNetworkDeviceMonitor {
    return {
      networkDeviceId: undefined,
      monitorInterfaces: true,
      // Off by default; the form renders it as an explicit opt-in switch.
      collectEndpoints: false,
      oids: [],
    };
  }

  public static fromJSON(json: JSONObject): MonitorStepNetworkDeviceMonitor {
    return {
      networkDeviceId: (json["networkDeviceId"] as string) || undefined,
      monitorInterfaces: json["monitorInterfaces"] !== false,
      /*
       * Unlike monitorInterfaces, this is default-FALSE: only an explicit
       * true opts in, so steps saved before the flag existed stay off.
       */
      collectEndpoints: json["collectEndpoints"] === true,
      oids: ((json["oids"] as Array<JSONObject>) || []).map(
        (oid: JSONObject) => {
          return {
            oid: (oid["oid"] as string) || "",
            name: (oid["name"] as string) || undefined,
            description: (oid["description"] as string) || undefined,
          };
        },
      ),
    };
  }

  public static toJSON(monitor: MonitorStepNetworkDeviceMonitor): JSONObject {
    return {
      networkDeviceId: monitor.networkDeviceId,
      monitorInterfaces: monitor.monitorInterfaces,
      collectEndpoints: monitor.collectEndpoints,
      oids: monitor.oids.map((oid: SnmpOid) => {
        return {
          oid: oid.oid,
          name: oid.name,
          description: oid.description,
        };
      }),
    };
  }
}
