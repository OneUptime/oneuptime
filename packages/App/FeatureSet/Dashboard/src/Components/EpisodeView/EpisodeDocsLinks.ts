/*
 * Where the episode lists send someone who wants to read how episodes work:
 * the docs pages, from the list's "View Documentation" (its ⋯ menu) and
 * from its empty state.
 *
 * Incidents and Alerts used to carry a "Documentation" page of their own
 * under Episodes in their side menus: a long manual drawn in the product
 * that said what these docs pages say, and drifted from them (it named
 * template variables and a default assignee the engines no longer read).
 * One place to read it now - the docs - and the old addresses forward to
 * the episode lists (MOVED_EPISODE_DOCS_PATHS), which link here.
 *
 * Kept free of React, so App/Tests can read these paths.
 */
export const INCIDENT_EPISODES_DOCS_PATH: string = "/docs/incidents/episodes";

export const ALERT_EPISODES_DOCS_PATH: string = "/docs/alerts/episodes";
