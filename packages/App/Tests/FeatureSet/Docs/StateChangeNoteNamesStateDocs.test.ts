import StateChangeNoteMessage from "Common/Types/StatusPage/StateChangeNoteMessage";
import StateChangePublicNote from "Common/Server/Utils/StatusPage/StateChangePublicNote";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A public note posted with a state change is the one message subscribers
 * get about the change, so it names the new state on every channel, and a
 * change whose note the person may not post is refused whole. The guides say
 * so: Incident States & Severities in every language, and Subscribers &
 * Announcements (scheduled maintenance, and the state in note templates) in
 * English and Persian, the one translated corpus that has those sections.
 * Markdown is not compiled, so this reads the code the guides quote - the
 * subjects, the Slack line, the payload keys, the permission titles - and
 * checks the guides still say it.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

const STATES_PAGE: string = "incidents/states-and-severities.md";
const SUBSCRIBERS_PAGE: string = "status-pages/subscribers.md";

const ALL_LANGUAGES: Array<string> = fs
  .readdirSync(CONTENT_DIR, { withFileTypes: true })
  .filter((entry: fs.Dirent): boolean => {
    return entry.isDirectory();
  })
  .map((entry: fs.Dirent): string => {
    return entry.name;
  })
  .sort();

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

function permissionTitle(permission: Permission): string {
  return PermissionHelper.getPermissionTitles([permission])[0]!;
}

// What the guides quote, built by the code that sends it.
const INCIDENT_SUBJECT: string = StateChangeNoteMessage.getIncidentEmailSubject(
  { stateName: "Resolved", incidentTitle: "<title>" },
);
const MAINTENANCE_SUBJECT: string =
  StateChangeNoteMessage.getScheduledMaintenanceEmailSubject({
    stateName: "Ongoing",
    eventTitle: "<title>",
  });
const RESOLVED_LINE: string =
  StateChangeNoteMessage.getChatStatusLine("Resolved");
const ONGOING_LINE: string =
  StateChangeNoteMessage.getChatStatusLine("Ongoing");

describe("the code the guides quote", () => {
  test("the subjects, SMS and chat lines are the ones the jobs send", () => {
    expect(INCIDENT_SUBJECT).toBe("[Resolved Incident] <title>");
    expect(MAINTENANCE_SUBJECT).toBe("[Ongoing Scheduled Maintenance] <title>");
    expect(RESOLVED_LINE).toBe("**Status:** Resolved");
    expect(ONGOING_LINE).toBe("**Status:** Ongoing");
    expect(
      StateChangeNoteMessage.getIncidentSmsHeadline({
        stateName: "Resolved",
        incidentTitle: "<title>",
        statusPageName: "<status page>",
      }),
    ).toBe("Incident <title> on <status page> is Resolved.");
    expect(
      StateChangeNoteMessage.getScheduledMaintenanceSmsHeadline({
        stateName: "Ongoing",
        eventTitle: "<title>",
        statusPageName: "<status page>",
      }),
    ).toBe("Maintenance <title> on <status page> is Ongoing.");
    expect(
      StateChangeNoteMessage.getIncidentCustomTemplateEmailSubject({
        stateName: "Resolved",
        incidentTitle: "<title>",
      }),
    ).toBe("[Incident Resolved] <title>");
    expect(
      StateChangeNoteMessage.getScheduledMaintenanceCustomTemplateEmailSubject({
        stateName: "Ongoing",
        eventTitle: "<title>",
      }),
    ).toBe("[Scheduled Maintenance Ongoing] <title>");
  });

  test("the payload keys are the state change payloads' own", () => {
    const incidentJob: string = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "App/FeatureSet/Workers/Jobs/IncidentPublicNote/SendNotificationToSubscribers.ts",
      ),
      "utf8",
    );
    const maintenanceJob: string = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "App/FeatureSet/Workers/Jobs/ScheduledMaintenancePublicNote/SendNotificationToSubscribers.ts",
      ),
      "utf8",
    );

    expect(incidentJob).toContain("{ incidentState: stateChange.name }");
    expect(maintenanceJob).toContain(
      "{ scheduledMaintenanceState: stateChangeName }",
    );
  });

  test("a refused change says the state was not changed", () => {
    expect(StateChangePublicNote.getRefusalMessage("Why.")).toContain(
      "The state was not changed",
    );
  });
});

describe("Incident States & Severities, in every language", () => {
  test("there are 17 languages", () => {
    expect(ALL_LANGUAGES.length).toBe(17);
  });

  test.each(ALL_LANGUAGES)(
    "%s: the note names the new state, and needs its own permission",
    (language: string) => {
      const guide: string = readGuide(language, STATES_PAGE);

      expect(guide).toContain(INCIDENT_SUBJECT);
      expect(guide).toContain(RESOLVED_LINE);
      // Said once, in the paragraph about the note.
      expect(guide.split(INCIDENT_SUBJECT)).toHaveLength(2);
    },
  );
});

describe("the English guides", () => {
  const states: string = sectionOf(
    readGuide("en", STATES_PAGE),
    "## Telling status page subscribers about a state change",
  );
  const subscribers: string = readGuide("en", SUBSCRIBERS_PAGE);
  const maintenance: string = sectionOf(
    subscribers,
    "### Scheduled maintenance events",
  );
  const noteTemplates: string = sectionOf(
    subscribers,
    "### The state in note templates",
  );

  test("incidents: every channel names the state", () => {
    expect(states).toContain("**The note says what the incident is now.**");
    expect(states).toContain(INCIDENT_SUBJECT);
    expect(states).toContain("**Status** row");
    expect(states).toContain(
      "`Incident <title> on <status page> is Resolved.`",
    );
    expect(states).toContain(`\`${RESOLVED_LINE}\``);
    expect(states).toContain("`IncidentNoteCreated`");
    expect(states).toContain("`incidentState`");
    expect(states).toContain(
      "A note posted on its own keeps its usual message",
    );
  });

  test("incidents: the note needs its own permission, and a change without it is refused whole", () => {
    expect(states).toContain("**Posting the note needs its own permission.**");
    expect(states).toContain(
      `**${permissionTitle(Permission.CreateIncidentStateTimeline)}**`,
    );
    expect(states).toContain(
      `**${permissionTitle(Permission.CreateIncidentPublicNote)}**`,
    );
    expect(states).toContain("is not offered **Add a public note**");
    expect(states).toContain("is refused whole");
    expect(states).toContain("Leave the note out and the change goes through.");
  });

  test("scheduled maintenance: every channel names the state, and the note needs its permission", () => {
    expect(maintenance).toContain("**The note names the new state.**");
    expect(maintenance).toContain(MAINTENANCE_SUBJECT);
    expect(maintenance).toContain(
      "`Maintenance <title> on <status page> is Ongoing.`",
    );
    expect(maintenance).toContain(`\`${ONGOING_LINE}\``);
    expect(maintenance).toContain("`ScheduledMaintenanceNoteCreated`");
    expect(maintenance).toContain("`scheduledMaintenanceState`");
    expect(maintenance).toContain(
      `**${permissionTitle(Permission.CreateScheduledMaintenancePublicNote)}**`,
    );
  });

  test("custom templates: both state variables are documented", () => {
    expect(noteTemplates).toContain("`{{incidentState}}`");
    expect(noteTemplates).toContain("`{{scheduledMaintenanceState}}`");
    expect(noteTemplates).toContain("**Subscriber Incident Note Created**");
    expect(noteTemplates).toContain(
      "**Subscriber Scheduled Maintenance Note Created**",
    );
    expect(noteTemplates).toContain("`[Incident Resolved] <title>`");
    expect(noteTemplates).toContain(
      "`[Scheduled Maintenance Ongoing] <title>`",
    );
  });
});

describe("the Persian guides say the same", () => {
  const states: string = sectionOf(
    readGuide("fa", STATES_PAGE),
    "## گفتن تغییر وضعیت به مشترکان صفحه وضعیت",
  );
  const subscribers: string = readGuide("fa", SUBSCRIBERS_PAGE);
  const maintenance: string = sectionOf(
    subscribers,
    "### رویدادهای نگهداری زمان‌بندی‌شده",
  );
  const noteTemplates: string = sectionOf(
    subscribers,
    "### وضعیت در قالب‌های یادداشت",
  );

  test("incidents", () => {
    for (const quoted of [
      INCIDENT_SUBJECT,
      `\`${RESOLVED_LINE}\``,
      "`IncidentNoteCreated`",
      "`incidentState`",
      `**${permissionTitle(Permission.CreateIncidentPublicNote)}**`,
      "**Add a public note**",
    ]) {
      expect({ quoted, found: states.includes(quoted) }).toEqual({
        quoted,
        found: true,
      });
    }
  });

  test("scheduled maintenance", () => {
    for (const quoted of [
      MAINTENANCE_SUBJECT,
      `\`${ONGOING_LINE}\``,
      "`ScheduledMaintenanceNoteCreated`",
      "`scheduledMaintenanceState`",
      `**${permissionTitle(Permission.CreateScheduledMaintenancePublicNote)}**`,
    ]) {
      expect({ quoted, found: maintenance.includes(quoted) }).toEqual({
        quoted,
        found: true,
      });
    }
  });

  test("custom templates", () => {
    expect(noteTemplates).toContain("`{{incidentState}}`");
    expect(noteTemplates).toContain("`{{scheduledMaintenanceState}}`");
  });
});
