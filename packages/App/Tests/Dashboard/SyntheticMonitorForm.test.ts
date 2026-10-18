import SyntheticMonitorCopy from "../../FeatureSet/Dashboard/src/Utils/Form/Monitor/SyntheticMonitorCopy";
import {
  SYNTHETIC_MONITOR_BROWSER_REQUIRED_MESSAGE,
  SYNTHETIC_MONITOR_SCREEN_SIZE_REQUIRED_MESSAGE,
} from "Common/Types/Monitor/MonitorStep";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Synthetic and Custom Code monitor forms say plainly what each field
 * does, and a new Synthetic monitor starts in Chromium at a desktop size
 * (Common/Tests/Types/Monitor/MonitorStepSyntheticDefaults holds the
 * defaults and the rule that refuses a step that would run nothing).
 *
 * These hold the form to the words, the words to the rule's messages, and
 * both to their translations: the rule lives in Common/Types, where the
 * extractor does not read, so the Dashboard carries the same sentences as
 * keys (SyntheticMonitorCopy) and the alert that shows them translates them.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const OTHER_LOCALES: Array<string> = [
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
];

const STEP_FORM: string = fs.readFileSync(
  path.join(DASHBOARD_SRC, "Components", "Form", "Monitor", "MonitorStep.tsx"),
  "utf8",
);

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const WORDS: Array<string> = Object.values(SyntheticMonitorCopy);

// What the form said before: questions, a jargon phrase, and a field's own name.
const RETIRED_WORDS: Array<string> = [
  "Select the browser type.",
  "Which screen type should we use to run this test?",
  "How many times should we retry the synthetic monitor if it fails? Set to 0 for no retries. Max is 5.",
  "Write browser automation for Chromium and Firefox using OneUptime's secure Playwright-compatible facade. See the OneUptime docs below.",
  "Write your JavaScript code here. You can use secrets for sensitive data.",
];

describe("the refusal says what to pick, in every language", () => {
  test("the Dashboard's keys are the rule's own messages", () => {
    expect(SyntheticMonitorCopy.browserRequired).toBe(
      SYNTHETIC_MONITOR_BROWSER_REQUIRED_MESSAGE,
    );
    expect(SyntheticMonitorCopy.screenSizeRequired).toBe(
      SYNTHETIC_MONITOR_SCREEN_SIZE_REQUIRED_MESSAGE,
    );
  });

  test("en.json carries every word as itself", () => {
    const en: Record<string, unknown> = readLocale("en");

    for (const word of WORDS) {
      expect(en[word]).toBe(word);
    }
  });

  test.each(OTHER_LOCALES)(
    "%s.json translates every word",
    (locale: string) => {
      const json: Record<string, unknown> = readLocale(locale);

      for (const word of WORDS) {
        expect(typeof json[word]).toBe("string");
        expect(json[word]).not.toBe(word);
      }
    },
  );
});

describe("the form", () => {
  test("says what each Synthetic field does, from the copy", () => {
    expect(STEP_FORM).toContain(
      "description={SyntheticMonitorCopy.browserTypeDescription}",
    );
    expect(STEP_FORM).toContain(
      "description={SyntheticMonitorCopy.screenTypeDescription}",
    );
    expect(STEP_FORM).toContain(
      "description={SyntheticMonitorCopy.retryCountOnErrorDescription}",
    );
    expect(STEP_FORM).toContain(
      "SyntheticMonitorCopy.playwrightCodeDescription",
    );
    expect(STEP_FORM).toContain(
      "SyntheticMonitorCopy.javaScriptCodeDescription",
    );
  });

  test("keeps the titles the docs name", () => {
    for (const title of [
      "Browser Type",
      "Screen Type",
      "Retry Count on Error",
    ]) {
      expect(STEP_FORM).toContain(`title={"${title}"}`);
    }
  });

  test.each(RETIRED_WORDS)("no longer says %p", (word: string) => {
    expect(STEP_FORM).not.toContain(word);
  });

  test("every line is one short sentence", () => {
    for (const word of WORDS) {
      expect(word.length).toBeLessThanOrEqual(90);
    }
  });
});
