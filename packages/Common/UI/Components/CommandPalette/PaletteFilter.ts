import { PaletteCommand } from "./Types";

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
 *   order, and a plural "s" does not matter: "keys api" and "api key" both
 *   find API Keys.
 * - Keywords are other names for a command ("pager" for On-Call, "delete
 *   project" for the Danger Zone). A breadcrumb says where a page lives
 *   ("Incidents > Settings"); it narrows a search down ("incident custom
 *   fields") but never finds a page on its own for a one-word query, or
 *   "incidents" would list every page in Incidents.
 * - A title many pages share ("Custom Fields", "API", "Slack") says little on
 *   its own, so a match on it ranks below a distinctive title: "api" opens
 *   API Keys before the thirty Developer pages called API.
 * - Fallbacks, offered only when nothing matches better: the group a command
 *   is listed under ("observability" lists the observability products), a
 *   typo in a word ("incidnet") and the title's letters in order ("mntr"
 *   finds Monitors).
 * - Between equally good matches, the command's searchPriority decides (the
 *   Dashboard puts products before pages, and pages before actions), then
 *   the caller's order.
 */

/**
 * How a command matched the query, best first. The palette orders matches by
 * score, which starts from the rank and is adjusted for shared titles and
 * for how much of the query a context match found in the title.
 */
export enum PaletteMatchRank {
  /** The whole title: "api keys", "API-Keys" and "apikey" all name API Keys. */
  TitleExact = 0,
  /** The title starts with the query: "api k" finds API Keys. */
  TitlePrefix = 1,
  /** Every query word starts a word of the title, in any order: "keys api". */
  TitleWords = 2,
  /** The query is the start of the title's initials: "ak" finds API Keys. */
  TitleInitials = 3,
  /** A keyword is the query, starts with it, or holds every word of it. */
  Keyword = 4,
  /**
   * Every query word is found across the title, keywords and where the
   * command lives (its breadcrumb, or the group it is listed under), at
   * least one in its own names: "incident custom fields", "logs
   * observability".
   */
  Context = 5,
  /** The query appears inside the title, not at a word start: "eys". */
  TitleSubstring = 6,
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
  [PaletteMatchRank.Category, PaletteMatchRank.Fuzzy],
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
  [PaletteMatchRank.TitleInitials]: 72,
  [PaletteMatchRank.Keyword]: 62,
  [PaletteMatchRank.Context]: 50,
  [PaletteMatchRank.TitleSubstring]: 40,
  [PaletteMatchRank.Category]: 30,
  [PaletteMatchRank.Fuzzy]: 20,
};

// A keyword that is exactly the query is worth more than one it starts.
const KEYWORD_EXACT_BONUS: number = 8;

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
const WORD_ENDINGS_DROPPING_ES: RegExp = /(?:ches|shes|sses|uses|xes|zes)$/;

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

/**
 * A word without its plural ending, so "keys" meets "key" and "policies"
 * meets "policy". English endings only; for a word that has none it is the
 * word itself.
 */
export const stemPaletteWord: (word: string) => string = (
  word: string,
): string => {
  if (word.length > 4 && word.endsWith("ies")) {
    return `${word.slice(0, -3)}y`;
  }

  if (word.length > 4 && WORD_ENDINGS_DROPPING_ES.test(word)) {
    return word.slice(0, -2);
  }

  if (
    word.length > 3 &&
    word.endsWith("s") &&
    !word.endsWith("ss") &&
    !word.endsWith("us") &&
    !word.endsWith("is")
  ) {
    return word.slice(0, -1);
  }

  return word;
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
 * True when `a` and `b` differ by at most one edit: a letter changed, added,
 * dropped, or two neighbours swapped ("incidnet").
 */
export const isWithinOneEdit: (a: string, b: string) => boolean = (
  a: string,
  b: string,
): boolean => {
  if (a === b) {
    return true;
  }

  if (Math.abs(a.length - b.length) > 1) {
    return false;
  }

  let common: number = 0;

  while (common < a.length && common < b.length && a[common] === b[common]) {
    common++;
  }

  if (a.length === b.length) {
    if (a.slice(common + 1) === b.slice(common + 1)) {
      return true;
    }

    return (
      common + 1 < a.length &&
      a[common] === b[common + 1] &&
      a[common + 1] === b[common] &&
      a.slice(common + 2) === b.slice(common + 2)
    );
  }

  if (a.length > b.length) {
    return a.slice(common + 1) === b.slice(common);
  }

  return a.slice(common) === b.slice(common + 1);
};

interface PreparedText {
  words: Array<string>;
  stems: Array<string>;
  // The words run together: "on-call duty" is "oncallduty".
  compact: string;
  // The stems run together: "API Keys" is "apikey".
  stemmedCompact: string;
  // The words joined with single spaces.
  spaced: string;
}

const prepareText: (text: string) => PreparedText = (
  text: string,
): PreparedText => {
  const normalized: string = normalizePaletteQuery(text);
  const words: Array<string> = normalized ? normalized.split(" ") : [];
  const stems: Array<string> = words.map(stemPaletteWord);

  return {
    words,
    stems,
    compact: words.join(""),
    stemmedCompact: stems.join(""),
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

  const contextParts: Array<string> = hasBreadcrumb
    ? [...(command.breadcrumb || []), ...(command.breadcrumbKeywords || [])]
    : [command.category];

  const prepared: PreparedCommand = {
    title,
    titles: [
      title,
      ...(command.titleAliases || [])
        .map((alias: string): PreparedText => {
          return prepareText(alias);
        })
        .filter((alias: PreparedText): boolean => {
          return alias.words.length > 0;
        }),
    ],
    keywords: (command.keywords || [])
      .map((keyword: string): PreparedText => {
        return prepareText(keyword);
      })
      .filter((keyword: PreparedText): boolean => {
        return keyword.words.length > 0;
      }),
    context: contextParts
      .map((part: string): PreparedText => {
        return prepareText(part);
      })
      .filter((part: PreparedText): boolean => {
        return part.words.length > 0;
      }),
    hasBreadcrumb,
  };

  preparedCommands.set(command, prepared);

  return prepared;
};

interface PreparedQuery {
  text: PreparedText;
  stems: Array<string>;
}

// Whether one query word starts one word of the text, plural endings aside.
const wordMatches: (
  token: string,
  tokenStem: string,
  word: string,
  wordStem: string,
) => boolean = (
  token: string,
  tokenStem: string,
  word: string,
  wordStem: string,
): boolean => {
  if (word.startsWith(token)) {
    return true;
  }

  if (tokenStem.length < 3) {
    return false;
  }

  return word.startsWith(tokenStem) || wordStem.startsWith(tokenStem);
};

const textHasWord: (
  text: PreparedText,
  token: string,
  tokenStem: string,
) => boolean = (
  text: PreparedText,
  token: string,
  tokenStem: string,
): boolean => {
  return text.words.some((word: string, index: number): boolean => {
    return wordMatches(token, tokenStem, word, text.stems[index] || word);
  });
};

const textHasEveryWord: (
  text: PreparedText,
  query: PreparedQuery,
) => boolean = (text: PreparedText, query: PreparedQuery): boolean => {
  return query.text.words.every((token: string, index: number): boolean => {
    return textHasWord(text, token, query.stems[index] || token);
  });
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
    return [token.length - 1, token.length, token.length + 1].some(
      (length: number): boolean => {
        return (
          length <= word.length && isWithinOneEdit(token, word.slice(0, length))
        );
      },
    );
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

// How one title matches the query on its own, or null.
const matchTitle: (
  title: PreparedText,
  query: PreparedQuery,
) => PaletteMatchRank | null = (
  title: PreparedText,
  query: PreparedQuery,
): PaletteMatchRank | null => {
  if (title.compact.length === 0) {
    return null;
  }

  if (
    title.compact === query.text.compact ||
    title.stemmedCompact === query.text.stemmedCompact
  ) {
    return PaletteMatchRank.TitleExact;
  }

  if (title.compact.startsWith(query.text.compact)) {
    return PaletteMatchRank.TitlePrefix;
  }

  if (textHasEveryWord(title, query)) {
    return PaletteMatchRank.TitleWords;
  }

  const initials: string = title.words
    .map((word: string): string => {
      return word.charAt(0);
    })
    .join("");

  if (
    query.text.words.length === 1 &&
    query.text.compact.length >= 2 &&
    title.words.length >= 2 &&
    initials.startsWith(query.text.compact)
  ) {
    return PaletteMatchRank.TitleInitials;
  }

  return null;
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
  const tokens: Array<string> = query.text.words;

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
    const rank: PaletteMatchRank | null = matchTitle(candidate, query);

    if (rank !== null && (bestTitleRank === null || rank < bestTitleRank)) {
      bestTitleRank = rank;
    }
  }

  if (bestTitleRank !== null) {
    return titleMatch(bestTitleRank);
  }

  // Keywords: another name for the command, matched like a weaker title.
  let bestKeywordScore: number | null = null;

  for (const keyword of data.prepared.keywords) {
    if (
      keyword.compact === query.text.compact ||
      keyword.stemmedCompact === query.text.stemmedCompact
    ) {
      bestKeywordScore =
        getRankScore(PaletteMatchRank.Keyword) + KEYWORD_EXACT_BONUS;
      break;
    }

    if (
      keyword.compact.startsWith(query.text.compact) ||
      textHasEveryWord(keyword, query)
    ) {
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
   * name in a one-word query; with two words or more, the breadcrumb may
   * carry all of them ("incident settings" lists Incidents > Settings).
   */
  // The command's own names: its title, the title's aliases and keywords.
  const ownNames: Array<PreparedText> = [
    ...data.prepared.titles,
    ...data.prepared.keywords,
  ];

  const ownNamesHaveWord: (token: string, stem: string) => boolean = (
    token: string,
    stem: string,
  ): boolean => {
    return ownNames.some((name: PreparedText): boolean => {
      return textHasWord(name, token, stem);
    });
  };

  let titleWordHits: number = 0;
  let allWordsFound: boolean = true;
  // The crumbs that hold the words the title does not.
  const crumbsUsed: Set<number> = new Set<number>();

  tokens.forEach((token: string, index: number): void => {
    const stem: string = query.stems[index] || token;

    if (ownNamesHaveWord(token, stem)) {
      titleWordHits++;
      return;
    }

    const crumb: number = data.prepared.context.findIndex(
      (part: PreparedText): boolean => {
        return textHasWord(part, token, stem);
      },
    );

    if (crumb === -1) {
      allWordsFound = false;
      return;
    }

    crumbsUsed.add(crumb);
  });

  const contextIsEnough: boolean = data.prepared.hasBreadcrumb
    ? titleWordHits > 0 || tokens.length > 1
    : titleWordHits > 0;

  if (allWordsFound && contextIsEnough) {
    /*
     * Words that all name one place ("user settings" names User Settings)
     * say more than words scattered over the trail ("Real User Monitoring >
     * Settings").
     */
    const namesOnePlace: boolean = crumbsUsed.size === 1 && tokens.length > 1;

    return {
      command: data.command,
      rank: PaletteMatchRank.Context,
      score:
        getRankScore(PaletteMatchRank.Context) +
        Math.min(
          CONTEXT_TITLE_WORD_BONUS_CAP,
          titleWordHits * CONTEXT_TITLE_WORD_BONUS,
        ) +
        (namesOnePlace ? CONTEXT_ONE_PLACE_BONUS : 0),
    };
  }

  if (
    title.compact.length > 0 &&
    (title.spaced.includes(query.text.spaced) ||
      title.compact.includes(query.text.compact))
  ) {
    return titleMatch(PaletteMatchRank.TitleSubstring);
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
  const searchableWords: Array<string> = ownNames.flatMap(
    (name: PreparedText): Array<string> => {
      return name.words;
    },
  );

  let typoCount: number = 0;

  const everyWordWithTypos: boolean = tokens.every(
    (token: string, index: number): boolean => {
      const stem: string = query.stems[index] || token;

      if (ownNamesHaveWord(token, stem)) {
        return true;
      }

      if (hasTypoOf(token, searchableWords)) {
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
    query.text.compact.length >= SUBSEQUENCE_MIN_LENGTH &&
    isWordStartSubsequence(query.text.compact, title)
  ) {
    return titleMatch(PaletteMatchRank.Fuzzy);
  }

  return null;
};

const prepareQuery: (query: string) => PreparedQuery = (
  query: string,
): PreparedQuery => {
  const text: PreparedText = prepareText(query);

  return { text, stems: text.stems };
};

/**
 * How one command matches the query, or null when it does not match at all.
 * `sharedBy` is how many commands share its title (see
 * getSharedTitlePenalty); filterPaletteCommands works it out over the whole
 * catalog.
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
  const preparedQuery: PreparedQuery = prepareQuery(query);

  if (preparedQuery.text.words.length === 0) {
    return { command, rank: PaletteMatchRank.TitleExact, score: 0 };
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

/**
 * Filter commands against free text and return them best match first.
 * Equal scores go by searchPriority, then keep the caller's order, so two
 * pages whose titles both match the same way stay in catalog order. An empty
 * or whitespace query matches everything in the original order.
 *
 * The group a command is listed under, typos and letters-in-order are
 * fallbacks: they are offered only when nothing matches better, so "pager"
 * lists On-Call and not Status Pages, and "settings" does not list Users
 * for being in the Settings group.
 */
export const filterPaletteCommands: (
  commands: Array<PaletteCommand>,
  query: string,
) => Array<PaletteCommandMatch> = (
  commands: Array<PaletteCommand>,
  query: string,
): Array<PaletteCommandMatch> => {
  const preparedQuery: PreparedQuery = prepareQuery(query);

  if (preparedQuery.text.words.length === 0) {
    return commands.map((command: PaletteCommand) => {
      return { command, rank: PaletteMatchRank.TitleExact, score: 0 };
    });
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
      command.title.stemmedCompact,
      (titleCounts.get(command.title.stemmedCompact) || 0) + 1,
    );
  });

  const matches: Array<{ match: PaletteCommandMatch; index: number }> = [];

  commands.forEach((command: PaletteCommand, index: number): void => {
    const preparedCommand: PreparedCommand = prepared[index]!;

    const match: PaletteCommandMatch | null = matchPreparedCommand({
      command,
      prepared: preparedCommand,
      query: preparedQuery,
      sharedBy: titleCounts.get(preparedCommand.title.stemmedCompact) || 1,
    });

    if (match) {
      matches.push({ match, index });
    }
  });

  const hasBetterMatches: boolean = matches.some(
    (entry: { match: PaletteCommandMatch; index: number }): boolean => {
      return !FALLBACK_RANKS.has(entry.match.rank);
    },
  );

  return matches
    .filter((entry: { match: PaletteCommandMatch; index: number }): boolean => {
      return !hasBetterMatches || !FALLBACK_RANKS.has(entry.match.rank);
    })
    .sort(
      (
        a: { match: PaletteCommandMatch; index: number },
        b: { match: PaletteCommandMatch; index: number },
      ): number => {
        if (b.match.score !== a.match.score) {
          return b.match.score - a.match.score;
        }

        const priorityA: number = a.match.command.searchPriority || 0;
        const priorityB: number = b.match.command.searchPriority || 0;

        if (priorityB !== priorityA) {
          return priorityB - priorityA;
        }

        return a.index - b.index;
      },
    )
    .map((entry: { match: PaletteCommandMatch; index: number }) => {
      return entry.match;
    });
};

const LETTER_OR_DIGIT: RegExp = /[\p{L}\p{N}]/u;

/**
 * Split text into segments for <mark> highlighting: each query word is
 * marked where it starts a word of the text ("keys api" marks "API" and
 * "Keys"), or, when it starts none, where it first appears. Typo and
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
  const tokens: Array<string> = query
    .toLowerCase()
    .split(/\s+/)
    .map((token: string): string => {
      return token.trim();
    })
    .filter((token: string): boolean => {
      return token.length > 0;
    });

  const haystack: string = text.toLowerCase();

  /*
   * Lowercasing can change a string's length (a dotted capital I), which
   * would put the marks in the wrong place; such text is left unmarked.
   */
  if (tokens.length === 0 || haystack.length !== text.length) {
    return [{ text, isMatch: false }];
  }

  const marked: Array<boolean> = new Array<boolean>(text.length).fill(false);

  const markRange: (start: number, length: number) => void = (
    start: number,
    length: number,
  ): void => {
    for (let index: number = start; index < start + length; index++) {
      marked[index] = true;
    }
  };

  const isWordStart: (index: number) => boolean = (index: number): boolean => {
    return index === 0 || !LETTER_OR_DIGIT.test(haystack.charAt(index - 1));
  };

  // The whole query first, so "on and on" marks both "on"s, then each word.
  const needles: Array<string> = Array.from(
    new Set<string>([query.trim().toLowerCase(), ...tokens]),
  ).filter((needle: string): boolean => {
    return needle.length > 0;
  });

  for (const needle of needles) {
    let foundAtWordStart: boolean = false;
    let firstAnywhere: number = -1;
    let at: number = haystack.indexOf(needle);

    while (at !== -1) {
      if (firstAnywhere === -1) {
        firstAnywhere = at;
      }

      if (isWordStart(at)) {
        foundAtWordStart = true;
        markRange(at, needle.length);
      }

      at = haystack.indexOf(needle, at + 1);
    }

    if (!foundAtWordStart && firstAnywhere !== -1 && needle === needles[0]) {
      // Only the whole query may be marked mid-word ("eys" in "Keys").
      markRange(firstAnywhere, needle.length);
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
