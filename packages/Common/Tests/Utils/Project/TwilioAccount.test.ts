import {
  getNoTwilioAccountMessage,
  INCOMING_CALL_NUMBER_NO_TWILIO_ACCOUNT_MESSAGE,
  PROJECT_TWILIO_SETTINGS_PAGE,
  SERVER_TWILIO_SETTINGS_PAGE,
  TwilioMessageKind,
  WHO_CAN_ADD_A_TWILIO_ACCOUNT_SENTENCE,
  WHO_MAY_ADD_A_PROJECT_TWILIO_ACCOUNT,
} from "../../../Utils/Project/TwilioAccount";
import { PROJECT_NOTIFICATION_CHANNEL_SETTINGS_PAGE } from "../../../Utils/Project/NotificationChannels";
import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * Utils/Project/TwilioAccount is what a person is told when an SMS or a call
 * cannot go anywhere because no Twilio account is set up - in the verify
 * dialog, in the refusal of a resend, in the add form when a number's first
 * code could not be sent, and in the log of the message that was not sent.
 * It replaced "Twilio Config not found", and the dialog that said "We have
 * sent a SMS with your verification code" when nothing had been sent.
 *
 * The people it names are only right while they are the people the server
 * lets add a project's Twilio config, so this holds the two together.
 */

const ALL_MESSAGES: Array<string> = [
  getNoTwilioAccountMessage(TwilioMessageKind.SMS),
  getNoTwilioAccountMessage(TwilioMessageKind.Call),
  INCOMING_CALL_NUMBER_NO_TWILIO_ACCOUNT_MESSAGE,
];

describe("what is said when there is no Twilio account", () => {
  test("says what is missing, for SMS and for calls", () => {
    expect(getNoTwilioAccountMessage(TwilioMessageKind.SMS)).toMatch(
      /^No Twilio account is set up to send SMS\. /,
    );
    expect(getNoTwilioAccountMessage(TwilioMessageKind.Call)).toMatch(
      /^No Twilio account is set up to make phone calls\. /,
    );
    expect(INCOMING_CALL_NUMBER_NO_TWILIO_ACCOUNT_MESSAGE).toMatch(
      /^Numbers for incoming calls are verified by SMS, and no Twilio account is set up to send SMS\. /,
    );
  });

  test("every message says who can add one, and where - for the server and for the project", () => {
    for (const message of ALL_MESSAGES) {
      expect(message).toContain(WHO_CAN_ADD_A_TWILIO_ACCOUNT_SENTENCE);
      expect(message).toContain(
        "The OneUptime server's administrator can add one in Admin Dashboard > Settings > Call and SMS",
      );
      expect(message).toContain(
        "a project owner, a project admin or someone with Create Call and SMS can add this project's own in Project Settings > Notification Settings",
      );
    }
  });

  test("never the old, unexplained wording, and never an order to the reader", () => {
    for (const message of ALL_MESSAGES) {
      expect(message).not.toContain("Twilio Config not found");
      expect(message).not.toMatch(/please/i);
      expect(message.endsWith(".")).toBe(true);
    }
  });

  test("names the pages where each account is set", () => {
    expect(SERVER_TWILIO_SETTINGS_PAGE).toBe(
      "Admin Dashboard > Settings > Call and SMS",
    );
    // The project's Twilio Config card sits on the Notification Settings page.
    expect(PROJECT_TWILIO_SETTINGS_PAGE).toBe(
      PROJECT_NOTIFICATION_CHANNEL_SETTINGS_PAGE,
    );
  });
});

describe("who may add a project's Twilio account", () => {
  test("is exactly who may create a ProjectCallSMSConfig", () => {
    expect(new ProjectCallSMSConfig().getCreatePermissions()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateProjectCallSMSConfig,
    ]);
  });

  test("the words name them by the titles people see them under", () => {
    const createPermissionTitle: string =
      PermissionHelper.getAllPermissionProps().find(
        (props: PermissionProps): boolean => {
          return props.permission === Permission.CreateProjectCallSMSConfig;
        },
      )?.title || "";

    expect(createPermissionTitle).toBe("Create Call and SMS");
    expect(WHO_MAY_ADD_A_PROJECT_TWILIO_ACCOUNT).toBe(
      `a project owner, a project admin or someone with ${createPermissionTitle}`,
    );
  });
});
