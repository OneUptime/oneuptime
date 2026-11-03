/*
 * The health pill an Overview drawn with ResourceOverview shows beside its
 * status pill: a database's, by the lines of its engine's recommended
 * alerts. Infrastructure heroes (a host's, a cluster's) draw the same pill
 * themselves; this is its shape for the shared hero.
 *
 * Plain types, free of React, so the page helpers that build a pill (and
 * the App tests that read them) never load the component.
 */

export type ResourceOverviewHealthTone =
  | "positive"
  | "warning"
  | "danger"
  | "neutral";

export interface ResourceOverviewHealth {
  // English ("Healthy", "Health Unknown"): drawn in the reader's language.
  label: string;
  tone: ResourceOverviewHealthTone;
  // What the rules made of it ("degraded"), for the pill's data-health.
  state?: string | undefined;
  // What the health is judged by, in an (i) beside the pill.
  description?: string | undefined;
  // The (i)'s own name, English: "Database Health".
  descriptionLabel?: string | undefined;
}
