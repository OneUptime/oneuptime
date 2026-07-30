import { JSONObject } from "../../../Types/JSON";
import ExternalStatusPageProviderType from "../../../Types/Monitor/ExternalStatusPageProviderType";
import MonitorStepExternalStatusPageMonitor, {
  MonitorStepExternalStatusPageMonitorUtil,
} from "../../../Types/Monitor/MonitorStepExternalStatusPageMonitor";

describe("MonitorStepExternalStatusPageMonitorUtil", () => {
  describe("getDefault", () => {
    test("returns an auto-detected provider with no component filters", () => {
      const def: MonitorStepExternalStatusPageMonitor =
        MonitorStepExternalStatusPageMonitorUtil.getDefault();

      expect(def.statusPageUrl).toBe("");
      expect(def.provider).toBe(ExternalStatusPageProviderType.Auto);
      expect(def.componentGroupName).toBeUndefined();
      expect(def.componentName).toBeUndefined();
      expect(def.timeout).toBe(10000);
      expect(def.retries).toBe(3);
    });
  });

  describe("fromJSON", () => {
    test("reads through explicit values", () => {
      const parsed: MonitorStepExternalStatusPageMonitor =
        MonitorStepExternalStatusPageMonitorUtil.fromJSON({
          statusPageUrl: "https://status.example.com",
          provider: ExternalStatusPageProviderType.AtlassianStatuspage,
          componentGroupName: "APIs",
          componentName: "Ingest",
          timeout: 4000,
          retries: 1,
        });

      expect(parsed.statusPageUrl).toBe("https://status.example.com");
      expect(parsed.provider).toBe(
        ExternalStatusPageProviderType.AtlassianStatuspage,
      );
      expect(parsed.componentGroupName).toBe("APIs");
      expect(parsed.componentName).toBe("Ingest");
      expect(parsed.timeout).toBe(4000);
      expect(parsed.retries).toBe(1);
    });

    test("falls back to defaults for missing or falsy fields", () => {
      const parsed: MonitorStepExternalStatusPageMonitor =
        MonitorStepExternalStatusPageMonitorUtil.fromJSON({
          statusPageUrl: "",
          componentGroupName: "",
          componentName: "",
          timeout: 0,
          retries: 0,
        });

      expect(parsed.statusPageUrl).toBe("");
      expect(parsed.provider).toBe(ExternalStatusPageProviderType.Auto);
      expect(parsed.componentGroupName).toBeUndefined();
      expect(parsed.componentName).toBeUndefined();
      expect(parsed.timeout).toBe(10000);
      expect(parsed.retries).toBe(3);
    });
  });

  describe("round-trip", () => {
    test("fromJSON(toJSON(x)) preserves a populated monitor", () => {
      const monitor: MonitorStepExternalStatusPageMonitor = {
        statusPageUrl: "https://status.incident.io/x",
        provider: ExternalStatusPageProviderType.IncidentIo,
        componentGroupName: "Core",
        componentName: "Dashboard",
        timeout: 15000,
        retries: 5,
      };

      const json: JSONObject =
        MonitorStepExternalStatusPageMonitorUtil.toJSON(monitor);
      const roundTripped: MonitorStepExternalStatusPageMonitor =
        MonitorStepExternalStatusPageMonitorUtil.fromJSON(json);

      expect(roundTripped).toEqual(monitor);
    });
  });
});
