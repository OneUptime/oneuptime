import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import { act, cleanup, render, RenderResult } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import ExceptionRow from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionRow";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";

/*
 * AN EXCEPTION ROW'S SMALL PRINT, IN THE READER'S LANGUAGE - from the
 * Dashboard's shipped locale files.
 *
 * Under each exception the list says when it was first and last seen and
 * how often: "first 9d ago · last 17m ago · 412 events". Only Japanese
 * worded it, so a German or Persian reader met English under every row of
 * a list whose boxes, pills and Bulk Actions spoke their language. It is
 * worded in all 16 languages now, its numbers in the reader's digits.
 *
 * The Dashboard sets i18next up once, globally, with react-i18next; so does
 * this file. Each jest file has its own module registry.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = [
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

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const MINUTE_IN_MS: number = 60 * 1000;
const DAY_IN_MS: number = 24 * 60 * MINUTE_IN_MS;

function exceptionSeen(data: {
  firstSeenAgoInMs: number;
  lastSeenAgoInMs: number;
  count: number;
}): TelemetryException {
  const now: number = Date.now();
  const exception: TelemetryException = new TelemetryException();
  exception._id = "70000000-0000-4000-8000-000000000001";
  exception.exceptionType = "DeadlineExceededError";
  exception.message =
    "context deadline exceeded calling payments-worker /charge";
  exception.occuranceCount = data.count;
  exception.firstSeenAt = new Date(now - data.firstSeenAgoInMs);
  exception.lastSeenAt = new Date(now - data.lastSeenAgoInMs);

  return exception;
}

const WHITESPACE: RegExp = /\s+/g;
const ENGLISH_SMALL_PRINT: RegExp = /\b(first|last|ago|events)\b/;

// The row's small print, its parts joined as they read.
function smallPrint(view: RenderResult): string {
  return (view.container.textContent || "").replace(WHITESPACE, " ");
}

async function inLanguage(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {
    en: { translation: readLocale("en") },
  };

  for (const language of LANGUAGES) {
    resources[language] = { translation: readLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
  });
});

afterEach(async () => {
  cleanup();
  await inLanguage("en");
});

afterAll(() => {
  cleanup();
});

describe("an exception row's first seen, last seen and events", () => {
  test("read as before in English", () => {
    const view: RenderResult = render(
      <ExceptionRow
        exception={exceptionSeen({
          firstSeenAgoInMs: 9 * DAY_IN_MS,
          lastSeenAgoInMs: 17 * MINUTE_IN_MS,
          count: 412,
        })}
      />,
    );

    expect(smallPrint(view)).toContain("first 9d ago");
    expect(smallPrint(view)).toContain("last 17m ago");
    expect(smallPrint(view)).toContain("412 events");
  });

  test("read in German, a lone event in its one form", async () => {
    await inLanguage("de");

    const view: RenderResult = render(
      <ExceptionRow
        exception={exceptionSeen({
          firstSeenAgoInMs: 9 * DAY_IN_MS,
          lastSeenAgoInMs: 17 * MINUTE_IN_MS,
          count: 412,
        })}
      />,
    );

    expect(smallPrint(view)).toContain("erstmals vor 9 Tg.");
    expect(smallPrint(view)).toContain("zuletzt vor 17 Min.");
    expect(smallPrint(view)).toContain("412 Ereignisse");
    expect(smallPrint(view)).not.toMatch(ENGLISH_SMALL_PRINT);

    cleanup();

    const one: RenderResult = render(
      <ExceptionRow
        exception={exceptionSeen({
          firstSeenAgoInMs: 3 * 60 * MINUTE_IN_MS,
          lastSeenAgoInMs: 20 * 1000,
          count: 1,
        })}
      />,
    );

    expect(smallPrint(one)).toContain("erstmals vor 3 Std.");
    expect(smallPrint(one)).toContain("zuletzt vor 20 Sek.");
    expect(smallPrint(one)).toContain("1 Ereignis");
    expect(smallPrint(one)).not.toContain("Ereignisse");
  });

  test("read in Persian, every number in Persian digits", async () => {
    await inLanguage("fa");

    const view: RenderResult = render(
      <ExceptionRow
        exception={exceptionSeen({
          firstSeenAgoInMs: 9 * DAY_IN_MS,
          lastSeenAgoInMs: 17 * MINUTE_IN_MS,
          count: 412,
        })}
      />,
    );

    expect(smallPrint(view)).toContain("اولین بار ۹ روز پیش");
    expect(smallPrint(view)).toContain("آخرین بار ۱۷ دقیقه پیش");
    expect(smallPrint(view)).toContain("۴۱۲ رویداد");
  });

  test.each(LANGUAGES)(
    "is worded in %s: none of its four sentences or four times is left in English",
    (language: string) => {
      const english: Record<string, string> = readLocale("en");
      const words: Record<string, string> = readLocale(language);

      for (const key of [
        "first {{time}}",
        "last {{time}}",
        "{{number}} events",
        "{{count}}s ago",
        "{{count}}m ago",
        "{{count}}h ago",
        "{{count}}d ago",
      ]) {
        expect({ key, translated: words[key] !== english[key] }).toEqual({
          key,
          translated: true,
        });
        // Its placeholder kept, wherever the language puts it.
        const placeholder: string = key.includes("{{time}}")
          ? "{{time}}"
          : key.includes("{{number}}")
            ? "{{number}}"
            : "{{count}}";
        expect(words[key]).toContain(placeholder);
      }
    },
  );
});
