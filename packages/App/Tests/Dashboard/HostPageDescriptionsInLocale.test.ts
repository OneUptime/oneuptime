import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * A host's Processes, Windows services and Systemd units pages describe
 * their table in a few sentences of one paragraph: what it shows, when the
 * latest sample was taken and the page refreshed, and what is missing when
 * the host reports more than the page loads. Each sentence is looked up
 * whole, so the paragraph is wholly in the reader's language - never a
 * German "Letzte Messung vor 3 Minuten." after an English first sentence.
 */

const DASHBOARD: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);
const LOCALES: string = path.join(DASHBOARD, "Locales");

const PAGES: ReadonlyArray<string> = [
  "Pages/Host/View/Processes.tsx",
  "Pages/Host/View/Services.tsx",
  "Pages/Host/View/SystemdUnits.tsx",
];

const LANGUAGES: ReadonlyArray<string> = [
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

const TRANSLATOR_CALLS: ReadonlySet<string> = new Set<string>([
  "translateText",
  "translateTemplate",
  "translatePlural",
]);

// A call on the page's translator, or one with an empty fallback after it.
function isLookedUp(expression: ts.Expression): boolean {
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.BarBarToken
  ) {
    return isLookedUp(expression.left);
  }

  return (
    ts.isCallExpression(expression) &&
    ts.isPropertyAccessExpression(expression.expression) &&
    ts.isIdentifier(expression.expression.expression) &&
    expression.expression.expression.text === "translator" &&
    TRANSLATOR_CALLS.has(expression.expression.name.text)
  );
}

// Every sentence the page's description is built from, as written.
function descriptionSentences(file: string): Array<ts.Expression> {
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    fs.readFileSync(path.join(DASHBOARD, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const sentences: Array<ts.Expression> = [];
  let description: ts.Node | undefined;

  const find: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "description"
    ) {
      description = node;
      return;
    }

    ts.forEachChild(node, find);
  };

  find(source);

  const collect: (node: ts.Node) => void = (node: ts.Node): void => {
    // const parts: Array<string> = [ ... ];
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "parts" &&
      node.initializer &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      sentences.push(...node.initializer.elements);
    }

    // parts.push( ... );
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "parts" &&
      node.expression.name.text === "push"
    ) {
      sentences.push(...node.arguments);
    }

    ts.forEachChild(node, collect);
  };

  if (description) {
    collect(description);
  }

  return sentences;
}

describe("a host page's table description is one paragraph in the reader's language", () => {
  test.each(PAGES)(
    "%s looks up every sentence it is built from",
    (page: string) => {
      const sentences: Array<ts.Expression> = descriptionSentences(page);

      // A reading that found no description would pass anything.
      expect(sentences.length).toBeGreaterThanOrEqual(3);

      const written: Array<string> = sentences
        .filter((sentence: ts.Expression): boolean => {
          return !isLookedUp(sentence);
        })
        .map((sentence: ts.Expression): string => {
          return sentence.getText();
        });

      expect(written).toEqual([]);
    },
  );

  test.each(LANGUAGES)(
    "%s words every one of those sentences",
    (language: string) => {
      const english: Record<string, unknown> = JSON.parse(
        fs.readFileSync(path.join(LOCALES, "en.json"), "utf8"),
      ) as Record<string, unknown>;
      const locale: Record<string, unknown> = JSON.parse(
        fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
      ) as Record<string, unknown>;
      const keys: Array<string> = [
        "Latest snapshot of processes on this host (last {{count}} minutes).",
        "Windows services on this host (last {{count}} minutes).",
        "Systemd units on this host (last {{count}} minutes).",
        "Latest sample {{time}}.",
        "Refreshed {{time}}.",
        'This host reports more processes than this page can load at once, so some may be missing or show no CPU or memory reading — narrow the collector\'s "process" scraper with include or exclude filters to see a complete list.',
        'This host reports more than {{count}} units per scrape, so some are not listed — narrow the receiver\'s "units" patterns to see a complete list.',
      ];

      for (const key of keys) {
        expect(english[key]).toBe(key);
        expect(typeof locale[key]).toBe("string");
        expect(locale[key]).not.toBe(key);
      }
    },
  );
});
