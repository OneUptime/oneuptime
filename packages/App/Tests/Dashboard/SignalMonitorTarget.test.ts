import { describe, expect, test } from "@jest/globals";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import {
  buildRumCustomSignalTemplate,
  getAllRumAlertTemplates,
} from "Common/Types/Monitor/RumAlertTemplates";
import {
  findSignalName,
  readSignalMonitorTarget,
} from "../../FeatureSet/Dashboard/src/Components/Monitor/MonitorSteps/SignalMonitorTarget";

/*
 * The monitor page of an alert on a signal of a RUM application's own
 * (issue #6518) links to the sessions that hit the signal: which monitors
 * those are is read from the step a "Sessions hit <signal>" recommendation
 * builds, and the signal's name from the application's settings now, so a
 * rename is followed.
 */

const APP_ID: string = "0193c0de-3333-4aaa-8bbb-000000000003";

function stepOf(signal: { id: string; name: string }): MonitorStep {
  return buildRumCustomSignalTemplate(signal).getMonitorStep({
    rumApplicationId: APP_ID,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Checkout",
  });
}

describe("which monitors watch a signal of the application's own", () => {
  test("the monitor a Sessions hit recommendation creates, by application and signal id", () => {
    expect(
      readSignalMonitorTarget(
        MonitorType.Metrics,
        stepOf({ id: "signal-payment", name: "Payment failed" }),
      ),
    ).toEqual({ rumApplicationId: APP_ID, signalId: "signal-payment" });
  });

  test("the same step read back from the stored monitor", () => {
    const restored: MonitorStep = MonitorStep.fromJSON(
      stepOf({ id: "signal-payment", name: "Payment failed" }).toJSON(),
    );

    expect(readSignalMonitorTarget(MonitorType.Metrics, restored)).toEqual({
      rumApplicationId: APP_ID,
      signalId: "signal-payment",
    });
  });

  test("no other RUM recommendation, and no monitor of another type", () => {
    for (const template of getAllRumAlertTemplates()) {
      const step: MonitorStep = template.getMonitorStep({
        rumApplicationId: APP_ID,
        onlineMonitorStatusId: ObjectID.generate(),
        offlineMonitorStatusId: ObjectID.generate(),
        defaultIncidentSeverityId: ObjectID.generate(),
        defaultAlertSeverityId: ObjectID.generate(),
        monitorName: "Checkout",
      });

      expect([
        template.id,
        readSignalMonitorTarget(template.monitorType, step),
      ]).toEqual([template.id, null]);
    }

    expect(
      readSignalMonitorTarget(
        MonitorType.Logs,
        stepOf({ id: "signal-payment", name: "Payment failed" }),
      ),
    ).toBeNull();
    expect(readSignalMonitorTarget(MonitorType.Metrics, undefined)).toBeNull();
    expect(readSignalMonitorTarget(undefined, undefined)).toBeNull();
  });

  test("not a metric step watching two applications: a signal is one application's", () => {
    const step: MonitorStep = stepOf({
      id: "signal-payment",
      name: "Payment failed",
    });

    step.data!.metricMonitor!.telemetryServiceIds = [
      new ObjectID(APP_ID),
      ObjectID.generate(),
    ];

    expect(readSignalMonitorTarget(MonitorType.Metrics, step)).toBeNull();
  });
});

describe("the signal's name now", () => {
  const stored: unknown = {
    customSignals: [
      {
        id: "signal-payment",
        name: "Payment declined",
        trigger: "page",
        match: "/checkout/error",
        isEnabled: false,
      },
    ],
  };

  test("follows a rename, and a signal switched off still has its name", () => {
    expect(findSignalName(stored, "signal-payment")).toBe("Payment declined");
  });

  test("is none for a signal the application no longer has, or a damaged column", () => {
    expect(findSignalName(stored, "signal-chat")).toBeNull();
    expect(findSignalName(null, "signal-payment")).toBeNull();
    expect(findSignalName("not settings", "signal-payment")).toBeNull();
  });
});
