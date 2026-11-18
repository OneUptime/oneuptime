import { PluralTemplate } from "Common/Types/Translator";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE WORDS OF PRODUCTS THAT FIT THE PROJECT (issue #6814): Project
 * Settings > Products, the products menu's More products row, Home's line
 * about a hidden product with data, and the pin beside a product page's
 * title.
 *
 * Kept free of React so the components and App/Tests read these exact
 * strings. Every sentence is wrapped in translationKey() so npm run
 * i18n:extract finds it.
 */

export const ProductsSettingsCopy: {
  cardTitle: string;
  cardDescription: string;
  hiddenExplanation: string;
  showEveryProduct: string;
  shownCount: PluralTemplate;
  alwaysShown: string;
  inUse: string;
  notSetUp: string;
  lockedReason: string;
} = {
  cardTitle: translationKey("Products"),
  cardDescription: translationKey(
    "Choose the products this project shows in its Products menu, on Home and in Search's list. A switch on shows the product.",
  ),
  hiddenExplanation: translationKey(
    "A hidden product is not switched off: it moves under More products at the foot of the menu, Search still finds it, its pages keep working and its data keeps arriving.",
  ),
  showEveryProduct: translationKey("Show Every Product"),
  shownCount: {
    one: "{{shown}} of {{count}} shown",
    other: "{{shown}} of {{count}} shown",
  },
  alwaysShown: translationKey("Always shown"),
  inUse: translationKey("In use"),
  notSetUp: translationKey("Not set up"),
  lockedReason: translationKey(
    "Only someone who may edit the project can choose the products it shows.",
  ),
};

export const HiddenProductsWithDataCopy: {
  sentence: PluralTemplate;
  description: PluralTemplate;
  showOne: string;
  showSeveral: string;
  keepHidden: string;
} = {
  sentence: {
    one: "{{products}} is hidden in this project and has data.",
    other: "{{products}} are hidden in this project and have data.",
  },
  description: {
    one: "Data started arriving after it was hidden. Show it in the menu, or keep it hidden: it works either way.",
    other:
      "Data started arriving after they were hidden. Show them in the menu, or keep them hidden: they work either way.",
  },
  showOne: translationKey("Show It"),
  showSeveral: translationKey("Show Them"),
  keepHidden: translationKey("Keep Hidden"),
};

export const HiddenProductsMenuCopy: {
  note: string;
  chooseProducts: string;
} = {
  note: translationKey(
    "Hidden in this project. Search still finds them, and their pages work.",
  ),
  chooseProducts: translationKey("Choose products"),
};

// The data-testids, for the components and their suites.
export const PRODUCTS_SETTINGS_TEST_ID: string = "products-settings";
// Monitors' row with the Monitor Groups switch under it (#7324).
export const MONITORS_WITH_GROUPS_TEST_ID: string =
  "products-settings-monitors-with-groups";
export const SHOW_EVERY_PRODUCT_TEST_ID: string = "products-settings-show-all";
export const HIDDEN_PRODUCTS_WITH_DATA_TEST_ID: string =
  "home-hidden-products-with-data";
export const getProductSwitchTestId: (product: string) => string = (
  product: string,
): string => {
  return `product-switch-${product}`;
};
