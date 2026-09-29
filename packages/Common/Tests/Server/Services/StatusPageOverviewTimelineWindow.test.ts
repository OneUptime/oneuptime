import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageGroupService from "../../../Server/Services/StatusPageGroupService";
import StatusPageResourceService from "../../../Server/Services/StatusPageResourceService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import MonitorGroupService from "../../../Server/Services/MonitorGroupService";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * StatusPageAPI.getStatusPageResourcesAndTimelines timeline-window
 * computation.
 *
 * The overview endpoint used to issue a SEPARATE one-column StatusPage query
 * (statusPageForDays) just to read showUptimeHistoryInDays and compute the
 * monitor-timeline window. That query was deleted: the helper's
 * startDateForMonitorTimeline/endDateForMonitorTimeline params became
 * optional, and when omitted the window is computed from the status page row
 * the helper ALREADY fetches — showUptimeHistoryInDays clamped to 1..90 days
 * (falsy hits `|| 90` BEFORE the < 1 clamp, so 0 means 90, not 1), ending
 * now. The computed window is also RETURNED so the overview handler can keep
 * serving it to the client.
 *
 * These tests pin: verbatim forwarding of explicit dates, the computed
 * window and its clamp ORDER, that the returned dates are exactly what the
 * timeline query received, and that the helper issues exactly ONE
 * StatusPageService.findOneBy — so the deleted per-request query cannot
 * sneak back on the hottest public endpoint in the product.
 *
 * All service reads are spied on — no database is touched.
 */

type ResourcesAndTimelinesResult = Awaited<
  ReturnType<StatusPageAPI["getStatusPageResourcesAndTimelines"]>
>;

type TimelineHelperArgs = {
  monitorIds: Array<ObjectID>;
  startDate: Date;
  endDate: Date;
};

function makeStatusPage(showUptimeHistoryInDays: number | undefined): {
  statusPageId: ObjectID;
  statusPage: StatusPage;
} {
  const statusPageId: ObjectID = ObjectID.generate();
  const statusPage: StatusPage = new StatusPage();
  statusPage._id = statusPageId.toString();
  statusPage.projectId = ObjectID.generate();
  if (showUptimeHistoryInDays !== undefined) {
    statusPage.showUptimeHistoryInDays = showUptimeHistoryInDays;
  }
  return { statusPageId, statusPage };
}

type Spies = {
  findOneBySpy: jest.SpyInstance;
  timelineSpy: jest.SpyInstance;
};

/*
 * The page is kept EMPTY (no resources, no groups) so every downstream loop
 * short-circuits and the only interesting behavior left is the window
 * computation itself.
 */
function mockEmptyStatusPage(statusPage: StatusPage): Spies {
  const findOneBySpy: jest.SpyInstance = (
    jest.spyOn(StatusPageService, "findOneBy") as unknown as jest.SpyInstance
  ).mockResolvedValue(statusPage as never);

  (
    jest.spyOn(MonitorStatusService, "findBy") as unknown as jest.SpyInstance
  ).mockResolvedValue([] as never);

  (
    jest.spyOn(StatusPageGroupService, "findBy") as unknown as jest.SpyInstance
  ).mockResolvedValue([] as never);

  (
    jest.spyOn(
      StatusPageResourceService,
      "findBy",
    ) as unknown as jest.SpyInstance
  ).mockResolvedValue([] as never);

  (
    jest.spyOn(
      MonitorGroupService,
      "getMonitorGroupResourcesByGroupIds",
    ) as unknown as jest.SpyInstance
  ).mockResolvedValue({} as never);

  (
    jest.spyOn(
      MonitorGroupService,
      "getCurrentStatusesForMonitorGroups",
    ) as unknown as jest.SpyInstance
  ).mockResolvedValue({} as never);

  const timelineSpy: jest.SpyInstance = (
    jest.spyOn(
      StatusPageService,
      "getMonitorStatusTimelineForStatusPage",
    ) as unknown as jest.SpyInstance
  ).mockResolvedValue([] as never);

  return { findOneBySpy, timelineSpy };
}

function timelineArgs(timelineSpy: jest.SpyInstance): TimelineHelperArgs {
  expect(timelineSpy).toHaveBeenCalledTimes(1);
  return timelineSpy.mock.calls[0]![0] as TimelineHelperArgs;
}

function dayDifference(startDate: Date, endDate: Date): number {
  const msPerDay: number = 24 * 60 * 60 * 1000;
  return (endDate.getTime() - startDate.getTime()) / msPerDay;
}

async function runWithConfiguredDays(data: {
  showUptimeHistoryInDays: number | undefined;
}): Promise<{
  result: ResourcesAndTimelinesResult;
  spies: Spies;
}> {
  const { statusPageId, statusPage } = makeStatusPage(
    data.showUptimeHistoryInDays,
  );
  const spies: Spies = mockEmptyStatusPage(statusPage);
  const api: StatusPageAPI = new StatusPageAPI();

  const result: ResourcesAndTimelinesResult =
    await api.getStatusPageResourcesAndTimelines({
      statusPageId: statusPageId,
    });

  return { result, spies };
}

async function expectComputedWindowOfDays(data: {
  showUptimeHistoryInDays: number | undefined;
  expectedDays: number;
}): Promise<void> {
  const { result, spies } = await runWithConfiguredDays({
    showUptimeHistoryInDays: data.showUptimeHistoryInDays,
  });

  const args: TimelineHelperArgs = timelineArgs(spies.timelineSpy);

  // endDate is "now" (generous tolerance for slow CI).
  expect(
    Math.abs(args.endDate.getTime() - OneUptimeDate.getCurrentDate().getTime()),
  ).toBeLessThan(10 * 1000);

  // The window spans exactly the clamped number of days.
  expect(dayDifference(args.startDate, args.endDate)).toBeCloseTo(
    data.expectedDays,
    2,
  );

  // The returned window is EXACTLY what the timeline query received.
  expect(result.startDateForMonitorTimeline).toBe(args.startDate);
  expect(result.endDateForMonitorTimeline).toBe(args.endDate);

  // Exactly one StatusPage row fetch — the deleted query must not return.
  expect(spies.findOneBySpy).toHaveBeenCalledTimes(1);
}

describe("StatusPageAPI.getStatusPageResourcesAndTimelines timeline window", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("explicit dates", () => {
    test("are forwarded verbatim to the timeline query and returned unchanged", async () => {
      const { statusPageId, statusPage } = makeStatusPage(45);
      const spies: Spies = mockEmptyStatusPage(statusPage);
      const getSomeDaysAgoSpy: jest.SpyInstance = jest.spyOn(
        OneUptimeDate,
        "getSomeDaysAgo",
      ) as unknown as jest.SpyInstance;
      const api: StatusPageAPI = new StatusPageAPI();

      const explicitStartDate: Date = new Date("2026-01-05T00:00:00.000Z");
      const explicitEndDate: Date = new Date("2026-01-19T00:00:00.000Z");

      const result: ResourcesAndTimelinesResult =
        await api.getStatusPageResourcesAndTimelines({
          statusPageId: statusPageId,
          startDateForMonitorTimeline: explicitStartDate,
          endDateForMonitorTimeline: explicitEndDate,
        });

      const args: TimelineHelperArgs = timelineArgs(spies.timelineSpy);
      // Same Date INSTANCES, not recomputed lookalikes.
      expect(args.startDate).toBe(explicitStartDate);
      expect(args.endDate).toBe(explicitEndDate);
      expect(result.startDateForMonitorTimeline).toBe(explicitStartDate);
      expect(result.endDateForMonitorTimeline).toBe(explicitEndDate);

      // No window computation happened (showUptimeHistoryInDays ignored).
      expect(getSomeDaysAgoSpy).not.toHaveBeenCalled();
      expect(spies.findOneBySpy).toHaveBeenCalledTimes(1);
    });

    test("supplying only ONE of the two dates recomputes BOTH from the page config", async () => {
      /*
       * The guard is `!startDate || !endDate` — a half-specified window is
       * treated as unspecified, so the caller-provided half is DISCARDED in
       * favor of the page-configured window.
       */
      const { statusPageId, statusPage } = makeStatusPage(45);
      const spies: Spies = mockEmptyStatusPage(statusPage);
      const api: StatusPageAPI = new StatusPageAPI();

      const explicitStartDate: Date = new Date("2026-01-05T00:00:00.000Z");

      const result: ResourcesAndTimelinesResult =
        await api.getStatusPageResourcesAndTimelines({
          statusPageId: statusPageId,
          startDateForMonitorTimeline: explicitStartDate,
        });

      const args: TimelineHelperArgs = timelineArgs(spies.timelineSpy);
      expect(args.startDate).not.toBe(explicitStartDate);
      expect(dayDifference(args.startDate, args.endDate)).toBeCloseTo(45, 2);
      expect(result.startDateForMonitorTimeline).toBe(args.startDate);
      expect(result.endDateForMonitorTimeline).toBe(args.endDate);
    });
  });

  describe("omitted dates: window computed from showUptimeHistoryInDays", () => {
    test("45 configured days -> 45-day window ending now", async () => {
      await expectComputedWindowOfDays({
        showUptimeHistoryInDays: 45,
        expectedDays: 45,
      });
    });

    test("200 configured days clamps DOWN to a 90-day window", async () => {
      await expectComputedWindowOfDays({
        showUptimeHistoryInDays: 200,
        expectedDays: 90,
      });
    });

    test("undefined (column never set) defaults to a 90-day window", async () => {
      await expectComputedWindowOfDays({
        showUptimeHistoryInDays: undefined,
        expectedDays: 90,
      });
    });

    test("0 hits the `|| 90` falsy default BEFORE the < 1 clamp -> 90 days, NOT 1", async () => {
      /*
       * ORDER matters and is pinned: `showUptimeHistoryInDays || 90` runs
       * first, so a falsy 0 becomes the 90-day default. Only truthy
       * sub-1 values (fractions, negatives) reach the < 1 clamp below it.
       */
      await expectComputedWindowOfDays({
        showUptimeHistoryInDays: 0,
        expectedDays: 90,
      });
    });

    test("0.5 (truthy but < 1) clamps UP to a 1-day window", async () => {
      await expectComputedWindowOfDays({
        showUptimeHistoryInDays: 0.5,
        expectedDays: 1,
      });
    });

    test("-5 (truthy, < 1) clamps UP to a 1-day window", async () => {
      await expectComputedWindowOfDays({
        showUptimeHistoryInDays: -5,
        expectedDays: 1,
      });
    });
  });
});
