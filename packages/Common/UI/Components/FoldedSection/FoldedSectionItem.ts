import { translationKey } from "../../Utils/TranslateTemplate";

/*
 * What a folded section holds, as its folded header lists it.
 *
 * "The advanced section in the form should be called something better ...
 * show what things are inside it when collapsed (small summary of things)."
 * - the maintainer. A fold that only says "More fields" hides what is in it
 * as well as the old "Advanced" did, so its header lists the fields (or, on
 * a page, the cards) it holds - "Declared At · Initial State · Labels ·
 * Private Incident" - and draws the ones that are set as small chips with
 * what they are set to ("Labels: 2", "Private Incident: On"). Nobody has to
 * open a fold to learn what is in it or whether anything in it is in force.
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
   * Holds something other than empty or its default: drawn as a chip, with
   * its value, so what is in force shows while the section is folded.
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
 * How many unset names a folded header lists before it says how many more
 * there are: a "small summary of things", not the form again. Set items are
 * always listed - they are what a reader must not miss.
 */
export const FOLDED_SECTION_MAX_UNSET_ITEMS: number = 4;

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
  maxUnsetItems?: number,
) => FoldedSectionItemsShown;

/*
 * Which items a folded header lists: every set one, and unset ones in their
 * order up to the limit. One left over is listed rather than counted - "1
 * more" takes as much room as the name it stands for.
 */
export const getFoldedSectionItemsShown: GetFoldedSectionItemsShownFunction = (
  items: Array<FoldedSectionItem>,
  maxUnsetItems: number = FOLDED_SECTION_MAX_UNSET_ITEMS,
): FoldedSectionItemsShown => {
  const unsetCount: number = items.filter((item: FoldedSectionItem) => {
    return !item.isSet;
  }).length;

  const limit: number =
    unsetCount - maxUnsetItems <= 1 ? unsetCount : Math.max(0, maxUnsetItems);

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

// A page's way of naming a card in its folded section.
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
    key: options?.key || title,
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
