import { JSONObject } from "../../../Types/JSON";
import MonitorStepNetworkDeviceMonitor, {
  MonitorStepNetworkDeviceMonitorUtil,
} from "../../../Types/Monitor/MonitorStepNetworkDeviceMonitor";
import SnmpOid from "../../../Types/Monitor/SnmpMonitor/SnmpOid";

describe("MonitorStepNetworkDeviceMonitorUtil", () => {
  describe("getDefault", () => {
    test("returns no device, interface monitoring on, and no oids", () => {
      const def: MonitorStepNetworkDeviceMonitor =
        MonitorStepNetworkDeviceMonitorUtil.getDefault();

      expect(def.networkDeviceId).toBeUndefined();
      expect(def.monitorInterfaces).toBe(true);
      expect(def.oids).toEqual([]);
    });
  });

  describe("fromJSON", () => {
    test("reads the fields from a full JSON object", () => {
      const monitor: MonitorStepNetworkDeviceMonitor =
        MonitorStepNetworkDeviceMonitorUtil.fromJSON({
          networkDeviceId: "device-1",
          monitorInterfaces: false,
          oids: [
            {
              oid: "1.3.6.1.2.1.1.1.0",
              name: "sysDescr",
              description: "System Description",
            },
          ],
        });

      expect(monitor.networkDeviceId).toBe("device-1");
      expect(monitor.monitorInterfaces).toBe(false);
      expect(monitor.oids.length).toBe(1);
      expect(monitor.oids[0]!.oid).toBe("1.3.6.1.2.1.1.1.0");
      expect(monitor.oids[0]!.name).toBe("sysDescr");
      expect(monitor.oids[0]!.description).toBe("System Description");
    });

    test("defaults monitorInterfaces to true unless it is explicitly false", () => {
      // Missing -> true.
      expect(
        MonitorStepNetworkDeviceMonitorUtil.fromJSON({}).monitorInterfaces,
      ).toBe(true);
      // Any non-false value (e.g. a truthy) -> true.
      expect(
        MonitorStepNetworkDeviceMonitorUtil.fromJSON({
          monitorInterfaces: true,
        }).monitorInterfaces,
      ).toBe(true);
      // Explicit false -> false.
      expect(
        MonitorStepNetworkDeviceMonitorUtil.fromJSON({
          monitorInterfaces: false,
        }).monitorInterfaces,
      ).toBe(false);
    });

    test("coerces a missing networkDeviceId to undefined and missing oids to []", () => {
      const monitor: MonitorStepNetworkDeviceMonitor =
        MonitorStepNetworkDeviceMonitorUtil.fromJSON({});

      expect(monitor.networkDeviceId).toBeUndefined();
      expect(monitor.oids).toEqual([]);
    });

    test("fills missing oid sub-fields with sensible defaults", () => {
      const monitor: MonitorStepNetworkDeviceMonitor =
        MonitorStepNetworkDeviceMonitorUtil.fromJSON({
          oids: [{}, { oid: "1.2.3" }],
        });

      // A row with no oid string becomes an empty oid, name/description undefined.
      expect(monitor.oids[0]!.oid).toBe("");
      expect(monitor.oids[0]!.name).toBeUndefined();
      expect(monitor.oids[0]!.description).toBeUndefined();
      expect(monitor.oids[1]!.oid).toBe("1.2.3");
    });
  });

  describe("toJSON", () => {
    test("serializes each field including nested oids", () => {
      const monitor: MonitorStepNetworkDeviceMonitor = {
        networkDeviceId: "device-42",
        monitorInterfaces: false,
        oids: [{ oid: "1.2.3", name: "n", description: "d" }],
      };

      const json: JSONObject =
        MonitorStepNetworkDeviceMonitorUtil.toJSON(monitor);

      expect(json["networkDeviceId"]).toBe("device-42");
      expect(json["monitorInterfaces"]).toBe(false);
      expect(json["oids"]).toEqual([
        { oid: "1.2.3", name: "n", description: "d" },
      ]);
    });
  });

  describe("round trip", () => {
    test("fromJSON(toJSON(x)) preserves a fully-populated monitor", () => {
      const original: MonitorStepNetworkDeviceMonitor = {
        networkDeviceId: "device-7",
        monitorInterfaces: false,
        oids: [
          { oid: "1.3.6.1.2.1.1.1.0", name: "sysDescr", description: "desc" },
          {
            oid: "1.3.6.1.2.1.1.3.0",
            name: "sysUpTime",
            description: "uptime",
          },
        ],
      };

      const roundTripped: MonitorStepNetworkDeviceMonitor =
        MonitorStepNetworkDeviceMonitorUtil.fromJSON(
          MonitorStepNetworkDeviceMonitorUtil.toJSON(original),
        );

      expect(roundTripped).toEqual(original);
    });

    test("the default value round-trips unchanged", () => {
      const def: MonitorStepNetworkDeviceMonitor =
        MonitorStepNetworkDeviceMonitorUtil.getDefault();

      const roundTripped: MonitorStepNetworkDeviceMonitor =
        MonitorStepNetworkDeviceMonitorUtil.fromJSON(
          MonitorStepNetworkDeviceMonitorUtil.toJSON(def),
        );

      expect(roundTripped).toEqual(def);
    });

    test("preserves oids with only an oid string across a round trip", () => {
      const original: MonitorStepNetworkDeviceMonitor = {
        networkDeviceId: undefined,
        monitorInterfaces: true,
        oids: [{ oid: "1.2.3", name: undefined, description: undefined }],
      };

      const roundTripped: MonitorStepNetworkDeviceMonitor =
        MonitorStepNetworkDeviceMonitorUtil.fromJSON(
          MonitorStepNetworkDeviceMonitorUtil.toJSON(original),
        );

      const oid: SnmpOid = roundTripped.oids[0]!;
      expect(oid.oid).toBe("1.2.3");
      expect(oid.name).toBeUndefined();
      expect(oid.description).toBeUndefined();
    });
  });
});
