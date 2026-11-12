import { DOCS_URL } from "../Config";
import {
  DEFAULT_DOCS_LANGUAGE,
  getDocsLanguageDirection,
  getDocsLanguageFor,
  getDocsPagePath,
  isSupportedDocsLanguage,
} from "../../Types/Docs/DocsLanguage";
import GlossaryTerm, {
  getGlossaryTermPath,
} from "../../Types/Docs/GlossaryTerm";

/*
 * A TERM'S DEFINITION, WHERE THE WORD IS USED.
 *
 * The docs' Glossary (/docs/<lang>/introduction/glossary) is the one place
 * a term's definition is written, once per language (#6818). The docs serve
 * the same entries as data (glossary/<lang>.json under the docs, Docs/Index's
 * glossary route), and this module
 * reads them for the product's definitions (Components/Glossary/DefinedTerm):
 * a word on a page shows the very sentences the Glossary page shows, in the
 * reader's language, and nothing is copied into a locale file to drift.
 *
 * The data is read once per language, the first time someone opens a
 * definition, and kept for the page's life. A read that fails is forgotten,
 * so the next definition opened asks again; meanwhile the popover still
 * links to the Glossary page.
 */

// The page the docs keep the Glossary at, and the product's other docs pages.
export const QUICKSTART_DOCS_PAGE: string = "introduction/quickstart";
export const CORE_CONCEPTS_DOCS_PAGE: string = "introduction/core-concepts";
export const GLOSSARY_INDEX_DOCS_PAGE: string = "introduction/glossary";

// A definition shows at most this many sentences: anything longer is docs.
export const GLOSSARY_DEFINITION_MAX_SENTENCES: number = 3;

export interface GlossaryDefinition {
  // The English heading's anchor: a GlossaryTerm value.
  id: string;
  // The term, as the Glossary names it in the entries' language.
  term: string;
  // What it means, as plain text.
  definition: string;
}

export interface LoadedGlossary {
  // The language the entries are written in: English where the docs have no copy.
  language: string;
  // Which way that language is read.
  direction: "ltr" | "rtl";
  // The entries, by id.
  definitions: Map<string, GlossaryDefinition>;
  /*
   * Each entry's other names ("Also called"), by id, in the entries'
   * language: Search finds a term by them too (#6936).
   */
  alsoCalled: Map<string, Array<string>>;
}

// A docs address under DOCS_URL ("/docs/de/...") as a full address.
const toDocsUrl: (docsPath: string) => string = (docsPath: string): string => {
  return `${DOCS_URL.toString()}${docsPath.replace(/^\/docs/, "")}`;
};

// A docs page, in the reader's language where the docs have it.
export const getDocsPageUrl: (
  page: string,
  language?: string | undefined,
) => string = (page: string, language?: string | undefined): string => {
  return toDocsUrl(getDocsPagePath(page, language));
};

// A term on the Glossary page, in the reader's language where the docs have it.
export const getGlossaryTermUrl: (
  term: GlossaryTerm,
  language?: string | undefined,
) => string = (term: GlossaryTerm, language?: string | undefined): string => {
  return toDocsUrl(getGlossaryTermPath(term, language));
};

// Where the entries of a language are served.
export const getGlossaryDataUrl: (language?: string | undefined) => string = (
  language?: string | undefined,
): string => {
  return `${DOCS_URL.toString()}/glossary/${getDocsLanguageFor(language)}.json`;
};

/*
 * A sentence ends at a full stop, a question or exclamation mark followed by
 * a space or the end - not the dot in "99.9%" or "service.name" - or at the
 * marks Chinese, Japanese, Hindi, Arabic and Persian end a sentence with.
 */
const SENTENCE_END: RegExp = /[.!?](?=\s|$)|[。！？।؟]/g;

/*
 * The definition, cut after its third sentence. The Glossary keeps every
 * definition to three sentences in English (GlossaryDocs); this holds a
 * translation that runs longer to the same, so a popover never becomes a
 * page.
 */
export const shortenDefinition: (
  definition: string,
  maxSentences?: number | undefined,
) => string = (
  definition: string,
  maxSentences?: number | undefined,
): string => {
  const text: string = definition.trim();
  const limit: number = maxSentences ?? GLOSSARY_DEFINITION_MAX_SENTENCES;
  let count: number = 0;

  for (const match of text.matchAll(SENTENCE_END)) {
    count++;

    if (count === limit) {
      return text.slice(0, (match.index || 0) + match[0].length).trim();
    }
  }

  return text;
};

const isRecord: (value: unknown) => value is Record<string, unknown> = (
  value: unknown,
): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

/*
 * The served entries, as the product reads them: every entry with an id, a
 * term and a definition, in the language the data says it is written in.
 * Null for anything else, so a broken answer is a failed read, not an empty
 * glossary.
 */
export const readGlossaryData: (data: unknown) => LoadedGlossary | null = (
  data: unknown,
): LoadedGlossary | null => {
  if (!isRecord(data) || !Array.isArray(data["entries"])) {
    return null;
  }

  const lang: unknown = data["lang"];
  const language: string =
    typeof lang === "string" && isSupportedDocsLanguage(lang)
      ? lang
      : DEFAULT_DOCS_LANGUAGE;
  const definitions: Map<string, GlossaryDefinition> = new Map();
  const alsoCalled: Map<string, Array<string>> = new Map();

  for (const entry of data["entries"] as Array<unknown>) {
    if (
      !isRecord(entry) ||
      typeof entry["id"] !== "string" ||
      typeof entry["term"] !== "string" ||
      typeof entry["definition"] !== "string" ||
      !entry["definition"].trim()
    ) {
      continue;
    }

    definitions.set(entry["id"], {
      id: entry["id"],
      term: entry["term"],
      definition: entry["definition"],
    });

    const otherNames: unknown = entry["alsoCalled"];

    alsoCalled.set(
      entry["id"],
      Array.isArray(otherNames)
        ? otherNames.filter((name: unknown): name is string => {
            return typeof name === "string" && name.trim().length > 0;
          })
        : [],
    );
  }

  if (definitions.size === 0) {
    return null;
  }

  return {
    language: language,
    direction: getDocsLanguageDirection(language),
    definitions: definitions,
    alsoCalled: alsoCalled,
  };
};

// One read per docs language, shared by every definition on the page.
const reads: Map<string, Promise<LoadedGlossary>> = new Map();

const fetchGlossaryData: (url: string) => Promise<unknown> = async (
  url: string,
): Promise<unknown> => {
  const response: Response = await globalThis.fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`The glossary answered ${response.status}.`);
  }

  return response.json();
};

/*
 * The glossary in the reader's language - English where the docs have no
 * copy. Read once per language; a failed read is forgotten, so the next
 * call asks again.
 */
export const loadGlossary: (
  language?: string | undefined,
) => Promise<LoadedGlossary> = (
  language?: string | undefined,
): Promise<LoadedGlossary> => {
  const docsLanguage: string = getDocsLanguageFor(language);
  const pending: Promise<LoadedGlossary> | undefined = reads.get(docsLanguage);

  if (pending) {
    return pending;
  }

  const read: Promise<LoadedGlossary> = fetchGlossaryData(
    getGlossaryDataUrl(docsLanguage),
  ).then((data: unknown): LoadedGlossary => {
    const glossary: LoadedGlossary | null = readGlossaryData(data);

    if (!glossary) {
      throw new Error("The glossary sent no definitions.");
    }

    return glossary;
  });

  reads.set(docsLanguage, read);

  read.catch((): void => {
    if (reads.get(docsLanguage) === read) {
      reads.delete(docsLanguage);
    }
  });

  return read;
};

// Forgets every read, for tests.
export const clearGlossaryReads: () => void = (): void => {
  reads.clear();
};
