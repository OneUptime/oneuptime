import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import MonitoringIntervalValidator from "Common/Server/Utils/Monitor/MonitoringIntervalValidator";
import MonitoringInterval from "../../FeatureSet/Dashboard/src/Utils/MonitorIntervalDropdownOptions";
import {
  DEFAULT_MONITORING_INTERVAL,
  shouldDropDefaultMonitoringInterval,
  withDefaultMonitoringInterval,
} from "../../FeatureSet/Dashboard/src/Utils/Form/Monitor/MonitoringIntervalDefault";

/*
 * The interval a monitor made on the Create Monitor page starts with.
 *
 * "Monitoring Interval" is required for every probe-checked monitor and used
 * to start empty: one more decision, on the way to a first monitor, that a new
 * user has no basis for. The page now starts on every five minutes. Two
 * things must hold for that to be safe:
 *
 * - A prefill that says anything about the interval (a template, the metric
 *   view, the network device deep link) keeps its own value - including an
 *   explicit empty one, which a template may carry on purpose.
 * - Types with no "Probes & Interval" step (Manual, Incoming Request, the
 *   telemetry monitors...) never asked the question, and were always created
 *   with no interval. They must still be, rather than inherit a schedule that
 *   nobody chose - the server treats NULL as "not probed" for them.
 */

describe("DEFAULT_MONITORING_INTERVAL", () => {
  test("is every five minutes, as a cron expression", () => {
    expect(DEFAULT_MONITORING_INTERVAL).toBe("*/5 * * * *");
  });

  test("is one of the intervals the form's dropdown offers", () => {
    /*
     * The dropdown only shows a value it has an option for. A default that
     * is not an option would render as an empty, required field - the very
     * thing the default exists to avoid.
     */
    const values: Array<unknown> = MonitoringInterval.map(
      (option: { value: unknown }): unknown => {
        return option.value;
      },
    );

    expect(values).toContain(DEFAULT_MONITORING_INTERVAL);

    const label: string | undefined = MonitoringInterval.find(
      (option: { value: unknown }): boolean => {
        return option.value === DEFAULT_MONITORING_INTERVAL;
      },
    )?.label as string | undefined;

    expect(label).toBe("Every 5 Minutes");
  });

  test("is stored exactly as sent: the server's validator keeps it unchanged", () => {
    expect(
      MonitoringIntervalValidator.validateAndNormalize(
        DEFAULT_MONITORING_INTERVAL,
      ),
    ).toBe(DEFAULT_MONITORING_INTERVAL);
  });

  test("is offered to the types whose shortest intervals are removed", () => {
    /*
     * Synthetic, Custom JavaScript and SSL Certificate monitors drop the one-
     * and two-minute options (Create.tsx). Five minutes has to survive that
     * filter, or those types would open on a value their dropdown hides.
     */
    const removedForSlowTypes: Array<string> = ["* * * * *", "*/2 * * * *"];

    expect(removedForSlowTypes).not.toContain(DEFAULT_MONITORING_INTERVAL);
  });
});

describe("withDefaultMonitoringInterval", () => {
  test("adds the default to an empty form", () => {
    expect(withDefaultMonitoringInterval({})).toEqual({
      monitoringInterval: "*/5 * * * *",
    });
  });

  test("adds the default next to other starting values, keeping them", () => {
    const initialValues: JSONObject = {
      monitorType: MonitorType.Website,
      probes: ["probe-1"],
    };

    expect(withDefaultMonitoringInterval(initialValues)).toEqual({
      monitorType: MonitorType.Website,
      probes: ["probe-1"],
      monitoringInterval: "*/5 * * * *",
    });
  });

  test.each([
    ["a template's own interval", "*/10 * * * *"],
    ["the Ping deep link's interval", "* * * * *"],
    ["an explicit empty value", null],
    ["an explicit undefined value", undefined],
    ["an empty string", ""],
  ])("leaves %s alone", (_name: string, value: string | null | undefined) => {
    const initialValues: JSONObject = {
      name: "Checkout",
      monitoringInterval: value as JSONObject["monitoringInterval"],
    };

    const result: JSONObject = withDefaultMonitoringInterval(initialValues);

    expect(
      Object.prototype.hasOwnProperty.call(result, "monitoringInterval"),
    ).toBe(true);
    expect(result["monitoringInterval"]).toBe(value);
    expect(result["name"]).toBe("Checkout");
  });

  test("does not change the object it is given", () => {
    const initialValues: JSONObject = { name: "Checkout" };
    const snapshot: string = JSON.stringify(initialValues);

    const result: JSONObject = withDefaultMonitoringInterval(initialValues);

    expect(JSON.stringify(initialValues)).toBe(snapshot);
    expect(
      Object.prototype.hasOwnProperty.call(initialValues, "monitoringInterval"),
    ).toBe(false);
    expect(result).not.toBe(initialValues);
  });

  test("returns a prefilled object as it is", () => {
    const initialValues: JSONObject = { monitoringInterval: "0 * * * *" };

    expect(withDefaultMonitoringInterval(initialValues)).toBe(initialValues);
  });
});

describe("shouldDropDefaultMonitoringInterval", () => {
  const ALL_MONITOR_TYPES: Array<MonitorType> = Object.values(
    MonitorType,
  ) as Array<MonitorType>;

  test("the sweep covers every monitor type", () => {
    // Guards the sweeps below against an enum that stopped enumerating.
    expect(ALL_MONITOR_TYPES.length).toBeGreaterThanOrEqual(30);
    expect(ALL_MONITOR_TYPES).toContain(MonitorType.Website);
    expect(ALL_MONITOR_TYPES).toContain(MonitorType.Manual);
    expect(ALL_MONITOR_TYPES).toContain(MonitorType.IncomingRequest);
  });

  test.each(ALL_MONITOR_TYPES)(
    "%s: the default is dropped exactly when the type has no interval step",
    (monitorType: MonitorType) => {
      expect(
        shouldDropDefaultMonitoringInterval({
          monitorType: monitorType,
          isIntervalPrefilled: false,
        }),
      ).toBe(!MonitorTypeHelper.doesMonitorTypeHaveInterval(monitorType));
    },
  );

  test.each(ALL_MONITOR_TYPES)(
    "%s: a prefilled interval is never dropped",
    (monitorType: MonitorType) => {
      expect(
        shouldDropDefaultMonitoringInterval({
          monitorType: monitorType,
          isIntervalPrefilled: true,
        }),
      ).toBe(false);
    },
  );

  test("probe-checked types keep the default", () => {
    for (const monitorType of [
      MonitorType.Website,
      MonitorType.API,
      MonitorType.Ping,
      MonitorType.IP,
      MonitorType.Port,
      MonitorType.SSLCertificate,
      MonitorType.SyntheticMonitor,
      MonitorType.CustomJavaScriptCode,
      MonitorType.DNS,
      MonitorType.Domain,
    ]) {
      expect([
        monitorType,
        shouldDropDefaultMonitoringInterval({
          monitorType: monitorType,
          isIntervalPrefilled: false,
        }),
      ]).toEqual([monitorType, false]);
    }
  });

  test("types that never show the interval step are created without one", () => {
    for (const monitorType of [
      MonitorType.Manual,
      MonitorType.IncomingRequest,
      MonitorType.IncomingEmail,
      MonitorType.Logs,
      MonitorType.Metrics,
      MonitorType.Traces,
      MonitorType.Exceptions,
      MonitorType.Kubernetes,
    ]) {
      expect([
        monitorType,
        shouldDropDefaultMonitoringInterval({
          monitorType: monitorType,
          isIntervalPrefilled: false,
        }),
      ]).toEqual([monitorType, true]);
    }
  });

  test("keeps the value when the monitor type is not known", () => {
    expect(
      shouldDropDefaultMonitoringInterval({
        monitorType: undefined,
        isIntervalPrefilled: false,
      }),
    ).toBe(false);
  });
});
