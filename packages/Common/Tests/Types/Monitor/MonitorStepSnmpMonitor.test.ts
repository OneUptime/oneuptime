import { JSONObject } from "../../../Types/JSON";
import MonitorStepSnmpMonitor, {
  MonitorStepSnmpMonitorUtil,
} from "../../../Types/Monitor/MonitorStepSnmpMonitor";
import SnmpAuthProtocol from "../../../Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol from "../../../Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import SnmpSecurityLevel from "../../../Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import SnmpVersion from "../../../Types/Monitor/SnmpMonitor/SnmpVersion";

describe("MonitorStepSnmpMonitorUtil", () => {
  describe("getDefault", () => {
    test("returns a v2c community-string monitor on port 161", () => {
      const def: MonitorStepSnmpMonitor =
        MonitorStepSnmpMonitorUtil.getDefault();

      expect(def.snmpVersion).toBe(SnmpVersion.V2c);
      expect(def.hostname).toBe("");
      expect(def.port).toBe(161);
      expect(def.communityString).toBe("public");
      expect(def.oids).toEqual([]);
      expect(def.timeout).toBe(5000);
      expect(def.retries).toBe(3);
      expect(def.monitorInterfaces).toBe(false);
    });
  });

  describe("fromJSON defaults", () => {
    test("fills in defaults for an empty object and leaves v3 auth undefined", () => {
      const parsed: MonitorStepSnmpMonitor =
        MonitorStepSnmpMonitorUtil.fromJSON({});

      expect(parsed.snmpVersion).toBe(SnmpVersion.V2c);
      expect(parsed.port).toBe(161);
      // An empty/missing community string collapses to undefined.
      expect(parsed.communityString).toBeUndefined();
      expect(parsed.snmpV3Auth).toBeUndefined();
      expect(parsed.oids).toEqual([]);
      expect(parsed.monitorInterfaces).toBe(false);
    });

    test("coerces monitorInterfaces to a real boolean", () => {
      expect(
        MonitorStepSnmpMonitorUtil.fromJSON({ monitorInterfaces: 1 })
          .monitorInterfaces,
      ).toBe(true);
      expect(
        MonitorStepSnmpMonitorUtil.fromJSON({ monitorInterfaces: 0 })
          .monitorInterfaces,
      ).toBe(false);
    });
  });

  describe("fromJSON OID parsing", () => {
    test("maps each OID and defaults optional name/description to undefined", () => {
      const parsed: MonitorStepSnmpMonitor =
        MonitorStepSnmpMonitorUtil.fromJSON({
          oids: [
            { oid: "1.3.6.1.2.1.1.3.0", name: "sysUpTime", description: "Up" },
            { oid: "1.3.6.1.2.1.1.5.0" },
          ],
        });

      expect(parsed.oids).toEqual([
        {
          oid: "1.3.6.1.2.1.1.3.0",
          name: "sysUpTime",
          description: "Up",
        },
        {
          oid: "1.3.6.1.2.1.1.5.0",
          name: undefined,
          description: undefined,
        },
      ]);
    });
  });

  describe("fromJSON v3 auth parsing", () => {
    test("parses a full authPriv v3 configuration", () => {
      const parsed: MonitorStepSnmpMonitor =
        MonitorStepSnmpMonitorUtil.fromJSON({
          snmpVersion: SnmpVersion.V3,
          hostname: "10.0.0.1",
          snmpV3Auth: {
            securityLevel: SnmpSecurityLevel.AuthPriv,
            username: "monitor",
            authProtocol: SnmpAuthProtocol.SHA,
            authKey: "{{monitorSecrets.authKey}}",
            privProtocol: SnmpPrivProtocol.AES,
            privKey: "{{monitorSecrets.privKey}}",
          },
        });

      expect(parsed.snmpV3Auth).toEqual({
        securityLevel: SnmpSecurityLevel.AuthPriv,
        username: "monitor",
        authProtocol: SnmpAuthProtocol.SHA,
        authKey: "{{monitorSecrets.authKey}}",
        privProtocol: SnmpPrivProtocol.AES,
        privKey: "{{monitorSecrets.privKey}}",
      });
    });

    test("defaults the security level to NoAuthNoPriv when auth is present but empty", () => {
      const parsed: MonitorStepSnmpMonitor =
        MonitorStepSnmpMonitorUtil.fromJSON({
          snmpVersion: SnmpVersion.V3,
          snmpV3Auth: {},
        });

      expect(parsed.snmpV3Auth).toEqual({
        securityLevel: SnmpSecurityLevel.NoAuthNoPriv,
        username: "",
        authProtocol: undefined,
        authKey: undefined,
        privProtocol: undefined,
        privKey: undefined,
      });
    });
  });

  describe("round-trip", () => {
    test("fromJSON(toJSON(x)) preserves a fully populated v3 monitor", () => {
      const monitor: MonitorStepSnmpMonitor = {
        snmpVersion: SnmpVersion.V3,
        hostname: "10.0.0.5",
        port: 1610,
        communityString: undefined,
        snmpV3Auth: {
          securityLevel: SnmpSecurityLevel.AuthNoPriv,
          username: "reader",
          authProtocol: SnmpAuthProtocol.MD5,
          authKey: "secret",
          privProtocol: undefined,
          privKey: undefined,
        },
        oids: [
          {
            oid: "1.3.6.1.2.1.1.1.0",
            name: "sysDescr",
            description: undefined,
          },
        ],
        timeout: 8000,
        retries: 2,
        monitorInterfaces: true,
      };

      const json: JSONObject = MonitorStepSnmpMonitorUtil.toJSON(monitor);
      const roundTripped: MonitorStepSnmpMonitor =
        MonitorStepSnmpMonitorUtil.fromJSON(json);

      expect(roundTripped).toEqual(monitor);
    });
  });
});
