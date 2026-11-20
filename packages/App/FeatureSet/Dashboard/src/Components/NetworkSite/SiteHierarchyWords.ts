import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * What the Sites page's Hierarchy says (SiteHierarchyTree, #10188). React-
 * free, so a test reads it. Every sentence is an English translation key,
 * or a plural template translated where it is drawn.
 */

export const HIERARCHY_TITLE: string = translationKey("Hierarchy");

export const HIERARCHY_DESCRIPTION: string = translationKey(
  "Your sites as the tree they roll up through — status and device counts include everything below each site.",
);

export const SHOW_HIERARCHY: string = translationKey("Show Hierarchy");
export const HIDE_HIERARCHY: string = translationKey("Hide Hierarchy");

export const HIERARCHY_SEARCH_PLACEHOLDER: string = translationKey(
  "Search sites by name",
);

export const HIDE_EMPTY_SITES: string = translationKey(
  "Hide sites with no devices",
);

// The tree's size, on one line: "700 sites · 9 at the top level".
export const HIERARCHY_SITE_COUNT: PluralTemplate = {
  one: "{{count}} site",
  other: "{{count}} sites",
};
export const HIERARCHY_TOP_LEVEL_COUNT: PluralTemplate = {
  one: "{{count}} at the top level",
  other: "{{count}} at the top level",
};

// What a search found.
export const HIERARCHY_MATCH_COUNT: PluralTemplate = {
  one: "{{count}} site matches",
  other: "{{count}} sites match",
};
export const HIERARCHY_NO_MATCH: string = translationKey(
  "No site matches {{search}}.",
);

// Every site hidden, as none holds a device.
export const HIERARCHY_ALL_EMPTY: string = translationKey(
  "No site holds a device yet.",
);

// The sites of a level past the first page.
export const HIERARCHY_SHOW_MORE: PluralTemplate = {
  one: "Show {{count}} more site",
  other: "Show {{count}} more sites",
};

// A site's own devices and everything below it.
export const HIERARCHY_DEVICE_COUNT: PluralTemplate = {
  one: "{{count}} device",
  other: "{{count}} devices",
};

// The sites of one level drawn before Show more.
export const HIERARCHY_PAGE_SIZE: number = 50;

// Where the reader's choice to show the hierarchy is remembered.
export const HIERARCHY_OPEN_STORAGE_KEY: string =
  "network-sites-hierarchy-open";
