import {
  AIDocsIndexedPage,
  AIDocsIndexedSection,
  AIDocsLanguageIndex,
  DocsIndexBuilder,
  DocsIndexPageInput,
  DocsIndexSectionInput,
  DocsTermReader,
  IN_PAGE_GROUP,
  IN_PAGE_HEADINGS,
  IN_PAGE_SUMMARY,
  IN_PAGE_TITLE,
  IN_SECTION_TITLE,
  docsPhraseOf,
  ownCopy,
} from "../../../FeatureSet/Docs/Utils/DocsIndex";
import { MadePage, madePageInput, makeDocsIndex } from "./DocsSearchHelpers";
import { describe, expect, it } from "@jest/globals";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";

/*
 * A DOCS LANGUAGE'S INDEX, LAID OUT TO HOLD LITTLE (issue #8818).
 *
 * The index keeps each word once, in one sorted list, and where it is
 * written as runs of numbers in typed arrays; each page's text deflated.
 * These hold it to what the Maps and Sets it replaced answered: every word
 * of every part of a page, with its count, found where it was put and
 * nowhere else; how many pages hold a word, counted as before (a page's
 * nav group not among them); each section's text as it was written,
 * whatever it is written in; and a search's reader of a word, asked page
 * by page in order or not.
 *
 * DocsIndexRealDocs.test.ts holds the index built from the docs on disk to
 * the same, and to what it may cost.
 */

// A page made by hand, its words read as the docs' are.
const pageOf: (made: MadePage, language?: string) => DocsIndexPageInput = (
  made: MadePage,
  language?: string,
): DocsIndexPageInput => {
  return madePageInput(made, language || "en");
};

const PAGES: Array<MadePage> = [
  {
    page: "monitor/website-monitor",
    title: "Website Monitor",
    group: "Monitors",
    summary: "A website monitor checks that a website answers.",
    sections: [
      {
        title: "SSL certificates",
        text: "The monitor reads the certificate and warns before it expires. The monitor warns twice.",
      },
      { title: "Criteria", text: "Criteria decide when the site is down." },
    ],
  },
  {
    page: "on-call/escalation-rules",
    title: "Escalation Rules",
    group: "On-Call",
    summary: "Who is paged next, when nobody answers.",
    isGuide: true,
    sections: [
      { title: "Rules", text: "Each rule pages a team after a wait." },
      {
        title: "Pager (On-Call Policy)",
        text: "The policy that pages people.",
        anchor: "on-call-policy",
        isOtherName: true,
      },
    ],
  },
  {
    page: "status-pages/index",
    title: "Status Pages",
    group: "Monitors",
    summary: "Tell customers what is happening.",
    sections: [],
  },
];

const INDEX: AIDocsLanguageIndex = makeDocsIndex(PAGES);

const pageNamed: (
  index: AIDocsLanguageIndex,
  page: string,
) => AIDocsIndexedPage = (
  index: AIDocsLanguageIndex,
  page: string,
): AIDocsIndexedPage => {
  return index.pages.find((candidate: AIDocsIndexedPage): boolean => {
    return candidate.page === page;
  })!;
};

describe("ownCopy", () => {
  it("is the same text, whatever it is written in", () => {
    for (const text of [
      "",
      "monitor",
      "Bereitschaftspläne für das Team",
      "ウェブサイトを監視する",
      "﻿a byte order mark first",
      "an emoji 🚨 and a lone surrogate \uD800 too",
      "x".repeat(70000),
    ]) {
      expect(ownCopy(text)).toBe(text);
    }
  });

  it("copies a string cut from a longer one", () => {
    const long: string = `${"→ ".repeat(1000)}Escalation Rules${" ←".repeat(1000)}`;
    const cut: string = long.slice(2000, 2016);

    expect(cut).toBe("Escalation Rules");
    expect(ownCopy(cut)).toBe("Escalation Rules");
  });
});

describe("docsPhraseOf", () => {
  it("is the words, lower case, one space between them and one at each end", () => {
    expect(docsPhraseOf("The Monitor -- is DOWN, again!")).toBe(
      " the monitor is down again ",
    );
    expect(docsPhraseOf("on-call")).toBe(" on call ");
    expect(docsPhraseOf("")).toBe("  ");
    // Read as NFKC, so a full-width letter is the letter.
    expect(docsPhraseOf("ＡＰＩ キー")).toBe(" api キー ");
  });
});

describe("DocsIndexBuilder", () => {
  it("keeps the pages in order, with what they are named and say", () => {
    expect(
      INDEX.pages.map((page: AIDocsIndexedPage): Array<unknown> => {
        return [
          page.number,
          page.page,
          page.title,
          page.group,
          page.isGuide,
          page.sections.length,
        ];
      }),
    ).toEqual([
      [0, "monitor/website-monitor", "Website Monitor", "Monitors", false, 2],
      [1, "on-call/escalation-rules", "Escalation Rules", "On-Call", true, 2],
      [2, "status-pages/index", "Status Pages", "Monitors", false, 0],
    ]);
    expect(INDEX.language).toBe("en");
  });

  it("numbers the sections one after another, page by page", () => {
    expect(
      INDEX.pages.flatMap((page: AIDocsIndexedPage): Array<number> => {
        return page.sections.map((section: AIDocsIndexedSection): number => {
          return section.number;
        });
      }),
    ).toEqual([0, 1, 2, 3]);
  });

  it("finds each word of a page where it was put, and nowhere else", () => {
    const website: AIDocsIndexedPage = pageNamed(
      INDEX,
      "monitor/website-monitor",
    );

    expect(website.titleTerms.has("websit")).toBe(true);
    expect(website.titleTerms.has("monitor")).toBe(true);
    expect(website.titleTerms.has("certificat")).toBe(false);
    expect(website.groupTerms.has("monitor")).toBe(true);
    expect(website.groupTerms.has("websit")).toBe(false);
    expect(website.summaryTerms.has("answ")).toBe(true);
    expect(website.summaryTerms.has("criteria")).toBe(false);
    expect(website.headingTerms.has("criteria")).toBe(true);
    expect(website.headingTerms.has("answ")).toBe(false);
    expect(website.titleTerms.has("nothing")).toBe(false);
  });

  it("counts each word of a page's body, and has nothing for one it does not say", () => {
    const website: AIDocsIndexedPage = pageNamed(
      INDEX,
      "monitor/website-monitor",
    );
    const expected: Map<string, number> = pageOf(PAGES[0]!).bodyTerms as Map<
      string,
      number
    >;

    for (const [term, count] of expected) {
      expect({ term, count: website.bodyTerms.get(term) }).toEqual({
        term,
        count,
      });
      expect(website.bodyTerms.has(term)).toBe(true);
    }

    // Its summary once, its first section twice: its title is not its body.
    expect(website.bodyTerms.get("monitor")).toBe(3);
    expect(website.bodyTerms.get("escalation")).toBeUndefined();
    expect(website.bodyTerms.has("pag")).toBe(false);
    expect(website.bodyLength).toBe(pageOf(PAGES[0]!).bodyLength);
  });

  it("counts each word of a section, and finds its heading's words", () => {
    const [ssl, criteria] = pageNamed(INDEX, "monitor/website-monitor")
      .sections as Array<AIDocsIndexedSection>;

    expect(ssl!.terms.get("monitor")).toBe(2);
    expect(ssl!.terms.get("warn")).toBe(2);
    expect(ssl!.terms.get("criteria")).toBeUndefined();
    expect(ssl!.titleTerms.has("ssl")).toBe(true);
    expect(ssl!.titleTerms.has("monitor")).toBe(false);
    // A heading's word its text does not say is in its heading, not its text.
    expect(ssl!.terms.has("ssl")).toBe(false);
    expect(criteria!.terms.get("criteria")).toBe(1);
    expect(criteria!.titleTerms.has("criteria")).toBe(true);
  });

  it("counts how many words each section holds, as DocsSearch reads its length", () => {
    for (const page of INDEX.pages) {
      const made: DocsIndexPageInput = pageOf(
        PAGES.find((candidate: MadePage): boolean => {
          return candidate.page === page.page;
        })!,
      );

      page.sections.forEach(
        (section: AIDocsIndexedSection, at: number): void => {
          let total: number = 0;
          for (const count of made.sections[at]!.terms.values()) {
            total += count;
          }
          expect(section.wordCount).toBe(total);
        },
      );
    }
  });

  it("counts the pages that hold a word as before: its nav group does not hold it, a Glossary's other name does", () => {
    // "monitor": both monitor pages' groups say it, but only one page says it.
    expect(INDEX.documentFrequency.get("monitor")).toBe(1);
    expect(INDEX.vocabulary.pagesHolding("monitor")).toBe(1);
    // "policy" is only the Glossary's other name's, on Escalation Rules.
    expect(INDEX.documentFrequency.get("policy")).toBe(1);
    expect(INDEX.vocabulary.has("policy")).toBe(true);
    // "pag": Escalation Rules' body and Status Pages' title.
    expect(INDEX.documentFrequency.get("pag")).toBe(2);
    expect(INDEX.documentFrequency.get("statu")).toBe(1);
    expect(INDEX.documentFrequency.has("nothing")).toBe(false);
    expect(INDEX.documentFrequency.get("nothing")).toBeUndefined();
  });

  it("lists a word only a nav group says, for the pages of the group, without counting it as held", () => {
    const made: AIDocsLanguageIndex = makeDocsIndex([
      {
        page: "a/b",
        title: "Probes",
        group: "Telemetry",
        summary: "Where checks run from.",
      },
    ]);
    const page: AIDocsIndexedPage = made.pages[0]!;
    const reader: DocsTermReader = new DocsTermReader(
      made.postings,
      "telemetry",
    );

    expect(page.groupTerms.has("telemetry")).toBe(true);
    expect(made.vocabulary.has("telemetry")).toBe(false);
    expect(made.vocabulary.pagesHolding("telemetry")).toBe(0);
    expect(made.vocabulary.positionOf("telemetry")).toBeGreaterThanOrEqual(0);
    expect(made.documentFrequency.has("telemetry")).toBe(false);
    expect(made.vocabulary.startingWith("tele", 5)).toEqual([]);
    expect(made.vocabulary.near("telemetrie", 2, 5)).toEqual([]);
    expect(reader.isHeld).toBe(true);
    expect(reader.pageFields(0)).toBe(IN_PAGE_GROUP);
    expect(reader.bodyCount(0)).toBe(0);
  });

  it("works out how long a page's body is on average", () => {
    const lengths: Array<number> = PAGES.map((made: MadePage): number => {
      return pageOf(made).bodyLength;
    });

    expect(INDEX.averageBodyLength).toBe(
      lengths.reduce((total: number, length: number): number => {
        return total + length;
      }, 0) / lengths.length,
    );
    expect(makeDocsIndex([]).averageBodyLength).toBe(0);
  });

  it("keeps an index with no page at all", () => {
    const empty: AIDocsLanguageIndex = makeDocsIndex([], "de");

    expect(empty.pages).toEqual([]);
    expect(empty.vocabulary.has("monitor")).toBe(false);
    expect(new DocsTermReader(empty.postings, "monitor").isHeld).toBe(false);
  });

  it("keeps a Glossary's other name as a section of its own", () => {
    const other: AIDocsIndexedSection = pageNamed(
      INDEX,
      "on-call/escalation-rules",
    ).sections[1]!;

    expect(other.isOtherName).toBe(true);
    expect(other.anchor).toBe("on-call-policy");
    expect(other.titleTerms.has("pag")).toBe(true);
    expect(other.titleTerms.has("policy")).toBe(true);
    // Its words are its name's (DocsSearchHelpers counts them so).
    expect(other.terms.get("policy")).toBe(1);
    expect(
      pageNamed(INDEX, "on-call/escalation-rules").sections[0]!.isOtherName,
    ).toBe(false);
  });

  it("keeps each section's heading and text as a phrase is compared with them", () => {
    const ssl: AIDocsIndexedSection = INDEX.pages[0]!.sections[0]!;

    expect(ssl.phrase).toBe(docsPhraseOf(`${ssl.title} ${ssl.text}`));
    expect(ssl.phrase.includes(" the monitor reads the ")).toBe(true);
  });
});

describe("a section's text, kept deflated", () => {
  const texts: Array<string> = [
    "Plain English, as most of the docs are.",
    "",
    "Bereitschaftspläne für das Team, mit Übergaben.",
    "ウェブサイトを監視するには、モニターを作成します。",
    "Монитор веб-сайта проверяет, что сайт отвечает.",
    "मॉनिटर बनाएँ और वेबसाइट की निगरानी करें।",
    "مانیتور وب‌سایت را بسازید.",
    "An emoji 🚨, a byte order mark ﻿ and a tab\tin it.",
    `${"A very long section that says a great deal. ".repeat(4000)}The end.`,
  ];
  const index: AIDocsLanguageIndex = makeDocsIndex([
    {
      page: "a/one",
      title: "One",
      sections: texts.map(
        (text: string, at: number): { title: string; text: string } => {
          return { title: `Section ${at}`, text };
        },
      ),
    },
    {
      page: "a/two",
      title: "Two",
      sections: [{ title: "Alone", text: "The only section of its page." }],
    },
  ]);

  it("is each section's text as it was written, in every script, one long page too", () => {
    expect(
      index.pages[0]!.sections.map((section: AIDocsIndexedSection): string => {
        return section.text;
      }),
    ).toEqual(texts);
    expect(index.pages[1]!.sections[0]!.text).toBe(
      "The only section of its page.",
    );
  });

  it("reads the same, however the pages are asked for, and asked again", () => {
    const made: Array<MadePage> = Array.from(
      { length: 20 },
      (_value: unknown, at: number): MadePage => {
        return {
          page: `p/${at}`,
          title: `Page ${at}`,
          sections: [
            { title: "First", text: `Page ${at} says this first.` },
            { title: "Second", text: `And then page ${at} says this.` },
          ],
        };
      },
    );
    const many: AIDocsLanguageIndex = makeDocsIndex(made);

    // Every page once, then backwards, past the pages it keeps inflated.
    for (const order of [
      Array.from({ length: 20 }, (_value: unknown, at: number): number => {
        return at;
      }),
      Array.from({ length: 20 }, (_value: unknown, at: number): number => {
        return 19 - at;
      }),
      [3, 17, 3, 0, 19, 3, 11, 11, 5],
    ]) {
      for (const at of order) {
        expect(many.pages[at]!.sections[1]!.text).toBe(
          `And then page ${at} says this.`,
        );
        expect(many.pages[at]!.sections[0]!.text).toBe(
          `Page ${at} says this first.`,
        );
      }
    }
  });

  it("keeps a text UTF-8 cannot carry as it is - a lone surrogate - as written", () => {
    const lone: AIDocsLanguageIndex = makeDocsIndex([
      {
        page: "a/lone",
        title: "Lone",
        sections: [
          { title: "Cut", text: "half of an emoji: \uD83D, and the rest" },
          { title: "Whole", text: "a whole one: 🚨" },
        ],
      },
    ]);

    expect(lone.pages[0]!.sections[0]!.text).toBe(
      "half of an emoji: \uD83D, and the rest",
    );
    expect(lone.pages[0]!.sections[1]!.text).toBe("a whole one: 🚨");
  });
});

describe("DocsTermReader", () => {
  const reader: (term: string) => DocsTermReader = (
    term: string,
  ): DocsTermReader => {
    return new DocsTermReader(INDEX.postings, term);
  };

  it("reads a word page by page: where each page holds it, and how often its body says it", () => {
    const monitor: DocsTermReader = reader("monitor");

    expect(monitor.term).toBe("monitor");
    expect(monitor.isHeld).toBe(true);
    expect(monitor.pageFields(0)).toBe(
      IN_PAGE_TITLE | IN_PAGE_GROUP | IN_PAGE_SUMMARY,
    );
    expect(monitor.bodyCount(0)).toBe(3);
    expect(monitor.pageFields(1)).toBe(0);
    expect(monitor.bodyCount(1)).toBe(0);
    expect(monitor.pageFields(2)).toBe(IN_PAGE_GROUP);
    expect(monitor.bodyCount(2)).toBe(0);
  });

  it("reads a word section by section: how often its text says it, and whether its heading does", () => {
    const criteria: DocsTermReader = reader("criteria");

    expect(criteria.sectionCount(0)).toBe(0);
    expect(criteria.sectionFields(0)).toBe(0);
    expect(criteria.sectionCount(1)).toBe(1);
    expect(criteria.sectionFields(1)).toBe(IN_SECTION_TITLE);
    expect(criteria.sectionCount(3)).toBe(0);
  });

  it("answers the same asked out of order, and asked again", () => {
    const monitor: DocsTermReader = reader("monitor");

    expect(monitor.bodyCount(2)).toBe(0);
    expect(monitor.bodyCount(0)).toBe(3);
    expect(monitor.pageFields(2)).toBe(IN_PAGE_GROUP);
    expect(monitor.pageFields(2)).toBe(IN_PAGE_GROUP);
    expect(monitor.pageFields(0)).toBe(
      IN_PAGE_TITLE | IN_PAGE_GROUP | IN_PAGE_SUMMARY,
    );
    expect(monitor.sectionCount(1)).toBe(0);
    expect(monitor.sectionCount(0)).toBe(2);
    expect(monitor.sectionCount(0)).toBe(2);
  });

  it("reads nothing of a word no page holds", () => {
    const nothing: DocsTermReader = reader("nothing");

    expect(nothing.isHeld).toBe(false);
    expect(nothing.pageFields(0)).toBe(0);
    expect(nothing.bodyCount(1)).toBe(0);
    expect(nothing.sectionCount(2)).toBe(0);
    expect(nothing.sectionFields(3)).toBe(0);
  });

  it("finds a page's headings as the headings' words", () => {
    expect(reader("rul").pageFields(1) & IN_PAGE_HEADINGS).toBe(
      IN_PAGE_HEADINGS,
    );
    expect(reader("rul").pageFields(1) & IN_PAGE_TITLE).toBe(IN_PAGE_TITLE);
    // Status Pages has no section, so no heading.
    expect(reader("statu").pageFields(2)).toBe(IN_PAGE_TITLE);
  });
});

/*
 * The index against the Maps and Sets it replaced, on pages of random words:
 * every word of every part of every page, its count, and every word asked
 * of every part, whether it is there or not.
 */
describe("the index, against Maps and Sets of the same pages", () => {
  // A seeded generator, so the pages are the same each run.
  const random: SeededRandom = seededRandom(8818);
  const WORDS: Array<string> = Array.from(
    { length: 400 },
    (_value: unknown, at: number): string => {
      return `w${at.toString(36)}x${"abcdefghij"[at % 10]}`;
    },
  );
  const someWords: (count: number) => string = (count: number): string => {
    return Array.from({ length: count }, (): string => {
      // A few words most pages say, and many few do.
      return WORDS[Math.floor(Math.pow(random(), 2) * WORDS.length)]!;
    }).join(" ");
  };
  const made: Array<MadePage> = Array.from(
    { length: 300 },
    (_value: unknown, at: number): MadePage => {
      return {
        page: `random/${at}`,
        title: someWords(3),
        group: `Group ${at % 7}`,
        summary: someWords(12),
        isGuide: at % 5 === 0,
        sections: Array.from(
          { length: Math.floor(random() * 5) },
          (
            _section: unknown,
            number: number,
          ): { title: string; text: string; isOtherName?: boolean } => {
            return {
              title: someWords(2),
              text: someWords(Math.floor(random() * 300)),
              isOtherName: number === 3,
            };
          },
        ),
      };
    },
  );
  const inputs: Array<DocsIndexPageInput> = made.map(
    (page: MadePage): DocsIndexPageInput => {
      return pageOf(page);
    },
  );
  const builder: DocsIndexBuilder = new DocsIndexBuilder("en");
  for (const input of inputs) {
    builder.addPage(input);
  }
  const index: AIDocsLanguageIndex = builder.build();
  const asked: Array<string> = [...WORDS, "group", "nothing", "w"];

  it("holds every page's words where they were put, with their counts", () => {
    const differing: Array<string> = [];

    inputs.forEach((input: DocsIndexPageInput, at: number): void => {
      const page: AIDocsIndexedPage = index.pages[at]!;

      for (const term of asked) {
        const expected: string = [
          input.titleTerms.has(term),
          input.groupTerms.has(term),
          input.summaryTerms.has(term),
          input.headingTerms.has(term),
          input.bodyTerms.get(term),
        ].join();
        const got: string = [
          page.titleTerms.has(term),
          page.groupTerms.has(term),
          page.summaryTerms.has(term),
          page.headingTerms.has(term),
          page.bodyTerms.get(term),
        ].join();

        if (expected !== got) {
          differing.push(`${input.page} ${term}: ${expected} / ${got}`);
        }
      }
    });

    expect(differing).toEqual([]);
  });

  it("holds every section's words, and its text", () => {
    const differing: Array<string> = [];

    inputs.forEach((input: DocsIndexPageInput, at: number): void => {
      input.sections.forEach(
        (section: DocsIndexSectionInput, number: number): void => {
          const indexed: AIDocsIndexedSection =
            index.pages[at]!.sections[number]!;

          if (indexed.text !== section.text) {
            differing.push(`${input.page} ${number}: its text`);
          }

          for (const term of asked) {
            const expected: string = `${section.titleTerms.has(term)} ${section.terms.get(term)}`;
            const got: string = `${indexed.titleTerms.has(term)} ${indexed.terms.get(term)}`;

            if (expected !== got) {
              differing.push(
                `${input.page} ${number} ${term}: ${expected} / ${got}`,
              );
            }
          }
        },
      );
    });

    expect(differing).toEqual([]);
  });

  it("counts the pages holding each word as the Maps did", () => {
    const documentFrequency: Map<string, number> = new Map();

    for (const input of inputs) {
      for (const term of new Set<string>([
        ...input.titleTerms,
        ...input.headingTerms,
        ...input.summaryTerms,
        ...input.bodyTerms.keys(),
        ...input.sections.flatMap(
          (section: DocsIndexSectionInput): Array<string> => {
            return section.isOtherName ? Array.from(section.titleTerms) : [];
          },
        ),
      ])) {
        documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
      }
    }

    for (const term of asked) {
      expect({ term, pages: index.documentFrequency.get(term) }).toEqual({
        term,
        pages: documentFrequency.get(term),
      });
    }
  });

  it("reads each word page by page and section by section as the Maps say", () => {
    const differing: Array<string> = [];

    for (const term of asked) {
      const reader: DocsTermReader = new DocsTermReader(index.postings, term);
      let sectionNumber: number = 0;

      inputs.forEach((input: DocsIndexPageInput, at: number): void => {
        const fields: number =
          (input.titleTerms.has(term) ? IN_PAGE_TITLE : 0) |
          (input.groupTerms.has(term) ? IN_PAGE_GROUP : 0) |
          (input.summaryTerms.has(term) ? IN_PAGE_SUMMARY : 0) |
          (input.headingTerms.has(term) ? IN_PAGE_HEADINGS : 0);

        if (
          reader.pageFields(at) !== fields ||
          reader.bodyCount(at) !== (input.bodyTerms.get(term) || 0)
        ) {
          differing.push(`${input.page} ${term}`);
        }

        for (const section of input.sections) {
          if (
            reader.sectionCount(sectionNumber) !==
              (section.terms.get(term) || 0) ||
            reader.sectionFields(sectionNumber) !==
              (section.titleTerms.has(term) ? IN_SECTION_TITLE : 0)
          ) {
            differing.push(`${input.page} section ${sectionNumber} ${term}`);
          }
          sectionNumber++;
        }
      });
    }

    expect(differing).toEqual([]);
  });

  it("numbers pages past 255 and sections past 255, in wider arrays", () => {
    expect(index.pages.length).toBe(300);
    expect(
      index.pages.reduce((total: number, page: AIDocsIndexedPage): number => {
        return total + page.sections.length;
      }, 0),
    ).toBeGreaterThan(256);
  });
});

describe("a count past what two bytes hold", () => {
  it("is kept whole", () => {
    const builder: DocsIndexBuilder = new DocsIndexBuilder("en");

    builder.addPage({
      page: "a/big",
      title: "Big",
      group: "Docs",
      summary: "",
      language: "en",
      isGuide: false,
      titleTerms: new Set<string>(["big"]),
      groupTerms: new Set<string>(["doc"]),
      summaryTerms: new Set<string>(),
      headingTerms: new Set<string>(),
      bodyTerms: new Map<string, number>([["word", 70000]]),
      bodyLength: 70000,
      sections: [
        {
          title: "Words",
          anchor: "words",
          text: "word",
          terms: new Map<string, number>([["word", 66000]]),
          titleTerms: new Set<string>(["word"]),
        },
      ],
    });

    const index: AIDocsLanguageIndex = builder.build();

    expect(index.pages[0]!.bodyTerms.get("word")).toBe(70000);
    expect(index.pages[0]!.sections[0]!.terms.get("word")).toBe(66000);
    expect(index.pages[0]!.sections[0]!.wordCount).toBe(66000);
  });
});
