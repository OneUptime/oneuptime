/*
 * A workflow runs only while it is turned on: its Enabled switch, stored as
 * Workflow.isEnabled. New workflows start turned off, and so do duplicated
 * and imported ones, so nearly everyone meets the off state, usually the
 * first time they try out a workflow they have just built.
 *
 * Nothing runs a workflow that is off. Its trigger is ignored, and Run
 * Workflow, Run just this step, its webhook URL and other workflows' Execute
 * Workflow steps are all refused. That is deliberate: off is how a workflow
 * is built without its trigger firing on real events, and how one is paused.
 * What was wrong was the refusal, "This workflow is not enabled", which said
 * neither how to turn the workflow on nor where. The messages here say both.
 *
 * The switch is called "Enabled" wherever it is drawn: at the top of the
 * Builder, in the Overview's Workflow Details, and as a column of the
 * Workflows list. The messages name it, so a reader knows what to look for.
 */

// The switch's name, as the Builder's toolbar and the Overview draw it.
export const WORKFLOW_ENABLED_SWITCH_LABEL: string = "Enabled";

/*
 * The server's answer when something tries to run a workflow that is off
 * (App/FeatureSet/Workflow/Services/QueueWorkflow.ts). It is read in more
 * places than the Builder: a webhook sender's delivery log shows it as the
 * response body, and so does a script calling the workflow's URL. So it says
 * what is wrong, what to do about it, and where the switch is.
 */
export const WORKFLOW_TURNED_OFF_MESSAGE: string = `This workflow is turned off, so it can't run. Turn it on with the ${WORKFLOW_ENABLED_SWITCH_LABEL} switch at the top of its Builder, then try again.`;

export type GetChildWorkflowTurnedOffMessageFunction = (data: {
  workflowId: string;
  workflowName?: string | null | undefined;
}) => string;

/*
 * The same refusal as an Execute Workflow step reports it, in the run of the
 * workflow that called the one that is off. "This workflow is turned off"
 * would read there as the calling workflow, which is plainly running, so the
 * message names the workflow it called: by name, or by ID when it has none.
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
