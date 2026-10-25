import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The words and windows of Security Events > Entities.
 *
 * React-free so the windows and the words are pinned in a plain test.
 */

// The window Riskiest Entities opens on: a week.
export const DEFAULT_ENTITY_WINDOW_IN_DAYS: number = 7;

// The window switch's name, for a screen reader.
export const ENTITY_WINDOW_LABEL: string = translationKey("Time window");

/*
 * What an entity is, said in the card that ranks them: the page's name is
 * a word a newcomer does not know.
 */
export const RISKIEST_ENTITIES_DESCRIPTION: string = translationKey(
  "The users, hosts, addresses and files your findings name most: from detection rules, threat intel and your connected products' alerts. Select one to see everything it touched in Correlate.",
);

export const ENTITIES_EMPTY_TITLE: string = translationKey(
  "No finding named an entity in this window.",
);

export const ENTITIES_EMPTY_DESCRIPTION: string = translationKey(
  "A user, host or address shows up here once a detection rule, a threat intel match or a connected product's alert names it.",
);

export const OPEN_IN_CORRELATE: string = translationKey("Open in Correlate");

/*
 * Riskiest Entities reads the ranking whole (the server's top 100) and
 * pages it here, ten a page as every list of the product starts.
 */
export const ENTITIES_PER_PAGE: number = 10;

export interface EntityPage<T> {
  rows: Array<T>;
  // The page shown: the one asked for, or the last there is.
  pageNumber: number;
}

/*
 * One page of the ranking. A page past the end - a read that came back
 * shorter than the page the reader was on - shows the last page, never an
 * empty one under a footer that says there is more.
 */
export function getEntityPage<T>(data: {
  rows: ReadonlyArray<T>;
  pageNumber: number;
  perPage: number;
}): EntityPage<T> {
  const perPage: number = Math.max(1, Math.floor(data.perPage) || 1);
  const lastPage: number = Math.max(1, Math.ceil(data.rows.length / perPage));
  const pageNumber: number = Math.min(
    Math.max(1, Math.floor(data.pageNumber) || 1),
    lastPage,
  );
  const start: number = (pageNumber - 1) * perPage;

  return {
    rows: data.rows.slice(start, start + perPage),
    pageNumber,
  };
}

// A window as the switch's value ("7"), and back; one not offered reads as a week.
export function getEntityWindowOptionValue(windowInDays: number): string {
  return String(windowInDays);
}

export function readEntityWindowOption(
  value: string,
  windowsInDays: ReadonlyArray<number>,
): number {
  const windowInDays: number = Number(value);

  return windowsInDays.includes(windowInDays)
    ? windowInDays
    : DEFAULT_ENTITY_WINDOW_IN_DAYS;
}
