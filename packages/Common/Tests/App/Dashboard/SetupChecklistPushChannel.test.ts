import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import UserNotificationSetting from "../../../Models/DatabaseModels/UserNotificationSetting";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import {
  CHANNELS_NEEDING_A_VERIFIED_METHOD,
  SETTING_CHANNELS,
  SettingChannel,
  getUndeliverableSettingChannels,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UserSettings/SetupChecklist/useSetupChecklist";

/*
 * "Your notification settings point at channels that work" - the Setup
 * Checklist step that catches a switch turned green in Notification Settings
 * with no address behind it - holds the reader to the channels that need a
 * verified method. Push is not one: the mobile app makes it work, and every
 * new member starts with it on for five updates that go by email as well.
 * Held to the same rule, every member without the app was told "You switched
 * on Push, but have no verified method there, so those updates are not sent"
 * on their first visit, about switches they never touched.
 */

type ChannelColumn = SettingChannel["column"];

function setting(
  switchedOn: Array<ChannelColumn>,
  eventType: NotificationSettingEventType = NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
): UserNotificationSetting {
  const row: UserNotificationSetting = new UserNotificationSetting();
  row.eventType = eventType;

  for (const channel of SETTING_CHANNELS) {
    (row as unknown as Record<string, boolean>)[channel.column as string] =
      switchedOn.includes(channel.column);
  }

  return row;
}

function usable(...methodTypes: Array<string>): ReadonlySet<string> {
  return new Set<string>(methodTypes);
}

describe("the channels the step holds the reader to", () => {
  test("are every Notification Settings channel but Push, in the page's column order", () => {
    expect(
      CHANNELS_NEEDING_A_VERIFIED_METHOD.map((channel: SettingChannel) => {
        return channel.label;
      }),
    ).toEqual(["Email", "SMS", "Call", "WhatsApp", "Telegram", "Webhook"]);

    expect(
      SETTING_CHANNELS.filter((channel: SettingChannel): boolean => {
        return !CHANNELS_NEEDING_A_VERIFIED_METHOD.includes(channel);
      }).map((channel: SettingChannel): string => {
        return `${channel.label} (${channel.column})`;
      }),
    ).toEqual(["Push (alertByPush)"]);
  });
});

describe("getUndeliverableSettingChannels", () => {
  test("a new member's defaults - email everywhere, push on five - name nothing", () => {
    const rows: Array<UserNotificationSetting> = [
      setting(["alertByEmail"]),
      ...[
        NotificationSettingEventType.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS,
        NotificationSettingEventType.SEND_WHEN_USER_ON_CALL_SHIFT_IS_REASSIGNED,
        NotificationSettingEventType.SEND_SECURITY_CASE_OPENED_NOTIFICATION,
        NotificationSettingEventType.SEND_SECURITY_CASE_ASSIGNED_NOTIFICATION,
        NotificationSettingEventType.SEND_SECURITY_PLAYBOOK_APPROVAL_NOTIFICATION,
      ].map(
        (eventType: NotificationSettingEventType): UserNotificationSetting => {
          return setting(["alertByEmail", "alertByPush"], eventType);
        },
      ),
    ];

    expect(
      getUndeliverableSettingChannels({
        rows: rows,
        usableMethodTypes: usable("Email"),
      }),
    ).toEqual([]);
  });

  test("push alone, with no app, is not named either", () => {
    expect(
      getUndeliverableSettingChannels({
        rows: [setting(["alertByPush"])],
        usableMethodTypes: usable(),
      }),
    ).toEqual([]);
  });

  test("names each switched-on channel with no usable method, in column order", () => {
    expect(
      getUndeliverableSettingChannels({
        rows: [
          setting(["alertByTelegram", "alertByEmail"]),
          setting(["alertByCall", "alertBySMS", "alertByPush"]),
        ],
        usableMethodTypes: usable("Email", "Push"),
      }),
    ).toEqual(["SMS", "Call", "Telegram"]);
  });

  test("never names a channel the reader has a usable method on", () => {
    expect(
      getUndeliverableSettingChannels({
        rows: [
          setting([
            "alertByEmail",
            "alertBySMS",
            "alertByCall",
            "alertByWhatsApp",
            "alertByTelegram",
            "alertByWebhook",
          ]),
        ],
        usableMethodTypes: usable(
          "Email",
          "SMS",
          "Call",
          "WhatsApp",
          "Telegram",
          "Webhook",
        ),
      }),
    ).toEqual([]);
  });

  test("an unverified or switched-off email is named like any other channel", () => {
    expect(
      getUndeliverableSettingChannels({
        rows: [setting(["alertByEmail"])],
        usableMethodTypes: usable(),
      }),
    ).toEqual(["Email"]);
  });

  test("nothing switched on names nothing", () => {
    expect(
      getUndeliverableSettingChannels({
        rows: [setting([]), setting([])],
        usableMethodTypes: usable(),
      }),
    ).toEqual([]);
  });

  test("no settings at all name nothing", () => {
    expect(
      getUndeliverableSettingChannels({
        rows: [],
        usableMethodTypes: usable(),
      }),
    ).toEqual([]);
  });
});

/*
 * Why leaving Push out never hides an update that reaches nobody: every
 * default switch the server turns on is turned on by email first, and push
 * only beside it.
 */
describe("the defaults a new member starts with", () => {
  const service: string = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "Server",
      "Services",
      "UserNotificationSettingService.ts",
    ),
    "utf8",
  );

  const creator: string = service.slice(
    service.indexOf("private async addNotificationSettingIfNotExists("),
    service.indexOf(
      "@CaptureSpan()",
      service.indexOf("private async addNotificationSettingIfNotExists("),
    ),
  );

  test("the one place they are created is found", () => {
    expect(creator.length).toBeGreaterThan(0);
    expect(creator).toContain(
      "options?: { alertByPush?: boolean | undefined }",
    );
  });

  test("every default turns email on, and push only beside it", () => {
    const branch: string = creator.slice(
      creator.indexOf("if (existingNotification.toNumber() === 0) {"),
    );
    const email: number = branch.indexOf("item.alertByEmail = true;");
    const push: number = branch.indexOf("if (options?.alertByPush) {");

    expect(email).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(email);

    // Email is set by the creating branch itself, under no other condition.
    expect(branch.slice(0, email).split("if (").length - 1).toBe(1);
  });

  test("nothing else in the service creates a default switched on by push alone", () => {
    expect(service.split("item.alertByPush = true;").length - 1).toBe(1);
    expect(service).not.toContain("alertByEmail = false");
  });
});
