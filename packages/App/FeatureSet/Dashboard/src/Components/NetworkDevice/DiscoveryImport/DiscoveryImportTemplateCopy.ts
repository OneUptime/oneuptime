import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What the import's Monitoring step calls its monitor templates (OneUptime
 * issue #5145), in a React-free module: the step draws these, and the
 * network device guide is held to them in every docs language
 * (Tests/FeatureSet/Docs/DiscoveryImportTemplatesDocs), so the two cannot
 * drift apart.
 */

/*
 * The one line under "Monitor template" that says which templates are
 * listed, so nobody wonders where theirs went: the kinds a device's monitor
 * can be made from (DEVICE_MONITOR_TEMPLATE_TYPES), named the way the
 * monitor type picker names them.
 */
export const LISTED_TEMPLATE_KINDS_RULE: string = translationKey(
  "Network Device, Ping, IP, Port and NTP templates are listed: other kinds cannot check a device.",
);

// The link beside it, to Monitors > Settings > Templates, in a new tab.
export const MANAGE_TEMPLATES_LINK_TITLE: string =
  translationKey("Manage templates");

/*
 * The list's two groups, when a project has templates of both kinds: the
 * ones whose monitors read each device's polls, then the ones whose
 * monitors check each device's address.
 */
export const POLL_TEMPLATES_GROUP_TITLE: string = translationKey(
  "Network Device templates",
);

export const ADDRESS_TEMPLATES_GROUP_TITLE: string = translationKey(
  "Ping, IP, Port and NTP templates",
);

// A template saved with no name (the API allows one).
export const UNNAMED_TEMPLATE_NAME: string = translationKey("Unnamed template");

/*
 * Why no template can be picked, when the project has none a device's
 * monitor can be made from and the reader may not create the recommended
 * one: who can, and where.
 */
export const NO_DEVICE_MONITOR_TEMPLATE_REASON: string = translationKey(
  "This project has no Network Device, Ping, IP, Port or NTP monitor template, and you may not create one. Ask a project owner or admin to create the recommended one under Network > Settings > Alert Policies, or another under Monitors > Settings > Templates.",
);
