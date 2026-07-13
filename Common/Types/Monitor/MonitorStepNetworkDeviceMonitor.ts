import { JSONObject } from "../JSON";
import SnmpOid from "./SnmpMonitor/SnmpOid";

/*
 * Step configuration for Network Device monitors. Unlike the retired SNMP
 * monitor type, the step carries no connection details — it references a
 * NetworkDevice resource which owns the hostname, credentials, and
 * interface inventory. The server hydrates the device's SNMP config into
 * the step (as `snmpMonitor`) when handing work to probes.
 */
export default interface MonitorStepNetworkDeviceMonitor {
  networkDeviceId: string | undefined;
  monitorInterfaces: boolean;
  oids: Array<SnmpOid>;
}

export class MonitorStepNetworkDeviceMonitorUtil {
  public static getDefault(): MonitorStepNetworkDeviceMonitor {
    return {
      networkDeviceId: undefined,
      monitorInterfaces: true,
      oids: [],
    };
  }

  public static fromJSON(json: JSONObject): MonitorStepNetworkDeviceMonitor {
    return {
      networkDeviceId: (json["networkDeviceId"] as string) || undefined,
      monitorInterfaces: json["monitorInterfaces"] !== false,
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
