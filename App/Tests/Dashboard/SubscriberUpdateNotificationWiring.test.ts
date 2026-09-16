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
