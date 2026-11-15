// UX rule: Docs/ux/README.md#in-every-language
import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  SetupGuideContent,
  SetupGuideStep,
  SetupGuideTopic,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import {
  SetupGuidePiece,
  SetupGuideTranslation,
  SetupGuideWords,
  getSetupGuidePieceShape,
  getSetupGuidePieces,
  getSetupGuideWordPieces,
  getSetupGuideWords,
  translateSetupGuideContent,
  translateSetupGuidePiece,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuideTranslation";
import { SUPPORTED_DASHBOARD_LANGUAGE_CODES } from "../../../Types/Dashboard/DashboardLanguage";
import { escapeRegExp } from "../../../Utils/RegExpEscape";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import {
  SETUP_GUIDE_DOCUMENTATION_PRODUCTS,
  SetupGuideDocumentationProduct,
} from "../../Helpers/SetupGuideDocumentationProducts";
import { SetupGuideWay } from "../../Helpers/SetupGuideWays";

/*
 * A PRODUCT'S SETUP GUIDE, IN EVERY LANGUAGE THE DASHBOARD IS READ IN (#8341).
 *
 * A product's Help > Documentation page is its setup guide, and the guide's
 * markdown - every step's body, tab and topic - was English in every
 * language: a German reader read "Replace `my-docker-host` with a name for
 * this host" under a German step title. Each guide now holds, per
 * language, each piece of its markdown in that language's words
 * (SetupGuideTranslation), and the card draws the reader's.
 *
 * Read for every way through each guide (SetupGuideWays): the option, the
 * key picked or not, a resource's own tab. In every language, every piece
 * has its words, and the guide keeps what is written as it is: each code
 * block byte for byte, each code span and link, each list, heading, table
 * and quote. What the Dashboard draws - a tab, a page, a topic - is named
 * as the reader's locale words it, and so is every title, description and
 * note of the guide.
 */

const FENCED_BLOCK: RegExp = /^\s*```[^\n]*\n[\s\S]*?^\s*```[ \t]*$/gm;

const CODE_SPAN: RegExp = /`[^`\n]+`/g;

const LINK_TARGET: RegExp = /\]\([^)\s]*\)/g;

// A letter of the Arabic script: Arabic's and Persian's words.
const ARABIC_SCRIPT: RegExp = /\p{Script=Arabic}/u;

// A half-width ? or ! right after a Chinese or Japanese character.
const HALF_WIDTH_AFTER_CJK: RegExp = /[\u3040-\u30ff\u3400-\u9fff][?!]/u;

// A bold mark, and what CommonMark reads beside one: space and punctuation.
const BOLD_MARK: RegExp = /\*\*/g;

const MARKDOWN_SPACE: RegExp = /\s/u;

const MARKDOWN_PUNCTUATION: RegExp = /[\p{P}\p{S}]/u;

// Each language's words for each product, as its module exports them.
const MODULES: Record<string, Record<string, SetupGuideTranslation>> = {};

const WORDS: Record<string, Record<string, SetupGuideWords>> = {};

const WAYS: Record<string, Array<SetupGuideWay>> = {};

// Every markdown text of a guide, in reading order.
function markdownsOf(content: SetupGuideContent): Array<string> {
  const markdowns: Array<string> = [
    content.intro || "",
    ...(content.prerequisites || []),
  ];

  content.steps.forEach((step: SetupGuideStep): void => {
    markdowns.push(step.markdown || "");
    for (const variant of step.variants || []) {
      markdowns.push(variant.markdown);
    }
    markdowns.push(step.details || "");
  });

  for (const topic of [
    ...(content.advanced || []),
    ...(content.troubleshooting || []),
  ]) {
    markdowns.push(topic.markdown);
  }

  return markdowns;
}

// What a guide says outside its markdown: the keys the card words.
function keysOf(content: SetupGuideContent): Array<string> {
  const keys: Array<string> = [];

  for (const step of content.steps) {
    keys.push(step.title);
    if (step.description) {
      keys.push(step.description);
    }
    if (step.note) {
      keys.push(step.note);
    }
    for (const variant of step.variants || []) {
      keys.push(variant.label);
    }
  }

  for (const topic of [
    ...(content.advanced || []),
    ...(content.troubleshooting || []),
  ] as Array<SetupGuideTopic>) {
    keys.push(topic.title);
    if (topic.summary) {
      keys.push(topic.summary);
    }
  }

  for (const link of content.links || []) {
    keys.push(link.title);
  }

  return keys;
}

/*
 * The locale key a title is: itself, or - for a title the guide fills in
 * with translateTemplate, in the reader's language where it is drawn
 * ('Host shows up as "docker-host" or a container ID') - the template it
 * fills.
 */
function keyOf(text: string): string {
  const english: Record<string, string> = readDashboardLocale("en");

  if (english[text] !== undefined) {
    return text;
  }

  const template: string | undefined = Object.keys(english).find(
    (key: string): boolean => {
      if (!key.includes("{{")) {
        return false;
      }
      const pattern: string = key
        .split(/\{\{\s*[\w.]+\s*\}\}/)
        .map(escapeRegExp)
        .join(".+");
      return new RegExp(`^${pattern}$`).test(text);
    },
  );

  return template || text;
}

function codeBlocks(text: string): Array<string> {
  return (text.match(FENCED_BLOCK) || []).map((block: string): string => {
    return block;
  });
}

function sorted(items: Array<string>): Array<string> {
  return [...items].sort();
}

// Each piece's kind and size: a list item, a heading's level, a table row's cells, a quote.
function skeletonOf(markdown: string): Array<string> {
  return getSetupGuidePieces(markdown).map((piece: SetupGuidePiece): string => {
    if (!piece.isWords) {
      return piece.text.trim() ? piece.text : "";
    }
    const text: string = piece.text;
    const list: RegExpMatchArray | null = text.match(/^\s*(?:[-*+]|\d+[.)])\s/);
    if (list) {
      return `list ${list[0]}`;
    }
    const heading: RegExpMatchArray | null = text.match(/^\s*#{1,6}\s/);
    if (heading) {
      return `heading ${heading[0].trim()}`;
    }
    if (text.trimStart().startsWith("|")) {
      return `row of ${text.split("|").length}`;
    }
    if (text.trimStart().startsWith(">")) {
      return "quote";
    }
    return "paragraph";
  });
}

// The bold runs of a text, without their marks.
function boldRuns(text: string): Array<string> {
  return Array.from(text.matchAll(/\*\*([^*]+)\*\*/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

function withoutEndMark(text: string): string {
  return text.replace(/[\s:.]+$/, "");
}

// The start or end of a text reads as a space beside a mark.
function isMarkdownSpace(character: string | undefined): boolean {
  return character === undefined || MARKDOWN_SPACE.test(character);
}

function isMarkdownPunctuation(character: string | undefined): boolean {
  return character !== undefined && MARKDOWN_PUNCTUATION.test(character);
}

/*
 * The bold marks of a text that CommonMark (LazyMarkdownViewer) would draw
 * as asterisks: each odd ** has to open a bold run and each even one close
 * it. A mark beside punctuation, a code span's backtick or a bracket, only
 * does so with a space or more punctuation on its other side, so a Korean
 * particle or an Arabic "و" glued to the mark leaves it showing, as in
 * "**`web-1`**용". Code spans are read as their backticks.
 */
function boldMarksThatShow(text: string): Array<string> {
  const read: string = text.replace(CODE_SPAN, (span: string): string => {
    return "`" + "x".repeat(span.length - 2) + "`";
  });

  return Array.from(read.matchAll(BOLD_MARK))
    .filter((match: RegExpMatchArray, nth: number): boolean => {
      const at: number = match.index!;
      const before: string | undefined = read[at - 1];
      const after: string | undefined = read[at + 2];

      if (nth % 2 === 0) {
        return (
          isMarkdownSpace(after) ||
          (isMarkdownPunctuation(after) &&
            !isMarkdownSpace(before) &&
            !isMarkdownPunctuation(before))
        );
      }

      return (
        isMarkdownSpace(before) ||
        (isMarkdownPunctuation(before) &&
          !isMarkdownSpace(after) &&
          !isMarkdownPunctuation(after))
      );
    })
    .map((match: RegExpMatchArray): string => {
      return text.slice(Math.max(0, match.index! - 12), match.index! + 14);
    });
}

beforeAll(async () => {
  for (const product of SETUP_GUIDE_DOCUMENTATION_PRODUCTS) {
    WAYS[product.name] = product.ways();
    MODULES[product.name] = {};
    WORDS[product.name] = {};

    for (const language of DASHBOARD_LANGUAGES) {
      const load:
        | (() => Promise<{ default: SetupGuideTranslation }>)
        | undefined = product.translations[language];

      if (!load) {
        continue;
      }

      try {
        const translation: SetupGuideTranslation = (await load()).default;
        MODULES[product.name]![language] = translation;
        WORDS[product.name]![language] = getSetupGuideWords({
          language: language,
          translation: translation,
        });
      } catch {
        // A module that cannot be loaded fails "every language ... has a module".
      }
    }
  }
});

describe.each(
  SETUP_GUIDE_DOCUMENTATION_PRODUCTS.map(
    (
      product: SetupGuideDocumentationProduct,
    ): [string, SetupGuideDocumentationProduct] => {
      return [product.name, product];
    },
  ),
)(
  "the %s guide's words",
  (_name: string, product: SetupGuideDocumentationProduct) => {
    test("every language but English has a module, and no other code does", () => {
      expect(Object.keys(product.translations).sort()).toEqual(
        SUPPORTED_DASHBOARD_LANGUAGE_CODES.filter((code: string): boolean => {
          return code !== "en";
        }).sort(),
      );

      for (const language of DASHBOARD_LANGUAGES) {
        expect({
          language,
          loaded: MODULES[product.name]![language] !== undefined,
        }).toEqual({ language, loaded: true });
      }

      expect(fs.readdirSync(product.translationsDirectory).sort()).toEqual(
        DASHBOARD_LANGUAGES.map((language: string): string => {
          return `${language}.ts`;
        }).sort(),
      );
    });

    test("each module is a chunk of its own, fetched only by its reader", () => {
      const loaders: string = fs.readFileSync(product.loadersFile, "utf8");

      expect(loaders).not.toMatch(/from "\.\.\/DocumentationTranslations\//);

      for (const language of DASHBOARD_LANGUAGES) {
        expect(loaders).toContain(
          `import("../DocumentationTranslations/${language}")`,
        );
      }
    });

    /*
     * As its translations, alone or as what a guide in its reader's
     * language is handed (Databases: the product guide, not a database's
     * own tab).
     */
    test("the card hands the guide its words", () => {
      const card: string = fs.readFileSync(product.cardFile, "utf8");

      expect(card).toMatch(
        new RegExp(
          `translations=\\{[^{}]*\\b${product.translationsConstant}\\b[^{}]*\\}`,
        ),
      );
    });

    test("the guide has pieces to word, in every way through it", () => {
      expect(WAYS[product.name]!.length).toBeGreaterThan(3);

      for (const way of WAYS[product.name]!) {
        expect({
          way: way.label,
          pieces: getSetupGuideWordPieces(way.content).length > 5,
        }).toEqual({ way: way.label, pieces: true });
      }
    });

    describe.each([...DASHBOARD_LANGUAGES])("in %s", (language: string) => {
      const words: () => SetupGuideWords = (): SetupGuideWords => {
        return WORDS[product.name]![language]!;
      };

      test("every piece of every way through the guide has its words", () => {
        const missing: Set<string> = new Set<string>();

        for (const way of WAYS[product.name]!) {
          for (const piece of getSetupGuideWordPieces(way.content)) {
            if (translateSetupGuidePiece(piece, words()) === undefined) {
              missing.add(piece);
            }
          }
        }

        expect([...missing]).toEqual([]);
      });

      test("no piece reads as its English", () => {
        const asEnglish: Array<string> = Object.entries(
          MODULES[product.name]![language]!,
        )
          .filter(([english, translated]: [string, string]): boolean => {
            return english === translated;
          })
          .map(([english]: [string, string]): string => {
            return english;
          });

        expect(asEnglish).toEqual([]);
      });

      test("every module entry is a piece of the guide: none left over from an old English", () => {
        const shapes: Set<string> = new Set<string>();

        for (const way of WAYS[product.name]!) {
          for (const piece of getSetupGuideWordPieces(way.content)) {
            shapes.add(getSetupGuidePieceShape(piece));
          }
        }

        const leftOver: Array<string> = Object.keys(
          MODULES[product.name]![language]!,
        ).filter((english: string): boolean => {
          return !shapes.has(getSetupGuidePieceShape(english));
        });

        expect(leftOver).toEqual([]);
      });

      test("each entry keeps its English's code spans and links, as often as it writes them", () => {
        for (const [english, translated] of Object.entries(
          MODULES[product.name]![language]!,
        )) {
          expect({
            english,
            code: sorted(translated.match(CODE_SPAN) || []),
            links: sorted(translated.match(LINK_TARGET) || []),
          }).toEqual({
            english,
            code: sorted(english.match(CODE_SPAN) || []),
            links: sorted(english.match(LINK_TARGET) || []),
          });
        }
      });

      test("every way through the guide keeps its code blocks byte for byte, and its code, links, lists, headings, tables and quotes", () => {
        for (const way of WAYS[product.name]!) {
          const english: Array<string> = markdownsOf(way.content);
          const translated: Array<string> = markdownsOf(
            translateSetupGuideContent(way.content, words()),
          );

          expect(translated).toHaveLength(english.length);

          english.forEach((markdown: string, index: number): void => {
            const drawn: string = translated[index]!;

            expect({
              way: way.label,
              index,
              blocks: codeBlocks(drawn),
            }).toEqual({ way: way.label, index, blocks: codeBlocks(markdown) });
            expect({
              way: way.label,
              index,
              code: sorted(
                drawn.replace(FENCED_BLOCK, "").match(CODE_SPAN) || [],
              ),
            }).toEqual({
              way: way.label,
              index,
              code: sorted(
                markdown.replace(FENCED_BLOCK, "").match(CODE_SPAN) || [],
              ),
            });
            expect({
              way: way.label,
              index,
              links: sorted(drawn.match(LINK_TARGET) || []),
            }).toEqual({
              way: way.label,
              index,
              links: sorted(markdown.match(LINK_TARGET) || []),
            });
            expect({
              way: way.label,
              index,
              skeleton: skeletonOf(drawn),
            }).toEqual({
              way: way.label,
              index,
              skeleton: skeletonOf(markdown),
            });
          });
        }
      });

      test("no piece of any way is drawn in English", () => {
        const left: Set<string> = new Set<string>();

        for (const way of WAYS[product.name]!) {
          const englishPieces: Set<string> = new Set(
            getSetupGuideWordPieces(way.content),
          );
          const drawn: Array<string> = getSetupGuideWordPieces(
            translateSetupGuideContent(way.content, words()),
          );

          for (const piece of drawn) {
            if (englishPieces.has(piece)) {
              left.add(piece);
            }
          }
        }

        expect([...left]).toEqual([]);
      });

      test("what the Dashboard draws is named, in bold, as the reader's locale words it", () => {
        const locale: Record<string, string> = readDashboardLocale(language);

        for (const [english, translated] of Object.entries(
          MODULES[product.name]![language]!,
        )) {
          const runs: Array<string> = boldRuns(translated).map(withoutEndMark);

          for (const run of boldRuns(english).map(withoutEndMark)) {
            const steps: Array<string> = run.split(/\s*→\s*/);

            if (
              !steps.every((step: string): boolean => {
                return product.dashboardWords.includes(step);
              })
            ) {
              continue;
            }

            const named: boolean = runs.some((drawnRun: string): boolean => {
              const drawnSteps: Array<string> = drawnRun.split(/\s*[→←]\s*/);
              const expected: Array<string> = steps.map(
                (step: string): string => {
                  return locale[step]!;
                },
              );
              return (
                JSON.stringify(sorted(drawnSteps)) ===
                JSON.stringify(sorted(expected))
              );
            });

            expect({ english: run, translated, named }).toEqual({
              english: run,
              translated,
              named: true,
            });
          }
        }
      });

      /*
       * A browser never turns an arrow round. Between two steps of a path
       * an arrow points the way the line is read: in Arabic and Persian
       * "←" beside a step in the language, "→" between two left in Latin
       * letters (the locale files' rule, PathArrowsInRightToLeftSentences);
       * in every other language "→".
       */
      test("an arrow between two steps points the way the language reads", () => {
        const readsFromTheRight: boolean = ["ar", "fa"].includes(language);

        for (const [english, translated] of Object.entries(
          MODULES[product.name]![language]!,
        )) {
          const prose: string = translated.replace(CODE_SPAN, "`");

          for (const match of prose.matchAll(
            /([^\s*]+)\s*([→←])\s*([^\s*]+)/gu,
          )) {
            const latinOnly: boolean = [match[1]!, match[3]!].every(
              (step: string): boolean => {
                return !ARABIC_SCRIPT.test(step);
              },
            );
            const expected: string =
              readsFromTheRight && !latinOnly ? "←" : "→";

            expect({ english, path: match[0], arrow: match[2] }).toEqual({
              english,
              path: match[0],
              arrow: expected,
            });
          }
        }
      });

      // As ja.json and the Chinese files do (DashboardJapaneseLocale).
      test("Chinese and Japanese end a question or an exclamation with a full-width mark", () => {
        if (!["ja", "zh-CN", "zh-TW"].includes(language)) {
          return;
        }

        const halfWidthAfterTheirText: Array<string> = Object.values(
          MODULES[product.name]![language]!,
        ).filter((translated: string): boolean => {
          return HALF_WIDTH_AFTER_CJK.test(translated.replace(CODE_SPAN, "`"));
        });

        expect(halfWidthAfterTheirText).toEqual([]);
      });

      test("every bold run opens and closes as Markdown reads it, its asterisks never drawn", () => {
        const showing: Array<string> = Object.values(
          MODULES[product.name]![language]!,
        ).flatMap((translated: string): Array<string> => {
          return boldMarksThatShow(translated);
        });

        expect(showing).toEqual([]);
      });

      test("Advanced and Troubleshooting are named as the guide's own sections are", () => {
        const locale: Record<string, string> = readDashboardLocale(language);

        for (const [english, translated] of Object.entries(
          MODULES[product.name]![language]!,
        )) {
          for (const section of ["Advanced", "Troubleshooting"]) {
            if (
              new RegExp(`\\b${section}\\b`).test(
                english.replace(CODE_SPAN, ""),
              )
            ) {
              expect({
                english,
                section,
                named: translated.includes(locale[section]!),
              }).toEqual({
                english,
                section,
                named: true,
              });
            }
          }
        }
      });

      test("every title, description, note, tab and option of the guide is worded in the locale", () => {
        const keys: Set<string> = new Set<string>();

        for (const way of WAYS[product.name]!) {
          for (const key of keysOf(way.content)) {
            keys.add(key);
          }
        }

        for (const option of product.options) {
          keys.add(option.label);
          if (option.description) {
            keys.add(option.description);
          }
        }

        const notWorded: Array<string> = [...keys].filter(
          (key: string): boolean => {
            return !isWordedInDashboardLocale(keyOf(key), language);
          },
        );

        expect(notWorded).toEqual([]);
      });

      test("is a module of its own words, with its header", () => {
        const source: string = fs.readFileSync(
          path.join(product.translationsDirectory, `${language}.ts`),
          "utf8",
        );

        expect(source).toContain(`The ${product.name} setup guide in `);
        expect(source).toContain("export default TRANSLATION;");
        expect(
          Object.keys(MODULES[product.name]![language]!).length,
        ).toBeGreaterThan(20);
      });
    });
  },
);

describe("the checks above (negative control)", () => {
  const product: SetupGuideDocumentationProduct =
    SETUP_GUIDE_DOCUMENTATION_PRODUCTS[0]!;

  test("a piece with no words, a code span translated, a row lost and an English piece left are all caught", () => {
    const translation: SetupGuideTranslation = MODULES[product.name]!["de"]!;
    const entries: Array<[string, string]> = Object.entries(translation);
    const [firstEnglish] = entries[0]!;

    // A piece the language has no words for reads in English.
    const withoutFirst: SetupGuideWords = getSetupGuideWords({
      language: "de",
      translation: Object.fromEntries(entries.slice(1)),
    });
    expect(
      translateSetupGuidePiece(firstEnglish, withoutFirst),
    ).toBeUndefined();

    // A code span translated no longer matches its English's.
    const [withCode, words] = entries.find(
      ([english]: [string, string]): boolean => {
        return english.includes("`");
      },
    )!;
    const firstSpan: string = withCode.match(CODE_SPAN)![0]!;
    const translatedSpan: string = words.replace(firstSpan, "`übersetzt`");
    expect(sorted(translatedSpan.match(CODE_SPAN) || [])).not.toEqual(
      sorted(withCode.match(CODE_SPAN) || []),
    );

    // A table row with a cell lost no longer has its English's shape.
    const [row, rowWords] = entries.find(
      ([english]: [string, string]): boolean => {
        return english.startsWith("|");
      },
    )!;
    expect(skeletonOf(rowWords.replace(/\|[^|]*\|$/, "|"))).not.toEqual(
      skeletonOf(row),
    );

    // An English piece left in a drawn guide is found.
    const way: SetupGuideWay = WAYS[product.name]![0]!;
    const english: Set<string> = new Set(getSetupGuideWordPieces(way.content));
    const drawn: Array<string> = getSetupGuideWordPieces(
      translateSetupGuideContent(way.content, withoutFirst),
    );
    const firstShape: string = getSetupGuidePieceShape(firstEnglish);
    const leftInEnglish: Array<string> = drawn.filter(
      (piece: string): boolean => {
        return (
          english.has(piece) && getSetupGuidePieceShape(piece) === firstShape
        );
      },
    );
    const hasFirst: boolean = getSetupGuideWordPieces(way.content).some(
      (piece: string): boolean => {
        return getSetupGuidePieceShape(piece) === firstShape;
      },
    );
    expect(leftInEnglish.length > 0).toBe(hasFirst);
  });

  test("a Dashboard word in English, or worded otherwise, is not the locale's", () => {
    const locale: Record<string, string> = readDashboardLocale("de");

    expect(locale["Overview"]).toBe("Übersicht");
    expect(boldRuns("die **Overview** des Hosts")).not.toContain(
      locale["Overview"],
    );
    expect(isWordedInDashboardLocale("Overview", "de")).toBe(true);
  });

  test("a bold mark glued to a word on its punctuation side is caught, and one set apart is not", () => {
    expect(
      boldMarksThatShow("이 명령은 **`web-1`**용으로 설치합니다"),
    ).toHaveLength(1);
    expect(
      boldMarksThatShow("**(k8s-file 로그 드라이버)**을 참조하세요"),
    ).toHaveLength(1);
    expect(boldMarksThatShow("في الخطوة 1، و**`swarm-1`** اسمًا")).toHaveLength(
      1,
    );
    expect(boldMarksThatShow("** loose** and **loose **")).toHaveLength(2);

    expect(
      boldMarksThatShow("이 명령은 **`web-1`** 호스트용으로 설치합니다"),
    ).toEqual([]);
    expect(boldMarksThatShow("وأدخل **`swarm-1`** اسمًا")).toEqual([]);
    expect(
      boldMarksThatShow(
        "die **Übersicht**, der **`json-file`**-Treiber und (**N**)",
      ),
    ).toEqual([]);
    expect(boldMarksThatShow("`a**b` **`ceph-1`**: ok")).toEqual([]);
  });
});
