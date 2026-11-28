import IP from "../../../Types/IP/IP";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import MonitorCriteriaClear from "../../../Utils/Monitor/MonitorCriteriaClear";
import { describe, expect, it } from "@jest/globals";

/*
 * UNLINK FROM TEMPLATE'S "CLEAR THE TEMPLATE'S CRITERIA" (issue #11266).
 *
 * A deleted template's criteria stayed on its monitors and kept firing. The
 * criteria come off; what each step checks stays - its address, its
 * request, the status it goes back to - so the monitor keeps checking and
 * keeps its history, and raises nothing until it is linked again.
 */

const ONLINE_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OFFLINE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

function pingSteps(stepCount: number): MonitorSteps {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: Array.from(
      { length: stepCount },
      (_value: unknown, index: number): MonitorStep => {
        const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
          monitorName: "WB Ping Monitor Template - No Alert",
          monitorType: MonitorType.Ping,
          onlineMonitorStatusId: ONLINE_ID,
          offlineMonitorStatusId: OFFLINE_ID,
          defaultIncidentSeverityId: SEVERITY_ID,
          defaultAlertSeverityId: SEVERITY_ID,
        });
        step.data!.id = `step-${index + 1}`;
        step.setMonitorDestination(IP.fromString(`10.40.12.${index + 7}`));
        return step;
      },
    ),
    defaultMonitorStatusId: ONLINE_ID,
  };
  return monitorSteps;
}

describe("clearing a monitor's criteria", () => {
  it("takes every criteria off every step", () => {
    const steps: MonitorSteps = pingSteps(2);

    expect(MonitorCriteriaClear.hasCriteria(steps)).toBe(true);

    const cleared: MonitorSteps = MonitorCriteriaClear.clearCriteria(steps);

    expect(MonitorCriteriaClear.hasCriteria(cleared)).toBe(false);

    for (const step of cleared.data!.monitorStepsInstanceArray) {
      expect(
        step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray,
      ).toEqual([]);
    }
  });

  it("keeps what each step checks, its id, and the status the monitor goes back to", () => {
    const cleared: MonitorSteps = MonitorCriteriaClear.clearCriteria(
      pingSteps(2),
    );

    expect(
      cleared.data!.monitorStepsInstanceArray.map((step: MonitorStep) => {
        return [step.data!.id, step.data!.monitorDestination?.toString()];
      }),
    ).toEqual([
      ["step-1", "10.40.12.7"],
      ["step-2", "10.40.12.8"],
    ]);
    expect(cleared.data!.defaultMonitorStatusId?.toString()).toBe(
      ONLINE_ID.toString(),
    );
  });

  it("never changes the steps it is handed", () => {
    const steps: MonitorSteps = pingSteps(1);

    MonitorCriteriaClear.clearCriteria(steps);

    expect(MonitorCriteriaClear.hasCriteria(steps)).toBe(true);
  });

  it("round-trips as the database stores steps: an empty list of criteria reads back empty", () => {
    const cleared: MonitorSteps = MonitorCriteriaClear.clearCriteria(
      pingSteps(1),
    );

    const readBack: MonitorSteps = MonitorSteps.fromJSON(cleared.toJSON());

    expect(MonitorCriteriaClear.hasCriteria(readBack)).toBe(false);
    expect(
      readBack.data!.monitorStepsInstanceArray[0]!.data!.monitorDestination?.toString(),
    ).toBe("10.40.12.7");
  });

  it("says a monitor with no steps has nothing to clear", () => {
    const noSteps: MonitorSteps = new MonitorSteps();
    noSteps.data = { monitorStepsInstanceArray: [] };

    expect(MonitorCriteriaClear.hasCriteria(undefined)).toBe(false);
    expect(MonitorCriteriaClear.hasCriteria(noSteps)).toBe(false);
  });

  it("says a monitor cleared before has nothing to clear again", () => {
    expect(
      MonitorCriteriaClear.hasCriteria(
        MonitorCriteriaClear.clearCriteria(pingSteps(3)),
      ),
    ).toBe(false);
  });
});
