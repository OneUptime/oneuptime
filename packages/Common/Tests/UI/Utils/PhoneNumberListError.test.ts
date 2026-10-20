import TwilioPhoneNumbers from "../../../Types/CallAndSMS/TwilioPhoneNumbers";
import {
  PHONE_NUMBER_LIST_ERROR,
  getPhoneNumberListError,
} from "../../../UI/Utils/PhoneNumberListError";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import i18next from "i18next";
import path from "path";

/*
 * WHAT A FORM SAYS UNDER A LIST OF PHONE NUMBERS THAT HOLDS SOMETHING ELSE.
 *
 * A Twilio config's secondary numbers and its SMS numbers are typed as one
 * list, in a project's Twilio Config form and in the Admin Dashboard's Call
 * and SMS settings. The server refuses a list with an entry that is not a
 * phone number (TwilioPhoneNumbers); the forms refuse it first, under the
 * field, by the same rule - and in the reader's language, naming the entry
 * as it was typed.
 */

const LOCALES: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

function locale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

describe("getPhoneNumberListError", () => {
  test("says nothing of a good list, an empty one, or a value that is not text", () => {
    expect(getPhoneNumberListError("+447700900123, +46701234567")).toBe(null);
    expect(getPhoneNumberListError("+447700900123;+46701234567\n")).toBe(
      null,
    );
    expect(getPhoneNumberListError("")).toBe(null);
    expect(getPhoneNumberListError(" , ")).toBe(null);
    expect(getPhoneNumberListError(undefined)).toBe(null);
    expect(getPhoneNumberListError(null)).toBe(null);
    expect(getPhoneNumberListError(6581234567)).toBe(null);
  });

  test("names the first entry that is not a phone number, in English before any language is set up", () => {
    expect(getPhoneNumberListError("+447700900123, +65 8123 4567, x")).toBe(
      '"+65 8123 4567" is not a phone number. Write each number with its country code and separate them with commas, like +6581234567, +447700900123.',
    );
  });

  test("refuses exactly the lists the server refuses", () => {
    for (const list of [
      "+447700900123",
      "+447700900123,",
      "abc",
      "+44 7700 900123",
      "+447700900123, 12",
      "  +46701234567 ; +6581234567 ",
    ]) {
      expect({
        list,
        refused: getPhoneNumberListError(list) !== null,
      }).toEqual({
        list,
        refused: TwilioPhoneNumbers.getListError(list) !== null,
      });
    }
  });

  test("is a Dashboard key that keeps its placeholder in every language", () => {
    const english: Record<string, string> = locale("en");

    expect(english[PHONE_NUMBER_LIST_ERROR]).toBe(PHONE_NUMBER_LIST_ERROR);

    for (const language of [
      "de",
      "fr",
      "es",
      "it",
      "pt",
      "nl",
      "da",
      "no",
      "sv",
      "ru",
      "ja",
      "ko",
      "zh-CN",
      "zh-TW",
      "hi",
      "fa",
    ]) {
      const translated: string | undefined =
        locale(language)[PHONE_NUMBER_LIST_ERROR];

      expect({ language, translated: translated !== undefined }).toEqual({
        language,
        translated: true,
      });
      expect(translated).not.toBe(PHONE_NUMBER_LIST_ERROR);
      expect(translated).toContain("{{entry}}");
      // The example list is the one to copy, in every language.
      expect(translated).toContain("+6581234567");
    }
  });

  test("says it in the reader's language once the Dashboard's is set up", async () => {
    await i18next.init({
      lng: "de",
      fallbackLng: "en",
      resources: {
        en: { translation: locale("en") },
        de: { translation: locale("de") },
      },
      interpolation: { escapeValue: false },
    });

    expect(getPhoneNumberListError("+447700900123, Büro")).toBe(
      '"Büro" ist keine Telefonnummer. Geben Sie jede Nummer mit Landesvorwahl ein und trennen Sie die Nummern durch Kommas, etwa +6581234567, +447700900123.',
    );
  });
});
