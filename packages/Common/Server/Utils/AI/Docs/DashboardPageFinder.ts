import DashboardPagesData from "./DashboardPages.json";

/*
 * THE DASHBOARD'S PAGES, AS ASK AI FINDS THEM (issue #6828).
 *
 * A "how do I...?" answer ends with a button that opens the page of the
 * project where it is done: Create Monitor, Notification Methods. The model
 * never writes that address. It names the page, find_dashboard_page finds
 * it here, and the citation of that result carries the page's route, which
 * the Dashboard opens only when it is one of its own routes
 * (CitationTargetNav).
 *
 * DashboardPages.json is generated from the page index Search (Cmd/Ctrl+K)
 * reads, PageSearchIndex.ts, which tests hold to the menus and to RouteMap:
 * every page and setting a menu links to, under the names the menus give
 * them, in English. App's AIDashboardPagesCatalog test fails when the two
 * part, and writes this file again when run with
 * UPDATE_AI_DASHBOARD_PAGES=1.
 */

export enum AIDashboardPageKind {
  Page = "page",
  Setting = "setting",
  Action = "action",
}

export interface AIDashboardPage {
  title: string;
  // Where it is, as Search shows it: ["Project Settings", "Advanced"].
  where: Array<string>;
  keywords?: Array<string> | undefined;
  // Its route template, with its query string or anchor: "/dashboard/:projectId/settings/api-keys".
  path: string;
  kind: AIDashboardPageKind;
  // Offered only where billing is turned on (OneUptime Cloud).
  billing?: true | undefined;
}

export const AI_DASHBOARD_PAGES: ReadonlyArray<AIDashboardPage> =
  DashboardPagesData as Array<AIDashboardPage>;

const WORD_ENDINGS: ReadonlyArray<string> = ["ing", "ed", "es", "s"];
const ENGLISH_WORD: RegExp = /^[a-z]+$/;

const IGNORED_WORDS: ReadonlySet<string> = new Set<string>([
  "a",
  "an",
  "and",
  "for",
  "my",
  "of",
  "page",
  "the",
  "to",
]);

export const tokenizePageName: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word: string): boolean => {
      return word.length > 0 && !IGNORED_WORDS.has(word);
    })
    .map((word: string): string => {
      if (!ENGLISH_WORD.test(word)) {
        return word;
      }
      for (const ending of WORD_ENDINGS) {
        if (word.endsWith(ending) && word.length - ending.length >= 3) {
          return word.slice(0, word.length - ending.length);
        }
      }
      return word;
    });
};

const sameWords: (a: Array<string>, b: Array<string>) => boolean = (
  a: Array<string>,
  b: Array<string>,
): boolean => {
  return a.length === b.length && a.join(" ") === b.join(" ");
};

export default class DashboardPageFinder {
  /*
   * The pages that fit `query` best, best first: a page named exactly so
   * first, then the ones whose name, other names and place hold the most
   * of its words. Where billing is off, no billing page.
   */
  public static find(data: {
    query: string;
    limit: number;
    isBillingEnabled: boolean;
    pages?: ReadonlyArray<AIDashboardPage> | undefined;
  }): Array<AIDashboardPage> {
    const queryTerms: Array<string> = tokenizePageName(data.query);

    if (queryTerms.length === 0) {
      return [];
    }

    const pages: ReadonlyArray<AIDashboardPage> =
      data.pages || AI_DASHBOARD_PAGES;
    const scored: Array<{ page: AIDashboardPage; score: number }> = [];

    pages.forEach((page: AIDashboardPage, position: number) => {
      if (page.billing && !data.isBillingEnabled) {
        return;
      }

      const titleTerms: Array<string> = tokenizePageName(page.title);
      const titleSet: Set<string> = new Set<string>(titleTerms);
      const whereSet: Set<string> = new Set<string>(
        tokenizePageName(page.where.join(" ")),
      );
      const keywordSet: Set<string> = new Set<string>(
        tokenizePageName((page.keywords || []).join(" ")),
      );

      let score: number = 0;
      let matched: number = 0;

      for (const term of queryTerms) {
        const termScore: number =
          (titleSet.has(term) ? 4 : 0) +
          (keywordSet.has(term) ? 2 : 0) +
          (whereSet.has(term) ? 1.5 : 0);

        if (termScore > 0) {
          matched++;
          score += termScore;
        }
      }

      if (matched === 0) {
        return;
      }

      // Named exactly so: the page asked for, before every page that merely mentions its words.
      if (sameWords(titleTerms, queryTerms)) {
        score += 20;
      } else if (
        sameWords(
          tokenizePageName(`${page.where.join(" ")} ${page.title}`),
          queryTerms,
        )
      ) {
        score += 24;
      }

      // Words of the query the page has none of count against it.
      score *= matched / queryTerms.length;

      // A page before a setting on it, before an action, between equal matches.
      const kindBonus: number =
        page.kind === AIDashboardPageKind.Page
          ? 0.3
          : page.kind === AIDashboardPageKind.Setting
            ? 0.2
            : 0.1;

      scored.push({ page, score: score + kindBonus - position / 1e6 });
    });

    return scored
      .sort(
        (
          a: { page: AIDashboardPage; score: number },
          b: { page: AIDashboardPage; score: number },
        ): number => {
          return b.score - a.score;
        },
      )
      .slice(0, Math.max(1, data.limit))
      .map(
        (entry: { page: AIDashboardPage; score: number }): AIDashboardPage => {
          return entry.page;
        },
      );
  }
}
