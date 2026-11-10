import { getCallStatusPill } from "../../FeatureSet/Dashboard/src/Components/NotificationLogs/CallStatusPill";
import {
  NOT_ANSWERED_STATUS_LABEL,
  withNotAnsweredStatusLabel,
} from "../../FeatureSet/Dashboard/src/Components/OnCallPolicy/NotAnsweredStatus";
import {
  LOCALES_DIRECTORY,
  TRANSLATED_LOCALES,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import { Green, Red, Yellow } from "Common/Types/BrandColors";
import CallStatus from "Common/Types/Call/CallStatus";
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
 */

function readLocale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIRECTORY, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

describe("a call's status in the call logs", () => {
  test("placed: green", () => {
    expect(getCallStatusPill(CallStatus.Success)).toEqual({
      color: Green,
      text: "Success",
    });
  });

  test("rang out: a missed call, in yellow, in the words the other call lists use", () => {
    expect(getCallStatusPill(CallStatus.MissedCall)).toEqual({
      color: Yellow,
      text: "Missed call",
    });
  });

  test("busy - or declined: yellow", () => {
    expect(getCallStatusPill(CallStatus.Busy)).toEqual({
      color: Yellow,
      text: "Busy",
    });
  });

  test("could not be placed, or connected, or no balance: red, as before", () => {
    expect(getCallStatusPill(CallStatus.Error)).toEqual({
      color: Red,
      text: "Error",
    });
    expect(getCallStatusPill(CallStatus.LowBalance)).toEqual({
      color: Red,
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
