import GenericObject from "../../../Types/GenericObject";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import {
  PluralTemplate,
  TranslatableTerm,
  Translator,
  translatableTerm,
  translationKey,
} from "../../Utils/TranslateTemplate";
import type { BulkActionButtonSchema } from "./BulkUpdateForm";

/*
 * SELECTING EVERY ROW THAT MATCHES, not only the page's - a table's Select
 * All, a list's "Select all 4,213 exceptions" - and what is said around it.
 * React-free: the rules are tested alone, and a table and a telemetry list
 * read the same way.
 *
 *   - What is read: the rows the list's search and filters match, in the
 *     list's own order, a page of BULK_SELECT_ALL_PAGE_SIZE at a time, up to
 *     BULK_SELECT_ALL_LIMIT (readEveryMatch). The list's own read counts the
 *     match, so the offer names how many before anything is read.
 *   - The offer (getSelectAllMatchingOffer): once every row on the page is
 *     ticked and more rows match, "Select all 4,213 exceptions" - or, past
 *     the ceiling, "Select the first 10,000 of 12,345 exceptions", so the
 *     ceiling is said before a row is read, not after.
 *   - Before acting (askBeforeActingAcrossPages): an action that asks
 *     nothing of its own - a quick move a row's ⋯ makes in one click - asks
 *     here once the selection holds rows the page does not show, naming how
 *     many it is about to change.
 */

/*
 * "Select All" loads the whole filtered result set - up to the ceiling - with
 * the same columns the list itself reads. Asking for all of them in one
 * request would mean a single wide, relation-joined query for up to 10,000
 * rows, which is exactly the kind of query the database statement timeout
 * kills. It is paged instead: each request is comparable in cost to a large
 * page load, so a big selection degrades in latency rather than failing.
 *
 * The page size trades those two costs off. Every list request also runs an
 * unbounded count over the filtered set and pays a growing OFFSET, so smaller
 * pages multiply that overhead; 1,000 keeps each query well inside the
 * statement timeout while capping a maxed-out selection at ten round trips.
 */
export const BULK_SELECT_ALL_PAGE_SIZE: number = 1000;

// The most rows one selection holds: a project's list ceiling.
export const BULK_SELECT_ALL_LIMIT: number = LIMIT_PER_PROJECT;

// One read of the rows that match: a page of them, and what it says of the rest.
export interface MatchingPage<T> {
  data: Array<T>;
  // How many rows match, when the read counts them.
  count?: number | undefined;
  /*
   * Whether rows follow this page, for a read that says so instead of
   * counting (the analytics list endpoints).
   */
  hasMore?: boolean | undefined;
}

// What a selection of every match holds.
export interface EveryMatch<T> {
  // The rows read, in the list's order, each once.
  items: Array<T>;
  // How many rows match, as the reads said: never fewer than were read.
  totalCount: number;
  // More rows match than the selection holds: it stopped at the ceiling.
  isTruncated: boolean;
}

export interface ReadEveryMatchOptions<T> {
  /*
   * Reads `limit` of the matching rows after the first `skip`, in an order
   * that holds still between reads - the list's order with the row's id
   * after it, so rows that share a sort value cannot land on two pages
   * while another row is never read at all.
   */
  readPage: (page: { skip: number; limit: number }) => Promise<MatchingPage<T>>;
  // What makes a row the same row on two pages.
  getItemId: (item: T) => string;
  // The ceiling: BULK_SELECT_ALL_LIMIT unless said otherwise.
  limit?: number | undefined;
  pageSize?: number | undefined;
  /*
   * Asked after every read: a newer selection, a cleared one or a changed
   * search supersedes this one, which then stops and answers null.
   */
  isSuperseded?: (() => boolean) | undefined;
}

/*
 * Reads every row that matches, a page at a time, up to the ceiling. Answers
 * null when it was superseded part-way; a read that fails throws, and nothing
 * is selected (a half-read selection that claims to be everything is worse
 * than a failed one).
 */
export const readEveryMatch: <T>(
  options: ReadEveryMatchOptions<T>,
) => Promise<EveryMatch<T> | null> = async <T>(
  options: ReadEveryMatchOptions<T>,
): Promise<EveryMatch<T> | null> => {
  const ceiling: number = Math.max(0, options.limit ?? BULK_SELECT_ALL_LIMIT);
  const pageSize: number = Math.max(
    1,
    options.pageSize ?? BULK_SELECT_ALL_PAGE_SIZE,
  );

  const items: Array<T> = [];

  /*
   * Offset paging over a table that is still receiving writes can hand back
   * a row that an earlier page already returned. Selecting it twice would
   * duplicate it in an export and inflate the selected count.
   */
  const seenIds: Set<string> = new Set<string>();

  let totalCount: number = 0;
  let hasMore: boolean = false;
  let rowsRead: number = 0;

  while (items.length < ceiling) {
    const limit: number = Math.min(pageSize, ceiling - items.length);

    const page: MatchingPage<T> = await options.readPage({
      skip: rowsRead,
      limit: limit,
    });

    if (options.isSuperseded?.()) {
      return null;
    }

    const data: Array<T> = page.data || [];

    totalCount = page.count || totalCount;
    hasMore = Boolean(page.hasMore);
    rowsRead += data.length;

    for (const item of data) {
      const id: string = options.getItemId(item) || "";

      if (id) {
        if (seenIds.has(id)) {
          continue;
        }

        seenIds.add(id);
      }

      items.push(item);
    }

    if (data.length < limit) {
      // A short page is the last page.
      hasMore = false;
      break;
    }

    if (page.hasMore === false) {
      break;
    }

    if (totalCount > 0 && rowsRead >= totalCount) {
      /*
       * Everything matching has been read. Stopping here saves the empty
       * round trip a result set that is an exact multiple of the page size
       * would otherwise cost - and each of those requests runs a full count
       * over the filtered set.
       */
      break;
    }
  }

  return {
    items: items,
    totalCount: Math.max(totalCount, items.length),
    isTruncated: totalCount > rowsRead || hasMore,
  };
};

/*
 * THE OFFER: what a list's header line offers once every row on its page is
 * ticked and more rows match than the page shows.
 */
export enum SelectAllMatchingOfferKind {
  // Nothing to offer: the page is not all ticked, or it is all there is.
  None = "none",
  // "Select all 4,213 exceptions": every match fits in one selection.
  All = "all",
  // "Select the first 10,000 of 12,345 exceptions": more match than fit.
  First = "first",
  /*
   * "Select All Monitors": rows follow, but the list does not know how many
   * (an analytics list that answers whether more follow, not how many).
   */
  Unknown = "unknown",
}

export interface SelectAllMatchingOffer {
  kind: SelectAllMatchingOfferKind;
  // How many rows match (All, First).
  count?: number | undefined;
  // How many a selection holds at most (First).
  limit?: number | undefined;
}

export const getSelectAllMatchingOffer: (data: {
  // How many rows are ticked.
  selectedCount: number;
  // Every row on the page is ticked.
  isPageSelected: boolean;
  // A selection of every match is what is ticked already.
  isEveryMatchSelected: boolean;
  // How many rows match, when the list knows exactly.
  matchingCount?: number | undefined;
  /*
   * Without an exact count: whether rows follow the page (left out, nothing
   * is said to follow).
   */
  hasMore?: boolean | undefined;
  limit?: number | undefined;
}) => SelectAllMatchingOffer = (data: {
  selectedCount: number;
  isPageSelected: boolean;
  isEveryMatchSelected: boolean;
  matchingCount?: number | undefined;
  hasMore?: boolean | undefined;
  limit?: number | undefined;
}): SelectAllMatchingOffer => {
  if (
    data.selectedCount <= 0 ||
    !data.isPageSelected ||
    data.isEveryMatchSelected
  ) {
    return { kind: SelectAllMatchingOfferKind.None };
  }

  if (data.matchingCount === undefined || !Number.isFinite(data.matchingCount)) {
    return {
      kind: data.hasMore
        ? SelectAllMatchingOfferKind.Unknown
        : SelectAllMatchingOfferKind.None,
    };
  }

  const count: number = Math.floor(data.matchingCount);

  if (count <= data.selectedCount) {
    return { kind: SelectAllMatchingOfferKind.None };
  }

  const limit: number = Math.max(1, data.limit ?? BULK_SELECT_ALL_LIMIT);

  if (count > limit) {
    return {
      kind: SelectAllMatchingOfferKind.First,
      count: count,
      limit: limit,
    };
  }

  return { kind: SelectAllMatchingOfferKind.All, count: count };
};

/*
 * The offer's words. The noun is the list's own ("exceptions", "Workflows"
 * in German), in the sentence. Without a count, the table's own Select All
 * words (BulkUpdateForm's Card).
 */
export const BULK_SELECT_ALL_MATCHING: PluralTemplate = {
  one: "Select all {{count}} {{itemName}}",
  other: "Select all {{count}} {{itemsName}}",
};

export const BULK_SELECT_FIRST_MATCHING: PluralTemplate = {
  one: "Select the first {{limit}} of {{count}} {{itemName}}",
  other: "Select the first {{limit}} of {{count}} {{itemsName}}",
};

export const BULK_SELECT_ALL_UNCOUNTED: string = translationKey(
  "Select All {{itemsName}}",
);

/*
 * The offer, in the reader's words: undefined when there is none. Numbers
 * in the reader's digits.
 */
export const getSelectAllMatchingWords: (data: {
  offer: SelectAllMatchingOffer;
  translator: Translator;
  singularLabel: string;
  pluralLabel: string;
}) => string | undefined = (data: {
  offer: SelectAllMatchingOffer;
  translator: Translator;
  singularLabel: string;
  pluralLabel: string;
}): string | undefined => {
  const itemTerm: TranslatableTerm = translatableTerm(data.singularLabel, {
    inSentence: true,
  });
  const itemsTerm: TranslatableTerm = translatableTerm(data.pluralLabel, {
    inSentence: true,
  });

  switch (data.offer.kind) {
    case SelectAllMatchingOfferKind.All:
      return data.translator.translatePlural(
        BULK_SELECT_ALL_MATCHING,
        data.offer.count || 0,
        {
          count: data.translator.formatNumber(data.offer.count || 0),
          itemName: itemTerm,
          itemsName: itemsTerm,
        },
      );
    case SelectAllMatchingOfferKind.First:
      return data.translator.translatePlural(
        BULK_SELECT_FIRST_MATCHING,
        data.offer.count || 0,
        {
          count: data.translator.formatNumber(data.offer.count || 0),
          limit: data.translator.formatNumber(data.offer.limit || 0),
          itemName: itemTerm,
          itemsName: itemsTerm,
        },
      );
    case SelectAllMatchingOfferKind.Unknown:
      return data.translator.translateTemplate(BULK_SELECT_ALL_UNCOUNTED, {
        itemsName: translatableTerm(data.pluralLabel),
      });
    case SelectAllMatchingOfferKind.None:
    default:
      return undefined;
  }
};

/*
 * BEFORE ACTING ON ROWS THE PAGE DOES NOT SHOW.
 *
 * A list whose rows each take a quick move in one click - an exception's
 * Resolve or Archive - asks nothing before it moves the ticked rows of a
 * page. Once every match is selected, a click would move rows the reader
 * cannot see - thousands of them - so the action asks first, naming how
 * many: the action's own words over the dialog, then the count. An action
 * that asks a question of its own (confirmMessage) asks that, and one that
 * opens a dialog of its own (opensItsOwnDialog: Assign to…, which names how
 * many it assigns) opens it.
 */
export const BULK_ACROSS_PAGES_QUESTION: PluralTemplate = {
  one: "This changes all {{count}} selected {{itemName}}, including those on other pages.",
  other:
    "This changes all {{count}} selected {{itemsName}}, including those on other pages.",
};

export const askBeforeActingAcrossPages: <T extends GenericObject>(
  button: BulkActionButtonSchema<T>,
  data: {
    translator: Translator;
    singularLabel: string;
    pluralLabel: string;
  },
) => BulkActionButtonSchema<T> = <T extends GenericObject>(
  button: BulkActionButtonSchema<T>,
  data: {
    translator: Translator;
    singularLabel: string;
    pluralLabel: string;
  },
): BulkActionButtonSchema<T> => {
  if (button.confirmMessage || button.opensItsOwnDialog) {
    return button;
  }

  return {
    ...button,
    // The action's own words over the dialog, and on its button.
    confirmTitle: (): string => {
      return data.translator.translateText(button.title) || button.title;
    },
    confirmMessage: (items: Array<T>): string => {
      return data.translator.translatePlural(
        BULK_ACROSS_PAGES_QUESTION,
        items.length,
        {
          count: data.translator.formatNumber(items.length),
          itemName: translatableTerm(data.singularLabel, { inSentence: true }),
          itemsName: translatableTerm(data.pluralLabel, { inSentence: true }),
        },
      );
    },
  };
};
