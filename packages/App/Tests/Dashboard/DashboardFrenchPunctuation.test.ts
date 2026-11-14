// UX rule: Docs/ux/README.md#in-every-language
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * FRENCH SETS ITS COLON APART (#7679).
 *
 * French writes a space before its colon and its semicolon, as before its
 * question and exclamation marks: "Étape {{number}} : {{fields}}". The
 * Dashboard's French does so after a plain space, more than 3,000 times for
 * a colon and 700 for a semicolon. One translated text did not
 * ("... depuis une analyse IA: {{label}}"). No translated French text puts
 * one of the four right after a word, unless the word and its mark are the
 * English's, as written: a field a search is typed with ("user:"), a
 * setting in a vendor's console ("Value type: ValueFrom"), a flag a
 * reader sets ("sealed: true"). A notation French words is listed below,
 * with the reason.
 */

type LocaleTree = { [key: string]: string | LocaleTree };

const LOCALES: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src/Locales",
);

// A character no key has, to join a nested key's path.
const PATH_JOINER: string = String.fromCharCode(0);

function leaves(tree: LocaleTree, prefix: string = ""): Map<string, string> {
  const found: Map<string, string> = new Map<string, string>();

  for (const [key, value] of Object.entries(tree)) {
    const at: string = prefix ? `${prefix}${PATH_JOINER}${key}` : key;

    if (typeof value === "string") {
      found.set(at, value);
    } else {
      for (const [inner, text] of leaves(value, at)) {
        found.set(inner, text);
      }
    }
  }

  return found;
}

function readLocale(language: string): Map<string, string> {
  return leaves(
    JSON.parse(
      fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
    ) as LocaleTree,
  );
}

const ENGLISH: Map<string, string> = readLocale("en");
const FRENCH: Map<string, string> = readLocale("fr");

// The texts French words its own way: [key, English, French].
const TRANSLATED: Array<[string, string, string]> = Array.from(ENGLISH)
  .filter(([key, english]: [string, string]): boolean => {
    return FRENCH.get(key) !== undefined && FRENCH.get(key) !== english;
  })
  .map(([key, english]: [string, string]): [string, string, string] => {
    return [key, english, FRENCH.get(key) as string];
  });

const PLACEHOLDER: RegExp = /\{\{[^{}]*\}\}/g;
const CODE_SPAN: RegExp = /`[^`]*`/g;
// A word, then a colon, a semicolon, a question or an exclamation mark ending a clause.
const MARK_RIGHT_AFTER_A_WORD: RegExp =
  /\p{L}[\p{L}\p{N}'’.-]*[:;?!](?=\s|$)/gu;
const MARK_AFTER_A_SPACE: (mark: string) => RegExp = (mark: string): RegExp => {
  return new RegExp(` \\${mark}(?=\\s|$)`, "g");
};

// Notations French words and still writes as their owner does, mark and all.
const NOTATIONS: ReadonlyArray<{ written: string; why: string }> = [
  {
    written: "nom-d'en-tête:",
    why: "a header line's notation, name: value, written as a request writes it",
  },
];

// A text without what it carries as written: its code and its placeholders.
function proseOf(text: string): string {
  return text.replace(CODE_SPAN, " ").replace(PLACEHOLDER, " ");
}

// The marks `french` puts right after a word that its English does not have there.
function marksRightAfterAWord(english: string, french: string): Array<string> {
  const englishProse: string = proseOf(english);

  return (proseOf(french).match(MARK_RIGHT_AFTER_A_WORD) || []).filter(
    (written: string): boolean => {
      return (
        !englishProse.includes(written) &&
        !NOTATIONS.some((notation: { written: string }): boolean => {
          return notation.written === written;
        })
      );
    },
  );
}

function countOf(pattern: RegExp): number {
  return TRANSLATED.reduce(
    (count: number, [, , french]: [string, string, string]): number => {
      return count + (proseOf(french).match(pattern) || []).length;
    },
    0,
  );
}

describe("French punctuation in the Dashboard", () => {
  test("French writes its colon and its semicolon after a space", () => {
    // The convention, many times over: a scan that finds none would pass.
    expect(TRANSLATED.length).toBeGreaterThan(40000);
    expect(countOf(MARK_AFTER_A_SPACE(":"))).toBeGreaterThan(3000);
    expect(countOf(MARK_AFTER_A_SPACE(";"))).toBeGreaterThan(700);
  });

  test("no translated French text puts a colon, a semicolon, a question or an exclamation mark right after a word", () => {
    expect(
      TRANSLATED.flatMap(
        ([key, english, french]: [string, string, string]): Array<string> => {
          return marksRightAfterAWord(english, french).map(
            (written: string): string => {
              return `${key} => ${written}`;
            },
          );
        },
      ),
    ).toEqual([]);
  });

  test("an AI insight's task names its insight after a spaced colon", () => {
    expect(
      FRENCH.get("OneUptime started this task from an AI insight: {{label}}"),
    ).toBe("OneUptime a lancé cette tâche depuis une analyse IA : {{label}}");
  });

  test("each notation listed is still one French writes", () => {
    for (const notation of NOTATIONS) {
      expect({
        why: notation.why,
        written: TRANSLATED.some(
          ([, , french]: [string, string, string]): boolean => {
            return proseOf(french).includes(notation.written);
          },
        ),
      }).toEqual({ why: notation.why, written: true });
    }
  });

  test("the check finds a mark right after a word, and leaves the English's own and a spaced one alone (control)", () => {
    expect(
      marksRightAfterAWord(
        "OneUptime started this task from an AI insight: {{label}}",
        "OneUptime a lancé cette tâche depuis une analyse IA: {{label}}",
      ),
    ).toEqual(["IA:"]);
    expect(
      marksRightAfterAWord("Why is it slow?", "Pourquoi est-ce lent? Voyez"),
    ).toEqual(["lent?"]);
    expect(
      marksRightAfterAWord("A; B", "L'étape échoue; la suivante attend"),
    ).toEqual(["échoue;"]);
    expect(
      marksRightAfterAWord(
        "With sealed: true, it was the last segment.",
        "Avec sealed: true, il s'agissait du segment final.",
      ),
    ).toEqual([]);
    expect(
      marksRightAfterAWord(
        "Step {{number}}: {{fields}}",
        "Étape {{number}} : {{fields}} ; `a: b`",
      ),
    ).toEqual([]);
  });
});
