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
  /*
   * When the project has a default Runner: steps that pick no Runner run on
   * it, so a global Runner runs the ones that pick Global Runner.
   */
  globalCardDescriptionWithDefault: string;
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
  /*
   * The card of the project's one switch. Its title and line say what the
   * switch is about and the rule it never changes; the switch's own line
   * says what each position does - neither repeats the other. It covers
   * every Global Runner choice: a runbook step's, and a code repository's
   * (whose AI work runs on a global Runner unless the repository picks one
   * of the project's own Runners).
   */
  switchCardTitle: string;
  switchCardDescription: string;
  switchTitle: string;
  switchOnDescription: string;
  switchOffDescription: string;
  turnOffTitle: string;
  turnOffDescription: string;
  /*
   * The switch's lines and the turn-off question while the project has a
   * default Runner, which runs the steps that pick none.
   */
  switchOnDescriptionWithDefault: string;
  switchOffDescriptionWithDefault: string;
  turnOffDescriptionWithDefault: string;
  turnOffButton: string;
} = {
  globalCardTitle: translationKey("Global Runners"),
  // One line across the card, as Global Probes' is.
  globalCardDescription: translationKey(
    "Runners OneUptime runs for every project. JavaScript steps run on them by default, in a sandbox that reaches the internet only.",
  ),
  globalCardDescriptionWithDefault: translationKey(
    "Runners OneUptime runs for every project. Steps that pick Global Runner run on them, in a sandbox that reaches the internet only.",
  ),
  globalCardDescriptionWhenOff: translationKey(
    "Runners OneUptime runs for every project. This project does not use them, so steps and code repositories run on yours.",
  ),
  globalEmptyMessage: translationKey(
    "Global Runners appear here when OneUptime runs one.",
  ),
  customCardTitle: translationKey("Custom Runners"),
  /*
   * Why a team adds one: the steps a global Runner never runs, and steps
   * that must not leave the team's own hosts - "custom runners if they want
   * more security", in the maintainer's words. Also the line under "Add a
   * Runner of your own" while there are none.
   */
  customCardDescription: translationKey(
    "Runners you install in your own network, for Bash, SSH and Kubernetes steps and for steps that must stay on your hosts.",
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
  switchCardTitle: translationKey("Global Runners in This Project"),
  switchCardDescription: translationKey(
    "Steps and code repositories that pick one of your Runners always run on it.",
  ),
  switchTitle: translationKey("Use global Runners"),
  switchOnDescription: translationKey(
    "JavaScript steps and code repositories that pick no Runner run on a global Runner.",
  ),
  switchOffDescription: translationKey(
    "Every step and code repository runs on one of your Runners. One that picks none does not run.",
  ),
  turnOffTitle: translationKey("Stop using global Runners?"),
  turnOffDescription: translationKey(
    "JavaScript steps and code repositories that pick no Runner stop running until they pick one of yours. Work queued for a global Runner will not run.",
  ),
  switchOnDescriptionWithDefault: translationKey(
    "JavaScript steps and code repositories that pick Global Runner run on a global Runner.",
  ),
  switchOffDescriptionWithDefault: translationKey(
    "Every step and code repository runs on one of your Runners: those that pick none run on the project default.",
  ),
  turnOffDescriptionWithDefault: translationKey(
    "JavaScript steps and code repositories that pick Global Runner stop running until they pick one of yours.",
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
