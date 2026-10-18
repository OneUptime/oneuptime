import RouteParams from "../Utils/RouteParams";

/*
 * Where pages lived before they moved, relative to their old product's mount.
 * Nothing in the RouteMap points here any more: these exist only so an old
 * link still arrives somewhere, and the route groups forward them.
 *
 * They are kept apart from the route groups so that what reads them (Search,
 * tests) does not load every page of a group to get at a few strings.
 */

/*
 * The Runner pages moved from Project Settings into Runbooks. Relative to
 * …/settings/.
 */
export const MOVED_RUNNER_SETTINGS_PATHS: {
  runners: string;
  runnerView: string;
  runnerCredentials: string;
} = {
  runners: "runners",
  runnerView: `runners/${RouteParams.ModelID}`,
  runnerCredentials: "runner-credentials",
};

/*
 * Incident forms became Forms (Incidents > Settings > Forms). Relative to
 * …/incidents/.
 */
export const MOVED_INCIDENT_FORM_PATHS: { forms: string; formView: string } = {
  forms: "settings/forms",
  formView: `settings/forms/${RouteParams.ModelID}`,
};

/*
 * Huntress connections (Incidents > Integrations > Huntress) became
 * workflows with a Huntress Incident Report trigger, each keeping its
 * connection's id: the list forwards to Workflows, and a connection's page
 * to its workflow. Relative to …/incidents/.
 */
export const MOVED_HUNTRESS_PATHS: {
  connections: string;
  connectionView: string;
} = {
  connections: "integrations/huntress",
  connectionView: `integrations/huntress/${RouteParams.ModelID}`,
};

/*
 * The AI settings page and the Auto Remediation Rules moved from the
 * Settings and Rules sections into the AI section of the Incidents and Alerts
 * menus (…/ai/settings and …/ai/auto-remediation-rules). Then the rules page
 * folded into the AI settings page itself, under More settings, next to the
 * investigation rules: all three old rules URLs lead to …/ai/settings now.
 * Relative to …/incidents/ and to …/alerts/: both products used the same
 * paths.
 */
export const MOVED_AI_SECTION_PATHS: {
  aiSettings: string;
  autoRemediationRules: string;
  aiAutoRemediationRules: string;
} = {
  aiSettings: "settings/ai",
  autoRemediationRules: "settings/auto-remediation-rules",
  aiAutoRemediationRules: "ai/auto-remediation-rules",
};

/*
 * Incidents and Alerts each had a "Documentation" page under Episodes in
 * their side menus: a manual of how episodes and grouping rules work, drawn
 * in the product, that said what the docs pages say. The docs are the one
 * place for it now; each episode list links there (View Documentation), and
 * the old address forwards to that list. Relative to …/incidents/ and to
 * …/alerts/: both products used the same path.
 */
export const MOVED_EPISODE_DOCS_PATH: string = "episodes/documentation";
