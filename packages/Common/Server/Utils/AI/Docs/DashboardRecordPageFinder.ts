import DashboardRecordPagesData from "./DashboardRecordPages.json";
import { tokenizePageName } from "./DashboardPageFinder";
import {
  AskAiRecordKind,
  AskAiRecordKindPages,
  AskAiRecordPage,
} from "../../../../Types/AI/AskAiRecordPages";

/*
 * ONE RECORD'S OWN PAGES, AS ASK AI FINDS THEM (#7065).
 *
 * "How do I put this status page on my own domain?" ends with a button
 * that opens that status page's Custom Domains. The model never writes the
 * address: it names the record's kind and id and the page, find_dashboard_
 * page reads the record with the person's own permissions
 * (DashboardRecordReaders) and finds the page here, and the citation of
 * that result carries the page's route and the record's id, which the
 * Dashboard opens only when the route is one of its own (AskAiPageLinks).
 *
 * DashboardRecordPages.json is generated from Search's record page index
 * (RecordPageSearchIndex.ts, held to the records' menus by its own suite),
 * for the kinds of Types/AI/AskAiRecordPages, by App's
 * AIDashboardRecordPagesCatalog test, which fails when the two part and
 * writes this file again when run with UPDATE_AI_DASHBOARD_PAGES=1. Every
 * text in it is the English the record's menu draws.
 */

export const AI_DASHBOARD_RECORD_KINDS: ReadonlyArray<AskAiRecordKindPages> =
  DashboardRecordPagesData as Array<AskAiRecordKindPages>;

const sameWords: (a: Array<string>, b: Array<string>) => boolean = (
  a: Array<string>,
  b: Array<string>,
): boolean => {
  return a.length === b.length && a.join(" ") === b.join(" ");
};

export default class DashboardRecordPageFinder {
  // A kind of record, with its pages, or undefined for one the catalog has not.
  public static getKind(
    kind: AskAiRecordKind,
    kinds: ReadonlyArray<AskAiRecordKindPages> = AI_DASHBOARD_RECORD_KINDS,
  ): AskAiRecordKindPages | undefined {
    return kinds.find((candidate: AskAiRecordKindPages): boolean => {
      return candidate.kind === kind;
    });
  }

  // The page of a record a route template opens, with its kind, or undefined.
  public static getPageByPath(
    path: string,
    kinds: ReadonlyArray<AskAiRecordKindPages> = AI_DASHBOARD_RECORD_KINDS,
  ): { kind: AskAiRecordKindPages; page: AskAiRecordPage } | undefined {
    const route: string = path.split(/[?#]/)[0] || "";

    for (const kind of kinds) {
      for (const page of kind.pages) {
        if (page.path.split(/[?#]/)[0] === route) {
          return { kind, page };
        }
      }
    }

    return undefined;
  }

  /*
   * The pages of one kind of record that fit `query` best, best first: a
   * page named exactly so first, then the ones whose title, other names
   * and section hold the most of its words. With `place`, only the pages
   * in that section of the record's menu ("Branding"), as a result named
   * it. An empty query is the record's first page: its overview.
   */
  public static find(data: {
    kind: AskAiRecordKind;
    query: string;
    limit: number;
    place?: string | undefined;
    kinds?: ReadonlyArray<AskAiRecordKindPages> | undefined;
  }): Array<AskAiRecordPage> {
    const kind: AskAiRecordKindPages | undefined = this.getKind(
      data.kind,
      data.kinds,
    );

    if (!kind || kind.pages.length === 0) {
      return [];
    }

    const placeTerms: Array<string> | undefined =
      data.place !== undefined ? tokenizePageName(data.place) : undefined;
    const pages: Array<AskAiRecordPage> = kind.pages.filter(
      (page: AskAiRecordPage): boolean => {
        return (
          placeTerms === undefined ||
          sameWords(tokenizePageName(page.section), placeTerms)
        );
      },
    );
    const queryTerms: Array<string> = tokenizePageName(data.query);

    if (queryTerms.length === 0) {
      return pages.slice(0, 1);
    }

    // The kind's own name is where every page of it is: "status page sso".
    const recordTerms: Set<string> = new Set<string>(
      tokenizePageName(kind.recordName),
    );
    const scored: Array<{ page: AskAiRecordPage; score: number }> = [];

    pages.forEach((page: AskAiRecordPage, position: number) => {
      const titleTerms: Array<string> = tokenizePageName(page.title);
      const titleSet: Set<string> = new Set<string>(titleTerms);
      const keywordSet: Set<string> = new Set<string>(
        tokenizePageName((page.keywords || []).join(" ")),
      );
      const whereSet: Set<string> = new Set<string>([
        ...tokenizePageName(page.section),
        ...recordTerms,
      ]);

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

      // Named exactly so, or by its name and where it is: the page asked for.
      const restOfQuery: Array<string> = queryTerms.filter(
        (term: string): boolean => {
          return !titleSet.has(term);
        },
      );
      const isNamedWithItsPlace: boolean =
        titleTerms.length > 0 &&
        titleTerms.every((term: string): boolean => {
          return queryTerms.includes(term);
        }) &&
        restOfQuery.length > 0 &&
        restOfQuery.every((term: string): boolean => {
          return whereSet.has(term);
        });

      if (sameWords(titleTerms, queryTerms)) {
        score += 26;
      } else if (isNamedWithItsPlace) {
        score += 24;
      }

      // Words of the query the page has none of count against it.
      score *= matched / queryTerms.length;

      scored.push({ page, score: score - position / 1e6 });
    });

    return scored
      .sort(
        (
          a: { page: AskAiRecordPage; score: number },
          b: { page: AskAiRecordPage; score: number },
        ): number => {
          return b.score - a.score;
        },
      )
      .slice(0, Math.max(1, data.limit))
      .map((entry: { page: AskAiRecordPage; score: number }) => {
        return entry.page;
      });
  }
}
