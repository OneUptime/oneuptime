import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { GLOBAL_RUNNER_MAX_EXECUTION_TIMEOUT_IN_MS } from "Common/Types/Runner/GlobalRunnerWork";

/*
 * What Runbooks -> Runners says about global Runners - the Runners OneUptime
 * runs for every project - and about a project's own (custom) Runners, kept
 * free of React so the page, its tests and App's tests read the same words.
 * Every sentence is wrapped in translationKey() so npm run i18n:extract
 * finds it.
 *
 * The page reads like Monitors -> Settings -> Probes: the global ones on
 * top, read-only; the project's own below, with Create Runner; then the one
 * switch that says whether the project uses the global ones. A server with
 * no global Runner shows the project's own only, as the page always did.
 */

export const GlobalRunnersCopy: {
  globalCardTitle: string;
  globalCardDescription: string;
  // When the project turned global Runners off.
  globalCardDescriptionWhenOff: string;
  /*
   * The Global Runners table with no rows: drawn only when the server stops
   * running them while the page is open (with none, there is no table).
   */
  globalEmptyMessage: string;
  customCardTitle: string;
  customCardDescription: string;
  // The project's own Runners, on a server that has no global Runner.
  onlyCardTitle: string;
  onlyCardDescription: string;
  /*
   * The custom table with no rows, never "No Runners yet": a headline that
   * says what to do, over the card's description of what one is for.
   */
  customEmptyMessage: string;
  onlyEmptyMessage: string;
  /*
   * A master admin, on a server that has no global Runner: one sentence,
   * with the link to the Admin Dashboard's page as its {{location}}.
   */
  addGlobalRunnersHint: string;
  addGlobalRunnersLink: string;
  switchCardTitle: string;
  switchCardDescription: string;
  switchTitle: string;
  switchOnDescription: string;
  switchOffDescription: string;
  switchNote: string;
  turnOffTitle: string;
  turnOffDescription: string;
  turnOffButton: string;
} = {
  globalCardTitle: translationKey("Global Runners"),
  globalCardDescription: translationKey(
    "Runners OneUptime runs for every project. A JavaScript step that does not pick a Runner of its own runs on one, in a sandbox that can reach the internet but not your network.",
  ),
  globalCardDescriptionWhenOff: translationKey(
    "Runners OneUptime runs for every project. This project does not use them: every step runs on a Runner of your own.",
  ),
  globalEmptyMessage: translationKey(
    "Global Runners appear here when OneUptime runs one.",
  ),
  customCardTitle: translationKey("Custom Runners"),
  customCardDescription: translationKey(
    "Runners you install in your own infrastructure, for Bash, SSH and Kubernetes steps, for anything on your network, and to keep every step on your own hosts.",
  ),
  onlyCardTitle: translationKey("Runners"),
  onlyCardDescription: translationKey(
    "Self-hosted Runners that execute Bash and JavaScript runbook steps in your own infrastructure. Each step picks the Runner that should run it.",
  ),
  customEmptyMessage: translationKey("Add a Runner of your own."),
  onlyEmptyMessage: translationKey(
    "Add a Runner to run your runbook steps. Create one, then run the Docker command on a host inside your infrastructure.",
  ),
  addGlobalRunnersHint: translationKey("Add global Runners in {{location}}."),
  addGlobalRunnersLink: translationKey("Admin Dashboard → Global Runners"),
  switchCardTitle: translationKey("Use Global Runners"),
  switchCardDescription: translationKey(
    "Whether steps that do not pick a Runner of their own run on OneUptime's global Runners.",
  ),
  switchTitle: translationKey("Use global Runners"),
  switchOnDescription: translationKey(
    "JavaScript steps that do not pick a Runner of their own run on the global Runners.",
  ),
  switchOffDescription: translationKey(
    "Every step runs on a Runner of your own. A step that does not pick one fails and says so.",
  ),
  switchNote: translationKey(
    "Steps that pick one of your Runners keep it either way.",
  ),
  turnOffTitle: translationKey("Stop using global Runners?"),
  turnOffDescription: translationKey(
    "JavaScript steps that pick no Runner of their own will fail until they pick one of yours, and steps waiting for a global Runner now will not run.",
  ),
  turnOffButton: translationKey("Stop Using Global Runners"),
};

// The project column the switch writes. On by default.
export type UseGlobalRunnersColumn = "useGlobalRunners";

export const USE_GLOBAL_RUNNERS_COLUMN: UseGlobalRunnersColumn =
  "useGlobalRunners";

// The data-testid of the switch.
export const USE_GLOBAL_RUNNERS_SWITCH_TEST_ID: string =
  "use-global-runners-switch";

// The longest a step runs on a global Runner, in minutes, as the page says it.
export const GLOBAL_RUNNER_MAX_MINUTES: number = Math.round(
  GLOBAL_RUNNER_MAX_EXECUTION_TIMEOUT_IN_MS / 60_000,
);

// Where a master admin adds global Runners: the Admin Dashboard's page.
export const ADMIN_GLOBAL_RUNNERS_ROUTE: string = "/settings/global-runners";

export default GlobalRunnersCopy;
