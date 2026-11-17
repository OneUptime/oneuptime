import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import * as React from "react";
import { initReactI18next } from "react-i18next";

/*
 * DATA OBSERVABILITY > HELP > DOCUMENTATION, IN THE READER'S LANGUAGE (#7531).
 *
 * The page drew one English Markdown text in every language, about 450
 * lines: a German reader read the whole page in English, and since #7384
 * the Checks tab named the check types in the reader's words while this
 * page named them in English - "Null Percent" here, "Anteil NULL-Werte" on
 * the tab it explains.
 *
 * The page now holds its text in every language the Dashboard is read in,
 * one module each (DocumentationTranslations), and draws the reader's,
 * fetched only by a reader of that language (DocumentationInReadersLanguage).
 * Each translation keeps the English's code, inline code, links, headings,
 * lists and tables as they are, and names what the product draws - a check
 * type, a tab, a setting - as that language's Dashboard words it. English
 * reads exactly as it did.
 */

interface CapturedViewer {
  text: string;
  readingDirection: string | undefined;
}

const mockViewers: Array<CapturedViewer> = [];

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: {
      text: string;
      readingDirection?: string | undefined;
    }): null => {
      mockViewers.push({
        text: props.text,
        readingDirection: props.readingDirection,
      });
      return null;
    },
  };
});

import DataObservabilityDocumentationPage, {
  DOCUMENTATION,
  DOCUMENTATION_TRANSLATIONS,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/Documentation";
import {
  DocumentationTranslations,
  getDocumentationLanguage,
  loadDocumentationText,
  setDocumentationText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Documentation/DocumentationInReadersLanguage";
import { DATA_CHECK_TYPE_LABELS } from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataCheckTypeWords";
import { DataCheckType } from "../../../Types/DataObservability/DataCheckType";
import { DataCheckFormat } from "../../../Types/DataObservability/DataCheckFormats";
import Route from "../../../Types/API/Route";
import { SUPPORTED_DASHBOARD_LANGUAGE_CODES } from "../../../Types/Dashboard/DashboardLanguage";
import {
  getReadingDirection,
  LEFT_TO_RIGHT,
  RIGHT_TO_LEFT,
} from "../../../Types/ReadingDirection";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

const PAGE_FILE: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/Documentation.tsx",
);

const TRANSLATIONS_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/DocumentationTranslations",
);

// Each language's text, as its module exports it.
const TEXTS: Record<string, string> = {};

const FENCE: RegExp = /^```[^\n]*\n[\s\S]*?^```$/gm;

const HEADING_LINE: RegExp = /^#{1,6} /;

const LIST_ITEM_LINE: RegExp = /^\s*- /;

// Three words in a row: a sentence, not a line of names and code.
const THREE_WORDS: RegExp = /[a-z]{3,} [a-z]{3,} [a-z]{3,}/;

// A space a line may break at: the space and the fixed-width ones.
const BREAKING: string = "[\\u0020\\u2000-\\u2006\\u2008-\\u200A\\u205F]";

/*
 * A French mark a line could start with: a mark that ends a clause after a
 * word, after a space a line breaks at; and a guillemet beside one.
 * Written here, apart from Common/Types/NoBreakSpaces, so the check cannot
 * agree with a mistake there.
 */
const FRENCH_MARK_AFTER_A_BREAK: RegExp = new RegExp(
  `[\\p{L}\\p{N}»)\\]}*_\`]${BREAKING}+[?!:;](?=$|\\s|[»”"')\\]*_<.…?!])`,
  "gmu",
);

const GUILLEMET_BESIDE_A_BREAK: RegExp = new RegExp(
  `\\S${BREAKING}+[»›]|[«‹]${BREAKING}+\\S`,
  "gu",
);

// Where `text`'s prose lets a line break beside a French mark: each spot.
function frenchBreaksIn(text: string): Array<string> {
  const prose: string = withoutCodeBlocks(text).replace(/`[^`\n]*`/g, "`");

  return [
    ...(prose.match(FRENCH_MARK_AFTER_A_BREAK) || []),
    ...(prose.match(GUILLEMET_BESIDE_A_BREAK) || []),
  ];
}

// A no-break space: the full one and the narrow one.
const NO_BREAK_SPACE: RegExp = new RegExp("[\\u00A0\\u202F]", "g");

// `text` with every no-break space a plain one again.
function withPlainSpaces(text: string): string {
  return text.replace(NO_BREAK_SPACE, " ");
}

function codeBlocks(text: string): Array<string> {
  return text.match(FENCE) || [];
}

function withoutCodeBlocks(text: string): string {
  return text.replace(FENCE, "");
}

function inlineCode(text: string): Array<string> {
  return (withoutCodeBlocks(text).match(/`[^`\n]+`/g) || []).sort();
}

function headingLevels(text: string): Array<string> {
  return withoutCodeBlocks(text)
    .split("\n")
    .filter((line: string): boolean => {
      return HEADING_LINE.test(line);
    })
    .map((line: string): string => {
      return line.match(/^#+/)![0];
    });
}

function headings(text: string): Array<string> {
  return withoutCodeBlocks(text)
    .split("\n")
    .filter((line: string): boolean => {
      return HEADING_LINE.test(line);
    });
}

// Each table row's number of cells, in order.
function tableShape(text: string): Array<number> {
  return withoutCodeBlocks(text)
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith("|");
    })
    .map((line: string): number => {
      return line.split("|").length;
    });
}

function links(text: string): Array<string> {
  return withoutCodeBlocks(text).match(/\]\([^)]+\)/g) || [];
}

function listItemCount(text: string): number {
  return withoutCodeBlocks(text)
    .split("\n")
    .filter((line: string): boolean => {
      return LIST_ITEM_LINE.test(line);
    }).length;
}

// The English's lines of prose: not code, not a table, not a heading.
function proseLines(text: string): Array<string> {
  return withoutCodeBlocks(text)
    .split("\n")
    .map((line: string): string => {
      return line.trim();
    })
    .filter((line: string): boolean => {
      return (
        line.length > 40 &&
        !line.startsWith("|") &&
        !line.startsWith("#") &&
        // A line of code and names only, as written in every language.
        THREE_WORDS.test(line.replace(/`[^`]*`/g, ""))
      );
    });
}

// What English names in bold, and a Dashboard key names too.
function boldDashboardWords(): Array<string> {
  const english: Record<string, string> = readDashboardLocale("en");
  const bold: Array<string> = (DOCUMENTATION.match(/\*\*([^*]+)\*\*/g) || [])
    .map((match: string): string => {
      return match.slice(2, -2).replace(/:$/, "");
    })
    .filter((word: string): boolean => {
      return english[word] !== undefined;
    });

  return [...new Set(bold)];
}

/*
 * "Views" in bold names a database's views (Lineage the databases say);
 * the Dashboard's key is the page views of a status page or a replay.
 */
const NOT_THE_DASHBOARDS_SENSE: ReadonlyArray<string> = ["Views"];

// Product names: written as they are, in every language.
const NAMES_KEPT_AS_HEADINGS: ReadonlyArray<string> = [
  "## dbt",
  "## OneUptime AI",
];

beforeAll(async () => {
  for (const language of DASHBOARD_LANGUAGES) {
    const load: (() => Promise<{ default: string }>) | undefined =
      DOCUMENTATION_TRANSLATIONS[language];

    if (load) {
      TEXTS[language] = (await load()).default;
    }
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      de: { translation: readDashboardLocale("de") },
      ar: { translation: readDashboardLocale("ar") },
      fa: { translation: readDashboardLocale("fa") },
      ja: { translation: readDashboardLocale("ja") },
      fr: { translation: readDashboardLocale("fr") },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(async () => {
  cleanup();
  mockViewers.length = 0;
  await i18next.changeLanguage("en");
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

describe("a text in every language the Dashboard is read in", () => {
  test("every language but English has a text, and no other code does", () => {
    expect(Object.keys(DOCUMENTATION_TRANSLATIONS).sort()).toEqual(
      SUPPORTED_DASHBOARD_LANGUAGE_CODES.filter((code: string): boolean => {
        return code !== "en";
      }).sort(),
    );
    expect(DASHBOARD_LANGUAGES).toHaveLength(17);
  });

  test("each loader brings its language's module, a text of its own", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const text: string | undefined = TEXTS[language];

      expect({ language, isText: typeof text === "string" }).toEqual({
        language,
        isText: true,
      });
      expect(text!.trim().length).toBeGreaterThan(DOCUMENTATION.length / 2);
      expect({ language, sameAsEnglish: text === DOCUMENTATION }).toEqual({
        language,
        sameAsEnglish: false,
      });
    }

    // No two languages share a text.
    expect(new Set(Object.values(TEXTS)).size).toBe(DASHBOARD_LANGUAGES.length);
  });

  test("each translation is a module of its own, fetched only when its reader opens the page", () => {
    const page: string = fs.readFileSync(PAGE_FILE, "utf8");

    // Never imported up front: each is a dynamic import, which the build splits off.
    expect(page).not.toMatch(/from "\.\/DocumentationTranslations\//);

    for (const language of DASHBOARD_LANGUAGES) {
      expect(page).toContain(
        `import("./DocumentationTranslations/${language}")`,
      );
      expect(
        fs.existsSync(path.join(TRANSLATIONS_DIRECTORY, `${language}.ts`)),
      ).toBe(true);
    }

    expect(fs.readdirSync(TRANSLATIONS_DIRECTORY).sort()).toEqual(
      DASHBOARD_LANGUAGES.map((language: string): string => {
        return `${language}.ts`;
      }).sort(),
    );
  });
});

describe.each([...DASHBOARD_LANGUAGES])(
  "the %s text keeps what is written as it is",
  (language: string) => {
    const text: () => string = (): string => {
      return TEXTS[language]!;
    };

    test("every code block, byte for byte, in the English's order", () => {
      expect(codeBlocks(text())).toEqual(codeBlocks(DOCUMENTATION));
      expect(codeBlocks(DOCUMENTATION).length).toBeGreaterThan(15);
    });

    test("every piece of inline code - fields, metrics, routes, commands - as often as the English", () => {
      expect(inlineCode(text())).toEqual(inlineCode(DOCUMENTATION));
      expect(inlineCode(DOCUMENTATION).length).toBeGreaterThan(150);
    });

    test("the same links", () => {
      expect(links(text())).toEqual(links(DOCUMENTATION));
    });

    test("the same headings, at the same levels, and none left in English but the product names", () => {
      expect(headingLevels(text())).toEqual(headingLevels(DOCUMENTATION));

      const kept: Array<string> = headings(text()).filter(
        (heading: string): boolean => {
          return headings(DOCUMENTATION).includes(heading);
        },
      );

      expect(kept.sort()).toEqual([...NAMES_KEPT_AS_HEADINGS].sort());
    });

    test("the same tables, row for row and cell for cell, and the same lists", () => {
      expect(tableShape(text())).toEqual(tableShape(DOCUMENTATION));
      expect(listItemCount(text())).toBe(listItemCount(DOCUMENTATION));
    });

    test("no English sentence left in", () => {
      const left: Array<string> = proseLines(DOCUMENTATION).filter(
        (line: string): boolean => {
          return text().includes(line);
        },
      );

      expect(left).toEqual([]);
    });

    test("every check type is named as the Checks tab names it (#7223)", () => {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const type of Object.values(DataCheckType)) {
        if (!DOCUMENTATION.includes(`**${type}**`)) {
          continue;
        }

        const word: string = words[DATA_CHECK_TYPE_LABELS[type]]!;

        expect({
          language,
          type,
          named: text().includes(`**${word}**`),
        }).toEqual({ language, type, named: true });
      }
    });

    test("every setting, tab and button the English names in bold is named as the Dashboard words it", () => {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const term of boldDashboardWords()) {
        if (NOT_THE_DASHBOARDS_SENSE.includes(term)) {
          continue;
        }

        expect({
          language,
          term,
          named: text().includes(`**${words[term]}`),
        }).toEqual({ language, term, named: true });
      }
    });

    test("a database's views are never named with the page views' word", () => {
      const words: Record<string, string> = readDashboardLocale(language);
      const pageViews: string = words["Views"]!;
      const databaseView: string = words["View (database object)"]!;

      // Where one word is both (French "Vue", "Vues"), it is the right one.
      if (pageViews.startsWith(databaseView.slice(0, 3))) {
        return;
      }

      expect(text()).not.toContain(`**${pageViews}`);
    });

    test("the formats of a Format Mismatch Percent check are named as the Format dropdown draws them (#7532)", () => {
      const words: Record<string, string> = readDashboardLocale(language);
      const row: string | undefined = text()
        .split("\n")
        .find((line: string): boolean => {
          return line.startsWith(
            `| **${words[DataCheckType.FormatMismatchPercent]}**`,
          );
        });

      expect(row).toBeDefined();

      for (const format of [
        DataCheckFormat.Email,
        DataCheckFormat.Uuid,
        DataCheckFormat.CountryCode,
      ]) {
        expect({
          language,
          format,
          named: row!.includes(words[format]!),
        }).toEqual({ language, format, named: true });
      }
    });

    test("is a module of its own words, the English's escapes undone as written", () => {
      const source: string = fs.readFileSync(
        path.join(TRANSLATIONS_DIRECTORY, `${language}.ts`),
        "utf8",
      );

      expect(source).toMatch(
        /^\/\*\n \* The Data Observability Documentation page in /,
      );
      expect(source).toContain("export default DOCUMENTATION;");
      // The Snowflake key's \n is written for Markdown, as the English writes it.
      expect(text()).toContain(
        "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----",
      );
    });
  },
);

describe("the checks above (negative control)", () => {
  test("they catch a code block changed, a piece of code translated and a sentence left in English", () => {
    const german: string = TEXTS["de"]!;

    const changedCode: string = german.replace(
      "GRANT CONNECT ON DATABASE orders TO oneuptime_reader;",
      "GRANT CONNECT ON DATABASE bestellungen TO oneuptime_reader;",
    );

    expect(codeBlocks(changedCode)).not.toEqual(codeBlocks(DOCUMENTATION));

    const translatedCode: string = german.replace(
      "`updated_at`",
      "`aktualisiert_am`",
    );

    expect(inlineCode(translatedCode)).not.toEqual(inlineCode(DOCUMENTATION));

    const english: string = proseLines(DOCUMENTATION)[0]!;
    const leftInEnglish: string = `${german}\n${english}\n`;

    expect(
      proseLines(DOCUMENTATION).filter((line: string): boolean => {
        return leftInEnglish.includes(line);
      }),
    ).toEqual([english]);

    const englishCheck: string = german.replace(
      `**${readDashboardLocale("de")["Null Percent"]}**`,
      "**Null Percent**",
    );

    expect(
      englishCheck.includes(`**${readDashboardLocale("de")["Null Percent"]}**`),
    ).toBe(false);
  });
});

describe("the page draws the reader's text", () => {
  async function drawIn(language: string): Promise<void> {
    await act(async () => {
      await i18next.changeLanguage(language);
    });

    await act(async () => {
      render(
        <DataObservabilityDocumentationPage
          pageRoute={new Route("/dashboard/data-observability/documentation")}
          currentProject={null}
          hasPaymentMethod={true}
        />,
      );
    });

    for (let i: number = 0; i < 10; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  function lastViewer(): CapturedViewer {
    expect(mockViewers.length).toBeGreaterThan(0);
    return mockViewers[mockViewers.length - 1]!;
  }

  test("in English, exactly the text it always drew, at once, laid out as before", async () => {
    await drawIn("en");

    expect(mockViewers.length).toBeGreaterThan(0);
    for (const viewer of mockViewers) {
      expect(viewer.text).toBe(DOCUMENTATION);
      expect(viewer.readingDirection).toBeUndefined();
    }
    expect(screen.queryByTestId("detail-skeleton")).toBeNull();
  });

  test("in German, the German text: none of the English page's headings", async () => {
    await drawIn("de");

    const drawn: CapturedViewer = lastViewer();

    expect(drawn.text).toBe(TEXTS["de"]);
    expect(drawn.readingDirection).toBe(LEFT_TO_RIGHT);

    for (const heading of headings(DOCUMENTATION)) {
      if (NAMES_KEPT_AS_HEADINGS.includes(heading)) {
        continue;
      }

      expect({ heading, drawn: drawn.text.includes(heading) }).toEqual({
        heading,
        drawn: false,
      });
    }

    // The Checks tab's words: "Anteil NULL-Werte", not "Null Percent".
    expect(drawn.text).toContain("**Anteil NULL-Werte**");
    expect(drawn.text).not.toContain("**Null Percent**");
    // English was never drawn on the way.
    expect(
      mockViewers.some((viewer: CapturedViewer): boolean => {
        return viewer.text === DOCUMENTATION;
      }),
    ).toBe(false);
  });

  test.each(["ar", "fa"])(
    "in %s, its text laid out from the right, every block of it",
    async (language: string) => {
      await drawIn(language);

      const drawn: CapturedViewer = lastViewer();

      expect(drawn.text).toBe(TEXTS[language]);
      expect(drawn.readingDirection).toBe(RIGHT_TO_LEFT);
      expect(getReadingDirection(language)).toBe(RIGHT_TO_LEFT);

      for (const heading of headings(DOCUMENTATION)) {
        if (!NAMES_KEPT_AS_HEADINGS.includes(heading)) {
          expect(drawn.text).not.toContain(heading);
        }
      }
    },
  );

  test("in Japanese, its text, the check types as the Checks tab names them", async () => {
    await drawIn("ja");

    const drawn: CapturedViewer = lastViewer();

    expect(drawn.text).toBe(TEXTS["ja"]);
    expect(drawn.text).toContain(
      `**${readDashboardLocale("ja")["Format Mismatch Percent"]}**`,
    );
  });

  test("in French, its text with French's marks held to their words (#8032)", async () => {
    await drawIn("fr");

    const drawn: CapturedViewer = lastViewer();

    expect(drawn.text).toBe(
      setDocumentationText({ language: "fr", text: TEXTS["fr"]! }),
    );
    expect(drawn.text).not.toBe(TEXTS["fr"]);
    expect(frenchBreaksIn(drawn.text)).toEqual([]);
    expect(drawn.readingDirection).toBe(LEFT_TO_RIGHT);
  });

  test("while the reader's text is on its way, a loader, never a flash of English", async () => {
    let release: (() => void) | undefined;
    const slow: DocumentationTranslations = {
      de: () => {
        return new Promise<{ default: string }>(
          (resolve: (value: { default: string }) => void) => {
            release = () => {
              resolve({ default: "## Langsam" });
            };
          },
        );
      },
    };
    const { default: DocumentationInReadersLanguage } = (await import(
      "../../../../App/FeatureSet/Dashboard/src/Components/Documentation/DocumentationInReadersLanguage"
    )) as {
      default: React.FunctionComponent<{
        english: string;
        translations: DocumentationTranslations;
      }>;
    };

    await act(async () => {
      await i18next.changeLanguage("de");
    });
    await act(async () => {
      render(
        <DocumentationInReadersLanguage
          english="## English"
          translations={slow}
        />,
      );
    });

    expect(screen.getByTestId("detail-skeleton")).toBeInTheDocument();
    expect(mockViewers).toEqual([]);

    await act(async () => {
      release!();
      await Promise.resolve();
    });

    expect(screen.queryByTestId("detail-skeleton")).toBeNull();
    expect(lastViewer()).toEqual({
      text: "## Langsam",
      readingDirection: LEFT_TO_RIGHT,
    });
  });
});

describe("which text a reader reads", () => {
  const english: string = "## English";
  const translations: DocumentationTranslations = {
    de: async () => {
      return { default: "## Deutsch" };
    },
    fa: async () => {
      return { default: "## فارسی" };
    },
    es: async () => {
      throw new Error("The chunk could not be fetched.");
    },
    it: async () => {
      return { default: "   " };
    },
  };

  test.each([
    ["de", "de"],
    ["fa", "fa"],
    ["en", "en"],
    // A language the page has no text in, and no language at all: English.
    ["xx", "en"],
    ["", "en"],
    [null, "en"],
    [undefined, "en"],
    // Never a name of the object's own.
    ["constructor", "en"],
    ["__proto__", "en"],
    ["toString", "en"],
    [" de ", "de"],
  ])("%j reads %j", (language: string | null | undefined, reads: string) => {
    expect(getDocumentationLanguage({ language, translations })).toBe(reads);
  });

  test("the reader's text, when the page has one", async () => {
    expect(
      await loadDocumentationText({ language: "de", english, translations }),
    ).toEqual({ language: "de", text: "## Deutsch" });
  });

  test("English for English, without fetching anything", async () => {
    let fetched: boolean = false;

    expect(
      await loadDocumentationText({
        language: "en",
        english,
        translations: {
          en: async () => {
            fetched = true;
            return { default: "## Never" };
          },
        },
      }),
    ).toEqual({ language: "en", text: english });
    expect(fetched).toBe(false);
  });

  test("English when the chunk cannot be fetched, or holds no text", async () => {
    expect(
      await loadDocumentationText({ language: "es", english, translations }),
    ).toEqual({ language: "en", text: english });
    expect(
      await loadDocumentationText({ language: "it", english, translations }),
    ).toEqual({ language: "en", text: english });
    expect(
      await loadDocumentationText({ language: "xx", english, translations }),
    ).toEqual({ language: "en", text: english });
  });
});

/*
 * French sets » ? ! : and ; apart from its words with a space, and the
 * French text writes a plain one there, as translators type it. A line may
 * break at a plain space, so a narrow page started a line with ":" or "»"
 * (#8032). The page draws those spaces as French's no-break ones, as the
 * Translator draws every French wording; the module keeps its plain ones.
 */
describe("the French page keeps its marks with its words (#8032)", () => {
  test("the module writes French's marks apart with a plain space, as translators type them", () => {
    expect(frenchBreaksIn(TEXTS["fr"]!).length).toBeGreaterThan(50);
  });

  test("drawn, no French mark is left where a line could start with it", async () => {
    const loaded: { language: string; text: string } =
      await loadDocumentationText({
        language: "fr",
        english: DOCUMENTATION,
        translations: DOCUMENTATION_TRANSLATIONS,
      });

    expect(loaded.language).toBe("fr");
    expect(frenchBreaksIn(loaded.text)).toEqual([]);
  });

  test("only those spaces change: the text is otherwise the module's, its code byte for byte", async () => {
    const drawn: string = (
      await loadDocumentationText({
        language: "fr",
        english: DOCUMENTATION,
        translations: DOCUMENTATION_TRANSLATIONS,
      })
    ).text;

    expect(withPlainSpaces(drawn)).toBe(withPlainSpaces(TEXTS["fr"]!));
    expect(drawn.length).toBe(TEXTS["fr"]!.length);
    expect(codeBlocks(drawn)).toEqual(codeBlocks(TEXTS["fr"]!));
    expect(inlineCode(drawn)).toEqual(inlineCode(TEXTS["fr"]!));
  });

  test("the narrow space before ; ! and ?, the full one before : and », and after «", () => {
    expect(
      setDocumentationText({
        language: "fr",
        text: "Quand : maintenant ; vraiment ? Oui ! Le « Retard ».",
      }),
    ).toBe(
      "Quand\u00A0: maintenant\u202F; vraiment\u202F? Oui\u202F! Le «\u00A0Retard\u00A0».",
    );
  });

  test("bold words keep their marks too, and stay bold", () => {
    expect(
      setDocumentationText({
        language: "fr",
        text: "- **Ses colonnes** : une colonne ajoutée.",
      }),
    ).toBe("- **Ses colonnes**\u00A0: une colonne ajoutée.");
  });

  test("a fenced code block and code in backticks are left as they are written", () => {
    const text: string = [
      "Exemple :",
      "",
      "```sql",
      "SELECT a ; -- une remarque : ici ?",
      "```",
      "",
      "Écrivez `a : b` puis validez !",
      "",
      "```json",
      '{ "a" : 1 }',
      "```",
      "Fin ?",
    ].join("\n");

    expect(setDocumentationText({ language: "fr", text })).toBe(
      [
        "Exemple\u00A0:",
        "",
        "```sql",
        "SELECT a ; -- une remarque : ici ?",
        "```",
        "",
        "Écrivez `a : b` puis validez\u202F!",
        "",
        "```json",
        '{ "a" : 1 }',
        "```",
        "Fin\u202F?",
      ].join("\n"),
    );
  });

  test.each(["fr", "fr-CA", "fr-FR"])(
    "every French (%s) sets its marks so",
    (language: string) => {
      expect(setDocumentationText({ language, text: "Quand :" })).toBe(
        "Quand\u00A0:",
      );
    },
  );

  test.each(
    DASHBOARD_LANGUAGES.filter((language: string): boolean => {
      return language !== "fr";
    }),
  )(
    "%s's text is drawn exactly as its module writes it",
    async (language: string) => {
      expect(setDocumentationText({ language, text: "Quand : ici ?" })).toBe(
        "Quand : ici ?",
      );

      if (TEXTS[language]) {
        expect(
          (
            await loadDocumentationText({
              language,
              english: DOCUMENTATION,
              translations: DOCUMENTATION_TRANSLATIONS,
            })
          ).text,
        ).toBe(TEXTS[language]);
      }
    },
  );

  test("English is drawn exactly as it always was", async () => {
    expect(setDocumentationText({ language: "en", text: DOCUMENTATION })).toBe(
      DOCUMENTATION,
    );
    expect(
      await loadDocumentationText({
        language: "en",
        english: DOCUMENTATION,
        translations: DOCUMENTATION_TRANSLATIONS,
      }),
    ).toEqual({ language: "en", text: DOCUMENTATION });
  });

  test("the check above finds a mark a line could start with (negative control)", () => {
    expect(frenchBreaksIn("Quand : ici")).toEqual(["d :"]);
    expect(frenchBreaksIn("Le « Retard »")).toEqual(["« R", "d »"]);
    expect(frenchBreaksIn("Quand\u00A0: ici")).toEqual([]);
    expect(frenchBreaksIn("`a : b` et\n```\nx : y\n```")).toEqual([]);
  });
});
