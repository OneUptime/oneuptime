import Route from "../../../Types/API/Route";
import Link from "../../../Types/Link";
import Navigation from "../../Utils/Navigation";
import type { LinkAriaCurrent } from "../Link/Link";

/*
 * Which entry of a side menu is the page the user is on, and how that is
 * said to a screen reader.
 *
 * The entry for the page the user is on is lit: a tinted row with a rail
 * beside it. That was all it was, a colour, so a screen reader read every
 * entry of the menu alike and never said which one was open. It is now
 * marked with aria-current, as the nav bar's lit product and a trail's last
 * crumb are.
 */

/*
 * The test id of a menu row's title: its words alone, without the digits of
 * the badge drawn in the same link. Tests read a row's title by it. (It used
 * to be read from the title's `truncate` class, which went when long titles
 * started to wrap instead of being cut short.)
 */
export const SIDE_MENU_ITEM_TITLE_TEST_ID: string = "side-menu-item-title";

export type MenuEntryRoute = Link["to"];

/*
 * The language a menu's words are drawn in, for the element that holds them
 * (its lang attribute): the reader's, where the words were translated, and
 * none - the page's own, English - where they were not.
 *
 * A title or a section heading that does not fit on one line wraps onto a
 * second (hyphens: auto). A word longer than the whole line, a German
 * compound, then breaks where its language hyphenates it and shows a
 * hyphen - "Benachrichtigungsproto-kolle" - where it broke at the edge
 * before, mid-syllable and with nothing to say it goes on: the page itself
 * says lang="en" whatever the reader's language is, and a browser only
 * hyphenates a word in a language it is told.
 */
export function getDrawnLanguage(data: {
  english: string | undefined;
  drawn: string | undefined;
  language: string | undefined;
}): string | undefined {
  if (!data.language || !data.drawn || data.drawn === data.english) {
    return undefined;
  }

  return data.language;
}

/*
 * The shortest word a menu hyphenates. The narrowest menu (a 768 to 1023
 * pixel window) gives a title about 120 pixels beside a badge, some sixteen
 * letters, so a shorter word always has a line to itself and moves there
 * whole. A longer one may not fit any line: a German compound
 * ("Benachrichtigungsprotokolle", Notification Logs) is hyphenated where its
 * language breaks it rather than cut at the menu's edge.
 */
export const SIDE_MENU_HYPHENATED_WORD_LENGTH: number = 14;

// Where a title's words end: spaces, and the hyphens inside a compound.
const WORD_SEPARATOR: RegExp = /[\s\-‐]+/u;

// A word longer than the line breaks at the line's edge rather than spill.
export const SIDE_MENU_WORDS_CLASS_NAME: string = "break-words";

/*
 * ...and one that may be hyphenated: in its language (hyphens: auto), and
 * only inside a word SIDE_MENU_HYPHENATED_WORD_LENGTH letters long or more,
 * five of them either side of the hyphen (hyphenate-limit-chars, which
 * Safari does not read yet).
 */
export const SIDE_MENU_HYPHENATED_WORDS_CLASS_NAME: string =
  "break-words hyphens-auto [hyphenate-limit-chars:14_5_5]";

/*
 * How a menu's words may break when a title or a section heading does not
 * fit on one line. Between words always, and inside a word only when the
 * title is in the reader's language (`lang`: getDrawnLanguage) and holds a
 * word SIDE_MENU_HYPHENATED_WORD_LENGTH letters long or more - and then only
 * inside such a word (hyphenate-limit-chars).
 *
 * Chrome hyphenates only a word that does not fit a line of its own, but
 * Firefox and Safari hyphenate whatever word ends a line: the French Burn
 * Rate Rules read "Règles de taux de consom- / mation" in Firefox, and the
 * German Incoming Call Policies "Richtlinien für einge- / hende Anrufe",
 * where the word fits whole on the next line. English, the words the page
 * itself is in, is never hyphenated: its titles were written to fit.
 */
export function getMenuWordsBreakClassName(data: {
  text: string | undefined;
  lang: string | undefined;
}): string {
  if (!data.lang || !data.text) {
    return SIDE_MENU_WORDS_CLASS_NAME;
  }

  const hasLongWord: boolean = data.text
    .split(WORD_SEPARATOR)
    .some((word: string): boolean => {
      return Array.from(word).length >= SIDE_MENU_HYPHENATED_WORD_LENGTH;
    });

  return hasLongWord
    ? SIDE_MENU_HYPHENATED_WORDS_CLASS_NAME
    : SIDE_MENU_WORDS_CLASS_NAME;
}

/*
 * The page a link leads to, without the query or fragment it carries: an
 * entry whose link also resets a page's state - the network map's
 * "/network/map?site=" - still leads to that page.
 */
export function pageOfLink(to: MenuEntryRoute): MenuEntryRoute {
  if (!(to instanceof Route)) {
    return to;
  }

  const address: string = to.toString();
  let end: number = address.length;

  for (const delimiter of ["?", "#"]) {
    const at: number = address.indexOf(delimiter);

    if (at !== -1 && at < end) {
      end = at;
    }
  }

  return end === address.length ? to : new Route(address.slice(0, end));
}

export interface SideMenuEntryLink {
  link: Link;
  /*
   * The page the entry is lit on, when that is not where it links: one
   * role's page for Roles, one run's page for a runbook's Executions.
   */
  activeRoute?: MenuEntryRoute | undefined;
}

/*
 * Whether a menu entry is lit for the page the user is on, and the
 * aria-current it says so with; undefined when it is not lit.
 *
 * An entry is lit on the page its activeRoute names, else on the page it
 * links to. It is that page ("page") when its link leads there, query and
 * fragment aside. It holds the page ("true", announced as "current") when it
 * is lit for a page under it and its link leads elsewhere: Roles, on one
 * role's page; a runbook's Executions, on one run's page. Saying "current
 * page" there would tell the reader the link opens the page they are on.
 */
export function getSideMenuEntryCurrent(
  entry: SideMenuEntryLink,
): LinkAriaCurrent | undefined {
  if (!Navigation.isOnThisPage(entry.activeRoute || entry.link.to)) {
    return undefined;
  }

  if (!entry.activeRoute || entry.activeRoute === entry.link.to) {
    return "page";
  }

  return Navigation.isOnThisPage(pageOfLink(entry.link.to)) ? "page" : "true";
}
