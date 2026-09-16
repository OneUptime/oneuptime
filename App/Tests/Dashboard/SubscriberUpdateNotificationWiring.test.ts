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
  {
    name: "Incident public notes",
    file: ["Pages", "Incidents", "View", "PublicNote.tsx"],
    modelType: "IncidentPublicNote",
    statusColumn: "subscriberNotificationStatusOnNoteUpdated",
    messageColumn: "subscriberNotificationStatusMessageOnNoteUpdated",
    originalStatusColumn: "subscriberNotificationStatusOnNoteCreated",
  },
  {
    name: "Scheduled maintenance public notes",
    file: ["Pages", "ScheduledMaintenanceEvents", "View", "PublicNote.tsx"],
    modelType: "ScheduledMaintenancePublicNote",
    statusColumn: "subscriberNotificationStatusOnNoteUpdated",
    messageColumn: "subscriberNotificationStatusMessageOnNoteUpdated",
    originalStatusColumn: "subscriberNotificationStatusOnNoteCreated",
  },
  {
    name: "Incident episode public notes",
    file: ["Pages", "Incidents", "EpisodeView", "PublicNote.tsx"],
    modelType: "IncidentEpisodePublicNote",
    statusColumn: "subscriberNotificationStatusOnNoteUpdated",
    messageColumn: "subscriberNotificationStatusMessageOnNoteUpdated",
    originalStatusColumn: "subscriberNotificationStatusOnNoteCreated",
  },
];

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

describe("the note tables only offer the update checkbox when editing", () => {
  test.each(PAGES.slice(1))(
    "$name renders its form through ModelTable, which honours doNotShowWhenCreating",
    (page: PageCase) => {
      expect(readSource(...page.file)).toContain(
        `<ModelTable<${page.modelType}>`,
      );
    },
  );

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

  const STRINGS: Array<string> = [
    "Notify subscribers about this update",
    "Send subscribers the edited announcement, marked as an update. Leave this unticked for small fixes such as typos.",
    "Send subscribers the edited note, marked as an update. Leave this unticked for small fixes such as typos.",
    "Update Notification Status",
  ];

  const localeFiles: Array<string> = fs
    .readdirSync(LOCALES_DIR)
    .filter((name: string): boolean => {
      return name.endsWith(".json");
    });

  test("the pages use exactly these strings", () => {
    const pages: string = PAGES.map((page: PageCase): string => {
      return fs.readFileSync(path.join(DASHBOARD_SRC, ...page.file), "utf8");
    })
      .join(" ")
      .replace(/\s+/g, " ");

    expect(pages).toContain(STRINGS[1]);
    expect(pages).toContain(STRINGS[2]);
    expect(pages).toContain(STRINGS[3]);
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
