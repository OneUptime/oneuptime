import {
  MAINTENANCE_EVENT_WORDS,
  MAINTENANCE_WORDS,
  MaintenanceEventWords,
  SAYS_A_MAINTENANCE_EVENT,
  SAYS_MAINTENANCE,
  droppedMaintenanceWordIn,
} from "../../Dashboard/MaintenanceEventWords";
import { DocsBlock, blocksOf, proseOf } from "./DocsBlocks";
import {
  TRANSLATED_LANGUAGES,
  listPages,
  readPage,
} from "./DocsContentSupport";
import { describe, expect, test } from "@jest/globals";

/*
 * THE TRANSLATED DOCS CALL A MAINTENANCE EVENT BY THEIR DASHBOARD'S WORD
 * (#8090).
 *
 * #8089 changed the docs lines that said "scheduled maintenance event" to
 * the Dashboard's word for the record, in every language. Lines that
 * already said "maintenance event" in English were left as they were, and
 * nothing read the translations: RetiredNamesGuard reads the English docs,
 * the locale suites read the locale files. So the Danish docs said
 * "vedligeholdelsesbegivenhed" beside the Dashboard's
 * "vedligeholdelseshændelse", Persian "رویداد نگهداری", Hindi "मेंटेनेंस",
 * Dutch "onderhoudsevenement", Korean "점검 이벤트", Norwegian
 * "vedlikeholdsbegivenhet", Chinese "维护活动"; and fifteen languages called
 * the record "a maintenance" ("eine Wartung", "une maintenance") in the
 * permissions and workflows pages.
 *
 * A translation follows its English page block for block: the same
 * paragraphs, list items, table rows and diagram lines in the same order
 * (DocsTranslations holds the shape). So each block whose English names a
 * maintenance event is read beside its English, with the words of
 * Dashboard/MaintenanceEventWords:
 *
 *   - it names the record by the language's word, at least as often as the
 *     English does;
 *   - it never names it by another word;
 *   - it says the language's "scheduled maintenance" wording no more often
 *     than the English says scheduled, planned or upcoming.
 *
 * Bold text is left out: a bold label or menu path is the Dashboard's
 * drawing, which the docs translation suites hold to the Dashboard, and a
 * path through Scheduled Maintenance names the product. So are code, link
 * targets and markup.
 */

// What a block says with its bold labels, for the words of maintenance.
function wordsOf(text: string): string {
  return text
    .replace(/-<br\s*\/?>/g, "")
    .replace(/<br\s*\/?>/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/<[^>]+>/g, " ");
}

function count(pattern: RegExp, text: string): number {
  const flags: string = pattern.flags.includes("g")
    ? pattern.flags
    : `${pattern.flags}g`;

  return Array.from(text.matchAll(new RegExp(pattern.source, flags))).length;
}

// The record's name kept in English, as a model or API name is.
const KEPT_IN_ENGLISH: RegExp = /\bMaintenance Events?\b/;

// What lets a translation say its "scheduled" word: the English says it too.
const SCHEDULED_IN_ENGLISH: RegExp =
  /\bschedul\w*|\bplanned\b|\bupcoming\b|\bcoming up\b/i;

/*
 * What is wrong with a translated block whose English block names a
 * maintenance event: nothing, or the reasons.
 */
export function recordProblems(
  language: string,
  english: string,
  translation: string,
): Array<string> {
  const words: MaintenanceEventWords = MAINTENANCE_EVENT_WORDS[language]!;
  const said: string = proseOf(english);
  const text: string = proseOf(translation);
  const problems: Array<string> = [];

  const named: number =
    count(words.record, text) + count(KEPT_IN_ENGLISH, text);

  if (named === 0) {
    problems.push("does not name the record by the Dashboard's word");
  } else if (named < count(SAYS_A_MAINTENANCE_EVENT, said)) {
    problems.push("names it fewer times than the English does");
  }

  if (words.otherRecord && words.otherRecord.test(text)) {
    problems.push(
      `names it "${words.otherRecord.exec(text)![0]}", not the Dashboard's word`,
    );
  }

  if (count(words.scheduled, text) > count(SCHEDULED_IN_ENGLISH, said)) {
    problems.push(
      `says "${words.scheduled.exec(text)![0]}", the scheduled maintenance wording`,
    );
  }

  return problems;
}

interface PairedBlock {
  page: string;
  // 1-based line of the translated page.
  line: number;
  english: string;
  translation: string;
}

/*
 * Each block of a language's docs beside its English block, for the pages
 * whose English blocks pass the filter. A page that does not pair (its
 * translation has a block more or less) is in unpaired.
 */
function pairedBlocks(
  language: string,
  filter: (english: DocsBlock) => boolean,
): { paired: Array<PairedBlock>; unpaired: Array<string> } {
  const paired: Array<PairedBlock> = [];
  const unpaired: Array<string> = [];
  const translatedPages: Set<string> = new Set(listPages(language));

  for (const page of listPages("en")) {
    if (!translatedPages.has(page)) {
      continue;
    }

    const english: Array<DocsBlock> = blocksOf(readPage("en", page));
    const wanted: Array<number> = english
      .map((block: DocsBlock, index: number): number => {
        return !block.code && filter(block) ? index : -1;
      })
      .filter((index: number): boolean => {
        return index >= 0;
      });

    if (wanted.length === 0) {
      continue;
    }

    const translated: Array<DocsBlock> = blocksOf(readPage(language, page));

    if (translated.length !== english.length) {
      unpaired.push(page);
      continue;
    }

    for (const index of wanted) {
      paired.push({
        page,
        line: translated[index]!.line + 1,
        english: english[index]!.text,
        translation: translated[index]!.text,
      });
    }
  }

  return { paired, unpaired };
}

function namesAMaintenanceEvent(block: DocsBlock): boolean {
  return SAYS_A_MAINTENANCE_EVENT.test(proseOf(block.text));
}

const DOCS_LANGUAGES_WITH_WORDS: Array<string> = TRANSLATED_LANGUAGES.filter(
  (language: string): boolean => {
    return Boolean(MAINTENANCE_EVENT_WORDS[language]);
  },
);

describe("the translated docs name a maintenance event by the Dashboard's word", () => {
  test("every docs language has its words", () => {
    expect(DOCS_LANGUAGES_WITH_WORDS).toEqual(TRANSLATED_LANGUAGES);
  });

  test.each(DOCS_LANGUAGES_WITH_WORDS)(
    "%s: every block whose English names a maintenance event does too",
    (language: string) => {
      const { paired, unpaired } = pairedBlocks(
        language,
        namesAMaintenanceEvent,
      );
      const problems: Array<string> = [];

      for (const block of paired) {
        for (const problem of recordProblems(
          language,
          block.english,
          block.translation,
        )) {
          problems.push(
            `packages/App/FeatureSet/Docs/Content/${language}/${block.page}.md:${block.line} ${problem}`,
          );
        }
      }

      expect({ language, unpaired, problems }).toEqual({
        language,
        unpaired: [],
        problems: [],
      });
      // The check reads the pages it is about (control).
      expect(paired.length).toBeGreaterThan(150);
    },
  );

  /*
   * The other words are never right, so no block of a page says them,
   * whatever its English says: a diagram label or a heading included.
   */
  test.each(
    DOCS_LANGUAGES_WITH_WORDS.filter((language: string): boolean => {
      return Boolean(MAINTENANCE_EVENT_WORDS[language]!.otherRecord);
    }),
  )("%s: no page names the record by another word", (language: string) => {
    const otherRecord: RegExp = MAINTENANCE_EVENT_WORDS[language]!.otherRecord!;
    const found: Array<string> = [];

    for (const page of listPages(language)) {
      for (const block of blocksOf(readPage(language, page))) {
        if (!block.code && otherRecord.test(wordsOf(block.text))) {
          found.push(
            `${language}/${page}.md:${block.line + 1} ${otherRecord.exec(wordsOf(block.text))![0]}`,
          );
        }
      }
    }

    expect(found).toEqual([]);
  });

  test("English names no maintenance event scheduled", () => {
    const SCHEDULED_MAINTENANCE_EVENT: RegExp =
      /\bscheduled maintenance events?\b/i;
    const found: Array<string> = [];

    for (const page of listPages("en")) {
      for (const block of blocksOf(readPage("en", page))) {
        if (
          !block.code &&
          SCHEDULED_MAINTENANCE_EVENT.test(proseOf(block.text))
        ) {
          found.push(`en/${page}.md:${block.line + 1}`);
        }
      }
    }

    expect(found).toEqual([]);
  });
});

describe("Danish, Korean, Hindi and Persian docs call maintenance by one word (#7639)", () => {
  test.each(Object.keys(MAINTENANCE_WORDS))(
    "%s: every block whose English says maintenance uses the language's word",
    (language: string) => {
      const { paired, unpaired } = pairedBlocks(
        language,
        (block: DocsBlock): boolean => {
          return SAYS_MAINTENANCE.test(wordsOf(block.text));
        },
      );
      const problems: Array<string> = [];

      for (const block of paired) {
        const dropped: string | null = droppedMaintenanceWordIn(
          language,
          block.english,
          wordsOf(block.translation),
        );

        if (dropped) {
          problems.push(
            `${language}/${block.page}.md:${block.line} ${dropped}`,
          );
        }
      }

      expect({ language, unpaired, problems }).toEqual({
        language,
        unpaired: [],
        problems: [],
      });
    },
  );
});

describe("the check itself (controls)", () => {
  test("a page's blocks are its paragraphs, items, rows and code lines", () => {
    const blocks: Array<DocsBlock> = blocksOf(
      [
        "# Title",
        "",
        "A paragraph that",
        "wraps onto a second line.",
        "",
        "- An item",
        "  that wraps.",
        "- Another item",
        "",
        "| a | b |",
        "| --- | --- |",
        "",
        "> A quote",
        "> on two lines.",
        "",
        "```mermaid",
        '    a["Maintenance<br/>events"] --> b',
        "```",
        "",
        "```bash",
        "# A maintenance event in code",
        "```",
      ].join("\n"),
    );

    expect(
      blocks.map((block: DocsBlock): [number, string, boolean] => {
        return [block.line, block.text, block.code];
      }),
    ).toEqual([
      [0, "# Title", false],
      [2, "A paragraph that wraps onto a second line.", false],
      [5, "- An item that wraps.", false],
      [7, "- Another item", false],
      [9, "| a | b |", false],
      [10, "| --- | --- |", false],
      [12, "> A quote > on two lines.", false],
      [15, "```mermaid", true],
      [16, '    a["Maintenance<br/>events"] --> b', false],
      [17, "```", true],
      [19, "```bash", true],
      [20, "# A maintenance event in code", true],
      [21, "```", true],
    ]);
  });

  test("the old words, and a record called a maintenance, are found", () => {
    expect(
      recordProblems(
        "da",
        "A maintenance event starts on time.",
        "En vedligeholdelsesbegivenhed starter til tiden.",
      ),
    ).toEqual([
      "does not name the record by the Dashboard's word",
      'names it "vedligeholdelsesbegivenhed", not the Dashboard\'s word',
    ]);
    expect(
      recordProblems(
        "de",
        "A maintenance event starts on time.",
        "Ein geplantes Wartungsereignis beginnt pünktlich.",
      ),
    ).toEqual(['says "geplantes Wartung", the scheduled maintenance wording']);
    expect(
      recordProblems(
        "fr",
        "when a maintenance event next reminds its subscribers",
        "quand une maintenance rappelle de nouveau ses abonnés",
      ),
    ).toEqual(["does not name the record by the Dashboard's word"]);
    // The second sentence names it with another noun (#8090's ask-ai.md:65).
    expect(
      recordProblems(
        "da",
        "On a maintenance event, the questions follow. A maintenance event that has not started asks.",
        "På en vedligeholdelseshændelse følger spørgsmålene. En vedligeholdelse, der ikke er startet, spørger.",
      ),
    ).toEqual(["names it fewer times than the English does"]);
    expect(
      recordProblems(
        "ko",
        "Runbook rules start when an incident or a maintenance event is created.",
        "인시던트 또는 점검 이벤트가 만들어질 때 시작합니다.",
      ),
    ).toEqual([
      "does not name the record by the Dashboard's word",
      'names it "점검 이벤트", not the Dashboard\'s word',
    ]);
  });

  test("what the translation keeps is not a problem", () => {
    // A bold menu path names the product.
    expect(
      recordProblems(
        "de",
        "Open **Scheduled Maintenance → Settings** for maintenance events.",
        "Öffnen Sie **Geplante Wartung → Einstellungen** für Wartungsereignisse.",
      ),
    ).toEqual([]);
    // The English names the product too.
    expect(
      recordProblems(
        "de",
        "Scheduled Maintenance shows each maintenance event.",
        "Geplante Wartung zeigt jedes Wartungsereignis.",
      ),
    ).toEqual([]);
    // A model name kept in English.
    expect(
      recordProblems(
        "de",
        "| Scheduled maintenance | Maintenance Event |",
        "| Geplante Wartung | Maintenance Event |",
      ),
    ).toEqual([]);
    // A diagram label wrapped across a line break.
    expect(
      recordProblems(
        "nl",
        'events["Maintenance events"]',
        'events["Onderhouds-<br/>gebeurtenissen"]',
      ),
    ).toEqual([]);
    expect(
      recordProblems(
        "da",
        "A maintenance event starts on time.",
        "En vedligeholdelseshændelse starter til tiden.",
      ),
    ).toEqual([]);
  });
});
