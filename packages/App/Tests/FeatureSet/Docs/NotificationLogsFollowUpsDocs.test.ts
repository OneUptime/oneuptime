import {
  TWILIO_ERROR_CODE_MEANINGS,
  getTwilioErrorCodeUrl,
} from "Common/Types/CallAndSMS/TwilioErrorCode";
import { DOCS_LANGUAGES, readPage } from "./DocsContentSupport";
import { dashboardLabel, drawnLabelOnPage } from "./DocsDashboardLabels";
import { LOCALES_DIRECTORY } from "../../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE DOCS THE NOTIFICATION LOGS' FOLLOW-UPS CHANGED (#11416, #11417,
 * #11418), in every docs language.
 *
 *   - Notifications > Notification Logs says that Who Was Told and a test
 *     page's result draw each message's status as its log does (#11416);
 *   - it lists the Twilio error codes the SMS log explains, each with the
 *     line the log says under it - in each language the very words the
 *     Dashboard says, from its locale (#11417);
 *   - Project Settings names the Notification Logs' Call and Push tabs as
 *     the Dashboard now draws them: a phone call and a push notification,
 *     never the function call Chinese, Korean and Russian read (#11418).
 *
 * Markdown is not compiled, so these are what notices when the pages and the
 * Dashboard part ways.
 */

const NOTIFICATION_LOGS: string = "notifications/notification-logs";
const PROJECT_SETTINGS: string = "configuration/project-settings";

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIRECTORY, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

// The page's lines under its "### Error codes" heading (in any language), up to the next heading.
function errorCodeSection(language: string): Array<string> {
  const lines: Array<string> = readPage(language, NOTIFICATION_LOGS).split(
    "\n",
  );
  const english: Array<string> = readPage("en", NOTIFICATION_LOGS).split("\n");
  const start: number = english.indexOf("### Error codes");

  expect(start).toBeGreaterThan(-1);
  // A translation keeps the English page's lines, line for line.
  expect(lines[start]?.startsWith("### ")).toBe(true);

  const end: number = lines.findIndex((line: string, index: number) => {
    return index > start && line.startsWith("#");
  });

  return lines.slice(start + 1, end === -1 ? undefined : end);
}

// The table's rows under the heading: [code, what it means].
function errorCodeRows(language: string): Array<[string, string]> {
  return errorCodeSection(language)
    .map((line: string): [string, string] | null => {
      const match: RegExpMatchArray | null = line.match(
        /^\| `(\d+)` \| (.+) \|$/,
      );

      return match ? [match[1]!, match[2]!.trim()] : null;
    })
    .filter((row: [string, string] | null): row is [string, string] => {
      return row !== null;
    });
}

describe("the English Notification Logs page", () => {
  const PAGE: string = readPage("en", NOTIFICATION_LOGS);

  test("says Who Was Told and a test page's result draw each message's status as its log does (#11416)", () => {
    expect(PAGE).toContain(
      "**Who Was Told**, on an incident's or an alert's overview, and a test page's result show each message's status the same way, in the same colours: a call that is still ringing reads **Calling** there too, never **Sent**.",
    );
  });

  test("lists every code the SMS log explains, in its order, with the very line the log says (#11417)", () => {
    expect(errorCodeRows("en")).toEqual(
      Object.entries(TWILIO_ERROR_CODE_MEANINGS),
    );
  });

  test("says each code opens Twilio's page for it, and that a code that is not Twilio's is shown as it is", () => {
    const section: string = errorCodeSection("en").join("\n");

    expect(section).toContain(
      "Each code under **Error Code** opens Twilio's page for it, which lists what can cause it.",
    );
    expect(section).toContain(
      "A code that is not Twilio's, such as the HTTP status your SMS and call gateway answered, is shown as it is.",
    );
    // The page's own address for each, as the log links it.
    expect(getTwilioErrorCodeUrl("30003")).toBe(
      "https://www.twilio.com/docs/api/errors/30003",
    );
  });

  test("the SMS table's Undelivered row points at Error Code, whose codes the section lists", () => {
    expect(PAGE).toContain(
      "| **Undelivered** | The carrier could not deliver it. **Error Code** says why, and what the code means. |",
    );
  });
});

describe.each(
  DOCS_LANGUAGES.filter((language: string): boolean => {
    return language !== "en";
  }),
)("%s", (language: string) => {
  const locale: Record<string, string> = readLocale(language);

  test("the Notification Logs page lists the error codes in the English page's order, each in the Dashboard's own words", () => {
    expect(errorCodeRows(language)).toEqual(
      Object.entries(TWILIO_ERROR_CODE_MEANINGS).map(
        ([code, meaning]: [string, string]): [string, string] => {
          return [code, locale[meaning]!];
        },
      ),
    );

    // Worded, never the English line.
    for (const [code, meaning] of errorCodeRows(language)) {
      expect({
        code,
        isEnglish: meaning === TWILIO_ERROR_CODE_MEANINGS[code],
      }).toEqual({ code, isEnglish: false });
    }
  });

  test("it names Error Code, Who Was Told, Calling and Sent as this language's Dashboard draws them", () => {
    const page: string = readPage(language, NOTIFICATION_LOGS);

    for (const label of ["Error Code", "Who Was Told", "Calling", "Sent"]) {
      expect({
        label,
        named: page.includes(`**${dashboardLabel(language, label)}**`),
      }).toEqual({ label, named: true });
    }
  });

  test("Project Settings names the Call and Push tabs as the Dashboard draws them: a phone call and a push notification", () => {
    const line: string | undefined = readPage(language, PROJECT_SETTINGS)
      .split("\n")
      .find((candidate: string): boolean => {
        return candidate.includes("(/docs/notifications/notification-logs)");
      });

    expect(line).toBeDefined();

    const call: string = drawnLabelOnPage(language, PROJECT_SETTINGS, "Call");
    const push: string = drawnLabelOnPage(language, PROJECT_SETTINGS, "Push");

    expect(call).toBe(locale["Call (phone call)"]);
    expect(push).toBe(locale["Push (push notification)"]);
    expect(line).toContain(`**${call}**`);
    expect(line).toContain(`**${push}**`);
  });
});

describe("the tab's word, where it was not a phone call", () => {
  /*
   * The word each language's docs named the Call tab by - the function call
   * or call-out the Dashboard drew - and the phone call it names now.
   */
  const NAMED: Readonly<Record<string, { was: string; is: string }>> = {
    "zh-CN": { was: "调用", is: "电话" },
    ko: { was: "호출", is: "전화" },
    ru: { was: "Вызов", is: "Звонок" },
    da: { was: "Kald", is: "Opkald" },
    sv: { was: "Anrop", is: "Samtal" },
    "zh-TW": { was: "呼叫", is: "電話" },
  };

  test.each(Object.entries(NAMED))(
    "%s's Project Settings page names the Call tab a phone call",
    (language: string, words: { was: string; is: string }) => {
      const line: string = readPage(language, PROJECT_SETTINGS)
        .split("\n")
        .find((candidate: string): boolean => {
          return candidate.includes("(/docs/notifications/notification-logs)");
        })!;

      expect(line).toContain(`**${words.is}**`);
      expect(line).not.toContain(`**${words.was}**`);
    },
  );
});
