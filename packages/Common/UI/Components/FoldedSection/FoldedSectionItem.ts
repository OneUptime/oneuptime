import { getPageAnchorNameForTitle } from "../../Utils/PageAnchor";
import { translationKey } from "../../Utils/TranslateTemplate";

/*
 * What a folded section holds, as its folded header lists it.
 *
 * "The advanced section in the form should be called something better ...
 * show what things are inside it when collapsed (small summary of things)."
 * - the maintainer. A fold that only says "More fields" hides what is in it
 * as well as the old "Advanced" did, so it lists the fields (or, on a page,
 * the cards) it holds, and the ones that are set with what they are set to
 * ("Labels: 2", "Private Incident: On"): a form's More fields as one quiet
 * line ("More fields · Declared At, Labels: 2, Private Incident: On"), a
 * page's More settings as pills and chips on its card. Nobody has to open
 * a fold to learn what is in it or whether anything in it is in force.
 *
 * Forms work their items out from their fields
 * (Forms/Utils/FoldedFormFields.ts); a page names its cards itself
 * (AdvancedPageSection's `items`).
 */

export interface FoldedSectionItem {
  // Stable within the section: a field's name, a card's id.
  key: string;
  // English, as the field or card is titled: looked up when it is drawn.
  title: string;
  /*
   * Holds something other than empty or its default: named with its value,
   * a shade darker on a line and as a chip on a card, so what is in force
   * shows while the section is folded.
   */
  isSet: boolean;
  /*
   * What it is set to, in a few words ("On", "2", "Investigating"). Only
   * for a set item, and only where the value is short and safe to show -
   * never a secret, never a paragraph.
   */
  value?: string | undefined;
  // `value` is an English word to look up ("On"), not text as typed.
  translateValue?: boolean | undefined;
}

/*
 * How many names a folded header lists before it says how many more there
 * are: a "small summary of things", not the form again - and, for More
 * fields, one quiet line of text where it can be ("More fields · Declared
 * At, Labels: 2, Private Incident: On, 3 more"). Set items are always
 * listed - they are what a reader must not miss - and take their places
 * first; the unset names fill the places left, in their order.
 */
export const FOLDED_SECTION_MAX_ITEMS: number = 4;

// Said after the names listed, for the rest: "Labels · 3 more".
export const FOLDED_SECTION_MORE_ITEMS: { one: string; other: string } = {
  one: translationKey("{{count}} more"),
  other: translationKey("{{count}} more"),
};

// A set switch, folded: "Private Incident: On".
export const FOLDED_SECTION_ON: string = translationKey("On");
export const FOLDED_SECTION_OFF: string = translationKey("Off");

export interface FoldedSectionItemsShown {
  // In the order they were given.
  shown: Array<FoldedSectionItem>;
  // Unset items left out, said as "N more".
  hiddenCount: number;
}

export type GetFoldedSectionItemsShownFunction = (
  items: Array<FoldedSectionItem>,
  maxItems?: number,
) => FoldedSectionItemsShown;

/*
 * Which items a folded header lists: every set one, and unset ones in their
 * order in the places the set ones leave, up to the limit. One left over is
 * listed rather than counted - "1 more" takes as much room as the name it
 * stands for.
 */
export const getFoldedSectionItemsShown: GetFoldedSectionItemsShownFunction = (
  items: Array<FoldedSectionItem>,
  maxItems: number = FOLDED_SECTION_MAX_ITEMS,
): FoldedSectionItemsShown => {
  const setCount: number = items.filter((item: FoldedSectionItem) => {
    return item.isSet;
  }).length;

  const unsetCount: number = items.length - setCount;

  // The places the set items leave for the unset ones.
  const room: number = Math.max(0, maxItems - setCount);

  const limit: number = unsetCount - room <= 1 ? unsetCount : room;

  const shown: Array<FoldedSectionItem> = [];
  let unsetShown: number = 0;

  for (const item of items) {
    if (item.isSet) {
      shown.push(item);
      continue;
    }

    if (unsetShown < limit) {
      shown.push(item);
      unsetShown++;
    }
  }

  return {
    shown: shown,
    hiddenCount: unsetCount - unsetShown,
  };
};

export type FoldedSectionItemFromTitleFunction = (
  title: string,
  options?: {
    key?: string | undefined;
    isSet?: boolean | undefined;
    value?: string | undefined;
    translateValue?: boolean | undefined;
  },
) => FoldedSectionItem;

/*
 * A page's way of naming a card in its folded section. Its key is the one
 * the page gives, or else the card's place after its title
 * (getPageAnchorNameForTitle: "Default Bar Color" is "default-bar-color") -
 * the place a card in a page's More settings takes after its title too, so
 * a link can land on it - or the title itself, for a title that makes no
 * place.
 */
export const foldedSectionItem: FoldedSectionItemFromTitleFunction = (
  title: string,
  options?: {
    key?: string | undefined;
    isSet?: boolean | undefined;
    value?: string | undefined;
    translateValue?: boolean | undefined;
  },
): FoldedSectionItem => {
  const item: FoldedSectionItem = {
    key: options?.key || getPageAnchorNameForTitle(title) || title,
    title: title,
    isSet: Boolean(options?.isSet),
  };

  if (item.isSet && options?.value) {
    item.value = options.value;

    if (options.translateValue) {
      item.translateValue = true;
    }
  }

  return item;
};
