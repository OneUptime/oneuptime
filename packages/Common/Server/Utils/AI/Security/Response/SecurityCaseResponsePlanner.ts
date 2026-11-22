import OneUptimeDate from "../../../../../Types/Date";
import {
  SECURITY_CASE_AI_HAND_OFF_STEP_KEY,
  SECURITY_CASE_AI_PRIORITY_STEP_KEY,
  SECURITY_CASE_AI_QUIET_WINDOW_HOURS,
  SecurityCaseAiActionKind,
  SecurityCaseAiActionReason,
  SecurityCaseAiActionStatus,
  SecurityCaseAiDecision,
  SecurityCaseAiDecisionKind,
  SecurityCaseAiLimits,
  SecurityCaseAiMode,
  SecurityCaseHandOffReason,
  decideSecurityCaseAiAction,
  getSecurityCaseAiClosingVerdict,
  isDismissingVerdict,
} from "../../../../../Types/SecurityCase/SecurityCaseAi";
import SecurityCaseAiVerdict from "../../../../../Types/SecurityCase/SecurityCaseAiVerdict";
import SecurityCaseStage from "../../../../../Types/SecurityCase/SecurityCaseStage";
import SecurityCaseStepCheckState from "../../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import SecurityCaseVerdict from "../../../../../Types/SecurityCase/SecurityCaseVerdict";
import { SecurityEntity } from "../../../../../Types/SecurityCase/SecurityEntity";
import { SecurityCaseAiTrackRecord } from "../../../../../Types/SecurityCase/SecurityCaseAiActionEvidence";
import {
  RESPONSE_STEP_KINDS,
  isResponseStepOfKind,
} from "../../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanKeys";
import {
  ResponseActionKind,
  ResponsePhase,
  ResponsePlan,
  ResponseStep,
  ResponseStepCheck,
} from "../../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanTypes";

/*
 * WHAT ONEUPTIME AI DOES NEXT ON A CASE IT WORKS (#10352): one look's plan,
 * worked out from the case's Response Plan, what OneUptime's own checks
 * found of its steps, OneUptime AI's log of the case so far and what the
 * project lets it do. Pure: the responder reads everything first
 * (SecurityCaseResponseLook) and carries the plan out through its toolkit
 * (SecurityCaseResponseToolkit).
 *
 * Every open step, most urgent first - Confirm, Contain, Fix, Close - is
 * one of:
 *
 *   - done by OneUptime AI, through the playbook engine, where the setting
 *     for its kind says On its own;
 *   - asked of a person, with the evidence, where it says Ask - and always
 *     for an incident, which pages people;
 *   - left to a person, and why: the setting is Off, OneUptime has no way
 *     to do the step, or the step is a judgement the evidence cannot
 *     settle;
 *   - waited on: an approval, a step of the engine's, a check, the quiet
 *     window before a close.
 *
 * Nothing it cannot be sure of is done: a false positive is ruled out only
 * when OneUptime's own facts of the address leave no doubt and the triage
 * read the case as Likely Malicious; a step that only looks done is a
 * person's; a block or a containment that does not hold is not tried again
 * - the case goes to people, saying so.
 *
 * It hands the case to people at once - before doing anything - when AI is
 * off, out of credits or without a provider, when the case's data held text
 * written to steer an AI, when the case is at the project's highest
 * priority, and when the triage did not read it as malicious (nor as benign
 * or a false positive, which it closes). It hands it over, too, when a
 * person declined or undid what it did, when a step it started failed, and
 * when everything left is a person's to do.
 *
 * It reads the Response Plan built without the triage's report: the steps
 * OneUptime AI's triage suggested in it are for whoever may read the case,
 * and what the responder does is posted where they are not the only readers
 * (SubjectReadersOnlyGuard).
 */

// The case as the planner reads it.
export interface ResponderCase {
  stage: SecurityCaseStage;
  aiVerdict: SecurityCaseAiVerdict | null;
  // The case's data held text written to steer an AI.
  hasSteeringText: boolean;
  // The case is at the project's most urgent priority.
  isAtHighestPriority: boolean;
  /*
   * The priority the triage suggested, when it is more urgent than the
   * case's: OneUptime AI raises it, never lowers it.
   */
  priorityToRaiseTo: string | null;
  // That priority is the project's most urgent one.
  isRaisingToHighestPriority: boolean;
  lastDetectedAt: Date | null;
  createdAt: Date;
}

// One row of OneUptime AI's log of the case, as the planner reads it.
export interface ResponderLogRow {
  id: string;
  kind: SecurityCaseAiActionKind;
  status: SecurityCaseAiActionStatus;
  reason: SecurityCaseAiActionReason;
  stepKey: string | null;
  target: string | null;
  createdAt: Date;
  // When the engine finished it, for a row that is done.
  doneAt?: Date | undefined;
}

// A block of the project's Blocklist the case made, still in force.
export interface ResponderCaseBlock {
  id: string;
  value: string;
}

export interface ResponderInput {
  now: Date;
  limits: SecurityCaseAiLimits;
  hasScannersPolicyFinishedTrial: boolean;
  /*
   * What stops OneUptime AI working any case of the project now: AI off for
   * the project or for cases, no LLM provider, no AI credits or a daily AI
   * limit reached. Null when nothing does.
   */
  aiGate: SecurityCaseHandOffReason | null;
  securityCase: ResponderCase;
  // The case's Response Plan, built without the triage's report.
  plan: ResponsePlan;
  /*
   * OneUptime AI's log of the case since it last handed the case to people:
   * a person's Respond with AI starts afresh.
   */
  log: Array<ResponderLogRow>;
  // Something enforces the project's blocklist: Cloudflare, AWS WAF, a feed.
  hasBlockDestination: boolean;
  // One of the project's playbooks has a step that contains users, and hosts.
  canContainUsers: boolean;
  canContainHosts: boolean;
  // The blocks the case made, for a false positive's close to lift.
  caseBlocks: Array<ResponderCaseBlock>;
}

export interface ResponderIntent {
  kind: SecurityCaseAiActionKind;
  stepKey: string;
  // What it acts on: an address, a user, a host, a value an exception skips.
  target?: string | undefined;
  decision: SecurityCaseAiDecisionKind;
  reason: SecurityCaseAiActionReason;
  mode: SecurityCaseAiMode | null;
  // The step's check, as OneUptime AI read it: its evidence.
  check?: ResponseStepCheck | undefined;
  verdict?: SecurityCaseVerdict | undefined;
  priorityId?: string | undefined;
  // The blocks a lift takes away.
  blockIds?: Array<string> | undefined;
  // The rule an exception is offered for, and the entity it skips.
  detectionRuleId?: string | undefined;
  entity?: SecurityEntity | undefined;
  // A close's report, written from the case's records (SecurityCaseClosingReport).
  report?: string | undefined;
  // How often the same action held on cases like this one.
  trackRecord?: SecurityCaseAiTrackRecord | undefined;
}

// What a look leaves OneUptime AI waiting for.
export enum ResponderWait {
  // A person's approval.
  Approval = "Approval",
  // A step of its own the engine is carrying out.
  Engine = "Engine",
  // OneUptime's check of a step it did.
  Check = "Check",
  // The quiet window before it closes the case.
  QuietWindow = "QuietWindow",
  // The code fix it asked for, to ship and be checked.
  Fix = "Fix",
}

export interface ResponderHandOff {
  reason: SecurityCaseHandOffReason;
  // The steps a person has to do, or that the hand-off is about.
  stepKeys: Array<string>;
}

export interface ResponderPlan {
  // Hand the case to people, after carrying out the intents before it.
  handOff: ResponderHandOff | null;
  intents: Array<ResponderIntent>;
  waits: Array<ResponderWait>;
  // When the quiet window ends, while OneUptime AI waits for it.
  quietUntil: Date | null;
  // The case is closed: nothing more to do once the intents are carried out.
  isFinished: boolean;
}

// The kind of a step, by its key: RESPONSE_STEP_KINDS' value, or the key's own head.
export function getResponseStepKind(stepKey: string): string {
  for (const kind of Object.values(RESPONSE_STEP_KINDS)) {
    if (isResponseStepOfKind(stepKey, kind)) {
      return kind;
    }
  }

  return stepKey.split(":").slice(0, 2).join(":");
}

// What a step's key is about: "contain:block-ip:1.2.3.4" is about 1.2.3.4.
export function getResponseStepValue(step: ResponseStep): string {
  if (step.address) {
    return step.address;
  }

  const fromText: string | undefined = step.text.values["value"];

  if (fromText) {
    return fromText;
  }

  const kind: string = getResponseStepKind(step.key);

  return step.key.length > kind.length + 1
    ? step.key.slice(kind.length + 1)
    : "";
}

function isCheckState(
  check: ResponseStepCheck | undefined,
  states: ReadonlyArray<SecurityCaseStepCheckState>,
): boolean {
  return Boolean(check && states.includes(check.state));
}

// The planner's outcome so far, filled in step by step.
interface PlanBuilder {
  plan: ResponderPlan;
  // The steps left for a person this look, by key.
  leftStepKeys: Array<string>;
}

function waitFor(builder: PlanBuilder, wait: ResponderWait): void {
  if (!builder.plan.waits.includes(wait)) {
    builder.plan.waits.push(wait);
  }
}

function decide(
  input: ResponderInput,
  kind: SecurityCaseAiActionKind,
): SecurityCaseAiDecision {
  return decideSecurityCaseAiAction({
    kind,
    limits: input.limits,
    hasScannersPolicyFinishedTrial: input.hasScannersPolicyFinishedTrial,
  });
}

/*
 * One step's intent, unless OneUptime AI already logged the same: a step
 * left for the same reason stays one row, never one a look.
 */
function addIntent(
  builder: PlanBuilder,
  intent: ResponderIntent,
  previous: ResponderLogRow | undefined,
): void {
  if (intent.decision === SecurityCaseAiDecisionKind.Leave) {
    builder.leftStepKeys.push(intent.stepKey);

    if (
      previous &&
      previous.status === SecurityCaseAiActionStatus.Left &&
      previous.kind === intent.kind &&
      previous.reason === intent.reason
    ) {
      return;
    }
  }

  builder.plan.intents.push(intent);
}

/*
 * The hand-offs that come before anything is done: what stops OneUptime AI
 * working the case at all.
 */
export function getImmediateHandOff(
  input: ResponderInput,
): SecurityCaseHandOffReason | null {
  if (input.aiGate) {
    return input.aiGate;
  }

  if (input.securityCase.hasSteeringText) {
    return SecurityCaseHandOffReason.SteeringText;
  }

  if (input.securityCase.isAtHighestPriority) {
    return SecurityCaseHandOffReason.HighestPriority;
  }

  const verdict: SecurityCaseAiVerdict | null = input.securityCase.aiVerdict;

  if (
    verdict !== SecurityCaseAiVerdict.LikelyMalicious &&
    verdict !== SecurityCaseAiVerdict.LikelyBenign &&
    verdict !== SecurityCaseAiVerdict.LikelyFalsePositive
  ) {
    return SecurityCaseHandOffReason.NotLikelyMalicious;
  }

  return null;
}

/*
 * What came of OneUptime AI's own actions that hands the case to people: a
 * person turned one down or undid it, or a step it started failed. Only
 * steps of the case: a hand-off's own row is not one.
 */
export function getOutcomeHandOff(
  log: ReadonlyArray<ResponderLogRow>,
): ResponderHandOff | null {
  for (const row of log) {
    if (row.kind === SecurityCaseAiActionKind.HandToPeople) {
      continue;
    }

    if (
      row.status === SecurityCaseAiActionStatus.Declined ||
      row.status === SecurityCaseAiActionStatus.Undone
    ) {
      return {
        reason: SecurityCaseHandOffReason.Declined,
        stepKeys: row.stepKey ? [row.stepKey] : [],
      };
    }

    if (row.status === SecurityCaseAiActionStatus.Failed) {
      return {
        reason: SecurityCaseHandOffReason.StepFailed,
        stepKeys: row.stepKey ? [row.stepKey] : [],
      };
    }
  }

  return null;
}

// Each step's latest row of the log, by its key.
export function getLatestRowsByStep(
  log: ReadonlyArray<ResponderLogRow>,
): Map<string, ResponderLogRow> {
  const latest: Map<string, ResponderLogRow> = new Map();

  for (const row of log) {
    if (!row.stepKey) {
      continue;
    }

    const known: ResponderLogRow | undefined = latest.get(row.stepKey);

    if (!known || known.createdAt.getTime() <= row.createdAt.getTime()) {
      latest.set(row.stepKey, row);
    }
  }

  return latest;
}

/*
 * When the case's detection has been quiet long enough to close it: the
 * quiet window after it last fired (or opened).
 */
export function getQuietUntil(securityCase: ResponderCase): Date {
  return OneUptimeDate.addRemoveHours(
    securityCase.lastDetectedAt || securityCase.createdAt,
    SECURITY_CASE_AI_QUIET_WINDOW_HOURS,
  );
}

/*
 * A step OneUptime AI did that its check has not settled yet: done, it is
 * waited on; found not holding - the block let the address through, the
 * account is active again - it is not done again blindly: the case goes to
 * people. The fix it asked for is waited on as long as it takes to ship.
 */
function planDoneStep(data: {
  builder: PlanBuilder;
  step: ResponseStep;
  row: ResponderLogRow;
}): void {
  const { builder, step, row } = data;

  const checkedAfter: (since: Date | null | undefined) => boolean = (
    since: Date | null | undefined,
  ): boolean => {
    return Boolean(
      since &&
        step.check?.checkedAt &&
        step.check.checkedAt.getTime() > since.getTime(),
    );
  };

  switch (row.kind) {
    case SecurityCaseAiActionKind.BlockAddress:
    case SecurityCaseAiActionKind.ContainAccount:
    case SecurityCaseAiActionKind.ContainHost: {
      /*
       * Not holding: it held and stopped (Regressed), or it is in force and
       * the check, read after, still finds it not done - the address
       * reaching the app past a block a destination holds, the account
       * still active after it was suspended.
       */
      const inForceSince: Date | null | undefined =
        row.kind === SecurityCaseAiActionKind.BlockAddress
          ? step.addressBlock?.enforcedAt.length
            ? step.addressBlock.enforcedSince || row.doneAt
            : null
          : row.doneAt;
      const isNotHolding: boolean =
        isCheckState(step.check, [SecurityCaseStepCheckState.Regressed]) ||
        (isCheckState(step.check, [SecurityCaseStepCheckState.NotDone]) &&
          checkedAfter(inForceSince));

      if (isNotHolding) {
        builder.plan.handOff = builder.plan.handOff || {
          reason: SecurityCaseHandOffReason.DidNotHold,
          stepKeys: [step.key],
        };
        return;
      }

      waitFor(builder, ResponderWait.Check);
      return;
    }
    case SecurityCaseAiActionKind.RequestCodeFix:
      waitFor(builder, ResponderWait.Fix);
      return;
    default:
      // The case says it is done once the engine's change lands.
      waitFor(builder, ResponderWait.Engine);
  }
}

// A step of a case OneUptime AI reads as malicious: what it does about it.
function planMaliciousStep(data: {
  input: ResponderInput;
  step: ResponseStep;
}): ResponderIntent | ResponderWait | null {
  const { input, step } = data;
  const kind: string = getResponseStepKind(step.key);
  const value: string = getResponseStepValue(step);
  const check: ResponseStepCheck | undefined = step.check;

  const leave: (
    actionKind: SecurityCaseAiActionKind,
    reason: SecurityCaseAiActionReason,
  ) => ResponderIntent = (
    actionKind: SecurityCaseAiActionKind,
    reason: SecurityCaseAiActionReason,
  ): ResponderIntent => {
    return {
      kind: actionKind,
      stepKey: step.key,
      ...(value ? { target: value } : {}),
      decision: SecurityCaseAiDecisionKind.Leave,
      reason,
      mode: null,
      ...(check ? { check } : {}),
    };
  };

  const act: (
    actionKind: SecurityCaseAiActionKind,
    extra?: Partial<ResponderIntent>,
  ) => ResponderIntent = (
    actionKind: SecurityCaseAiActionKind,
    extra?: Partial<ResponderIntent>,
  ): ResponderIntent => {
    const decision: SecurityCaseAiDecision = decide(input, actionKind);

    return {
      kind: actionKind,
      stepKey: step.key,
      ...(value ? { target: value } : {}),
      decision: decision.decision,
      reason: decision.reason,
      mode: decision.mode,
      ...(check ? { check } : {}),
      ...(extra || {}),
    };
  };

  switch (kind) {
    case RESPONSE_STEP_KINDS.take:
      return act(SecurityCaseAiActionKind.TakeCase, { target: undefined });

    case RESPONSE_STEP_KINDS.requests:
      // What got through, or could not be read, is a person's to weigh.
      return check
        ? leave(
            SecurityCaseAiActionKind.StepForPeople,
            SecurityCaseAiActionReason.NeedsJudgement,
          )
        : ResponderWait.Check;

    case RESPONSE_STEP_KINDS.falsePositive: {
      if (!check) {
        return ResponderWait.Check;
      }

      /*
       * Ruled out only when nothing OneUptime knows of the address speaks
       * for it: not one of the project's own, and nobody signed in from it.
       */
      const data: Record<string, unknown> = check.evidence.data || {};
      const isClear: boolean =
        input.securityCase.aiVerdict ===
          SecurityCaseAiVerdict.LikelyMalicious &&
        data["reason"] === "Judgement" &&
        data["isOwnAddress"] === false &&
        data["signedInUsers"] === 0;

      return isClear
        ? act(SecurityCaseAiActionKind.MarkStepDone)
        : leave(
            SecurityCaseAiActionKind.StepForPeople,
            SecurityCaseAiActionReason.NeedsJudgement,
          );
    }

    case RESPONSE_STEP_KINDS.blockIp:
      if (!input.hasBlockDestination) {
        return leave(
          SecurityCaseAiActionKind.BlockAddress,
          SecurityCaseAiActionReason.NoBlockDestination,
        );
      }

      // A block of the address that failed to be made is a person's to look at.
      if (step.isDetailWarning) {
        return leave(
          SecurityCaseAiActionKind.BlockAddress,
          SecurityCaseAiActionReason.NeedsJudgement,
        );
      }

      // A block of the address is on its way: its check says when it holds.
      if (step.addressBlock || step.detail) {
        return ResponderWait.Check;
      }

      return act(SecurityCaseAiActionKind.BlockAddress);

    case RESPONSE_STEP_KINDS.user:
      return input.canContainUsers
        ? act(SecurityCaseAiActionKind.ContainAccount)
        : leave(
            SecurityCaseAiActionKind.ContainAccount,
            SecurityCaseAiActionReason.NoWayToDoIt,
          );

    case RESPONSE_STEP_KINDS.host:
      return input.canContainHosts
        ? act(SecurityCaseAiActionKind.ContainHost)
        : leave(
            SecurityCaseAiActionKind.ContainHost,
            SecurityCaseAiActionReason.NoWayToDoIt,
          );

    case RESPONSE_STEP_KINDS.incident:
      // Customers or production may be affected: a person decides, always asked.
      return check
        ? act(SecurityCaseAiActionKind.DeclareIncident, { target: undefined })
        : ResponderWait.Check;

    case RESPONSE_STEP_KINDS.markContained: {
      if (input.plan.isContainmentVerified) {
        return act(SecurityCaseAiActionKind.MarkContained, {
          target: undefined,
        });
      }

      /*
       * Every step that contains the threat is done, and one was only
       * ticked: OneUptime cannot say the case is contained. A person can.
       */
      return input.plan.isReadyToMarkContained
        ? leave(
            SecurityCaseAiActionKind.MarkContained,
            SecurityCaseAiActionReason.NeedsJudgement,
          )
        : null;
    }

    case RESPONSE_STEP_KINDS.fixPublicApp:
      if (isCheckState(check, [SecurityCaseStepCheckState.LooksDone])) {
        return leave(
          SecurityCaseAiActionKind.StepForPeople,
          SecurityCaseAiActionReason.FixLooksDone,
        );
      }

      return act(SecurityCaseAiActionKind.RequestCodeFix, {
        target: step.text.values["route"] || undefined,
      });

    case RESPONSE_STEP_KINDS.fixBruteForce:
      return leave(
        SecurityCaseAiActionKind.StepForPeople,
        isCheckState(check, [SecurityCaseStepCheckState.LooksDone])
          ? SecurityCaseAiActionReason.FixLooksDone
          : SecurityCaseAiActionReason.NeedsJudgement,
      );

    case RESPONSE_STEP_KINDS.fixAccountChanges:
      return leave(
        SecurityCaseAiActionKind.StepForPeople,
        SecurityCaseAiActionReason.FixNotChecked,
      );

    case "fix:general": {
      /*
       * Nothing got through - OneUptime saw every request turned away - so
       * there is nothing in the app to fix.
       */
      const requests: ResponseStep | undefined = input.plan.steps.find(
        (candidate: ResponseStep): boolean => {
          return isResponseStepOfKind(
            candidate.key,
            RESPONSE_STEP_KINDS.requests,
          );
        },
      );

      return requests?.check?.state === SecurityCaseStepCheckState.Verified
        ? act(SecurityCaseAiActionKind.MarkStepDone, {
            target: undefined,
            check: requests.check,
          })
        : leave(
            SecurityCaseAiActionKind.StepForPeople,
            SecurityCaseAiActionReason.NeedsJudgement,
          );
    }

    case RESPONSE_STEP_KINDS.close: {
      const others: Array<ResponseStep> = input.plan.steps.filter(
        (candidate: ResponseStep): boolean => {
          return candidate.key !== step.key;
        },
      );

      if (
        !others.every((candidate: ResponseStep): boolean => {
          return candidate.isDone;
        })
      ) {
        return null;
      }

      return act(SecurityCaseAiActionKind.CloseCase, {
        target: undefined,
        verdict: SecurityCaseVerdict.TruePositive,
      });
    }

    default:
      break;
  }

  // The rule author's own steps, and every fix but the route's, take a person's judgement.
  if (
    kind.startsWith("rule:") ||
    isResponseStepOfKind(step.key, "rule") ||
    step.phase === ResponsePhase.Fix
  ) {
    return leave(
      SecurityCaseAiActionKind.StepForPeople,
      SecurityCaseAiActionReason.NeedsJudgement,
    );
  }

  // Everything else - a playbook to run, a domain, a file, an address to find - has no tool.
  return leave(
    SecurityCaseAiActionKind.StepForPeople,
    SecurityCaseAiActionReason.NoWayToDoIt,
  );
}

/*
 * A case OneUptime AI reads as benign or a false positive: it closes it
 * with that verdict - as the Close setting says - and, once it is closed,
 * lifts the blocks the case made and offers the rule an exception for its
 * owner to accept.
 */
function planDismissal(data: {
  input: ResponderInput;
  builder: PlanBuilder;
  latestByStep: Map<string, ResponderLogRow>;
}): void {
  const { input, builder, latestByStep } = data;
  const verdict: SecurityCaseVerdict | null = getSecurityCaseAiClosingVerdict(
    input.securityCase.aiVerdict,
  );
  const closeStep: ResponseStep | undefined = input.plan.steps.find(
    (step: ResponseStep): boolean => {
      return isResponseStepOfKind(step.key, RESPONSE_STEP_KINDS.close);
    },
  );

  if (!verdict || !closeStep || closeStep.isDone) {
    return;
  }

  const row: ResponderLogRow | undefined = latestByStep.get(closeStep.key);

  if (row?.status === SecurityCaseAiActionStatus.Asked) {
    waitFor(builder, ResponderWait.Approval);
    return;
  }

  if (
    row?.status === SecurityCaseAiActionStatus.Doing ||
    row?.status === SecurityCaseAiActionStatus.Done
  ) {
    waitFor(builder, ResponderWait.Engine);
    return;
  }

  const decision: SecurityCaseAiDecision = decide(
    input,
    SecurityCaseAiActionKind.CloseCase,
  );

  addIntent(
    builder,
    {
      kind: SecurityCaseAiActionKind.CloseCase,
      stepKey: closeStep.key,
      decision: decision.decision,
      reason: decision.reason,
      mode: decision.mode,
      verdict,
    },
    row,
  );
}

/*
 * After a close of a false positive or a benign case: the case's blocks
 * lifted, and an exception offered to its rule - each once. They go as the
 * close went: done, or approved, with it.
 */
function planAfterDismissal(data: {
  input: ResponderInput;
  builder: PlanBuilder;
  log: ReadonlyArray<ResponderLogRow>;
}): void {
  const { input, builder, log } = data;
  const close: ResponderLogRow | undefined = log.find(
    (row: ResponderLogRow): boolean => {
      return (
        row.kind === SecurityCaseAiActionKind.CloseCase &&
        row.status === SecurityCaseAiActionStatus.Done
      );
    },
  );

  if (!close) {
    return;
  }

  const hasLifted: boolean = log.some((row: ResponderLogRow): boolean => {
    return row.kind === SecurityCaseAiActionKind.LiftBlock;
  });

  if (!hasLifted && input.caseBlocks.length > 0) {
    builder.plan.intents.push({
      kind: SecurityCaseAiActionKind.LiftBlock,
      stepKey: close.stepKey || RESPONSE_STEP_KINDS.close,
      target: input.caseBlocks
        .map((block: ResponderCaseBlock): string => {
          return block.value;
        })
        .join(", "),
      decision: SecurityCaseAiDecisionKind.Do,
      reason:
        close.reason === SecurityCaseAiActionReason.Approved
          ? SecurityCaseAiActionReason.Approved
          : SecurityCaseAiActionReason.OnItsOwn,
      mode: input.limits.modes.Close,
      blockIds: input.caseBlocks.map((block: ResponderCaseBlock): string => {
        return block.id;
      }),
    });
  }

  const hasOffered: boolean = log.some((row: ResponderLogRow): boolean => {
    return row.kind === SecurityCaseAiActionKind.OfferRuleException;
  });
  const falsePositiveStep: ResponseStep | undefined = input.plan.steps.find(
    (step: ResponseStep): boolean => {
      return (
        isResponseStepOfKind(step.key, RESPONSE_STEP_KINDS.falsePositive) &&
        step.action?.kind === ResponseActionKind.AddRuleException &&
        Boolean(step.action.detectionRuleId)
      );
    },
  );

  if (!hasOffered && falsePositiveStep?.action?.detectionRuleId) {
    builder.plan.intents.push({
      kind: SecurityCaseAiActionKind.OfferRuleException,
      stepKey: falsePositiveStep.key,
      ...(falsePositiveStep.action.entity
        ? { target: falsePositiveStep.action.entity.value }
        : {}),
      // The rule's owner accepts it, from the rule's Exceptions page.
      decision: SecurityCaseAiDecisionKind.Ask,
      reason: SecurityCaseAiActionReason.AlwaysAsks,
      mode: input.limits.modes.Close,
      detectionRuleId: falsePositiveStep.action.detectionRuleId,
      ...(falsePositiveStep.action.entity
        ? { entity: falsePositiveStep.action.entity }
        : {}),
    });
  }
}

export function planSecurityCaseResponse(input: ResponderInput): ResponderPlan {
  const builder: PlanBuilder = {
    plan: {
      handOff: null,
      intents: [],
      waits: [],
      quietUntil: null,
      isFinished: false,
    },
    leftStepKeys: [],
  };
  const isDismissing: boolean = isDismissingVerdict(
    getSecurityCaseAiClosingVerdict(input.securityCase.aiVerdict),
  );

  // A closed case is done with - but for what follows closing a false positive.
  if (input.securityCase.stage === SecurityCaseStage.Closed) {
    if (isDismissing) {
      planAfterDismissal({ input, builder, log: input.log });
    }

    builder.plan.isFinished = true;
    return builder.plan;
  }

  const atOnce: SecurityCaseHandOffReason | null = getImmediateHandOff(input);

  if (atOnce) {
    builder.plan.handOff = { reason: atOnce, stepKeys: [] };
    return builder.plan;
  }

  const outcome: ResponderHandOff | null = getOutcomeHandOff(input.log);

  if (outcome) {
    builder.plan.handOff = outcome;
    return builder.plan;
  }

  const latestByStep: Map<string, ResponderLogRow> = getLatestRowsByStep(
    input.log,
  );

  if (isDismissing) {
    planDismissal({ input, builder, latestByStep });
    return builder.plan;
  }

  // The priority the triage suggested, when it is more urgent: raised, once.
  if (
    input.securityCase.priorityToRaiseTo &&
    !latestByStep.has(SECURITY_CASE_AI_PRIORITY_STEP_KEY)
  ) {
    const decision: SecurityCaseAiDecision = decide(
      input,
      SecurityCaseAiActionKind.SetPriority,
    );

    addIntent(
      builder,
      {
        kind: SecurityCaseAiActionKind.SetPriority,
        stepKey: SECURITY_CASE_AI_PRIORITY_STEP_KEY,
        decision: decision.decision,
        reason: decision.reason,
        mode: decision.mode,
        priorityId: input.securityCase.priorityToRaiseTo,
      },
      undefined,
    );

    /*
     * Raised to the project's most urgent priority, the case is people's at
     * once: the priority is set, and the case handed over.
     */
    if (input.securityCase.isRaisingToHighestPriority) {
      builder.plan.handOff = {
        reason: SecurityCaseHandOffReason.HighestPriority,
        stepKeys: [],
      };
      return builder.plan;
    }
  }

  for (const step of input.plan.steps) {
    if (step.isDone) {
      continue;
    }

    const row: ResponderLogRow | undefined = latestByStep.get(step.key);

    if (row?.status === SecurityCaseAiActionStatus.Doing) {
      waitFor(builder, ResponderWait.Engine);
      continue;
    }

    if (row?.status === SecurityCaseAiActionStatus.Asked) {
      waitFor(builder, ResponderWait.Approval);
      continue;
    }

    if (row?.status === SecurityCaseAiActionStatus.Done) {
      planDoneStep({ builder, step, row });
      continue;
    }

    const planned: ResponderIntent | ResponderWait | null = planMaliciousStep({
      input,
      step,
    });

    if (planned === null) {
      continue;
    }

    if (typeof planned === "string") {
      waitFor(builder, planned);
      continue;
    }

    // The quiet window before a close: waited out, then the close.
    if (planned.kind === SecurityCaseAiActionKind.CloseCase) {
      const quietUntil: Date = getQuietUntil(input.securityCase);

      if (quietUntil.getTime() > input.now.getTime()) {
        builder.plan.quietUntil = quietUntil;
        waitFor(builder, ResponderWait.QuietWindow);
        continue;
      }
    }

    addIntent(builder, planned, row);
  }

  /*
   * Nothing OneUptime AI may still do or wait for, and steps a person has
   * to do: the case is theirs now, and they are told which.
   */
  const isActing: boolean = builder.plan.intents.some(
    (intent: ResponderIntent): boolean => {
      return intent.decision !== SecurityCaseAiDecisionKind.Leave;
    },
  );

  if (
    !builder.plan.handOff &&
    !isActing &&
    builder.plan.waits.length === 0 &&
    builder.leftStepKeys.length > 0
  ) {
    builder.plan.handOff = {
      reason: SecurityCaseHandOffReason.OnlyPeopleCanDo,
      stepKeys: builder.leftStepKeys,
    };
  }

  return builder.plan;
}

// The pseudo step a hand-off row is kept under.
export const HAND_OFF_STEP_KEY: string = SECURITY_CASE_AI_HAND_OFF_STEP_KEY;
