import { JSONObject } from "../JSON";
import SnmpOid from "./SnmpMonitor/SnmpOid";
import SnmpV3Auth from "./SnmpMonitor/SnmpV3Auth";
import SnmpVersion from "./SnmpMonitor/SnmpVersion";
import SnmpSecurityLevel from "./SnmpMonitor/SnmpSecurityLevel";
import SnmpAuthProtocol from "./SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol from "./SnmpMonitor/SnmpPrivProtocol";

export default interface MonitorStepSnmpMonitor {
  snmpVersion: SnmpVersion;
  hostname: string;
  port: number;
  communityString?: string | undefined;
  snmpV3Auth?: SnmpV3Auth | undefined;
  oids: Array<SnmpOid>;
  timeout: number;
  retries: number;
}

export class MonitorStepSnmpMonitorUtil {
  public static getDefault(): MonitorStepSnmpMonitor {
    return {
      snmpVersion: SnmpVersion.V2c,
      hostname: "",
      port: 161,
      communityString: "public",
      oids: [],
      timeout: 5000,
      retries: 3,
    };
  }

  public static fromJSON(json: JSONObject): MonitorStepSnmpMonitor {
    return {
      snmpVersion: (json["snmpVersion"] as SnmpVersion) || SnmpVersion.V2c,
      hostname: (json["hostname"] as string) || "",
      port: (json["port"] as number) || 161,
      communityString: (json["communityString"] as string) || undefined,
      snmpV3Auth: json["snmpV3Auth"]
        ? MonitorStepSnmpMonitorUtil.parseSnmpV3Auth(
            json["snmpV3Auth"] as JSONObject,
          )
        : undefined,
      oids: MonitorStepSnmpMonitorUtil.parseOids(
        (json["oids"] as Array<JSONObject>) || [],
      ),
      timeout: (json["timeout"] as number) || 5000,
      retries: (json["retries"] as number) || 3,
    };
  }

  private static parseSnmpV3Auth(json: JSONObject): SnmpV3Auth {
    return {
      securityLevel:
        (json["securityLevel"] as SnmpSecurityLevel) ||
        SnmpSecurityLevel.NoAuthNoPriv,
      username: (json["username"] as string) || "",
      authProtocol: (json["authProtocol"] as SnmpAuthProtocol) || undefined,
      authKey: (json["authKey"] as string) || undefined,
      privProtocol: (json["privProtocol"] as SnmpPrivProtocol) || undefined,
      privKey: (json["privKey"] as string) || undefined,
    };
  }

  private static parseOids(oids: Array<JSONObject>): Array<SnmpOid> {
    return oids.map((oid: JSONObject) => {
      return {
        oid: (oid["oid"] as string) || "",
        name: (oid["name"] as string) || undefined,
        description: (oid["description"] as string) || undefined,
      };
    });
  }

  public static toJSON(monitor: MonitorStepSnmpMonitor): JSONObject {
    return {
      snmpVersion: monitor.snmpVersion,
      hostname: monitor.hostname,
      port: monitor.port,
      communityString: monitor.communityString,
      snmpV3Auth: monitor.snmpV3Auth
        ? {
            securityLevel: monitor.snmpV3Auth.securityLevel,
            username: monitor.snmpV3Auth.username,
            authProtocol: monitor.snmpV3Auth.authProtocol,
            authKey: monitor.snmpV3Auth.authKey,
            privProtocol: monitor.snmpV3Auth.privProtocol,
            privKey: monitor.snmpV3Auth.privKey,
          }
        : undefined,
      oids: monitor.oids.map((oid: SnmpOid) => {
        return {
          oid: oid.oid,
          name: oid.name,
          description: oid.description,
        };
      }),
      timeout: monitor.timeout,
      retries: monitor.retries,
    };
  }
}
