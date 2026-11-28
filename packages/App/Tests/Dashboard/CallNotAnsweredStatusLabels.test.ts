import {
  getNotificationLogStatusWords,
  NOTIFICATION_LOG_STATUS_TONES,
  NotificationLogKind,
  NotificationLogStatusWords,
} from "../../FeatureSet/Dashboard/src/Components/NotificationLogs/NotificationLogStatus";
import {
  NOT_ANSWERED_STATUS_LABEL,
  withNotAnsweredStatusLabel,
} from "../../FeatureSet/Dashboard/src/Components/OnCallPolicy/NotAnsweredStatus";
import {
  LOCALES_DIRECTORY,
  TRANSLATED_LOCALES,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import CallStatus from "Common/Types/Call/CallStatus";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A CALL THAT WAS NOT PICKED UP, AS THE DASHBOARD DRAWS IT (#6586).
 *
 * Twilio now says how each call ended. A call that rang out is logged
 * "Missed Call", one that found the line busy "Busy" - Project Settings >
 * Call Logs draws neither in red, as neither is a failure - and the
 * person's own on-call notification of it says "Not Answered", which User
 * Settings > On-Call Logs > Timeline draws, and offers in its filter, as
 * "Not answered": the words the Dashboard's other call lists use, already
 * in every language.
 *
 * An on-call call that voicemail answered (Twilio's answering machine
 * detection, #6594) is logged "Voicemail", in yellow too: it reached the
 * phone, and nobody picked up. A call still ringing is "Calling", in blue
 * (#11138): it is on its way, never a green Success before anybody picks up.
 */

function readLocale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIRECTORY, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

// A call log's pill: its word, and the tone it is drawn in.
function pillOf(status: CallStatus): { text: string; tone: PillTone } {
  const words: NotificationLogStatusWords | null =
    getNotificationLogStatusWords({
      kind: NotificationLogKind.Call,
      status: status,
    });

  return {
    text: words!.text,
    tone: NOTIFICATION_LOG_STATUS_TONES[words!.meaning],
  };
}

describe("a call's status in the call logs", () => {
  test("ringing: Calling, in blue - on its way, not yet green", () => {
    expect(pillOf(CallStatus.Calling)).toEqual({
      tone: PillTone.Info,
      text: "Calling",
    });
  });

  test("answered, or placed and never told more: green", () => {
    expect(pillOf(CallStatus.Success)).toEqual({
      tone: PillTone.Success,
      text: "Success",
    });
  });

  test("rang out: a missed call, in yellow, in the words the other call lists use", () => {
    expect(pillOf(CallStatus.MissedCall)).toEqual({
      tone: PillTone.Warning,
      text: "Missed call",
    });
  });

  test("busy - or declined: yellow", () => {
    expect(pillOf(CallStatus.Busy)).toEqual({
      tone: PillTone.Warning,
      text: "Busy",
    });
  });

  test("answered by voicemail: yellow, not red - it is no failure", () => {
    expect(pillOf(CallStatus.Voicemail)).toEqual({
      tone: PillTone.Warning,
      text: "Voicemail",
    });
  });

  test("could not be placed, or connected, or no balance: red, as before", () => {
    expect(pillOf(CallStatus.Error)).toEqual({
      tone: PillTone.Danger,
      text: "Error",
    });
    expect(pillOf(CallStatus.LowBalance)).toEqual({
      tone: PillTone.Danger,
      text: "Low Balance",
    });
  });
});

describe("a call not answered in the person's on-call timeline", () => {
  test("is labelled 'Not answered'", () => {
    expect(NOT_ANSWERED_STATUS_LABEL).toBe("Not answered");
  });

  test("the status filter offers the stored 'Not Answered' as 'Not answered', and every other status as it was", () => {
    const options: Array<DropdownOption> = Object.values(
      UserNotificationStatus,
    ).map((status: string): DropdownOption => {
      return { label: status, value: status };
    });

    const labelled: Array<DropdownOption> = withNotAnsweredStatusLabel(options);

    expect(labelled).toHaveLength(options.length);

    for (const option of labelled) {
      expect(option.label).toBe(
        option.value === UserNotificationStatus.NotAnswered
          ? "Not answered"
          : option.value,
      );
    }

    // The options handed in are not changed.
    expect(
      options.find((option: DropdownOption): boolean => {
        return option.value === UserNotificationStatus.NotAnswered;
      })?.label,
    ).toBe("Not Answered");
  });
});

describe("the words, in every language", () => {
  const WORDS: ReadonlyArray<string> = [
    "Missed call",
    "Busy",
    "Voicemail",
    NOT_ANSWERED_STATUS_LABEL,
  ];

  test("en.json maps each to itself", () => {
    const english: Record<string, unknown> = readLocale("en");

    for (const word of WORDS) {
      expect([word, english[word]]).toEqual([word, word]);
    }
  });

  test.each(TRANSLATED_LOCALES)(
    "%s has each, translated",
    (language: string) => {
      const locale: Record<string, unknown> = readLocale(language);

      for (const word of WORDS) {
        expect([word, typeof locale[word]]).toEqual([word, "string"]);
        expect(String(locale[word]).trim()).not.toBe("");
      }
    },
  );
});
