import { describe, expect, test } from "@jest/globals";
import { createTranslator, Translator } from "../../../Types/Translator";
import {
  getSyntheticScreenshotCaption,
  getTimedOutPageScreenshotName,
  readTimedOutPageScreenshotName,
  TIMED_OUT_NUMBERED_PAGE_SCREENSHOT_CAPTION,
  TIMED_OUT_PAGE_SCREENSHOT_CAPTION,
  TIMED_OUT_PAGE_SCREENSHOT_NAME,
} from "../../../Utils/Monitor/SyntheticTimedOutPageScreenshot";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * The screenshots a probe takes of the pages a synthetic script left open
 * when it ran out of time: the probe stores each under a name written
 * here, and a monitor's summary reads the name back and draws it in the
 * reader's words. A name the script gave its own screenshot is never
 * mistaken for one of them.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");

describe("the names the probe stores a timed-out page's screenshot under", () => {
  test("the first open page is timed-out-page, as an incident's description names it", () => {
    expect(TIMED_OUT_PAGE_SCREENSHOT_NAME).toBe("timed-out-page");
    expect(getTimedOutPageScreenshotName(1)).toBe("timed-out-page");
  });

  test("the pages after it are numbered from 2, in the order they were opened", () => {
    expect(getTimedOutPageScreenshotName(2)).toBe("timed-out-page-2");
    expect(getTimedOutPageScreenshotName(3)).toBe("timed-out-page-3");
    expect(getTimedOutPageScreenshotName(8)).toBe("timed-out-page-8");
    expect(getTimedOutPageScreenshotName(10)).toBe("timed-out-page-10");
  });

  test("names only whole page numbers from 1", () => {
    for (const pageNumber of [0, -1, 1.5, Number.NaN, Infinity]) {
      expect(() => {
        return getTimedOutPageScreenshotName(pageNumber);
      }).toThrow("must be a whole number from 1");
    }
  });

  test("a name the script could use in a template: no spaces, no dots, no brackets", () => {
    for (let pageNumber: number = 1; pageNumber <= 20; pageNumber++) {
      expect(getTimedOutPageScreenshotName(pageNumber)).toMatch(/^[a-z0-9-]+$/);
    }
  });
});

describe("reading a stored screenshot name back", () => {
  test("every name the probe writes reads back as its page's number", () => {
    for (let pageNumber: number = 1; pageNumber <= 1000; pageNumber++) {
      expect(
        readTimedOutPageScreenshotName(
          getTimedOutPageScreenshotName(pageNumber),
        ),
      ).toBe(pageNumber);
    }
  });

  test("a script's own names are not the probe's", () => {
    for (const name of [
      "login-page",
      "Dashboard",
      "Failed step",
      "screenshot",
      "",
      "Page when the script timed out",
      "Page 2 when the script timed out",
    ]) {
      expect(readTimedOutPageScreenshotName(name)).toBeNull();
    }
  });

  test("a name close to the probe's but not the same stays as written", () => {
    for (const name of [
      // The probe never numbers the first page.
      "timed-out-page-1",
      "timed-out-page-0",
      "timed-out-page-02",
      // How a name the script already used is kept apart.
      "timed-out-page (2)",
      "Timed-Out-Page",
      "TIMED-OUT-PAGE",
      " timed-out-page",
      "timed-out-page ",
      "timed-out-page-",
      "timed-out-page--2",
      "timed-out-page-2a",
      "timed-out-page-2.5",
      "timed-out-page-+2",
      "timed-out-page- 2",
      "timed-out-pages",
      "timed-out-page2",
      "my-timed-out-page",
      // Digits another script writes are not the probe's.
      "timed-out-page-\u{0662}",
      "timed-out-page-\u{06F2}",
      // Longer than any count of pages a run could open.
      "timed-out-page-10000",
    ]) {
      expect(readTimedOutPageScreenshotName(name)).toBeNull();
    }
  });

  test("anything that is not a name reads as no page", () => {
    expect(readTimedOutPageScreenshotName(undefined)).toBeNull();
    expect(readTimedOutPageScreenshotName(null)).toBeNull();
  });

  test("reads a long name in no time", () => {
    const longName: string = `timed-out-page-${"9".repeat(500_000)}`;
    const startedAt: number = Date.now();

    expect(readTimedOutPageScreenshotName(longName)).toBeNull();
    expect(Date.now() - startedAt).toBeLessThan(500);
  });
});

describe("a screenshot's caption on a monitor's summary", () => {
  test("the probe's screenshot of the only or first page reads as words, in English", () => {
    expect(
      getSyntheticScreenshotCaption({
        translator: ENGLISH,
        screenshotName: "timed-out-page",
      }),
    ).toBe("Page when the script timed out");
  });

  test("a numbered page reads with its number", () => {
    expect(
      getSyntheticScreenshotCaption({
        translator: ENGLISH,
        screenshotName: "timed-out-page-2",
      }),
    ).toBe("Page 2 when the script timed out");
    expect(
      getSyntheticScreenshotCaption({
        translator: ENGLISH,
        screenshotName: "timed-out-page-12",
      }),
    ).toBe("Page 12 when the script timed out");
  });

  test("a name the script gave its screenshot is drawn as written", () => {
    for (const name of [
      "login-page",
      "Checkout step 2",
      "timed-out-page (2)",
      "timed-out-page-1",
      // Never filled in as if it were a sentence of OneUptime's.
      "Page {{number}} when the script timed out",
      "{{monitorName}}",
    ]) {
      expect(
        getSyntheticScreenshotCaption({
          translator: ENGLISH,
          screenshotName: name,
        }),
      ).toBe(name);
      expect(
        getSyntheticScreenshotCaption({
          translator: dashboardTranslator("de"),
          screenshotName: name,
        }),
      ).toBe(name);
    }
  });

  test("reads in the reader's language", () => {
    const german: Translator = dashboardTranslator("de");

    expect(
      getSyntheticScreenshotCaption({
        translator: german,
        screenshotName: "timed-out-page",
      }),
    ).toBe("Seite, als das Skript das Zeitlimit überschritt");
    expect(
      getSyntheticScreenshotCaption({
        translator: german,
        screenshotName: "timed-out-page-3",
      }),
    ).toBe("Seite 3, als das Skript das Zeitlimit überschritt");
  });

  test("writes the page's number in the reader's digits", () => {
    expect(
      getSyntheticScreenshotCaption({
        translator: dashboardTranslator("fa"),
        screenshotName: "timed-out-page-2",
      }),
    ).toBe("صفحه ۲ هنگام تمام شدن مهلت اسکریپت");
    // Arabic writes Latin digits in OneUptime.
    expect(
      getSyntheticScreenshotCaption({
        translator: dashboardTranslator("ar"),
        screenshotName: "timed-out-page-2",
      }),
    ).toBe("الصفحة 2 عند انتهاء مهلة البرنامج النصي");
  });

  test("falls back to the English caption when the reader's language has none", () => {
    const silent: Translator = createTranslator((): undefined => {
      return undefined;
    }, "de");

    expect(
      getSyntheticScreenshotCaption({
        translator: silent,
        screenshotName: "timed-out-page",
      }),
    ).toBe("Page when the script timed out");
    expect(
      getSyntheticScreenshotCaption({
        translator: silent,
        screenshotName: "timed-out-page-4",
      }),
    ).toBe("Page 4 when the script timed out");
  });
});

describe("the captions are the Dashboard's words", () => {
  test("both captions are keys of the Dashboard's English locale, as npm run i18n:extract found them", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    expect(english[TIMED_OUT_PAGE_SCREENSHOT_CAPTION]).toBe(
      "Page when the script timed out",
    );
    expect(english[TIMED_OUT_NUMBERED_PAGE_SCREENSHOT_CAPTION]).toBe(
      "Page {{number}} when the script timed out",
    );
  });

  test("every Dashboard language words both captions, the number where its grammar puts it", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      if (language === "en") {
        continue;
      }

      const words: Record<string, string> = readDashboardLocale(language);
      const one: string | undefined = words[TIMED_OUT_PAGE_SCREENSHOT_CAPTION];
      const numbered: string | undefined =
        words[TIMED_OUT_NUMBERED_PAGE_SCREENSHOT_CAPTION];

      expect({
        language,
        worded: one !== TIMED_OUT_PAGE_SCREENSHOT_CAPTION,
      }).toEqual({ language, worded: true });
      expect({
        language,
        worded: numbered !== TIMED_OUT_NUMBERED_PAGE_SCREENSHOT_CAPTION,
      }).toEqual({ language, worded: true });
      expect({
        language,
        placeholders: numbered?.match(/\{\{[^}]+\}\}/g) || [],
      }).toEqual({ language, placeholders: ["{{number}}"] });
      expect({
        language,
        placeholders: one?.match(/\{\{[^}]+\}\}/g) || [],
      }).toEqual({ language, placeholders: [] });

      const reader: Translator = dashboardTranslator(language);
      const caption: string = getSyntheticScreenshotCaption({
        translator: reader,
        screenshotName: "timed-out-page-7",
      });

      expect(caption).toContain(reader.formatNumber(7));
      expect(caption).not.toContain("{{");
    }
  });
});
