import fs from "fs";
import path from "path";

/*
 * WHAT THE NOTIFICATION JOBS POST TO SLACK AND MICROSOFT TEAMS.
 *
 * After a state change, a note or a new alert, the worker jobs tell the
 * record's owners and its status page subscribers, and write a feed entry
 * saying so: "Owners have been notified about the state change", "Status
 * Page Subscribers have been notified". Those entries used to be posted to
 * every Slack and Microsoft Teams channel of the record as well - right
 * under the state change or note they were about, which the channel had
 * just been told of. They are side effects of an event the channel already
 * read, so they stay in the feed (sendWorkspaceNotification: false).
 *
 * Still posted: a send to subscribers that fell short ("Not every ..." -
 * somebody may have to look at it), and the reminders that a record is
 * still open, which carry news of their own (how long it has been open).
 *
 * Each feed entry these jobs write is read from its source and held to that.
 */

const JOBS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/Jobs",
);

// A feed entry a job writes: its text, and whether it goes to chat.
interface FeedEntry {
  job: string;
  text: string;
  postsToWorkspace: boolean | null;
}

const FEED_CALL: RegExp =
  /\.create(?:Incident|Alert|ScheduledMaintenance|IncidentEpisode|AlertEpisode)FeedItem\(/g;
const SEND_WORKSPACE_NOTIFICATION: RegExp =
  /sendWorkspaceNotification:\s*(true|false)/;

// Every feed entry a job writes, from its source.
function feedEntriesOf(job: string): Array<FeedEntry> {
  const source: string = fs.readFileSync(path.join(JOBS_DIR, job), "utf8");
  const entries: Array<FeedEntry> = [];

  for (const match of source.matchAll(FEED_CALL)) {
    const start: number = match.index!;
    const end: number = source.indexOf("});", start);
    const call: string = source.slice(start, end === -1 ? undefined : end);
    const flag: RegExpExecArray | null = SEND_WORKSPACE_NOTIFICATION.exec(call);

    entries.push({
      job: job,
      text: call,
      postsToWorkspace: flag ? flag[1] === "true" : null,
    });
  }

  return entries;
}

// The one entry of a job whose text says `phrase`.
function entry(job: string, phrase: string): FeedEntry {
  const matches: Array<FeedEntry> = feedEntriesOf(job).filter(
    (candidate: FeedEntry): boolean => {
      return candidate.text.includes(phrase);
    },
  );

  expect(matches).toHaveLength(1);

  return matches[0]!;
}

describe("the notification jobs' feed entries in Slack and Microsoft Teams", () => {
  test.each([
    [
      "IncidentOwners/SendStateChangeNotification.ts",
      "Owners have been notified about the state change",
    ],
    [
      "AlertOwners/SendStateChangeNotification.ts",
      "Owners have been notified about the state change",
    ],
    [
      "ScheduledMaintenanceOwners/SendStateChangeNotification.ts",
      "Owners have been notified about the state change",
    ],
    ["AlertOwners/SendCreatedResourceNotification.ts", "alertFeedText"],
  ])(
    "REGRESSION: %s - that the owners were told stays in the feed",
    (job: string, phrase: string) => {
      expect(entry(job, phrase).postsToWorkspace).toBe(false);
    },
  );

  test.each([
    [
      "IncidentStateTimeline/SendNotificationToSubscribers.ts",
      "Status Page Subscribers have been notified",
    ],
    [
      "ScheduledMaintenanceStateTimeline/SendNotificationToSubscribers.ts",
      "Status Page Subscribers have been notified",
    ],
    [
      "IncidentPublicNote/SendNotificationToSubscribers.ts",
      "Notification sent to subscribers",
    ],
    [
      "ScheduledMaintenancePublicNote/SendNotificationToSubscribers.ts",
      "Notification sent to subscribers",
    ],
    // "Reminder Notification Sent to Subscribers", built above the call.
    [
      "ScheduledMaintenance/SendSubscriberRemindersOnEventScheduled.ts",
      "ScheduledMaintenanceFeedEventType.SubscriberNotificationSent",
    ],
  ])(
    "REGRESSION: %s - every subscriber reached stays in the feed",
    (job: string, phrase: string) => {
      expect(entry(job, phrase).postsToWorkspace).toBe(false);
    },
  );

  test.each([
    [
      "IncidentStateTimeline/SendNotificationToSubscribers.ts",
      "Not every Status Page Subscriber was notified",
    ],
    [
      "IncidentPublicNote/SendNotificationToSubscribers.ts",
      "Not every subscriber was sent the notification",
    ],
  ])(
    "%s - a send that fell short is still posted: somebody may have to look",
    (job: string, phrase: string) => {
      expect(entry(job, phrase).postsToWorkspace).toBe(true);
    },
  );

  test.each([
    ["IncidentOwners/SendUnresolvedReminderNotification.ts", "Reminder sent"],
    ["AlertOwners/SendUnresolvedReminderNotification.ts", "Reminder sent"],
    [
      "ScheduledMaintenanceOwners/SendUnresolvedReminderNotification.ts",
      "Reminder sent",
    ],
  ])(
    "%s - a reminder that the record is still open is still posted",
    (job: string, phrase: string) => {
      expect(entry(job, phrase).postsToWorkspace).toBe(true);
    },
  );

  test("no owner-notified entry anywhere in the jobs is posted to chat", () => {
    const ownerJobs: Array<string> = [
      "IncidentOwners",
      "AlertOwners",
      "ScheduledMaintenanceOwners",
      "EpisodeOwners",
      "MonitorOwners",
    ];

    const posted: Array<string> = [];

    for (const folder of ownerJobs) {
      const dir: string = path.join(JOBS_DIR, folder);

      if (!fs.existsSync(dir)) {
        continue;
      }

      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith(".ts") || file.includes("Reminder")) {
          continue;
        }

        for (const feedEntry of feedEntriesOf(path.join(folder, file))) {
          if (feedEntry.postsToWorkspace === true) {
            posted.push(feedEntry.job);
          }
        }
      }
    }

    expect(posted).toEqual([]);
  });
});
