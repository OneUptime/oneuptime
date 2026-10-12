import { WORKFLOW_ENABLED_SWITCH_LABEL } from "../../../Types/Workflow/WorkflowEnabled";
import { translationKey } from "../../Utils/TranslateTemplate";

/*
 * Every sentence the dashboard shows about a workflow that is turned off, and
 * about a run started while it was: the notice above the Builder's canvas,
 * the Enabled switch in its toolbar, the note in the Run Workflow panel, and
 * how a test run is marked in the run lists and in the run itself.
 *
 * Off pauses the workflow's trigger, not a person testing it from the
 * Builder (Types/Workflow/WorkflowEnabled), so the words say exactly that.
 * They used to say the workflow "can't be run or tested until you turn it
 * on", and a dialog asked to turn it on before Run Workflow would go - which
 * let its trigger loose just to try it once.
 *
 * Each sentence is looked up whole in the Dashboard's locale files, never
 * assembled from translated words - the notice's two sentences included,
 * which are one key per case rather than two keys joined with a space (in
 * Japanese and Chinese a sentence ends without one). A sentence with a value
 * in it has the value as a {{placeholder}}, so every language puts the
 * person's name, or the Run Workflow button's, where its own grammar wants
 * it. WorkflowEnabledI18n.test.tsx holds all seventeen locales to having
 * every one of them, placeholders included.
 */
export const WorkflowEnabledCopy: {
  readonly switchLabel: string;
  readonly noticeTitle: string;
  readonly noticeBody: string;
  readonly noticeBodyCanTest: string;
  readonly noticeBodyForOthers: string;
  readonly noticeBodyForOthersCanTest: string;
  readonly turnOnWorkflow: string;
  readonly runPanelTestRunNote: string;
  readonly testRun: string;
  readonly testRunStartedBy: string;
  readonly testRunStartedByHand: string;
} = {
  // The switch's own name, as the Overview's Workflow Details call it too.
  switchLabel: WORKFLOW_ENABLED_SWITCH_LABEL,
  noticeTitle: translationKey("This workflow is off"),
  /*
   * What off means, said to the person reading it. Four cases, by whether
   * they may turn the workflow on (the notice's Turn on workflow button) and
   * whether they may run it (Run Workflow works while it is off). Someone who
   * may not turn it on is told who can, in the same sentence, rather than
   * "until you turn it on" followed by "only people who can edit it can".
   * {{button}} is the Run Workflow button's own label, drawn in bold.
   */
  noticeBody: translationKey("Its trigger is paused until you turn it on."),
  noticeBodyCanTest: translationKey(
    "Its trigger is paused until you turn it on. You can still test it with {{button}}.",
  ),
  noticeBodyForOthers: translationKey(
    "Its trigger is paused until someone who can edit this workflow turns it on.",
  ),
  noticeBodyForOthersCanTest: translationKey(
    "Its trigger is paused until someone who can edit this workflow turns it on. You can still test it with {{button}}.",
  ),
  turnOnWorkflow: translationKey("Turn on workflow"),
  /*
   * In the Run Workflow panel, before anything runs: a test run is not a dry
   * run, and off does not make it one.
   */
  runPanelTestRunNote: translationKey(
    "This workflow is off, so this is a test run. Every step runs for real: anything it sends, writes or deletes actually happens.",
  ),
  // The pill in the run lists, and the note at the top of a run.
  testRun: translationKey("Test run"),
  testRunStartedBy: translationKey(
    "Started by {{person}} while this workflow was off.",
  ),
  // When the person who started it can no longer be read.
  testRunStartedByHand: translationKey(
    "Started by hand while this workflow was off.",
  ),
};
