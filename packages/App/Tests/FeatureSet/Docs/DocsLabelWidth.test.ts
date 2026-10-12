import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { CharacterClass, characterClassesOf } from "./DocsCodeScanning";
import {
  DocsFence,
  listPages,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import { diagramLabelLines, labelLineWidth } from "./DocsTranslationChecks";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * How wide a diagram's label line draws, in Latin letters: labelLineWidth
 * counts a character of the Chinese, Japanese and Korean scripts twice. The
 * suites hold the diagrams that fill the 590px docs column to label lines
 * measured to fit it, in a browser, in every language
 * (NetworkDocsTranslations, StatusPageDocsTranslations,
 * ProbeDocsTranslations, CloudDocsTranslations).
 *
 * The class of wide characters used to be ranges typed as characters, and
 * code scanning reported two of them overlapping (#2216, #2217): the first
 * CJK compatibility ideograph, typed to start the fourth range, had become
 * its canonical twin in CJK Unified Ideographs, so that range also took in
 * Yi, Vai, Javanese, Cherokee, Latin Extended-D, the private use area and,
 * through its surrogates, every emoji. Now the class names its scripts and
 * the exact blocks of their punctuation. These tests hold it to that, and to
 * the measurements: every character any docs diagram draws, in every
 * language, counts as it did when the limits were measured - a narrower
 * count would let every 590px guard pass a diagram that no longer fits.
 */

const DOCS_TESTS_DIR: string = __dirname;
const SHARED_CHECKS_FILE: string = "DocsTranslationChecks.ts";

const character: (codePoint: number) => string = (
  codePoint: number,
): string => {
  return String.fromCodePoint(codePoint);
};

const hex: (codePoint: number) => string = (codePoint: number): string => {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
};

// The scripts the class names, and the blocks it takes whole.
const NAMED_SCRIPTS: ReadonlyArray<string> = [
  "\\p{Script=Han}",
  "\\p{Script=Hiragana}",
  "\\p{Script=Katakana}",
  "\\p{Script=Hangul}",
  "\\p{Script=Bopomofo}",
];
const WHOLE_BLOCKS: ReadonlyArray<[string, number, number]> = [
  ["Ideographic Description Characters", 0x2ff0, 0x2fff],
  ["CJK Symbols and Punctuation", 0x3000, 0x303f],
  ["Hiragana", 0x3040, 0x309f],
  ["Katakana", 0x30a0, 0x30ff],
  ["Kanbun", 0x3190, 0x319f],
  ["CJK Strokes", 0x31c0, 0x31ef],
  ["Enclosed CJK Letters and Months", 0x3200, 0x32ff],
  ["CJK Compatibility", 0x3300, 0x33ff],
  ["Halfwidth and Fullwidth Forms", 0xff00, 0xffef],
];

/*
 * What the 590px measurements counted twice (#4688, #4690, #4694): the CJK
 * blocks from Hangul Jamo to Halfwidth and Fullwidth Forms, as code point
 * ranges. One copy of the old class also took in U+8C48-U+FAFF and every
 * character past U+FFFF; no docs diagram has drawn one of those that the
 * other copy counted once.
 */
const MEASURED_WIDE: ReadonlyArray<[number, number]> = [
  [0x1100, 0x11ff],
  [0x2e80, 0x9fff],
  [0xac00, 0xd7af],
  [0xf900, 0xfaff],
  [0xff00, 0xffef],
];

function measuredWidth(text: string): number {
  return Array.from(text).reduce((width: number, part: string): number => {
    const codePoint: number = part.codePointAt(0) as number;
    const isWide: boolean = MEASURED_WIDE.some(
      ([low, high]: [number, number]): boolean => {
        return codePoint >= low && codePoint <= high;
      },
    );

    return width + (isWide ? 2 : 1);
  }, 0);
}

// The class of wide characters, as DocsTranslationChecks writes it.
function wideCharacterClass(): CharacterClass {
  const file: string = path.join(DOCS_TESTS_DIR, SHARED_CHECKS_FILE);
  const source: ts.SourceFile = ts.createSourceFile(
    SHARED_CHECKS_FILE,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const literals: Array<string> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "WIDE_CHARACTER" &&
      node.initializer !== undefined &&
      ts.isRegularExpressionLiteral(node.initializer)
    ) {
      literals.push(node.initializer.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  expect(literals).toHaveLength(1);

  const literal: string = literals[0] as string;
  const lastSlash: number = literal.lastIndexOf("/");
  const classes: Array<CharacterClass> = characterClassesOf(
    literal.slice(1, lastSlash),
    literal.slice(lastSlash + 1),
  );

  expect(literal.slice(lastSlash + 1)).toBe("u");
  expect(classes).toHaveLength(1);

  return classes[0] as CharacterClass;
}

// Every mermaid diagram of every page, in every docs language.
function everyDiagram(): Array<{ where: string; fence: DocsFence }> {
  const diagrams: Array<{ where: string; fence: DocsFence }> = [];

  for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
    for (const page of listPages(language)) {
      for (const fence of scanMarkdown(readPage(language, page)).fences) {
        if (fence.lang === "mermaid") {
          diagrams.push({ where: `${language}/${page}`, fence: fence });
        }
      }
    }
  }

  return diagrams;
}

describe("the class of wide characters", () => {
  it("names the scripts it counts, takes whole blocks for their punctuation, and has the u flag", () => {
    const wide: CharacterClass = wideCharacterClass();

    expect(wide.negated).toBe(false);
    expect(wide.characters).toEqual([]);
    expect(wide.classEscapes).toEqual([]);
    expect(wide.propertyEscapes).toEqual(NAMED_SCRIPTS);
    expect(
      wide.ranges.map((range: { low: number; high: number }): string => {
        return `${hex(range.low)}-${hex(range.high)}`;
      }),
    ).toEqual(
      WHOLE_BLOCKS.map(([, low, high]: [string, number, number]): string => {
        return `${hex(low)}-${hex(high)}`;
      }),
    );
  });

  it("writes each range's bounds as escapes, never as the characters", () => {
    for (const range of wideCharacterClass().ranges) {
      expect(range.text).toMatch(/^\\u\{[0-9A-F]{4}\}-\\u\{[0-9A-F]{4}\}$/);
    }
  });
});

describe("labelLineWidth counts by script", () => {
  it.each([
    ["a Chinese character", 0x4e2d],
    ["a Chinese character past U+FFFF", 0x20000],
    ["a CJK compatibility ideograph", 0xf900],
    ["its canonical twin", 0x8c48],
    ["Hiragana", 0x3042],
    ["Katakana", 0x30ab],
    ["the long vowel mark", 0x30fc],
    ["the katakana middle dot", 0x30fb],
    ["a kana sound mark", 0x309b],
    ["a Hangul syllable", 0xd55c],
    ["a Hangul jamo", 0x1100],
    ["a Hangul compatibility jamo", 0x3131],
    ["Bopomofo", 0x3105],
    ["the ideographic comma", 0x3001],
    ["the ideographic full stop", 0x3002],
    ["a corner bracket", 0x300c],
    ["the wave dash", 0x301c],
    ["the ideographic space", 0x3000],
    ["a fullwidth parenthesis", 0xff08],
    ["a fullwidth colon", 0xff1a],
    ["a fullwidth Latin letter", 0xff21],
    ["an enclosed ideograph", 0x3231],
    ["a squared unit", 0x338f],
    ["a kanbun mark", 0x3190],
    ["a CJK stroke", 0x31c0],
    ["an ideographic description character", 0x2ff0],
  ])("counts %s twice", (_name: string, codePoint: number) => {
    expect(labelLineWidth(character(codePoint))).toBe(2);
  });

  it.each([
    ["a Latin letter", 0x41],
    ["an accented Latin letter", 0xe9],
    ["a digit", 0x37],
    ["a space", 0x20],
    ["Cyrillic", 0x436],
    ["Greek", 0x3bb],
    ["Arabic, as Persian writes it", 0x628],
    ["a Persian digit", 0x6f3],
    ["Devanagari", 0x915],
    ["Hebrew", 0x5d0],
    ["the middle dot", 0xb7],
    ["an arrow", 0x2192],
    ["an ellipsis", 0x2026],
    ["an em dash", 0x2014],
    ["an emoji", 0x1f600],
    ["an emoji of the Basic Multilingual Plane", 0x2705],
    // What the old class counted twice by mistake, from U+8C48 on.
    ["Yi", 0xa000],
    ["Vai", 0xa500],
    ["Cyrillic Extended-B", 0xa640],
    ["Latin Extended-D", 0xa722],
    ["Javanese", 0xa984],
    ["Cherokee", 0xab70],
    ["Meetei Mayek", 0xabc0],
    ["a private use character", 0xe000],
    // The block the old ranges took in between Chinese characters.
    ["a Yijing hexagram", 0x4dc0],
  ])("counts %s once", (_name: string, codePoint: number) => {
    expect(labelLineWidth(character(codePoint))).toBe(1);
  });

  it("adds up a line's characters", () => {
    expect(labelLineWidth("")).toBe(0);
    expect(labelLineWidth("Status page")).toBe(11);
    expect(labelLineWidth("\u{72B6}\u{6001}\u{9875}")).toBe(6);
    // "OneUptime" and a space, then four katakana with their long vowel marks.
    expect(labelLineWidth("OneUptime \u{30B5}\u{30FC}\u{30D0}\u{30FC}")).toBe(
      18,
    );
    // A Japanese line with its commas: 6 + 1 + 3 + 1 + 4 characters.
    expect(
      labelLineWidth(
        "\u{30A6}\u{30A7}\u{30D6}\u{30B5}\u{30A4}\u{30C8}\u{3001}API\u{3001}\u{30B5}\u{30FC}\u{30D0}\u{30FC}",
      ),
    ).toBe(27);
    expect(labelLineWidth("\u{C0C1}\u{D0DC} \u{D398}\u{C774}\u{C9C0}")).toBe(
      11,
    );
  });
});

describe("every docs diagram, in every language", () => {
  const diagrams: Array<{ where: string; fence: DocsFence }> = everyDiagram();

  it("is read: every language's pages, and their diagrams of every kind", () => {
    const languages: Set<string> = new Set(
      diagrams.map((diagram: { where: string }): string => {
        return diagram.where.split("/")[0] as string;
      }),
    );
    const kinds: Set<string> = new Set(
      diagrams.map((diagram: { fence: DocsFence }): string => {
        return diagram.fence.code.trimStart().split(/\s/)[0] as string;
      }),
    );

    expect(languages.size).toBe(SUPPORTED_DOCS_LANGUAGE_CODES.length);
    expect(diagrams.length).toBeGreaterThan(3000);
    expect(kinds).toEqual(
      new Set(["flowchart", "sequenceDiagram", "stateDiagram-v2"]),
    );
  });

  it("counts every character it draws as the 590px measurements counted it", () => {
    const drawnAt: Map<string, string> = new Map();

    for (const diagram of diagrams) {
      for (const part of Array.from(
        `${diagram.fence.info}\n${diagram.fence.code}`,
      )) {
        if (!drawnAt.has(part)) {
          drawnAt.set(part, diagram.where);
        }
      }
    }

    const counted: Array<string> = [];

    for (const [part, where] of drawnAt) {
      if (labelLineWidth(part) !== measuredWidth(part)) {
        counted.push(
          `${hex(part.codePointAt(0) as number)} ${part} (${where}): counts ${labelLineWidth(part)}, measured ${measuredWidth(part)}`,
        );
      }
    }

    expect(counted).toEqual([]);
    // Chinese, Japanese and Korean characters among them, and others.
    expect(drawnAt.size).toBeGreaterThan(1500);
  });

  it("draws each of its label lines as wide as it was measured", () => {
    const changed: Array<string> = [];
    let lines: number = 0;

    for (const diagram of diagrams) {
      for (const line of diagramLabelLines(diagram.fence.code)) {
        lines++;

        if (labelLineWidth(line) !== measuredWidth(line)) {
          changed.push(
            `${diagram.where}: ${JSON.stringify(line)} is ${labelLineWidth(line)}, measured ${measuredWidth(line)}`,
          );
        }
      }
    }

    expect(changed).toEqual([]);
    expect(lines).toBeGreaterThan(30000);
  });
});
