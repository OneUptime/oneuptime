import ObjectID from "../../../../Types/ObjectID";
import { ResponseLink } from "../../../../Types/SecurityCase/SecurityCaseResponseLink";
import { SecurityCaseMatchesJson } from "../../../../Types/SecurityCase/SecurityCaseMatches";
import {
  SecurityCaseStepCheckData,
  SecurityCaseStepCheckEvidence,
  SecurityCaseStepCheckSentence,
  readStepCheckDataTime,
} from "../../../../Types/SecurityCase/SecurityCaseStepCheckEvidence";
import SecurityCaseStepCheckState, {
  isStepCheckHolding,
} from "../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import { SecurityEntity } from "../../../../Types/SecurityCase/SecurityEntity";
import {
  ResponsePlan,
  ResponseStep,
  ResponseStepCheck,
  ResponseTask,
} from "../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanTypes";
import { AddressBlockEvidence } from "./Evidence/AddressBlocks";
import {
  AddressCoverageReading,
  AddressRequestsReading,
} from "./Evidence/AddressRequests";
import { AddressFactsReading } from "./Evidence/AddressFacts";
import { ContainmentStateReading } from "./Evidence/ContainmentState";
import { MonitorsDownReading } from "./Evidence/MonitorsDown";

/*
 * A CHECK OF ONE KIND OF RESPONSE PLAN STEP (#10340): how OneUptime finds
 * out for itself whether a step is done - from the app's own requests, the
 * identity provider's and the EDR's state, the project's monitors - and the
 * evidence it shows for it.
 *
 * Each kind of step is checked by one module of this folder, listed in
 * StepCheckRegistry, and a new kind of step plugs in there. Each reads
 * what it needs through StepCheckEvidence - the readers of the app's
 * requests, of a product's state, of the monitors - so a new source of
 * evidence plugs in there (the blocklist's destinations, #10338, into
 * AddressBlocks), and every check is tested on its own with readers that
 * answer as the real ones would.
 *
 * Fail toward a person: a check that cannot read its data says it cannot
 * tell, and why, and never marks the step done. A step it saw done that
 * stops holding is Regressed, which the case's timeline and its assignee
 * are told (SecurityCaseStepCheckRunner).
 */

// What one check found: the state, the evidence for it, and when to look again.
export interface StepCheckResult {
  state: SecurityCaseStepCheckState;
  evidence: SecurityCaseStepCheckEvidence;
  // Sooner than the kind's cadence: right after a tick, while it is in flux.
  recheckInMinutes?: number | undefined;
}

// The case a check reads: what the plan was built from, as the runner read it.
export interface StepCheckCase {
  projectId: ObjectID;
  securityCaseId: ObjectID;
  createdAt: Date;
  firstDetectedAt: Date | null;
  lastDetectedAt: Date | null;
  entities: Array<SecurityEntity>;
  matches: SecurityCaseMatchesJson | null;
  plan: ResponsePlan;
  hasIncident: boolean;
}

// The step a check is about.
export interface StepCheckTarget {
  step: ResponseStep;
  // What the step is about, as written: the address, the user, the host. Empty for none.
  value: string;
  // What OneUptime found the last time it checked the step.
  previous: ResponseStepCheck | null;
  // The person's tick, when there is one.
  task: ResponseTask | null;
}

/*
 * The evidence a check reads, one reader a source. Each throws when it
 * cannot read its source; the runner reads each once a case run.
 */
export interface StepCheckEvidence {
  // The app's requests from an address over a window, and those after `since`.
  readAddressRequests(data: {
    address: string;
    start: Date;
    end: Date;
    since: Date | null;
  }): Promise<AddressRequestsReading>;
  // How many requests from an address reached the app between two moments.
  countAddressRequests(data: {
    address: string;
    start: Date;
    end: Date;
  }): Promise<number>;
  // What OneUptime can see of the app's requests by address at all.
  readAddressCoverage(): Promise<AddressCoverageReading>;
  // The blocks of an address applied and read back at a destination.
  readAddressBlocks(address: string): Promise<Array<AddressBlockEvidence>>;
  // A user's account, or a host, in the products the project is connected to.
  readUserState(user: string): Promise<ContainmentStateReading>;
  readHostState(host: string): Promise<ContainmentStateReading>;
  // The monitors of the services the case's requests went to that went down while it was open.
  readMonitorsDown(): Promise<MonitorsDownReading>;
  // What the project knows of an address: its records, threat intel, its signed-in users.
  readAddressFacts(address: string): Promise<AddressFactsReading>;
}

export interface StepCheckContext {
  securityCase: StepCheckCase;
  target: StepCheckTarget;
  now: Date;
  evidence: StepCheckEvidence;
}

export interface StepCheck {
  // The kind of step it checks (RESPONSE_STEP_KINDS).
  kind: string;
  // How long after a check the step is checked again, while it is in flux.
  intervalInMinutes: number;
  /*
   * What it found, or null when the step is not one it checks on this case
   * (an incident already declared; a false positive about no address).
   */
  check(context: StepCheckContext): Promise<StepCheckResult | null>;
}

// ---------- The evidence's words ----------

export function sentence(
  template: SecurityCaseStepCheckSentence["template"],
  values: Record<string, string> = {},
  extras: {
    numbers?: Record<string, number> | undefined;
    times?: Record<string, Date | null | undefined> | undefined;
    count?: number | undefined;
  } = {},
): SecurityCaseStepCheckSentence {
  const times: Record<string, string> = {};

  for (const [key, time] of Object.entries(extras.times || {})) {
    if (time && !Number.isNaN(time.getTime())) {
      times[key] = time.toISOString();
    }
  }

  return {
    template,
    values,
    ...(extras.numbers ? { numbers: extras.numbers } : {}),
    ...(Object.keys(times).length > 0 ? { times } : {}),
    ...(extras.count !== undefined ? { count: extras.count } : {}),
  };
}

export function evidenceOf(data: {
  sentence: SecurityCaseStepCheckSentence;
  facts?: Array<SecurityCaseStepCheckSentence> | undefined;
  links?: Array<ResponseLink | null> | undefined;
  docsPath?: string | undefined;
  data?: Record<string, string | number | boolean | Date | null | undefined>;
}): SecurityCaseStepCheckEvidence {
  const kept: SecurityCaseStepCheckData = {};

  for (const [key, value] of Object.entries(data.data || {})) {
    if (value === undefined) {
      continue;
    }

    kept[key] = value instanceof Date ? value.toISOString() : value;
  }

  return {
    sentence: data.sentence,
    facts: data.facts || [],
    links: (data.links || []).filter(
      (link: ResponseLink | null): link is ResponseLink => {
        return link !== null;
      },
    ),
    ...(data.docsPath ? { docsPath: data.docsPath } : {}),
    data: kept,
  };
}

// ---------- When a step was done ----------

// The docs section that says what OneUptime needs to check a step.
export const STEP_CHECK_DOCS_PATH: string =
  "/telemetry/security-cases#how-oneuptime-checks-a-step";

// The later of two moments; either may be missing.
export function laterOf(
  left: Date | null | undefined,
  right: Date | null | undefined,
): Date | null {
  if (!left || !right) {
    return left || right || null;
  }

  return left.getTime() >= right.getTime() ? left : right;
}

/*
 * Since when the step is done, as far as anyone said: the person's tick,
 * or the moment OneUptime last saw it holding. The later of them, so a
 * step ticked again after it stopped holding is judged from the new tick.
 *
 * A tick made before the step stopped holding is spent by it: the step is
 * not done since then, and is judged as one nobody said is done - it holds
 * again once OneUptime sees it hold. Null when nobody said so.
 */
export function getDoneSince(target: StepCheckTarget): Date | null {
  const tickedAt: Date | null =
    target.task?.isDone && target.task.doneAt
      ? new Date(target.task.doneAt)
      : null;
  const previous: ResponseStepCheck | null = target.previous;

  if (previous?.state === SecurityCaseStepCheckState.Regressed) {
    const regressedSince: Date | null = previous.stateSince || null;

    return tickedAt &&
      regressedSince &&
      tickedAt.getTime() > regressedSince.getTime()
      ? tickedAt
      : null;
  }

  let seenHoldingSince: Date | null = null;

  if (previous && isStepCheckHolding(previous.state)) {
    seenHoldingSince =
      readStepCheckDataTime(previous.evidence.data, "doneSince") ||
      previous.stateSince ||
      null;
  }

  return laterOf(tickedAt, seenHoldingSince);
}

/*
 * Whether a step that stopped holding is still the regression OneUptime
 * said: it was Regressed, and nobody ticked it since. A person who ticks it
 * again after it stopped holding says it is dealt with - the next time it
 * stops holding is a new regression.
 */
export function isStillRegressed(target: StepCheckTarget): boolean {
  const previous: ResponseStepCheck | null = target.previous;

  if (!previous || previous.state !== SecurityCaseStepCheckState.Regressed) {
    return false;
  }

  const tickedAt: Date | null =
    target.task?.isDone && target.task.doneAt
      ? new Date(target.task.doneAt)
      : null;
  const since: Date | null = previous.stateSince || null;

  return !(tickedAt && since && tickedAt.getTime() > since.getTime());
}

/*
 * When a step is checked next: its kind's cadence while it is in flux, less
 * often once it has held for a while - three times as long after an hour,
 * six times after a day - and never longer than an hour.
 */
export const STEP_CHECK_MAX_INTERVAL_IN_MINUTES: number = 60;

export function getNextCheckAt(data: {
  state: SecurityCaseStepCheckState;
  stateSince: Date;
  now: Date;
  intervalInMinutes: number;
  recheckInMinutes?: number | undefined;
}): Date {
  const minute: number = 60 * 1000;
  const heldFor: number = data.now.getTime() - data.stateSince.getTime();
  const isSettled: boolean =
    data.state === SecurityCaseStepCheckState.Verified ||
    data.state === SecurityCaseStepCheckState.NotNeeded;
  let interval: number = data.intervalInMinutes;

  if (isSettled && heldFor >= 24 * 60 * minute) {
    interval *= 6;
  } else if (isSettled && heldFor >= 60 * minute) {
    interval *= 3;
  }

  if (data.recheckInMinutes !== undefined) {
    interval = Math.min(interval, data.recheckInMinutes);
  }

  interval = Math.max(
    1,
    Math.min(STEP_CHECK_MAX_INTERVAL_IN_MINUTES, interval),
  );

  return new Date(data.now.getTime() + interval * minute);
}
