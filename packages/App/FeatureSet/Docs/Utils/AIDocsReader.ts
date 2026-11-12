import { ContentPath } from "./Config";
import {
  DocsSearchSynonym,
  DocsVocabulary,
  DocsVocabularyMatch,
  foldDocsSearchWord,
  getDocsSearchSynonyms,
  getTypoAllowance,
} from "./DocsSearchWords";
import { DocsGlossaryEntry, GLOSSARY_PAGE, parseGlossary } from "./Glossary";
import DocsNav, { NavGroup, NavLink } from "./Nav";
import DocsPlaceholders from "./Placeholders";
import {
  DocsPageSummary,
  stripInlineMarkdown,
  summarizeDocsPage,
} from "./SearchIndex";
import {
  DEFAULT_DOCS_LANGUAGE,
  isSupportedDocsLanguage,
  makeT,
  TranslateFn,
} from "./I18n";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import {
  AIDocsPage,
  AIDocsReader,
  AIDocsSearchHit,
  AIDocsSection,
} from "Common/Server/Utils/AI/Docs/AIDocsLibrary";
import LocalFile from "Common/Server/Utils/LocalFile";
import OneUptimeDate from "Common/Types/Date";

/*
 * THE DOCS, AS ASK AI READS THEM (issue #6828).
 *
 * Ask AI answers "how do I...?" from this installation's own docs: the
 * pages its docs site serves, in the reader's language where a page is
 * translated and in English where it is not - the copy the docs site
 * itself would show. Registered with Common's AIDocsLibrary when the Docs
 * feature set starts; the tools that call it are Common's DocsTools.
 *
 * Search reads every page in the nav in full - its title, headings, first
 * paragraph and body - so "get a text when my site is down" finds the page
 * that says how, not only one named after it. Words that most pages hold
 * ("monitor", "OneUptime") weigh little; a page's title and headings weigh
 * most. Each hit names the section that matched best, so an answer can
 * send the reader to the section, not just the page.
 *
 * The same index answers the docs' own search box and Search (Cmd/Ctrl+K)'s
 * Docs group (Utils/DocsSearch.ts, issue #6822). So it also keeps each
 * section's text (for the line a result shows), every word with how many
 * pages hold it (for a word typed with a wrong letter, or half typed), the
 * Glossary's other names as sections of their own, and which pages are
 * guides. A word a question misspells is read as the docs word it nearly
 * spells, and a reader's word for what the docs call otherwise ("pager")
 * as the docs' word (Utils/DocsSearchWords.ts).
 */

export interface AIDocsIndexedSection extends AIDocsSection {
  terms: Map<string, number>;
  titleTerms: Set<string>;
  /*
   * What the section says, as plain text (plainTextOfDocs): the line a
   * search result shows is cut from it.
   */
  text: string;
  /*
   * A name the Glossary gives a term besides its own ("Service Catalog
   * (Service)"), as a section that opens the term: found by that name.
   */
  isOtherName?: boolean | undefined;
}

export interface AIDocsIndexedPage {
  page: string;
  title: string;
  group: string;
  summary: string;
  language: string;
  titleTerms: Set<string>;
  groupTerms: Set<string>;
  summaryTerms: Set<string>;
  headingTerms: Set<string>;
  bodyTerms: Map<string, number>;
  // How many words its body holds.
  bodyLength: number;
  sections: Array<AIDocsIndexedSection>;
  // A guide (NavLink.isGuide): docs search ranks it above a reference page for the same words.
  isGuide: boolean;
}

export interface AIDocsLanguageIndex {
  // The language it was built for; a page not translated yet is its English copy.
  language: string;
  pages: Array<AIDocsIndexedPage>;
  // How many pages hold each word.
  documentFrequency: Map<string, number>;
  // How many words a page's body holds, on average.
  averageBodyLength: number;
  // Every word, laid out to find the ones a typed word starts or nearly spells.
  vocabulary: DocsVocabulary;
}

const TTL_MS: number = 10 * 60 * 1000;
const FENCE_LINE: RegExp = /^\s*(```|~~~)/;
const HEADING_LINE: RegExp = /^(#{2,3})\s+(.+?)\s*#*\s*$/;
const DOCS_PAGE: RegExp = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/;

/*
 * Words a question is phrased with rather than about. Only English: in
 * other languages such words are in most pages and weigh next to nothing
 * anyway.
 */
const QUESTION_WORDS: ReadonlySet<string> = new Set<string>([
  "a",
  "an",
  "and",
  "are",
  "be",
  "can",
  "do",
  "does",
  "for",
  "how",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "the",
  "there",
  "this",
  "that",
  "to",
  "we",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "you",
  "your",
]);

// Scripts written without spaces between words: read in pairs of characters.
const UNSPACED_SCRIPT: RegExp =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

const cache: Map<string, { index: AIDocsLanguageIndex; at: number }> =
  new Map();
// The builds under way, by language.
const building: Map<string, Promise<AIDocsLanguageIndex>> = new Map();

/*
 * A word as both a question and a page are compared by: lowercase, a
 * Latin-script word without its accents and without one plural or verb
 * ending, so "monitors" finds "monitor", "paging" finds "paged", and
 * "Bereitschaftsplan" finds "Bereitschaftspläne". Other scripts are
 * compared as written: their marks are part of their letters (Devanagari's
 * vowel signs).
 */
const LATIN_WORD: RegExp = /^[\p{Script=Latin}\p{M}\p{N}]+$/u;
const WORD_ENDINGS: ReadonlyArray<string> = [
  "ing",
  "ers",
  "ed",
  "es",
  "en",
  "er",
  "s",
  "e",
];

export const stemDocsWord: (word: string) => string = (
  word: string,
): string => {
  if (!LATIN_WORD.test(word)) {
    return word;
  }

  const folded: string = word.normalize("NFKD").replace(/\p{M}/gu, "");

  for (const ending of WORD_ENDINGS) {
    if (folded.endsWith(ending) && folded.length - ending.length >= 3) {
      return folded.slice(0, folded.length - ending.length);
    }
  }

  return folded;
};

// What is typed or written, cut where a word ends - but not at a hyphen.
const NOT_A_WORD_OR_HYPHEN: RegExp = /[^\p{L}\p{M}\p{N}-]+/u;
const ONLY_DIGITS: RegExp = /^\p{N}+$/u;
// A hyphenated word of more parts than this (an id, a version) is not read joined.
const MOST_JOINED_PARTS: number = 4;

/*
 * The words of what was typed or written, as they come: each run of
 * letters and digits between spaces and punctuation, a hyphenated word
 * ("on-call") as one.
 */
export const splitDocsWords: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .split(NOT_A_WORD_OR_HYPHEN)
    .filter((chunk: string): boolean => {
      return chunk.replace(/-/g, "").length > 0;
    });
};

/*
 * A hyphenated word is also read joined: "on-call" as "oncall",
 * "two-factor" as "twofactor", "Zwei-Faktor-Authentifizierung" as
 * "zweifaktor" and the rest. So "oncall" finds "on-call", and a synonym can
 * name the whole word ("pager" is "on-call") even where one of its parts
 * ("on") is too common to be a word of its own.
 */
const joinedWords: (parts: Array<string>) => Array<string> = (
  parts: Array<string>,
): Array<string> => {
  if (
    parts.length < 2 ||
    parts.length > MOST_JOINED_PARTS ||
    parts.some((part: string): boolean => {
      return UNSPACED_SCRIPT.test(part);
    }) ||
    parts.every((part: string): boolean => {
      return ONLY_DIGITS.test(part);
    })
  ) {
    return [];
  }

  const joined: Array<string> = [];

  for (let size: number = 2; size <= parts.length; size++) {
    for (let start: number = 0; start + size <= parts.length; start++) {
      joined.push(stemDocsWord(parts.slice(start, start + size).join("")));
    }
  }

  return joined;
};

/*
 * A newcomer's words for what the docs say otherwise, read into a question
 * only, never into a page: "a text when my site is down" is an SMS, "2fa"
 * is two-factor authentication (DOCS_SEARCH_SYNONYMS, the list docs search
 * reads too). A synonym that is a word's start ("vagt*") needs the docs'
 * words to be read, so it is left to rank.
 */
export const tokenizeQueryForDocs: (
  query: string,
  language?: string | undefined,
) => Array<string> = (
  query: string,
  language?: string | undefined,
): Array<string> => {
  const synonyms: Map<string, Array<DocsSearchSynonym>> = getDocsSearchSynonyms(
    language || DEFAULT_DOCS_LANGUAGE,
  );
  const otherWords: Array<string> = splitDocsWords(query).flatMap(
    (word: string): Array<string> => {
      return (synonyms.get(foldDocsSearchWord(word)) || [])
        .filter((synonym: DocsSearchSynonym): boolean => {
          return !synonym.isWordStart;
        })
        .map((synonym: DocsSearchSynonym): string => {
          return synonym.words;
        });
    },
  );

  return Array.from(
    new Set<string>([
      ...tokenizeForDocs(query),
      ...tokenizeForDocs(otherWords.join(" ")),
    ]),
  );
};

export const tokenizeForDocs: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  const terms: Array<string> = [];

  for (const chunk of splitDocsWords(text)) {
    const words: Array<string> = chunk
      .split("-")
      .filter((word: string): boolean => {
        return word.length > 0;
      });

    for (const word of words) {
      if (UNSPACED_SCRIPT.test(word)) {
        const characters: Array<string> = Array.from(word);

        if (characters.length === 1) {
          terms.push(word);
          continue;
        }

        for (let i: number = 0; i < characters.length - 1; i++) {
          terms.push(`${characters[i]}${characters[i + 1]}`);
        }
        continue;
      }

      if (word.length < 2 || QUESTION_WORDS.has(word)) {
        continue;
      }

      terms.push(stemDocsWord(word));
    }

    terms.push(...joinedWords(words));
  }

  return terms;
};

const countTerms: (text: string) => Map<string, number> = (
  text: string,
): Map<string, number> => {
  const counts: Map<string, number> = new Map();

  for (const term of tokenizeForDocs(text)) {
    counts.set(term, (counts.get(term) || 0) + 1);
  }

  return counts;
};

const termSet: (text: string) => Set<string> = (text: string): Set<string> => {
  return new Set<string>(tokenizeForDocs(text));
};

// A component's own line, keeping what follows its name (a collapsible's title).
const COMPONENT_LINE: RegExp = /^:{3,}\s*[a-z-]*\s*/;
// A table's rule: "| --- | :---: |".
const TABLE_RULE: RegExp = /^\|?[\s:|-]*-[\s:|-]*\|?$/;
// What opens a line without being its words: a heading's marks, a quote, a callout's marker, a list's bullet, a tab.
const LINE_MARKER: RegExp =
  /^(?:#{1,6}\s+|>\s*(?:\[![A-Z]+\]\s*)?|[-*+]\s+|\d+[.)]\s+|@tab\s+)/;

/*
 * What a page or a section says, as plain text: fenced code, tables' rules
 * and components' own syntax left out, a collapsible's title kept, links
 * and emphasis read as their words.
 */
export const plainTextOfDocs: (markdown: string) => string = (
  markdown: string,
): string => {
  const lines: Array<string> = [];
  let inFence: boolean = false;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }

    const trimmed: string = line.trim();

    if (inFence || !trimmed || TABLE_RULE.test(trimmed)) {
      continue;
    }

    const text: string = trimmed
      .replace(COMPONENT_LINE, "")
      .replace(LINE_MARKER, "")
      .replace(/\|/g, " ");

    if (text.trim()) {
      lines.push(stripInlineMarkdown(text));
    }
  }

  return lines.join(" ").replace(/\s+/g, " ").trim();
};

/*
 * A page's address under /docs/<lang>/, from what the model may pass:
 * "monitor/website-monitor", "/docs/de/monitor/website-monitor#ssl" or a
 * full address. Null for anything that cannot be one.
 */
export const normalizeDocsPage: (value: string) => string | null = (
  value: string,
): string | null => {
  let page: string = value.trim();

  const docsAt: number = page.indexOf("/docs/");
  if (docsAt >= 0) {
    page = page.slice(docsAt + "/docs/".length);
  }

  page = page
    .split("#")[0]!
    .split("?")[0]!
    .replace(/^\/+|\/+$/g, "");

  const firstSegment: string = page.split("/")[0] || "";
  if (isSupportedDocsLanguage(firstSegment) && page.includes("/")) {
    page = page.slice(firstSegment.length + 1);
  }

  page = page.replace(/\.md$/, "");

  return DOCS_PAGE.test(page) ? page : null;
};

interface DocsCopy {
  markdown: string;
  language: string;
}

const readCopy: (
  page: string,
  language: string,
) => Promise<DocsCopy | null> = async (
  page: string,
  language: string,
): Promise<DocsCopy | null> => {
  for (const candidate of [language, DEFAULT_DOCS_LANGUAGE]) {
    const path: string = `${ContentPath}/${candidate}/${page}.md`;
    if (await LocalFile.doesFileExist(path)) {
      return { markdown: await LocalFile.read(path), language: candidate };
    }
  }
  return null;
};

// Every page the nav lists, by its address under /docs/<lang>/, with its group.
const getNavPages: () => Array<{
  page: string;
  link: NavLink;
  group: NavGroup;
}> = (): Array<{ page: string; link: NavLink; group: NavGroup }> => {
  const pages: Array<{ page: string; link: NavLink; group: NavGroup }> = [];
  const seen: Set<string> = new Set<string>();

  for (const group of DocsNav as Array<NavGroup>) {
    for (const link of group.links as Array<NavLink>) {
      if (!link.url.startsWith("/docs/")) {
        continue;
      }

      const page: string | null = normalizeDocsPage(link.url);

      if (page && !seen.has(page)) {
        seen.add(page);
        pages.push({ page, link, group });
      }
    }
  }

  return pages;
};

/*
 * A page's sections, h2 and h3, each with the words under it up to the
 * next one; the words before the first heading are not a section.
 */
export const splitDocsSections: (
  markdown: string,
) => Array<{ title: string; anchor: string; body: string }> = (
  markdown: string,
): Array<{ title: string; anchor: string; body: string }> => {
  const sections: Array<{ title: string; anchor: string; body: string }> = [];
  let current: { title: string; anchor: string; lines: Array<string> } | null =
    null;
  let inFence: boolean = false;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
    }

    const heading: RegExpMatchArray | null = inFence
      ? null
      : line.match(HEADING_LINE);

    if (heading) {
      if (current) {
        sections.push({
          title: current.title,
          anchor: current.anchor,
          body: current.lines.join("\n"),
        });
      }
      current = {
        title: heading[2]!.replace(/[`*_]/g, ""),
        anchor: slugifyMarkdownHeading(heading[2]!.trim()),
        lines: [],
      };
      continue;
    }

    current?.lines.push(line);
  }

  if (current) {
    sections.push({
      title: current.title,
      anchor: current.anchor,
      body: current.lines.join("\n"),
    });
  }

  return sections;
};

/*
 * The Glossary's other names, each as a section that opens its term by
 * the term's English anchor (which the page answers in every language):
 * "Service Catalog (Service)", saying the term's definition. A copy that
 * is not the English page's shape gives the English names, as the Glossary
 * data does.
 */
const glossaryOtherNameSections: (
  language: string,
  markdown: string,
) => Promise<Array<AIDocsIndexedSection>> = async (
  language: string,
  markdown: string,
): Promise<Array<AIDocsIndexedSection>> => {
  const english: DocsCopy | null = await readCopy(
    GLOSSARY_PAGE,
    DEFAULT_DOCS_LANGUAGE,
  );

  if (!english) {
    return [];
  }

  const entries: Array<DocsGlossaryEntry> =
    parseGlossary(english.markdown, markdown, language) ||
    parseGlossary(english.markdown, english.markdown, DEFAULT_DOCS_LANGUAGE) ||
    [];

  return entries.flatMap(
    (entry: DocsGlossaryEntry): Array<AIDocsIndexedSection> => {
      return entry.alsoCalled.map((name: string): AIDocsIndexedSection => {
        const title: string = `${name} (${entry.term})`;

        return {
          title,
          anchor: entry.id,
          terms: countTerms(title),
          titleTerms: termSet(title),
          text: entry.definition,
          isOtherName: true,
        };
      });
    },
  );
};

export default class DocsAIReader implements AIDocsReader {
  /*
   * A language's index, built the first time it is asked for. Building
   * reads every page, which takes seconds, and the docs search box asks as
   * someone types (#6822): so requests that arrive while it builds share the
   * one build, and an index older than TTL_MS is still answered from while a
   * new one is built behind it. Only the very first search in a language
   * waits.
   */
  public static async getIndex(language: string): Promise<AIDocsLanguageIndex> {
    const resolved: string = isSupportedDocsLanguage(language)
      ? language
      : DEFAULT_DOCS_LANGUAGE;
    const now: number = OneUptimeDate.getCurrentDate().getTime();
    const cached: { index: AIDocsLanguageIndex; at: number } | undefined =
      cache.get(resolved);

    if (cached) {
      if (now - cached.at >= TTL_MS) {
        DocsAIReader.buildOnce(resolved).catch((): void => {
          // The old index keeps answering; the next request tries again.
        });
      }
      return cached.index;
    }

    return DocsAIReader.buildOnce(resolved);
  }

  // One build per language at a time, kept when it is done.
  private static buildOnce(language: string): Promise<AIDocsLanguageIndex> {
    const pending: Promise<AIDocsLanguageIndex> | undefined =
      building.get(language);

    if (pending) {
      return pending;
    }

    const build: Promise<AIDocsLanguageIndex> = DocsAIReader.build(language)
      .then((index: AIDocsLanguageIndex): AIDocsLanguageIndex => {
        cache.set(language, {
          index,
          at: OneUptimeDate.getCurrentDate().getTime(),
        });
        return index;
      })
      .finally((): void => {
        building.delete(language);
      });

    building.set(language, build);

    return build;
  }

  public static async build(language: string): Promise<AIDocsLanguageIndex> {
    const t: TranslateFn = makeT(language);
    const pages: Array<AIDocsIndexedPage> = [];
    const documentFrequency: Map<string, number> = new Map();

    for (const navPage of getNavPages()) {
      const copy: DocsCopy | null = await readCopy(navPage.page, language);

      if (!copy) {
        continue;
      }

      const title: string = t(`navLinks.${navPage.link.title}`);
      const group: string = t(`navGroups.${navPage.group.title}`);
      const summary: DocsPageSummary = summarizeDocsPage(copy.markdown);
      const body: string = copy.markdown.split("\n").slice(1).join("\n");

      const sections: Array<AIDocsIndexedSection> = splitDocsSections(body).map(
        (section: {
          title: string;
          anchor: string;
          body: string;
        }): AIDocsIndexedSection => {
          return {
            title: section.title,
            anchor: section.anchor,
            terms: countTerms(section.body),
            titleTerms: termSet(section.title),
            text: plainTextOfDocs(section.body),
          };
        },
      );

      if (navPage.page === GLOSSARY_PAGE) {
        sections.push(
          ...(await glossaryOtherNameSections(language, copy.markdown)),
        );
      }

      const indexed: AIDocsIndexedPage = {
        page: navPage.page,
        title,
        group,
        summary: summary.description,
        language: copy.language,
        titleTerms: termSet(`${title} ${copy.markdown.split("\n")[0] || ""}`),
        groupTerms: termSet(group),
        summaryTerms: termSet(summary.description),
        headingTerms: termSet(
          summary.headings
            .map((heading: { text: string }): string => {
              return heading.text;
            })
            .join(" "),
        ),
        bodyTerms: countTerms(body),
        bodyLength: tokenizeForDocs(body).length,
        sections,
        isGuide: navPage.link.isGuide === true,
      };

      const allTerms: Set<string> = new Set<string>([
        ...indexed.titleTerms,
        ...indexed.headingTerms,
        ...indexed.summaryTerms,
        ...indexed.bodyTerms.keys(),
        ...sections.flatMap((section: AIDocsIndexedSection): Array<string> => {
          return section.isOtherName ? Array.from(section.titleTerms) : [];
        }),
      ]);

      for (const term of allTerms) {
        documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
      }

      pages.push(indexed);
    }

    const averageBodyLength: number =
      pages.reduce((total: number, page: AIDocsIndexedPage): number => {
        return total + page.bodyLength;
      }, 0) / Math.max(1, pages.length);

    return {
      language,
      pages,
      documentFrequency,
      averageBodyLength,
      vocabulary: new DocsVocabulary(documentFrequency),
    };
  }

  /*
   * The words of a question as `index` reads them: tokenizeQueryForDocs'
   * words, a synonym that is a word's start as the docs' most used word it
   * starts ("vagt*" is "vagtpolitik"), and a word no page holds as the docs
   * word it spells with a wrong letter or two ("escalaton" is
   * "escalation"), when there is one.
   */
  public static readQuestion(
    index: AIDocsLanguageIndex,
    query: string,
  ): Array<string> {
    const synonyms: Map<
      string,
      Array<DocsSearchSynonym>
    > = getDocsSearchSynonyms(index.language);
    const wordStarts: Array<string> = splitDocsWords(query).flatMap(
      (word: string): Array<string> => {
        return (synonyms.get(foldDocsSearchWord(word)) || [])
          .filter((synonym: DocsSearchSynonym): boolean => {
            return synonym.isWordStart;
          })
          .flatMap((synonym: DocsSearchSynonym): Array<string> => {
            const start: string = foldDocsSearchWord(synonym.words);
            const used: Array<DocsVocabularyMatch> =
              index.vocabulary.startingWith(start, 1);

            return index.vocabulary.has(start)
              ? [start]
              : used.map((match: DocsVocabularyMatch): string => {
                  return match.term;
                });
          });
      },
    );

    const terms: Array<string> = tokenizeQueryForDocs(
      query,
      index.language,
    ).map((term: string): string => {
      if (index.documentFrequency.has(term)) {
        return term;
      }

      const near: Array<DocsVocabularyMatch> = index.vocabulary.near(
        term,
        getTypoAllowance(term),
        1,
      );

      return near[0] ? near[0].term : term;
    });

    return Array.from(new Set<string>([...terms, ...wordStarts]));
  }

  /*
   * The pages that answer `query` best, best first, each with the section
   * that matched best. A page that holds none of its words is never one.
   */
  public static rank(
    index: AIDocsLanguageIndex,
    query: string,
    limit: number,
  ): Array<AIDocsSearchHit> {
    const queryTerms: Array<string> = DocsAIReader.readQuestion(index, query);

    if (queryTerms.length === 0) {
      return [];
    }

    const pageCount: number = index.pages.length;
    /*
     * How much a word's count in a page's body says (BM25): each more
     * time says less, and a long page - the upgrade notes - holding it a
     * few times says less than a short one about it.
     */
    const bodyWeight: (count: number, length: number) => number = (
      count: number,
      length: number,
    ): number => {
      if (count === 0) {
        return 0;
      }
      const lengthRatio: number = length / Math.max(1, index.averageBodyLength);
      return (2 * (count * 2.2)) / (count + 1.2 * (0.25 + 0.75 * lengthRatio));
    };
    const weight: (term: string) => number = (term: string): number => {
      return Math.log(
        1 + pageCount / (1 + (index.documentFrequency.get(term) || 0)),
      );
    };

    const scored: Array<{ hit: AIDocsSearchHit; score: number }> = [];

    for (const page of index.pages) {
      let score: number = 0;
      let matched: number = 0;

      for (const term of queryTerms) {
        const bodyCount: number = page.bodyTerms.get(term) || 0;
        const termScore: number =
          (page.titleTerms.has(term) ? 6 : 0) +
          (page.headingTerms.has(term) ? 3 : 0) +
          (page.summaryTerms.has(term) ? 2 : 0) +
          (page.groupTerms.has(term) ? 2 : 0) +
          bodyWeight(bodyCount, page.bodyLength);

        if (termScore > 0) {
          matched++;
          score += weight(term) * termScore;
        }
      }

      if (matched === 0) {
        continue;
      }

      // A page that holds more of the question's words beats one that repeats one of them.
      score *= 0.25 + 0.75 * (matched / queryTerms.length);

      let bestSection: AIDocsIndexedSection | undefined = undefined;
      let bestSectionScore: number = 0;

      for (const section of page.sections) {
        let sectionScore: number = 0;
        for (const term of queryTerms) {
          sectionScore +=
            weight(term) *
            ((section.titleTerms.has(term) ? 3 : 0) +
              Math.log2(1 + (section.terms.get(term) || 0)));
        }
        if (sectionScore > bestSectionScore) {
          bestSectionScore = sectionScore;
          bestSection = section;
        }
      }

      scored.push({
        score,
        hit: {
          page: page.page,
          title: page.title,
          group: page.group,
          summary: page.summary,
          language: page.language,
          ...(bestSection
            ? {
                section: {
                  title: bestSection.title,
                  anchor: bestSection.anchor,
                },
              }
            : {}),
        },
      });
    }

    return scored
      .sort(
        (
          a: { hit: AIDocsSearchHit; score: number },
          b: { hit: AIDocsSearchHit; score: number },
        ): number => {
          return b.score - a.score || a.hit.page.localeCompare(b.hit.page);
        },
      )
      .slice(0, Math.max(1, limit))
      .map(
        (entry: { hit: AIDocsSearchHit; score: number }): AIDocsSearchHit => {
          return entry.hit;
        },
      );
  }

  public async search(data: {
    query: string;
    language: string;
    limit: number;
  }): Promise<Array<AIDocsSearchHit>> {
    const index: AIDocsLanguageIndex = await DocsAIReader.getIndex(
      data.language,
    );
    return DocsAIReader.rank(index, data.query, data.limit);
  }

  public async readPage(data: {
    page: string;
    language: string;
  }): Promise<AIDocsPage | null> {
    const page: string | null = normalizeDocsPage(data.page);

    if (!page) {
      return null;
    }

    const navPage:
      | { page: string; link: NavLink; group: NavGroup }
      | undefined = getNavPages().find(
      (candidate: { page: string; link: NavLink; group: NavGroup }) => {
        return candidate.page === page;
      },
    );

    if (!navPage) {
      return null;
    }

    const language: string = isSupportedDocsLanguage(data.language)
      ? data.language
      : DEFAULT_DOCS_LANGUAGE;
    const copy: DocsCopy | null = await readCopy(page, language);

    if (!copy) {
      return null;
    }

    const t: TranslateFn = makeT(language);
    const markdown: string = DocsPlaceholders.render(
      copy.markdown.split("\n").slice(1).join("\n"),
      copy.language,
    );

    return {
      page,
      title: t(`navLinks.${navPage.link.title}`),
      group: t(`navGroups.${navPage.group.title}`),
      language: copy.language,
      markdown,
      sections: summarizeDocsPage(copy.markdown).headings.map(
        (heading: { text: string; anchor: string }): AIDocsSection => {
          return { title: heading.text, anchor: heading.anchor };
        },
      ),
    };
  }

  public static clearCache(): void {
    cache.clear();
    building.clear();
  }
}
