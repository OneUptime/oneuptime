import MonitorFeed, {
  MonitorFeedEventType,
} from "../../../Models/DatabaseModels/MonitorFeed";
import MonitorFeedService from "../../../Server/Services/MonitorFeedService";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * WHEN A MONITOR'S FEED ENTRY IS FILED (#11188).
 *
 * "Monitor Created" is written once the monitor's owners and labels are in,
 * after the "Added team Platform to the Monitor as the owner" entries, and
 * is filed at the moment the monitor's create began so it stays the first
 * line of the feed. createMonitorFeedItem took a time to file an entry at
 * and dropped it: the row was written with no time at all.
 */

const MONITOR_ID: ObjectID = new ObjectID(
  "11188000-0000-4000-8000-000000000001",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "11188000-0000-4000-8000-000000000002",
);

// The rows the feed service writes.
function written(): Array<MonitorFeed> {
  const rows: Array<MonitorFeed> = [];

  jest.spyOn(MonitorFeedService, "create").mockImplementation((async (data: {
    data: MonitorFeed;
  }): Promise<MonitorFeed> => {
    rows.push(data.data);
    return data.data;
  }) as never);

  return rows;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a monitor's feed entry", () => {
  test("REGRESSION: is filed at the time asked for", async () => {
    const rows: Array<MonitorFeed> = written();
    const startedAt: Date = new Date("2026-11-26T09:00:00.000Z");

    await MonitorFeedService.createMonitorFeedItem({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      monitorFeedEventType: MonitorFeedEventType.MonitorCreated,
      feedInfoInMarkdown: "#### Monitor Created",
      postedAt: startedAt,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.postedAt).toEqual(startedAt);
  });

  test("is filed now when no time is asked for", async () => {
    const rows: Array<MonitorFeed> = written();
    const now: Date = new Date("2026-11-26T09:00:05.000Z");
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(now);

    await MonitorFeedService.createMonitorFeedItem({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      monitorFeedEventType: MonitorFeedEventType.MonitorStatusChanged,
      feedInfoInMarkdown: "Changed Monitor State to Offline",
    });

    expect(rows[0]!.postedAt).toEqual(now);
  });
});
