import { JSONObject } from "../../../Types/JSON";
import DnsRecordType from "../../../Types/Monitor/DnsMonitor/DnsRecordType";
import MonitorStepDnsMonitor, {
  MonitorStepDnsMonitorUtil,
} from "../../../Types/Monitor/MonitorStepDnsMonitor";

describe("MonitorStepDnsMonitorUtil", () => {
  describe("getDefault", () => {
    test("returns an empty query on port 53 with an A record", () => {
      const def: MonitorStepDnsMonitor = MonitorStepDnsMonitorUtil.getDefault();

      expect(def.queryName).toBe("");
      expect(def.recordType).toBe(DnsRecordType.A);
      expect(def.hostname).toBe("");
      expect(def.port).toBe(53);
      expect(def.timeout).toBe(5000);
      expect(def.retries).toBe(3);
    });
  });

  describe("fromJSON", () => {
    test("reads through explicit values", () => {
      const parsed: MonitorStepDnsMonitor = MonitorStepDnsMonitorUtil.fromJSON({
        queryName: "oneuptime.com",
        recordType: DnsRecordType.MX,
        hostname: "8.8.8.8",
        port: 5353,
        timeout: 2000,
        retries: 5,
      });

      expect(parsed.queryName).toBe("oneuptime.com");
      expect(parsed.recordType).toBe(DnsRecordType.MX);
      expect(parsed.hostname).toBe("8.8.8.8");
      expect(parsed.port).toBe(5353);
      expect(parsed.timeout).toBe(2000);
      expect(parsed.retries).toBe(5);
    });

    test("falls back to defaults for missing or falsy fields", () => {
      const parsed: MonitorStepDnsMonitor = MonitorStepDnsMonitorUtil.fromJSON(
        {},
      );

      expect(parsed.queryName).toBe("");
      expect(parsed.recordType).toBe(DnsRecordType.A);
      // An empty hostname collapses to undefined (system-default resolver).
      expect(parsed.hostname).toBeUndefined();
      expect(parsed.port).toBe(53);
      expect(parsed.timeout).toBe(5000);
      expect(parsed.retries).toBe(3);
    });

    test("treats an empty hostname as the system default resolver", () => {
      const parsed: MonitorStepDnsMonitor = MonitorStepDnsMonitorUtil.fromJSON({
        queryName: "oneuptime.com",
        hostname: "",
      });

      expect(parsed.hostname).toBeUndefined();
    });
  });

  describe("toJSON / round-trip", () => {
    test("serializes every field", () => {
      const monitor: MonitorStepDnsMonitor = {
        queryName: "example.com",
        recordType: DnsRecordType.AAAA,
        hostname: "1.1.1.1",
        port: 53,
        timeout: 7000,
        retries: 2,
      };

      const json: JSONObject = MonitorStepDnsMonitorUtil.toJSON(monitor);

      expect(json).toEqual({
        queryName: "example.com",
        recordType: DnsRecordType.AAAA,
        hostname: "1.1.1.1",
        port: 53,
        timeout: 7000,
        retries: 2,
      });
    });

    test("fromJSON(toJSON(x)) preserves a populated monitor", () => {
      const monitor: MonitorStepDnsMonitor = {
        queryName: "example.com",
        recordType: DnsRecordType.TXT,
        hostname: "9.9.9.9",
        port: 5300,
        timeout: 4000,
        retries: 4,
      };

      const roundTripped: MonitorStepDnsMonitor =
        MonitorStepDnsMonitorUtil.fromJSON(
          MonitorStepDnsMonitorUtil.toJSON(monitor),
        );

      expect(roundTripped).toEqual(monitor);
    });
  });
});
