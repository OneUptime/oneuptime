import slugify from "Common/Server/Types/MarkdownSlugify";
import EventFieldChange from "Common/Server/Utils/EventFieldChange";
import ScheduledMaintenanceFieldChange from "Common/Server/Utils/ScheduledMaintenance/ScheduledMaintenanceFieldChange";
import EventInterval from "Common/Types/Events/EventInterval";
import Recurring from "Common/Types/Events/Recurring";
import PositiveNumber from "Common/Types/PositiveNumber";
import ScheduledMaintenanceStartUtil from "Common/Utils/ScheduledMaintenanceStart";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A scheduled maintenance event's and a monitor's "updated" feed entry
 * records what an edit really changed, and an event's reminder interval
 * starts over only when its labels change or Send reminders is flipped
 * (ScheduledMaintenanceFieldChange, EventFieldChange). An event moved from
 * Scheduled straight into a state of the project's own after Ongoing starts
 * the way Ongoing does (ScheduledMaintenanceStartUtil.isInProgress). The
 * docs say so where a reader looks - the scheduled maintenance section of
 * the subscribers page and the 14 upgrade notes - and the upgrade note's
 * link lands on the section it names. Markdown is not compiled, so these
 * tests are what notices when the pages and the server part ways.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content/en",
);

function read(page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, `${page}.md`), "utf8");
}

// The text of the section under `heading`, up to the next heading of its level or above.
function section(markdown: string, heading: string): string {
  const start: number = markdown.indexOf(heading);

  expect(start).toBeGreaterThanOrEqual(0);

  const rest: string = markdown.slice(start + heading.length);
  const end: number = rest.search(/\n#{2,3} /);

  return (end === -1 ? rest : rest.slice(0, end)).replace(/\s+/g, " ");
}

const SUBSCRIBERS_PAGE: string = "status-pages/subscribers";
const MAINTENANCE_HEADING: string = "### Scheduled maintenance events";

function reminder(count: number, interval: EventInterval): Recurring {
  const recurring: Recurring = new Recurring();
  recurring.intervalCount = new PositiveNumber(count);
  recurring.intervalType = interval;
  return recurring;
}

describe("what an event's feed records for an edit", () => {
  const text: string = section(read(SUBSCRIBERS_PAGE), MAINTENANCE_HEADING);

  test("names every line an edit can add, and says a value saved as it was gets none", () => {
    expect(text).toContain(
      "**What the feed records for an edit.** An edit adds a **Scheduled Maintenance was updated.** entry to the event's **Scheduled Maintenance Feed**",
    );
    expect(text).toContain(
      "with a line for each thing it changed: the title, **Starts At**, **Ends At**, the description, the reminders before the event, what the event affects, **Change Monitor Status to**, the status pages it is shown on and its labels, each with its new value.",
    );
    expect(text).toContain(
      "A value saved as it was gets no line, so saving the **Maintenance Details** card with nothing changed",
    );
    expect(text).toContain(
      "or an API client, a workflow or Terraform writing the event back as it is, adds no entry at all.",
    );
  });

  test("says how times and lists are compared, as the server compares them", () => {
    expect(text).toContain(
      "A time is the same when it names the same moment, however it is written, and the reminders, the status pages, the affected resources and the labels are the same set in any order.",
    );

    // The same moment, written in another time zone.
    expect(
      EventFieldChange.isInstantChanged({
        writtenValue: "2026-10-11T00:00:00+02:00",
        valueBeforeUpdate: new Date(Date.UTC(2026, 9, 10, 22, 0, 0)),
      }),
    ).toBe(false);

    // The same reminders, in another order and one twice.
    expect(
      ScheduledMaintenanceFieldChange.isReminderListChanged({
        writtenList: [
          reminder(2, EventInterval.Hour),
          reminder(1, EventInterval.Day),
          reminder(2, EventInterval.Hour),
        ],
        remindersBeforeUpdate:
          ScheduledMaintenanceFieldChange.normalizeReminderList([
            reminder(1, EventInterval.Day),
            reminder(2, EventInterval.Hour),
          ]),
      }),
    ).toBe(false);
  });

  test("the lines it quotes for a cleared list are the ones the server writes", () => {
    expect(text).toContain(
      `Taking every reminder, status page or label off is recorded as "${ScheduledMaintenanceFieldChange.noRemindersLine}", "${ScheduledMaintenanceFieldChange.noStatusPagesLine}" or "${EventFieldChange.noLabelsLine}".`,
    );
  });

  test("says when the reminder rule is matched again", () => {
    expect(text).toContain(
      "The event's reminder rule is matched again, and the wait for its next reminder starts over, only when its labels change or its **Send reminders** switch is flipped.",
    );
  });

  test("says a monitor's feed works the same way", () => {
    expect(text).toContain(
      "A monitor's feed records an edit of its name, description and labels the same way.",
    );
  });
});

describe("when an event starts", () => {
  const text: string = section(read(SUBSCRIBERS_PAGE), MAINTENANCE_HEADING);

  test("a move straight into a state of the project's own after Ongoing is a start", () => {
    expect(text).toContain(
      'Moving it from **Scheduled** straight into a state of your own placed after **Ongoing**, such as "Verifying", starts it the same way: its monitors change to its status, as they would in **Ongoing**, and go back to operational when it ends.',
    );

    // A state of the project's own between Ongoing and Ended is in progress.
    expect(
      ScheduledMaintenanceStartUtil.isInProgress({
        states: [
          { _id: "a1", order: 1, isScheduledState: true },
          { _id: "a2", order: 2, isOngoingState: true },
          { _id: "a3", order: 3 },
          { _id: "a4", order: 4, isEndedState: true },
          { _id: "a5", order: 5, isResolvedState: true },
        ],
        state: { _id: "a3" },
      }),
    ).toBe(true);
  });
});

describe("the 14 upgrade notes", () => {
  const text: string = section(
    read("installation/upgrading"),
    "### Other changes in 14",
  );

  test("say what changes for existing projects", () => {
    expect(text).toContain(
      "**A scheduled maintenance event's or a monitor's \"updated\" feed entry records only what changed, too.**",
    );
    expect(text).toContain(
      "Now each line is written for a value that changed, and nothing for a save that changed nothing; an event's reminder rule is matched again only when its labels change or **Send reminders** is flipped.",
    );
    expect(text).toContain(
      "a monitor's name, description and label names show as typed instead of being read as Markdown.",
    );
    expect(text).toContain(
      "An event moved from **Scheduled** straight into a state of your own placed after **Ongoing** now starts the way **Ongoing** does",
    );
  });

  test("link to the section that says what the event's feed records", () => {
    expect(text).toContain(
      `(/docs/status-pages/subscribers#${slugify(MAINTENANCE_HEADING.replace(/^#+\s*/, ""))})`,
    );
  });
});
