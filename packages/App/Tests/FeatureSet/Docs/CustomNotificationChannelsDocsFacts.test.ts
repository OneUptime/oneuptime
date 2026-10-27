import {
  DocsFence,
  DocsHeading,
  DocsLink,
  NAV_PAGES,
  ScannedPage,
  anchorsOfScanned,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import { readCommonSource, readDashboardSource } from "./DocsDashboardMenus";
import UserNotificationSetting from "Common/Models/DatabaseModels/UserNotificationSetting";
import {
  CUSTOM_CHANNEL_PAYLOAD_VERSION,
  CustomChannelAction,
  CustomChannelEvent,
  CustomChannelPerson,
  CustomChannelRecordType,
  CustomChannelReference,
  MAX_CUSTOM_CHANNEL_TEXT_LENGTH,
  buildCustomChannelNotificationPayload,
  buildCustomChannelPagePayload,
} from "Common/Types/CustomNotificationChannel/CustomNotificationChannelPayload";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import { JSONObject } from "Common/Types/JSON";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import { TRUNCATED_TEXT_NOTE } from "Common/Utils/MessageFit";
import { describe, expect, it } from "@jest/globals";

/*
 * THE CUSTOM CHANNELS PAGE SAYS WHAT A NOTIFICATION SENDS.
 *
 * self-hosted/custom-notification-channels documents the body of a request
 * to a service OneUptime does not own, and its "Other Notifications"
 * section the body of a notification that is not a page
 * (buildCustomChannelNotificationPayload): its example, field for field,
 * the event that names it, and where people turn it on. Markdown is not
 * compiled, so these hold the page to Common's builder and to the source
 * that sends it: the example is what the builder makes of the example's
 * own values, and a field added to the payload fails here until the page
 * shows it.
 */

const PAGE: string = "self-hosted/custom-notification-channels";

const english: string = readPage("en", PAGE);
const scanned: ScannedPage = scanMarkdown(english);

// The text of a level-2 section, from its heading to the next one.
function section(title: string): string {
  const start: number = english.indexOf(`\n## ${title}\n`);

  if (start < 0) {
    throw new Error(`The page has no "## ${title}" section.`);
  }

  const end: number = english.indexOf("\n## ", start + 1);

  return english.slice(start, end < 0 ? english.length : end);
}

// The JSON example a fence titled `title` holds, parsed.
function jsonExample(title: string): JSONObject {
  const fence: DocsFence | undefined = scanned.fences.find(
    (candidate: DocsFence): boolean => {
      return (
        candidate.lang === "json" && candidate.info.includes(`title="${title}"`)
      );
    },
  );

  if (!fence) {
    throw new Error(`The page has no json example titled "${title}".`);
  }

  return JSON.parse(fence.code) as JSONObject;
}

const notificationExample: JSONObject = jsonExample("A notification");

describe("the custom channels page and other notifications", () => {
  it("is a page of the docs", () => {
    expect(NAV_PAGES).toContain(PAGE);
  });

  it("has an Other Notifications section, which its cards link to", () => {
    const heading: DocsHeading | undefined = scanned.headings.find(
      (candidate: DocsHeading): boolean => {
        return candidate.text === "Other Notifications";
      },
    );

    expect(heading?.level).toBe(2);
    expect(anchorsOfScanned(scanned).has("other-notifications")).toBe(true);
    expect(
      scanned.links
        .map((link: DocsLink): string => {
          return link.target;
        })
        .filter((target: string): boolean => {
          return target === "#other-notifications";
        }).length,
    ).toBeGreaterThanOrEqual(2);
    expect(english).toContain(
      "- [Other notifications](#other-notifications): Owner notifications, notes and shifts, for people who want them.",
    );
  });

  it("documents the example as the builder makes it, field for field and value for value", () => {
    const built: JSONObject = buildCustomChannelNotificationPayload({
      sentAt: new Date(notificationExample["sentAt"] as string),
      channel: notificationExample[
        "channel"
      ] as unknown as CustomChannelReference,
      notificationType: notificationExample["notificationType"] as string,
      title: notificationExample["title"] as string,
      message: notificationExample["message"] as string,
      url: notificationExample["url"] as string,
      project: notificationExample[
        "project"
      ] as unknown as CustomChannelReference,
      user: notificationExample["user"] as unknown as CustomChannelPerson,
    });

    expect(notificationExample).toEqual(built);
    // In the order a service reads them, too.
    expect(Object.keys(notificationExample)).toEqual(Object.keys(built));
  });

  it("names every field the builder sends, nested ones included, and no other", () => {
    const built: JSONObject = buildCustomChannelNotificationPayload({
      sentAt: new Date("2026-10-27T03:20:00.000Z"),
      channel: { id: "channel-id", name: "CorpoApp" },
      notificationType:
        NotificationSettingEventType.SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION,
      title: "Title",
      message: "Message",
      url: "https://oneuptime.example.com/dashboard",
      project: { id: "project-id", name: "Agency A" },
      user: { id: "user-id", name: "Jane Tan", email: "jane@example.com" },
    });

    expect(Object.keys(notificationExample)).toEqual(Object.keys(built));

    for (const nested of ["channel", "project", "user"]) {
      expect({
        nested,
        keys: Object.keys(notificationExample[nested] as JSONObject),
      }).toEqual({
        nested,
        keys: Object.keys(built[nested] as JSONObject),
      });
    }
  });

  it("is a page's body with no record and nothing to act on, and two fields of its own", () => {
    const page: JSONObject = buildCustomChannelPagePayload({
      event: CustomChannelEvent.IncidentCreated,
      notificationId: "5f2c8a1e-6b1d-4c3a-9e7f-2a4b6c8d0e1f",
      sentAt: new Date("2026-10-27T03:14:15.000Z"),
      channel: { id: "channel-id", name: "CorpoApp" },
      title: "Title",
      message: "Message",
      project: { id: "project-id", name: "Agency A" },
      user: { id: "user-id", name: "Jane Tan", email: "jane@example.com" },
      recordType: CustomChannelRecordType.Incident,
      record: {
        id: "incident-id",
        number: "INC-42",
        title: "API latency high",
        description: "",
        severity: "Critical",
        state: "Created",
        url: "https://oneuptime.example.com/dashboard",
      },
      isPageAgain: false,
      actions: {
        [CustomChannelAction.Acknowledge]: "https://x/acknowledge",
        [CustomChannelAction.Escalate]: "https://x/escalate",
        [CustomChannelAction.Resolve]: "https://x/resolve",
      },
    });

    // The page's own example has the page's fields, in the page's order.
    expect(Object.keys(jsonExample("An incident page"))).toEqual(
      Object.keys(page),
    );
    expect(Object.keys(notificationExample)).toEqual([
      ...Object.keys(page),
      "notificationType",
      "url",
    ]);

    expect(notificationExample).toMatchObject({
      version: CUSTOM_CHANNEL_PAYLOAD_VERSION,
      event: CustomChannelEvent.Notification,
      notificationId: null,
      team: null,
      recordType: null,
      record: null,
      onCallPolicy: null,
      escalationRule: null,
      isPageAgain: false,
      actions: null,
    });
  });

  it("names a real notification setting in notificationType, and a time as the builder writes it", () => {
    expect(Object.values(NotificationSettingEventType)).toContain(
      notificationExample["notificationType"],
    );

    const sentAt: string = notificationExample["sentAt"] as string;

    expect(new Date(sentAt).toISOString()).toBe(sentAt);
  });

  it("says the link is null when there is none, as the builder sends it", () => {
    expect(section("Other Notifications")).toContain(
      "`url` links to what it is about, or is `null`.",
    );
    expect(
      buildCustomChannelNotificationPayload({
        sentAt: new Date("2026-10-27T03:20:00.000Z"),
        channel: { id: "channel-id", name: "CorpoApp" },
        notificationType:
          NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER,
        title: "Title",
        message: "Message",
        project: { id: "project-id", name: "Agency A" },
        user: { id: "user-id", name: "Jane Tan", email: "jane@example.com" },
      })["url"],
    ).toBeNull();
    expect(typeof notificationExample["url"]).toBe("string");
  });

  it("lists every event a request can name in the field table, notification with a link to its section", () => {
    const eventRow: string | undefined = english
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("| `event` |");
      });

    expect(eventRow).toBeDefined();

    for (const event of Object.values(CustomChannelEvent)) {
      expect({ event, listed: eventRow!.includes(`\`${event}\``) }).toEqual({
        event,
        listed: true,
      });
    }

    expect(eventRow).toContain(
      "`notification` for [other notifications](#other-notifications)",
    );
    expect(section("Other Notifications")).toContain(
      `with \`event\` set to \`${CustomChannelEvent.Notification}\``,
    );
  });

  it("sends one request per channel that is on, as the event the page names", () => {
    const service: string = readCommonSource(
      "Server/Services/UserNotificationSettingService.ts",
    );

    expect(section("Other Notifications")).toContain(
      "A notification goes to every channel that is on, as one request per channel",
    );
    expect(service).toContain(
      "await CustomNotificationChannelService.getChannelsThatAreOn();",
    );
    expect(service).toContain("eventType: CustomChannelEvent.Notification,");
    expect(service).toContain("notificationType: data.eventType,");
  });

  it("says title and message are the push notification's, as the source sends them", () => {
    const service: string = readCommonSource(
      "Server/Services/UserNotificationSettingService.ts",
    );

    expect(section("Other Notifications")).toContain(
      "`title` and `message` are what the person's push notification would say.",
    );
    expect(service).toContain('title: message.title || "",');
    expect(service).toContain('message: message.body || "",');
    expect(service).toContain(
      "url: message.url || message.clickAction || undefined,",
    );
  });

  it("names where people turn it on, by the column the Dashboard draws, while a channel is on", () => {
    const settingsPage: string = readDashboardSource(
      "Pages/UserSettings/NotificationSettings.tsx",
    );
    const column: string = settingsPage.slice(
      settingsPage.indexOf('key: "alertByCustomChannel"'),
      settingsPage.indexOf(
        "},",
        settingsPage.indexOf('key: "alertByCustomChannel"'),
      ),
    );

    expect(section("Other Notifications")).toContain(
      "Each person chooses where each of these goes in **User Settings > Notification Settings**, which has a **Custom Channels** column while a channel is on.",
    );
    expect(column).toContain('label: "Custom Channels",');
    expect(column).toContain("isCustomChannels: true,");
    expect(settingsPage).toContain(
      "if (channel.isCustomChannels) {\n      return hasCustomChannels;",
    );
  });

  it("says it is off for everyone until they turn it on, as the column's default is", () => {
    const metadata: TableColumnMetadata =
      new UserNotificationSetting().getTableColumnMetadata(
        "alertByCustomChannel",
      );

    expect(section("Other Notifications")).toContain(
      "It is off for everyone until they turn it on.",
    );
    expect(metadata.isDefaultValueColumn).toBe(true);
    expect(metadata.defaultValue).toBe(false);
  });

  it("holds the texts to the budget and the note the builder uses", () => {
    expect(english).toContain(
      `held to ${MAX_CUSTOM_CHANNEL_TEXT_LENGTH.toLocaleString("en-US")} characters`,
    );
    expect(english).toContain(`"${TRUNCATED_TEXT_NOTE}"`);
  });
});
