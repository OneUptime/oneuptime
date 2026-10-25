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
