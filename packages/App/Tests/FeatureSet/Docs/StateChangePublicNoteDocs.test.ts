import StateChangeSubscriberNotification from "Common/Types/StatusPage/StateChangeSubscriberNotification";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A state change posted with a public note tells status page subscribers
 * once: the note is the message, and the change is recorded as sent by it
 * (StateChangeSubscriberNotification). The guides say so for both events -
 * Subscribers & Announcements for scheduled maintenance, Incident States &
 * Severities for incidents - in English and in Persian, the one translated
 * corpus that has these sections. Markdown is not compiled, so this reads
 * the code the guides quote (the dialog's labels, the status badge's words,
 * the API route and the misc data key) and checks the guides still say it.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

const SUBSCRIBERS_PAGE: string = "status-pages/subscribers.md";
const STATES_PAGE: string = "incidents/states-and-severities.md";

const LANGUAGES: Array<string> = ["en", "fa"];

// The section each guide tells it in, by its heading in each language.
const SCHEDULED_MAINTENANCE_SECTION: Record<string, string> = {
  en: "### Scheduled maintenance events",
  fa: "### رویدادهای نگهداری زمان‌بندی‌شده",
};

const INCIDENT_SECTION: Record<string, string> = {
  en: "## Telling status page subscribers about a state change",
  fa: "## گفتن تغییر وضعیت به مشترکان صفحه وضعیت",
};

const NOTE_KEY_IN_THE_API: string = `"miscDataProps": {"${StateChangeSubscriberNotification.publicNoteKey}": "..."}`;

function readRepoFile(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

function readGuide(language: string, page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, page), "utf8");
}

// A section, from its heading to the next heading of the same level or above.
function sectionOf(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.indexOf(heading);

  expect(`${heading}: ${start >= 0}`).toBe(`${heading}: true`);

  const level: number = heading.indexOf(" ");
  const section: Array<string> = [];

  for (const line of lines.slice(start + 1)) {
    const match: RegExpMatchArray | null = line.match(/^(#{1,6}) /);

    if (match && match[1]!.length <= level) {
      break;
    }

    section.push(line);
  }

  return section.join("\n");
}

describe("the code the guides quote", () => {
  test("the state change dialog has the note and the box the guides name", () => {
    const fields: string = readRepoFile(
      "App/FeatureSet/Dashboard/src/Components/EventView/StateChangeFormFields.ts",
    );

    expect(fields).toContain('translationKey("Add a public note")');
    expect(fields).toContain('translationKey("Public Note")');
    expect(fields).toContain('"shouldStatusPageSubscribersBeNotified"');
  });

  test("a change sent by its note reads as sent", () => {
    const badge: string = readRepoFile(
      "App/FeatureSet/Dashboard/src/Components/StatusPageSubscribers/SubscriberNotificationStatus.tsx",
    );

    expect(badge).toMatch(
      /status === StatusPageSubscriberNotificationStatus\.Success\) \{\s*return \{[^}]*text: "Notifications Sent"/,
    );
  });

  test("the API route the guides give is the scheduled maintenance state timeline's", () => {
    expect(
      readRepoFile(
        "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline.ts",
      ),
    ).toContain(
      '@CrudApiEndpoint(new Route("/scheduled-maintenance-state-timeline"))',
    );
  });

  test("the note travels under the key the dashboard sends", () => {
    expect(
      readRepoFile("App/FeatureSet/Dashboard/src/Utils/BulkStateChange.ts"),
    ).toContain(`? "${StateChangeSubscriberNotification.publicNoteKey}"`);
  });
});

describe.each(LANGUAGES)("the %s guides", (language: string) => {
  test("scheduled maintenance: the note sent with a state change is the one message", () => {
    const section: string = sectionOf(
      readGuide(language, SUBSCRIBERS_PAGE),
      SCHEDULED_MAINTENANCE_SECTION[language]!,
    );

    expect(section).toContain("**Public Note**");
    expect(section).toContain("**Notify Status Page Subscribers**");
    expect(section).toContain("**Change State**");
    expect(section).toContain(NOTE_KEY_IN_THE_API);
    expect(section).toContain(
      "`POST /api/scheduled-maintenance-state-timeline`",
    );
    expect(section).toContain("`shouldStatusPageSubscribersBeNotified`");
  });

  test("incidents: the note sent with a state change is the one message too", () => {
    const section: string = sectionOf(
      readGuide(language, STATES_PAGE),
      INCIDENT_SECTION[language]!,
    );

    expect(section).toContain("**Public Note**");
    expect(section).toContain("**Notify Status Page Subscribers**");
    expect(section).toContain("**Change State**");
  });
});

describe("what the English guides promise", () => {
  const scheduledMaintenance: string = sectionOf(
    readGuide("en", SUBSCRIBERS_PAGE),
    SCHEDULED_MAINTENANCE_SECTION["en"]!,
  );
  const incidents: string = sectionOf(
    readGuide("en", STATES_PAGE),
    INCIDENT_SECTION["en"]!,
  );

  test("one message, not two, on every channel", () => {
    expect(scheduledMaintenance).toContain(
      "subscribers get the note, on every channel, instead of a separate state change message: one message, not two.",
    );
    expect(incidents).toContain(
      "The note itself is what reaches subscribers, so they get one message instead of two.",
    );
  });

  test("the state change reads as sent, and says the note carried it", () => {
    expect(scheduledMaintenance).toContain(
      "The state change shows **Notifications Sent**, and its status message says the note carried it.",
    );
    expect(incidents).toContain("its status message says the note carried it");
  });

  test("a note with no text in it is not posted, and the state change tells subscribers itself", () => {
    expect(scheduledMaintenance).toContain(
      "A note with nothing but spaces in it is not posted, and subscribers get the state change message.",
    );
    expect(incidents).toContain(
      "A note with nothing but spaces in it is not posted, and the row is queued as usual.",
    );
  });

  test("with the box off, nobody is told", () => {
    expect(scheduledMaintenance).toContain(
      "With the box off, neither the state change nor its note tells anyone.",
    );
  });

  test("each guide points at the other event, which works the same way", () => {
    expect(scheduledMaintenance).toContain(
      "Incidents work the same way; see [Incident States & Severities](/docs/incidents/states-and-severities#telling-status-page-subscribers-about-a-state-change).",
    );
    expect(incidents).toContain(
      "Scheduled maintenance state changes work the same way.",
    );
  });

  test("no guide still says the change is told by the note whether or not the box is on", () => {
    expect(incidents).not.toContain(
      "If you write a **Public Note** in the state-change modal (under **Add a public note**), the timeline row is marked as already notified rather than queued.",
    );
  });
});
