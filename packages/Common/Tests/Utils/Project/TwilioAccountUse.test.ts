import {
  getIncomingCallNumberNoTwilioAccountMessage,
  getNoTwilioAccountMessage,
  getWhoCanSetAProjectDefaultForItSentence,
  INCOMING_CALL_NUMBER_NO_TWILIO_ACCOUNT_MESSAGE,
  PROJECT_TWILIO_SETTINGS_PAGE,
  SERVER_TWILIO_SETTINGS_PAGE,
  SET_AS_PROJECT_DEFAULT_FOR,
  TwilioMessageKind,
  WHO_CAN_ADD_A_TWILIO_ACCOUNT_SENTENCE,
  WHO_CAN_USE_THE_PROJECT_TWILIO_ACCOUNT_FOR_IT_SENTENCE,
  WHO_MAY_EDIT_A_PROJECT_TWILIO_ACCOUNT,
} from "../../../Utils/Project/TwilioAccount";
import { TwilioConfigUse } from "../../../Types/CallAndSMS/TwilioConfigUse";
import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * WHY A MESSAGE WENT NOWHERE, WHEN THE PROJECT'S OWN TWILIO CONFIG IS NOT
 * USED FOR IT.
 *
 * A config used for SMS only makes no calls, and one used for calls only
 * sends no SMS (Types/CallAndSMS/TwilioConfigUse): such a message goes
 * through the OneUptime server's own account instead, as it would without
 * a config. When the server has none, "No Twilio account is set up to make
 * phone calls" would leave the reader looking at the project's config and
 * wondering. So the message says that the project's config is not used for
 * it, and who can change that - the people who may edit it - or add the
 * server's.
 *
 * Only the project's default for the message was read - a project has one
 * default for SMS and one for calls (TwilioConfigDefaults, #6574) - so the
 * message says "default", and suggests what most such projects need: a
 * config used for that kind only, made the project default for it with the
 * row action the Twilio Config table offers such a config (#6603). A
 * status page's SMS go through the page's own config, not a default: its
 * message names the page's config, and no default.
 */

const permissionTitle: (permission: Permission) => string = (
  permission: Permission,
): string => {
  return (
    PermissionHelper.getAllPermissionProps().find(
      (props: PermissionProps): boolean => {
        return props.permission === permission;
      },
    )?.title || ""
  );
};

describe("a call the project's default config, used for SMS only, does not make", () => {
  const message: string = getNoTwilioAccountMessage(TwilioMessageKind.Call, {
    projectConfigUse: TwilioConfigUse.SmsOnly,
  });

  test("says the project's default config is used for SMS only, and that no other account makes calls", () => {
    expect(message).toMatch(
      /^This project's default Twilio config is used for SMS only, and no other Twilio account is set up to make phone calls\. /,
    );
  });

  test("says who can add the server's account, make a config for calls only the default for calls, or use this one for both - and where", () => {
    expect(message).toBe(
      "This project's default Twilio config is used for SMS only, and no other Twilio account is set up to make phone calls. The OneUptime server's administrator can add one in Admin Dashboard > Settings > Call and SMS, or a Project Owner, a Project Admin or someone with Edit Call and SMS can make a config used for calls only the project default for calls (Set as Project Default for Calls in its row's menu), or use this config for calls and SMS, in Project Settings > Notifications > Notification Channels.",
    );
    expect(message).toContain(
      getWhoCanSetAProjectDefaultForItSentence(TwilioMessageKind.Call),
    );
    expect(message).toContain(
      `The OneUptime server's administrator can add one in ${SERVER_TWILIO_SETTINGS_PAGE}`,
    );
    expect(message).toContain(`, in ${PROJECT_TWILIO_SETTINGS_PAGE}.`);
    // Not "add one": the project has one.
    expect(message).not.toContain("can add this project's own");
  });

  test("names the row action that makes a config the project's default for calls", () => {
    expect(SET_AS_PROJECT_DEFAULT_FOR[TwilioMessageKind.Call]).toBe(
      "Set as Project Default for Calls",
    );
    expect(message).toContain(
      `(${SET_AS_PROJECT_DEFAULT_FOR[TwilioMessageKind.Call]} in its row's menu)`,
    );
    // Not SMS's: the call needs the default for calls.
    expect(message).not.toContain(
      SET_AS_PROJECT_DEFAULT_FOR[TwilioMessageKind.SMS],
    );
  });
});

describe("an SMS the project's default config, used for calls only, does not send", () => {
  test("says so, and suggests a config for SMS only as the project default for SMS", () => {
    expect(
      getNoTwilioAccountMessage(TwilioMessageKind.SMS, {
        projectConfigUse: TwilioConfigUse.CallsOnly,
      }),
    ).toBe(
      "This project's default Twilio config is used for calls only, and no other Twilio account is set up to send SMS. The OneUptime server's administrator can add one in Admin Dashboard > Settings > Call and SMS, or a Project Owner, a Project Admin or someone with Edit Call and SMS can make a config used for SMS only the project default for SMS (Set as Project Default for SMS in its row's menu), or use this config for calls and SMS, in Project Settings > Notifications > Notification Channels.",
    );
  });

  test("and for a number for incoming calls, which is verified by SMS: the default for SMS", () => {
    expect(
      getIncomingCallNumberNoTwilioAccountMessage({
        projectConfigUse: TwilioConfigUse.CallsOnly,
      }),
    ).toBe(
      `Numbers for incoming calls are verified by SMS. This project's default Twilio config is used for calls only, and no other Twilio account is set up to send SMS. ${getWhoCanSetAProjectDefaultForItSentence(TwilioMessageKind.SMS)}`,
    );
    expect(SET_AS_PROJECT_DEFAULT_FOR[TwilioMessageKind.SMS]).toBe(
      "Set as Project Default for SMS",
    );
    expect(
      getIncomingCallNumberNoTwilioAccountMessage({
        projectConfigUse: TwilioConfigUse.CallsOnly,
      }),
    ).not.toContain(SET_AS_PROJECT_DEFAULT_FOR[TwilioMessageKind.Call]);
  });
});

describe("an SMS a status page's own config, used for calls only, does not send", () => {
  const message: string = getNoTwilioAccountMessage(TwilioMessageKind.SMS, {
    projectConfigUse: TwilioConfigUse.CallsOnly,
    isStatusPageConfig: true,
  });

  test("names the status page's config, and who can use it for calls and SMS", () => {
    expect(message).toBe(
      "This status page's Twilio config is used for calls only, and no other Twilio account is set up to send SMS. The OneUptime server's administrator can add one in Admin Dashboard > Settings > Call and SMS, or a Project Owner, a Project Admin or someone with Edit Call and SMS can use this config for calls and SMS in Project Settings > Notifications > Notification Channels.",
    );
    expect(message).toContain(
      WHO_CAN_USE_THE_PROJECT_TWILIO_ACCOUNT_FOR_IT_SENTENCE,
    );
  });

  test("suggests no project default: a default would not change what the page sends", () => {
    expect(message).not.toMatch(/default/i);
    expect(message).not.toContain("This project's");
  });

  test("a status page's config that sends SMS says no account is set up, as before", () => {
    for (const projectConfigUse of [
      TwilioConfigUse.SmsOnly,
      TwilioConfigUse.CallsAndSms,
    ]) {
      expect(
        getNoTwilioAccountMessage(TwilioMessageKind.SMS, {
          projectConfigUse,
          isStatusPageConfig: true,
        }),
      ).toBe(getNoTwilioAccountMessage(TwilioMessageKind.SMS));
    }
  });

  test("a status page with no config of its own says no account is set up, as before", () => {
    expect(
      getNoTwilioAccountMessage(TwilioMessageKind.SMS, {
        isStatusPageConfig: true,
      }),
    ).toBe(getNoTwilioAccountMessage(TwilioMessageKind.SMS));
  });

  test("said only when it is said: the project's default otherwise", () => {
    for (const isStatusPageConfig of [false, undefined]) {
      expect(
        getNoTwilioAccountMessage(TwilioMessageKind.SMS, {
          projectConfigUse: TwilioConfigUse.CallsOnly,
          isStatusPageConfig,
        }),
      ).toMatch(/^This project's default Twilio config is used for calls only/);
    }
  });
});

describe("when the project's config is used for the message, or there is none", () => {
  test("says no account is set up, as before", () => {
    for (const projectConfigUse of [
      undefined,
      null,
      TwilioConfigUse.CallsAndSms,
    ]) {
      for (const kind of [TwilioMessageKind.SMS, TwilioMessageKind.Call]) {
        expect(getNoTwilioAccountMessage(kind, { projectConfigUse })).toBe(
          getNoTwilioAccountMessage(kind),
        );
      }

      expect(
        getIncomingCallNumberNoTwilioAccountMessage({ projectConfigUse }),
      ).toBe(INCOMING_CALL_NUMBER_NO_TWILIO_ACCOUNT_MESSAGE);
    }

    // A config used for SMS only is used for SMS; for calls only, for calls.
    expect(
      getNoTwilioAccountMessage(TwilioMessageKind.SMS, {
        projectConfigUse: TwilioConfigUse.SmsOnly,
      }),
    ).toBe(getNoTwilioAccountMessage(TwilioMessageKind.SMS));
    expect(
      getNoTwilioAccountMessage(TwilioMessageKind.Call, {
        projectConfigUse: TwilioConfigUse.CallsOnly,
      }),
    ).toBe(getNoTwilioAccountMessage(TwilioMessageKind.Call));
    expect(
      getIncomingCallNumberNoTwilioAccountMessage({
        projectConfigUse: TwilioConfigUse.SmsOnly,
      }),
    ).toBe(INCOMING_CALL_NUMBER_NO_TWILIO_ACCOUNT_MESSAGE);
    expect(getIncomingCallNumberNoTwilioAccountMessage()).toBe(
      INCOMING_CALL_NUMBER_NO_TWILIO_ACCOUNT_MESSAGE,
    );
  });

  test("the message without a project config is unchanged", () => {
    expect(getNoTwilioAccountMessage(TwilioMessageKind.Call)).toBe(
      `No Twilio account is set up to make phone calls. ${WHO_CAN_ADD_A_TWILIO_ACCOUNT_SENTENCE}`,
    );
  });
});

describe("who may change what a project's config is used for, and what it is the default for", () => {
  test("is exactly who may edit a ProjectCallSMSConfig's use", () => {
    const config: ProjectCallSMSConfig = new ProjectCallSMSConfig();

    expect(config.getColumnAccessControlFor("usedFor")?.update).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectCallSMSConfig,
    ]);
    expect(config.getUpdatePermissions()).toEqual(
      expect.arrayContaining([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.EditProjectCallSMSConfig,
      ]),
    );
  });

  test("and exactly who may make it the project default: Set as Project Default writes isProjectDefault", () => {
    const config: ProjectCallSMSConfig = new ProjectCallSMSConfig();

    expect(
      config.getColumnAccessControlFor("isProjectDefault")?.update,
    ).toEqual(config.getColumnAccessControlFor("usedFor")?.update);
  });

  test("the words name them by the titles people see them under", () => {
    expect(permissionTitle(Permission.EditProjectCallSMSConfig)).toBe(
      "Edit Call and SMS",
    );
    expect(WHO_MAY_EDIT_A_PROJECT_TWILIO_ACCOUNT).toBe(
      `a Project Owner, a Project Admin or someone with ${permissionTitle(Permission.EditProjectCallSMSConfig)}`,
    );
    for (const kind of [TwilioMessageKind.SMS, TwilioMessageKind.Call]) {
      expect(getWhoCanSetAProjectDefaultForItSentence(kind)).toContain(
        `or ${WHO_MAY_EDIT_A_PROJECT_TWILIO_ACCOUNT} can make a config used for `,
      );
    }
  });

  test("every message says it without an order to the reader, and ends a sentence", () => {
    for (const message of [
      getNoTwilioAccountMessage(TwilioMessageKind.Call, {
        projectConfigUse: TwilioConfigUse.SmsOnly,
      }),
      getNoTwilioAccountMessage(TwilioMessageKind.SMS, {
        projectConfigUse: TwilioConfigUse.CallsOnly,
      }),
      getNoTwilioAccountMessage(TwilioMessageKind.SMS, {
        projectConfigUse: TwilioConfigUse.CallsOnly,
        isStatusPageConfig: true,
      }),
      getIncomingCallNumberNoTwilioAccountMessage({
        projectConfigUse: TwilioConfigUse.CallsOnly,
      }),
    ]) {
      expect(message).not.toMatch(/please/i);
      expect(message).not.toContain("Twilio Config not found");
      expect(message.endsWith(".")).toBe(true);
    }
  });
});
