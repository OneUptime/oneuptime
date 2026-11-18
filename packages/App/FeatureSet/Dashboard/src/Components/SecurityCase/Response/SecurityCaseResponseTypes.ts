import Route from "Common/Types/API/Route";
import { SecurityEntity } from "Common/Types/SecurityCase/SecurityEntity";
import { PluralTemplate } from "Common/UI/Utils/TranslateTemplate";

/*
 * The shapes of a case's Response Plan (SecurityCaseResponsePlan.ts builds
 * it, SecurityCaseResponsePlanCard.tsx draws it), apart from both so the
 * plan, its words and its card read them alike.
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
  OpenRoute = "OpenRoute",
}

export interface ResponseAction {
  kind: ResponseActionKind;
  // The button's words: an English key.
  title: string;
  playbookId?: string | undefined;
  detectionRuleId?: string | undefined;
  entity?: SecurityEntity | undefined;
  route?: Route | undefined;
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

export interface ResponseStep {
  // Stable, at most 100 characters: the task that ticks it off keeps it.
  key: string;
  phase: ResponsePhase;
  text: ResponseText;
  // OneUptime AI's own words for the step, drawn as written, in place of text.
  aiText?: string | undefined;
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
  /*
   * Every step that contains the threat is done, the case is not Contained
   * yet and the project has a status for it: the plan offers to mark it.
   */
  isReadyToMarkContained: boolean;
}
