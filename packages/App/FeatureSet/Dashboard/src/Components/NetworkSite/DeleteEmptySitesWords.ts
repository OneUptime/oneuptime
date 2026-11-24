import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * What the Sites page's Delete Empty Sites says (DeleteEmptySitesModal,
 * #10188). React-free, so a test reads it. Every sentence is an English
 * translation key, or a plural template translated where it is drawn.
 */

// The names listed under the question; the rest are counted.
export const EMPTY_SITE_NAMES_SHOWN: number = 10;

// The action, in the Sites list's ⋯ menu.
export const DELETE_EMPTY_SITES_ACTION: string =
  translationKey("Delete Empty Sites");

export const DELETE_EMPTY_SITES_TITLE: PluralTemplate = {
  one: "Delete {{count}} Empty Site",
  other: "Delete {{count}} Empty Sites",
};

// A dialog's description: at most 150 characters (ShortDescriptionsGuard).
export const DELETE_EMPTY_SITES_DESCRIPTION: string = translationKey(
  "Sites with no devices and no sites under them, that no endpoint, link, rule or maintenance event uses.",
);

export const DELETE_EMPTY_SITES_QUESTION: PluralTemplate = {
  one: "Are you sure you want to delete {{count}} empty site? This action cannot be undone.",
  other:
    "Are you sure you want to delete {{count}} empty sites? This action cannot be undone.",
};

export const DELETE_EMPTY_SITES_BUTTON: PluralTemplate = {
  one: "Delete {{count}} Site",
  other: "Delete {{count}} Sites",
};

// Nothing to delete: the dialog says why, and has only Close.
export const NO_EMPTY_SITES: string = translationKey(
  "No site is empty. Every site has devices or sites under it, or an endpoint, link, rule or maintenance event uses it.",
);

// What a delete did, in a toast.
export const EMPTY_SITES_DELETED: PluralTemplate = {
  one: "{{count}} empty site deleted",
  other: "{{count}} empty sites deleted",
};

/*
 * Sites asked for that were kept: something went into them, or named
 * them, after the dialog listed them.
 */
export const EMPTY_SITES_KEPT: PluralTemplate = {
  one: "{{count}} site was kept: it is not empty any more.",
  other: "{{count}} sites were kept: they are not empty any more.",
};

// What failed, said first for a failure nobody explained.
export const EMPTY_SITES_NOT_LISTED: string = translationKey(
  "The empty sites could not be listed.",
);
export const EMPTY_SITES_NOT_DELETED: string = translationKey(
  "The empty sites were not deleted.",
);
