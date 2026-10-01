import { WORKFLOW_ENABLED_SWITCH_LABEL } from "../../../Types/Workflow/WorkflowEnabled";

/*
 * Every sentence the Builder shows about a workflow that is turned off: the
 * notice above the canvas, the Enabled switch in the toolbar, and the dialog
 * that turns the workflow on when someone runs it, or one of its steps,
 * while it is off.
 *
 * Each is looked up whole in the Dashboard's locale files, never assembled
 * from translated words. A sentence with a value in it has the value as a
 * {{placeholder}} and goes through translateTemplate, so every language puts
 * the step's name where its own grammar wants it.
 * WorkflowEnabledI18n.test.ts holds all seventeen locales to having every
 * one of them, placeholders included.
 */
export const WorkflowEnabledCopy: {
  readonly switchLabel: string;
  readonly noticeTitle: string;
  readonly noticeBody: string;
  readonly turnOnWorkflow: string;
  readonly onlyEditorsCanTurnOn: string;
  readonly promptTitle: string;
  readonly promptRunStep: string;
  readonly promptRunWorkflow: string;
  readonly promptTrigger: string;
  readonly promptWhereTheSwitchIs: string;
  readonly turnOnAndRunStep: string;
  readonly turnOnAndRun: string;
  readonly promptCannotTurnOnTitle: string;
  readonly promptCannotTurnOn: string;
  readonly close: string;
} = {
  // The switch's own name, as the Overview's Workflow Details call it too.
  switchLabel: WORKFLOW_ENABLED_SWITCH_LABEL,
  noticeTitle: "This workflow is off",
  noticeBody:
    "Its trigger is ignored and it can't be run or tested until you turn it on.",
  turnOnWorkflow: "Turn on workflow",
  onlyEditorsCanTurnOn:
    "Only people who can edit this workflow can turn it on.",
  promptTitle: "Turn on this workflow?",
  promptRunStep:
    'This workflow is off, so "{{step}}" can\'t run. Turn the workflow on to run this step now.',
  promptRunWorkflow:
    "This workflow is off, so it can't run. Turn it on to run it now.",
  promptTrigger: "Once it's on, its {{trigger}} trigger starts it too.",
  promptWhereTheSwitchIs:
    "You can turn it off again with the Enabled switch above the canvas.",
  turnOnAndRunStep: "Turn on and run step",
  turnOnAndRun: "Turn on and run",
  promptCannotTurnOnTitle: "This workflow is off",
  promptCannotTurnOn:
    "This workflow is off, so it can't run. Only people who can edit this workflow can turn it on.",
  close: "Close",
};
