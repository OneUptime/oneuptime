import {
  WhoIsToldCriteria,
  WhoIsToldDeclaration,
  WhoIsToldEvent,
  WhoIsToldResult,
} from "../Monitor/WhoIsTold";
import {
  OnCallTestPageCost,
  OnCallTestPagePreview,
  OnCallTestPageRecordKind,
  OnCallTestPageResultSummary,
  describeOnCallTestPageWait,
} from "./OnCallTestPage";

/*
 * A FIRE DRILL: A MONITOR'S FAILURE, REHEARSED AS A TEST (#7012).
 *
 * "If this monitor goes down, will the right people be paged?" A test of one
 * policy answers it for that policy; a fire drill answers it for the
 * monitor. Pick what fails - an incident or an alert one of its criteria
 * opens, at its severity - and it test-pages every on-call policy that
 * failure would page: one policy test each (OnCallTestPage), started
 * together, their results shown side by side.
 *
 *   - WHICH POLICIES. Exactly the ones "When this goes down" says the
 *     failure pages (WhoIsToldService): the policies the criteria names and
 *     the ones the project's on-call rules add, matched by the rule engines'
 *     own matching (getMatchingRules) - the code a real failure is paged by.
 *     Read afresh as the drill starts, never from the dialog's copy.
 *   - A TEST, AND NOTHING ELSE. Each policy's first level is paged as a test
 *     of the policy pages it: every message says TEST first, on every
 *     channel, and nothing is wrong. No incident or alert is created, so no
 *     status page shows it, no subscriber is told, no monitor's status,
 *     uptime or SLO moves, no workflow starts and no channel is posted to.
 *   - WHO MAY RUN ONE. Whoever may test each of its policies - as editing
 *     the policy is asked (TestSendAccess.assertMaySendTestOfSetting) - and
 *     may read the monitor. A drill with a policy the caller may not test is
 *     not started at all: a drill that skipped one would say all is well.
 *   - HOW OFTEN. Each policy's own window (one test of a policy every five
 *     minutes) and the project's hour, one test for each policy - claimed
 *     all or nothing, so a drill never pages some policies and is refused
 *     the rest.
 *   - HOW FAR (#9385). Each policy's first level, or - when the drill walks
 *     every escalation level - each level in turn, as a walked test of the
 *     policy pages them, until somebody acknowledges it.
 *   - WHAT IT KEEPS (#9386). Each policy's test is kept in that policy's
 *     execution logs with the drill, the monitor and the failure it
 *     rehearsed, so the monitor's card says how its last drill went.
 *
 * The dialog says all of it before anything is sent: that it is a test,
 * which policies it pages, and who each one pages now, and how.
 */

/*
 * The incident an alert incident rule declares from an alert of the
 * criteria (#9397), as a drill offers it: the rule - its name empty while
 * the reader may not read it - and how long the alert stays open first; 0
 * when it is declared right away. A drill tests the incident's policies at
 * once, without the wait.
 */
export interface OnCallFireDrillDeclaration {
  ruleName: string;
  waitInMinutes: number;
}

/*
 * One failure of the monitor a drill can rehearse: an incident or an alert
 * one of its criteria opens, or the incident an alert incident rule
 * declares from such an alert (declaredBy).
 */
export interface OnCallFireDrillEvent {
  // What the drill is asked for by: the criteria and the template, as read now.
  key: string;
  criteriaName: string;
  recordKind: OnCallTestPageRecordKind;
  severityName: string;
  // Its title, as "When this goes down" renders it.
  title: string;
  // How many on-call policies it pages.
  policyCount: number;
  // The incident an alert incident rule declares (#9397). Absent otherwise.
  declaredBy?: OnCallFireDrillDeclaration | undefined;
}

// One policy a drill pages.
export interface OnCallFireDrillPolicy {
  policyId: string;
  // Empty while the caller may not read the policy.
  policyName: string;
  /*
   * The caller may test the policy, as editing it is asked: only then is
   * who it pages read, and only then may the drill start.
   */
  mayTest: boolean;
  /*
   * Who its first level pages right now, and how - read as the policy's own
   * test reads it (OnCallTestPageService.getPreview) - with the levels after
   * it that a walk of every level reaches (walkLevels, #9385). Absent while
   * the caller may not test it.
   */
  preview?: OnCallTestPagePreview | undefined;
}

// What a drill will do, before it is started.
export interface OnCallFireDrillPreview {
  monitorId: string;
  monitorName: string;
  // Every failure of the monitor that pages a policy, in the order its criteria are checked.
  events: Array<OnCallFireDrillEvent>;
  // The failure this preview is of: the one asked for, or the first.
  eventKey: string;
  policies: Array<OnCallFireDrillPolicy>;
  // What the whole drill costs on OneUptime Cloud: every policy's first level.
  cost: OnCallTestPageCost;
  /*
   * What it costs at most when it walks every escalation level (#9385):
   * every policy's first level and each level its walk reaches. Absent from
   * an older server's preview.
   */
  walkCost?: OnCallTestPageCost | undefined;
}

// One policy's test, once the drill is started.
export interface OnCallFireDrillRun {
  policyId: string;
  policyName: string;
  // The test's run: its result is read by it (OnCallTestPageResult).
  executionLogId: string;
}

export interface OnCallFireDrillStarted {
  /*
   * The drill, as its tests are kept with it (#9386). Absent from an older
   * server's answer.
   */
  fireDrillId?: string | undefined;
  runs: Array<OnCallFireDrillRun>;
}

/*
 * WHAT A DRILL KEEPS OF THE FAILURE IT REHEARSED (#9386), on each of its
 * tests (OnCallDutyPolicyExecutionLog.testPageFireDrillFailure): the
 * criteria's name as it was then - the kind and severity are the test's
 * own - and, for the incident an alert incident rule declares (#9397), how
 * long the alert stays open first.
 */
export interface OnCallFireDrillFailureRecord {
  criteriaName: string;
  // Absent for an incident or alert the criteria opens itself.
  declaredAfterMinutes?: number | undefined;
}

/*
 * A MONITOR'S LAST FIRE DRILL (#9386): when it ran, who ran it, the failure
 * it rehearsed, and what became of each policy's test - read by somebody who
 * may read the monitor and every one of those tests in its policy's
 * execution logs (OnCallFireDrillHistoryService).
 */
export interface OnCallFireDrillRecord {
  fireDrillId: string;
  monitorId: string;
  // When it was started, as an ISO date.
  startedAt: string;
  // Who started it; empty when they are gone.
  startedByName: string;
  failure: {
    criteriaName: string;
    recordKind: OnCallTestPageRecordKind;
    severityName: string;
    declaredAfterMinutes?: number | undefined;
  };
  // It walked every escalation level of each policy (#9385).
  walksEscalation: boolean;
  // Each policy's test, in the order the drill started them.
  runs: Array<OnCallTestPageResultSummary>;
}

// The answer of GET .../fire-drill/last: none when there is none to read.
export interface OnCallFireDrillLast {
  fireDrill: OnCallFireDrillRecord | null;
}

// The last part of a declared incident's key (getOnCallFireDrillEventKey).
export const ON_CALL_FIRE_DRILL_DECLARED_KEY_PART: string = "declared";

/*
 * What a failure is asked for by: its criteria, the kind and template of
 * what it opens, and where it sits among the criteria's - so a monitor
 * edited between the preview and the start (its criteria reordered, a
 * template removed) is told apart, and nothing is paged by an old copy.
 * The incident an alert incident rule declares from an alert (#9397) has
 * no template of its own: it is asked for by its alert's, with the
 * Incident kind and "declared" after, never as its alert.
 */
export function getOnCallFireDrillEventKey(data: {
  criteriaId: string;
  recordKind: OnCallTestPageRecordKind;
  templateId: string | undefined;
  index: number;
  isDeclared?: boolean | undefined;
}): string {
  return [
    data.criteriaId,
    data.recordKind,
    data.templateId || "",
    String(data.index),
    ...(data.isDeclared ? [ON_CALL_FIRE_DRILL_DECLARED_KEY_PART] : []),
  ].join(":");
}

// A failure of the monitor that pages at least one policy, as "When this goes down" reads it.
export interface OnCallFireDrillFailure {
  key: string;
  criteria: WhoIsToldCriteria;
  event: WhoIsToldEvent;
  /*
   * The alert incident rule's declaration it is (#9397): `event` is the
   * incident it declares from an alert of the criteria.
   */
  declaration?: WhoIsToldDeclaration | undefined;
}

/*
 * Whether a drill can rehearse an incident or alert: one the reader may see
 * (a private record that is not theirs is never offered, #7213), that pages
 * a policy and says the severity to test it at.
 */
function isDrillable(event: WhoIsToldEvent): boolean {
  return (
    event.isHidden !== true &&
    event.policies.length > 0 &&
    Boolean(event.severityId)
  );
}

/*
 * The failures of a "When this goes down" answer a drill can rehearse: each
 * incident or alert a criteria opens that pages a policy, and after an
 * alert the incident an alert incident rule declares from it (#9397), a
 * failure of its own - each keyed as the drill asks for it
 * (getOnCallFireDrillEventKey). An alert the reader may not see says
 * nothing of what it declares.
 */
export function getOnCallFireDrillFailures(
  result: WhoIsToldResult,
): Array<OnCallFireDrillFailure> {
  const failures: Array<OnCallFireDrillFailure> = [];

  for (const criteria of result.criteria) {
    criteria.events.forEach((event: WhoIsToldEvent, index: number): void => {
      if (isDrillable(event)) {
        failures.push({
          key: getOnCallFireDrillEventKey({
            criteriaId: criteria.id,
            recordKind: event.kind,
            templateId: event.id,
            index: index,
          }),
          criteria: criteria,
          event: event,
        });
      }

      const declaration: WhoIsToldDeclaration | undefined = event.declares;

      if (
        !declaration ||
        event.isHidden === true ||
        !isDrillable(declaration.incident)
      ) {
        return;
      }

      failures.push({
        key: getOnCallFireDrillEventKey({
          criteriaId: criteria.id,
          recordKind: declaration.incident.kind,
          templateId: event.id,
          index: index,
          isDeclared: true,
        }),
        criteria: criteria,
        event: declaration.incident,
        declaration: declaration,
      });
    });
  }

  return failures;
}

// Whether a monitor has a failure a drill can rehearse: one that pages a policy.
export function hasOnCallFireDrill(result: WhoIsToldResult): boolean {
  return getOnCallFireDrillFailures(result).length > 0;
}

/*
 * THE WORDS A REFUSAL SAYS, in English as every refusal of the server is
 * (the Dashboard shows them as written).
 */
export const ON_CALL_FIRE_DRILL_NOT_ALLOWED_MESSAGE: string =
  "A fire drill tests every on-call policy this failure pages, so it needs you to be able to test each of them: that is, to edit them. Ask a Project Admin, or the policies' owners.";

export const ON_CALL_FIRE_DRILL_NOTHING_TO_PAGE_MESSAGE: string =
  "Nothing this monitor opens pages an on-call policy, so a fire drill has nothing to test. Add an on-call policy to an incident or alert of its criteria, or an on-call rule that matches one.";

export const ON_CALL_FIRE_DRILL_FAILURE_CHANGED_MESSAGE: string =
  "This monitor's criteria or on-call rules changed since the fire drill was opened, so nothing was paged. Open the fire drill again to see what it pages now.";

/*
 * A policy of the drill tested a moment ago: its window refuses the whole
 * drill, by the policy's name when the caller may read it.
 */
export function getOnCallFireDrillPolicyTooSoonMessage(data: {
  policyName: string;
  waitInSeconds: number;
}): string {
  const wait: string = describeOnCallTestPageWait(data.waitInSeconds);

  return data.policyName
    ? `On-call policy ${data.policyName} was tested a moment ago, so the fire drill was not started. Wait ${wait}, then run it again.`
    : `An on-call policy of this fire drill was tested a moment ago, so the fire drill was not started. Wait ${wait}, then run it again.`;
}
