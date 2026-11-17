import TwilioConfigDefaultCopy, {
  getSetDefaultTitle,
} from "../../FeatureSet/Dashboard/src/Components/CallSMS/TwilioConfigDefaultCopy";
import {
  getIncomingCallNumberNoTwilioAccountMessage,
  getNoTwilioAccountMessage,
  PROJECT_TWILIO_SETTINGS_PAGE,
  SET_AS_PROJECT_DEFAULT_FOR,
  TwilioMessageKind,
} from "Common/Utils/Project/TwilioAccount";
import { TwilioConfigUse } from "Common/Types/CallAndSMS/TwilioConfigUse";
import { PROJECT_NOTIFICATION_CHANNEL_SETTINGS_PAGE } from "Common/Utils/Project/NotificationChannels";
import { describe, expect, test } from "@jest/globals";

/*
 * THE ROW ACTION A "NO TWILIO ACCOUNT" MESSAGE NAMES IS THE ONE THE TWILIO
 * CONFIG TABLE OFFERS (#6603).
 *
 * When the project's default config is used for SMS only and a call has to
 * go out - or the other way round - with no account of the server's to
 * send it, the message's log, and a person verifying their number, are
 * told what most such projects need: a config used for calls only made the
 * project default for calls, with "Set as Project Default for Calls" in its
 * row's menu (Utils/Project/TwilioAccount). The Twilio Config table names
 * that action so on such a config: one that would take only the calls
 * (TwilioConfigDefaultCopy.getSetDefaultTitle). The same for SMS.
 *
 * The messages are English, as the server writes them in a log; the table
 * draws its English keys, which a test of each locale holds.
 */

// A config of the project, as the table reads its row, that is no default yet.
function notADefault(usedFor: TwilioConfigUse): {
  usedFor: TwilioConfigUse;
  isProjectDefault: boolean;
  isProjectDefaultForSms: boolean;
  isProjectDefaultForCalls: boolean;
} {
  return {
    usedFor: usedFor,
    isProjectDefault: false,
    isProjectDefaultForSms: false,
    isProjectDefaultForCalls: false,
  };
}

describe("the actions the messages name", () => {
  test("are the table's own words, for SMS and for calls", () => {
    expect(SET_AS_PROJECT_DEFAULT_FOR[TwilioMessageKind.SMS]).toBe(
      TwilioConfigDefaultCopy.setSmsDefaultTitle,
    );
    expect(SET_AS_PROJECT_DEFAULT_FOR[TwilioMessageKind.Call]).toBe(
      TwilioConfigDefaultCopy.setCallsDefaultTitle,
    );
  });

  test("are offered on the config each message points at: one used for that kind only, that is no default yet", () => {
    expect(getSetDefaultTitle(notADefault(TwilioConfigUse.CallsOnly))).toBe(
      SET_AS_PROJECT_DEFAULT_FOR[TwilioMessageKind.Call],
    );
    expect(getSetDefaultTitle(notADefault(TwilioConfigUse.SmsOnly))).toBe(
      SET_AS_PROJECT_DEFAULT_FOR[TwilioMessageKind.SMS],
    );
  });

  test("are where the message says: the page the Twilio Config card is on", () => {
    expect(PROJECT_TWILIO_SETTINGS_PAGE).toBe(
      PROJECT_NOTIFICATION_CHANNEL_SETTINGS_PAGE,
    );
  });
});

describe("each message names the action for the kind it could not send", () => {
  test.each([
    [
      "a call, the default used for SMS only",
      getNoTwilioAccountMessage(TwilioMessageKind.Call, {
        projectConfigUse: TwilioConfigUse.SmsOnly,
      }),
      TwilioMessageKind.Call,
    ],
    [
      "an SMS, the default used for calls only",
      getNoTwilioAccountMessage(TwilioMessageKind.SMS, {
        projectConfigUse: TwilioConfigUse.CallsOnly,
      }),
      TwilioMessageKind.SMS,
    ],
    [
      "a number for incoming calls - verified by SMS - the default used for calls only",
      getIncomingCallNumberNoTwilioAccountMessage({
        projectConfigUse: TwilioConfigUse.CallsOnly,
      }),
      TwilioMessageKind.SMS,
    ],
  ])("%s", (_name: string, message: string, kind: TwilioMessageKind) => {
    const other: TwilioMessageKind =
      kind === TwilioMessageKind.SMS
        ? TwilioMessageKind.Call
        : TwilioMessageKind.SMS;

    expect(message).toContain(
      `(${SET_AS_PROJECT_DEFAULT_FOR[kind]} in its row's menu)`,
    );
    expect(message).not.toContain(SET_AS_PROJECT_DEFAULT_FOR[other]);
    expect(message).toContain("This project's default Twilio config");
    expect(message).toContain(`in ${PROJECT_TWILIO_SETTINGS_PAGE}.`);
  });

  test("a status page's own config names none: a project default would not change what the page sends", () => {
    const message: string = getNoTwilioAccountMessage(TwilioMessageKind.SMS, {
      projectConfigUse: TwilioConfigUse.CallsOnly,
      isStatusPageConfig: true,
    });

    for (const kind of [TwilioMessageKind.SMS, TwilioMessageKind.Call]) {
      expect(message).not.toContain(SET_AS_PROJECT_DEFAULT_FOR[kind]);
    }

    expect(message).toContain("This status page's Twilio config");
  });
});
