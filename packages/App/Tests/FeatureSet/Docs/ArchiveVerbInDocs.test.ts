import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import { dashboardLocale, drawnDashboardLabel } from "./DocsDashboardLabels";
import { boldSpans } from "./DocsTranslationChecks";

/*
 * THE DOCS SAY THE DASHBOARD'S ONE VERB FOR UNARCHIVING (#7387).
 *
 * The German Dashboard's button said "Aus dem Archiv holen" while its card's
 * title said "Aus Archiv entfernen", and the German docs quoted the title's
 * verb as the button; Danish, Norwegian, Dutch and Hindi had the same split.
 * Each language now has one verb, and the docs quote the button, the Archived
 * workflows page's "When Unarchived" column and the Danish Archive button as
 * the Dashboard draws them. Markdown is not compiled, so nothing else notices
 * a page that goes on quoting a button the Dashboard no longer draws.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

function markdownFilesUnder(dir: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath: string = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...markdownFilesUnder(entryPath));
    } else if (entry.name.endsWith(".md")) {
      files.push(entryPath);
    }
  }

  return files;
}

interface DocsLine {
  page: string;
  line: string;
}

// Every line of every page in one language, with the page it is on.
function linesIn(language: string): Array<DocsLine> {
  const dir: string = path.join(CONTENT_DIR, language);

  return markdownFilesUnder(dir).flatMap((file: string): Array<DocsLine> => {
    const page: string = path.relative(CONTENT_DIR, file);

    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .map((line: string): DocsLine => {
        return { page, line };
      });
  });
}

/*
 * A Slack, Mattermost or Teams channel is archived and unarchived in that
 * product, in that product's own words: a line about one is not quoting the
 * Dashboard's button.
 */
const ANOTHER_PRODUCTS_CHANNEL: RegExp = /Slack|Mattermost|Microsoft Teams/;

// A bold span that ends a sentence, rather than a label.
const ENDS_A_SENTENCE: RegExp = /[.:!?।]$/;

// The Danish verb with the accent the docs once wrote on it.
const DANISH_ACCENTED_VERB: RegExp = /arkivér/i;

interface OwnVerb {
  language: string;
  // The verb as the language's Dashboard says it, in any of its forms.
  verb: RegExp;
  // The wordings the docs used before, that no page may say any more.
  before: ReadonlyArray<RegExp>;
}

const OWN_VERBS: ReadonlyArray<OwnVerb> = [
  {
    language: "de",
    verb: /aus dem Archiv/i,
    before: [
      /aus Archiv entfern/i,
      /Archivierung aufgehoben/i,
      /Aufhebung der Archivierung/i,
    ],
  },
  {
    language: "da",
    verb: /fra arkivet/i,
    before: [/fra arkiv(?![a-zæøå])/i, /arkivér/i],
  },
  {
    language: "no",
    verb: /fra arkivet/i,
    before: [/fra arkiv(?![a-zæøå])/i],
  },
  {
    language: "nl",
    verb: /uit het archief/i,
    before: [/uit archief/i],
  },
  {
    language: "hi",
    verb: /संग्रह से निकाल/,
    before: [/अनसंग्रह/, /असंग्रह/],
  },
];

describe("the five languages whose Unarchive button said another verb", () => {
  it.each(OWN_VERBS)(
    "$language: the Dashboard says its verb in the button, the card's title and the column",
    (ownVerb: OwnVerb) => {
      // So the checks below are checking the verb the Dashboard says.
      for (const english of [
        "Unarchive",
        "Unarchive {{itemName}}",
        "When Unarchived",
      ]) {
        expect({
          english,
          drawn: drawnDashboardLabel(ownVerb.language, english),
        }).toEqual({
          english,
          drawn: expect.stringMatching(ownVerb.verb),
        });
      }
    },
  );

  it.each(OWN_VERBS)(
    "$language: no page says the verb the docs used before",
    (ownVerb: OwnVerb) => {
      const said: Array<DocsLine> = linesIn(ownVerb.language).filter(
        (docsLine: DocsLine): boolean => {
          return (
            !ANOTHER_PRODUCTS_CHANNEL.test(docsLine.line) &&
            ownVerb.before.some((before: RegExp): boolean => {
              return before.test(docsLine.line);
            })
          );
        },
      );

      expect(
        said.map((docsLine: DocsLine): string => {
          return `${docsLine.page}: ${docsLine.line.trim().slice(0, 120)}`;
        }),
      ).toEqual([]);
    },
  );

  it.each(OWN_VERBS)(
    "$language: the pages quote the Unarchive button as the Dashboard draws it",
    (ownVerb: OwnVerb) => {
      const button: string = drawnDashboardLabel(ownVerb.language, "Unarchive");
      const pages: Set<string> = new Set(
        linesIn(ownVerb.language)
          .filter((docsLine: DocsLine): boolean => {
            return boldSpans(docsLine.line).includes(button);
          })
          .map((docsLine: DocsLine): string => {
            return docsLine.page;
          }),
      );

      // Every page that tells readers how to unarchive something.
      expect(pages.size).toBeGreaterThanOrEqual(15);
    },
  );

  it.each(OWN_VERBS)(
    "$language: every short bold quote in the verb is a label the Dashboard draws",
    (ownVerb: OwnVerb) => {
      const drawn: Set<unknown> = new Set(
        Object.values(dashboardLocale(ownVerb.language)),
      );
      const quoted: Array<string> = linesIn(ownVerb.language)
        .filter((docsLine: DocsLine): boolean => {
          return !ANOTHER_PRODUCTS_CHANNEL.test(docsLine.line);
        })
        .flatMap((docsLine: DocsLine): Array<string> => {
          return boldSpans(docsLine.line);
        })
        .filter((quote: string): boolean => {
          // A label, not a bold sentence that starts a paragraph.
          return (
            ownVerb.verb.test(quote) &&
            quote.split(/\s+/).length <= 5 &&
            !ENDS_A_SENTENCE.test(quote)
          );
        });

      expect(quoted.length).toBeGreaterThan(0);
      expect(
        Array.from(new Set(quoted)).filter((quote: string): boolean => {
          return !drawn.has(quote);
        }),
      ).toEqual([]);
    },
  );
});

describe("the Danish Archive verb, spelled one way", () => {
  it("the Dashboard draws Arkiver, and no Danish page says Arkivér", () => {
    expect(drawnDashboardLabel("da", "Archive")).toBe("Arkiver");

    const accented: Array<string> = linesIn("da")
      .filter((docsLine: DocsLine): boolean => {
        return DANISH_ACCENTED_VERB.test(docsLine.line);
      })
      .map((docsLine: DocsLine): string => {
        return docsLine.page;
      });

    expect(accented).toEqual([]);
  });

  it("the Danish pages quote the button as drawn", () => {
    const pages: Set<string> = new Set(
      linesIn("da")
        .filter((docsLine: DocsLine): boolean => {
          return boldSpans(docsLine.line).includes("Arkiver");
        })
        .map((docsLine: DocsLine): string => {
          return docsLine.page;
        }),
    );

    expect(pages.size).toBeGreaterThanOrEqual(10);
  });
});

// The spelling Hindi no longer uses for archive (#7387).
const HINDI_ARCHIVE_OTHER_SPELLING: RegExp = /संग्रहित/;

describe("the Hindi Archive verb, spelled one way", () => {
  it("the Dashboard draws संग्रहीत करें, and no Hindi page spells it संग्रहित", () => {
    expect(drawnDashboardLabel("hi", "Archive")).toBe("संग्रहीत करें");

    const other: Array<string> = linesIn("hi")
      .filter((docsLine: DocsLine): boolean => {
        return HINDI_ARCHIVE_OTHER_SPELLING.test(docsLine.line);
      })
      .map((docsLine: DocsLine): string => {
        return docsLine.page;
      });

    expect(other).toEqual([]);
  });

  it("the Hindi pages quote the Archive button as drawn", () => {
    const button: string = drawnDashboardLabel("hi", "Archive");
    const pages: Set<string> = new Set(
      linesIn("hi")
        .filter((docsLine: DocsLine): boolean => {
          return boldSpans(docsLine.line).includes(button);
        })
        .map((docsLine: DocsLine): string => {
          return docsLine.page;
        }),
    );

    expect(pages.size).toBeGreaterThanOrEqual(5);
  });
});

/*
 * The Archived workflows page's column says whether a workflow runs again
 * once unarchived. The workflows page names it in every language.
 */
const LANGUAGES: ReadonlyArray<string> = fs
  .readdirSync(CONTENT_DIR, { withFileTypes: true })
  .filter((entry: fs.Dirent): boolean => {
    return entry.isDirectory();
  })
  .map((entry: fs.Dirent): string => {
    return entry.name;
  });

describe("the Archived workflows page's When Unarchived column", () => {
  it("is named in every language the docs are written in", () => {
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(17);
  });

  it.each(LANGUAGES)(
    "%s: quoted as the Dashboard draws it",
    (language: string) => {
      const page: string = fs.readFileSync(
        path.join(CONTENT_DIR, language, "workflows/configuration.md"),
        "utf8",
      );
      const column: string = drawnDashboardLabel(language, "When Unarchived");

      expect(boldSpans(page)).toContain(column);

      if (language !== "en") {
        expect(column).not.toBe("When Unarchived");
        expect(boldSpans(page)).not.toContain("When Unarchived");
      }
    },
  );
});

/*
 * A bold quote that names the Services menu, or a label that starts with
 * its noun ("Службы, которые сбоят снова и снова"), as службы.
 */
const QUOTED_AS_SLUZHBY: RegExp = /(^|: |→ )Служб[ыа]([\s,]|$)/;

// A bold quote that names the Services menu as the Dashboard draws it.
const QUOTES_SERVISY_MENU: RegExp = /(^|→ )Сервисы(\s|$)/;

describe("a service's noun in Russian", () => {
  it("the Dashboard says сервис, and no Russian page quotes the menu as службы", () => {
    expect(drawnDashboardLabel("ru", "Services")).toBe("Сервисы");

    const quoted: Array<string> = linesIn("ru")
      .flatMap((docsLine: DocsLine): Array<string> => {
        return boldSpans(docsLine.line).map((quote: string): string => {
          return `${docsLine.page}: ${quote}`;
        });
      })
      .filter((quote: string): boolean => {
        return QUOTED_AS_SLUZHBY.test(quote);
      });

    expect(quoted).toEqual([]);
  });

  it("the AI insights page's card is quoted as the Russian Dashboard draws it", () => {
    const card: string = drawnDashboardLabel(
      "ru",
      "Services that keep failing",
    );
    const page: string = fs.readFileSync(
      path.join(CONTENT_DIR, "ru/ai/ai-sre.md"),
      "utf8",
    );

    expect(card).toBe("Сервисы, которые сбоят снова и снова");
    expect(boldSpans(page)).toContain(card);
  });

  it("the Russian pages that name the Services menu quote it as drawn", () => {
    const pages: Set<string> = new Set(
      linesIn("ru")
        .filter((docsLine: DocsLine): boolean => {
          return boldSpans(docsLine.line).some((quote: string): boolean => {
            return QUOTES_SERVISY_MENU.test(quote);
          });
        })
        .map((docsLine: DocsLine): string => {
          return docsLine.page;
        }),
    );

    expect(pages.size).toBeGreaterThanOrEqual(10);
  });
});
