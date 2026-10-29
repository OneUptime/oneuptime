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
 * …/settings/. Runner Credentials (later AI Access) is gone: its old address
 * forwards to Runbooks > Runners, as its newer one does
 * (MOVED_RUNNER_CREDENTIALS_PATH).
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
 * Runbook secrets were merged into runbook variables: Runbooks > Settings >
 * Secrets is Runbooks > Settings > Global Variables now. Relative to
 * …/runbooks/.
 */
export const MOVED_RUNBOOK_SECRETS_PATH: string = "settings/secrets";

/*
 * Runbooks > Runners > AI Access - the runbook credentials OneUptime AI's
 * commands reached a host or a cluster with through a Runner - is gone:
 * hosts and Kubernetes clusters have AI agents of their own, and runbook
 * steps sign in with runbook variables. Its address forwards to Runbooks >
 * Runners, the section it lived in. Relative to …/runbooks/.
 */
export const MOVED_RUNNER_CREDENTIALS_PATH: string = "runner-credentials";

/*
 * Users moved out of Project Settings to a page of their own (Users, and a
 * person under it). The server kept linking every person it names - in feed
 * entries, Slack and Microsoft Teams messages and emails - to their old
 * page (…/settings/users/:id) for a long time after, so years of stored
 * entries and posted messages point there: the old addresses forward to
 * the person, and the old list to Users. Relative to …/settings/.
 */
export const MOVED_USERS_SETTINGS_PATHS: {
  users: string;
  userView: string;
  userViewPage: string;
} = {
  users: "users",
  userView: `users/${RouteParams.ModelID}`,
  userViewPage: `users/${RouteParams.ModelID}/*`,
};

/*
 * Project Settings > Security > OIDC folded into SSO: one page for single
 * sign-on, the OpenID Connect providers under the SAML ones, with one test
 * link and the Require SSO for Login switch both kinds meet. Relative to
 * …/settings/.
 */
export const MOVED_OIDC_SETTINGS_PATH: string = "oidc";

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

/*
 * An incoming call policy had a "Documentation" page in its side menu: a
 * manual of how incoming calls are routed, drawn in the product, that said
 * what the docs page (/docs/on-call/incoming-call-policy) says - and had
 * drifted from it (it offered teams, which a rule cannot ring). The docs are
 * the one place for it now; the policy list links there (View
 * Documentation), and the old address forwards to the policy's Overview,
 * keeping its id. Relative to …/on-call-duty/.
 */
export const MOVED_INCOMING_CALL_POLICY_DOCS_PATH: string = `incoming-call-policies/${RouteParams.ModelID}/docs`;

/*
 * Tasks became Code: the request box and every task first, the connected
 * repositories beside them, and a task's page its conversation (…/code).
 * The two old products' addresses forward there. Relative to the project's
 * dashboard (…/dashboard/:projectId/).
 */
export const MOVED_CODE_ROOT_PATHS: { tasks: string; repositories: string } = {
  tasks: "ai/agents",
  repositories: "code-repository",
};

/*
 * The old Tasks pages, relative to …/ai/agents/: a task's Overview, Logs,
 * Pull Requests and Delete pages. They forward to its conversation (its
 * Logs to its Log page), keeping its id; the list forwards to Code.
 */
export const MOVED_TASK_PATHS: {
  view: string;
  logs: string;
  pullRequests: string;
  delete: string;
} = {
  view: `${RouteParams.ModelID}`,
  logs: `${RouteParams.ModelID}/logs`,
  pullRequests: `${RouteParams.ModelID}/pull-requests`,
  delete: `${RouteParams.ModelID}/delete`,
};

/*
 * The old Code Repositories pages, relative to …/code-repository/: a
 * repository's Overview, Settings and Delete pages, keeping its id. The
 * list forwards to Code's Repositories.
 */
export const MOVED_REPOSITORY_PATHS: {
  view: string;
  settings: string;
  delete: string;
} = {
  view: `${RouteParams.ModelID}`,
  settings: `${RouteParams.ModelID}/settings`,
  delete: `${RouteParams.ModelID}/delete`,
};
