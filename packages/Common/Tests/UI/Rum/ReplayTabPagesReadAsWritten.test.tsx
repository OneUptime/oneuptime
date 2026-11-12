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
import ReplayTabSwitcher, {
  describeReplayTabDuration,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTabSwitcher";
import { ReplayTabSummary } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTabs";
import { LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME } from "../../../UI/Utils/LineDirection";
import { createTranslator, Translator } from "../../../Types/Translator";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * THE PAGE EACH TAB WAS ON, READ AS IT IS WRITTEN (#7098's UI review).
 *
 * The strip's pills and the picker's rows name the page a tab was on: the
 * end user's own address, "/cart" or "/search?q=linen". On an Arabic or
 * Persian page it was laid out the page's way, right to left, and came out
 * as "cart/" and "search?q=linen/" beside the tab's name. Each page now
 * reads left to right in its own isolate (the pill's IsolatedText, the row's
 * IsolatedLine, which also cuts a long one short at its own end), in every
 * language, while a page the reader's language words ("Unknown page") reads
 * as the page does. English and German lay the row out exactly as before.
 *
 * The picker's length column was monospace, from when it was a clock
 * ("1:30"); it is words now ("1m 30s", "۳۰ ثانیه"), and a monospace font
 * laid Persian and Arabic letters out one per cell, unjoined. It is drawn in
 * the row's own font, with tabular figures.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const RIGHT_TO_LEFT: ReadonlyArray<string> = ["ar", "fa"];

function readLocale(language: string): Record<string, string> {
  if (language === "en") {
    return {};
  }

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

// The pages, as the strip and the picker name them (no origin).
const PAGES: ReadonlyArray<string> = [
  "/cart",
  "/search?q=linen",
  "/products/linen-shirt",
  "/checkout",
  "/account",
  "/orders",
  "/collections",
];

/*
 * Eight tabs: seven on a page each (the first two still open), the eighth
 * with no address at all, which the picker calls "Unknown page". Eight is
 * past the strip's six pills, so the picker is there too.
 */
function eightTabs(): Array<ReplayTabSummary> {
  const tabs: Array<ReplayTabSummary> = PAGES.map(
    (page: string, index: number): ReplayTabSummary => {
      const ordinal: number = index + 1;

      return {
        tabId: `tab-${ordinal}`,
        label: `Tab ${ordinal}`,
        ordinal: ordinal,
        durationMs: 30000 + index * 30000,
        openedAtMs: index * 10000,
        closedAtMs: index * 10000 + 30000,
        hasFootage: true,
        isActive: ordinal === 3,
        status: ordinal <= 2 ? "open" : "closed",
        firstUrl: `https://shop.example.com${page}`,
        lastUrl: `https://shop.example.com${page}`,
        pageCount: 1,
      };
    },
  );

  tabs.push({
    tabId: "tab-8",
    label: "Tab 8",
    ordinal: 8,
    durationMs: 12000,
    openedAtMs: 80000,
    closedAtMs: 92000,
    hasFootage: true,
    isActive: false,
    status: "closed",
    pageCount: 0,
  });

  return tabs;
}

function renderSwitcher(): Array<ReplayTabSummary> {
  const tabs: Array<ReplayTabSummary> = eightTabs();

  render(
    <ReplayTabSwitcher
      tabs={tabs}
      onSwitchTab={() => {}}
      sessionDurationMs={300000}
    />,
  );

  fireEvent.click(screen.getByTestId("replay-tab-picker-button"));

  return tabs;
}

// Each picker row's page box, by the tab it is on.
function optionPages(): Map<string, HTMLElement> {
  const pages: Map<string, HTMLElement> = new Map();

  for (const option of screen.getAllByTestId("replay-tab-option")) {
    const page: HTMLElement | null = option.querySelector(
      '[data-testid="replay-tab-option-page"]',
    );

    expect(page).not.toBeNull();
    pages.set(option.getAttribute("data-tab-id") || "", page as HTMLElement);
  }

  return pages;
}

function translatorIn(language: string): Translator {
  const locale: Record<string, string> = readLocale(language);

  return createTranslator((key: string): string | undefined => {
    return locale[key];
  }, language);
}

describe("each tab's page reads as it is written, in every language", () => {
  test.each(RIGHT_TO_LEFT)(
    "%s: every pill names its page left to right, in an isolate of its own",
    async (language: string) => {
      await readIn(language);
      renderSwitcher();

      const pills: Array<HTMLElement> = screen.getAllByTestId(
        "replay-tab-pill-page",
      );

      expect(pills.length).toBeGreaterThanOrEqual(3);

      for (const pill of pills) {
        const isolate: HTMLElement | null = pill.querySelector("bdi");

        expect(isolate).not.toBeNull();
        expect(isolate as HTMLElement).toHaveAttribute("dir", "ltr");
        expect(PAGES).toContain((isolate as HTMLElement).textContent);
        // The separator stays outside it, on the page's side.
        expect(pill.textContent?.endsWith(isolate?.textContent || "")).toBe(
          true,
        );
        expect(pill.textContent).not.toBe(isolate?.textContent);
      }
    },
  );

  test.each(RIGHT_TO_LEFT)(
    "%s: every picker row's page reads left to right, aligned to the tab's name, and Unknown page reads as the page",
    async (language: string) => {
      await readIn(language);
      renderSwitcher();

      const pages: Map<string, HTMLElement> = optionPages();

      expect(pages.size).toBe(8);

      for (const [tabId, page] of pages) {
        if (tabId === "tab-8") {
          const unknown: string = readLocale(language)["Unknown page"] || "";

          expect(unknown).not.toBe("");
          expect(unknown).not.toBe("Unknown page");
          expect(withoutIsolateMarks(page.textContent || "")).toBe(unknown);
          expect(page).not.toHaveAttribute("dir");
          expect(page).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
          continue;
        }

        expect(PAGES).toContain(page.textContent);
        expect(page).toHaveAttribute("dir", "ltr");
        /*
         * Aligned to its end, which is the page's start: next to the tab's
         * name, not across the row from it.
         */
        expect(page).toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
        // Still one line, cut short where its box ends.
        expect(page).toHaveClass("min-w-0", "flex-1", "truncate");
        expect(page.getAttribute("title")).toBe(
          `https://shop.example.com${page.textContent}`,
        );
      }
    },
  );

  test.each(["en", "de"])(
    "%s: the rows are laid out as before, with no direction of their own",
    async (language: string) => {
      await readIn(language);
      renderSwitcher();

      for (const [tabId, page] of optionPages()) {
        expect(page).not.toHaveAttribute("dir");
        expect(page).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
        expect(page).toHaveClass("min-w-0", "flex-1", "truncate");

        if (tabId !== "tab-8") {
          expect(PAGES).toContain(page.textContent);
        }
      }

      // A pill reads "· /cart" as it always did.
      const first: HTMLElement = screen.getAllByTestId(
        "replay-tab-pill-page",
      )[0] as HTMLElement;

      expect(first.textContent).toMatch(/^ [·•] \/cart$/u);
    },
  );
});

describe("the picker's length column is drawn in the row's own font", () => {
  test.each(LANGUAGES)(
    "%s: no monospace, tabular figures, the length as the language words it",
    async (language: string) => {
      await readIn(language);

      const tabs: Array<ReplayTabSummary> = renderSwitcher();
      const durations: Array<HTMLElement> = screen.getAllByTestId(
        "replay-tab-option-duration",
      );

      expect(durations).toHaveLength(8);

      for (const duration of durations) {
        expect(duration).not.toHaveClass("font-mono");
        expect(duration).toHaveClass("tabular-nums");
      }

      const translator: Translator = translatorIn(language);
      const byTab: Map<string, string> = new Map(
        screen
          .getAllByTestId("replay-tab-option")
          .map((option: HTMLElement): [string, string] => {
            return [
              option.getAttribute("data-tab-id") || "",
              option.querySelector('[data-testid="replay-tab-option-duration"]')
                ?.textContent || "",
            ];
          }),
      );

      for (const tab of tabs) {
        expect(withoutIsolateMarks(byTab.get(tab.tabId) || "")).toBe(
          withoutIsolateMarks(describeReplayTabDuration(tab, translator)),
        );
      }

      if (language !== "en") {
        // Worded, not English.
        expect(byTab.get("tab-2")).not.toBe(
          describeReplayTabDuration(tabs[1] as ReplayTabSummary),
        );
      }
    },
  );
});
