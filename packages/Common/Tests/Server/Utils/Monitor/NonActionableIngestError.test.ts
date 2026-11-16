import {
  isNonActionableIngestError,
  logMonitorEvaluationError,
} from "../../../../Server/Utils/Monitor/NonActionableIngestError";
import { MONITOR_TEST_NOT_HANDED_TO_PROBE_MESSAGE } from "../../../../Server/Services/MonitorTestService";
import logger from "../../../../Server/Utils/Logger";
import {
  PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE,
  REPORTING_PROBE_NOT_KNOWN_MESSAGE,
} from "../../../../Server/Utils/Probe/ProbeReportIdentity";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ExceptionMessages from "../../../../Types/Exception/ExceptionMessages";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * WHAT NOBODY CAN ACT ON, SHARED FROM COMMON (issue #8069).
 *
 * isNonActionableIngestError says which of MonitorResource's refusals are
 * expected: the telemetry worker completes such a job instead of retrying
 * it. A caller that evaluates one monitor after another - a worker's
 * heartbeat sweep, a device's poll or trap fanned out to its monitors - logs
 * such a refusal at debug and goes on (logMonitorEvaluationError): it
 * reaches it only for a monitor paused, archived, disabled or deleted
 * between its own read and MonitorResource's. Anything else is still logged
 * at error.
 */

describe("isNonActionableIngestError", () => {
  /*
   * An unknown monitor, every refusal MonitorResource gives for a monitor
   * that is not being monitored: archived, disabled, or paused while a
   * manually created incident is unresolved or a maintenance event it is
   * attached to has not ended - and a probe's result for a monitor that probe
   * does not check (issue #8161), which every retry is refused the same way;
   * a probe's result that names another probe, or a job that names no
   * probe (issue #8424), which no retry changes either; and a monitor test
   * result for a test the probe was not handed, or that is gone (issue
   * #8539).
   */
  test.each([
    ExceptionMessages.MonitorNotFound,
    ExceptionMessages.MonitorDisabled,
    ExceptionMessages.MonitorArchived,
    ExceptionMessages.MonitorDisabledBecauseOfManualIncident,
    ExceptionMessages.MonitorDisabledBecauseOfScheduledMaintenanceEvent,
    ExceptionMessages.ProbeNotAssignedToMonitor,
    PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE,
    REPORTING_PROBE_NOT_KNOWN_MESSAGE,
    ExceptionMessages.MonitorTestNotHandedToProbe,
    MONITOR_TEST_NOT_HANDED_TO_PROBE_MESSAGE,
  ])("is true for a BadDataException '%s'", (message: string) => {
    expect(isNonActionableIngestError(new BadDataException(message))).toBe(
      true,
    );
  });

  test("is false for any other BadDataException", () => {
    expect(
      isNonActionableIngestError(new BadDataException("Invalid Secret Key")),
    ).toBe(false);
  });

  test("is false for another kind of error with the same message", () => {
    expect(
      isNonActionableIngestError(new Error(ExceptionMessages.MonitorNotFound)),
    ).toBe(false);
  });

  test.each([
    ExceptionMessages.MonitorDisabledBecauseOfManualIncident,
    ExceptionMessages.MonitorDisabledBecauseOfScheduledMaintenanceEvent,
    ExceptionMessages.ProbeNotAssignedToMonitor,
    PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE,
    REPORTING_PROBE_NOT_KNOWN_MESSAGE,
    ExceptionMessages.MonitorTestNotHandedToProbe,
  ])(
    "is false for another kind of error with a paused monitor's refusal '%s'",
    (message: string) => {
      expect(isNonActionableIngestError(new Error(message))).toBe(false);
    },
  );

  /*
   * The refusals are matched exactly, so a failure that only reads like one
   * - another "Monitor is disabled because ..." - is still retried.
   */
  test.each([
    "Monitor is disabled because",
    `${ExceptionMessages.MonitorDisabledBecauseOfScheduledMaintenanceEvent} `,
    ExceptionMessages.MonitorDisabledBecauseOfManualIncident.toLowerCase(),
    "Monitor does not have a projectId",
    // Only the refusals ProbeReportIdentity gives, word for word.
    "A probe reports only its own results",
    "A probe can only report its own results.",
    `${PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE} `,
    PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE.toLowerCase(),
    "This probe result does not say which probe sent it",
    REPORTING_PROBE_NOT_KNOWN_MESSAGE.toUpperCase(),
    // Only the monitor test refusal MonitorTestService gives, word for word.
    "This monitor test was not handed to this probe",
    ExceptionMessages.MonitorTestNotHandedToProbe.toLowerCase(),
    `${ExceptionMessages.MonitorTestNotHandedToProbe} `,
    "TestId not found",
    // Other refusals of a probe's report are still retried.
    "Probe ID not found on SNMP trap request",
    `${ExceptionMessages.ProbeNotAssignedToMonitor}.`,
    ExceptionMessages.ProbeNotAssignedToMonitor.toUpperCase(),
  ])(
    "is false for a BadDataException that is not one of them: '%s'",
    (message: string) => {
      expect(isNonActionableIngestError(new BadDataException(message))).toBe(
        false,
      );
    },
  );

  test.each([undefined, null, ExceptionMessages.MonitorNotFound, {}])(
    "is false for %p, which is not an error",
    (value: unknown) => {
      expect(isNonActionableIngestError(value)).toBe(false);
    },
  );
});

describe("logMonitorEvaluationError", () => {
  let debug: SpyInstance<typeof logger.debug>;
  let error: SpyInstance<typeof logger.error>;

  beforeEach(() => {
    debug = jest.spyOn(logger, "debug").mockImplementation(() => {
      return undefined;
    });
    error = jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * Every refusal of a monitor that changed between the caller's read and
   * MonitorResource's: deleted, disabled, archived, paused by a manual
   * incident or by a maintenance event.
   */
  test.each([
    ExceptionMessages.MonitorNotFound,
    ExceptionMessages.MonitorDisabled,
    ExceptionMessages.MonitorArchived,
    ExceptionMessages.MonitorDisabledBecauseOfManualIncident,
    ExceptionMessages.MonitorDisabledBecauseOfScheduledMaintenanceEvent,
  ])(
    "logs the refusal '%s' at debug, never at error, and says it was one",
    (message: string) => {
      const isRefusal: boolean = logMonitorEvaluationError({
        error: new BadDataException(message),
        message: "Error evaluating monitor 1",
        attributes: { monitorId: "1" },
      });

      expect(isRefusal).toBe(true);
      expect(error).not.toHaveBeenCalled();
      expect(debug).toHaveBeenCalledTimes(1);
      expect(debug.mock.calls[0]![0]).toContain("Error evaluating monitor 1");
      expect(debug.mock.calls[0]![0]).toContain(message);
      expect(debug.mock.calls[0]![1]).toEqual({ monitorId: "1" });
    },
  );

  test("logs any other error at error, as before, with the error itself", () => {
    const failure: Error = new Error("Acquire mutex timeout");

    const isRefusal: boolean = logMonitorEvaluationError({
      error: failure,
      message: "Error evaluating monitor 1",
      attributes: { monitorId: "1" },
    });

    expect(isRefusal).toBe(false);
    expect(debug).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenNthCalledWith(1, "Error evaluating monitor 1", {
      monitorId: "1",
    });
    expect(error).toHaveBeenNthCalledWith(2, failure, { monitorId: "1" });
  });

  test("logs a BadDataException that is not a refusal at error", () => {
    expect(
      logMonitorEvaluationError({
        error: new BadDataException("Monitor does not have a projectId"),
        message: "Error evaluating monitor 1",
      }),
    ).toBe(false);

    expect(debug).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(2);
  });

  test("logs a refusal's words thrown as another kind of error at error", () => {
    expect(
      logMonitorEvaluationError({
        error: new Error(ExceptionMessages.MonitorDisabled),
        message: "Error evaluating monitor 1",
      }),
    ).toBe(false);

    expect(debug).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(2);
  });
});
