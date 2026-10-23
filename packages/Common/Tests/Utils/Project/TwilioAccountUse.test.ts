import {
  getIncomingCallNumberNoTwilioAccountMessage,
  getNoTwilioAccountMessage,
  INCOMING_CALL_NUMBER_NO_TWILIO_ACCOUNT_MESSAGE,
  PROJECT_TWILIO_SETTINGS_PAGE,
  SERVER_TWILIO_SETTINGS_PAGE,
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

describe("a call the project's config, used for SMS only, does not make", () => {
  const message: string = getNoTwilioAccountMessage(TwilioMessageKind.Call, {
    projectConfigUse: TwilioConfigUse.SmsOnly,
  });

  test("says the project's config is used for SMS only, and that no other account makes calls", () => {
    expect(message).toMatch(
      /^This project's Twilio config is used for SMS only, and no other Twilio account is set up to make phone calls\. /,
    );
  });

  test("says who can add the server's account, or use the project's for calls and SMS, and where", () => {
    expect(message).toContain(
      WHO_CAN_USE_THE_PROJECT_TWILIO_ACCOUNT_FOR_IT_SENTENCE,
    );
    expect(message).toContain(
      `The OneUptime server's administrator can add one in ${SERVER_TWILIO_SETTINGS_PAGE}`,
    );
    expect(message).toContain(
      `a project owner, a project admin or someone with Edit Call and SMS can use this project's config for calls and SMS in ${PROJECT_TWILIO_SETTINGS_PAGE}.`,
    );
    // Not "add one": the project has one.
    expect(message).not.toContain("can add this project's own");
  });
});

describe("an SMS the project's config, used for calls only, does not send", () => {
  test("says so, in the same words", () => {
    expect(
      getNoTwilioAccountMessage(TwilioMessageKind.SMS, {
        projectConfigUse: TwilioConfigUse.CallsOnly,
      }),
    ).toBe(
      `This project's Twilio config is used for calls only, and no other Twilio account is set up to send SMS. ${WHO_CAN_USE_THE_PROJECT_TWILIO_ACCOUNT_FOR_IT_SENTENCE}`,
    );
  });

  test("and for a number for incoming calls, which is verified by SMS", () => {
    expect(
      getIncomingCallNumberNoTwilioAccountMessage({
        projectConfigUse: TwilioConfigUse.CallsOnly,
      }),
    ).toBe(
      `Numbers for incoming calls are verified by SMS. This project's Twilio config is used for calls only, and no other Twilio account is set up to send SMS. ${WHO_CAN_USE_THE_PROJECT_TWILIO_ACCOUNT_FOR_IT_SENTENCE}`,
    );
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

describe("who may change what a project's config is used for", () => {
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

  test("the words name them by the titles people see them under", () => {
    expect(permissionTitle(Permission.EditProjectCallSMSConfig)).toBe(
      "Edit Call and SMS",
    );
    expect(WHO_MAY_EDIT_A_PROJECT_TWILIO_ACCOUNT).toBe(
      `a project owner, a project admin or someone with ${permissionTitle(Permission.EditProjectCallSMSConfig)}`,
    );
  });

  test("every message says it without an order to the reader, and ends a sentence", () => {
    for (const message of [
      getNoTwilioAccountMessage(TwilioMessageKind.Call, {
        projectConfigUse: TwilioConfigUse.SmsOnly,
      }),
      getNoTwilioAccountMessage(TwilioMessageKind.SMS, {
        projectConfigUse: TwilioConfigUse.CallsOnly,
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
