import { ResponseLink } from "../../../Types/SecurityCase/SecurityCaseResponseLink";
import { SecurityEntity } from "../../../Types/SecurityCase/SecurityEntity";
import { SecurityCaseStepCheckEvidence } from "../../../Types/SecurityCase/SecurityCaseStepCheckEvidence";
import SecurityCaseStepCheckState from "../../../Types/SecurityCase/SecurityCaseStepCheckState";
import { PluralTemplate } from "../../../Types/Translator";

/*
 * The shapes of a case's Response Plan, one for every reader of it: the
 * Dashboard's card draws it, the server checks its steps
 * (Server/Utils/SecurityCase/StepChecks), and OneUptime AI and the mobile
 * app read the same plan (#10340). ResponsePlanBuilder.ts builds it.
 */

// The order a response goes in, and the plan's sections.
export enum ResponsePhase {
  Confirm = "Confirm",
  Contain = "Contain",
  Fix = "Fix",
  Close = "Close",
}

export const RESPONSE_PHASES: ReadonlyArray<ResponsePhase> = [
  ResponsePhase.Confirm,
  ResponsePhase.Contain,
  ResponsePhase.Fix,
  ResponsePhase.Close,
];

// What a step's button does: something OneUptime can already do.
export enum ResponseActionKind {
  AssignToMe = "AssignToMe",
  RunPlaybook = "RunPlaybook",
  AddRuleException = "AddRuleException",
  DeclareIncident = "DeclareIncident",
  MarkContained = "MarkContained",
  CloseCase = "CloseCase",
  // Opens what the action's link says: the traces, the events.
  OpenRoute = "OpenRoute",
}

export interface ResponseAction {
  kind: ResponseActionKind;
  // The button's words: an English key.
  title: string;
  playbookId?: string | undefined;
  detectionRuleId?: string | undefined;
  entity?: SecurityEntity | undefined;
  /*
   * What an OpenRoute action opens, as a descriptor: each reader turns it
   * into its own address (the Dashboard into a route).
   */
  link?: ResponseLink | undefined;
}

// How a step is known to be done.
export enum ResponseStepCompletion {
  // The case itself says so: it is assigned, contained, closed, an incident was declared, a playbook ran.
  ByCase = "ByCase",
  // Somebody ticks it off, and it is kept as one of the case's tasks.
  ByTask = "ByTask",
}

// A sentence of the plan: an English key, and its values as written.
export interface ResponseText {
  template: string | PluralTemplate;
  values: Record<string, string>;
  // Figures, written in the reader's digits where the sentence is drawn.
  numbers?: Record<string, number> | undefined;
  count?: number | undefined;
}

/*
 * What OneUptime found when it checked a step itself (SecurityCaseStepCheck,
 * written by the server's step checks): its state, and the evidence it
 * shows for it.
 */
export interface ResponseStepCheck {
  stepKey: string;
  state: SecurityCaseStepCheckState;
  evidence: SecurityCaseStepCheckEvidence;
  checkedAt?: Date | undefined;
  stateSince?: Date | undefined;
}

export interface ResponseStep {
  // Stable, at most 100 characters: the task that ticks it off keeps it.
  key: string;
  phase: ResponsePhase;
  text: ResponseText;
  // OneUptime AI's own words for the step, drawn as written, in place of text.
  aiText?: string | undefined;
  /*
   * The words the author of the case's rule wrote for the step - one of the
   * rule's own response steps (#9621) - drawn as written, in place of text.
   */
  ruleText?: string | undefined;
  // A line under it: what OneUptime knows that makes the step matter.
  detail?: ResponseText | undefined;
  isDetailWarning?: boolean | undefined;
  // Lines it quotes as written: the false positives a rule names.
  quotes: Array<string>;
  // Done outside OneUptime: OneUptime has no way to do it.
  isOutsideOneUptime: boolean;
  // The value it acts on by hand (an address to block), copied with a click.
  copyValue?: string | undefined;
  action?: ResponseAction | undefined;
  completion: ResponseStepCompletion;
  isDone: boolean;
  // The task that ticked it off, and who and when, when it is one.
  taskId?: string | undefined;
  doneByName?: string | undefined;
  doneAt?: Date | undefined;
  /*
   * What OneUptime found when it checked the step, when it has: a step it
   * verified, or found not needed, is done by that check
   * (isCheckedByOneUptime).
   */
  check?: ResponseStepCheck | undefined;
  isCheckedByOneUptime: boolean;
}

/*
 * Where the case's latest run of a playbook stands, when no run of it has
 * succeeded: held for an approval, still going, or failed.
 */
export enum ResponsePlaybookRunState {
  Waiting = "Waiting",
  Running = "Running",
  Failed = "Failed",
}

// One of the project's playbooks that are on, as the plan reads it.
export interface ResponsePlaybook {
  id: string;
  name: string;
  // The action of each of its steps.
  actions: Array<string>;
}

// One of the case's tasks, as the plan reads it.
export interface ResponseTask {
  id: string;
  responseStepKey: string;
  isDone: boolean;
  doneAt?: Date | undefined;
  doneByName?: string | undefined;
}

export interface ResponsePlan {
  steps: Array<ResponseStep>;
  done: number;
  total: number;
  // Of the steps done, the ones OneUptime checked itself: verified, or found not needed.
  checked: number;
  /*
   * Every step that contains the threat is done, the case is not Contained
   * yet and the project has a status for it: the plan offers to mark it.
   */
  isReadyToMarkContained: boolean;
  /*
   * Every step that contains the threat is one OneUptime verified itself (or
   * found not needed): what moves the case to Contained on its own, when the
   * project lets it (Project.markSecurityCaseContainedWhenVerified). A
   * person's tick, and a step that only looks done, are not enough.
   */
  isContainmentVerified: boolean;
  // The steps OneUptime checked that were done and stopped holding, by key.
  regressedStepKeys: Array<string>;
}
