import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * What the Sites list's Bulk Actions say (#10188): Set and Clear Parent
 * Site, Set and Clear Default Probe. React-free, so the docs test reads the
 * names. Every sentence is an English translation key, or a plural
 * template translated where it is drawn.
 */

export const SET_PARENT_SITE_ACTION_TITLE: string =
  translationKey("Set Parent Site");
export const CLEAR_PARENT_SITE_ACTION_TITLE: string =
  translationKey("Clear Parent Site");
export const SET_DEFAULT_PROBE_ACTION_TITLE: string =
  translationKey("Set Default Probe");
export const CLEAR_DEFAULT_PROBE_ACTION_TITLE: string = translationKey(
  "Clear Default Probe",
);

// Set Parent Site's dialog.
export const SET_PARENT_SITE_DESCRIPTION: string = translationKey(
  "These sites move under the site you pick, with every site below them, and count toward its health.",
);
export const PARENT_SITE_FIELD_TITLE: string = translationKey("Parent Site");
export const PARENT_SITE_FIELD_PLACEHOLDER: string =
  translationKey("Select a site");

/*
 * A site with no type cannot sit under another, so the dialog asks for the
 * type the sites of the selection that have none take: a site a Meraki
 * import added has none.
 */
export const SITE_TYPE_FIELD_TITLE: string = translationKey("Site Type");
export const SITE_TYPE_FIELD_PLACEHOLDER: string =
  translationKey("Select a site type");
export const SITE_TYPE_FIELD_DESCRIPTION: PluralTemplate = {
  one: "{{count}} of these sites has no type, and a site needs one to sit under another. It gets this type.",
  other:
    "{{count}} of these sites have no type, and a site needs one to sit under another. They get this type, and the others keep theirs.",
};

// Why Set and Clear Parent Site leave a site as it is.
export const ALREADY_UNDER_SITE_REASON: string = translationKey(
  "Already under this site.",
);
export const IS_PICKED_PARENT_REASON: string = translationKey(
  "This is the site picked as the parent.",
);
export const AT_TOP_LEVEL_REASON: string = translationKey(
  "Already at the top level.",
);

export const CLEAR_PARENT_SITE_CONFIRM_TITLE: PluralTemplate = {
  one: "Move {{count}} site to the top level?",
  other: "Move {{count}} sites to the top level?",
};
export const CLEAR_PARENT_SITE_CONFIRM_MESSAGE: PluralTemplate = {
  one: "It moves to the top of the hierarchy with every site below it, and stops counting toward its parent's health.",
  other:
    "They move to the top of the hierarchy with every site below them, and stop counting toward their parents' health.",
};

// Set Default Probe's dialog.
export const SET_DEFAULT_PROBE_DESCRIPTION: string = translationKey(
  "Devices added to these sites, or to the sites below them, without a probe of their own use it. Devices already in them keep their probes.",
);
export const DEFAULT_PROBE_FIELD_TITLE: string =
  translationKey("Default Probe");
export const DEFAULT_PROBE_FIELD_PLACEHOLDER: string =
  translationKey("Select a probe");

// Why Set and Clear Default Probe leave a site as it is.
export const ALREADY_USES_PROBE_REASON: string = translationKey(
  "Already uses this probe.",
);
export const NO_DEFAULT_PROBE_REASON: string = translationKey(
  "Has no default probe.",
);

export const CLEAR_DEFAULT_PROBE_CONFIRM_TITLE: PluralTemplate = {
  one: "Clear the default probe of {{count}} site?",
  other: "Clear the default probe of {{count}} sites?",
};
export const CLEAR_DEFAULT_PROBE_CONFIRM_MESSAGE: PluralTemplate = {
  one: "Devices added to it later without a probe use the default probe of the nearest site above it that has one. Devices already in it keep their probes.",
  other:
    "Devices added to them later without a probe use the default probe of the nearest site above each that has one. Devices already in them keep their probes.",
};
