import { JSONObject, JSONValue } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";

/*
 * WHAT A MONITOR TEMPLATE'S CUSTOM FIELDS MEAN, in one place.
 *
 * A template's `customFields` bag is a set of DEFAULTS for the monitors made
 * from it — the answer to issue #3548, where an auto-import rule turned a
 * thousand discovered devices into a thousand monitors whose Vendor, Services
 * and Configuration Item fields were all empty and could only be filled in one
 * monitor at a time.
 *
 * Two callers need the same answer and would drift apart if each wrote its
 * own:
 *
 *   - PROVISIONING (NetworkDeviceMonitorTemplateUtil.buildMonitor, reached
 *     from the auto-import engine and the alert-policy engine) starts from a
 *     monitor with no values at all, so it takes the whole bag.
 *   - SYNC (MonitorTemplateService) pushes the template onto monitors that
 *     already exist and may already carry values an operator typed in, so it
 *     OVERLAYS instead: every field the template actually gives a default for
 *     wins, and every other field on the monitor is left exactly as it is.
 *
 * Both go through a deep clone, because a jsonb bag handed to several monitors
 * by reference is one nested edit away from leaking across the fleet — and
 * back onto the template itself.
 */
export default class MonitorTemplateCustomFieldUtil {
  /*
   * A defaults bag is only worth writing when there is a value in it, so
   * "template has no defaults" and "template has an empty bag" are the same
   * answer to every caller here. This is what keeps a sync scoped to custom
   * fields alone from reporting that it wrote to a fleet it did not touch.
   */
  public static hasDefaults(
    customFields: JSONObject | undefined | null,
  ): boolean {
    return Object.keys(this.getDefaults(customFields)).length > 0;
  }

  /*
   * The template's defaults, deep-cloned, with the fields it does not actually
   * default DROPPED.
   *
   * A template carries a key for every custom field the project has defined
   * the moment somebody saves the edit form — the form submits its whole
   * values object — so most keys in a freshly saved bag hold nothing. Left in,
   * they would make a sync overwrite real per-monitor values with blanks: a
   * template that only defaults Vendor would silently clear Configuration Item
   * on every monitor in the fleet.
   *
   * `false` and `0` are values, not blanks — a Boolean custom field defaulting
   * to false and a Number defaulting to 0 are both things an operator means.
   */
  public static getDefaults(
    customFields: JSONObject | undefined | null,
  ): JSONObject {
    if (!customFields) {
      return {};
    }

    const defaults: JSONObject = {};

    for (const key of Object.keys(customFields)) {
      const value: JSONValue = customFields[key] as JSONValue;

      if (this.isBlank(value)) {
        continue;
      }

      defaults[key] = value;
    }

    return this.clone(defaults);
  }

  /*
   * Overlay the template's defaults onto the values a monitor already has.
   * Returns a new bag; neither input is mutated.
   */
  public static applyDefaults(data: {
    templateCustomFields: JSONObject | undefined | null;
    monitorCustomFields: JSONObject | undefined | null;
  }): JSONObject {
    return {
      ...this.clone(data.monitorCustomFields || {}),
      ...this.getDefaults(data.templateCustomFields),
    };
  }

  /*
   * The whole bag, verbatim apart from being deep-cloned — blanks included.
   *
   * Provisioning uses this rather than getDefaults because there is nothing
   * underneath to protect: a monitor being created has no values of its own,
   * so a blank default and an absent one look identical on the monitor, and
   * copying the bag as written keeps "what the template says" and "what the
   * new monitor got" literally the same object.
   */
  public static clone(customFields: JSONObject): JSONObject {
    return JSONFunctions.deserialize(JSONFunctions.serialize(customFields));
  }

  /*
   * Nothing an operator would call a default. An empty multi-select arrives as
   * [], a cleared text field as "" (or as spaces, from a form nobody trimmed),
   * and a field never touched as null or undefined.
   */
  private static isBlank(value: JSONValue): boolean {
    if (value === undefined || value === null) {
      return true;
    }

    if (typeof value === "string") {
      return value.trim() === "";
    }

    if (Array.isArray(value)) {
      return value.length === 0;
    }

    return false;
  }
}
