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
  /*
   * When true, the probe also walks the device's ARP cache and bridge
   * forwarding database during the interface walk, so the server can
   * discover endpoints (laptops, printers, POS terminals) attached to the
   * device. Only meaningful when monitorInterfaces is on.
   *
   * DEFAULTS TO FALSE, and it is strictly opt-in: absent, null, and every
   * other non-true value all mean OFF. It is deliberately not default-on
   * and not "on unless explicitly false" — enabling it costs extra SNMP
   * table walks on every poll plus one endpoint upsert per discovered MAC,
   * so a step that never asked for it must never start paying for it,
   * including every step saved before this field existed.
   */
  collectEndpoints?: boolean | undefined;
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
