import { WorkflowEnabledCopy } from "../../../../UI/Components/Workflow/WorkflowEnabledCopy";
import {
  WorkflowRunAttempt,
  WorkflowRunKind,
} from "../../../../UI/Components/Workflow/UseWorkflowEnabled";
import WorkflowTurnOnModal from "../../../../UI/Components/Workflow/WorkflowTurnOnModal";
import WorkflowTurnedOffNotice from "../../../../UI/Components/Workflow/WorkflowTurnedOffNotice";
import WorkflowEnabledSwitch from "../../../../UI/Components/Workflow/WorkflowEnabledSwitch";
import { WORKFLOW_ENABLED_SWITCH_LABEL } from "../../../../Types/Workflow/WorkflowEnabled";
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
 * What the Builder says about a workflow that is turned off is drawn in the
 * dashboard, which looks every string up in its locale files by its English
 * text. A string with no entry silently stays English, and a translation that
 * drops a {{placeholder}} loses the step's or the trigger's name. So this
 * holds every sentence to all seventeen files, placeholders included, and
 * renders the dialog in German from the real locale file.
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

const PLACEHOLDER: RegExp = /\{\{\s*([\w.]+)\s*\}\}/g;

type PlaceholdersFunction = (text: string) => Array<string>;

const placeholdersOf: PlaceholdersFunction = (text: string): Array<string> => {
  return Array.from(text.matchAll(PLACEHOLDER), (match: RegExpMatchArray) => {
    return match[1]!;
  }).sort();
};

describe("the turned-off workflow's words in every dashboard language", () => {
  test("the copy is what the scan found, so the checks below are not vacuous", () => {
    expect(STRINGS.length).toBeGreaterThanOrEqual(13);
    expect(STRINGS).toContain("Turn on workflow");
    expect(STRINGS).toContain(
      'This workflow is off, so "{{step}}" can\'t run. Turn the workflow on to run this step now.',
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

      // Sentences are translated, not left in English.
      if (text.split(" ").length > 2) {
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
    "%s names the switch as that language draws it",
    (locale: string) => {
      /*
       * "...with the Enabled switch above the canvas." The switch's label is
       * translated too, so the sentence has to use the same word, or it
       * points at a switch nobody can find.
       */
      const translations: Record<string, string> = readLocale(locale);
      const label: string = translations[WORKFLOW_ENABLED_SWITCH_LABEL] || "";

      expect(label.length).toBeGreaterThan(0);
      expect(
        translations[WorkflowEnabledCopy.promptWhereTheSwitchIs] || "",
      ).toContain(label);
    },
  );

  test("none of the parts draws text that bypasses the lookup", () => {
    /*
     * Text written straight into JSX would stay English in every language.
     * Everything goes through translate() or translateTemplate(), or is
     * handed to a Button, Toggle or ConfirmModal, which look their own
     * titles up.
     */
    const jsxText: RegExp = /(?<!=)>\s*([A-Za-z][^<>{}]*?)\s*</g;

    for (const file of [
      "WorkflowTurnOnModal.tsx",
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

  const STEP_RUN: WorkflowRunAttempt = {
    kind: WorkflowRunKind.Step,
    stepTitle: "If / Else",
    run: async (): Promise<void> => {
      // Not sent here.
    },
  };

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

  test("the dialog says it all in German, with the step's and the trigger's names in place", () => {
    render(
      <WorkflowTurnOnModal
        attempt={STEP_RUN}
        triggerTitle="Webhook"
        canTurnOn={true}
        onTurnOn={(): void => {
          // Not pressed here.
        }}
        onClose={(): void => {
          // Not pressed here.
        }}
      />,
    );

    expect(
      screen.getByText("Diesen Arbeitsablauf einschalten?"),
    ).toBeInTheDocument();

    const prompt: HTMLElement = screen.getByTestId("workflow-turn-on-prompt");

    expect(prompt).toHaveTextContent(
      "Dieser Arbeitsablauf ist ausgeschaltet, daher kann „If / Else“ nicht ausgeführt werden.",
    );
    expect(prompt).toHaveTextContent(
      "Sobald er eingeschaltet ist, startet ihn auch sein Auslöser „Webhook“.",
    );
    expect(prompt).toHaveTextContent("„Aktiviert“");
    expect(prompt).not.toHaveTextContent("{{");
    expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      "Einschalten und Schritt ausführen",
    );
  });

  test("the notice and the switch too", () => {
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

    expect(screen.getByTestId("workflow-turned-off-notice")).toHaveTextContent(
      "Dieser Arbeitsablauf ist ausgeschaltet",
    );
    expect(screen.getByTestId("workflow-turn-on-button")).toHaveTextContent(
      "Arbeitsablauf einschalten",
    );
    expect(
      screen.getByRole("switch", { name: "Aktiviert" }),
    ).toBeInTheDocument();
  });
});
