import { JSONObject } from "../../../Types/JSON";
import DomainLookupMethod from "../../../Types/Monitor/DomainMonitor/DomainLookupMethod";
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

    /*
     * Auto rather than RDAP: about half the ccTLDs (.io, .co, .de, ...)
     * publish no RDAP service, so RDAP-only would break them.
     */
    test("defaults to the Auto lookup method", () => {
      expect(MonitorStepDomainMonitorUtil.getDefault().lookupMethod).toBe(
        DomainLookupMethod.Auto,
      );
    });
  });

  describe("fromJSON", () => {
    test("reads through explicit values", () => {
      const parsed: MonitorStepDomainMonitor =
        MonitorStepDomainMonitorUtil.fromJSON({
          domainName: "oneuptime.com",
          lookupMethod: DomainLookupMethod.RDAP,
          timeout: 3000,
          retries: 7,
        });

      expect(parsed.domainName).toBe("oneuptime.com");
      expect(parsed.lookupMethod).toBe(DomainLookupMethod.RDAP);
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

    /*
     * Every domain monitor saved before RDAP support existed has no
     * lookupMethod key at all, and must keep working.
     */
    test("treats a monitor saved without a lookup method as Auto", () => {
      const parsed: MonitorStepDomainMonitor =
        MonitorStepDomainMonitorUtil.fromJSON({
          domainName: "identity.digital",
          timeout: 10000,
          retries: 3,
        });

      expect(parsed.lookupMethod).toBe(DomainLookupMethod.Auto);
    });

    test("treats an unrecognised lookup method as Auto", () => {
      expect(
        MonitorStepDomainMonitorUtil.fromJSON({ lookupMethod: "" })
          .lookupMethod,
      ).toBe(DomainLookupMethod.Auto);

      expect(
        MonitorStepDomainMonitorUtil.fromJSON({ lookupMethod: "Telepathy" })
          .lookupMethod,
      ).toBe(DomainLookupMethod.Auto);

      expect(
        MonitorStepDomainMonitorUtil.fromJSON({ lookupMethod: 42 })
          .lookupMethod,
      ).toBe(DomainLookupMethod.Auto);
    });

    test("accepts every declared lookup method", () => {
      for (const method of Object.values(DomainLookupMethod)) {
        expect(
          MonitorStepDomainMonitorUtil.fromJSON({ lookupMethod: method })
            .lookupMethod,
        ).toBe(method);
      }
    });
  });

  describe("round-trip", () => {
    test("toJSON emits every field and fromJSON restores it", () => {
      const monitor: MonitorStepDomainMonitor = {
        domainName: "example.com",
        lookupMethod: DomainLookupMethod.WHOIS,
        timeout: 5000,
        retries: 2,
      };

      const json: JSONObject = MonitorStepDomainMonitorUtil.toJSON(monitor);
      expect(json).toEqual(monitor);

      expect(MonitorStepDomainMonitorUtil.fromJSON(json)).toEqual(monitor);
    });
  });

  describe("parseLookupMethod", () => {
    test("accepts the declared values and rejects anything else", () => {
      expect(MonitorStepDomainMonitorUtil.parseLookupMethod("RDAP")).toBe(
        DomainLookupMethod.RDAP,
      );
      expect(MonitorStepDomainMonitorUtil.parseLookupMethod("WHOIS")).toBe(
        DomainLookupMethod.WHOIS,
      );
      expect(MonitorStepDomainMonitorUtil.parseLookupMethod("rdap")).toBe(
        DomainLookupMethod.Auto,
      );
      expect(MonitorStepDomainMonitorUtil.parseLookupMethod(null)).toBe(
        DomainLookupMethod.Auto,
      );
      expect(MonitorStepDomainMonitorUtil.parseLookupMethod(undefined)).toBe(
        DomainLookupMethod.Auto,
      );
    });
  });
});
