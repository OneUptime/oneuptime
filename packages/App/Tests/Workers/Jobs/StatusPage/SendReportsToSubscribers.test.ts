import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import OneUptimeDate from "Common/Types/Date";
import EventInterval from "Common/Types/Events/EventInterval";
import Recurring from "Common/Types/Events/Recurring";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import Timezone from "Common/Types/Timezone";
import StatusPageReportScheduleUtil, {
  StatusPageReportScheduleWrite,
} from "Common/Utils/StatusPage/ReportSchedule";

/*
 * The worker that emails status page reports reads the schedule each page
 * holds and nothing else. Pages whose reports are switched on without a
 * schedule now get a default one from the server (every month, on the 1st
 * at 09:00 in the report timezone - StatusPageReportScheduleUtil); these
 * tests pin that the worker sends on such a schedule exactly as it does on
 * one typed in: when its time comes, it moves the next send on by one
 * interval, on the calendar and in the report's timezone, and sends.
 *
 * The job registers itself through RunCron when imported and exports
 * nothing, so the Cron util is mocked to capture the handler, as the other
 * App/Tests/Workers/Jobs suites do, and each test drives one tick.
 */

type CronHandler = () => Promise<void>;

const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, _options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/StatusPageService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      updateOneById: jest.fn(),
      sendEmailReport: jest.fn(),
    },
  };
});

import StatusPageService from "Common/Server/Services/StatusPageService";
import "../../../../FeatureSet/Workers/Jobs/StatusPage/SendReportsToSubscribers";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

const JOB_NAME: string = "StatusPage:SendReportToSubscribers";

const STATUS_PAGE_ID: string = "2d000000-0000-4000-8000-000000000001";

type MockedService = {
  findAllBy: jest.Mock;
  updateOneById: jest.Mock;
  sendEmailReport: jest.Mock;
};

const service: MockedService = StatusPageService as unknown as MockedService;

let now: Date = OneUptimeDate.fromString("2026-10-04T12:00:00.000Z");

function every(intervalType: EventInterval, intervalCount: number): Recurring {
  const recurring: Recurring = new Recurring();
  recurring.intervalType = intervalType;
  recurring.intervalCount = new PositiveNumber(intervalCount);
  return recurring;
}

// A page as the worker selects it.
function page(data: {
  sendNextReportBy: Date;
  reportRecurringInterval: Recurring;
  reportTimezone: Timezone;
}): StatusPage {
  const statusPage: StatusPage = new StatusPage();
  statusPage._id = STATUS_PAGE_ID;
  statusPage.sendNextReportBy = data.sendNextReportBy;
  statusPage.reportRecurringInterval = data.reportRecurringInterval;
  statusPage.reportTimezone = data.reportTimezone;
  return statusPage;
}

// One tick, at `at`, for the pages the query finds.
async function tick(at: string, pages: Array<StatusPage>): Promise<void> {
  now = OneUptimeDate.fromString(at);
  service.findAllBy.mockResolvedValueOnce(pages as never);
  await mockCapturedJobs[JOB_NAME]!();
}

// The next send the tick wrote, as an ISO string.
function writtenNextSend(): string | undefined {
  const call: Array<unknown> | undefined = service.updateOneById.mock
    .calls[0] as Array<unknown> | undefined;

  return (
    call?.[0] as { data: { sendNextReportBy?: Date } } | undefined
  )?.data.sendNextReportBy?.toISOString();
}

beforeEach(() => {
  service.findAllBy.mockReset();
  service.updateOneById.mockReset();
  service.updateOneById.mockResolvedValue(1 as never);
  service.sendEmailReport.mockReset();
  service.sendEmailReport.mockResolvedValue(undefined as never);

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
    return new Date(now.getTime());
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("StatusPage:SendReportToSubscribers", () => {
  test("is registered", () => {
    expect(mockCapturedJobs[JOB_NAME]).toBeDefined();
  });

  test("asks only for pages with reports on, not archived, whose report is due", async () => {
    await tick("2026-11-01T09:00:30.000Z", []);

    const query: Record<string, unknown> = (
      service.findAllBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    expect(query["isReportEnabled"]).toBe(true);
    expect(query["isArchived"]).toBe(false);
    expect(query["sendNextReportBy"]).toBeDefined();
    expect(service.sendEmailReport).not.toHaveBeenCalled();
  });

  test("sends on the default schedule, and moves its next send to the 1st of the following month at 09:00", async () => {
    // What the server stores for a page whose reports were switched on on 4 Oct.
    const defaults: StatusPageReportScheduleWrite =
      StatusPageReportScheduleUtil.getScheduleWrite({
        write: { isReportEnabled: true },
        stored: { reportTimezone: Timezone.UTC },
        now: OneUptimeDate.fromString("2026-10-04T12:00:00.000Z"),
      });

    expect(defaults.sendNextReportBy?.toISOString()).toBe(
      "2026-11-01T09:00:00.000Z",
    );

    await tick("2026-11-01T09:00:30.000Z", [
      page({
        sendNextReportBy: defaults.sendNextReportBy!,
        reportRecurringInterval: defaults.reportRecurringInterval!,
        reportTimezone: Timezone.UTC,
      }),
    ]);

    expect(writtenNextSend()).toBe("2026-12-01T09:00:00.000Z");
    expect(service.sendEmailReport).toHaveBeenCalledTimes(1);
    expect(
      (
        service.sendEmailReport.mock.calls[0]![0] as {
          statusPageId: ObjectID;
        }
      ).statusPageId.toString(),
    ).toBe(STATUS_PAGE_ID);
  });

  test("keeps 09:00 in the report's timezone from one month to the next", async () => {
    const defaults: StatusPageReportScheduleWrite =
      StatusPageReportScheduleUtil.getScheduleWrite({
        write: { isReportEnabled: true },
        stored: { reportTimezone: Timezone.AmericaNew_York },
        now: OneUptimeDate.fromString("2027-02-10T12:00:00.000Z"),
      });

    // 1 Mar 2027, 09:00 EST.
    expect(defaults.sendNextReportBy?.toISOString()).toBe(
      "2027-03-01T14:00:00.000Z",
    );

    await tick("2027-03-01T14:00:30.000Z", [
      page({
        sendNextReportBy: defaults.sendNextReportBy!,
        reportRecurringInterval: defaults.reportRecurringInterval!,
        reportTimezone: Timezone.AmericaNew_York,
      }),
    ]);

    // 1 Apr 2027, 09:00 EDT: daylight saving started on 14 Mar.
    expect(writtenNextSend()).toBe("2027-04-01T13:00:00.000Z");
    expect(service.sendEmailReport).toHaveBeenCalledTimes(1);
  });

  test("sends on a schedule typed in the same way", async () => {
    await tick("2026-10-12T08:00:30.000Z", [
      page({
        sendNextReportBy: OneUptimeDate.fromString("2026-10-12T08:00:00.000Z"),
        reportRecurringInterval: every(EventInterval.Week, 2),
        reportTimezone: Timezone.UTC,
      }),
    ]);

    expect(writtenNextSend()).toBe("2026-10-26T08:00:00.000Z");
    expect(service.sendEmailReport).toHaveBeenCalledTimes(1);
  });

  test("moves the next send on before sending, so a failed send is not retried every minute", async () => {
    service.sendEmailReport.mockRejectedValueOnce(new Error("SMTP down") as never);

    await tick("2026-11-01T09:00:30.000Z", [
      page({
        sendNextReportBy: OneUptimeDate.fromString("2026-11-01T09:00:00.000Z"),
        reportRecurringInterval: every(EventInterval.Month, 1),
        reportTimezone: Timezone.UTC,
      }),
    ]);

    expect(writtenNextSend()).toBe("2026-12-01T09:00:00.000Z");
    expect(
      service.updateOneById.mock.invocationCallOrder[0]!,
    ).toBeLessThan(service.sendEmailReport.mock.invocationCallOrder[0]!);
  });
});
