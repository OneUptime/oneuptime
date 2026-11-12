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
import PrivacySummaryCard, {
  PrivacySummaryInput,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/PrivacySummaryCard";
import SessionReplayMaskingMode from "../../../Types/Rum/SessionReplayMaskingMode";

/*
 * SESSION REPLAY'S TABS AND PRIVACY CARD, AS EACH LANGUAGE'S READER SEES
 * THEM (#6768, #6635), drawn from the Dashboard's shipped locale files.
 *
 * The player counted a session's browser tabs with "{{count}} open", the
 * key the Home page counts open incidents with, so Japanese and Chinese
 * read "3 tabs · 2 unresolved" and Spanish counted the (feminine) tabs as
 * "abiertos". A tab's tooltip and the picker's headings named its state
 * with the bare "Open", the key every Open button reads: German
 * "Öffnen", Arabic "open it". The tab words are keys of their own now,
 * worded for a tab, and the bare "Open" is a verb in every language.
 *
 * The privacy card ran the policy's extras together with an ASCII "; "
 * and ended them with ".", inside a Chinese or Japanese line. They are a
 * sentence of their own now, listed with the reader's separator and ended
 * with the reader's full stop.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

const LANGUAGES: ReadonlyArray<string> = [
  "en",
  "de",
  "es",
  "ja",
  "zh-CN",
  "ar",
];

const LOCALES: Record<string, Record<string, string>> = {};

for (const language of LANGUAGES) {
  LOCALES[language] = readLocale(language);
}

// What `language` draws for `key`, its placeholders filled.
function worded(
  language: string,
  key: string,
  values: Record<string, string> = {},
): string {
  const text: string | undefined = LOCALES[language]?.[key];

  expect({ language, key, worded: Boolean(text) }).toEqual({
    language,
    key,
    worded: true,
  });

  return Object.keys(values).reduce((sentence: string, name: string) => {
    return sentence.split(`{{${name}}}`).join(values[name] as string);
  }, text as string);
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
        return [
          language,
          { translation: LOCALES[language] as Record<string, string> },
        ];
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

function makeTab(
  ordinal: number,
  overrides: Partial<ReplayTabSummary> = {},
): ReplayTabSummary {
  return {
    tabId: `tab-${ordinal}`,
    label: `Tab ${ordinal}`,
    ordinal: ordinal,
    durationMs: 30000,
    openedAtMs: (ordinal - 1) * 20000,
    closedAtMs: (ordinal - 1) * 20000 + 30000,
    hasFootage: true,
    isActive: ordinal === 1,
    status: "closed",
    firstUrl: `https://app.acme.com/page-${ordinal}`,
    lastUrl: `https://app.acme.com/page-${ordinal}`,
    pageCount: 1,
    errorCount: 0,
    frustrationCount: 0,
    ...overrides,
  };
}

// Two tabs still recording and six closed: the picker's session.
function eightTabs(): Array<ReplayTabSummary> {
  return [1, 2, 3, 4, 5, 6, 7, 8].map((ordinal: number): ReplayTabSummary => {
    return makeTab(ordinal, { status: ordinal <= 2 ? "open" : "closed" });
  });
}

// Tab 1 (watched) and Tab 2 still open, Tab 3 closed: every pill drawn.
function threeTabs(): Array<ReplayTabSummary> {
  return [
    makeTab(1, { status: "open" }),
    makeTab(2, { status: "open" }),
    makeTab(3, { status: "closed" }),
  ];
}

function renderSwitcher(tabs: Array<ReplayTabSummary>): void {
  render(
    <ReplayTabSwitcher
      tabs={tabs}
      onSwitchTab={() => {}}
      sessionDurationMs={600000}
    />,
  );
}

function pillTitle(tabId: string): string {
  const pill: HTMLElement | undefined = screen
    .getAllByTestId("replay-tab-pill")
    .find((element: HTMLElement): boolean => {
      return element.getAttribute("data-tab-id") === tabId;
    });

  expect(pill).toBeDefined();

  return (pill as HTMLElement).getAttribute("title") || "";
}

function pickerHeadings(): Array<string | null> {
  fireEvent.click(screen.getByTestId("replay-tab-picker-button"));

  return screen
    .getAllByTestId("replay-tab-group")
    .map((group: HTMLElement): string | null => {
      return group.textContent;
    });
}

describe("a session's tabs, counted in the tabs' own words", () => {
  test.each([
    ["Spanish", "es", "8 pestañas · 2 siguen abiertas · 6 cerradas"],
    ["Japanese", "ja", "タブ 8 個 · 開いたまま 2 個 · 閉じた 6 個"],
    ["German", "de", "8 Tabs · 2 noch offen · 6 geschlossen"],
    ["English", "en", "8 tabs · 2 still open · 6 closed"],
  ])(
    "%s: the summary line",
    async (_name: string, language: string, summary: string) => {
      await readIn(language);
      renderSwitcher(eightTabs());

      expect(screen.getByTestId("replay-tab-summary").textContent).toBe(
        summary,
      );
    },
  );

  test("never in the Home page's words for open incidents", async () => {
    for (const language of ["es", "ja", "zh-CN"]) {
      await readIn(language);
      renderSwitcher(eightTabs());

      const summary: string =
        screen.getByTestId("replay-tab-summary").textContent || "";

      // ja 未解決 2 件, zh-CN 2 项未解决, es "2 abiertos": incidents, not tabs.
      expect({ language, summary }).not.toEqual({
        language,
        summary: expect.stringContaining(
          worded(language, "{{count}} open", { count: "2" }),
        ),
      });
      expect(summary).toContain(
        worded(language, "{{count}} still open", { count: "2" }),
      );

      cleanup();
    }
  });

  test.each([
    ["Spanish", "es", ["2 siguen abiertas", "6 cerradas"]],
    ["Japanese", "ja", ["開いたまま 2 個", "閉じた 6 個"]],
    ["Arabic", "ar", ["لا تزال مفتوحة: 2", "المغلقة: 6"]],
    ["English", "en", ["2 still open", "6 closed"]],
  ])(
    "%s: the picker's headings count their tabs as the summary does",
    async (_name: string, language: string, headings: Array<string>) => {
      await readIn(language);
      renderSwitcher(eightTabs());

      expect(pickerHeadings()).toEqual(headings);
    },
  );
});

describe("the strip's divider names the closed tabs in the tabs' own words", () => {
  test.each([
    ["Spanish", "es", "Pestañas cerradas"],
    ["German", "de", "Geschlossene Tabs"],
    ["Japanese", "ja", "閉じたタブ"],
    ["Arabic", "ar", "علامات التبويب المغلقة"],
    ["English", "en", "Closed tabs"],
  ])("%s", async (_name: string, language: string, divider: string) => {
    await readIn(language);
    renderSwitcher(threeTabs());

    const drawn: string =
      screen.getByTestId("replay-tab-strip-divider").textContent || "";

    expect(drawn).toBe(divider);
    /*
     * Never the bare "Closed" a security case or a pull request reads:
     * Spanish "Cerrado", masculine, beside the summary's "1 cerrada".
     */
    expect({ language, same: drawn === worded(language, "Closed") }).toEqual({
      language,
      same: false,
    });
  });

  test("Japanese words a tab's state as a browser does, not a ticket's", async () => {
    await readIn("ja");
    renderSwitcher(eightTabs());

    const summary: string =
      screen.getByTestId("replay-tab-summary").textContent || "";
    const headings: string = pickerHeadings().join(" ");

    // オープン中 / クローズ済み are an incident's or a case's states.
    for (const ticketWord of [
      worded("ja", "Closed"),
      worded("ja", "Open (status)"),
    ]) {
      expect({ ticketWord, inSummary: summary.includes(ticketWord) }).toEqual({
        ticketWord,
        inSummary: false,
      });
      expect({ ticketWord, inHeadings: headings.includes(ticketWord) }).toEqual(
        { ticketWord, inHeadings: false },
      );
    }
  });
});

describe("a tab's tooltip says what it is, never the Open button's verb", () => {
  test.each([
    ["German", "de", "Tab 2 (noch offen)", "Tab 3 (geschlossen)"],
    ["Spanish", "es", "Pestaña 2 (sigue abierta)", "Pestaña 3 (cerrada)"],
    ["Japanese", "ja", "タブ 2（開いたまま）", "タブ 3（閉じた）"],
    ["Chinese", "zh-CN", "标签页 2（未关闭）", "标签页 3（已关闭）"],
    [
      "Arabic",
      "ar",
      "علامة التبويب 2 (لا تزال مفتوحة)",
      "علامة التبويب 3 (مغلقة)",
    ],
    ["English", "en", "Tab 2 (still open)", "Tab 3 (closed)"],
  ])(
    "%s",
    async (
      _name: string,
      language: string,
      stillOpen: string,
      closed: string,
    ) => {
      await readIn(language);
      renderSwitcher(threeTabs());

      const open: string = pillTitle("tab-2");

      expect(open.startsWith(stillOpen)).toBe(true);
      expect(pillTitle("tab-3").startsWith(closed)).toBe(true);

      // The verb every Open button reads is nowhere in a tab's state.
      const verb: string = worded(language, "Open");

      expect({ open, verb: open.includes(` ${verb} `) }).toEqual({
        open,
        verb: false,
      });
    },
  );
});

describe("the privacy card's extras, in the reader's punctuation", () => {
  const EVERY_EXTRA: PrivacySummaryInput = {
    maskingMode: SessionReplayMaskingMode.MaskInputsOnly,
    maskSelectors: [".customer-name", "#invoice-total"],
    blockSelectors: ["iframe.payment", ".id-document"],
    recordCanvas: true,
    retentionInDays: 30,
  };

  // The masking mode's own sentence, which the extras follow.
  const MASK_INPUTS_ONLY: string =
    "Readable page text is recorded; every input value is masked. An account number in a heading is visible in the replay, one typed into a form is not.";

  function pageText(): string {
    render(
      <PrivacySummaryCard policy={EVERY_EXTRA} changeHref="#replay-policy" />,
    );

    return screen.getByTestId("privacy-summary-page-text").textContent || "";
  }

  test.each([
    [
      "Chinese",
      "zh-CN",
      "此外：另有 2 个选择器被遮盖、2 个选择器被完全屏蔽、画布内容会被录制。",
    ],
    [
      "Japanese",
      "ja",
      "このほか: 追加のセレクター 2 件をマスク、セレクター 2 件を完全にブロック、canvas の内容を記録。",
    ],
    [
      "Arabic",
      "ar",
      "وأيضًا: 2 من المحددات الإضافية مُخفاة، 2 من المحددات محظورة بالكامل، تُسجَّل محتويات canvas.",
    ],
    [
      "Spanish",
      "es",
      "Además: 2 selectores adicionales enmascarados, 2 selectores bloqueados por completo, contenido de canvas grabado.",
    ],
    [
      "English",
      "en",
      "Also: 2 extra selectors masked, 2 selectors blocked entirely, canvas contents recorded.",
    ],
  ])(
    "%s: one sentence, listed and ended as the language writes",
    async (_name: string, language: string, extras: string) => {
      await readIn(language);

      const text: string = pageText();

      // After the mode's sentence, the extras' own, then the Change link.
      expect(
        text.endsWith(`${extras}${worded(language, "Change masking")}`),
      ).toBe(true);
      expect(text.startsWith(worded(language, MASK_INPUTS_ONLY))).toBe(true);
      // Never the English "; " the facts were run together with.
      expect(extras).not.toMatch(/[;；]/);
    },
  );
});
