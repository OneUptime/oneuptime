/*
 * A workflow's Enabled switch, stored as Workflow.isEnabled, decides whether
 * anything starts the workflow on its own. New workflows start turned off,
 * and so do duplicated and imported ones, so nearly everyone meets the off
 * state, usually while building a workflow they want to try out.
 *
 * Off pauses what starts a workflow without a person: its trigger - a
 * schedule, a OneUptime event, an incoming email, a call to its webhook URL -
 * and other workflows' Execute Workflow steps. That is what off is for: a
 * workflow is built without its trigger firing on real events, and a live one
 * is paused without being deleted.
 *
 * Off does not stop a person testing the workflow from its Builder. "Why do I
 * have to enable a workflow in order to test run it?" - the maintainer, after
 * the Builder asked them to turn a workflow on, letting its trigger loose,
 * just to try it once. So Run Workflow and Run just this step work whether
 * the workflow is on or off. A run started while it is off is a test run:
 * its steps run for real, as in any run, and the run says it was a test, and
 * who started it, so it is never mistaken for one its trigger started
 * (WorkflowLog.isTestRun and startedByUser).
 *
 * The switch is called "Enabled" wherever it is drawn: at the top of the
 * Builder, in the Overview's Workflow Details, and as a column of the
 * Workflows list. The messages name it, so a reader knows what to look for.
 */

// The switch's name, as the Builder's toolbar and the Overview draw it.
export const WORKFLOW_ENABLED_SWITCH_LABEL: string = "Enabled";

/*
 * The server's answer when something other than a person tries to start a
 * workflow that is off (App/FeatureSet/Workflow/Services/QueueWorkflow.ts).
 * In practice that is a call to its webhook URL, so it is read in a webhook
 * sender's delivery log, or by a script calling the URL, where it is the only
 * explanation anyone gets. So it says what is wrong, what to do about it,
 * and where the switch is.
 */
export const WORKFLOW_TURNED_OFF_MESSAGE: string = `This workflow is turned off, so its trigger can't start it. Turn it on with the ${WORKFLOW_ENABLED_SWITCH_LABEL} switch at the top of its Builder, then try again.`;

export type GetChildWorkflowTurnedOffMessageFunction = (data: {
  workflowId: string;
  workflowName?: string | null | undefined;
}) => string;

/*
 * The same refusal as an Execute Workflow step reports it, in the run of the
 * workflow that called the one that is off. "This workflow is turned off"
 * would read there as the calling workflow, which is plainly running, so the
 * message names the workflow it called: by name, or by ID when it has none.
 *
 * A step of a test run is refused the same way. From the called workflow's
 * side, a call from another workflow is not a person testing it, and a
 * workflow that is off is not started by anything but a person.
 */
export const getChildWorkflowTurnedOffMessage: GetChildWorkflowTurnedOffMessageFunction =
  (data: {
    workflowId: string;
    workflowName?: string | null | undefined;
  }): string => {
    const name: string = (data.workflowName || "").trim();
    const workflow: string = name ? `"${name}"` : data.workflowId;

    return `The workflow ${workflow} is turned off, so this step could not start it. Turn it on with the ${WORKFLOW_ENABLED_SWITCH_LABEL} switch at the top of its Builder.`;
  };

/*
 * What a trigger's step help says under "Testing it", after how to start a
 * run with Run Workflow: that the workflow needs no turning on first. The
 * trigger itself - a call to the URL, an email to the address, the schedule,
 * a OneUptime event - starts it only once it is on, and the help says so
 * wherever it offers that as a way to test (Documentation/
 * TriggerDocumentation.ts and DatabaseDocumentation.ts).
 */
export const WORKFLOW_TEST_WHILE_OFF_HELP: string =
  "This works while the workflow is still off, as a test run.";

/*
 * A person's name as a run's log quotes it: on one line, and not so long
 * that it buries the log. The name is the person's own to set, so it never
 * gets to start a line of its own that could read as one the runner wrote.
 */
export const WORKFLOW_TEST_RUN_STARTER_MAX_LENGTH: number = 100;

const WHITESPACE_RUN: RegExp = /\s+/g;

export type GetWorkflowTestRunStarterFunction = (
  name: string | null | undefined,
) => string;

export const getWorkflowTestRunStarter: GetWorkflowTestRunStarterFunction = (
  name: string | null | undefined,
): string => {
  const oneLine: string = (typeof name === "string" ? name : "")
    .replace(WHITESPACE_RUN, " ")
    .trim();

  // Cut by characters, not UTF-16 units, so no letter is split in half.
  const characters: Array<string> = Array.from(oneLine);

  if (characters.length <= WORKFLOW_TEST_RUN_STARTER_MAX_LENGTH) {
    return oneLine;
  }

  return `${characters
    .slice(0, WORKFLOW_TEST_RUN_STARTER_MAX_LENGTH - 1)
    .join("")
    .trimEnd()}…`;
};

export type GetWorkflowTestRunLogLineFunction = (data: {
  startedBy?: string | null | undefined;
}) => string;

/*
 * The first line a test run's log has, under the time the runner stamps on
 * every line: what kind of run this is, and who started it. It stays with the
 * log wherever the log goes - the Full Log tab, Copy log, a downloaded .txt -
 * so a test run is never read as one its trigger started.
 */
export const getWorkflowTestRunLogLine: GetWorkflowTestRunLogLineFunction =
  (data: { startedBy?: string | null | undefined }): string => {
    const startedBy: string = getWorkflowTestRunStarter(data.startedBy);

    return startedBy
      ? `Test run, started by ${startedBy} while this workflow is turned off.`
      : "Test run, started by hand while this workflow is turned off.";
  };
