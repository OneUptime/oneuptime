import MonitorTestAvailabilityUtil, {
  MonitorTestAvailability,
} from "../../../Utils/Monitor/MonitorTestAvailabilityUtil";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType, {
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import { describe, expect, it } from "@jest/globals";

/*
 * https://github.com/OneUptime/oneuptime/issues/3867
 *
 * "Test Monitor" was reachable only from Monitors > View Monitor > Criteria.
 * Putting it on the Monitor Overview's summary card puts it in front of far
 * more monitors than the criteria page ever did - including every monitor type
 * that no probe runs, monitors that have not been given any steps, and
 * monitors with nothing attached to test with.
 *
 * Each of those three is a dead end that a user only discovers after
 * committing, and two of them look like the same thing (a timeout) even though
 * one is a configuration gap and the other is a client-side mistake:
 *
 *   - no steps: the probe returns before reporting anything, so the dashboard
 *     polls for two and a half minutes and then says the test "took too long";
 *   - no probes: the modal's required "Select Probe" dropdown has no options,
 *     so "Run Test" can never be submitted.
 *
 * This is the rule that keeps the button from being offered in any of them.
 */

function stepsWith(count: number): MonitorSteps {
  const monitorSteps: MonitorSteps = new MonitorSteps();

  monitorSteps.data = {
    monitorStepsInstanceArray: Array.from({ length: count }, () => {
      return new MonitorStep();
    }),
  };

  return monitorSteps;
}

const ONE_STEP: MonitorSteps = stepsWith(1);

describe("MonitorTestAvailabilityUtil.getAvailability", () => {
  it("offers the test for a probeable monitor that has steps and a probe", () => {
    expect(
      MonitorTestAvailabilityUtil.getAvailability({
        monitorType: MonitorType.Website,
        monitorSteps: ONE_STEP,
        attachedProbeCount: 1,
      }),
    ).toBe(MonitorTestAvailability.Available);
  });

  it("refuses a monitor type that no probe runs", () => {
    /*
     * A telemetry monitor is evaluated by the server against ingested data;
     * there is no probe to hand it to, and MonitorTestForm renders nothing for
     * it - which would leave an empty slot in the card header.
     */
    expect(
      MonitorTestAvailabilityUtil.getAvailability({
        monitorType: MonitorType.Logs,
        monitorSteps: ONE_STEP,
        attachedProbeCount: 3,
      }),
    ).toBe(MonitorTestAvailability.MonitorTypeNotProbeable);
  });

  it("refuses a manual monitor", () => {
    expect(
      MonitorTestAvailabilityUtil.getAvailability({
        monitorType: MonitorType.Manual,
        monitorSteps: ONE_STEP,
        attachedProbeCount: 3,
      }),
    ).toBe(MonitorTestAvailability.MonitorTypeNotProbeable);
  });

  it("refuses while the monitor type is still unknown", () => {
    /*
     * The overview page renders a loader until the monitor arrives, but the
     * card must not depend on that: an undefined type is not yet an answer.
     */
    expect(
      MonitorTestAvailabilityUtil.getAvailability({
        monitorType: undefined,
        monitorSteps: ONE_STEP,
        attachedProbeCount: 3,
      }),
    ).toBe(MonitorTestAvailability.MonitorTypeNotProbeable);
  });

  it("refuses when the monitor has no steps object at all", () => {
    expect(
      MonitorTestAvailabilityUtil.getAvailability({
        monitorType: MonitorType.Ping,
        monitorSteps: undefined,
        attachedProbeCount: 2,
      }),
    ).toBe(MonitorTestAvailability.NoMonitorSteps);
  });

  it("refuses when monitorSteps is null rather than undefined", () => {
    // ModelAPI hands back null for an unset column, not undefined.
    expect(
      MonitorTestAvailabilityUtil.getAvailability({
        monitorType: MonitorType.Ping,
        monitorSteps: null,
        attachedProbeCount: 2,
      }),
    ).toBe(MonitorTestAvailability.NoMonitorSteps);
  });

  it("refuses when the steps object carries no data", () => {
    const empty: MonitorSteps = new MonitorSteps();
    empty.data = undefined;

    expect(
      MonitorTestAvailabilityUtil.getAvailability({
        monitorType: MonitorType.Ping,
        monitorSteps: empty,
        attachedProbeCount: 2,
      }),
    ).toBe(MonitorTestAvailability.NoMonitorSteps);
  });

  it("refuses when the steps array is empty", () => {
    /*
     * The case that matters most: the row would be created and accepted, and
     * the probe would return without reporting, so the only thing the user
     * would ever see is "took too long to complete".
     */
    expect(
      MonitorTestAvailabilityUtil.getAvailability({
        monitorType: MonitorType.Ping,
        monitorSteps: stepsWith(0),
        attachedProbeCount: 2,
      }),
    ).toBe(MonitorTestAvailability.NoMonitorSteps);
  });

  it("refuses when nothing is attached to run the test on", () => {
    expect(
      MonitorTestAvailabilityUtil.getAvailability({
        monitorType: MonitorType.API,
        monitorSteps: ONE_STEP,
        attachedProbeCount: 0,
      }),
    ).toBe(MonitorTestAvailability.NoProbesAttached);
  });

  it("refuses a negative probe count rather than trusting it", () => {
    expect(
      MonitorTestAvailabilityUtil.getAvailability({
        monitorType: MonitorType.API,
        monitorSteps: ONE_STEP,
        attachedProbeCount: -1,
      }),
    ).toBe(MonitorTestAvailability.NoProbesAttached);
  });

  it("reports the monitor type first when more than one thing is missing", () => {
    /*
     * Order matters for a caller that explains itself: the type is the reason
     * that can never be fixed by editing this monitor.
     */
    expect(
      MonitorTestAvailabilityUtil.getAvailability({
        monitorType: MonitorType.Manual,
        monitorSteps: undefined,
        attachedProbeCount: 0,
      }),
    ).toBe(MonitorTestAvailability.MonitorTypeNotProbeable);
  });

  it("reports missing steps before missing probes", () => {
    expect(
      MonitorTestAvailabilityUtil.getAvailability({
        monitorType: MonitorType.API,
        monitorSteps: stepsWith(0),
        attachedProbeCount: 0,
      }),
    ).toBe(MonitorTestAvailability.NoMonitorSteps);
  });

  it("agrees with MonitorTypeHelper.isProbableMonitor for every monitor type", () => {
    /*
     * The set of probeable types is not a list this rule keeps its own copy of.
     * If a new monitor type becomes probeable, the button must follow without
     * anyone remembering to edit this file.
     */
    const allTypes: Array<MonitorType> = Object.values(MonitorType);

    expect(allTypes.length).toBeGreaterThan(20);

    for (const monitorType of allTypes) {
      const availability: MonitorTestAvailability =
        MonitorTestAvailabilityUtil.getAvailability({
          monitorType: monitorType,
          monitorSteps: ONE_STEP,
          attachedProbeCount: 1,
        });

      if (MonitorTypeHelper.isProbableMonitor(monitorType)) {
        expect(availability).toBe(MonitorTestAvailability.Available);
      } else {
        expect(availability).toBe(
          MonitorTestAvailability.MonitorTypeNotProbeable,
        );
      }
    }
  });
});

describe("MonitorTestAvailabilityUtil.isAvailable", () => {
  it("is true only for the Available verdict", () => {
    expect(
      MonitorTestAvailabilityUtil.isAvailable({
        monitorType: MonitorType.Port,
        monitorSteps: ONE_STEP,
        attachedProbeCount: 1,
      }),
    ).toBe(true);

    expect(
      MonitorTestAvailabilityUtil.isAvailable({
        monitorType: MonitorType.Port,
        monitorSteps: ONE_STEP,
        attachedProbeCount: 0,
      }),
    ).toBe(false);
  });
});

describe("MonitorTestAvailabilityUtil.getMonitorStepCount", () => {
  it("counts the steps a test would run", () => {
    expect(MonitorTestAvailabilityUtil.getMonitorStepCount(stepsWith(3))).toBe(
      3,
    );
  });

  it("answers zero for every shape of missing steps", () => {
    const noData: MonitorSteps = new MonitorSteps();
    noData.data = undefined;

    expect(MonitorTestAvailabilityUtil.getMonitorStepCount(undefined)).toBe(0);
    expect(MonitorTestAvailabilityUtil.getMonitorStepCount(null)).toBe(0);
    expect(MonitorTestAvailabilityUtil.getMonitorStepCount(noData)).toBe(0);
    expect(MonitorTestAvailabilityUtil.getMonitorStepCount(stepsWith(0))).toBe(
      0,
    );
  });
});
