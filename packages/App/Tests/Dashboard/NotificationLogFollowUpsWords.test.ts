import {
  LOCALES_DIRECTORY,
  TRANSLATED_LOCALES,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import {
  ExtractedString,
  SOURCE_ROOTS,
  scanSourceRoots,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import { getDefaultContext } from "../../FeatureSet/Dashboard/scripts/i18n/I18n";
import { TWILIO_ERROR_CODE_LINK_TITLE } from "../../FeatureSet/Dashboard/src/Components/NotificationLogs/SmsErrorCode";
import { TWILIO_ERROR_CODE_MEANINGS } from "Common/Types/CallAndSMS/TwilioErrorCode";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE WORDS THE NOTIFICATION LOGS' FOLLOW-UPS ADDED, IN EVERY LANGUAGE
 * (#11416, #11417).
 *
 * The line under each Twilio error code the SMS log explains, the link's
 * name, and the On-Call Logs card's description are keys of every language
 * the Dashboard ships: worded, never left in English, each keeping what it
 * must keep as written - the {{code}} it is filled with, Twilio's name, the
 * STOP a person replies, the A2P 10DLC registration - and the Dashboard's
 * extractor finds each where it is drawn, so a word added later is worded
 * with it, or fails here.
 */

const CONTEXT: ReturnType<typeof getDefaultContext> = getDefaultContext();

const STRINGS: Array<ExtractedString> = scanSourceRoots(
  SOURCE_ROOTS,
  CONTEXT.repositoryRoot,
).strings;

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIRECTORY, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

const ON_CALL_LOG_DESCRIPTION: string =
  "Each notification sent to you, how it was sent and what became of it. If one failed, its status message says why.";

const KEYS: ReadonlyArray<string> = [
  ...Object.values(TWILIO_ERROR_CODE_MEANINGS),
  TWILIO_ERROR_CODE_LINK_TITLE,
  ON_CALL_LOG_DESCRIPTION,
];

// What each key keeps exactly as the English writes it.
function keptAsWritten(key: string): Array<string> {
  return ["{{code}}", "Twilio", "STOP", "A2P 10DLC", "HTTP"].filter(
    (kept: string): boolean => {
      return key.includes(kept);
    },
  );
}

describe("the new words", () => {
  test("are found where they are drawn, each from the file that marks it", () => {
    const found: Map<string, Set<string>> = new Map<string, Set<string>>();

    for (const entry of STRINGS) {
      if (KEYS.includes(entry.text)) {
        const files: Set<string> = found.get(entry.text) || new Set<string>();
        files.add(entry.file);
        found.set(entry.text, files);
      }
    }

    for (const meaning of Object.values(TWILIO_ERROR_CODE_MEANINGS)) {
      expect({ meaning, files: [...(found.get(meaning) || [])] }).toEqual({
        meaning,
        files: ["packages/Common/Types/CallAndSMS/TwilioErrorCode.ts"],
      });
    }

    expect([...(found.get(TWILIO_ERROR_CODE_LINK_TITLE) || [])]).toEqual([
      "packages/App/FeatureSet/Dashboard/src/Components/NotificationLogs/SmsErrorCode.tsx",
    ]);
    expect([...(found.get(ON_CALL_LOG_DESCRIPTION) || [])]).toEqual([
      "packages/App/FeatureSet/Dashboard/src/Pages/UserSettings/OnCallLogsTimeline.tsx",
    ]);
  });

  test("are keys of the English locale, each its own English", () => {
    const english: Record<string, string> = readLocale("en");

    for (const key of KEYS) {
      expect({ key, english: english[key] }).toEqual({ key, english: key });
    }
  });

  test("the On-Call Logs card no longer says it shows whether a notification was delivered", () => {
    const page: string = fs.readFileSync(
      path.join(
        CONTEXT.repositoryRoot,
        "packages/App/FeatureSet/Dashboard/src/Pages/UserSettings/OnCallLogsTimeline.tsx",
      ),
      "utf8",
    );

    expect(page).toContain(ON_CALL_LOG_DESCRIPTION);
    expect(page).not.toContain("whether it was delivered");
  });

  test.each(TRANSLATED_LOCALES)(
    "%s words every one of them, keeping what is kept as written",
    (language: string) => {
      const locale: Record<string, string> = readLocale(language);

      for (const key of KEYS) {
        const value: string | undefined = locale[key];

        expect({
          key,
          isWorded: typeof value === "string" && value.trim() !== "",
        }).toEqual({ key, isWorded: true });
        expect({ key, isEnglish: value === key }).toEqual({
          key,
          isEnglish: false,
        });

        for (const kept of keptAsWritten(key)) {
          expect({ key, kept, isKept: value!.includes(kept) }).toEqual({
            key,
            kept,
            isKept: true,
          });
        }

        // A filled-in value appears once, as the English has it.
        expect({
          key,
          codes: (value!.match(/\{\{code\}\}/g) || []).length,
        }).toEqual({
          key,
          codes: (key.match(/\{\{code\}\}/g) || []).length,
        });
      }
    },
  );

  test.each(TRANSLATED_LOCALES)(
    "%s says no two codes alike",
    (language: string) => {
      const locale: Record<string, string> = readLocale(language);
      const meanings: Array<string> = Object.values(
        TWILIO_ERROR_CODE_MEANINGS,
      ).map((meaning: string): string => {
        return locale[meaning] || "";
      });

      expect(new Set(meanings).size).toBe(meanings.length);
    },
  );
});
