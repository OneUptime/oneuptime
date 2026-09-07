import MonitorTemplateCustomFieldUtil from "../../../Utils/Monitor/MonitorTemplateCustomFieldUtil";
import { JSONObject } from "../../../Types/JSON";
import OneUptimeDate from "../../../Types/Date";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test — what a monitor template's `customFields` bag MEANS
 * (issue #3548), which is the difference between the two things that read it:
 *
 *   - provisioning takes the whole bag, because the monitor it is building has
 *     no values to protect;
 *   - sync OVERLAYS it, because the monitors it is pushing onto already carry
 *     values somebody typed in.
 *
 * The interesting half is what counts as a default. A template's bag holds a
 * key for every custom field the project has defined the moment the edit form
 * is saved — the form submits its whole values object — so most keys in a
 * freshly saved template hold nothing at all. If those counted, one operator
 * defaulting Vendor would blank Configuration Item across the fleet the next
 * time anybody pressed Sync.
 */
describe("MonitorTemplateCustomFieldUtil", () => {
  describe("getDefaults", () => {
    it("keeps only the fields the template actually defaults", () => {
      const defaults: JSONObject = MonitorTemplateCustomFieldUtil.getDefaults({
        Vendor: "Cisco",
        "Configuration Item": "",
        Services: "   ",
        Duration: null,
        Owner: undefined,
        Tags: [],
      });

      expect(defaults).toEqual({ Vendor: "Cisco" });
    });

    /*
     * The two values most likely to be mistaken for "unset". A Boolean custom
     * field defaulting to false and a Number defaulting to 0 are both things an
     * operator means, and dropping them would make those two field types
     * impossible to default at all.
     */
    it("treats false and zero as values, not blanks", () => {
      expect(
        MonitorTemplateCustomFieldUtil.getDefaults({
          "Is Critical": false,
          Duration: 0,
        }),
      ).toEqual({ "Is Critical": false, Duration: 0 });
    });

    it("keeps a non-empty multi-select and drops an emptied one", () => {
      expect(
        MonitorTemplateCustomFieldUtil.getDefaults({
          Services: ["billing", "checkout"],
          Regions: [],
        }),
      ).toEqual({ Services: ["billing", "checkout"] });
    });

    it("answers an absent, null or empty bag with an empty bag", () => {
      expect(MonitorTemplateCustomFieldUtil.getDefaults(undefined)).toEqual({});
      expect(MonitorTemplateCustomFieldUtil.getDefaults(null)).toEqual({});
      expect(MonitorTemplateCustomFieldUtil.getDefaults({})).toEqual({});
    });

    /*
     * The bag is jsonb handed to a whole fleet. Returning a live reference
     * would let one monitor's write reach the template object every other
     * monitor in the same run is still reading from.
     */
    it("returns a deep copy, so a caller's edit cannot reach the template", () => {
      const templateCustomFields: JSONObject = {
        Vendor: "Cisco",
        Thresholds: { cpu: 80, memory: 90 },
        Services: ["billing"],
      };

      const defaults: JSONObject =
        MonitorTemplateCustomFieldUtil.getDefaults(templateCustomFields);

      (defaults["Thresholds"] as JSONObject)["cpu"] = 10;
      (defaults["Services"] as Array<string>).push("checkout");

      expect((templateCustomFields["Thresholds"] as JSONObject)["cpu"]).toBe(
        80,
      );
      expect(templateCustomFields["Services"]).toEqual(["billing"]);
    });

    it("carries a Date custom field through the clone as a Date", () => {
      const reviewedOn: Date = OneUptimeDate.fromString(
        "2026-02-03T04:05:06.000Z",
      );

      const defaults: JSONObject = MonitorTemplateCustomFieldUtil.getDefaults({
        "Reviewed On": reviewedOn,
      });

      expect(defaults["Reviewed On"]).toBeInstanceOf(Date);
      expect((defaults["Reviewed On"] as Date).toISOString()).toBe(
        reviewedOn.toISOString(),
      );
    });
  });

  describe("hasDefaults", () => {
    it("is false for a bag that holds nothing but blanks", () => {
      expect(
        MonitorTemplateCustomFieldUtil.hasDefaults({
          Vendor: "",
          Services: [],
          Duration: null,
        }),
      ).toBe(false);
    });

    it("is false for an absent or empty bag and true once a value is set", () => {
      expect(MonitorTemplateCustomFieldUtil.hasDefaults(undefined)).toBe(false);
      expect(MonitorTemplateCustomFieldUtil.hasDefaults({})).toBe(false);
      expect(MonitorTemplateCustomFieldUtil.hasDefaults({ Duration: 0 })).toBe(
        true,
      );
    });
  });

  describe("applyDefaults", () => {
    /*
     * The single most important behaviour here: a sync must not turn the
     * fields this template says nothing about into blanks. That is the whole
     * reason sync overlays instead of assigning.
     */
    it("leaves a monitor's own value alone when the template does not default that field", () => {
      expect(
        MonitorTemplateCustomFieldUtil.applyDefaults({
          templateCustomFields: { Vendor: "Cisco", "Configuration Item": "" },
          monitorCustomFields: {
            Vendor: "Juniper",
            "Configuration Item": "CI-4417",
            Duration: 30,
          },
        }),
      ).toEqual({
        Vendor: "Cisco",
        "Configuration Item": "CI-4417",
        Duration: 30,
      });
    });

    it("fills a monitor that has no custom fields at all", () => {
      expect(
        MonitorTemplateCustomFieldUtil.applyDefaults({
          templateCustomFields: { Vendor: "Cisco", Duration: 30 },
          monitorCustomFields: undefined,
        }),
      ).toEqual({ Vendor: "Cisco", Duration: 30 });
    });

    it("returns the monitor's values unchanged when the template defaults nothing", () => {
      expect(
        MonitorTemplateCustomFieldUtil.applyDefaults({
          templateCustomFields: {},
          monitorCustomFields: { Vendor: "Juniper" },
        }),
      ).toEqual({ Vendor: "Juniper" });
    });

    it("mutates neither input", () => {
      const templateCustomFields: JSONObject = {
        Thresholds: { cpu: 80 },
      };
      const monitorCustomFields: JSONObject = {
        Vendor: "Juniper",
        Notes: { owner: "network-team" },
      };

      const merged: JSONObject = MonitorTemplateCustomFieldUtil.applyDefaults({
        templateCustomFields,
        monitorCustomFields,
      });

      (merged["Thresholds"] as JSONObject)["cpu"] = 10;
      (merged["Notes"] as JSONObject)["owner"] = "someone-else";
      merged["Vendor"] = "Arista";

      expect((templateCustomFields["Thresholds"] as JSONObject)["cpu"]).toBe(
        80,
      );
      expect((monitorCustomFields["Notes"] as JSONObject)["owner"]).toBe(
        "network-team",
      );
      expect(monitorCustomFields["Vendor"]).toBe("Juniper");
    });
  });

  describe("clone", () => {
    /*
     * Provisioning's copy, which differs from getDefaults on purpose: a
     * monitor being created has nothing underneath, so a blank default and an
     * absent one look identical on it, and copying the bag as written keeps
     * "what the template says" and "what the new monitor got" the same object.
     */
    it("copies the bag verbatim, blanks included, without sharing structure", () => {
      const templateCustomFields: JSONObject = {
        Vendor: "Cisco",
        "Configuration Item": "",
        Thresholds: { cpu: 80 },
      };

      const cloned: JSONObject =
        MonitorTemplateCustomFieldUtil.clone(templateCustomFields);

      expect(cloned).toEqual(templateCustomFields);
      expect(cloned).not.toBe(templateCustomFields);
      expect(cloned["Thresholds"]).not.toBe(templateCustomFields["Thresholds"]);
    });
  });
});
