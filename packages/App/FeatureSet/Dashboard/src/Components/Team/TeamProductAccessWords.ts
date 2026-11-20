import { TeamProductLevel } from "./TeamProductLevels";
import { ProductLevel } from "Common/Types/Product/ProductLevels";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE PRODUCT ACCESS CARD'S WORDS, IN ENGLISH (#10289).
 *
 * Each is looked up where it is drawn: the card's title and description by
 * the Card, a level's name and description and the cleared list's No
 * access by the Dropdown, the notes under a product's name by the card.
 * React-free, so the locale tests read them without drawing the card.
 */

export const PRODUCT_ACCESS_TITLE: string = translationKey("Product Access");

export const PRODUCT_ACCESS_DESCRIPTION: string = translationKey(
  "Give this team a level in the products it works with. A level reaches that product alone. Monitors, Incidents and other areas with roles of their own are given with Add Role.",
);

// A cleared list: the team holds none of the product's levels.
export const NO_ACCESS_TEXT: string = translationKey("No access");

export const LEVEL_TITLES: Record<ProductLevel, string> = {
  [ProductLevel.Viewer]: translationKey("Viewer"),
  [ProductLevel.Member]: translationKey("Member"),
  [ProductLevel.Admin]: translationKey("Admin"),
};

export const LEVEL_DESCRIPTIONS: Record<ProductLevel, string> = {
  [ProductLevel.Viewer]: translationKey(
    "Reads the product, and changes nothing.",
  ),
  [ProductLevel.Member]: translationKey(
    "Also creates, changes and deletes the product's records.",
  ),
  [ProductLevel.Admin]: translationKey(
    "Also changes the product's settings, connections and rules.",
  ),
};

// Why a level is in the list and cannot be picked.
export const LEVEL_NOT_YOURS_TO_GIVE: string = translationKey(
  "Only someone who holds this level, or a Project Owner, can give this level.",
);

// Notes under a product's name: what the card does not change.
export const LEVEL_FROM_CUSTOM_ROLE: Record<ProductLevel, string> = {
  [ProductLevel.Viewer]: translationKey("Viewer through a custom role."),
  [ProductLevel.Member]: translationKey("Member through a custom role."),
  [ProductLevel.Admin]: translationKey("Admin through a custom role."),
};

export const LEVEL_LIMITED_SOMEWHERE: string = translationKey(
  "A level for some records only is in the permissions above.",
);

export const LEVEL_BLOCKED_SOMEWHERE: string = translationKey(
  "A block permission takes a level away.",
);

export const SHOW_ALL_PRODUCTS: string = translationKey("Show All Products");

export const SHOW_FEWER_PRODUCTS: string = translationKey(
  "Show Fewer Products",
);

// Every word the card draws, for the locale tests.
export const PRODUCT_ACCESS_WORDS: ReadonlyArray<string> = [
  PRODUCT_ACCESS_TITLE,
  PRODUCT_ACCESS_DESCRIPTION,
  NO_ACCESS_TEXT,
  ...Object.values(LEVEL_TITLES),
  ...Object.values(LEVEL_DESCRIPTIONS),
  LEVEL_NOT_YOURS_TO_GIVE,
  ...Object.values(LEVEL_FROM_CUSTOM_ROLE),
  LEVEL_LIMITED_SOMEWHERE,
  LEVEL_BLOCKED_SOMEWHERE,
  SHOW_ALL_PRODUCTS,
  SHOW_FEWER_PRODUCTS,
];

// The notes under a product's name, in English.
export const getProductLevelNotes: (
  entry: TeamProductLevel,
) => Array<string> = (entry: TeamProductLevel): Array<string> => {
  const notes: Array<string> = [];

  if (entry.levelFromCustomRoles) {
    notes.push(LEVEL_FROM_CUSTOM_ROLE[entry.levelFromCustomRoles]);
  }

  if (entry.isLimitedSomewhere) {
    notes.push(LEVEL_LIMITED_SOMEWHERE);
  }

  if (entry.isBlockedSomewhere) {
    notes.push(LEVEL_BLOCKED_SOMEWHERE);
  }

  return notes;
};
