import ProfileAggregationService, {
  StackShareResult,
} from "../../../../Server/Services/ProfileAggregationService";
import ProfileMonitorShare from "../../../../Server/Utils/Profile/ProfileMonitorShare";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../Types/BaseDatabase/Includes";
import MonitorStepProfileMonitor, {
  MonitorStepProfileMonitorUtil,
} from "../../../../Types/Monitor/MonitorStepProfileMonitor";
import { ProfileFunctionShareReading } from "../../../../Types/Monitor/ProfileMonitor/ProfileMonitorResponse";
import ObjectID from "../../../../Types/ObjectID";
import { ProfileTypeActivity } from "../../../../Utils/Profiles/ProfileTypes";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The Profiles monitor's Function Share: how much of the monitor's window
 * ran through code matching its function text, over the same profiles its
 * Profile Count reads. The profile types are narrowed to one unit first, so
 * a service profiled in nanoseconds next to the eBPF agent's sample counts
 * never adds one to the other; no function named reads as nothing.
 */

const projectId: ObjectID = ObjectID.generate();
const serviceId: ObjectID = ObjectID.generate();
const EVALUATE_UNTIL: Date = new Date("2026-10-20T12:00:00.000Z");

function step(
  change: Partial<MonitorStepProfileMonitor> = {},
): MonitorStepProfileMonitor {
  return {
    ...MonitorStepProfileMonitorUtil.getDefault(),
    telemetryServiceIds: [serviceId],
    functionName: "parseOrder",
    ...change,
  };
}

function shareRead(
  result: Partial<StackShareResult> = {},
): jest.SpiedFunction<typeof ProfileAggregationService.getStackShare> {
  return jest
    .spyOn(ProfileAggregationService, "getStackShare")
    .mockResolvedValue({
      matchedValue: 341,
      windowTotal: 1000,
      windowSampleCount: 1000,
      sharePercent: 34.123,
      ...result,
    });
}

function activity(rows: Array<ProfileTypeActivity>): void {
  jest
    .spyOn(ProfileAggregationService, "getProfileTypeActivity")
    .mockResolvedValue(rows);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a function's share of the monitor's window", () => {
  test("is read over the monitor's own window and services, rounded to two places", async () => {
    activity([
      {
        profileType: "cpu",
        unit: "nanoseconds",
        sampleCount: 900,
        profileCount: 9,
      },
    ]);
    const read: jest.SpiedFunction<
      typeof ProfileAggregationService.getStackShare
    > = shareRead();

    const reading: ProfileFunctionShareReading | null =
      await ProfileMonitorShare.measure({
        projectId,
        monitorStepProfileMonitor: step(),
        evaluateUntil: EVALUATE_UNTIL,
      });

    expect(reading).toEqual({
      functionName: "parseOrder",
      sharePercent: 34.12,
      windowSampleCount: 1000,
    });

    const request: Parameters<
      typeof ProfileAggregationService.getStackShare
    >[0] = read.mock.calls[0]![0];

    expect(request.frameText).toBe("parseOrder");
    expect(request.endTime.toISOString()).toBe(EVALUATE_UNTIL.toISOString());
    // Five minutes: the default monitor's window.
    expect(request.endTime.getTime() - request.startTime.getTime()).toBe(
      300 * 1000,
    );
    expect(request.profileQuery.primaryEntityId).toBeInstanceOf(Includes);
    expect(request.profileQuery.startTime).toBeInstanceOf(InBetween);
  });

  test("CPU time from two profilers in two units is read in the unit with more samples", async () => {
    activity([
      {
        profileType: "cpu",
        unit: "nanoseconds",
        sampleCount: 900,
        profileCount: 9,
      },
      {
        profileType: "samples",
        unit: "count",
        sampleCount: 100,
        profileCount: 2,
      },
    ]);
    const read: jest.SpiedFunction<
      typeof ProfileAggregationService.getStackShare
    > = shareRead();

    await ProfileMonitorShare.measure({
      projectId,
      monitorStepProfileMonitor: step(),
      evaluateUntil: EVALUATE_UNTIL,
    });

    expect(
      (read.mock.calls[0]![0].profileQuery.profileType as Includes).values,
    ).toEqual(["cpu"]);
  });

  test("no function named: nothing is read, and there is no share to judge", async () => {
    const read: jest.SpiedFunction<
      typeof ProfileAggregationService.getStackShare
    > = shareRead();

    expect(
      await ProfileMonitorShare.measure({
        projectId,
        monitorStepProfileMonitor: step({ functionName: "   " }),
      }),
    ).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  test("nothing profiled in the window reads as a share of no samples", async () => {
    activity([]);
    shareRead({
      matchedValue: 0,
      windowTotal: 0,
      windowSampleCount: 0,
      sharePercent: 0,
    });

    expect(
      await ProfileMonitorShare.measure({
        projectId,
        monitorStepProfileMonitor: step(),
        evaluateUntil: EVALUATE_UNTIL,
      }),
    ).toEqual({
      functionName: "parseOrder",
      sharePercent: 0,
      windowSampleCount: 0,
    });
  });
});
