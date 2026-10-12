import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * What the Devices list's site, role and vendor template actions, and the
 * discovery import's vendor template switch, are called - in a React-free
 * module, so the guides can be held to the names a reader will see
 * (Tests/FeatureSet/Docs/NetworkBulkAssignDocs) and the hooks and the pages
 * cannot drift from them.
 */

export const SET_SITE_ACTION_TITLE: string = translationKey("Set Site");

export const CLEAR_SITE_ACTION_TITLE: string = translationKey("Clear Site");

export const SET_DEVICE_ROLE_ACTION_TITLE: string =
  translationKey("Set Device Role");

export const CLEAR_DEVICE_ROLE_ACTION_TITLE: string =
  translationKey("Clear Device Role");

export const APPLY_VENDOR_TEMPLATE_ACTION_TITLE: string = translationKey(
  "Apply Vendor Template",
);

/*
 * The discovery Review dialog's switch, counted by the SNMP hosts it is about
 * (Pages/NetworkDevice/Discovery).
 */
export const IMPORT_VENDOR_TEMPLATES_TOGGLE_TITLE: PluralTemplate = {
  one: "Apply each SNMP host's vendor template on its first poll (recommended) — {{count}} host",
  other:
    "Apply each SNMP host's vendor template on its first poll (recommended) — {{count}} hosts",
};
