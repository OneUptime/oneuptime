import { ContentPath } from "./Config";
import { DEFAULT_DOCS_LANGUAGE, SUPPORTED_DOCS_LANGUAGE_CODES } from "./I18n";
import OneUptimeDate from "Common/Types/Date";
import fs from "fs";

/*
 * Which languages a docs page is really written in.
 *
 * Every page is served in every language: a language with no copy of a page
 * shows the English one. And a copy can be English too. A page copied into a
 * language's folder to be translated later is English prose under a
 * translated menu - some of these copies say so in a "TODO(i18n)" comment,
 * most do not. Search engines are told which address is a page's own and
 * which are its translations (Utils/Seo.ts, Views/Partials/Head.ejs), and the
 * docs sitemap lists only those (Utils/Sitemap.ts), so all of them read this.
 */

// The comment a copy left to be translated later may carry.
export const UNTRANSLATED_PAGE_MARKER: string = "TODO(i18n)";

/*
 * A copy that shares more than this share of its sentences, word for word,
 * with the English page is the English page. A translation keeps code,
 * commands, names and addresses as they are written, but not its sentences.
 * On the docs as they are, no translation shares more than an eighth of its
 * sentences with English, and every English copy more than seven tenths.
 */
export const ENGLISH_COPY_SHARE: number = 0.5;

// A line reads as a sentence when it has at least this many letters, in any script.
const SENTENCE_LETTERS: number = 20;

// How long what was read is kept: content is fixed for a deploy.
const CACHE_TTL_MS: number = 10 * 60 * 1000;

const FENCE: RegExp = /^(`{3,}|~{3,})(.*)$/;
const BLOCKQUOTE_MARKERS: RegExp = /^(?:>\s*)+/;
const NON_ASCII_LETTER: RegExp = /\p{L}/u;

/*
 * What is not a sentence's own words, and is the same in every language:
 * inline code, link addresses, bare URLs and {{TOKENS}} - each with what a
 * line must hold for the pattern to find anything, so most lines are not
 * searched at all. Every docs page is read in every language, so this is
 * kept cheap.
 */
const NOT_WORDS: Array<{ holds: string; pattern: RegExp }> = [
  { holds: "`", pattern: /`[^`\n]*`/g },
  { holds: "](", pattern: /\]\([^)\s]*\)/g },
  { holds: "://", pattern: /https?:\/\/\S+/g },
  { holds: "{{", pattern: /\{\{[^}\n]*\}\}/g },
];

// Lines that are not prose: table rows, components, tabs and comments.
const NOT_PROSE_PREFIXES: Array<string> = ["|", ":::", "@tab", "<!--"];

// Whether a text holds enough letters to be a sentence, counting no further.
const hasSentenceLetters: (text: string) => boolean = (
  text: string,
): boolean => {
  let letters: number = 0;

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);
    const isLetter: boolean =
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) ||
      (code > 0x7f && NON_ASCII_LETTER.test(text.charAt(index)));

    if (isLetter) {
      letters++;

      if (letters >= SENTENCE_LETTERS) {
        return true;
      }
    }
  }

  return false;
};

const isSentence: (line: string) => boolean = (line: string): boolean => {
  if (
    line.length < SENTENCE_LETTERS ||
    NOT_PROSE_PREFIXES.some((prefix: string): boolean => {
      return line.startsWith(prefix);
    })
  ) {
    return false;
  }

  let words: string = line;

  for (const notWords of NOT_WORDS) {
    if (words.includes(notWords.holds)) {
      words = words.replace(notWords.pattern, " ");
    }
  }

  return hasSentenceLetters(words);
};

/*
 * The lines of a page that are sentences, as they are written: outside code
 * samples, with enough letters to say something.
 */
export const getSentences: (markdown: string) => Array<string> = (
  markdown: string,
): Array<string> => {
  const sentences: Array<string> = [];
  // The fence of the code sample the line is in: its character and length.
  let openFence: string | null = null;

  for (const rawLine of markdown.split("\n")) {
    let line: string = rawLine.trim();

    if (line.startsWith(">")) {
      line = line.replace(BLOCKQUOTE_MARKERS, "");
    }

    const fence: RegExpMatchArray | null =
      line.startsWith("`") || line.startsWith("~") ? line.match(FENCE) : null;

    if (openFence !== null) {
      // Closed by a fence of the same character, as long or longer, alone.
      if (
        fence &&
        fence[1]![0] === openFence[0] &&
        fence[1]!.length >= openFence.length &&
        fence[2]!.trim() === ""
      ) {
        openFence = null;
      }
      continue;
    }

    if (fence) {
      openFence = fence[1]!;
      continue;
    }

    if (isSentence(line)) {
      sentences.push(line);
    }
  }

  return sentences;
};

// The English page, read once for every language's copy to be held to.
interface EnglishPage {
  markdown: string;
  sentences: ReadonlySet<string>;
}

const readEnglishPage: (markdown: string) => EnglishPage = (
  markdown: string,
): EnglishPage => {
  return { markdown: markdown, sentences: new Set(getSentences(markdown)) };
};

const isCopyOf: (english: EnglishPage, copyMarkdown: string) => boolean = (
  english: EnglishPage,
  copyMarkdown: string,
): boolean => {
  // The English page itself, or a copy that says it is still to be translated.
  if (
    copyMarkdown === english.markdown ||
    copyMarkdown.includes(UNTRANSLATED_PAGE_MARKER)
  ) {
    return true;
  }

  const sentences: Array<string> = getSentences(copyMarkdown);

  if (sentences.length === 0) {
    // Nothing to compare but the page itself.
    return copyMarkdown.trim() === english.markdown.trim();
  }

  const shared: number = sentences.filter((sentence: string): boolean => {
    return english.sentences.has(sentence);
  }).length;

  return shared / sentences.length > ENGLISH_COPY_SHARE;
};

/*
 * Whether a language's copy of a page is the English page rather than a
 * translation of it: it says it is still to be translated, or most of its
 * sentences are the English page's.
 */
export const isEnglishCopy: (
  englishMarkdown: string,
  copyMarkdown: string,
) => boolean = (englishMarkdown: string, copyMarkdown: string): boolean => {
  return isCopyOf(readEnglishPage(englishMarkdown), copyMarkdown);
};

/*
 * A file's text, or null when there is no such file. One read, not an
 * existence check and then a read: a page is held to its English page in
 * every language, seventeen files at a time.
 */
const readIfExists: (file: string) => Promise<string | null> = async (
  file: string,
): Promise<string | null> => {
  try {
    return await fs.promises.readFile(file, "utf8");
  } catch (err) {
    const code: string | undefined = (err as NodeJS.ErrnoException).code;

    if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") {
      return null;
    }

    throw err;
  }
};

interface CachedLanguages {
  languages: Promise<Array<string>>;
  readAt: number;
}

const cache: Map<string, CachedLanguages> = new Map();

export default class DocsTranslations {
  /*
   * The languages a page ("category/page") is written in: English, then
   * each language whose copy is a translation, in the docs' order. Empty
   * when there is no English page.
   */
  public static async getLanguages(pagePath: string): Promise<Array<string>> {
    const now: number = OneUptimeDate.getCurrentDate().getTime();
    const cached: CachedLanguages | undefined = cache.get(pagePath);

    if (cached && now - cached.readAt < CACHE_TTL_MS) {
      return cached.languages;
    }

    const entry: CachedLanguages = {
      languages: DocsTranslations.readLanguages(pagePath),
      readAt: now,
    };

    cache.set(pagePath, entry);

    try {
      return await entry.languages;
    } catch (err) {
      // A failed read is not remembered: the next request reads again.
      if (cache.get(pagePath) === entry) {
        cache.delete(pagePath);
      }
      throw err;
    }
  }

  // Whether a page is written in a language: English, or a translation.
  public static async isTranslated(
    pagePath: string,
    lang: string,
  ): Promise<boolean> {
    return (await DocsTranslations.getLanguages(pagePath)).includes(lang);
  }

  // Forgets what was read, for tests that change the content they read.
  public static clearCache(): void {
    cache.clear();
  }

  private static async readLanguages(pagePath: string): Promise<Array<string>> {
    const otherLanguages: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
      (lang: string): boolean => {
        return lang !== DEFAULT_DOCS_LANGUAGE;
      },
    );

    const readEnglish: () => Promise<string | null> = async (): Promise<
      string | null
    > => {
      return (
        (await readIfExists(
          `${ContentPath}/${DEFAULT_DOCS_LANGUAGE}/${pagePath}.md`,
        )) ??
        // Legacy layout before translations existed (Content/<path>.md)
        (await readIfExists(`${ContentPath}/${pagePath}.md`))
      );
    };

    // The English page and every language's copy, read at once.
    const [english, copies]: [string | null, Array<string | null>] =
      await Promise.all([
        readEnglish(),
        Promise.all(
          otherLanguages.map((lang: string): Promise<string | null> => {
            return readIfExists(`${ContentPath}/${lang}/${pagePath}.md`);
          }),
        ),
      ]);

    if (english === null) {
      return [];
    }

    const englishPage: EnglishPage = readEnglishPage(english);
    const languages: Array<string> = [DEFAULT_DOCS_LANGUAGE];

    otherLanguages.forEach((lang: string, index: number): void => {
      const copy: string | null = copies[index] ?? null;

      if (copy !== null && !isCopyOf(englishPage, copy)) {
        languages.push(lang);
      }
    });

    return languages;
  }
}
