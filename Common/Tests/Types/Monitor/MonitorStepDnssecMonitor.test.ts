import { JSONObject } from "../../../Types/JSON";
import MonitorStepDnssecMonitor, {
  MonitorStepDnssecMonitorUtil,
} from "../../../Types/Monitor/MonitorStepDnssecMonitor";

describe("MonitorStepDnssecMonitorUtil", () => {
  describe("getDefault", () => {
    test("returns three public resolvers and nameserver consistency on", () => {
      const def: MonitorStepDnssecMonitor =
        MonitorStepDnssecMonitorUtil.getDefault();

      expect(def.domainName).toBe("");
      expect(def.resolvers).toEqual(["1.1.1.1", "8.8.8.8", "9.9.9.9"]);
      expect(def.checkNameserverConsistency).toBe(true);
      expect(def.signatureExpiryWarningDays).toBe(7);
      expect(def.timeout).toBe(10000);
      expect(def.retries).toBe(3);
    });
  });

  describe("fromJSON resolvers handling", () => {
    test("keeps only non-empty string resolvers", () => {
      const parsed: MonitorStepDnssecMonitor =
        MonitorStepDnssecMonitorUtil.fromJSON({
          domainName: "oneuptime.com",
          resolvers: ["1.1.1.1", "", "8.8.4.4", 123, null],
        });

      expect(parsed.resolvers).toEqual(["1.1.1.1", "8.8.4.4"]);
    });

    test("restores default resolvers when the provided list filters down to empty", () => {
      const parsed: MonitorStepDnssecMonitor =
        MonitorStepDnssecMonitorUtil.fromJSON({
          domainName: "oneuptime.com",
          resolvers: ["", 5, null],
        });

      expect(parsed.resolvers).toEqual(["1.1.1.1", "8.8.8.8", "9.9.9.9"]);
    });

    test("restores default resolvers when resolvers is not an array", () => {
      const parsed: MonitorStepDnssecMonitor =
        MonitorStepDnssecMonitorUtil.fromJSON({
          domainName: "oneuptime.com",
          resolvers: "1.1.1.1" as unknown as Array<string>,
        });

      expect(parsed.resolvers).toEqual(["1.1.1.1", "8.8.8.8", "9.9.9.9"]);
    });
  });

  describe("fromJSON checkNameserverConsistency handling", () => {
    test("honors an explicit false", () => {
      const parsed: MonitorStepDnssecMonitor =
        MonitorStepDnssecMonitorUtil.fromJSON({
          domainName: "oneuptime.com",
          checkNameserverConsistency: false,
        });

      expect(parsed.checkNameserverConsistency).toBe(false);
    });

    test("defaults to true when the field is absent or non-boolean", () => {
      expect(
        MonitorStepDnssecMonitorUtil.fromJSON({ domainName: "oneuptime.com" })
          .checkNameserverConsistency,
      ).toBe(true);

      expect(
        MonitorStepDnssecMonitorUtil.fromJSON({
          domainName: "oneuptime.com",
          checkNameserverConsistency: "yes" as unknown as boolean,
        }).checkNameserverConsistency,
      ).toBe(true);
    });
  });

  describe("fromJSON numeric defaults", () => {
    test("falls back for falsy numeric fields", () => {
      const parsed: MonitorStepDnssecMonitor =
        MonitorStepDnssecMonitorUtil.fromJSON({
          domainName: "oneuptime.com",
          signatureExpiryWarningDays: 0,
          timeout: 0,
          retries: 0,
        });

      expect(parsed.signatureExpiryWarningDays).toBe(7);
      expect(parsed.timeout).toBe(10000);
      expect(parsed.retries).toBe(3);
    });
  });

  describe("round-trip", () => {
    test("fromJSON(toJSON(x)) preserves a populated monitor", () => {
      const monitor: MonitorStepDnssecMonitor = {
        domainName: "example.com",
        resolvers: ["8.8.8.8"],
        checkNameserverConsistency: false,
        signatureExpiryWarningDays: 14,
        timeout: 20000,
        retries: 5,
      };

      const roundTripped: MonitorStepDnssecMonitor =
        MonitorStepDnssecMonitorUtil.fromJSON(
          MonitorStepDnssecMonitorUtil.toJSON(monitor),
        );

      expect(roundTripped).toEqual(monitor);
    });

    test("toJSON emits every field", () => {
      const json: JSONObject = MonitorStepDnssecMonitorUtil.toJSON(
        MonitorStepDnssecMonitorUtil.getDefault(),
      );

      expect(Object.keys(json).sort()).toEqual(
        [
          "checkNameserverConsistency",
          "domainName",
          "resolvers",
          "retries",
          "signatureExpiryWarningDays",
          "timeout",
        ].sort(),
      );
    });
  });
});
