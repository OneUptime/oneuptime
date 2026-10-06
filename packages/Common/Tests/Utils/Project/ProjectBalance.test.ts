import {
  formatProjectBalanceAmount,
  getProjectBalanceMessageNotSentReason,
  getProjectBalanceOwnerSentence,
  getProjectBalanceShortfallSentence,
  getProjectBalanceTooLowMessage,
  getProjectBalanceWhoCanAddSentence,
  INCOMING_CALL_NUMBER_BALANCE_TOO_LOW_MESSAGE,
  PROJECT_AI_CREDITS_USED_UP_MESSAGE,
  PROJECT_BALANCE_AUTO_RECHARGE_COLUMNS,
  PROJECT_BALANCE_RECHARGE_PERMISSIONS,
  PROJECT_BALANCE_SETTINGS_PAGE,
  PROJECT_BALANCE_SETTINGS_PATH,
  ProjectBalanceType,
  WHO_CAN_ADD_PROJECT_BALANCE,
} from "../../../Utils/Project/ProjectBalance";
import {
  getWhoCanTurnOnSentence,
  PROJECT_NOTIFICATION_CHANNEL_SETTINGS_PAGE,
  PROJECT_NOTIFICATION_CHANNEL_SETTINGS_PATH,
  PROJECT_NOTIFICATION_CHANNEL_UPDATE_PERMISSIONS,
  ProjectNotificationChannel,
} from "../../../Utils/Project/NotificationChannels";
import ProjectAiDailyLimits, {
  PROJECT_AI_DAILY_LIMIT_UPDATE_PERMISSIONS,
  WHO_CAN_CHANGE_PROJECT_AI_DAILY_LIMITS,
} from "../../../Types/AI/ProjectAiDailyLimits";
import Project from "../../../Models/DatabaseModels/Project";
import Permission from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * Utils/Project/ProjectBalance is the one wording of who may add to a
 * project's prepaid balances - the one that pays for SMS, calls, WhatsApp
 * and Telegram, and the AI credits - and of every message that says one
 * ran too low: the server's refusals, the log of a message that was not
 * sent, the AI call refusal and readiness gaps, and the owners' email.
 *
 * Those messages used to tell whoever read them to recharge ("Your SMS
 * balance is low. Please recharge your SMS balance in Project Settings >
 * Notification Settings."), though only some roles can. The people the
 * module names are only right while they are the people the recharge
 * routes and the Auto Recharge columns let in, so this holds them together
 * with the model (the routes themselves: Tests/Server/API/
 * ProjectBalanceRechargeWho), and pins every sentence.
 */

const ALL_BALANCES: Array<ProjectBalanceType> = [
  ProjectBalanceType.SmsOrCall,
  ProjectBalanceType.AI,
];

const ALL_CHANNELS: Array<ProjectNotificationChannel> = Object.values(
  ProjectNotificationChannel,
);

// Every sentence the module says to a reader who may not add balance.
const SENTENCES_FOR_EVERYONE: Array<string> = [
  ...ALL_BALANCES.map((balance: ProjectBalanceType): string => {
    return getProjectBalanceWhoCanAddSentence(balance);
  }),
  ...ALL_CHANNELS.map((channel: ProjectNotificationChannel): string => {
    return getProjectBalanceTooLowMessage(channel);
  }),
  ...ALL_CHANNELS.map((channel: ProjectNotificationChannel): string => {
    return getProjectBalanceMessageNotSentReason({
      channel,
      balanceInUSDCents: 5,
      costInUSDCents: 10,
    });
  }),
  ...ALL_CHANNELS.map((channel: ProjectNotificationChannel): string => {
    return getProjectBalanceMessageNotSentReason({
      channel,
      balanceInUSDCents: 0,
      costInUSDCents: 10,
    });
  }),
  INCOMING_CALL_NUMBER_BALANCE_TOO_LOW_MESSAGE,
  PROJECT_AI_CREDITS_USED_UP_MESSAGE,
];

describe("who may add balance", () => {
  test("is a project owner, or someone with Manage Billing", () => {
    expect([...PROJECT_BALANCE_RECHARGE_PERMISSIONS]).toEqual([
      Permission.ProjectOwner,
      Permission.ManageProjectBilling,
    ]);
  });

  test("is exactly what every Auto Recharge column's update permissions say", () => {
    const project: Project = new Project();

    for (const balance of ALL_BALANCES) {
      for (const column of PROJECT_BALANCE_AUTO_RECHARGE_COLUMNS[balance]) {
        expect([
          column,
          project.getColumnAccessControlFor(column)?.update,
        ]).toEqual([column, [...PROJECT_BALANCE_RECHARGE_PERMISSIONS]]);
      }
    }
  });

  test("may update the Project at all, so a column check lets them through", () => {
    const tableUpdate: Array<Permission> = new Project().getUpdatePermissions();

    for (const permission of PROJECT_BALANCE_RECHARGE_PERMISSIONS) {
      expect(tableUpdate).toContain(permission);
    }
  });

  test("never a project admin, nor the Billing Admin role: neither may recharge", () => {
    expect(PROJECT_BALANCE_RECHARGE_PERMISSIONS).not.toContain(
      Permission.ProjectAdmin,
    );
    expect(PROJECT_BALANCE_RECHARGE_PERMISSIONS).not.toContain(
      Permission.BillingAdmin,
    );
    expect(WHO_CAN_ADD_PROJECT_BALANCE.toLowerCase()).not.toContain("admin");
  });

  test("are the people who may turn the paid channels on and change the daily AI limits, named in the same words", () => {
    expect([...PROJECT_BALANCE_RECHARGE_PERMISSIONS]).toEqual([
      ...PROJECT_NOTIFICATION_CHANNEL_UPDATE_PERMISSIONS,
    ]);
    expect([...PROJECT_BALANCE_RECHARGE_PERMISSIONS]).toEqual([
      ...PROJECT_AI_DAILY_LIMIT_UPDATE_PERMISSIONS,
    ]);
    expect(WHO_CAN_ADD_PROJECT_BALANCE).toBe(
      "a project owner or someone with Manage Billing",
    );
    expect(WHO_CAN_ADD_PROJECT_BALANCE).toBe(
      WHO_CAN_CHANGE_PROJECT_AI_DAILY_LIMITS,
    );
    expect(getWhoCanTurnOnSentence("it")).toContain(
      "A project owner or someone with Manage Billing can",
    );
    expect(ProjectAiDailyLimits.getWhoCanChangeSentence()).toContain(
      "A project owner or someone with Manage Billing can",
    );
  });

  test("each balance has a switch and two amounts, all on the Project", () => {
    const project: Project = new Project();

    expect(PROJECT_BALANCE_AUTO_RECHARGE_COLUMNS).toEqual({
      [ProjectBalanceType.SmsOrCall]: [
        "enableAutoRechargeSmsOrCallBalance",
        "autoRechargeSmsOrCallByBalanceInUSD",
        "autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD",
      ],
      [ProjectBalanceType.AI]: [
        "enableAutoRechargeAiBalance",
        "autoAiRechargeByBalanceInUSD",
        "autoRechargeAiWhenCurrentBalanceFallsInUSD",
      ],
    });

    for (const balance of ALL_BALANCES) {
      for (const column of PROJECT_BALANCE_AUTO_RECHARGE_COLUMNS[balance]) {
        expect(project.getTableColumnMetadata(column)).toBeTruthy();
      }
    }
  });
});

describe("where each balance is", () => {
  test("the notification balance is on Notification Settings, with the channel switches", () => {
    expect(PROJECT_BALANCE_SETTINGS_PAGE[ProjectBalanceType.SmsOrCall]).toBe(
      PROJECT_NOTIFICATION_CHANNEL_SETTINGS_PAGE,
    );
    expect(PROJECT_BALANCE_SETTINGS_PAGE[ProjectBalanceType.SmsOrCall]).toBe(
      "Project Settings > Notification Settings",
    );
    expect(PROJECT_BALANCE_SETTINGS_PATH[ProjectBalanceType.SmsOrCall]).toBe(
      PROJECT_NOTIFICATION_CHANNEL_SETTINGS_PATH,
    );
  });

  test("AI credits are on AI Credits, named as the other AI sentences name pages", () => {
    expect(PROJECT_BALANCE_SETTINGS_PAGE[ProjectBalanceType.AI]).toBe(
      "Project Settings → AI Credits",
    );
    expect(PROJECT_BALANCE_SETTINGS_PATH[ProjectBalanceType.AI]).toBe(
      "settings/ai-credits",
    );
  });
});

describe("who can add balance, as a sentence", () => {
  test("names the people and the page, for the notification balance", () => {
    expect(
      getProjectBalanceWhoCanAddSentence(ProjectBalanceType.SmsOrCall),
    ).toBe(
      "A project owner or someone with Manage Billing can add balance in Project Settings > Notification Settings.",
    );
  });

  test("names the people and the page, for AI credits", () => {
    expect(getProjectBalanceWhoCanAddSentence(ProjectBalanceType.AI)).toBe(
      "A project owner or someone with Manage Billing can add AI credits in Project Settings → AI Credits.",
    );
  });

  test("never offers Auto Recharge as the way out of a used-up balance", () => {
    for (const balance of ALL_BALANCES) {
      expect(getProjectBalanceWhoCanAddSentence(balance)).not.toMatch(
        /auto[- ]?recharge/i,
      );
    }
  });
});

describe("what the server says when a method's code cannot be paid for", () => {
  test.each([
    [
      ProjectNotificationChannel.SMS,
      "This project's balance is too low to send SMS. A project owner or someone with Manage Billing can add balance in Project Settings > Notification Settings.",
    ],
    [
      ProjectNotificationChannel.Call,
      "This project's balance is too low to make phone calls. A project owner or someone with Manage Billing can add balance in Project Settings > Notification Settings.",
    ],
    [
      ProjectNotificationChannel.WhatsApp,
      "This project's balance is too low to send WhatsApp messages. A project owner or someone with Manage Billing can add balance in Project Settings > Notification Settings.",
    ],
    [
      ProjectNotificationChannel.Telegram,
      "This project's balance is too low to send Telegram messages. A project owner or someone with Manage Billing can add balance in Project Settings > Notification Settings.",
    ],
  ])("%s", (channel: ProjectNotificationChannel, expected: string) => {
    expect(getProjectBalanceTooLowMessage(channel)).toBe(expected);
  });

  test("calls are not called SMS any more", () => {
    expect(
      getProjectBalanceTooLowMessage(ProjectNotificationChannel.Call),
    ).not.toContain("SMS");
  });

  test("numbers for incoming calls say they are verified by SMS", () => {
    expect(INCOMING_CALL_NUMBER_BALANCE_TOO_LOW_MESSAGE).toBe(
      "Numbers for incoming calls are verified by SMS, and this project's balance is too low to send SMS. A project owner or someone with Manage Billing can add balance in Project Settings > Notification Settings.",
    );
  });
});

describe("amounts", () => {
  test.each([
    [0, "0.00 USD"],
    [5, "0.05 USD"],
    [10, "0.10 USD"],
    [100, "1.00 USD"],
    [1234, "12.34 USD"],
    [Number.NaN, "0.00 USD"],
    [Number.POSITIVE_INFINITY, "0.00 USD"],
  ])("%s cents reads %s", (cents: number, expected: string) => {
    expect(formatProjectBalanceAmount(cents)).toBe(expected);
  });
});

describe("why one message was not sent", () => {
  test.each([
    [ProjectNotificationChannel.SMS, "this SMS"],
    [ProjectNotificationChannel.Call, "this call"],
    [ProjectNotificationChannel.WhatsApp, "this WhatsApp message"],
    [ProjectNotificationChannel.Telegram, "this Telegram message"],
  ])(
    "%s: what is left against what it costs",
    (channel: ProjectNotificationChannel, message: string) => {
      expect(
        getProjectBalanceShortfallSentence({
          channel,
          balanceInUSDCents: 5,
          costInUSDCents: 10,
        }),
      ).toBe(
        `This project's balance (0.05 USD) is less than ${message} costs (0.10 USD).`,
      );
    },
  );

  test.each([[0], [-25], [Number.NaN]])(
    "nothing left (%s cents) is said plainly, without amounts",
    (balanceInUSDCents: number) => {
      expect(
        getProjectBalanceShortfallSentence({
          channel: ProjectNotificationChannel.SMS,
          balanceInUSDCents,
          costInUSDCents: 0,
        }),
      ).toBe("This project's balance is used up.");
    },
  );

  test("the log line adds who can add balance, and where", () => {
    expect(
      getProjectBalanceMessageNotSentReason({
        channel: ProjectNotificationChannel.Call,
        balanceInUSDCents: 20,
        costInUSDCents: 35,
      }),
    ).toBe(
      "This project's balance (0.20 USD) is less than this call costs (0.35 USD). A project owner or someone with Manage Billing can add balance in Project Settings > Notification Settings.",
    );
    expect(
      getProjectBalanceMessageNotSentReason({
        channel: ProjectNotificationChannel.Telegram,
        balanceInUSDCents: 0,
        costInUSDCents: 1,
      }),
    ).toBe(
      "This project's balance is used up. A project owner or someone with Manage Billing can add balance in Project Settings > Notification Settings.",
    );
  });
});

describe("what the owners are told", () => {
  test("to add balance or turn on Auto Recharge, which tops it up at once", () => {
    expect(getProjectBalanceOwnerSentence(ProjectBalanceType.SmsOrCall)).toBe(
      "Add balance in Project Settings > Notification Settings, or turn on Auto Recharge there so it does not run out.",
    );
  });

  test("to add AI credits first: AI is recharged only after a call it paid for", () => {
    expect(getProjectBalanceOwnerSentence(ProjectBalanceType.AI)).toBe(
      "Add AI credits in Project Settings → AI Credits, and turn on Auto Recharge there so they do not run out again.",
    );
  });
});

describe("the AI call refusal", () => {
  test("says the credits are used up, and who can add them", () => {
    expect(PROJECT_AI_CREDITS_USED_UP_MESSAGE).toBe(
      "This project's AI credits are used up. A project owner or someone with Manage Billing can add AI credits in Project Settings → AI Credits.",
    );
  });
});

describe("every sentence said to whoever asked", () => {
  test.each(
    SENTENCES_FOR_EVERYONE.map((sentence: string) => {
      return [sentence];
    }),
  )(
    "names who can and never tells the reader to recharge: %s",
    (sentence: string) => {
      expect(sentence).toContain(
        "A project owner or someone with Manage Billing can add",
      );
      expect(sentence).not.toMatch(/please/i);
      expect(sentence).not.toMatch(/\brecharge\b/i);
      expect(sentence).not.toMatch(/\byour\b/i);
      expect(sentence.toLowerCase()).not.toContain("admin");
      expect(sentence).toMatch(/\.$/);
    },
  );
});
