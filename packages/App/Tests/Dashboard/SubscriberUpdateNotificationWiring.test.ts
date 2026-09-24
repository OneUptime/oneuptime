import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Every place an announcement or a public note is edited offers "Notify
 * subscribers about this update", and every place that lists them shows how
 * that notification went, with a retry that re-queues the UPDATE notification
 * (never the original "posted" one, which would re-announce the item as new).
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function readSource(...relativePath: Array<string>): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

interface PageCase {
  name: string;
  file: Array<string>;
  modelType: string;
  statusColumn: string;
  messageColumn: string;
  originalStatusColumn: string;
}

const PAGES: Array<PageCase> = [
  {
    name: "Announcement view",
    file: ["Pages", "StatusPages", "AnnouncementView.tsx"],
    modelType: "StatusPageAnnouncement",
    statusColumn: "subscriberNotificationStatusOnAnnouncementUpdated",
    messageColumn: "subscriberNotificationStatusMessageOnAnnouncementUpdated",
    originalStatusColumn: "subscriberNotificationStatus",
  },
];

/*
 * The public note pages of incidents, scheduled maintenance events and
 * incident episodes are thin wrappers around the shared notes feed
 * (Components/EventNotes), which owns the edit form, the notification badges
 * and their retries for all of them.
 */
interface NotePageCase {
  name: string;
  file: Array<string>;
  modelType: string;
}

const NOTE_PAGES: Array<NotePageCase> = [
  {
    name: "Incident public notes",
    file: ["Pages", "Incidents", "View", "PublicNote.tsx"],
    modelType: "IncidentPublicNote",
  },
  {
    name: "Scheduled maintenance public notes",
    file: ["Pages", "ScheduledMaintenanceEvents", "View", "PublicNote.tsx"],
    modelType: "ScheduledMaintenancePublicNote",
  },
  {
    name: "Incident episode public notes",
    file: ["Pages", "Incidents", "EpisodeView", "PublicNote.tsx"],
    modelType: "IncidentEpisodePublicNote",
  },
];

const EVENT_NOTES_DIR: Array<string> = ["Components", "EventNotes"];

describe.each(PAGES)("$name", (page: PageCase) => {
  const source: string = readSource(...page.file);

  test("offers the notify-about-this-update checkbox on its edit form", () => {
    expect(source).toContain(
      `getNotifySubscribersOfUpdateFormField<${page.modelType}>(`,
    );
  });

  test("selects the update notification message so its details can be shown", () => {
    expect(source).toMatch(
      new RegExp(
        `selectMoreFields=?\\{?:? ?\\{[^}]*${page.messageColumn}: true`,
      ),
    );
  });

  test("shows the update notification status", () => {
    expect(source).toContain(`field: { ${page.statusColumn}: true, }`);
    expect(source).toMatch(
      new RegExp(`status=\\{ ?item\\.${page.statusColumn} ?\\}`),
    );
    expect(source).toMatch(
      new RegExp(
        `subscriberNotificationStatusMessage=\\{ ?item\\.${page.messageColumn} ?\\}`,
      ),
    );
    expect(source).toContain('title: "Update Notification Status"');
  });

  test("hides the update status until an update notification was requested", () => {
    expect(source).toContain(`if (!item.${page.statusColumn}) {`);
  });

  test("retries the update notification, not the original one", () => {
    const retry: string =
      source.match(
        /const handleResendUpdateNotification[\s\S]*?setRefreshToggle/,
      )?.[0] || "";

    expect(retry).not.toBe("");
    expect(retry).toContain(`modelType: ${page.modelType},`);
    expect(retry).toContain(
      `${page.statusColumn}: StatusPageSubscriberNotificationStatus.Pending,`,
    );
    expect(retry).toContain(
      `${page.messageColumn}: SubscriberUpdateNotification.resendQueuedMessage,`,
    );
    expect(retry).not.toContain(`${page.originalStatusColumn}:`);
    expect(
      source.includes(
        "onResendNotification={handleResendUpdateNotification}",
      ) || source.includes("return handleResendUpdateNotification(item);"),
    ).toBe(true);
  });

  test("keeps the original notification's retry as it was", () => {
    const retry: string =
      source.match(
        /const handleResendNotification[\s\S]*?setRefreshToggle/,
      )?.[0] || "";

    expect(retry).toContain(
      `${page.originalStatusColumn}: StatusPageSubscriberNotificationStatus.Pending,`,
    );
    expect(retry).not.toContain(page.statusColumn);
  });
});

describe.each(NOTE_PAGES)("$name", (page: NotePageCase) => {
  const source: string = readSource(...page.file);

  test("renders the shared public notes feed, which owns the edit form", () => {
    expect(source).toMatch(
      new RegExp(
        `<EventNotes<${page.modelType}> [^>]*modelType=\\{${page.modelType}\\} visibility="public"`,
      ),
    );
  });
});

describe("the shared notes feed", () => {
  const feed: string = readSource(...EVENT_NOTES_DIR, "EventNotes.tsx");
  const card: string = readSource(...EVENT_NOTES_DIR, "NoteCard.tsx");
  const util: string = readSource(...EVENT_NOTES_DIR, "EventNotesUtil.ts");

  test("offers the notify-about-this-update checkbox on the edit form of a public note only", () => {
    expect(feed).toContain(
      "const updateNotifyOption: NotifyOption | undefined = isPublic ? { title: SubscriberUpdateNotification.formFieldTitle,",
    );
    expect(feed).toContain("updateNotifyOption={updateNotifyOption}");
    expect(card).toContain("notifyOption={props.updateNotifyOption}");
  });

  test("starts every edit unticked, so a typo fix never pages subscribers", () => {
    const startEdit: string =
      card.match(
        /const startEdit: \(\) => void = \(\): void => \{[\s\S]*?\}\);/,
      )?.[0] || "";

    expect(startEdit).not.toBe("");
    expect(startEdit).toContain("shouldNotify: false,");
  });

  test("asks for an update notification as a misc data prop, only when ticked on a public note", () => {
    expect(feed).toContain(
      "miscDataProps: isPublic && values.shouldNotify ? SubscriberUpdateNotification.getMiscDataProps() : {},",
    );
  });

  test("selects the update notification status and message so its details can be shown", () => {
    expect(util).toContain(
      'candidates["subscriberNotificationStatusOnNoteUpdated"] = true;',
    );
    expect(util).toContain(
      'candidates["subscriberNotificationStatusMessageOnNoteUpdated"] = true;',
    );
  });

  test("shows the update notification status on public notes", () => {
    expect(card).toContain(
      'props.visibility === "public" ? getUpdateNotificationSummary( props.note.subscriberNotificationStatusOnNoteUpdated, props.note.subscriberNotificationStatusMessageOnNoteUpdated, ) : null;',
    );
  });

  test("hides the update status until an update notification was requested", () => {
    const summary: string =
      util.match(
        /export function getUpdateNotificationSummary\([\s\S]*?\n?default: return null; \} \}/,
      )?.[0] || "";

    expect(summary).not.toBe("");
    expect(summary).toContain("default: return null;");
  });

  test("retries the update notification, not the original one", () => {
    const retry: string =
      feed.match(
        /: \{ subscriberNotificationStatusOnNoteUpdated:[\s\S]*?\},/,
      )?.[0] || "";

    expect(retry).not.toBe("");
    expect(retry).toContain(
      "subscriberNotificationStatusOnNoteUpdated: StatusPageSubscriberNotificationStatus.Pending,",
    );
    expect(retry).toContain(
      "subscriberNotificationStatusMessageOnNoteUpdated: SubscriberUpdateNotification.resendQueuedMessage,",
    );
    expect(retry).not.toContain("subscriberNotificationStatusOnNoteCreated");
    expect(feed).toContain('return resendNotification(note, "update");');
  });

  test("keeps the original notification's retry as it was", () => {
    const retry: string =
      feed.match(
        /kind === "posted" \? \{ subscriberNotificationStatusOnNoteCreated:[\s\S]*?\}/,
      )?.[0] || "";

    expect(retry).toContain(
      "subscriberNotificationStatusOnNoteCreated: StatusPageSubscriberNotificationStatus.Pending,",
    );
    expect(retry).not.toContain("subscriberNotificationStatusOnNoteUpdated");
    expect(feed).toContain('return resendNotification(note, "posted");');
  });
});

describe("the announcement only offers the update checkbox when editing", () => {
  test("the announcement checkbox lives on the edit-only details card, not the create page", () => {
    expect(
      readSource("Pages", "StatusPages", "AnnouncementCreate.tsx"),
    ).not.toContain("getNotifySubscribersOfUpdateFormField");
    expect(
      readSource("Components", "Announcement", "AnnouncementsTable.tsx"),
    ).not.toContain("getNotifySubscribersOfUpdateFormField");
  });

  test("the announcement edit form keeps its steps valid by placing the checkbox on a real step", () => {
    const source: string = readSource(
      "Pages",
      "StatusPages",
      "AnnouncementView.tsx",
    );

    expect(source).toContain('id: "more"');
    expect(source).toMatch(
      /getNotifySubscribersOfUpdateFormField<StatusPageAnnouncement>\(\{ stepId: "more",/,
    );
  });
});

/*
 * Dashboard field titles and descriptions are translated by looking the
 * English string up in each locale file, so a string the forms use but no
 * locale has would render in English for everyone.
 */
describe("the update notification strings are translated", () => {
  const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

  const ANNOUNCEMENT_STRINGS: Array<string> = [
    "Send subscribers the edited announcement, marked as an update. Leave this unticked for small fixes such as typos.",
    "Update Notification Status",
  ];

  const NOTE_FEED_STRINGS: Array<string> = [
    "Subscribers will receive the edited note, marked as an update.",
    "Leave this unticked for small fixes such as typos.",
  ];

  // What the badge on a public note says about its update notification.
  const UPDATE_BADGE_LABELS: Array<string> = [
    "Update sent",
    "Update queued",
    "Sending update",
    "Update failed",
    "Update not sent",
  ];

  const STRINGS: Array<string> = [
    "Notify subscribers about this update",
    ...ANNOUNCEMENT_STRINGS,
    ...NOTE_FEED_STRINGS,
    ...UPDATE_BADGE_LABELS,
  ];

  const localeFiles: Array<string> = fs
    .readdirSync(LOCALES_DIR)
    .filter((name: string): boolean => {
      return name.endsWith(".json");
    });

  function readRaw(...relativePath: Array<string>): string {
    return fs
      .readFileSync(path.join(DASHBOARD_SRC, ...relativePath), "utf8")
      .replace(/\s+/g, " ");
  }

  test("the pages and the feed use exactly these strings", () => {
    const announcement: string = readRaw(
      "Pages",
      "StatusPages",
      "AnnouncementView.tsx",
    );
    const feed: string = readRaw(...EVENT_NOTES_DIR, "EventNotes.tsx");
    const util: string = readRaw(...EVENT_NOTES_DIR, "EventNotesUtil.ts");

    for (const text of ANNOUNCEMENT_STRINGS) {
      expect(announcement).toContain(`"${text}"`);
    }

    for (const text of NOTE_FEED_STRINGS) {
      expect(feed).toContain(`"${text}"`);
    }

    for (const label of UPDATE_BADGE_LABELS) {
      expect(util).toContain(`label: "${label}",`);
    }

    expect(
      fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "Common",
          "Types",
          "StatusPage",
          "SubscriberUpdateNotification.ts",
        ),
        "utf8",
      ),
    ).toContain(`"${STRINGS[0]}"`);
  });

  test.each(localeFiles)("%s translates every string", (file: string) => {
    const locale: Record<string, unknown> = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
    ) as Record<string, unknown>;

    for (const text of STRINGS) {
      expect(typeof locale[text]).toBe("string");
      expect((locale[text] as string).trim().length).toBeGreaterThan(0);

      if (file !== "en.json") {
        expect(locale[text]).not.toBe(text);
      }
    }
  });
});
