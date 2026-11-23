import SecurityCaseStepCheckState from "../../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import SecurityCaseVerdict from "../../../../../Types/SecurityCase/SecurityCaseVerdict";
import {
  SecurityCaseAiActionKind,
  SecurityCaseAiActionStatus,
} from "../../../../../Types/SecurityCase/SecurityCaseAi";
import { getSecurityCaseAiActionTitle } from "../../../../../Types/SecurityCase/SecurityCaseAiWords";
import { SecurityEntity } from "../../../../../Types/SecurityCase/SecurityEntity";
import { describeMitreId } from "../../../../../Types/SecurityEvent/MitreAttack";
import { Translator, createTranslator } from "../../../../../Types/Translator";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../../../Utils/Markdown/FeedMarkdown";
import {
  RESPONSE_STEP_KINDS,
  isResponseStepOfKind,
} from "../../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanKeys";
import {
  ResponsePhase,
  ResponsePlan,
  ResponseStep,
} from "../../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanTypes";
import { wordStepCheckSentence } from "../../../../../Utils/SecurityCase/ResponsePlan/StepCheckSentences";

/*
 * ONEUPTIME AI'S CLOSING REPORT OF A CASE (#10352): what happened, the
 * impact, what was done - with the evidence OneUptime's own checks found -
 * what was fixed, and what to watch.
 *
 * Built from the case's own records - its detections, its Response Plan's
 * steps and what their checks found, OneUptime AI's log of what it did -
 * never written by a model: every line is a fact a reader can open on the
 * case, and it says only what is so. It is the report a close asks a person
 * to approve, kept on OneUptime AI's close (SecurityCaseAiAction.report),
 * and the case's closing note and timeline entry once it is closed.
 *
 * In English, as the timeline is: every reader sees the same report. Case
 * values - a title, an address, a user - are text, never markup (mdText).
 */

export interface ClosingReportAction {
  kind: SecurityCaseAiActionKind;
  status: SecurityCaseAiActionStatus;
  // The plan's step it was for: the step's line says it, with its check.
  stepKey?: string | undefined;
  target?: string | undefined;
  doneAt?: Date | undefined;
}

// A block the case made: what it holds, and until when.
export interface ClosingReportBlock {
  value: string;
  expiresAt: Date | null;
}

export interface ClosingReportInput {
  caseNumber: string;
  title: string;
  verdict: SecurityCaseVerdict;
  firstDetectedAt: Date | null;
  lastDetectedAt: Date | null;
  detectionCount: number;
  // The rule that opened the case, by name.
  openingRuleName: string | null;
  entities: Array<SecurityEntity>;
  mitreTactics: Array<string>;
  hasIncident: boolean;
  plan: ResponsePlan;
  actions: Array<ClosingReportAction>;
  blocks: Array<ClosingReportBlock>;
  aiName: string;
}

const ENGLISH: Translator = createTranslator(undefined, "en");

// A time as the report writes it: the same for everyone, in UTC.
export function writeReportTime(time: Date): string {
  return `${time.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function stepWords(step: ResponseStep): string {
  if (step.ruleText) {
    return step.ruleText;
  }

  return typeof step.text.template === "string" && step.text.template
    ? ENGLISH.translateTemplate(step.text.template, step.text.values)
    : step.key;
}

function checkLine(step: ResponseStep): string | null {
  if (!step.check) {
    return null;
  }

  return wordStepCheckSentence({
    sentence: step.check.evidence.sentence,
    translator: ENGLISH,
    writeTime: writeReportTime,
  });
}

function list(lines: Array<MarkdownText>): MarkdownText {
  return FeedMarkdown.join(
    lines.map((line: MarkdownText): MarkdownText => {
      return mdText`- ${line}`;
    }),
    "\n",
  );
}

function findStep(plan: ResponsePlan, kind: string): ResponseStep | undefined {
  return plan.steps.find((step: ResponseStep): boolean => {
    return isResponseStepOfKind(step.key, kind);
  });
}

// Who did a step, as the report says it: OneUptime AI, a person, OneUptime's check.
function doneBy(data: {
  step: ResponseStep;
  aiStepKeys: Set<string>;
  aiName: string;
}): string {
  if (data.aiStepKeys.has(data.step.key)) {
    return data.aiName;
  }

  if (data.step.doneByName) {
    return data.step.doneByName;
  }

  if (data.step.isCheckedByOneUptime) {
    return "OneUptime's check";
  }

  return "the case";
}

export function buildSecurityCaseClosingReport(
  input: ClosingReportInput,
): string {
  const sections: Array<MarkdownText> = [];

  // ----- What happened -----
  const happened: Array<MarkdownText> = [
    input.openingRuleName
      ? mdText`The detection **${input.openingRuleName}** opened ${input.caseNumber}: ${input.title}.`
      : mdText`${input.caseNumber}: ${input.title}.`,
  ];

  if (input.firstDetectedAt && input.lastDetectedAt) {
    happened.push(
      mdText`It fired ${String(input.detectionCount)} time(s), first at ${writeReportTime(input.firstDetectedAt)} and last at ${writeReportTime(input.lastDetectedAt)}.`,
    );
  }

  if (input.entities.length > 0) {
    happened.push(
      mdText`It is about ${FeedMarkdown.join(
        input.entities
          .slice(0, 10)
          .map((entity: SecurityEntity): MarkdownText => {
            return mdText`${FeedMarkdown.code(entity.value)} (${entity.type})`;
          }),
      )}.`,
    );
  }

  if (input.mitreTactics.length > 0) {
    happened.push(
      mdText`ATT&CK: ${input.mitreTactics
        .map((tactic: string): string => {
          return describeMitreId(tactic);
        })
        .join(", ")}.`,
    );
  }

  happened.push(mdText`Verdict: **${input.verdict}**.`);

  sections.push(mdText`### What happened\n\n${list(happened)}`);

  // ----- The impact -----
  const impact: Array<MarkdownText> = [];
  const requests: ResponseStep | undefined = findStep(
    input.plan,
    RESPONSE_STEP_KINDS.requests,
  );
  const incident: ResponseStep | undefined = findStep(
    input.plan,
    RESPONSE_STEP_KINDS.incident,
  );
  const requestsLine: string | null = requests ? checkLine(requests) : null;
  const incidentLine: string | null = incident ? checkLine(incident) : null;

  if (requestsLine) {
    impact.push(mdText`${requestsLine}`);
  }

  if (input.hasIncident) {
    impact.push(mdText`An incident was declared for the case.`);
  } else if (incidentLine) {
    impact.push(mdText`${incidentLine}`);
  }

  if (impact.length === 0) {
    impact.push(
      mdText`OneUptime has no record of the case's requests reaching the app.`,
    );
  }

  sections.push(mdText`### The impact\n\n${list(impact)}`);

  // ----- What was done -----
  const stepKeys: Set<string> = new Set(
    input.plan.steps.map((step: ResponseStep): string => {
      return step.key;
    }),
  );
  const aiStepKeys: Set<string> = new Set<string>();
  const done: Array<MarkdownText> = [];

  for (const action of input.actions) {
    if (
      action.status !== SecurityCaseAiActionStatus.Done ||
      action.kind === SecurityCaseAiActionKind.CloseCase ||
      action.kind === SecurityCaseAiActionKind.HandToPeople ||
      action.kind === SecurityCaseAiActionKind.StepForPeople
    ) {
      continue;
    }

    // A step of the plan says it below, with who did it and its check.
    if (action.stepKey && stepKeys.has(action.stepKey)) {
      aiStepKeys.add(action.stepKey);
      continue;
    }

    done.push(
      mdText`${ENGLISH.translateTemplate(
        getSecurityCaseAiActionTitle({
          kind: action.kind,
          status: action.status,
        }),
        { value: action.target || "", verdict: "" },
      )} - ${input.aiName}${action.doneAt ? `, ${writeReportTime(action.doneAt)}` : ""}.`,
    );
  }

  for (const step of input.plan.steps) {
    if (
      !step.isDone ||
      step.phase === ResponsePhase.Close ||
      step.phase === ResponsePhase.Fix
    ) {
      continue;
    }

    const line: string | null = checkLine(step);
    const by: string = doneBy({ step, aiStepKeys, aiName: input.aiName });

    done.push(
      line
        ? mdText`${stepWords(step)} - ${by}. Checked: ${line}`
        : mdText`${stepWords(step)} - ${by}.`,
    );
  }

  sections.push(
    mdText`### What was done\n\n${
      done.length > 0 ? list(done) : mdText`Nothing was done on the case.`
    }`,
  );

  // ----- What was fixed -----
  const fixed: Array<MarkdownText> = [];

  for (const step of input.plan.steps) {
    if (step.phase !== ResponsePhase.Fix) {
      continue;
    }

    const line: string | null = checkLine(step);

    fixed.push(
      step.isDone
        ? line
          ? mdText`${stepWords(step)} - done. Checked: ${line}`
          : mdText`${stepWords(step)} - done.`
        : mdText`${stepWords(step)} - not done.`,
    );
  }

  sections.push(
    mdText`### What was fixed\n\n${
      fixed.length > 0 ? list(fixed) : mdText`Nothing needed fixing.`
    }`,
  );

  // ----- What to watch -----
  const watch: Array<MarkdownText> = [];

  for (const block of input.blocks) {
    watch.push(
      block.expiresAt
        ? mdText`The block on ${FeedMarkdown.code(block.value)} ends at ${writeReportTime(block.expiresAt)}. If the address comes back, its detection opens a new case.`
        : mdText`The block on ${FeedMarkdown.code(block.value)} stays until someone lifts it.`,
    );
  }

  for (const step of input.plan.steps) {
    if (step.check?.state === SecurityCaseStepCheckState.LooksDone) {
      watch.push(
        mdText`${stepWords(step)}: OneUptime sees it done, but cannot prove it. Watch it.`,
      );
    }
  }

  if (watch.length === 0) {
    watch.push(mdText`Nothing is left to watch on this case.`);
  }

  sections.push(mdText`### What to watch\n\n${list(watch)}`);

  return FeedMarkdown.join(sections, "\n\n").toString();
}
