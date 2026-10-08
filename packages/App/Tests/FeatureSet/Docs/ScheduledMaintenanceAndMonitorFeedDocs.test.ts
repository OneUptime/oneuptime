import slugify from "Common/Server/Types/MarkdownSlugify";
import EventFieldChange from "Common/Server/Utils/EventFieldChange";
import ScheduledMaintenanceFieldChange from "Common/Server/Utils/ScheduledMaintenance/ScheduledMaintenanceFieldChange";
import EventInterval from "Common/Types/Events/EventInterval";
import Recurring from "Common/Types/Events/Recurring";
import PositiveNumber from "Common/Types/PositiveNumber";
import ScheduledMaintenanceStartUtil, {
  ScheduledMaintenancePhaseOfState,
} from "Common/Utils/ScheduledMaintenanceStart";
import PublicNoteSubscriberNotificationDefault from "Common/Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A scheduled maintenance event's and a monitor's "updated" feed entry
 * records what an edit really changed, and an event's reminder interval
 * starts over only when its labels change or Send reminders is flipped
 * (ScheduledMaintenanceFieldChange, EventFieldChange). An event is in
 * progress in Ongoing and in a state of the project's own between Ongoing
 * and Ended; one after Ended is over (ScheduledMaintenanceStartUtil). The
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
      "A time is the same when it names the same moment, however it is written - one written without a time zone is UTC, as it is stored - and the reminders, the status pages, the affected resources and the labels are the same set in any order.",
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
      `Taking every reminder, status page or label off is recorded as "${ScheduledMaintenanceFieldChange.noRemindersLine}", "${ScheduledMaintenanceFieldChange.noStatusPagesLine}" or "${EventFieldChange.noLabelsLine}", and taking off the last affected resource besides the monitors - the last host, cluster or service, say - as "${ScheduledMaintenanceFieldChange.noOtherResourcesLine}".`,
    );
  });

  test("a time written without a zone is UTC, as the server compares it", () => {
    expect(text).toContain(
      "A time is the same when it names the same moment, however it is written - one written without a time zone is UTC, as it is stored -",
    );

    expect(
      EventFieldChange.isInstantChanged({
        writtenValue: "2026-10-11T00:00:00",
        valueBeforeUpdate: new Date(Date.UTC(2026, 9, 11, 0, 0, 0)),
      }),
    ).toBe(false);
  });

  test("says a reminder counted from the start moves with the start", () => {
    expect(text).toContain(
      "A reminder rule (**Scheduled Maintenance → Rules → Reminder Rules**) with **Remind While Event is Scheduled** off counts the first reminder from the event's start, so moving **Starts At** to another time moves that reminder with it while the start is still ahead; the reminders of a rule that reminds while the event is scheduled stay where they are.",
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

// A state as the rule reads it: its id, its place and its built-in flag.
interface PlacedStateRow {
  _id: string;
  order: number;
  isScheduledState?: boolean;
  isOngoingState?: boolean;
  isEndedState?: boolean;
  isResolvedState?: boolean;
}

// A project's states: the four built-in ones and three of its own.
const PLACED_STATES: Array<PlacedStateRow> = [
  { _id: "a1", order: 1, isScheduledState: true },
  { _id: "a2", order: 2 }, // "Preparing": before Ongoing
  { _id: "a3", order: 3, isOngoingState: true },
  { _id: "a4", order: 4 }, // "Verifying": between Ongoing and Ended
  { _id: "a5", order: 5, isEndedState: true },
  { _id: "a6", order: 6 }, // "Reviewing": after Ended
  { _id: "a7", order: 7, isResolvedState: true },
];

function phaseOf(id: string): ScheduledMaintenancePhaseOfState | null {
  return ScheduledMaintenanceStartUtil.getPhase({
    states: PLACED_STATES,
    state: { _id: id },
  });
}

describe("when an event starts", () => {
  const text: string = section(read(SUBSCRIBERS_PAGE), MAINTENANCE_HEADING);

  test("a move straight into a state of the project's own between Ongoing and Ended is a start", () => {
    expect(text).toContain(
      'Moving it from **Scheduled** straight into a state of your own placed between **Ongoing** and **Ended**, such as "Verifying", starts it the same way: its monitors change to its status, as they would in **Ongoing**, and go back to operational when it ends.',
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

describe("states of your own", () => {
  const text: string = section(read(SUBSCRIBERS_PAGE), MAINTENANCE_HEADING);

  test("say where an event is in progress, not started and over, as the rule places them", () => {
    expect(text).toContain(
      '**States of your own.** An event is in progress in **Ongoing** and in every state of your own placed between **Ongoing** and **Ended** - a "Verifying" step, say. A state of your own placed before **Ongoing** has not started yet, and one placed after **Ended** - "Reviewing" - is over.',
    );

    expect(phaseOf("a3")).toBe(ScheduledMaintenancePhaseOfState.InProgress);
    expect(phaseOf("a4")).toBe(ScheduledMaintenancePhaseOfState.InProgress);
    expect(phaseOf("a2")).toBe(ScheduledMaintenancePhaseOfState.NotStarted);
    expect(phaseOf("a6")).toBe(ScheduledMaintenancePhaseOfState.Over);
  });

  test("name every place that reads the rule", () => {
    expect(text).toContain(
      "Such an event is listed as ongoing on its status pages - on the overview, on the event's own page and in the RSS and Atom feeds - and in the **Ongoing** lists under **Scheduled Maintenance** and **Home**, their menu badges and the **Ongoing maintenance** tile on **Home**, and the Microsoft Teams app lists it as ongoing maintenance.",
    );
    expect(text).toContain(
      "Its monitors stay in maintenance, the network sites and telemetry series it covers stay silenced, and SLO burn-rate alerts on its monitors are held back. At its **Ends At** it is ended the way an ongoing event is, and its subscribers are told if **When the event ends** is on.",
    );
  });

  test("say a move into a state after Ended is the event's end, and moving on is no second edge", () => {
    expect(text).toContain(
      'Moving it from **Ongoing** or "Verifying" straight into a state of your own placed after **Ended** ends it the way **Ended** does: its monitors go back to operational, and the event\'s header shows how long it took. Moving it on from **Ongoing** to "Verifying", or from **Ended** to "Reviewing", starts or ends nothing again.',
    );

    const timeline: Array<{ stateId: string; startsAt: Date }> = [
      { stateId: "a1", startsAt: new Date("2026-10-08T08:00:00Z") },
      { stateId: "a3", startsAt: new Date("2026-10-08T09:00:00Z") },
      { stateId: "a4", startsAt: new Date("2026-10-08T09:30:00Z") },
      { stateId: "a6", startsAt: new Date("2026-10-08T10:00:00Z") },
      { stateId: "a7", startsAt: new Date("2026-10-08T11:00:00Z") },
    ];

    expect(
      ScheduledMaintenanceStartUtil.getStartRows({
        states: PLACED_STATES,
        timeline: timeline,
      }).map((row: { stateId: string }): string => {
        return row.stateId;
      }),
    ).toEqual(["a3"]);
    expect(
      ScheduledMaintenanceStartUtil.getEndRows({
        states: PLACED_STATES,
        timeline: timeline,
      }).map((row: { stateId: string }): string => {
        return row.stateId;
      }),
    ).toEqual(["a6"]);
  });

  test("the notify default it describes is the one the state change form starts from", () => {
    expect(text).toContain(
      "- You move the event into its ongoing state, or from a state where it has not started into a state of your own placed between **Ongoing** and **Ended** (it starts), and **When the event starts** is on.",
    );
    expect(text).toContain(
      "- You move the event into an ended or completed state, or from a state where it is in progress into a state of your own placed after **Ended** (it ends), and **When the event ends** is on.",
    );

    const quietEventAnnouncingBoth: {
      shouldStatusPageSubscribersBeNotifiedOnEventCreated: boolean;
      shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing: boolean;
      shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: boolean;
    } = {
      shouldStatusPageSubscribersBeNotifiedOnEventCreated: false,
      shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing: true,
      shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: true,
    };

    const notifies: (from: string, to: string) => boolean = (
      from: string,
      to: string,
    ): boolean => {
      return PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenanceStateChange(
        quietEventAnnouncingBoth,
        PLACED_STATES.find((state: PlacedStateRow): boolean => {
          return state._id === to;
        }),
        {
          states: PLACED_STATES,
          currentState: PLACED_STATES.find((state: PlacedStateRow): boolean => {
            return state._id === from;
          }),
        },
      );
    };

    // Scheduled -> Verifying starts it; Verifying -> Reviewing ends it.
    expect(notifies("a1", "a4")).toBe(true);
    expect(notifies("a4", "a6")).toBe(true);
    // Ongoing -> Verifying and Ended -> Reviewing are no edge.
    expect(notifies("a3", "a4")).toBe(false);
    expect(notifies("a5", "a6")).toBe(false);
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
      "An event moved from **Scheduled** straight into a state of your own placed between **Ongoing** and **Ended** now starts the way **Ongoing** does",
    );
  });

  test("say what changes for events in a state of your own after Ongoing", () => {
    expect(text).toContain(
      "**A maintenance event in a state of your own after Ongoing counts as in progress everywhere.**",
    );
    expect(text).toContain(
      "Every one of them now asks one rule: an event is in progress in the ongoing state and in every state of your own placed between **Ongoing** and **Ended**.",
    );
    // What an existing project sees on the day it upgrades.
    expect(text).toContain(
      'so an event left in "Verifying" past its end is ended within a minute of the upgrade.',
    );
    expect(text).toContain(
      'A state of your own placed after **Ended** - "Reviewing" - is over: moving an event into it from **Ongoing** or "Verifying" now ends it the way **Ended** does, where until now its monitors stayed in maintenance for good',
    );
    expect(text).toContain(
      "Projects whose own states all sit before **Ongoing** see no change.",
    );
    expect(text).toContain(
      `is recorded in its feed as "${ScheduledMaintenanceFieldChange.noOtherResourcesLine}"`,
    );
  });

  test("say a secret written back as it is changes nothing", () => {
    expect(text).toContain(
      "**Saving a secret back as it is changes nothing.**",
    );
    expect(text).toContain(
      "A value written back as it is now counts as unchanged; a new value still does all three, and is still stored encrypted.",
    );
  });

  test("link to the section that says what the event's feed records", () => {
    expect(text).toContain(
      `(/docs/status-pages/subscribers#${slugify(MAINTENANCE_HEADING.replace(/^#+\s*/, ""))})`,
    );
  });
});
