import {
  RecordPageSearchKind,
  RecordPageSearchPage,
} from "./RecordPageSearchIndex";

/*
 * How Search reads a query for a record's pages (#9204), free of React and
 * of the network so it can be tested alone.
 *
 * A query that holds a page's name - its menu title, the title in the
 * reader's language, or one of its keywords ("sso", "advanced settings") -
 * and either a kind's name ("status page") or words of a record's name
 * ("acme") is a search for that page of those records: "status page sso",
 * "acme subscribers", "sso acme status page". What is left once the page's
 * and the kind's words are taken out is looked for in the records' names.
 *
 * It stays bounded: a page's name alone finds nothing here (the pages that
 * open without a record answer it, and on a record's page that record's own
 * pages do), at most RECORD_PAGE_SEARCH_MAX_KINDS kinds are looked up per
 * search, and each offers at most RECORD_PAGE_SEARCH_MAX_PAGES pages.
 */

// Kinds whose records are looked up for one search: one request each.
export const RECORD_PAGE_SEARCH_MAX_KINDS: number = 4;
// Pages offered per kind, when the words name several equally well.
export const RECORD_PAGE_SEARCH_MAX_PAGES: number = 3;
// Records looked up per kind, and rows shown in all.
export const RECORD_PAGE_SEARCH_RECORD_LIMIT: number = 5;
export const RECORD_PAGE_SEARCH_MAX_RESULTS: number = 10;

export interface SearchToken {
  // Lowercase, as compared.
  text: string;
  // Where it is in the query, to cut it out of what is typed.
  start: number;
  end: number;
}

// Letters and digits in any script; everything else separates words.
const WORD: RegExp = /[\p{L}\p{N}]+/gu;

export const tokenizeSearchText: (text: string) => Array<SearchToken> = (
  text: string,
): Array<SearchToken> => {
  const tokens: Array<SearchToken> = [];

  for (const match of text.matchAll(WORD)) {
    const start: number = match.index || 0;
    tokens.push({
      text: match[0].toLocaleLowerCase(),
      start,
      end: start + match[0].length,
    });
  }

  return tokens;
};

// "subscriber" and "subscribers" are one word to Search.
const withoutPlural: (word: string) => string = (word: string): string => {
  return word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
};

/*
 * Whether a typed word is a name's word. The last word typed may still be
 * being typed, so it may be the start of the name's word ("subscr").
 */
const isSameWord: (
  typed: string,
  word: string,
  isBeingTyped: boolean,
) => boolean = (
  typed: string,
  word: string,
  isBeingTyped: boolean,
): boolean => {
  if (typed === word || withoutPlural(typed) === withoutPlural(word)) {
    return true;
  }

  return isBeingTyped && typed.length >= 2 && word.startsWith(typed);
};

/*
 * Where a name's words are, together and in order, among the words typed
 * that are still free: their indexes, or null.
 */
const findPhrase: (data: {
  tokens: Array<SearchToken>;
  taken: ReadonlySet<number>;
  phrase: Array<string>;
}) => Array<number> | null = (data: {
  tokens: Array<SearchToken>;
  taken: ReadonlySet<number>;
  phrase: Array<string>;
}): Array<number> | null => {
  const { tokens, taken, phrase } = data;

  if (phrase.length === 0 || phrase.length > tokens.length) {
    return null;
  }

  for (let start: number = 0; start + phrase.length <= tokens.length; start++) {
    const indexes: Array<number> = [];

    for (let offset: number = 0; offset < phrase.length; offset++) {
      const index: number = start + offset;
      const token: SearchToken = tokens[index]!;

      if (
        taken.has(index) ||
        !isSameWord(
          token.text,
          phrase[offset]!,
          index === tokens.length - 1 && offset === phrase.length - 1,
        )
      ) {
        break;
      }

      indexes.push(index);
    }

    if (indexes.length === phrase.length) {
      return indexes;
    }
  }

  return null;
};

// The best of several names: the most words found, the first on a tie.
const findBestName: (data: {
  tokens: Array<SearchToken>;
  taken: ReadonlySet<number>;
  names: Array<Array<string>>;
}) => Array<number> | null = (data: {
  tokens: Array<SearchToken>;
  taken: ReadonlySet<number>;
  names: Array<Array<string>>;
}): Array<number> | null => {
  let best: Array<number> | null = null;

  for (const name of data.names) {
    const found: Array<number> | null = findPhrase({
      tokens: data.tokens,
      taken: data.taken,
      phrase: name,
    });

    if (found && (!best || found.length > best.length)) {
      best = found;
    }
  }

  return best;
};

// What is typed once the found words are cut out: "acme-prod", not "acme prod".
const getTextLeft: (
  query: string,
  tokens: Array<SearchToken>,
  taken: ReadonlySet<number>,
) => string = (
  query: string,
  tokens: Array<SearchToken>,
  taken: ReadonlySet<number>,
): string => {
  let text: string = query;

  // From the end, so the places of the words before stay right.
  for (let index: number = tokens.length - 1; index >= 0; index--) {
    if (taken.has(index)) {
      const token: SearchToken = tokens[index]!;
      text = text.slice(0, token.start) + " " + text.slice(token.end);
    }
  }

  return text
    .replace(/\s+/g, " ")
    .replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, "")
    .trim();
};

const toPhrase: (name: string) => Array<string> = (
  name: string,
): Array<string> => {
  return tokenizeSearchText(name).map((token: SearchToken): string => {
    return token.text;
  });
};

const unique: (names: Array<string>) => Array<string> = (
  names: Array<string>,
): Array<string> => {
  return Array.from(
    new Set(
      names.filter((name: string): boolean => {
        return name.trim().length > 0;
      }),
    ),
  );
};

/*
 * A page's names: its title and its former titles, in English and in the
 * reader's language, and its keywords.
 */
export const getRecordPageNames: (
  page: RecordPageSearchPage,
  translate: (text: string) => string,
) => Array<string> = (
  page: RecordPageSearchPage,
  translate: (text: string) => string,
): Array<string> => {
  const titles: Array<string> = [page.title, ...(page.formerTitles || [])];

  return unique([
    ...titles,
    ...titles.map(translate),
    ...(page.keywords || []),
  ]);
};

// A kind's names: what one record is called, in both languages, and its keywords.
export const getRecordKindNames: (
  kind: RecordPageSearchKind,
  translate: (text: string) => string,
) => Array<string> = (
  kind: RecordPageSearchKind,
  translate: (text: string) => string,
): Array<string> => {
  return unique([
    kind.recordName,
    translate(kind.recordName),
    ...kind.keywords,
  ]);
};

export interface RecordPageQueryMatch {
  kind: RecordPageSearchKind;
  // The pages the words name, best first.
  pages: Array<RecordPageSearchPage>;
  /*
   * What to look for in the records' names: "" when the query named the
   * kind and nothing else, for any record of the kind.
   */
  recordText: string;
  // Whether the query named the kind ("status page").
  namesKind: boolean;
}

interface KindMatch extends RecordPageQueryMatch {
  // How many of the typed words the page's name took.
  pageWords: number;
  order: number;
}

/**
 * The kinds and pages a query asks for, best first, at most
 * RECORD_PAGE_SEARCH_MAX_KINDS. A query that names a kind asks for that
 * kind only; one that does not asks for every kind with a page of that
 * name, in the index's order.
 */
export const matchRecordPageQuery: (data: {
  query: string;
  kinds: Array<RecordPageSearchKind>;
  translate: (text: string) => string;
}) => Array<RecordPageQueryMatch> = (data: {
  query: string;
  kinds: Array<RecordPageSearchKind>;
  translate: (text: string) => string;
}): Array<RecordPageQueryMatch> => {
  const tokens: Array<SearchToken> = tokenizeSearchText(data.query);

  if (tokens.length < 2) {
    return [];
  }

  const matches: Array<KindMatch> = [];

  data.kinds.forEach((kind: RecordPageSearchKind, order: number): void => {
    const kindNames: Array<Array<string>> = getRecordKindNames(
      kind,
      data.translate,
    ).map(toPhrase);

    let best: KindMatch | null = null;
    let bestTaken: Array<number> = [];

    for (const page of kind.pages) {
      const pageWords: Array<number> | null = findBestName({
        tokens,
        taken: new Set<number>(),
        names: getRecordPageNames(page, data.translate).map(toPhrase),
      });

      if (!pageWords) {
        continue;
      }

      const kindWords: Array<number> | null = findBestName({
        tokens,
        taken: new Set<number>(pageWords),
        names: kindNames,
      });

      const taken: Set<number> = new Set<number>([
        ...pageWords,
        ...(kindWords || []),
      ]);
      const namesKind: boolean = Boolean(kindWords);
      const recordText: string = getTextLeft(data.query, tokens, taken);

      // A page's name alone, or with only its kind's... that is all.
      if (!namesKind && !recordText) {
        continue;
      }

      const isBetter: boolean =
        !best ||
        (namesKind && !best.namesKind) ||
        (namesKind === best.namesKind && pageWords.length > best.pageWords);

      if (isBetter) {
        best = {
          kind,
          pages: [page],
          recordText,
          namesKind,
          pageWords: pageWords.length,
          order,
        };
        bestTaken = Array.from(taken).sort();
        continue;
      }

      // Another page the same words name as well: "notification logs".
      if (
        best &&
        namesKind === best.namesKind &&
        pageWords.length === best.pageWords &&
        Array.from(taken).sort().join(",") === bestTaken.join(",") &&
        best.pages.length < RECORD_PAGE_SEARCH_MAX_PAGES
      ) {
        best.pages.push(page);
      }
    }

    if (best) {
      matches.push(best);
    }
  });

  // A query that names a kind asks for it, and not for records named so.
  const namingKind: Array<KindMatch> = matches.filter(
    (match: KindMatch): boolean => {
      return match.namesKind;
    },
  );

  return (namingKind.length > 0 ? namingKind : matches)
    .sort((a: KindMatch, b: KindMatch): number => {
      return b.pageWords - a.pageWords || a.order - b.order;
    })
    .slice(0, RECORD_PAGE_SEARCH_MAX_KINDS)
    .map((match: KindMatch): RecordPageQueryMatch => {
      return {
        kind: match.kind,
        pages: match.pages,
        recordText: match.recordText,
        namesKind: match.namesKind,
      };
    });
};

// A record id, as the routes carry it.
const RECORD_ID: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OpenRecord {
  kind: RecordPageSearchKind;
  modelId: string;
}

/**
 * The record whose page is open, from the address: the kind one of whose
 * pages the path is, and the record's id in it. Null on any other page.
 */
export const getOpenRecord: (data: {
  path: string;
  kinds: Array<RecordPageSearchKind>;
  getRouteTemplate: (pageKey: string) => string | undefined;
}) => OpenRecord | null = (data: {
  path: string;
  kinds: Array<RecordPageSearchKind>;
  getRouteTemplate: (pageKey: string) => string | undefined;
}): OpenRecord | null => {
  const pathParts: Array<string> = data.path
    .split("?")[0]!
    .split("#")[0]!
    .replace(/\/+$/, "")
    .split("/");

  for (const kind of data.kinds) {
    for (const page of kind.pages) {
      const template: string | undefined = data.getRouteTemplate(page.page);

      if (!template || !template.includes(":id")) {
        continue;
      }

      const templateParts: Array<string> = template
        .replace(/\/+$/, "")
        .split("/");

      if (templateParts.length !== pathParts.length) {
        continue;
      }

      let modelId: string | null = null;
      let isSame: boolean = true;

      templateParts.forEach((part: string, index: number): void => {
        const pathPart: string = pathParts[index] || "";

        if (part === ":id") {
          modelId = RECORD_ID.test(pathPart) ? pathPart : null;
          isSame = isSame && modelId !== null;
        } else if (part.startsWith(":")) {
          isSame = isSame && pathPart.length > 0;
        } else {
          isSame = isSame && part === pathPart;
        }
      });

      if (isSame && modelId) {
        return { kind, modelId };
      }
    }
  }

  return null;
};
