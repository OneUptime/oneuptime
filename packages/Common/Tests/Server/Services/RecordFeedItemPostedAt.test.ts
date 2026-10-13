import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService - the base class
 * of every service below - imports it.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import AlertEpisodeFeedService from "../../../Server/Services/AlertEpisodeFeedService";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import ScheduledMaintenanceFeedService from "../../../Server/Services/ScheduledMaintenanceFeedService";
import { AlertEpisodeFeedEventType } from "../../../Models/DatabaseModels/AlertEpisodeFeed";
import { AlertFeedEventType } from "../../../Models/DatabaseModels/AlertFeed";
import { IncidentEpisodeFeedEventType } from "../../../Models/DatabaseModels/IncidentEpisodeFeed";
import { IncidentFeedEventType } from "../../../Models/DatabaseModels/IncidentFeed";
import { ScheduledMaintenanceFeedEventType } from "../../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import ObjectID from "../../../Types/ObjectID";

/*
 * A feed entry's time is when the thing happened. The timeline shows that
 * time on every entry and sorts and groups the day by it, so an entry written
 * for something that happened a moment earlier - a message pinned in Slack, a
 * state change made at a time of its own - keeps the time it is given; one
 * with no time of its own is now. The incident, alert and scheduled
 * maintenance feeds dropped a given time on the floor, unlike the episodes'.
 */

interface RecordFeed {
  name: string;
  service: { create: (...args: Array<never>) => unknown };
  write: (postedAt: Date | undefined) => Promise<void>;
}

const PROJECT_ID: ObjectID = ObjectID.generate();
const RECORD_ID: ObjectID = ObjectID.generate();

const FEEDS: Array<RecordFeed> = [
  {
    name: "incident",
    service: IncidentFeedService as unknown as RecordFeed["service"],
    write: (postedAt: Date | undefined): Promise<void> => {
      return IncidentFeedService.createIncidentFeedItem({
        incidentId: RECORD_ID,
        projectId: PROJECT_ID,
        incidentFeedEventType: IncidentFeedEventType.PrivateNote,
        feedInfoInMarkdown: "A note.",
        postedAt,
      });
    },
  },
  {
    name: "alert",
    service: AlertFeedService as unknown as RecordFeed["service"],
    write: (postedAt: Date | undefined): Promise<void> => {
      return AlertFeedService.createAlertFeedItem({
        alertId: RECORD_ID,
        projectId: PROJECT_ID,
        alertFeedEventType: AlertFeedEventType.PrivateNote,
        feedInfoInMarkdown: "A note.",
        postedAt,
      });
    },
  },
  {
    name: "scheduled maintenance event",
    service:
      ScheduledMaintenanceFeedService as unknown as RecordFeed["service"],
    write: (postedAt: Date | undefined): Promise<void> => {
      return ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem(
        {
          scheduledMaintenanceId: RECORD_ID,
          projectId: PROJECT_ID,
          scheduledMaintenanceFeedEventType:
            ScheduledMaintenanceFeedEventType.PrivateNote,
          feedInfoInMarkdown: "A note.",
          postedAt,
        },
      );
    },
  },
  {
    name: "incident episode",
    service: IncidentEpisodeFeedService as unknown as RecordFeed["service"],
    write: (postedAt: Date | undefined): Promise<void> => {
      return IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
        incidentEpisodeId: RECORD_ID,
        projectId: PROJECT_ID,
        incidentEpisodeFeedEventType: IncidentEpisodeFeedEventType.PrivateNote,
        feedInfoInMarkdown: "A note.",
        postedAt,
      });
    },
  },
  {
    name: "alert episode",
    service: AlertEpisodeFeedService as unknown as RecordFeed["service"],
    write: (postedAt: Date | undefined): Promise<void> => {
      return AlertEpisodeFeedService.createAlertEpisodeFeedItem({
        alertEpisodeId: RECORD_ID,
        projectId: PROJECT_ID,
        alertEpisodeFeedEventType: AlertEpisodeFeedEventType.PrivateNote,
        feedInfoInMarkdown: "A note.",
        postedAt,
      });
    },
  },
];

// What each write handed to create().
function captureCreates(feed: RecordFeed): Array<{ postedAt?: Date }> {
  const created: Array<{ postedAt?: Date }> = [];

  jest
    .spyOn(feed.service as { create: () => unknown }, "create")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockImplementation(((createBy: any): Promise<unknown> => {
      created.push(createBy.data as { postedAt?: Date });
      return Promise.resolve(createBy.data);
    }) as never);

  return created;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a record's feed entry is at the time it happened", () => {
  test.each(
    FEEDS.map((feed: RecordFeed): [string, RecordFeed] => {
      return [feed.name, feed];
    }),
  )(
    "%s: keeps the time it is given",
    async (_name: string, feed: RecordFeed) => {
      const created: Array<{ postedAt?: Date }> = captureCreates(feed);
      const postedAt: Date = new Date("2026-09-14T18:01:10.000Z");

      await feed.write(postedAt);

      expect(created).toHaveLength(1);
      expect(created[0]!.postedAt).toEqual(postedAt);
    },
  );

  test.each(
    FEEDS.map((feed: RecordFeed): [string, RecordFeed] => {
      return [feed.name, feed];
    }),
  )(
    "%s: is now when it is given no time",
    async (_name: string, feed: RecordFeed) => {
      const created: Array<{ postedAt?: Date }> = captureCreates(feed);
      const before: number = Date.now();

      await feed.write(undefined);

      const postedAt: Date | undefined = created[0]!.postedAt;

      expect(postedAt).toBeInstanceOf(Date);
      expect(postedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(postedAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    },
  );
});
