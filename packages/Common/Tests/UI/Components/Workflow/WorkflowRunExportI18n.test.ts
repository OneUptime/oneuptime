import { WorkflowRunExportText } from "../../../../UI/Components/Workflow/DownloadWorkflowRun";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A workflow run's Copy log and Download, in every dashboard language.
 *
 * The dashboard looks every string up in its locale files by its English
 * text, and a string with no entry silently stays English. This holds every
 * word the controls show - on the run's modal and in a run list's row menu -
 * to all seventeen files, and the controls to drawing no text that skips the
 * lookup.
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

const COMPONENTS_DIR: string = path.join(
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
  new Set(Object.values(WorkflowRunExportText)),
);

type ReadSourceFunction = (file: string) => string;

// The source, without its comments: prose there is not drawn.
const readSource: ReadSourceFunction = (file: string): string => {
  return fs
    .readFileSync(path.join(COMPONENTS_DIR, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
};

describe("a workflow run's Copy log and Download in every dashboard language", () => {
  test("the scan found the controls' words, so the checks below are not vacuous", () => {
    expect(STRINGS).toEqual(
      expect.arrayContaining([
        "Copy log",
        "Copied!",
        "Copy failed",
        "Download",
        "Download log",
        "Download run as JSON",
        "The log could not be copied. Download it instead.",
        "This run could not be downloaded. Try again.",
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

      // Sentences are translated, not left in English.
      if (text.split(" ").length > 3) {
        expect({ locale, text, same: translated === text }).toEqual({
          locale,
          text,
          same: false,
        });
      }
    }
  });

  test.each(OTHER_LOCALES)(
    "%s keeps JSON as JSON in Download run as JSON",
    (locale: string) => {
      expect(readLocale(locale)["Download run as JSON"]).toMatch(/\bJSON\b/);
    },
  );

  test("the controls draw no text that bypasses the lookup", () => {
    /*
     * Text written straight into JSX would stay English in every language.
     * Everything the controls say goes through translate(), or is handed to
     * a table row's menu, which looks its own titles up.
     */
    const jsxText: RegExp = /(?<!=)>\s*([A-Za-z][^<>{}]*?)\s*</g;

    for (const file of [
      "WorkflowRunExportActions.tsx",
      "DownloadWorkflowRun.ts",
    ]) {
      const rawJsxText: Array<string> = Array.from(
        readSource(file).matchAll(jsxText),
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      );

      expect({ file, rawJsxText }).toEqual({ file, rawJsxText: [] });
    }

    // And the scan does catch text written into a tag.
    expect(Array.from("<span>Copy log</span>".matchAll(jsxText)).length).toBe(
      1,
    );
  });

  test("every word the controls show comes from the one list that is translated", () => {
    const source: string = readSource("WorkflowRunExportActions.tsx");

    // No string literal in the component is a sentence or label of its own.
    const label: RegExp = /"([A-Z][a-z]+(?: [A-Za-z!.]+)+)"/g;
    const quoted: Array<string> = Array.from(
      source.matchAll(label),
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    );

    expect(quoted).toEqual([]);

    // And the scan does catch a label written into the component.
    expect(Array.from('text="Copy the log"'.matchAll(label)).length).toBe(1);
  });
});
