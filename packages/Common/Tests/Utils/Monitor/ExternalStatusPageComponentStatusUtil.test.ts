import ExternalStatusPageComponentStatusUtil, {
  ExternalStatusPageComponentStatusValue,
} from "../../../Utils/Monitor/ExternalStatusPageComponentStatusUtil";
import { StatusPageSummaryStatus } from "../../../Types/StatusPage/StatusPageSummary";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * What a resource of a OneUptime status page reports as its component
 * status: the value its status stands for, among the values the Component
 * Status criteria compare with - so "Component Status is Under Maintenance"
 * and the default outage criteria work on a OneUptime page as they do on
 * Atlassian Statuspage and incident.io.
 */

function status(
  name: string,
  isOperational: boolean = false,
): StatusPageSummaryStatus {
  return { name: name, color: "#000000", isOperational: isOperational };
}

function valueOf(
  current: StatusPageSummaryStatus | null,
  isUnderMaintenance: boolean = false,
): ExternalStatusPageComponentStatusValue {
  return ExternalStatusPageComponentStatusUtil.fromStatusPageStatus({
    status: current,
    isUnderMaintenance: isUnderMaintenance,
  });
}

describe("ExternalStatusPageComponentStatusUtil.fromStatusPageStatus", () => {
  test("a project's three default statuses", () => {
    expect(valueOf(status("Operational", true))).toBe(
      ExternalStatusPageComponentStatusValue.Operational,
    );
    expect(valueOf(status("Degraded"))).toBe(
      ExternalStatusPageComponentStatusValue.DegradedPerformance,
    );
    expect(valueOf(status("Offline"))).toBe(
      ExternalStatusPageComponentStatusValue.MajorOutage,
    );
  });

  test.each([
    // A status of the project's own, named for maintenance.
    ["Maintenance", ExternalStatusPageComponentStatusValue.UnderMaintenance],
    [
      "Under Maintenance",
      ExternalStatusPageComponentStatusValue.UnderMaintenance,
    ],
    ["In maintenance", ExternalStatusPageComponentStatusValue.UnderMaintenance],
    [
      "Scheduled Maintenance",
      ExternalStatusPageComponentStatusValue.UnderMaintenance,
    ],
    [
      "planned-maintenance",
      ExternalStatusPageComponentStatusValue.UnderMaintenance,
    ],
    // Names that say how bad it is.
    [
      "Degraded Performance",
      ExternalStatusPageComponentStatusValue.DegradedPerformance,
    ],
    ["Degradation", ExternalStatusPageComponentStatusValue.DegradedPerformance],
    [
      "Performance Issues",
      ExternalStatusPageComponentStatusValue.DegradedPerformance,
    ],
    ["Partial Outage", ExternalStatusPageComponentStatusValue.PartialOutage],
    ["Partial", ExternalStatusPageComponentStatusValue.PartialOutage],
    ["Major Outage", ExternalStatusPageComponentStatusValue.MajorOutage],
    ["Down", ExternalStatusPageComponentStatusValue.MajorOutage],
    ["Outage", ExternalStatusPageComponentStatusValue.MajorOutage],
    ["Unavailable", ExternalStatusPageComponentStatusValue.MajorOutage],
    ["Unreachable", ExternalStatusPageComponentStatusValue.MajorOutage],
    ["Critical", ExternalStatusPageComponentStatusValue.MajorOutage],
    ["Full Outage", ExternalStatusPageComponentStatusValue.FullOutage],
    ["full_outage", ExternalStatusPageComponentStatusValue.FullOutage],
    // An operational name, even where the project has not flagged it.
    ["Operational", ExternalStatusPageComponentStatusValue.Operational],
    ["Online", ExternalStatusPageComponentStatusValue.Operational],
    ["Up", ExternalStatusPageComponentStatusValue.Operational],
    // Any other status is not operational, and says nothing of how bad.
    [
      "Investigating",
      ExternalStatusPageComponentStatusValue.DegradedPerformance,
    ],
    ["Monitoring", ExternalStatusPageComponentStatusValue.DegradedPerformance],
    ["🔥", ExternalStatusPageComponentStatusValue.DegradedPerformance],
  ])(
    "a status named %s reads %s",
    (name: string, expected: ExternalStatusPageComponentStatusValue) => {
      expect(valueOf(status(name))).toBe(expected);
    },
  );

  test("the project's operational status is operational, whatever it is called", () => {
    expect(valueOf(status("All good", true))).toBe(
      ExternalStatusPageComponentStatusValue.Operational,
    );
    expect(valueOf(status("Major Outage", true))).toBe(
      ExternalStatusPageComponentStatusValue.Operational,
    );
  });

  test("a status named for maintenance is maintenance, even when the project counts it as operational", () => {
    expect(valueOf(status("Maintenance", true))).toBe(
      ExternalStatusPageComponentStatusValue.UnderMaintenance,
    );
  });

  test("under maintenance whatever the status: an event in progress holds the monitors", () => {
    for (const current of [
      status("Operational", true),
      status("Degraded"),
      status("Offline"),
      status("Full Outage"),
      null,
    ]) {
      expect(valueOf(current, true)).toBe(
        ExternalStatusPageComponentStatusValue.UnderMaintenance,
      );
    }
  });

  test("unknown when the page does not show the status", () => {
    expect(valueOf(null)).toBe(ExternalStatusPageComponentStatusValue.Unknown);
  });
});

describe("ExternalStatusPageComponentStatusUtil.normalizeName", () => {
  test.each([
    ["Operational", "operational"],
    ["Partial Outage", "partial_outage"],
    ["  Partial   Outage  ", "partial_outage"],
    ["partial-outage", "partial_outage"],
    ["Partial/Outage!", "partial_outage"],
    ["__under__maintenance__", "under_maintenance"],
    ["", ""],
    ["---", ""],
  ])("%s -> %s", (name: string, expected: string) => {
    expect(ExternalStatusPageComponentStatusUtil.normalizeName(name)).toBe(
      expected,
    );
  });

  test.each([
    ["one long run of punctuation", "-".repeat(400000)],
    ["letters and punctuation by turns", "a-".repeat(200000)],
    ["a long word", "x".repeat(400000)],
  ])(
    "reads a status name of %s in linear time",
    (_name: string, name: string) => {
      const timed: FastestRun<void> = fastestRun({
        run: (): void => {
          ExternalStatusPageComponentStatusUtil.fromStatusPageStatus({
            status: status(name),
            isUnderMaintenance: false,
          });
        },
        limitInMs: 2000,
      });

      expect(timed.inMs).toBeLessThan(2000);
    },
  );
});
