import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import UserNotificationSetting from "../../../Models/DatabaseModels/UserNotificationSetting";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import {
  CHANNELS_NAMED_ONLY_WHEN_ALONE,
  SETTING_CHANNELS,
  SettingChannel,
  getUndeliverableSettingChannels,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UserSettings/SetupChecklist/useSetupChecklist";

/*
 * "Your notification settings point at channels that work" - the Setup
 * Checklist step that catches a switch turned green in Notification Settings
 * with no method behind it - names Push only for an update that reaches the
 * reader no other way. Every new member starts with push on, beside email,
 * for five updates. Held to the rule every other channel is held to, each
 * member who had not registered a phone or a browser for push was told "You
 * switched on Push, but have no verified method there, so those updates are
 * not sent" on their first visit, about switches they never touched.
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
  test("are every Notification Settings channel, in the page's column order", () => {
    expect(
      getUndeliverableSettingChannels({
        rows: [
          setting(
            SETTING_CHANNELS.map((channel: SettingChannel): ChannelColumn => {
              return channel.column;
            }),
          ),
        ],
        usableMethodTypes: usable(),
      }),
    ).toEqual([
      "Email",
      "SMS",
      "Call",
      "Push",
      "WhatsApp",
      "Telegram",
      "Webhook",
    ]);
  });

  test("Push alone is named only for an update nothing else carries", () => {
    expect(CHANNELS_NAMED_ONLY_WHEN_ALONE).toEqual(["Push"]);

    expect(
      SETTING_CHANNELS.filter((channel: SettingChannel): boolean => {
        return CHANNELS_NAMED_ONLY_WHEN_ALONE.includes(channel.methodType);
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

  test("an update switched on for push alone, with no device, is named: it reaches nobody", () => {
    expect(
      getUndeliverableSettingChannels({
        rows: [setting(["alertByPush"])],
        usableMethodTypes: usable("Email"),
      }),
    ).toEqual(["Push"]);
  });

  test("push beside any usable channel is not named, whichever channel it is", () => {
    for (const channel of SETTING_CHANNELS) {
      if (channel.column === "alertByPush") {
        continue;
      }

      expect({
        beside: channel.label,
        named: getUndeliverableSettingChannels({
          rows: [setting(["alertByPush", channel.column])],
          usableMethodTypes: usable(channel.methodType),
        }),
      }).toEqual({ beside: channel.label, named: [] });
    }
  });

  test("push beside a channel that is not usable either is named with it", () => {
    expect(
      getUndeliverableSettingChannels({
        rows: [setting(["alertBySMS", "alertByPush"])],
        usableMethodTypes: usable("Email"),
      }),
    ).toEqual(["SMS", "Push"]);
  });

  test("push is judged update by update: one update carried by email does not cover another left to push", () => {
    expect(
      getUndeliverableSettingChannels({
        rows: [
          setting(
            ["alertByEmail", "alertByPush"],
            NotificationSettingEventType.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS,
          ),
          setting(
            ["alertByPush"],
            NotificationSettingEventType.SEND_WHEN_USER_ON_CALL_SHIFT_IS_REASSIGNED,
          ),
        ],
        usableMethodTypes: usable("Email"),
      }),
    ).toEqual(["Push"]);
  });

  test("a registered push device covers every update switched on for push", () => {
    expect(
      getUndeliverableSettingChannels({
        rows: [
          setting(["alertByPush"]),
          setting(["alertBySMS", "alertByPush"]),
        ],
        usableMethodTypes: usable("Push"),
      }),
    ).toEqual(["SMS"]);
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
 * Why a new member's own defaults never name Push: every default switch the
 * server turns on is turned on by email first, and push only beside it, so
 * each of those updates is carried by email.
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
