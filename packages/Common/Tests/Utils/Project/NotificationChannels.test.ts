import {
  ChannelPronoun,
  getProjectNotificationChannelOffMessage,
  getProjectNotificationChannelOffOwnerSentence,
  getWhoCanTurnOnClause,
  getWhoCanTurnOnSentence,
  INCOMING_CALL_NUMBER_SMS_OFF_MESSAGE,
  PROJECT_NOTIFICATION_CHANNEL_COLUMN_BY_CHANNEL,
  PROJECT_NOTIFICATION_CHANNEL_SETTINGS_PAGE,
  PROJECT_NOTIFICATION_CHANNEL_SETTINGS_PATH,
  PROJECT_NOTIFICATION_CHANNEL_UPDATE_PERMISSIONS,
  ProjectNotificationChannel,
  STATUS_PAGE_SMS_SUBSCRIPTIONS_SMS_OFF_MESSAGE,
  WHO_MAY_TURN_THEM_ON,
} from "../../../Utils/Project/NotificationChannels";
import Project from "../../../Models/DatabaseModels/Project";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * Utils/Project/NotificationChannels is the one wording of who may turn a
 * project's SMS, phone call, WhatsApp or Telegram channel on: what the
 * server says when something needs a channel that is off (adding a method,
 * sending a code again, an SMS subscriber, a status page's SMS
 * subscriptions, a message not sent), what on-call readiness and team
 * compliance say, and what the owners' email says.
 *
 * The people it names are only right while they are the people the four
 * columns' update permissions let in, so this holds the two together: a
 * column that let a project admin in, or a sentence that named one, fails
 * here before either reaches a reader. A Billing Admin may (the role that
 * administers billing switches what the project pays for), and every
 * sentence says so.
 */

const ALL_CHANNELS: Array<ProjectNotificationChannel> = Object.values(
  ProjectNotificationChannel,
);

const ALL_SENTENCES: Array<string> = [
  ...ALL_CHANNELS.map((channel: ProjectNotificationChannel): string => {
    return getProjectNotificationChannelOffMessage(channel);
  }),
  INCOMING_CALL_NUMBER_SMS_OFF_MESSAGE,
  STATUS_PAGE_SMS_SUBSCRIPTIONS_SMS_OFF_MESSAGE,
  getWhoCanTurnOnSentence("it"),
  getWhoCanTurnOnSentence("them"),
];

describe("the four channels", () => {
  test("are SMS, phone calls, WhatsApp and Telegram, named as on-call readiness names them", () => {
    expect(ALL_CHANNELS).toEqual(["SMS", "Call", "WhatsApp", "Telegram"]);
  });

  test("each is a boolean Project column that starts off", () => {
    const project: Project = new Project();

    expect(PROJECT_NOTIFICATION_CHANNEL_COLUMN_BY_CHANNEL).toEqual({
      [ProjectNotificationChannel.SMS]: "enableSmsNotifications",
      [ProjectNotificationChannel.Call]: "enableCallNotifications",
      [ProjectNotificationChannel.WhatsApp]: "enableWhatsAppNotifications",
      [ProjectNotificationChannel.Telegram]: "enableTelegramNotifications",
    });

    for (const channel of ALL_CHANNELS) {
      const column: string =
        PROJECT_NOTIFICATION_CHANNEL_COLUMN_BY_CHANNEL[channel];

      expect([
        column,
        project.getTableColumnMetadata(column)?.type,
        project.getTableColumnMetadata(column)?.defaultValue,
      ]).toEqual([column, TableColumnType.Boolean, false]);
    }
  });
});

describe("who may turn them on", () => {
  test("is exactly what every column's update permissions say: a project owner, a Billing Admin, or Manage Billing", () => {
    const project: Project = new Project();

    expect([...PROJECT_NOTIFICATION_CHANNEL_UPDATE_PERMISSIONS]).toEqual([
      Permission.ProjectOwner,
      Permission.BillingAdmin,
      Permission.ManageProjectBilling,
    ]);

    for (const channel of ALL_CHANNELS) {
      const column: string =
        PROJECT_NOTIFICATION_CHANNEL_COLUMN_BY_CHANNEL[channel];

      expect([
        column,
        project.getColumnAccessControlFor(column)?.update,
      ]).toEqual([
        column,
        [...PROJECT_NOTIFICATION_CHANNEL_UPDATE_PERMISSIONS],
      ]);
    }
  });

  test("never a project admin: Project Admin leaves out billing", () => {
    const project: Project = new Project();

    for (const channel of ALL_CHANNELS) {
      expect(
        project
          .getColumnAccessControlFor(
            PROJECT_NOTIFICATION_CHANNEL_COLUMN_BY_CHANNEL[channel],
          )
          ?.update?.includes(Permission.ProjectAdmin),
      ).toBe(false);
    }

    expect(
      PROJECT_NOTIFICATION_CHANNEL_UPDATE_PERMISSIONS.includes(
        Permission.ProjectAdmin,
      ),
    ).toBe(false);
  });

  test("the words name those three by the titles people see them under", () => {
    const titles: Array<string> =
      PROJECT_NOTIFICATION_CHANNEL_UPDATE_PERMISSIONS.map(
        (permission: Permission): string => {
          return (
            PermissionHelper.getAllPermissionProps().find(
              (props: PermissionProps): boolean => {
                return props.permission === permission;
              },
            )?.title || ""
          );
        },
      );

    expect(titles).toEqual([
      "Project Owner",
      "Billing Admin",
      "Manage Billing",
    ]);

    for (const sentence of ALL_SENTENCES) {
      expect([sentence, sentence.includes("project owner")]).toEqual([
        sentence,
        true,
      ]);
      expect([sentence, sentence.includes("Billing Admin")]).toEqual([
        sentence,
        true,
      ]);
      expect([sentence, sentence.includes("Manage Billing")]).toEqual([
        sentence,
        true,
      ]);
    }
  });

  test("the Billing Admin role may, and the other two billing roles may not", () => {
    const project: Project = new Project();

    for (const channel of ALL_CHANNELS) {
      const update: Array<Permission> =
        project.getColumnAccessControlFor(
          PROJECT_NOTIFICATION_CHANNEL_COLUMN_BY_CHANNEL[channel],
        )?.update || [];

      expect([channel, update.includes(Permission.BillingAdmin)]).toEqual([
        channel,
        true,
      ]);
      expect([channel, update.includes(Permission.BillingMember)]).toEqual([
        channel,
        false,
      ]);
      expect([channel, update.includes(Permission.BillingViewer)]).toEqual([
        channel,
        false,
      ]);
    }

    // The column check runs after the Project's own, which must let them in.
    expect(project.getUpdatePermissions()).toContain(Permission.BillingAdmin);
  });

  test("the words are the one shared phrase, so no sentence can name a different set", () => {
    expect(WHO_MAY_TURN_THEM_ON).toBe(
      "a project owner, a Billing Admin or someone with Manage Billing",
    );

    for (const sentence of ALL_SENTENCES) {
      expect([
        sentence,
        sentence.toLowerCase().includes(WHO_MAY_TURN_THEM_ON.toLowerCase()),
      ]).toEqual([sentence, true]);
    }
  });
});

describe("where the switches are", () => {
  test("Project Settings > Notification Settings, at the project's settings/notification-settings", () => {
    expect(PROJECT_NOTIFICATION_CHANNEL_SETTINGS_PAGE).toBe(
      "Project Settings > Notification Settings",
    );
    expect(PROJECT_NOTIFICATION_CHANNEL_SETTINGS_PATH).toBe(
      "settings/notification-settings",
    );
  });

  test("every sentence says where, so a reader who may not can tell someone who may", () => {
    for (const sentence of ALL_SENTENCES) {
      expect([
        sentence,
        sentence.includes(PROJECT_NOTIFICATION_CHANNEL_SETTINGS_PAGE),
      ]).toEqual([sentence, true]);
    }
  });
});

describe("who can turn it on, as words", () => {
  test.each(["it", "them"] as Array<ChannelPronoun>)(
    "the clause and the sentence for %s",
    (pronoun: ChannelPronoun) => {
      expect(getWhoCanTurnOnClause(pronoun)).toBe(
        `a project owner, a Billing Admin or someone with Manage Billing can turn ${pronoun} on in Project Settings > Notification Settings`,
      );
      expect(getWhoCanTurnOnSentence(pronoun)).toBe(
        `A project owner, a Billing Admin or someone with Manage Billing can turn ${pronoun} on in Project Settings > Notification Settings.`,
      );
    },
  );
});

describe("what the server says when a channel is off", () => {
  test.each([
    [
      ProjectNotificationChannel.SMS,
      "SMS is off in this project. A project owner, a Billing Admin or someone with Manage Billing can turn it on in Project Settings > Notification Settings.",
    ],
    [
      ProjectNotificationChannel.Call,
      "Phone calls are off in this project. A project owner, a Billing Admin or someone with Manage Billing can turn them on in Project Settings > Notification Settings.",
    ],
    [
      ProjectNotificationChannel.WhatsApp,
      "WhatsApp is off in this project. A project owner, a Billing Admin or someone with Manage Billing can turn it on in Project Settings > Notification Settings.",
    ],
    [
      ProjectNotificationChannel.Telegram,
      "Telegram is off in this project. A project owner, a Billing Admin or someone with Manage Billing can turn it on in Project Settings > Notification Settings.",
    ],
  ] as Array<[ProjectNotificationChannel, string]>)(
    "%s",
    (channel: ProjectNotificationChannel, expected: string) => {
      expect(getProjectNotificationChannelOffMessage(channel)).toBe(expected);
    },
  );

  test("incoming call numbers need SMS, because they are verified by text", () => {
    expect(INCOMING_CALL_NUMBER_SMS_OFF_MESSAGE).toBe(
      "Numbers for incoming calls are verified by SMS, which is off in this project. A project owner, a Billing Admin or someone with Manage Billing can turn it on in Project Settings > Notification Settings.",
    );
  });

  test("a status page's SMS subscriptions need SMS on for the project", () => {
    expect(STATUS_PAGE_SMS_SUBSCRIPTIONS_SMS_OFF_MESSAGE).toBe(
      "Visitors can't subscribe by SMS while SMS is off in this project. A project owner, a Billing Admin or someone with Manage Billing can turn it on in Project Settings > Notification Settings.",
    );
  });

  /*
   * "Billing Admin" is a role a reader can be given, named as the team
   * permission picker names it; "an admin" or "a project admin" would send
   * the reader to somebody who may not.
   */
  test("no sentence tells its reader to do it themselves, or to ask an admin", () => {
    const ADMIN: RegExp = /\b(an?|project|your) admin/i;
    const PLEASE_ENABLE: RegExp = /\bPlease enable\b/i;
    const TURN_IT_ON_YOURSELF: RegExp = /^Turn /;

    for (const sentence of ALL_SENTENCES) {
      expect([sentence, ADMIN.test(sentence)]).toEqual([sentence, false]);
      expect([sentence, PLEASE_ENABLE.test(sentence)]).toEqual([
        sentence,
        false,
      ]);
      expect([sentence, TURN_IT_ON_YOURSELF.test(sentence)]).toEqual([
        sentence,
        false,
      ]);
    }
  });

  test("none of them is the old 'disabled for this project' wording", () => {
    for (const sentence of ALL_SENTENCES) {
      expect(sentence).not.toMatch(
        /notifications are (disabled|not enabled) for this project/i,
      );
    }
  });
});

describe("what the owners are told about a message that was not sent", () => {
  test.each([
    [
      ProjectNotificationChannel.SMS,
      "SMS is off in this project. If it should be on, turn it on in Project Settings > Notification Settings.",
    ],
    [
      ProjectNotificationChannel.Call,
      "Phone calls are off in this project. If they should be on, turn them on in Project Settings > Notification Settings.",
    ],
    [
      ProjectNotificationChannel.WhatsApp,
      "WhatsApp is off in this project. If it should be on, turn it on in Project Settings > Notification Settings.",
    ],
    [
      ProjectNotificationChannel.Telegram,
      "Telegram is off in this project. If it should be on, turn it on in Project Settings > Notification Settings.",
    ],
  ] as Array<[ProjectNotificationChannel, string]>)(
    "%s: they may turn it on, so they are told to, if it should be on",
    (channel: ProjectNotificationChannel, expected: string) => {
      expect(getProjectNotificationChannelOffOwnerSentence(channel)).toBe(
        expected,
      );
    },
  );
});
