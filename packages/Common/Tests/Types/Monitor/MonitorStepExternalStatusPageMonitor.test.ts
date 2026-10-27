import { JSONObject } from "../../../Types/JSON";
import ExternalStatusPageProviderType from "../../../Types/Monitor/ExternalStatusPageProviderType";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepExternalStatusPageMonitor, {
  MonitorStepExternalStatusPageMonitorUtil,
} from "../../../Types/Monitor/MonitorStepExternalStatusPageMonitor";
import ObjectID from "../../../Types/ObjectID";

describe("MonitorStepExternalStatusPageMonitorUtil", () => {
  describe("getDefault", () => {
    test("returns an auto-detected provider that watches the whole page", () => {
      const def: MonitorStepExternalStatusPageMonitor =
        MonitorStepExternalStatusPageMonitorUtil.getDefault();

      expect(def.statusPageUrl).toBe("");
      expect(def.provider).toBe(ExternalStatusPageProviderType.Auto);
      expect(def.componentGroupName).toBeUndefined();
      expect(def.componentNames).toEqual([]);
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
          componentNames: ["Ingest", "Query"],
          timeout: 4000,
          retries: 1,
        });

      expect(parsed.statusPageUrl).toBe("https://status.example.com");
      expect(parsed.provider).toBe(
        ExternalStatusPageProviderType.AtlassianStatuspage,
      );
      expect(parsed.componentGroupName).toBe("APIs");
      expect(parsed.componentNames).toEqual(["Ingest", "Query"]);
      expect(parsed.componentName).toBeUndefined();
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
        });

      expect(parsed.statusPageUrl).toBe("");
      expect(parsed.provider).toBe(ExternalStatusPageProviderType.Auto);
      expect(parsed.componentGroupName).toBeUndefined();
      expect(parsed.componentNames).toEqual([]);
      expect(parsed.componentName).toBeUndefined();
      expect(parsed.timeout).toBe(10000);
      expect(parsed.retries).toBe(3);
    });

    /*
     * Retries count attempts after the first one, so 0 is the user asking for
     * a single attempt — not an empty field waiting for the default.
     */
    test("keeps a stored 0 retries", () => {
      const parsed: MonitorStepExternalStatusPageMonitor =
        MonitorStepExternalStatusPageMonitorUtil.fromJSON({
          statusPageUrl: "https://status.example.com",
          retries: 0,
        });

      expect(parsed.retries).toBe(0);
    });

    test("keeps the chosen names a monitor may hold, and nothing else", () => {
      const parsed: MonitorStepExternalStatusPageMonitor =
        MonitorStepExternalStatusPageMonitorUtil.fromJSON({
          statusPageUrl: "https://status.example.com",
          componentNames: [
            " Git Operations ",
            "git operations",
            "",
            7,
            "*",
            "Pull Requests",
          ] as unknown as Array<string>,
        });

      expect(parsed.componentNames).toEqual(["Git Operations", "Pull Requests"]);
    });
  });

  /*
   * Issue #5156: a monitor watches several components now. One saved
   * before had a single Component Name Filter, which matched every
   * component whose name contained it: it reads as that name between stars,
   * which matches the same components, and is written so on its next save.
   */
  describe("a monitor saved with one Component Name Filter", () => {
    const saved: JSONObject = {
      statusPageUrl: "https://status.example.com",
      provider: ExternalStatusPageProviderType.AtlassianStatuspage,
      componentGroupName: "Core",
      componentName: "API",
      timeout: 10000,
      retries: 3,
    };

    test("watches the components whose names contain it", () => {
      expect(
        MonitorStepExternalStatusPageMonitorUtil.getComponentNames(saved),
      ).toEqual(["*API*"]);
      expect(
        MonitorStepExternalStatusPageMonitorUtil.fromJSON(saved).componentNames,
      ).toEqual(["*API*"]);
    });

    test("keeps the filter it had, for a probe that has not been upgraded", () => {
      expect(
        MonitorStepExternalStatusPageMonitorUtil.fromJSON(saved).componentName,
      ).toBe("API");
    });

    test("is written with the list on its next save, and its filter as it was", () => {
      const json: JSONObject = MonitorStepExternalStatusPageMonitorUtil.toJSON(
        saved as unknown as MonitorStepExternalStatusPageMonitor,
      );

      expect(json["componentNames"]).toEqual(["*API*"]);
      expect(json["componentName"]).toBe("API");
      expect(json["componentGroupName"]).toBe("Core");
    });

    test("its step, as the monitor holds it, reads the same", () => {
      // A step as it was stored, its filter and no list.
      const stored: MonitorStep = new MonitorStep();
      stored.data!.id = ObjectID.generate().toString();
      const storedJSON: JSONObject = stored.toJSON();
      (storedJSON["value"] as JSONObject)["externalStatusPageMonitor"] = saved;

      const step: MonitorStep = MonitorStep.fromJSON(storedJSON);

      expect(
        MonitorStepExternalStatusPageMonitorUtil.getComponentNames(
          step.data!.externalStatusPageMonitor,
        ),
      ).toEqual(["*API*"]);

      const written: JSONObject = (step.toJSON()["value"] as JSONObject)[
        "externalStatusPageMonitor"
      ] as JSONObject;

      expect(written["componentNames"]).toEqual(["*API*"]);
      expect(written["componentName"]).toBe("API");
    });

    test("a list it was given wins over the filter", () => {
      expect(
        MonitorStepExternalStatusPageMonitorUtil.getComponentNames({
          componentNames: ["Git Operations"],
          componentName: "API",
        }),
      ).toEqual(["Git Operations"]);
      // An empty list is the whole page, whatever the filter said.
      expect(
        MonitorStepExternalStatusPageMonitorUtil.getComponentNames({
          componentNames: [],
          componentName: "API",
        }),
      ).toEqual([]);
    });

    test("nothing set reads as the whole page", () => {
      for (const value of [undefined, null, {}, { componentName: "  " }]) {
        expect(
          MonitorStepExternalStatusPageMonitorUtil.getComponentNames(
            value as JSONObject,
          ),
        ).toEqual([]);
      }
    });
  });

  describe("choosing components", () => {
    const monitor: MonitorStepExternalStatusPageMonitor = {
      ...MonitorStepExternalStatusPageMonitorUtil.getDefault(),
      statusPageUrl: "https://www.githubstatus.com",
      componentName: "API",
    };

    test("one: the list, and the same name for a probe that has not been upgraded", () => {
      expect(
        MonitorStepExternalStatusPageMonitorUtil.withComponentNames(monitor, [
          "Git Operations",
        ]),
      ).toEqual({
        ...monitor,
        componentNames: ["Git Operations"],
        componentName: "Git Operations",
      });
    });

    test("a pattern: its text, which such a probe matches as contained", () => {
      expect(
        MonitorStepExternalStatusPageMonitorUtil.withComponentNames(monitor, [
          "*us-east-1*",
        ]).componentName,
      ).toBe("us-east-1");
    });

    test("several: no single name, so such a probe watches the whole page rather than one of them", () => {
      const chosen: MonitorStepExternalStatusPageMonitor =
        MonitorStepExternalStatusPageMonitorUtil.withComponentNames(monitor, [
          "Git Operations",
          "Pull Requests",
          "git operations",
        ]);

      expect(chosen.componentNames).toEqual(["Git Operations", "Pull Requests"]);
      expect(chosen.componentName).toBeUndefined();
    });

    test("none: the whole page, the old filter gone too", () => {
      const none: MonitorStepExternalStatusPageMonitor =
        MonitorStepExternalStatusPageMonitorUtil.withComponentNames(monitor, []);

      expect(none.componentNames).toEqual([]);
      expect(none.componentName).toBeUndefined();
      expect(
        MonitorStepExternalStatusPageMonitorUtil.getComponentNames(
          MonitorStepExternalStatusPageMonitorUtil.toJSON(none),
        ),
      ).toEqual([]);
    });
  });

  describe("round-trip", () => {
    test("fromJSON(toJSON(x)) preserves a populated monitor", () => {
      const monitor: MonitorStepExternalStatusPageMonitor = {
        statusPageUrl: "https://status.incident.io/x",
        provider: ExternalStatusPageProviderType.IncidentIo,
        componentGroupName: "Core",
        componentNames: ["Dashboard", "*API*"],
        componentName: undefined,
        timeout: 15000,
        retries: 5,
      };

      const json: JSONObject =
        MonitorStepExternalStatusPageMonitorUtil.toJSON(monitor);
      const roundTripped: MonitorStepExternalStatusPageMonitor =
        MonitorStepExternalStatusPageMonitorUtil.fromJSON(json);

      expect(roundTripped).toEqual(monitor);
    });

    test("a monitor that names no components writes no list", () => {
      const json: JSONObject = MonitorStepExternalStatusPageMonitorUtil.toJSON({
        statusPageUrl: "https://status.example.com",
        provider: ExternalStatusPageProviderType.Auto,
        timeout: 10000,
        retries: 3,
      });

      expect(json["componentNames"]).toBeUndefined();
      expect(json["componentName"]).toBeUndefined();
    });
  });
});
