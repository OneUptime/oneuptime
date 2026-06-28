import monitorStepCanAlertOnAbsence from "../../../../Server/Utils/Monitor/MonitorAbsenceSensitivity";
import { NoDataPolicy } from "../../../../Types/Monitor/CriteriaFilter";

describe("monitorStepCanAlertOnAbsence", () => {
  test("false for undefined / empty", () => {
    expect(monitorStepCanAlertOnAbsence(undefined)).toBe(false);
    expect(monitorStepCanAlertOnAbsence({})).toBe(false);
  });

  test("false when no onNoDataPolicy present (defaults to Ignore)", () => {
    const step: object = {
      metricMonitor: { metricViewConfig: { queryConfigs: [{ x: 1 }] } },
      monitorCriteria: {
        monitorCriteriaInstanceArray: [
          { filters: [{ checkOn: "MetricValue" }] },
        ],
      },
    };
    expect(monitorStepCanAlertOnAbsence(step as never)).toBe(false);
  });

  test("false when the only policy is Ignore", () => {
    const step: object = {
      monitorCriteria: {
        monitorCriteriaInstanceArray: [
          {
            filters: [
              { metricMonitorOptions: { onNoDataPolicy: NoDataPolicy.Ignore } },
            ],
          },
        ],
      },
    };
    expect(monitorStepCanAlertOnAbsence(step as never)).toBe(false);
  });

  test("true when any criterion uses Trigger (nested arbitrarily deep)", () => {
    const step: object = {
      monitorCriteria: {
        monitorCriteriaInstanceArray: [
          {
            filters: [
              { metricMonitorOptions: { onNoDataPolicy: NoDataPolicy.Ignore } },
            ],
          },
          {
            filters: [
              { metricMonitorOptions: { onNoDataPolicy: NoDataPolicy.Trigger } },
            ],
          },
        ],
      },
    };
    expect(monitorStepCanAlertOnAbsence(step as never)).toBe(true);
  });

  test("true when any criterion uses Treat As Zero (absence can breach)", () => {
    const step: object = {
      a: { b: { metricMonitorOptions: { onNoDataPolicy: NoDataPolicy.TreatAsZero } } },
    };
    expect(monitorStepCanAlertOnAbsence(step as never)).toBe(true);
  });

  test("handles arrays and ignores non-policy strings", () => {
    const step: object = {
      list: [
        { onNoDataPolicy: "Ignore" },
        { onNoDataPolicy: "something-else" },
        { nested: [{ onNoDataPolicy: NoDataPolicy.Trigger }] },
      ],
    };
    expect(monitorStepCanAlertOnAbsence(step as never)).toBe(true);
  });
});
