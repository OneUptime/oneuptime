import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The names the Postmortems list (Incidents > Postmortems) is kept under, in
 * a module of their own - no ModelAPI, no React - so the tiles' rules and
 * App tests can read them.
 */

/*
 * Shared by the table's `id`, its `userPreferencesKey`, its saved views and
 * the URL namespace its filter, facet and view state are kept under.
 */
export const POSTMORTEMS_TABLE_ID: string = "postmortems-table";

// The Postmortem Status chip: its key, which is also the column it filters.
export const POSTMORTEM_STATUS_FACET_KEY: string = "postmortemStatus";

export const POSTMORTEM_STATUS_FACET_LABEL: string =
  translationKey("Postmortem Status");
