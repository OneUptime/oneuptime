import { JSONObject } from "../../../Types/JSON";
import MonitorStepDomainMonitor, {
  MonitorStepDomainMonitorUtil,
} from "../../../Types/Monitor/MonitorStepDomainMonitor";

describe("MonitorStepDomainMonitorUtil", () => {
  describe("getDefault", () => {
    test("returns an empty domain with 10s timeout and 3 retries", () => {
      const def: MonitorStepDomainMonitor =
        MonitorStepDomainMonitorUtil.getDefault();

      expect(def.domainName).toBe("");
      expect(def.timeout).toBe(10000);
      expect(def.retries).toBe(3);
    });
  });

  describe("fromJSON", () => {
    test("reads through explicit values", () => {
      const parsed: MonitorStepDomainMonitor =
        MonitorStepDomainMonitorUtil.fromJSON({
          domainName: "oneuptime.com",
          timeout: 3000,
          retries: 7,
        });

      expect(parsed.domainName).toBe("oneuptime.com");
      expect(parsed.timeout).toBe(3000);
      expect(parsed.retries).toBe(7);
    });

    test("falls back to defaults for missing or falsy fields", () => {
      const parsed: MonitorStepDomainMonitor =
        MonitorStepDomainMonitorUtil.fromJSON({
          domainName: "",
          timeout: 0,
          retries: 0,
        });

      expect(parsed.domainName).toBe("");
      expect(parsed.timeout).toBe(10000);
      expect(parsed.retries).toBe(3);
    });
  });

  describe("round-trip", () => {
    test("toJSON emits every field and fromJSON restores it", () => {
      const monitor: MonitorStepDomainMonitor = {
        domainName: "example.com",
        timeout: 5000,
        retries: 2,
      };

      const json: JSONObject = MonitorStepDomainMonitorUtil.toJSON(monitor);
      expect(json).toEqual(monitor);

      expect(MonitorStepDomainMonitorUtil.fromJSON(json)).toEqual(monitor);
    });
  });
});
