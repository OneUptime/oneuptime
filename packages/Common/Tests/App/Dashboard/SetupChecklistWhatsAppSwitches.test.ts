import { describe, expect, test } from "@jest/globals";
import UserNotificationSetting from "../../../Models/DatabaseModels/UserNotificationSetting";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import { hasWhatsAppTemplate } from "../../../Types/WhatsApp/WhatsAppEventTemplates";
import {
  NotificationSettingProbes,
  SETTING_CHANNELS,
  SettingChannel,
  getNotificationSettingProbes,
  getUndeliverableSettingChannels,
  isSettingSwitchOn,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UserSettings/SetupChecklist/useSetupChecklist";

/*
 * THE SETUP CHECKLIST READS A WHATSAPP SWITCH AS NOTIFICATION SETTINGS
 * SHOWS IT (#9715).
 *
 * WhatsApp delivers only Meta-approved templates, and an event with none -
 * an SLO's status, a missed call, a security case, being made an owner of
 * a service - is sent no WhatsApp message whatever its switch says.
 * Notification Settings no longer offers that switch. One left on from
 * before sends nothing and is nothing the reader can see or change there, so
 * "Your notification settings point at channels that work" neither names
 * WhatsApp for it nor counts it as carrying the update.
 */

const E: typeof NotificationSettingEventType = NotificationSettingEventType;

type ChannelColumn = SettingChannel["column"];

function setting(
  eventType: NotificationSettingEventType,
  switchedOn: Array<ChannelColumn>,
): UserNotificationSetting {
  const row: UserNotificationSetting = new UserNotificationSetting();
  row.eventType = eventType;

  for (const channel of SETTING_CHANNELS) {
    (row as unknown as Record<string, boolean>)[channel.column as string] =
      switchedOn.includes(channel.column);
  }

  return row;
}

function channel(column: ChannelColumn): SettingChannel {
  return SETTING_CHANNELS.find((each: SettingChannel): boolean => {
    return each.column === column;
  })!;
}

describe("a WhatsApp switch", () => {
  test("is on for an event WhatsApp can send", () => {
    expect(
      hasWhatsAppTemplate(E.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION),
    ).toBe(true);
    expect(
      isSettingSwitchOn(
        setting(E.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION, [
          "alertByWhatsApp",
        ]),
        channel("alertByWhatsApp"),
      ),
    ).toBe(true);
  });

  test("is no switch at all for an event WhatsApp cannot send", () => {
    expect(
      hasWhatsAppTemplate(E.SEND_SLO_OWNER_STATUS_CHANGE_NOTIFICATION),
    ).toBe(false);
    expect(
      isSettingSwitchOn(
        setting(E.SEND_SLO_OWNER_STATUS_CHANGE_NOTIFICATION, [
          "alertByWhatsApp",
        ]),
        channel("alertByWhatsApp"),
      ),
    ).toBe(false);
  });

  test("every other channel counts for every event", () => {
    for (const each of SETTING_CHANNELS) {
      if (each.column === "alertByWhatsApp") {
        continue;
      }

      expect({
        column: each.column,
        on: isSettingSwitchOn(
          setting(E.SEND_SLO_OWNER_STATUS_CHANGE_NOTIFICATION, [each.column]),
          each,
        ),
      }).toEqual({ column: each.column, on: true });
    }
  });

  test("a switch that is off is off", () => {
    expect(
      isSettingSwitchOn(
        setting(E.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION, []),
        channel("alertByWhatsApp"),
      ),
    ).toBe(false);
  });
});

describe("You switched on ..., but have no verified method there", () => {
  test("does not name WhatsApp for a switch left on for an event it cannot send", () => {
    expect(
      getUndeliverableSettingChannels({
        rows: [
          setting(E.SEND_SLO_OWNER_STATUS_CHANGE_NOTIFICATION, [
            "alertByEmail",
            "alertByWhatsApp",
          ]),
          setting(E.SEND_SECURITY_CASE_OPENED_NOTIFICATION, [
            "alertByWhatsApp",
          ]),
        ],
        usableMethodTypes: new Set<string>(["Email"]),
      }),
    ).toEqual([]);
  });

  test("still names it for an event it can send", () => {
    expect(
      getUndeliverableSettingChannels({
        rows: [
          setting(E.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION, [
            "alertByEmail",
            "alertByWhatsApp",
          ]),
        ],
        usableMethodTypes: new Set<string>(["Email"]),
      }),
    ).toEqual(["WhatsApp"]);
  });

  test("Push on beside a WhatsApp switch that sends nothing is Push alone, and is named", () => {
    expect(
      getUndeliverableSettingChannels({
        rows: [
          setting(E.SEND_SECURITY_CASE_ASSIGNED_NOTIFICATION, [
            "alertByPush",
            "alertByWhatsApp",
          ]),
        ],
        usableMethodTypes: new Set<string>(["WhatsApp"]),
      }),
    ).toEqual(["Push"]);
  });
});

describe("the step's probes", () => {
  test("a reader whose only undeliverable switch is WhatsApp on an event it cannot send is told nothing is wrong", () => {
    const probes: NotificationSettingProbes = getNotificationSettingProbes({
      rows: [
        setting(E.SEND_WHEN_USER_IS_ON_CALL_ROSTER, ["alertByEmail"]),
        setting(E.SEND_INCOMING_CALL_MISSED_OWNER_NOTIFICATION, [
          "alertByEmail",
          "alertByWhatsApp",
        ]),
      ],
      usableMethodTypes: new Set<string>(["Email"]),
      workspaces: {},
    });

    expect(probes.deliverableSettings).toEqual({
      isKnown: true,
      undeliverableChannels: [],
    });
    expect(probes.onCallShiftAlerts).toEqual({
      isKnown: true,
      hasAnyChannelEnabled: true,
    });
  });
});
