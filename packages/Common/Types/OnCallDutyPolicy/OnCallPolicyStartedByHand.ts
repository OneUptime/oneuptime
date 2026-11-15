import ObjectID from "../ObjectID";
import {
  OnCallPageAgainRun,
  isOnCallPageAgainRun,
} from "./OnCallAcknowledgementTimeout";
import {
  OnCallObserverPageRun,
  isOnCallObserverPage,
} from "./OnCallObserverPage";
import { OnCallTestPageRun, isOnCallTestPage } from "./OnCallTestPage";

/*
 * AN ON-CALL POLICY A PERSON STARTED BY HAND.
 *
 * Somebody started an on-call policy for an incident, an alert or an episode
 * that is there already: its Execute On-Call Policy in the Dashboard, the
 * same in Slack or Microsoft Teams, a page that names the policy
 * (`/oneuptime page`), or the API signed in as them. The policies OneUptime
 * starts on its own - a new record's, a rule's - end once anybody
 * acknowledges the record: somebody is on it, and nobody else needs paging.
 *
 * A policy started by hand is asked for, like a page a person asked for
 * (OnCallPersonPage), and ends the same way: IT GOES ON UNTIL ONE OF THE
 * PEOPLE IT PAGED ANSWERS IT, OR ITS RECORD IS RESOLVED. Somebody else
 * acknowledging the record does not stop it. A policy is mostly started by
 * hand on a record somebody is on already - for more hands, for another
 * team - and a run that stopped because the record was acknowledged reached
 * its first level's first notifications only, and ended within a minute: no
 * later notification of their On-Call Rules, no next level, no repeat
 * (https://github.com/OneUptime/oneuptime/issues/7596). Answering it - its
 * link, a call's 1, a text, Acknowledge again in the Dashboard or the app,
 * Acknowledge on its record - acknowledges the record too when nobody has
 * yet, and stops the policy for everybody it paged.
 *
 * None of these is one: a run OneUptime started (no person), one a workflow
 * started, a page again (OnCallAcknowledgementTimeout), an observer's page
 * (OnCallObserverPage), which has a rule of its own, and a test page
 * (OnCallTestPage).
 *
 * Nobody starts a policy by hand for a record that is resolved: nobody is
 * needed any more, and its first level would be paged about it all the same
 * before the run ended (getOnCallPolicyStartedOnResolvedRecordMessage).
 *
 * This file holds the rule and its words, for the server and the docs
 * tests. It imports nothing that needs a server or React.
 */

// A run, read with what tells a policy started by hand apart.
export interface OnCallPolicyStartedByHandRun
  extends OnCallPageAgainRun,
    OnCallObserverPageRun,
    OnCallTestPageRun {
  onCallDutyPolicyId?: ObjectID | string | null | undefined;
  onCallDutyPolicy?: unknown;
  triggeredByUserId?: ObjectID | string | null | undefined;
  triggeredByWorkflowId?: ObjectID | string | null | undefined;
}

/*
 * Whether a run is an on-call policy a person started by hand: a policy, by
 * its id or by the policy read with it, started by a person with no workflow
 * behind it, that is not a page again, an observer's page or a test page.
 * Asked only of a run read with every one of those columns: one read
 * without them could look like one, or not look like one.
 */
export function isOnCallPolicyStartedByHand(
  run: OnCallPolicyStartedByHandRun | null | undefined,
): boolean {
  if (!run) {
    return false;
  }

  if (!run.onCallDutyPolicyId && !run.onCallDutyPolicy) {
    return false;
  }

  if (!run.triggeredByUserId || run.triggeredByWorkflowId) {
    return false;
  }

  return (
    !isOnCallPageAgainRun(run) &&
    !isOnCallObserverPage(run) &&
    !isOnCallTestPage(run)
  );
}

/*
 * Why a person's request to start a policy for a resolved record started
 * nothing - "This incident is resolved, so no on-call policy was started." -
 * as Slack and Microsoft Teams say it of their own Execute On-Call Policy.
 * `recordKind` is the record in words: "incident", "alert", "incident
 * episode", "alert episode".
 */
export function getOnCallPolicyStartedOnResolvedRecordMessage(
  recordKind: string,
): string {
  return `This ${recordKind} is resolved, so no on-call policy was started.`;
}
