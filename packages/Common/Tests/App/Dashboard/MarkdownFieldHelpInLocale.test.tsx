import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import ts from "typescript";
import FieldLabelElement from "../../../UI/Components/Forms/Fields/FieldLabel";

/*
 * The one line of help under a Markdown field - "Describe the incident
 * details here." under an incident's Description - in the reader's
 * language.
 *
 * It used to come from MarkdownUtil.getMarkdownCheatsheet("Describe the
 * incident details here"), which drew the words as a paragraph element.
 * A field translates a description it is handed as text, never one handed
 * as an element, and the extractor never saw the words either, so the help
 * read English in every language. Each field now hands its sentence as
 * text, like every other field, and the sentence is a key in every locale.
 */

const REPOSITORY_PACKAGES: string = path.resolve(__dirname, "../../../..");
const DASHBOARD_SRC: string = path.join(
  REPOSITORY_PACKAGES,
  "App/FeatureSet/Dashboard/src",
);
const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

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

// Every Markdown field's help, as the fields hand it over.
const MARKDOWN_FIELD_HELP: Array<string> = [
  "Add an announcement note.",
  "Add postmortem notes for this episode here.",
  "Add remediation notes for this alert here.",
  "Add remediation notes for this episode here.",
  "Add remediation notes for this incident here.",
  "Describe the alert details here.",
  "Describe the episode details here.",
  "Describe the incident details here.",
  "Describe the root cause of this incident here.",
  "Describe the scheduled maintenance event here.",
  "Describe the status page group here.",
  "Describe this resource here.",
  "Describe your status page overview here.",
];

type LocaleFile = Record<string, unknown>;

function readLocale(language: string): LocaleFile {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as LocaleFile;
}

function sourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "Locales") {
        files.push(...sourceFiles(full));
      }
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts")
    ) {
      files.push(full);
    }
  }

  return files;
}

interface MarkdownFieldDescription {
  file: string;
  line: number;
  // The description's expression as written: '"Describe it."', "<p>...".
  written: string;
  // A string written in place, which the guard can read.
  literal: string | null;
  /*
   * An element with English written inside it - <p>Describe it.</p> -
   * which the field draws as it is, never translated. Text, a constant, a
   * copy object's sentence or a component that looks its own words up is
   * fine.
   */
  isEnglishElement: boolean;
}

const LETTER: RegExp = /\p{L}/u;

// JSX holding words of its own: text between its tags, or a string child.
function holdsWrittenWords(node: ts.Node): boolean {
  if (ts.isJsxText(node)) {
    return LETTER.test(node.text);
  }

  if (
    ts.isJsxExpression(node) &&
    node.expression &&
    (ts.isStringLiteral(node.expression) ||
      ts.isNoSubstitutionTemplateLiteral(node.expression))
  ) {
    return LETTER.test(node.expression.text);
  }

  // A JSX attribute's value is never drawn as text.
  if (ts.isJsxAttributes(node)) {
    return false;
  }

  let holds: boolean = false;

  ts.forEachChild(node, (child: ts.Node): void => {
    holds = holds || holdsWrittenWords(child);
  });

  return holds;
}

function isEnglishElementExpression(node: ts.Expression): boolean {
  let current: ts.Expression = node;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }

  if (ts.isConditionalExpression(current)) {
    return (
      isEnglishElementExpression(current.whenTrue) ||
      isEnglishElementExpression(current.whenFalse)
    );
  }

  return (
    (ts.isJsxElement(current) ||
      ts.isJsxSelfClosingElement(current) ||
      ts.isJsxFragment(current)) &&
    holdsWrittenWords(current)
  );
}

/*
 * The description of every form field whose type is Markdown, as written in
 * the Dashboard's source: a string a field translates, or anything else.
 */
function markdownFieldDescriptions(): Array<MarkdownFieldDescription> {
  const found: Array<MarkdownFieldDescription> = [];

  for (const file of sourceFiles(DASHBOARD_SRC)) {
    const text: string = fs.readFileSync(file, "utf8");

    if (!text.includes("FormFieldSchemaType.Markdown")) {
      continue;
    }

    const source: ts.SourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        let isMarkdown: boolean = false;
        let description: ts.Expression | null = null;

        for (const property of node.properties) {
          if (!ts.isPropertyAssignment(property)) {
            continue;
          }

          const name: string = property.name.getText(source);

          if (
            name === "fieldType" &&
            property.initializer.getText(source) ===
              "FormFieldSchemaType.Markdown"
          ) {
            isMarkdown = true;
          }

          if (name === "description") {
            description = property.initializer;
          }
        }

        if (isMarkdown && description) {
          found.push({
            file: path.relative(REPOSITORY_PACKAGES, file),
            line:
              source.getLineAndCharacterOfPosition(description.getStart(source))
                .line + 1,
            written: description.getText(source),
            literal:
              ts.isStringLiteral(description) ||
              ts.isNoSubstitutionTemplateLiteral(description)
                ? description.text
                : null,
            isEnglishElement: isEnglishElementExpression(description),
          });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(source);
  }

  return found;
}

describe("a Markdown field's help", () => {
  const found: Array<MarkdownFieldDescription> = markdownFieldDescriptions();

  test("is handed to the field as text, which the field translates", () => {
    // A guard that reads nothing passes everything.
    expect(found.length).toBeGreaterThanOrEqual(MARKDOWN_FIELD_HELP.length);

    expect(
      found
        .filter((item: MarkdownFieldDescription): boolean => {
          return item.isEnglishElement;
        })
        .map((item: MarkdownFieldDescription): string => {
          return `${item.file}:${item.line}: ${item.written}`;
        }),
    ).toEqual([]);
  });

  test("the element-building helper is gone", () => {
    expect(
      fs.existsSync(
        path.join(REPOSITORY_PACKAGES, "Common/UI/Utils/Markdown.tsx"),
      ),
    ).toBe(false);

    for (const file of sourceFiles(DASHBOARD_SRC)) {
      expect({
        file: path.relative(REPOSITORY_PACKAGES, file),
        callsCheatsheet: fs
          .readFileSync(file, "utf8")
          .includes("getMarkdownCheatsheet"),
      }).toEqual({
        file: path.relative(REPOSITORY_PACKAGES, file),
        callsCheatsheet: false,
      });
    }
  });

  test("every sentence listed here is still a Markdown field's help", () => {
    const written: Array<string> = found
      .map((item: MarkdownFieldDescription): string | null => {
        return item.literal;
      })
      .filter((literal: string | null): literal is string => {
        return literal !== null;
      });

    for (const sentence of MARKDOWN_FIELD_HELP) {
      expect({ sentence, shown: written.includes(sentence) }).toEqual({
        sentence,
        shown: true,
      });
    }
  });

  test.each(LANGUAGES)("is a sentence of its own in %s", (language: string) => {
    const english: LocaleFile = readLocale("en");
    const locale: LocaleFile = readLocale(language);

    for (const sentence of MARKDOWN_FIELD_HELP) {
      expect(english[sentence]).toBe(sentence);
      expect({ language, sentence, value: locale[sentence] }).not.toEqual({
        language,
        sentence,
        value: sentence,
      });
      expect(typeof locale[sentence]).toBe("string");
    }
  });
});

describe("a field draws its help in the reader's language", () => {
  const instances: Record<string, i18n> = {};

  beforeAll(async () => {
    for (const language of ["en", "de", "ja", "fa"]) {
      const instance: i18n = createInstance();

      // The Dashboard's own configuration (Utils/i18n.ts).
      await instance.init({
        lng: language,
        fallbackLng: "en",
        resources: {
          en: { translation: readLocale("en") },
          [language]: { translation: readLocale(language) },
        },
        interpolation: { escapeValue: false },
      });

      instances[language] = instance;
    }
  });

  afterEach(() => {
    cleanup();
  });

  test.each([
    ["en", "Describe the incident details here."],
    ["de", "Beschreiben Sie hier die Details des Vorfalls."],
    ["ja", "インシデントの詳細をここに記述します。"],
    ["fa", "جزئیات حادثه را اینجا شرح دهید."],
  ])("in %s", (language: string, expected: string) => {
    render(
      <I18nextProvider i18n={instances[language]!}>
        <FieldLabelElement
          title="Description"
          description="Describe the incident details here."
        />
      </I18nextProvider>,
    );

    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(readLocale(language)["Describe the incident details here."]).toBe(
      expected,
    );
  });
});
