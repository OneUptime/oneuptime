import { PaletteCommand } from "./Types";

/*
 * Pure, React-free filtering and ranking for the command palette. Kept out of
 * the component so the ranking contract can be unit-tested directly and reused
 * by anything that needs "which commands match this text, best first".
 */

/**
 * How a command matched the query, best match first. The palette sorts by
 * this tier and keeps the caller's original order within a tier, so two
 * commands whose titles both start with the query stay in catalog order.
 */
export enum PaletteMatchRank {
  TitlePrefix = 0,
  TitleSubstring = 1,
  Keyword = 2,
  Category = 3,
  /** Query characters appear in order in the title, but not adjacently. */
  TitleSubsequence = 4,
}

export interface PaletteCommandMatch {
  command: PaletteCommand;
  rank: PaletteMatchRank;
}

/** One run of text in a title/description, flagged when it matched the query. */
export interface PaletteHighlightSegment {
  text: string;
  isMatch: boolean;
}

export const normalizePaletteQuery: (query: string) => string = (
  query: string,
): string => {
  return query.trim().toLowerCase();
};

/**
 * True when every character of `needle` appears in `haystack` in order (not
 * necessarily adjacent) — the "mntr" finds "Monitors" fallback. Both inputs
 * are expected to be lowercased already.
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
 * Rank one command against an already-normalized query, or null when it does
 * not match at all.
 */
export const rankPaletteCommand: (
  command: PaletteCommand,
  normalizedQuery: string,
) => PaletteMatchRank | null = (
  command: PaletteCommand,
  normalizedQuery: string,
): PaletteMatchRank | null => {
  const title: string = command.title.toLowerCase();

  if (title.startsWith(normalizedQuery)) {
    return PaletteMatchRank.TitlePrefix;
  }
  if (title.includes(normalizedQuery)) {
    return PaletteMatchRank.TitleSubstring;
  }
  const keywordMatches: boolean = (command.keywords || []).some(
    (keyword: string) => {
      return keyword.toLowerCase().includes(normalizedQuery);
    },
  );
  if (keywordMatches) {
    return PaletteMatchRank.Keyword;
  }
  if (command.category.toLowerCase().includes(normalizedQuery)) {
    return PaletteMatchRank.Category;
  }
  if (isSubsequenceMatch(normalizedQuery, title)) {
    return PaletteMatchRank.TitleSubsequence;
  }
  return null;
};

/**
 * Filter commands against free text and return them best-match-first:
 * title-prefix > title-substring > keyword > category > title-subsequence.
 * The sort is stable — within a tier the caller's order is preserved. An
 * empty/whitespace query matches everything in the original order.
 */
export const filterPaletteCommands: (
  commands: Array<PaletteCommand>,
  query: string,
) => Array<PaletteCommandMatch> = (
  commands: Array<PaletteCommand>,
  query: string,
): Array<PaletteCommandMatch> => {
  const normalizedQuery: string = normalizePaletteQuery(query);

  if (!normalizedQuery) {
    return commands.map((command: PaletteCommand) => {
      return { command, rank: PaletteMatchRank.TitlePrefix };
    });
  }

  const matches: Array<PaletteCommandMatch> = [];
  commands.forEach((command: PaletteCommand) => {
    const rank: PaletteMatchRank | null = rankPaletteCommand(
      command,
      normalizedQuery,
    );
    if (rank !== null) {
      matches.push({ command, rank });
    }
  });

  // Array.prototype.sort is stable, so equal ranks keep catalog order.
  return matches.sort((a: PaletteCommandMatch, b: PaletteCommandMatch) => {
    return a.rank - b.rank;
  });
};

/**
 * Split text into segments for <mark> highlighting: every case-insensitive
 * occurrence of the query becomes a match segment. Subsequence-only matches
 * produce no highlight (per-character marks read as noise).
 */
export const getHighlightSegments: (
  text: string,
  query: string,
) => Array<PaletteHighlightSegment> = (
  text: string,
  query: string,
): Array<PaletteHighlightSegment> => {
  const needle: string = normalizePaletteQuery(query);
  if (!needle) {
    return [{ text, isMatch: false }];
  }

  const haystack: string = text.toLowerCase();
  const segments: Array<PaletteHighlightSegment> = [];
  let cursor: number = 0;
  let matchAt: number = haystack.indexOf(needle);

  while (matchAt !== -1) {
    if (matchAt > cursor) {
      segments.push({ text: text.slice(cursor, matchAt), isMatch: false });
    }
    segments.push({
      text: text.slice(matchAt, matchAt + needle.length),
      isMatch: true,
    });
    cursor = matchAt + needle.length;
    matchAt = haystack.indexOf(needle, cursor);
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), isMatch: false });
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
