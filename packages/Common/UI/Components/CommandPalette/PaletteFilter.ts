import { PaletteCommand } from "./Types";
import {
  getWordVariants,
  isSameWord,
  matchWordWithTypo,
} from "../../../Utils/WordMatch";

/*
 * Pure, React-free search for the command palette. Kept out of the component
 * so the ranking contract can be unit-tested directly and reused by anything
 * that needs "which commands match this text, best first".
 *
 * What a match is, in plain words:
 *
 * - Case, accents, punctuation and spacing do not matter: "on call",
 *   "on-call" and "oncall" are the same, and so are "resume" and "résumé".
 * - Each word of the query is matched against the start of a word, in any
 *   order, and the number does not matter: "keys api" and "api key" both
 *   find API Keys. Words are compared whole, so "runs" is not "Runners".
 * - Keywords are other names for a command ("pager" for On-Call, "delete
 *   project" for the Danger Zone). A breadcrumb says where a page lives
 *   ("Incidents > Settings"); it narrows a search down ("incident custom
 *   fields") but never finds a page on its own for a one-word query, or
 *   "incidents" would list every page in Incidents.
 * - A title many pages share ("Custom Fields", "API", "Slack") says little on
 *   its own, so a match on it ranks below a distinctive title: "api" opens
 *   API Keys before the thirty Developer pages called API.
 * - Fallbacks, offered only when nothing matches better: a title's initials
 *   ("ak" finds API Keys), the group a command is listed under
 *   ("observability" lists the observability products), a typo in a word
 *   ("incidnet") and the title's letters in order ("mntr" finds Monitors).
 * - Between equally good matches, the command's searchPriority decides (the
 *   Dashboard puts products before pages, and pages before actions), then
 *   the caller's order.
 *
 * Plurals and typos are matched by Utils/WordMatch, which the workflow step
 * pickers use too.
 */

/**
 * How a command matched the query, best first. The palette orders matches by
 * score, which starts from the rank and is adjusted for shared titles and
 * for how much of the query a context match found in the title.
 */
export enum PaletteMatchRank {
  /** The whole title: "api keys", "API-Keys" and "apikeys" all name API Keys. */
  TitleExact = 0,
  /** The title starts with the query: "api k" and "oncall" are prefixes. */
  TitlePrefix = 1,
  /** Every query word starts a word of the title, in any order: "keys api". */
  TitleWords = 2,
  /** A keyword is the query, starts with it, or holds every word of it. */
  Keyword = 3,
  /**
   * Every query word is found across the title, keywords and where the
   * command lives (its breadcrumb, or the group it is listed under), at
   * least one in its own names: "incident custom fields", "logs
   * observability".
   */
  Context = 4,
  /**
   * The query appears inside the title or a keyword, not at a word start:
   * "eys" finds API Keys.
   */
  Substring = 5,
  /** The query starts the title's initials: "ak" finds API Keys. A fallback. */
  TitleInitials = 6,
  /**
   * Only the group a command is listed under holds the query: "observability"
   * lists the observability products. A fallback.
   */
  Category = 7,
  /**
   * A typo in a query word, or the title's letters in order with gaps. A
   * fallback.
   */
  Fuzzy = 8,
}

// Ranks offered only when nothing matches better.
const FALLBACK_RANKS: ReadonlySet<PaletteMatchRank> = new Set<PaletteMatchRank>(
  [
    PaletteMatchRank.TitleInitials,
    PaletteMatchRank.Category,
    PaletteMatchRank.Fuzzy,
  ],
);

export interface PaletteCommandMatch {
  command: PaletteCommand;
  rank: PaletteMatchRank;
  /** Higher is better. */
  score: number;
}

/** One run of text in a title/description, flagged when it matched the query. */
export interface PaletteHighlightSegment {
  text: string;
  isMatch: boolean;
}

const RANK_SCORES: Readonly<Record<PaletteMatchRank, number>> = {
  [PaletteMatchRank.TitleExact]: 100,
  [PaletteMatchRank.TitlePrefix]: 90,
  [PaletteMatchRank.TitleWords]: 80,
  [PaletteMatchRank.Keyword]: 62,
  [PaletteMatchRank.Context]: 50,
  [PaletteMatchRank.Substring]: 40,
  [PaletteMatchRank.TitleInitials]: 45,
  [PaletteMatchRank.Category]: 30,
  [PaletteMatchRank.Fuzzy]: 20,
};

// A keyword that is exactly the query is worth more than one it starts.
const KEYWORD_EXACT_BONUS: number = 8;

// The query inside a keyword is weaker evidence than inside the title.
const KEYWORD_SUBSTRING_PENALTY: number = 6;

// The shortest query found inside a keyword: one or two letters are anywhere.
const KEYWORD_SUBSTRING_MIN_LENGTH: number = 3;

// A context match that found query words in the title is worth more.
const CONTEXT_TITLE_WORD_BONUS: number = 4;
const CONTEXT_TITLE_WORD_BONUS_CAP: number = 12;

// ...and so is one whose other words all name the same place.
const CONTEXT_ONE_PLACE_BONUS: number = 4;

// A typo is closer to the title than its letters scattered through it.
const TYPO_BONUS: number = 10;

// The shortest query word a typo is forgiven in: "rule" must not find "role".
const TYPO_MIN_LENGTH: number = 5;

// The shortest query that may match a title's letters in order.
const SUBSEQUENCE_MIN_LENGTH: number = 2;

/*
 * The shortest query word whose plural or singular counts as the same word:
 * "is" is not the plural of "i".
 */
const SAME_WORD_MIN_LENGTH: number = 3;

/*
 * A title shared by k pages: subtracted from its title-based matches. Two
 * pages called "Settings" lose 25, so "settings" opens Project Settings
 * first; thirty called "API" lose 45, so "api" opens API Keys first.
 */
export const getSharedTitlePenalty: (sharedBy: number) => number = (
  sharedBy: number,
): number => {
  if (sharedBy < 2) {
    return 0;
  }

  return Math.min(45, 20 + 5 * Math.log2(sharedBy));
};

/*
 * The accents of the Latin, Greek and Cyrillic letters (é, ü, ñ, ё), which
 * people often leave out when they type. The breve is kept: Russian й is a
 * letter of its own, not an accented и. Other scripts' marks (Hindi vowel
 * signs, Japanese voicing marks) are part of their words and are kept too.
 */
const LETTER_ACCENTS: RegExp = /[\u0300-\u0305\u0307-\u036f]+/g;
const NOT_A_LETTER_OR_DIGIT: RegExp = /[^\p{L}\p{M}\p{N}]+/gu;
const WORD_CHARACTER: RegExp = /[\p{L}\p{M}\p{N}]/u;

/**
 * Text the way the search compares it: lowercase, accents dropped, and
 * every run of punctuation or space turned into one space.
 */
export const normalizePaletteQuery: (query: string) => string = (
  query: string,
): string => {
  return query
    .normalize("NFKD")
    .replace(LETTER_ACCENTS, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(NOT_A_LETTER_OR_DIGIT, " ")
    .trim();
};

/** The query's words, normalized: what gets highlighted and matched. */
export const getPaletteQueryWords: (query: string) => Array<string> = (
  query: string,
): Array<string> => {
  const normalized: string = normalizePaletteQuery(query);

  return normalized ? normalized.split(" ") : [];
};

/**
 * True when every character of `needle` appears in `haystack` in order (not
 * necessarily adjacent) — the "mntr" finds "Monitors" fallback. Both inputs
 * are expected to be normalized already.
 */
export const isSubsequenceMatch: (
  needle: string,
  haystack: string,
) => boolean = (needle: string, haystack: string): boolean => {
  if (needle.length === 0) {
    return true;
  }
  let needleIndex: number = 0;
  for (
    let haystackIndex: number = 0;
    haystackIndex < haystack.length && needleIndex < needle.length;
    haystackIndex++
  ) {
    if (haystack[haystackIndex] === needle[needleIndex]) {
      needleIndex++;
    }
  }
  return needleIndex === needle.length;
};

/**
 * True when the words, run together, start with `compactQuery` without
 * cutting a word short in the middle of the query: "oncall" starts
 * "On-Call Duty" and "oncal" too, but "alerts" does not start "Alert State"
 * (it would end on the "s" of "State"). A query that stops inside the first
 * word is fine ("mon"); inside a later one it needs two of its letters.
 */
export const isCompactWordPrefix: (
  words: Array<string>,
  compactQuery: string,
) => boolean = (words: Array<string>, compactQuery: string): boolean => {
  let rest: string = compactQuery;

  for (let index: number = 0; index < words.length; index++) {
    const word: string = words[index]!;

    if (rest.length <= word.length) {
      return word.startsWith(rest) && (index === 0 || rest.length >= 2);
    }

    if (!rest.startsWith(word)) {
      return false;
    }

    rest = rest.slice(word.length);
  }

  return false;
};

interface PreparedText {
  words: Array<string>;
  // getWordVariants of each word, worked out once.
  variants: Array<Array<string>>;
  // The words run together: "on-call duty" is "oncallduty".
  compact: string;
  // The words joined with single spaces.
  spaced: string;
}

const prepareText: (text: string) => PreparedText = (
  text: string,
): PreparedText => {
  const normalized: string = normalizePaletteQuery(text);
  const words: Array<string> = normalized ? normalized.split(" ") : [];

  return {
    words,
    variants: words.map((word: string): Array<string> => {
      return getWordVariants(word);
    }),
    compact: words.join(""),
    spaced: words.join(" "),
  };
};

interface PreparedCommand {
  title: PreparedText;
  // The title and its aliases, the title first.
  titles: Array<PreparedText>;
  keywords: Array<PreparedText>;
  /*
   * Where the command lives, one entry per name: each crumb of the
   * breadcrumb and of its search-only words (or the category, without a
   * breadcrumb).
   */
  context: Array<PreparedText>;
  hasBreadcrumb: boolean;
}

/*
 * The palette re-runs the search on every keystroke over the same command
 * objects, so each one is normalized once.
 */
const preparedCommands: WeakMap<PaletteCommand, PreparedCommand> =
  new WeakMap();

const prepareTexts: (texts: Array<string>) => Array<PreparedText> = (
  texts: Array<string>,
): Array<PreparedText> => {
  return texts
    .map((text: string): PreparedText => {
      return prepareText(text);
    })
    .filter((prepared: PreparedText): boolean => {
      return prepared.words.length > 0;
    });
};

const prepareCommand: (command: PaletteCommand) => PreparedCommand = (
  command: PaletteCommand,
): PreparedCommand => {
  const cached: PreparedCommand | undefined = preparedCommands.get(command);

  if (cached) {
    return cached;
  }

  const hasBreadcrumb: boolean = Boolean(
    command.breadcrumb && command.breadcrumb.length > 0,
  );

  const title: PreparedText = prepareText(command.title);

  const prepared: PreparedCommand = {
    title,
    titles: [title, ...prepareTexts(command.titleAliases || [])],
    keywords: prepareTexts(command.keywords || []),
    context: prepareTexts(
      hasBreadcrumb
        ? [...(command.breadcrumb || []), ...(command.breadcrumbKeywords || [])]
        : [command.category],
    ),
    hasBreadcrumb,
  };

  preparedCommands.set(command, prepared);

  return prepared;
};

type PreparedQuery = PreparedText;

/*
 * Whether one query word matches one word of a name: the word starts with
 * it, or it is the same word in the singular or plural ("keys" is "key").
 */
const wordMatches: (
  token: string,
  tokenVariants: Array<string>,
  word: string,
  wordVariants: Array<string>,
) => boolean = (
  token: string,
  tokenVariants: Array<string>,
  word: string,
  wordVariants: Array<string>,
): boolean => {
  if (word.startsWith(token)) {
    return true;
  }

  return (
    token.length >= SAME_WORD_MIN_LENGTH &&
    isSameWord(token, word, tokenVariants, wordVariants)
  );
};

const textHasWord: (
  text: PreparedText,
  token: string,
  tokenVariants: Array<string>,
) => boolean = (
  text: PreparedText,
  token: string,
  tokenVariants: Array<string>,
): boolean => {
  return text.words.some((word: string, index: number): boolean => {
    return wordMatches(token, tokenVariants, word, text.variants[index] || []);
  });
};

const textHasEveryWord: (
  text: PreparedText,
  query: PreparedQuery,
) => boolean = (text: PreparedText, query: PreparedQuery): boolean => {
  return query.words.every((token: string, index: number): boolean => {
    return textHasWord(text, token, query.variants[index] || []);
  });
};

/*
 * The same words, in the same order, the number aside: "api key" is "API
 * Keys".
 */
const isSameWords: (text: PreparedText, query: PreparedQuery) => boolean = (
  text: PreparedText,
  query: PreparedQuery,
): boolean => {
  return (
    text.words.length === query.words.length &&
    text.words.every((word: string, index: number): boolean => {
      return isSameWord(
        query.words[index]!,
        word,
        query.variants[index],
        text.variants[index],
      );
    })
  );
};

// How a name (a title, or a keyword) matches the whole query, or null.
const matchName: (
  name: PreparedText,
  query: PreparedQuery,
) =>
  | PaletteMatchRank.TitleExact
  | PaletteMatchRank.TitlePrefix
  | PaletteMatchRank.TitleWords
  | null = (
  name: PreparedText,
  query: PreparedQuery,
):
  | PaletteMatchRank.TitleExact
  | PaletteMatchRank.TitlePrefix
  | PaletteMatchRank.TitleWords
  | null => {
  if (name.compact.length === 0) {
    return null;
  }

  if (name.compact === query.compact || isSameWords(name, query)) {
    return PaletteMatchRank.TitleExact;
  }

  if (
    name.spaced.startsWith(query.spaced) ||
    isCompactWordPrefix(name.words, query.compact)
  ) {
    return PaletteMatchRank.TitlePrefix;
  }

  if (textHasEveryWord(name, query)) {
    return PaletteMatchRank.TitleWords;
  }

  return null;
};

// A query word that is a typo of the start of one of these words.
const hasTypoOf: (token: string, words: Array<string>) => boolean = (
  token: string,
  words: Array<string>,
): boolean => {
  if (token.length < TYPO_MIN_LENGTH) {
    return false;
  }

  return words.some((word: string): boolean => {
    return matchWordWithTypo(token, word);
  });
};

/*
 * The title's letters in order, starting at the start of one of its words:
 * "mntr" finds Monitors, but "ors" finds nothing.
 */
const isWordStartSubsequence: (
  needle: string,
  title: PreparedText,
) => boolean = (needle: string, title: PreparedText): boolean => {
  let offset: number = 0;

  for (const word of title.words) {
    if (
      word.charAt(0) === needle.charAt(0) &&
      isSubsequenceMatch(needle, title.compact.slice(offset))
    ) {
      return true;
    }

    offset += word.length;
  }

  return false;
};

const getRankScore: (rank: PaletteMatchRank) => number = (
  rank: PaletteMatchRank,
): number => {
  return RANK_SCORES[rank];
};

/*
 * The query's words, each once: "incidents incident" is one word, so
 * repeating a word cannot stand in for a second one.
 */
const countDistinctWords: (query: PreparedQuery) => number = (
  query: PreparedQuery,
): number => {
  let distinct: number = 0;

  query.words.forEach((token: string, index: number): void => {
    const isRepeat: boolean = query.words
      .slice(0, index)
      .some((earlier: string, earlierIndex: number): boolean => {
        return isSameWord(
          token,
          earlier,
          query.variants[index],
          query.variants[earlierIndex],
        );
      });

    if (!isRepeat) {
      distinct++;
    }
  });

  return distinct;
};

/*
 * The match, or null. `sharedBy` is how many commands share this one's title
 * (1 when it is the only one); only a command with a breadcrumb gives way.
 */
const matchPreparedCommand: (data: {
  command: PaletteCommand;
  prepared: PreparedCommand;
  query: PreparedQuery;
  sharedBy: number;
}) => PaletteCommandMatch | null = (data: {
  command: PaletteCommand;
  prepared: PreparedCommand;
  query: PreparedQuery;
  sharedBy: number;
}): PaletteCommandMatch | null => {
  const title: PreparedText = data.prepared.title;
  const query: PreparedQuery = data.query;
  const tokens: Array<string> = query.words;

  const penalty: number = data.prepared.hasBreadcrumb
    ? getSharedTitlePenalty(data.sharedBy)
    : 0;

  const titleMatch: (
    rank: PaletteMatchRank,
    bonus?: number,
  ) => PaletteCommandMatch = (
    rank: PaletteMatchRank,
    bonus?: number,
  ): PaletteCommandMatch => {
    return {
      command: data.command,
      rank,
      score: getRankScore(rank) + (bonus || 0) - penalty,
    };
  };

  // The title, or one of its aliases, matched as the title.
  let bestTitleRank: PaletteMatchRank | null = null;

  for (const candidate of data.prepared.titles) {
    const rank: PaletteMatchRank | null = matchName(candidate, query);

    if (rank !== null && (bestTitleRank === null || rank < bestTitleRank)) {
      bestTitleRank = rank;
    }
  }

  if (bestTitleRank !== null) {
    return titleMatch(bestTitleRank);
  }

  // Keywords: other names for the command, matched like a weaker title.
  let bestKeywordScore: number | null = null;

  for (const keyword of data.prepared.keywords) {
    const rank: PaletteMatchRank | null = matchName(keyword, query);

    if (rank === PaletteMatchRank.TitleExact) {
      bestKeywordScore =
        getRankScore(PaletteMatchRank.Keyword) + KEYWORD_EXACT_BONUS;
      break;
    }

    if (rank !== null) {
      bestKeywordScore = getRankScore(PaletteMatchRank.Keyword);
    }
  }

  if (bestKeywordScore !== null) {
    return {
      command: data.command,
      rank: PaletteMatchRank.Keyword,
      score: bestKeywordScore,
    };
  }

  /*
   * Context: every word somewhere across the title, the keywords and where
   * the command lives. A command with a breadcrumb needs a word of its own
   * name, or two different words: "incident settings" lists Incidents >
   * Settings, but "incidents" (or "incidents incidents") does not list
   * every page in Incidents.
   */
  const ownNames: Array<PreparedText> = [
    ...data.prepared.titles,
    ...data.prepared.keywords,
  ];

  let ownNameWordCount: number = 0;
  let contextWordCount: number = 0;
  let allWordsFound: boolean = true;
  // The crumbs that hold the words the command's own names do not.
  const crumbsUsed: Set<number> = new Set<number>();

  tokens.forEach((token: string, index: number): void => {
    const variants: Array<string> = query.variants[index] || [];

    const inOwnNames: boolean = ownNames.some((name: PreparedText): boolean => {
      return textHasWord(name, token, variants);
    });

    if (inOwnNames) {
      ownNameWordCount++;
      return;
    }

    const crumb: number = data.prepared.context.findIndex(
      (part: PreparedText): boolean => {
        return textHasWord(part, token, variants);
      },
    );

    if (crumb === -1) {
      allWordsFound = false;
      return;
    }

    contextWordCount++;
    crumbsUsed.add(crumb);
  });

  const isContextEnough: boolean = data.prepared.hasBreadcrumb
    ? ownNameWordCount > 0 || countDistinctWords(query) > 1
    : ownNameWordCount > 0;

  if (allWordsFound && isContextEnough) {
    /*
     * Two words or more that all name one place ("user settings" names User
     * Settings) say more than words scattered over the trail ("Real User
     * Monitoring > Settings").
     */
    const namesOnePlace: boolean =
      crumbsUsed.size === 1 && contextWordCount > 1;

    return {
      command: data.command,
      rank: PaletteMatchRank.Context,
      score:
        getRankScore(PaletteMatchRank.Context) +
        Math.min(
          CONTEXT_TITLE_WORD_BONUS_CAP,
          ownNameWordCount * CONTEXT_TITLE_WORD_BONUS,
        ) +
        (namesOnePlace ? CONTEXT_ONE_PLACE_BONUS : 0),
    };
  }

  // Inside the title, or inside a keyword.
  if (
    title.compact.length > 0 &&
    (title.spaced.includes(query.spaced) ||
      title.compact.includes(query.compact))
  ) {
    return titleMatch(PaletteMatchRank.Substring);
  }

  if (
    query.compact.length >= KEYWORD_SUBSTRING_MIN_LENGTH &&
    data.prepared.keywords.some((keyword: PreparedText): boolean => {
      return keyword.compact.includes(query.compact);
    })
  ) {
    return {
      command: data.command,
      rank: PaletteMatchRank.Substring,
      score:
        getRankScore(PaletteMatchRank.Substring) - KEYWORD_SUBSTRING_PENALTY,
    };
  }

  // Fallbacks from here on: shown only when nothing matches better.
  const initials: string = title.words
    .map((word: string): string => {
      return word.charAt(0);
    })
    .join("");

  if (
    tokens.length === 1 &&
    query.compact.length >= 2 &&
    title.words.length >= 2 &&
    initials.startsWith(query.compact)
  ) {
    return titleMatch(PaletteMatchRank.TitleInitials);
  }

  // Only the group the command is listed under holds every word.
  if (allWordsFound && !data.prepared.hasBreadcrumb) {
    return {
      command: data.command,
      rank: PaletteMatchRank.Category,
      score: getRankScore(PaletteMatchRank.Category),
    };
  }

  // A typo: every word found, at least one of them only with a typo.
  const ownWords: Array<string> = ownNames.flatMap(
    (name: PreparedText): Array<string> => {
      return name.words;
    },
  );

  let typoCount: number = 0;

  const everyWordWithTypos: boolean = tokens.every(
    (token: string, index: number): boolean => {
      const variants: Array<string> = query.variants[index] || [];

      if (
        ownNames.some((name: PreparedText): boolean => {
          return textHasWord(name, token, variants);
        })
      ) {
        return true;
      }

      if (hasTypoOf(token, ownWords)) {
        typoCount++;
        return true;
      }

      return false;
    },
  );

  if (everyWordWithTypos && typoCount > 0) {
    return titleMatch(PaletteMatchRank.Fuzzy, TYPO_BONUS);
  }

  if (
    query.compact.length >= SUBSEQUENCE_MIN_LENGTH &&
    isWordStartSubsequence(query.compact, title)
  ) {
    return titleMatch(PaletteMatchRank.Fuzzy);
  }

  return null;
};

/**
 * How one command matches the query, or null when it does not match at all.
 * `sharedBy` is how many commands share its title (see
 * getSharedTitlePenalty); filterPaletteCommands works it out over the whole
 * catalog. An empty query matches everything; a query of only punctuation
 * matches nothing.
 */
export const matchPaletteCommand: (
  command: PaletteCommand,
  query: string,
  sharedBy?: number,
) => PaletteCommandMatch | null = (
  command: PaletteCommand,
  query: string,
  sharedBy?: number,
): PaletteCommandMatch | null => {
  if (query.trim().length === 0) {
    return { command, rank: PaletteMatchRank.TitleExact, score: 0 };
  }

  const preparedQuery: PreparedQuery = prepareText(query);

  if (preparedQuery.words.length === 0) {
    return null;
  }

  return matchPreparedCommand({
    command,
    prepared: prepareCommand(command),
    query: preparedQuery,
    sharedBy: sharedBy || 1,
  });
};

/** The rank alone: how one command matches the query, or null. */
export const rankPaletteCommand: (
  command: PaletteCommand,
  query: string,
) => PaletteMatchRank | null = (
  command: PaletteCommand,
  query: string,
): PaletteMatchRank | null => {
  const match: PaletteCommandMatch | null = matchPaletteCommand(command, query);

  return match ? match.rank : null;
};

interface IndexedMatch {
  match: PaletteCommandMatch;
  index: number;
}

/**
 * Filter commands against free text and return them best match first.
 * Equal scores go by searchPriority, then keep the caller's order, so two
 * pages whose titles both match the same way stay in catalog order. An empty
 * or whitespace query matches everything in the original order; a query of
 * only punctuation ("#", "?") matches nothing.
 *
 * Initials, the group a command is listed under, typos and letters-in-order
 * are fallbacks: they are offered only when nothing matches better, so
 * "pager" lists On-Call and not Status Pages, and "settings" does not list
 * Users for being in the Settings group.
 */
export const filterPaletteCommands: (
  commands: Array<PaletteCommand>,
  query: string,
) => Array<PaletteCommandMatch> = (
  commands: Array<PaletteCommand>,
  query: string,
): Array<PaletteCommandMatch> => {
  if (query.trim().length === 0) {
    return commands.map((command: PaletteCommand) => {
      return { command, rank: PaletteMatchRank.TitleExact, score: 0 };
    });
  }

  const preparedQuery: PreparedQuery = prepareText(query);

  if (preparedQuery.words.length === 0) {
    return [];
  }

  const prepared: Array<PreparedCommand> = commands.map(
    (command: PaletteCommand): PreparedCommand => {
      return prepareCommand(command);
    },
  );

  /*
   * How many commands carry each title. A page called "Monitors" shares its
   * name with the Monitors product, so it is the one that gives way.
   */
  const titleCounts: Map<string, number> = new Map();

  prepared.forEach((command: PreparedCommand): void => {
    titleCounts.set(
      command.title.compact,
      (titleCounts.get(command.title.compact) || 0) + 1,
    );
  });

  const matches: Array<IndexedMatch> = [];

  commands.forEach((command: PaletteCommand, index: number): void => {
    const preparedCommand: PreparedCommand = prepared[index]!;

    const match: PaletteCommandMatch | null = matchPreparedCommand({
      command,
      prepared: preparedCommand,
      query: preparedQuery,
      sharedBy: titleCounts.get(preparedCommand.title.compact) || 1,
    });

    if (match) {
      matches.push({ match, index });
    }
  });

  const hasBetterMatches: boolean = matches.some(
    (entry: IndexedMatch): boolean => {
      return !FALLBACK_RANKS.has(entry.match.rank);
    },
  );

  return matches
    .filter((entry: IndexedMatch): boolean => {
      return !hasBetterMatches || !FALLBACK_RANKS.has(entry.match.rank);
    })
    .sort((a: IndexedMatch, b: IndexedMatch): number => {
      if (b.match.score !== a.match.score) {
        return b.match.score - a.match.score;
      }

      const priorityA: number = a.match.command.searchPriority || 0;
      const priorityB: number = b.match.command.searchPriority || 0;

      if (priorityB !== priorityA) {
        return priorityB - priorityA;
      }

      return a.index - b.index;
    })
    .map((entry: IndexedMatch): PaletteCommandMatch => {
      return entry.match;
    });
};

/*
 * A text's letters and digits as the search reads them (lowercase, accents
 * dropped), run together, with where each one came from in the text: so a
 * match found in the search's terms can be marked in the text as shown.
 */
interface NormalizedTextMap {
  compact: string;
  // For each character of `compact`, its character's index in the text.
  sourceIndex: Array<number>;
  // For each character of `compact`, whether a word of the text starts there.
  startsWord: Array<boolean>;
}

const mapNormalizedText: (text: string) => NormalizedTextMap = (
  text: string,
): NormalizedTextMap => {
  const characters: Array<string> = [];
  const sourceIndex: Array<number> = [];
  const startsWord: Array<boolean> = [];
  let isInWord: boolean = false;

  for (let index: number = 0; index < text.length; index++) {
    const character: string = text.charAt(index);

    if (!WORD_CHARACTER.test(character)) {
      isInWord = false;
      continue;
    }

    const normalized: string = character
      .normalize("NFKD")
      .replace(LETTER_ACCENTS, "")
      .normalize("NFC")
      .toLowerCase();

    let isFirst: boolean = true;

    for (const part of normalized) {
      if (!WORD_CHARACTER.test(part)) {
        continue;
      }

      characters.push(part);
      sourceIndex.push(index);
      startsWord.push(!isInWord && isFirst);
      isFirst = false;
    }

    // A lone accent written as a mark of its own stays inside its word.
    isInWord = true;
  }

  return { compact: characters.join(""), sourceIndex, startsWord };
};

/**
 * Split text into segments for <mark> highlighting, reading it the way the
 * search does (case, accents and punctuation aside): each query word is
 * marked where it starts a word of the text ("keys api" marks "API" and
 * "Keys"), the whole query where it runs across words ("oncall" marks
 * "On-Call"), and, when it starts no word, where it first appears ("eys").
 * A space or hyphen between two marked words is marked with them. Typo and
 * letters-in-order matches produce no highlight (per-character marks read
 * as noise).
 */
export const getHighlightSegments: (
  text: string,
  query: string,
) => Array<PaletteHighlightSegment> = (
  text: string,
  query: string,
): Array<PaletteHighlightSegment> => {
  const tokens: Array<string> = getPaletteQueryWords(query);

  if (tokens.length === 0 || text.length === 0) {
    return [{ text, isMatch: false }];
  }

  const map: NormalizedTextMap = mapNormalizedText(text);
  const marked: Array<boolean> = new Array<boolean>(text.length).fill(false);

  const markRange: (start: number, length: number) => void = (
    start: number,
    length: number,
  ): void => {
    for (let index: number = start; index < start + length; index++) {
      const source: number | undefined = map.sourceIndex[index];

      if (source !== undefined) {
        marked[source] = true;
      }
    }
  };

  // The whole query first, then each of its words.
  const wholeQuery: string = tokens.join("");
  const needles: Array<string> = Array.from(
    new Set<string>([wholeQuery, ...tokens]),
  );

  for (const needle of needles) {
    let foundAtWordStart: boolean = false;
    let firstAnywhere: number = -1;
    let at: number = map.compact.indexOf(needle);

    while (at !== -1) {
      if (firstAnywhere === -1) {
        firstAnywhere = at;
      }

      if (map.startsWord[at]) {
        foundAtWordStart = true;
        markRange(at, needle.length);
      }

      at = map.compact.indexOf(needle, at + 1);
    }

    if (!foundAtWordStart && firstAnywhere !== -1 && needle === wholeQuery) {
      // Only the whole query may be marked mid-word ("eys" in "Keys").
      markRange(firstAnywhere, needle.length);
    }
  }

  /*
   * A space or hyphen between two marked words is marked too, so "on call"
   * marks "On-Call" as one run rather than two with a gap.
   */
  for (let index: number = 1; index < text.length - 1; index++) {
    if (
      !marked[index] &&
      marked[index - 1] &&
      marked[index + 1] &&
      !WORD_CHARACTER.test(text.charAt(index))
    ) {
      marked[index] = true;
    }
  }

  const segments: Array<PaletteHighlightSegment> = [];

  for (let index: number = 0; index < text.length; index++) {
    const isMatch: boolean = Boolean(marked[index]);
    const last: PaletteHighlightSegment | undefined =
      segments[segments.length - 1];

    if (last && last.isMatch === isMatch) {
      last.text += text.charAt(index);
    } else {
      segments.push({ text: text.charAt(index), isMatch });
    }
  }

  if (segments.length === 0) {
    return [{ text, isMatch: false }];
  }

  return segments;
};

/**
 * Stable slug for section test ids: "Analytics & Automation" →
 * "analytics-automation". Search-provider sections use the provider's own id
 * instead of this.
 */
export const getPaletteSectionId: (title: string) => string = (
  title: string,
): string => {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};
