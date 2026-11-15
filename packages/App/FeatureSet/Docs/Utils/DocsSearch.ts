import DocsAIReader, {
  AIDocsIndexedPage,
  AIDocsIndexedSection,
  AIDocsLanguageIndex,
  splitDocsWords,
  tokenizeForDocs,
} from "./AIDocsReader";
import {
  DocsSearchSynonym,
  DocsVocabularyMatch,
  foldDocsSearchWord,
  getDocsSearchQuestionWords,
  getDocsSearchSynonyms,
  getTypoAllowance,
} from "./DocsSearchWords";
import { localizeDocsUrl } from "./I18n";

/*
 * DOCS SEARCH: THE WHOLE PAGE, FORGIVING (issue #6822).
 *
 * What the docs' search box and Search (Cmd/Ctrl+K)'s Docs group ask, at
 * /docs/search/<lang>.json?q=. It reads every page in full, split at its
 * h2 and h3 headings, so a phrase from the middle of a page lands on the
 * section that says it, and it forgives the way people type:
 *
 *   - a word with a wrong letter or two: "escalaton" finds escalation;
 *   - the start of a word, as it is being typed: "kube" finds Kubernetes;
 *   - a reader's word for what the docs call otherwise: "pager" finds the
 *     on-call pages (Utils/DocsSearchWords.ts, a short list per language).
 *
 * Every word typed must be found in a result (a word no page holds, or
 * nearly spells, is set aside); when no page has them all, the pages with
 * most of them are offered. A word a question is phrased with is not
 * looked for, as Ask AI does not look for it: "Wie überwache ich meine
 * Website?" is "überwache" and "Website". A page's title counts most,
 * then a section's heading, then what a section says; a word every page
 * holds counts little. A guide (NavLink.isGuide) goes above a reference
 * page for the same words, and one page offers at most three results.
 *
 * Why on the server, not in the browser: the whole text of the docs, as an
 * index a browser could search, measured 1.2 to 3 MB per language (470 KB
 * to 1.6 MB compressed), too much to load each time someone opens search.
 * This reads the index Ask AI already keeps per language (AIDocsReader),
 * so there is one index in memory, not two. Every installation serves its
 * own docs, an air-gapped one too, so nothing leaves it.
 */

export const DOCS_SEARCH_QUERY_MAX_LENGTH: number = 100;
export const DOCS_SEARCH_DEFAULT_LIMIT: number = 20;
export const DOCS_SEARCH_MAX_LIMIT: number = 30;

// One page offers at most this many results: a long page does not fill the list.
const RESULTS_PER_PAGE: number = 3;
// About how long the line of a result is, in characters.
const SNIPPET_LENGTH: number = 160;
// How much of the line comes before the first word found.
const SNIPPET_LEAD: number = 50;

// How much a word found in each place counts.
const PAGE_TITLE_WEIGHT: number = 10;
const SECTION_TITLE_WEIGHT: number = 8;
const SUMMARY_WEIGHT: number = 3;
const HEADINGS_WEIGHT: number = 3;
const GROUP_WEIGHT: number = 2;
// The page's title, for a section of it: "website ssl" finds Website Monitor's SSL section.
const PAGE_TITLE_FOR_SECTION_WEIGHT: number = 2;
const SECTION_TEXT_WEIGHT: number = 3;
const PAGE_TEXT_WEIGHT: number = 1.5;

/*
 * How much each way of matching a typed word counts, against the word
 * itself. A word with a synonym is a reader's word for the docs' one:
 * "pager" means on-call, not "page" (which its stem shares), so the
 * synonym counts in full and the word itself for a little.
 */
const SYNONYM_WEIGHT: number = 1;
const WORD_START_SYNONYM_WEIGHT: number = 0.95;
const WORD_WITH_SYNONYM_WEIGHT: number = 0.3;
const HYPHEN_PARTS_WEIGHT: number = 0.6;
// The start of a word no page holds as it is typed ("kube").
const WORD_START_WEIGHT: number = 0.7;
// The start of a word pages hold already ("page" while typing "pages"): a little.
const KNOWN_WORD_START_WEIGHT: number = 0.3;
const ONE_TYPO_WEIGHT: number = 0.75;
const TWO_TYPOS_WEIGHT: number = 0.5;
const GUIDE_BOOST: number = 1.4;
/*
 * A section that says what was typed word for word, three words or more:
 * "a phrase from the middle of a page" lands on the section it is from.
 */
const PHRASE_BOOST: number = 3;
const PHRASE_LEAST_WORDS: number = 3;

// Worked out once per section and per index, the first time a search needs it.
const sectionLengths: WeakMap<AIDocsIndexedSection, number> = new WeakMap();
const averageSectionLengths: WeakMap<AIDocsLanguageIndex, number> =
  new WeakMap();
const sectionPhrases: WeakMap<AIDocsIndexedSection, string> = new WeakMap();

// How many docs words one typed word may stand for, by its start or a typo.
const MOST_WORD_STARTS: number = 12;
const MOST_TYPO_MATCHES: number = 6;

// What was typed ends with a space: its last word is done, not being typed.
const ENDS_WITH_SPACE: RegExp = /\s$/;
const UNSPACED_SCRIPT: RegExp =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
// A word of a page's text, as it is written: hyphenated words whole.
const TEXT_WORD: RegExp = /[\p{L}\p{M}\p{N}]+(?:-[\p{L}\p{M}\p{N}]+)*/gu;

export interface DocsSearchResult {
  // The page's title, or the section's heading.
  title: string;
  // Where it is, as the nav names it: the group, then the page for a section.
  where: string;
  // The page in the reader's language, at the section for a section.
  url: string;
  // A line of what it says, around the first word found.
  snippet: string;
  isSection: boolean;
  isGuide: boolean;
}

export interface DocsSearchAnswer {
  query: string;
  results: Array<DocsSearchResult>;
  /*
   * The words of the results' titles and lines that matched what was typed,
   * as they are written there ("escalation" for "escalaton"): what the
   * search box marks.
   */
  words: Array<string>;
}

// One way a typed word is found: every one of `terms` in the same result.
export interface DocsQueryAlternative {
  terms: Array<string>;
  weight: number;
}

export interface DocsQueryWord {
  typed: string;
  alternatives: Array<DocsQueryAlternative>;
}

interface ScoredUnit {
  page: AIDocsIndexedPage;
  section: AIDocsIndexedSection | null;
  score: number;
  terms: Set<string>;
}

const isUnspaced: (word: string) => boolean = (word: string): boolean => {
  return UNSPACED_SCRIPT.test(word);
};

const addAlternative: (
  alternatives: Array<DocsQueryAlternative>,
  terms: Array<string>,
  weight: number,
) => void = (
  alternatives: Array<DocsQueryAlternative>,
  terms: Array<string>,
  weight: number,
): void => {
  if (terms.length === 0) {
    return;
  }

  const key: string = terms.join(" ");
  const existing: DocsQueryAlternative | undefined = alternatives.find(
    (alternative: DocsQueryAlternative): boolean => {
      return alternative.terms.join(" ") === key;
    },
  );

  if (existing) {
    existing.weight = Math.max(existing.weight, weight);
    return;
  }

  alternatives.push({ terms, weight });
};

export default class DocsSearch {
  public static async search(data: {
    query: string;
    language: string;
    limit?: number | undefined;
  }): Promise<DocsSearchAnswer> {
    const index: AIDocsLanguageIndex = await DocsAIReader.getIndex(
      data.language,
    );

    return DocsSearch.rank(index, data.query, data.limit);
  }

  /*
   * The synonyms of a typed word in `index`'s language, each as the docs
   * words it stands for: a phrase as its words, a word start as the docs
   * words it starts.
   */
  private static synonymAlternatives(
    index: AIDocsLanguageIndex,
    typed: string,
  ): Array<DocsQueryAlternative> {
    const alternatives: Array<DocsQueryAlternative> = [];
    const synonyms: Array<DocsSearchSynonym> =
      getDocsSearchSynonyms(index.language).get(foldDocsSearchWord(typed)) ||
      [];

    for (const synonym of synonyms) {
      if (synonym.isWordStart) {
        const start: string = foldDocsSearchWord(synonym.words);

        if (index.vocabulary.has(start)) {
          addAlternative(alternatives, [start], WORD_START_SYNONYM_WEIGHT);
        }

        for (const match of index.vocabulary.startingWith(
          start,
          MOST_WORD_STARTS,
        )) {
          addAlternative(alternatives, [match.term], WORD_START_SYNONYM_WEIGHT);
        }
        continue;
      }

      const terms: Array<string> = Array.from(
        new Set<string>(tokenizeForDocs(synonym.words)),
      );

      if (
        terms.every((term: string): boolean => {
          return index.vocabulary.has(term);
        })
      ) {
        addAlternative(alternatives, terms, SYNONYM_WEIGHT);
      }
    }

    return alternatives;
  }

  /*
   * Docs words a typed word may stand for, by its start or a typo, each
   * counting for less the less it is used than the most used of them: half
   * typed, "kube" more likely means Kubernetes, on many pages, than
   * kubectl, on a few, though kubectl is the rarer word.
   */
  private static addByUse(
    alternatives: Array<DocsQueryAlternative>,
    matches: Array<DocsVocabularyMatch>,
    weightOf: (match: DocsVocabularyMatch) => number,
  ): void {
    const mostUsed: number = Math.max(
      1,
      ...matches.map((match: DocsVocabularyMatch): number => {
        return match.pages;
      }),
    );

    for (const match of matches) {
      addAlternative(
        alternatives,
        [match.term],
        weightOf(match) * (0.5 + (0.5 * match.pages) / mostUsed),
      );
    }
  }

  /*
   * What was typed, as the words to find: each with the ways it may be
   * found. The last word, while it is still being typed (no space after
   * it), is also found by its start; a word no page holds is found by its
   * start and by the docs words it spells with a wrong letter or two. A
   * word with no way to be found (nothing like it in the docs, or a word
   * every question has: "how", "the") is left out.
   *
   * So is a word a question is phrased with in the index's language
   * (#7874): German "wie", "ich" and "meine" (getDocsSearchQuestionWords,
   * the list Ask AI's search leaves out too). The German docs say "Sie"
   * and "Ihre", so the pages that hold "ich" and "meine" are the ones that
   * quote a question: "Wie überwache ich meine Website?" found those, not
   * Website-Überwachung. Typed with nothing else they are read, since the
   * index holds them: "ein" finds pages while "Einstellungen" is being
   * typed. A word left out still ends what was typed, so the word before
   * it is not read by its start.
   */
  public static readQuery(
    index: AIDocsLanguageIndex,
    query: string,
  ): Array<DocsQueryWord> {
    const typedWords: Array<string> = splitDocsWords(query);
    const isTyping: boolean = !ENDS_WITH_SPACE.test(query);
    const questionWords: ReadonlySet<string> = getDocsSearchQuestionWords(
      index.language,
    );
    const isQuestionWord: (typed: string) => boolean = (
      typed: string,
    ): boolean => {
      return questionWords.has(foldDocsSearchWord(typed));
    };
    const isOnlyQuestionWords: boolean = typedWords.every(isQuestionWord);
    const words: Array<DocsQueryWord> = [];

    typedWords.forEach((typed: string, position: number): void => {
      if (!isOnlyQuestionWords && isQuestionWord(typed)) {
        return;
      }

      const isLast: boolean = position === typedWords.length - 1;
      const parts: Array<string> = typed
        .split("-")
        .filter((part: string): boolean => {
          return part.length > 0;
        });
      const tokens: Array<string> = tokenizeForDocs(typed);
      const synonyms: Array<DocsQueryAlternative> =
        DocsSearch.synonymAlternatives(index, typed);

      // Chinese and Japanese: each pair of characters is a word to find.
      if (isUnspaced(typed)) {
        for (const pair of Array.from(new Set<string>(tokens))) {
          const alternatives: Array<DocsQueryAlternative> = [...synonyms];
          if (index.vocabulary.has(pair)) {
            addAlternative(alternatives, [pair], 1);
          }
          words.push({ typed: pair, alternatives });
        }
        return;
      }

      const alternatives: Array<DocsQueryAlternative> = [...synonyms];

      if (parts.length >= 2) {
        // "on-call": the whole word joined, or else its parts in one place.
        const joined: string = tokens[tokens.length - 1] || "";
        const partTerms: Array<string> = Array.from(
          new Set<string>(tokenizeForDocs(parts.join(" "))),
        );

        if (index.vocabulary.has(joined)) {
          addAlternative(alternatives, [joined], 1);
        }

        if (
          partTerms.length > 0 &&
          partTerms.every((term: string): boolean => {
            return index.vocabulary.has(term);
          })
        ) {
          addAlternative(alternatives, partTerms, HYPHEN_PARTS_WEIGHT);
        }
      } else {
        const term: string | undefined = tokens[0];

        if (term === undefined && synonyms.length === 0) {
          // A word every question has ("how", "the"): nothing to find.
          return;
        }

        if (term !== undefined && synonyms.length > 0) {
          // A reader's word for a docs word: the docs word first, itself after.
          if (index.vocabulary.has(term)) {
            addAlternative(alternatives, [term], WORD_WITH_SYNONYM_WEIGHT);
          }
        } else if (term !== undefined) {
          const isKnown: boolean = index.vocabulary.has(term);

          if (isKnown) {
            addAlternative(alternatives, [term], 1);
          }

          if ((isTyping && isLast) || !isKnown) {
            const folded: string = foldDocsSearchWord(typed);
            const starts: Array<DocsVocabularyMatch> = [];

            for (const start of Array.from(new Set<string>([folded, term]))) {
              if (Array.from(start).length >= 2) {
                starts.push(
                  ...index.vocabulary.startingWith(start, MOST_WORD_STARTS),
                );
              }
            }

            /*
             * A word pages hold is meant as typed - unless a word it starts
             * is on many more pages: "kube" is a word of "kube-system",
             * but who types it means Kubernetes.
             */
            const ownPages: number = index.vocabulary.pagesHolding(term);
            DocsSearch.addByUse(
              alternatives,
              starts,
              (match: DocsVocabularyMatch): number => {
                return !isKnown || match.pages >= 3 * ownPages
                  ? WORD_START_WEIGHT
                  : KNOWN_WORD_START_WEIGHT;
              },
            );
          }

          if (!isKnown) {
            DocsSearch.addByUse(
              alternatives,
              index.vocabulary.near(
                term,
                getTypoAllowance(term),
                MOST_TYPO_MATCHES,
              ),
              (match: DocsVocabularyMatch): number => {
                return match.distance === 1
                  ? ONE_TYPO_WEIGHT
                  : TWO_TYPOS_WEIGHT;
              },
            );
          }
        }
      }

      if (alternatives.length > 0) {
        words.push({ typed, alternatives });
      }
    });

    return words;
  }

  private static pageFieldWeight(
    page: AIDocsIndexedPage,
    term: string,
  ): number {
    const count: number = page.bodyTerms.get(term) || 0;

    return Math.max(
      page.titleTerms.has(term) ? PAGE_TITLE_WEIGHT : 0,
      page.summaryTerms.has(term) ? SUMMARY_WEIGHT : 0,
      page.headingTerms.has(term) ? HEADINGS_WEIGHT : 0,
      page.groupTerms.has(term) ? GROUP_WEIGHT : 0,
      count > 0 ? (PAGE_TEXT_WEIGHT * count) / (count + 2) : 0,
    );
  }

  // How many words a section holds, and a language's sections on average.
  private static sectionLength(section: AIDocsIndexedSection): number {
    let length: number | undefined = sectionLengths.get(section);

    if (length === undefined) {
      length = 0;
      for (const count of section.terms.values()) {
        length += count;
      }
      sectionLengths.set(section, length);
    }

    return length;
  }

  private static averageSectionLength(index: AIDocsLanguageIndex): number {
    let average: number | undefined = averageSectionLengths.get(index);

    if (average === undefined) {
      let total: number = 0;
      let sections: number = 0;
      for (const page of index.pages) {
        for (const section of page.sections) {
          total += DocsSearch.sectionLength(section);
          sections++;
        }
      }
      average = Math.max(1, total / Math.max(1, sections));
      averageSectionLengths.set(index, average);
    }

    return average;
  }

  /*
   * A word found in what a section says counts for less the longer the
   * section is (BM25): a long section - the upgrade notes - holds almost
   * every word once, and a short one holding it is about it.
   */
  private static sectionFieldWeight(
    page: AIDocsIndexedPage,
    section: AIDocsIndexedSection,
    term: string,
    averageLength: number,
  ): number {
    const count: number = section.terms.get(term) || 0;
    const lengthRatio: number =
      DocsSearch.sectionLength(section) / averageLength;

    return Math.max(
      section.titleTerms.has(term) ? SECTION_TITLE_WEIGHT : 0,
      count > 0
        ? (SECTION_TEXT_WEIGHT * count) /
            (count + 1.5 * (0.25 + 0.75 * lengthRatio))
        : 0,
      !section.isOtherName && page.titleTerms.has(term)
        ? PAGE_TITLE_FOR_SECTION_WEIGHT
        : 0,
    );
  }

  // Text as a phrase is compared: lower case, one space between words.
  private static asPhrase(text: string): string {
    return ` ${text
      .normalize("NFKC")
      .toLowerCase()
      .split(/[^\p{L}\p{M}\p{N}]+/u)
      .filter((word: string): boolean => {
        return word.length > 0;
      })
      .join(" ")} `;
  }

  private static sectionPhrase(section: AIDocsIndexedSection): string {
    let phrase: string | undefined = sectionPhrases.get(section);

    if (phrase === undefined) {
      phrase = DocsSearch.asPhrase(`${section.title} ${section.text}`);
      sectionPhrases.set(section, phrase);
    }

    return phrase;
  }

  /*
   * The results for `query` in `index`, best first: pages and sections,
   * each with its line of text and the words in it to mark.
   */
  public static rank(
    index: AIDocsLanguageIndex,
    query: string,
    limit?: number | undefined,
  ): DocsSearchAnswer {
    const trimmed: string = query.slice(0, DOCS_SEARCH_QUERY_MAX_LENGTH);
    const resultLimit: number = Math.min(
      DOCS_SEARCH_MAX_LIMIT,
      Math.max(1, Math.floor(limit || DOCS_SEARCH_DEFAULT_LIMIT)),
    );
    const answer: DocsSearchAnswer = {
      query: trimmed.trim(),
      results: [],
      words: [],
    };
    const words: Array<DocsQueryWord> = DocsSearch.readQuery(index, trimmed);

    if (words.length === 0) {
      return answer;
    }

    const pageCount: number = index.pages.length;
    const weight: (term: string) => number = (term: string): number => {
      return Math.log(
        1 + pageCount / (1 + index.vocabulary.pagesHolding(term)),
      );
    };
    const averageLength: number = DocsSearch.averageSectionLength(index);
    const phrase: string | null =
      splitDocsWords(trimmed).length >= PHRASE_LEAST_WORDS
        ? ENDS_WITH_SPACE.test(trimmed)
          ? DocsSearch.asPhrase(trimmed)
          : DocsSearch.asPhrase(trimmed).trimEnd()
        : null;

    const scoreUnit: (fieldWeight: (term: string) => number) => {
      score: number;
      matched: number;
      terms: Set<string>;
    } = (
      fieldWeight: (term: string) => number,
    ): { score: number; matched: number; terms: Set<string> } => {
      let score: number = 0;
      let matched: number = 0;
      const terms: Set<string> = new Set<string>();

      for (const word of words) {
        let best: number = 0;
        let bestTerms: Array<string> = [];

        for (const alternative of word.alternatives) {
          let total: number = 0;
          let isEvery: boolean = true;

          for (const term of alternative.terms) {
            const found: number = fieldWeight(term);
            if (found === 0) {
              isEvery = false;
              break;
            }
            total += found * weight(term);
          }

          if (!isEvery) {
            continue;
          }

          const value: number =
            (total / alternative.terms.length) * alternative.weight;

          if (value > best) {
            best = value;
            bestTerms = alternative.terms;
          }
        }

        if (best > 0) {
          matched++;
          score += best;
          for (const term of bestTerms) {
            terms.add(term);
          }
        }
      }

      return { score, matched, terms };
    };

    const complete: Array<ScoredUnit> = [];
    const partial: Array<ScoredUnit> = [];
    const keep: (
      page: AIDocsIndexedPage,
      section: AIDocsIndexedSection | null,
      scored: { score: number; matched: number; terms: Set<string> },
    ) => void = (
      page: AIDocsIndexedPage,
      section: AIDocsIndexedSection | null,
      scored: { score: number; matched: number; terms: Set<string> },
    ): void => {
      if (scored.matched === 0) {
        return;
      }

      const share: number = scored.matched / words.length;
      const unit: ScoredUnit = {
        page,
        section,
        score: scored.score * (page.isGuide ? GUIDE_BOOST : 1),
        terms: scored.terms,
      };

      if (share === 1) {
        if (
          phrase &&
          section &&
          DocsSearch.sectionPhrase(section).includes(phrase)
        ) {
          unit.score *= PHRASE_BOOST;
        }
        complete.push(unit);
      } else if (share >= 0.5) {
        unit.score *= share * share;
        partial.push(unit);
      }
    };

    for (const page of index.pages) {
      keep(
        page,
        null,
        scoreUnit((term: string): number => {
          return DocsSearch.pageFieldWeight(page, term);
        }),
      );

      for (const section of page.sections) {
        keep(
          page,
          section,
          scoreUnit((term: string): number => {
            return DocsSearch.sectionFieldWeight(
              page,
              section,
              term,
              averageLength,
            );
          }),
        );
      }
    }

    const units: Array<ScoredUnit> = (
      complete.length > 0 ? complete : partial
    ).sort((a: ScoredUnit, b: ScoredUnit): number => {
      return (
        b.score - a.score ||
        a.page.page.localeCompare(b.page.page) ||
        (a.section?.anchor || "").localeCompare(b.section?.anchor || "")
      );
    });

    const perPage: Map<string, number> = new Map();
    const marked: Set<string> = new Set<string>();

    for (const unit of units) {
      if (answer.results.length >= resultLimit) {
        break;
      }

      const shown: number = perPage.get(unit.page.page) || 0;

      if (shown >= RESULTS_PER_PAGE) {
        continue;
      }

      perPage.set(unit.page.page, shown + 1);

      const title: string = unit.section ? unit.section.title : unit.page.title;
      const text: string = unit.section
        ? unit.section.text || unit.page.summary
        : unit.page.summary;
      const snippet: { text: string; words: Array<string> } =
        DocsSearch.snippetOf(text, unit.terms);

      for (const word of [
        ...DocsSearch.wordsFound(title, unit.terms),
        ...snippet.words,
      ]) {
        marked.add(word);
      }

      const pageUrl: string = localizeDocsUrl(
        `/docs/${unit.page.page}`,
        index.language,
      );

      answer.results.push({
        title,
        where: unit.section
          ? `${unit.page.group} › ${unit.page.title}`
          : unit.page.group,
        url: unit.section ? `${pageUrl}#${unit.section.anchor}` : pageUrl,
        snippet: snippet.text,
        isSection: Boolean(unit.section),
        isGuide: unit.page.isGuide,
      });
    }

    answer.words = Array.from(marked).sort((a: string, b: string): number => {
      return b.length - a.length || a.localeCompare(b);
    });

    return answer;
  }

  /*
   * Where in `text` a word of `terms` is written, and as what: each word
   * of the text read as the index reads it. In Chinese and Japanese, the
   * pair of characters itself.
   */
  private static hitsIn(
    text: string,
    terms: Set<string>,
  ): Array<{ at: number; word: string }> {
    const hits: Array<{ at: number; word: string }> = [];

    for (const match of text.matchAll(TEXT_WORD)) {
      const written: string = match[0];
      const at: number = match.index || 0;

      if (isUnspaced(written)) {
        const characters: Array<string> = Array.from(written);
        let offset: number = 0;

        for (let i: number = 0; i < characters.length - 1; i++) {
          const pair: string = `${characters[i]}${characters[i + 1]}`;
          if (terms.has(pair)) {
            hits.push({ at: at + offset, word: pair });
          }
          offset += characters[i]!.length;
        }
        continue;
      }

      if (
        tokenizeForDocs(written).some((term: string): boolean => {
          return terms.has(term);
        })
      ) {
        hits.push({ at, word: written });
      }
    }

    return hits;
  }

  private static wordsFound(text: string, terms: Set<string>): Array<string> {
    return DocsSearch.hitsIn(text, terms).map(
      (hit: { word: string }): string => {
        return hit.word.toLowerCase();
      },
    );
  }

  /*
   * A line of `text` around the first word of `terms` it holds, cut at
   * words, with an ellipsis where it was cut; its start when it holds none.
   */
  public static snippetOf(
    text: string,
    terms: Set<string>,
  ): { text: string; words: Array<string> } {
    const hits: Array<{ at: number; word: string }> = DocsSearch.hitsIn(
      text,
      terms,
    );
    const first: number = hits[0] ? hits[0].at : 0;
    let start: number = Math.max(0, first - SNIPPET_LEAD);

    if (start > 0) {
      const space: number = text.indexOf(" ", start);
      start = space >= 0 && space < first ? space + 1 : start;
    }

    let end: number = Math.min(text.length, start + SNIPPET_LENGTH);

    if (end < text.length) {
      const space: number = text.lastIndexOf(" ", end);
      end = space > Math.max(start, first) ? space : end;
    }

    const line: string = text.slice(start, end).trim();
    const words: Array<string> = hits
      .filter((hit: { at: number }): boolean => {
        return hit.at >= start && hit.at < end;
      })
      .map((hit: { word: string }): string => {
        return hit.word.toLowerCase();
      });

    return {
      text: `${start > 0 ? "…" : ""}${line}${end < text.length ? "…" : ""}`,
      words: Array.from(new Set<string>(words)),
    };
  }
}
