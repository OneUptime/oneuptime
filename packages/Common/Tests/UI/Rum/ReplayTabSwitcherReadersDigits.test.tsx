import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import ReplayTabSwitcher from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTabSwitcher";
import { ReplayTabSummary } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTabs";

/*
 * THE TAB SWITCHER'S NUMBERS IN THE READER'S DIGITS (#7098), drawn from the
 * Dashboard's shipped locale files.
 *
 * A Persian page counted the tabs in Persian digits ("۸ زبانه") while each
 * tab's name read "زبانه 2", its opening "باز شده در 2:14" and its error
 * count "3": a template value goes in exactly as it is given, and those
 * were given in Latin digits. Every figure the switcher writes - the
 * strip's names, each pill's tooltip, the picker's rows, their error and
 * frustration counts, and the Continue chip - is now in the digits the
 * reader's language writes: Persian's own, Latin in every other language
 * (Arabic too: OneUptime writes Arabic in Latin digits). The pages the
 * tabs were on are the end user's own text and keep their digits; the
 * fixture's pages have none, so a stray Latin digit is the product's.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const LATIN_DIGIT: RegExp = /[0-9]/;

const PERSIAN_DIGIT: RegExp = /[\u{06F0}-\u{06F9}]/u;

const ARABIC_INDIC_DIGIT: RegExp = /[\u{0660}-\u{0669}]/u;

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

async function readIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      LANGUAGES.map((language: string) => {
        return [language, { translation: readLocale(language) }];
      }),
    ),
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await readIn("en");
});

afterEach(() => {
  cleanup();
});

// Pages without a digit of their own.
const PAGES: ReadonlyArray<string> = [
  "/checkout",
  "/cart",
  "/account",
  "/search",
  "/orders",
  "/help",
  "/pricing",
  "/blog",
  "/careers",
  "/contact",
  "/status",
  "/login",
];

/*
 * Twelve tabs (two-digit names), the first two still open, the third the
 * one being watched; Tab 12 opened an hour in. Errors and frustration on
 * Tab 3 and Tab 12, so the picker draws its counts.
 */
function twelveTabs(): Array<ReplayTabSummary> {
  return PAGES.map((page: string, index: number): ReplayTabSummary => {
    const ordinal: number = index + 1;
    const openedAtMs: number = ordinal === 12 ? 3734000 : index * 67000;

    return {
      tabId: `tab-${ordinal}`,
      label: `Tab ${ordinal}`,
      ordinal: ordinal,
      durationMs: 30000 + index * 1000,
      openedAtMs: openedAtMs,
      closedAtMs: openedAtMs + 30000,
      hasFootage: true,
      isActive: ordinal === 3,
      status: ordinal <= 2 ? "open" : "closed",
      firstUrl: `https://app.acme.com${page}`,
      lastUrl: `https://app.acme.com${page}`,
      pageCount: 1,
      errorCount: ordinal === 3 ? 3 : ordinal === 12 ? 12 : 0,
      frustrationCount: ordinal === 3 ? 2 : ordinal === 12 ? 14 : 0,
    };
  });
}

function renderSwitcher(): void {
  const tabs: Array<ReplayTabSummary> = twelveTabs();

  render(
    <ReplayTabSwitcher
      tabs={tabs}
      onSwitchTab={() => {}}
      onContinueInTab={() => {}}
      continueInTab={tabs[11] as ReplayTabSummary}
      sessionDurationMs={3800000}
    />,
  );
}

/*
 * Every figure the switcher writes: what each pill, option, count and chip
 * reads, and every tooltip on them.
 */
function everyFigure(): Array<string> {
  fireEvent.click(screen.getByTestId("replay-tab-picker-button"));

  const switcher: HTMLElement = screen.getByTestId("replay-tab-switcher");
  const texts: Array<string> = [];

  for (const element of [
    switcher,
    ...Array.from(switcher.querySelectorAll<HTMLElement>("*")),
  ]) {
    const title: string | null = element.getAttribute("title");
    const label: string | null = element.getAttribute("aria-label");

    if (title && !title.startsWith("https://")) {
      texts.push(title);
    }

    if (label) {
      texts.push(label);
    }
  }

  for (const testId of [
    "replay-tab-summary",
    "replay-tab-pill",
    "replay-tab-picker-button",
    "replay-tab-group",
    "replay-tab-option",
    "replay-tab-option-errors",
    "replay-tab-option-frustrations",
    "replay-continue-in-tab",
  ]) {
    for (const element of screen.queryAllByTestId(testId)) {
      texts.push(element.textContent || "");
    }
  }

  return texts;
}

function textOf(testId: string, tabId: string): string {
  const element: HTMLElement | undefined = screen
    .getAllByTestId(testId)
    .find((candidate: HTMLElement): boolean => {
      return candidate.getAttribute("data-tab-id") === tabId;
    });

  expect(element).toBeDefined();

  return (element as HTMLElement).textContent || "";
}

function titleOf(testId: string, tabId: string): string {
  const element: HTMLElement | undefined = screen
    .getAllByTestId(testId)
    .find((candidate: HTMLElement): boolean => {
      return candidate.getAttribute("data-tab-id") === tabId;
    });

  expect(element).toBeDefined();

  return (element as HTMLElement).getAttribute("title") || "";
}

describe("in Persian, the switcher writes every figure in Persian digits", () => {
  test("no Latin digit anywhere: names, openings, lengths, counts, tooltips, the chip", async () => {
    await readIn("fa");
    renderSwitcher();

    const latin: Array<string> = everyFigure().filter(
      (text: string): boolean => {
        return LATIN_DIGIT.test(text);
      },
    );

    expect(latin).toEqual([]);
  });

  test("a tab's name and when it opened, on the strip, in the picker and on the chip", async () => {
    await readIn("fa");
    renderSwitcher();
    fireEvent.click(screen.getByTestId("replay-tab-picker-button"));

    // Tab 1 on the strip: still open, so it is drawn.
    expect(textOf("replay-tab-pill", "tab-1")).toContain("زبانه ۱");
    expect(textOf("replay-tab-option", "tab-12")).toContain("زبانه ۱۲");
    expect(textOf("replay-tab-option", "tab-12")).toContain(
      "باز شده در ۱:۰۲:۱۴",
    );
    expect(textOf("replay-tab-option", "tab-2")).toContain("باز شده در ۱:۰۷");
    expect(screen.getByTestId("replay-continue-in-tab")).toHaveTextContent(
      "ادامه در زبانه ۱۲",
    );
  });

  test("a pill's tooltip names the tab and its opening in Persian digits", async () => {
    await readIn("fa");
    renderSwitcher();

    const title: string = titleOf("replay-tab-pill", "tab-2");

    expect(title).toContain("زبانه ۲");
    expect(title).toContain("باز شده در ۱:۰۷");
    expect(title).not.toMatch(LATIN_DIGIT);
  });

  test("the picker's error and frustration counts", async () => {
    await readIn("fa");
    renderSwitcher();
    fireEvent.click(screen.getByTestId("replay-tab-picker-button"));

    expect(
      screen
        .getAllByTestId("replay-tab-option-errors")
        .map((element: HTMLElement): string | null => {
          return element.textContent;
        }),
    ).toEqual(["۳", "۱۲"]);
    expect(
      screen
        .getAllByTestId("replay-tab-option-frustrations")
        .map((element: HTMLElement): string | null => {
          return element.textContent;
        }),
    ).toEqual(["۲", "۱۴"]);
  });

  test("typing the name in Persian digits finds the tab", async () => {
    await readIn("fa");
    renderSwitcher();
    fireEvent.click(screen.getByTestId("replay-tab-picker-button"));
    fireEvent.change(screen.getByTestId("replay-tab-picker-search"), {
      target: { value: "#۱۲" },
    });

    expect(
      screen
        .getAllByTestId("replay-tab-option")
        .map((element: HTMLElement): string | null => {
          return element.getAttribute("data-tab-id");
        }),
    ).toEqual(["tab-12"]);
  });

  test("the check would find a Latin digit", () => {
    expect(LATIN_DIGIT.test("زبانه 2")).toBe(true);
    expect(LATIN_DIGIT.test("زبانه ۲")).toBe(false);
  });
});

describe("every other language keeps Latin digits", () => {
  test.each([
    ["Arabic", "ar"],
    ["German", "de"],
    ["English", "en"],
  ])(
    "%s: no Persian or Arabic-Indic digit",
    async (_name: string, language: string) => {
      await readIn(language);
      renderSwitcher();

      for (const text of everyFigure()) {
        expect({ text, persian: PERSIAN_DIGIT.test(text) }).toEqual({
          text,
          persian: false,
        });
        expect({ text, arabicIndic: ARABIC_INDIC_DIGIT.test(text) }).toEqual({
          text,
          arabicIndic: false,
        });
      }
    },
  );

  test("English reads as it did", async () => {
    renderSwitcher();
    fireEvent.click(screen.getByTestId("replay-tab-picker-button"));

    expect(textOf("replay-tab-pill", "tab-1")).toBe("Tab 1 · /checkout · 30s");
    expect(titleOf("replay-tab-pill", "tab-2")).toBe(
      "Tab 2 (still open) · /cart · opened 1:07 · 31s — switch to this tab; the playhead stays where it is",
    );
    expect(textOf("replay-tab-option", "tab-12")).toContain("Tab 12");
    expect(textOf("replay-tab-option", "tab-12")).toContain("opened 1:02:14");
    expect(
      screen
        .getAllByTestId("replay-tab-option-errors")
        .map((element: HTMLElement): string | null => {
          return element.textContent;
        }),
    ).toEqual(["3", "12"]);
    expect(screen.getByTestId("replay-continue-in-tab")).toHaveTextContent(
      "Continue in Tab 12",
    );
  });

  test("Arabic: Latin digits in its own words", async () => {
    await readIn("ar");
    renderSwitcher();
    fireEvent.click(screen.getByTestId("replay-tab-picker-button"));

    expect(textOf("replay-tab-option", "tab-12")).toContain("علامة التبويب 12");
    expect(textOf("replay-tab-option", "tab-12")).toContain(
      "فُتحت عند 1:02:14",
    );
  });
});
