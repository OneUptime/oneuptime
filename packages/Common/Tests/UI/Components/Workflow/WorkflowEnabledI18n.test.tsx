import { WorkflowEnabledCopy } from "../../../../UI/Components/Workflow/WorkflowEnabledCopy";
import {
  WorkflowRunPanelTestRunNote,
  WorkflowTestRunNote,
  WorkflowTestRunPill,
} from "../../../../UI/Components/Workflow/WorkflowTestRun";
import WorkflowTurnedOffNotice from "../../../../UI/Components/Workflow/WorkflowTurnedOffNotice";
import WorkflowEnabledSwitch from "../../../../UI/Components/Workflow/WorkflowEnabledSwitch";
import i18next from "i18next";
import React from "react";
import { initReactI18next } from "react-i18next";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the dashboard says about a workflow that is turned off, and about a
 * test run - one a person started from the Builder while it was off - is
 * drawn in the dashboard, which looks every string up in its locale files by
 * its English text. A string with no entry silently stays English, and a
 * translation that drops a {{placeholder}} loses the person's name. So this
 * holds every sentence to all seventeen files, placeholders included, and
 * renders the notice, the notes and the pill in German from the real locale
 * file.
 *
 * "Why do I have to enable a workflow in order to test run it?" - the
 * sentences of the dialog that asked to turn the workflow on first are gone
 * from every file, along with the dialog.
 *
 * The notice says what off means in one sentence per reader, never two
 * sentences joined with a space: Japanese and Chinese put none after a full
 * stop. Its Run Workflow is a {{button}} slot, drawn with the toolbar's own
 * label, so no language can point at a button that is called something else.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
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

const UI_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "UI",
  "Components",
  "Workflow",
);

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

type ReadLocaleFunction = (locale: string) => Record<string, string>;

const readLocale: ReadLocaleFunction = (
  locale: string,
): Record<string, string> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  );
};

const ENGLISH: Record<string, string> = readLocale("en");

const STRINGS: Array<string> = Array.from(
  new Set(Object.values(WorkflowEnabledCopy)),
);

// What the dialog that asked to turn the workflow on first used to say.
const RETIRED_STRINGS: Array<string> = [
  "Its trigger is ignored and it can't be run or tested until you turn it on.",
  "Turn on this workflow?",
  'This workflow is off, so "{{step}}" can\'t run. Turn the workflow on to run this step now.',
  "This workflow is off, so it can't run. Turn it on to run it now.",
  "Once it's on, its {{trigger}} trigger starts it too.",
  "You can turn it off again with the Enabled switch above the canvas.",
  "Turn on and run step",
  "Turn on and run",
  "This workflow is off, so it can't run. Only people who can edit this workflow can turn it on.",
  "Workflows are created switched off, so nothing runs until you turn them on.",
  /*
   * The notice's second sentence and its line about who can turn it on, from
   * before each case was one whole sentence.
   */
  "You can still test it with Run Workflow.",
  "Only people who can edit this workflow can turn it on.",
];

// A full stop Japanese and Chinese end a sentence with, then a space.
const SPACE_AFTER_FULL_STOP: RegExp = /[。．]\s/;

// The notice's sentences that offer Run Workflow, as a {{button}} slot.
const CAN_TEST_SENTENCES: Array<string> = [
  WorkflowEnabledCopy.noticeBodyCanTest,
  WorkflowEnabledCopy.noticeBodyForOthersCanTest,
];

const PLACEHOLDER: RegExp = /\{\{\s*([\w.]+)\s*\}\}/g;

type PlaceholdersFunction = (text: string) => Array<string>;

const placeholdersOf: PlaceholdersFunction = (text: string): Array<string> => {
  return Array.from(text.matchAll(PLACEHOLDER), (match: RegExpMatchArray) => {
    return match[1]!;
  }).sort();
};

describe("the turned-off workflow's and the test run's words in every dashboard language", () => {
  test("the copy is what the scan found, so the checks below are not vacuous", () => {
    expect(STRINGS.length).toBeGreaterThanOrEqual(10);
    expect(STRINGS).toEqual(
      expect.arrayContaining([
        "Turn on workflow",
        "Its trigger is paused until you turn it on.",
        "Its trigger is paused until you turn it on. You can still test it with {{button}}.",
        "Its trigger is paused until someone who can edit this workflow turns it on.",
        "Its trigger is paused until someone who can edit this workflow turns it on. You can still test it with {{button}}.",
        "Test run",
        "Started by {{person}} while this workflow was off.",
        "Started by hand while this workflow was off.",
      ]),
    );
  });

  test("there are seventeen locale files", () => {
    const files: Array<string> = fs
      .readdirSync(LOCALES_DIR)
      .filter((file: string) => {
        return file.endsWith(".json");
      });

    expect(files.sort()).toEqual(
      ["en", ...OTHER_LOCALES]
        .map((locale: string) => {
          return `${locale}.json`;
        })
        .sort(),
    );
  });

  test("English maps every string to itself", () => {
    for (const text of STRINGS) {
      expect({ text, english: ENGLISH[text] }).toEqual({ text, english: text });
    }
  });

  test.each(OTHER_LOCALES)("%s translates every string", (locale: string) => {
    const translations: Record<string, string> = readLocale(locale);

    for (const text of STRINGS) {
      const translated: string | undefined = translations[text];

      expect({ locale, text, has: typeof translated === "string" }).toEqual({
        locale,
        text,
        has: true,
      });
      expect((translated || "").trim().length).toBeGreaterThan(0);

      // Sentences and the two-word label are translated, not left in English.
      if (text.split(" ").length >= 2) {
        expect({ locale, text, same: translated === text }).toEqual({
          locale,
          text,
          same: false,
        });
      }
    }
  });

  test.each(OTHER_LOCALES)(
    "%s keeps every placeholder, and adds none",
    (locale: string) => {
      const translations: Record<string, string> = readLocale(locale);

      for (const text of STRINGS) {
        expect({
          locale,
          text,
          placeholders: placeholdersOf(translations[text] || ""),
        }).toEqual({ locale, text, placeholders: placeholdersOf(text) });
      }
    },
  );

  test.each(["en", ...OTHER_LOCALES])(
    "%s leaves the Run Workflow button's name to the button",
    (locale: string) => {
      /*
       * "You can still test it with Run Workflow." The button's label is
       * translated too, and the sentence has to name it as the toolbar
       * does, or it points at a button nobody can find. So the sentence has
       * a {{button}} slot, once, filled with the label itself - and does not
       * spell the label out a second time.
       */
      const translations: Record<string, string> = readLocale(locale);
      const button: string = translations["Run Workflow"] || "";

      expect(button.length).toBeGreaterThan(0);

      for (const text of CAN_TEST_SENTENCES) {
        const translated: string = translations[text] || "";

        expect({
          locale,
          text,
          slots: translated.split("{{button}}").length,
        }).toEqual({ locale, text, slots: 2 });
        expect({
          locale,
          text,
          spellsItOut: translated.includes(button),
        }).toEqual({ locale, text, spellsItOut: false });
      }
    },
  );

  test.each(["en", ...OTHER_LOCALES])(
    "%s says each case of the notice in its own words, not two keys joined",
    (locale: string) => {
      /*
       * Each case's sentence is translated whole, so a language that puts no
       * space after a full stop is not handed one, and the two cases that
       * name who can turn the workflow on say it in one sentence.
       */
      const translations: Record<string, string> = readLocale(locale);
      const paused: string = translations[WorkflowEnabledCopy.noticeBody] || "";
      const pausedForOthers: string =
        translations[WorkflowEnabledCopy.noticeBodyForOthers] || "";

      expect(paused.length).toBeGreaterThan(0);
      expect(pausedForOthers.length).toBeGreaterThan(0);
      expect(pausedForOthers).not.toBe(paused);
      expect(
        (translations[WorkflowEnabledCopy.noticeBodyCanTest] || "").startsWith(
          paused,
        ),
      ).toBe(true);
      expect(
        (
          translations[WorkflowEnabledCopy.noticeBodyForOthersCanTest] || ""
        ).startsWith(pausedForOthers),
      ).toBe(true);

      for (const text of CAN_TEST_SENTENCES) {
        expect({
          locale,
          text,
          spaceAfterFullStop: SPACE_AFTER_FULL_STOP.test(
            translations[text] || "",
          ),
        }).toEqual({ locale, text, spaceAfterFullStop: false });
      }
    },
  );

  test.each(["en", ...OTHER_LOCALES])(
    "%s no longer has the sentences of the dialog that asked to turn the workflow on first",
    (locale: string) => {
      const translations: Record<string, string> = readLocale(locale);

      expect(
        RETIRED_STRINGS.filter((text: string): boolean => {
          return text in translations;
        }),
      ).toEqual([]);
    },
  );

  test("none of the parts draws text that bypasses the lookup", () => {
    /*
     * Text written straight into JSX would stay English in every language.
     * Everything goes through translate(), the translator, or is handed to a
     * Button, Toggle or Pill, which look their own text up.
     */
    const jsxText: RegExp = /(?<!=)>\s*([A-Za-z][^<>{}]*?)\s*</g;

    for (const file of [
      "WorkflowTestRun.tsx",
      "WorkflowTurnedOffNotice.tsx",
      "WorkflowEnabledSwitch.tsx",
    ]) {
      const source: string = fs
        .readFileSync(path.join(UI_DIR, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/\/\/.*$/gm, " ");

      const rawJsxText: Array<string> = Array.from(
        source.matchAll(jsxText),
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      );

      expect({ file, rawJsxText }).toEqual({ file, rawJsxText: [] });
    }

    // And the scan does catch text written into a tag.
    expect(
      Array.from("<p>This workflow is off</p>".matchAll(jsxText)).length,
    ).toBe(1);
  });
});

describe("drawn in German", () => {
  const GERMAN: Record<string, string> = readLocale("de");

  beforeAll(async () => {
    // As the Dashboard sets it up: one instance for hooks and templates.
    await i18next.use(initReactI18next).init({
      lng: "de",
      fallbackLng: "en",
      interpolation: { escapeValue: false },
      resources: { de: { translation: GERMAN } },
    });
  });

  afterAll(async () => {
    await i18next.changeLanguage("en");
  });

  afterEach(() => {
    cleanup();
  });

  test("the notice and the switch", () => {
    render(
      <div>
        <WorkflowTurnedOffNotice
          onTurnOn={(): void => {
            // Not pressed here.
          }}
        />
        <WorkflowEnabledSwitch
          isEnabled={false}
          onChange={(): void => {
            // Not pressed here.
          }}
        />
      </div>,
    );

    const notice: HTMLElement = screen.getByTestId(
      "workflow-turned-off-notice",
    );

    expect(notice).toHaveTextContent("Dieser Arbeitsablauf ist ausgeschaltet");
    expect(
      screen.getByTestId("workflow-turned-off-notice-body").textContent,
    ).toBe(
      "Sein Auslöser ist pausiert, bis Sie ihn einschalten. Sie können ihn trotzdem mit „Arbeitsablauf ausführen“ testen.",
    );
    // The button's German label, in bold, where German grammar puts it.
    expect(
      screen.getByText("Arbeitsablauf ausführen", { selector: "strong" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("workflow-turn-on-button")).toHaveTextContent(
      "Arbeitsablauf einschalten",
    );
    expect(
      screen.getByRole("switch", { name: "Aktiviert" }),
    ).toBeInTheDocument();
  });

  test("the notice to someone who may run the workflow but not turn it on", () => {
    render(<WorkflowTurnedOffNotice canTest={true} />);

    expect(
      screen.getByTestId("workflow-turned-off-notice-body").textContent,
    ).toBe(
      "Sein Auslöser ist pausiert, bis jemand, der diesen Arbeitsablauf bearbeiten kann, ihn einschaltet. Sie können ihn trotzdem mit „Arbeitsablauf ausführen“ testen.",
    );
  });

  test("a test run's note, with the person's name in place", () => {
    render(<WorkflowTestRunNote startedBy="Ada Lovelace" />);

    const note: HTMLElement = screen.getByTestId("workflow-run-test-run-note");

    expect(note).toHaveTextContent("Testlauf");
    expect(note).toHaveTextContent(
      "Von Ada Lovelace gestartet, während dieser Arbeitsablauf ausgeschaltet war.",
    );
    expect(note).not.toHaveTextContent("{{");
  });

  test("a test run's note when nobody is named", () => {
    render(<WorkflowTestRunNote />);

    expect(screen.getByTestId("workflow-run-test-run-note")).toHaveTextContent(
      "Manuell gestartet, während dieser Arbeitsablauf ausgeschaltet war.",
    );
  });

  test("the Run Workflow panel's note", () => {
    render(<WorkflowRunPanelTestRunNote />);

    expect(
      screen.getByTestId("workflow-run-panel-test-run-note"),
    ).toHaveTextContent(
      "Dieser Arbeitsablauf ist ausgeschaltet, daher ist dies ein Testlauf.",
    );
  });

  test("the run lists' pill", () => {
    render(<WorkflowTestRunPill startedBy="Ada Lovelace" />);

    expect(screen.getByTestId("workflow-test-run-pill")).toHaveTextContent(
      "Testlauf",
    );
  });
});

describe("drawn in Japanese", () => {
  const JAPANESE: Record<string, string> = readLocale("ja");

  beforeAll(async () => {
    if (i18next.isInitialized) {
      i18next.addResourceBundle("ja", "translation", JAPANESE, true, true);
      await i18next.changeLanguage("ja");
      return;
    }

    await i18next.use(initReactI18next).init({
      lng: "ja",
      fallbackLng: "en",
      interpolation: { escapeValue: false },
      resources: { ja: { translation: JAPANESE } },
    });
  });

  afterAll(async () => {
    await i18next.changeLanguage("en");
  });

  afterEach(() => {
    cleanup();
  });

  test("the notice's two sentences meet without a space after the full stop", () => {
    render(
      <WorkflowTurnedOffNotice
        onTurnOn={(): void => {
          // Not pressed here.
        }}
      />,
    );

    const body: string =
      screen.getByTestId("workflow-turned-off-notice-body").textContent || "";

    expect(body).toBe(
      "オンにするまで、トリガーは一時停止しています。「ワークフローを実行」で引き続きテストできます。",
    );
    expect(SPACE_AFTER_FULL_STOP.test(body)).toBe(false);
    expect(
      screen.getByText("ワークフローを実行", { selector: "strong" }),
    ).toBeInTheDocument();
  });
});
