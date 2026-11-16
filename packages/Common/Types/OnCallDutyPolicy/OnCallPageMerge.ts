import ObjectID from "../ObjectID";
import {
  OnCallAcknowledgePageRun,
  isOnCallPageEndedOnlyByAnAnswer,
} from "./OnCallAcknowledgePage";
import { isOnCallDirectPage } from "./OnCallDirectPage";
import { isOnCallObserverPage } from "./OnCallObserverPage";
import { isOnCallTestPage } from "./OnCallTestPage";

/*
 * ONE PAGE FOR SOMEBODY TWO POLICIES PAGE ABOUT ONE RECORD (issue #7837).
 *
 * An incident, an alert or an episode runs each of its on-call policies on
 * its own (#7596): Team A's and Team B's, each with fallback levels of its
 * own. Somebody on call in both was paged by both - two pushes, two calls,
 * two texts - though the second set said nothing the first had not. Within
 * one policy it was never so: a level that names somebody twice pages them
 * once (OnCallDutyPolicyEscalationRuleService, uniqueUserIds).
 *
 * Now a person's page is MERGED into their open page about the same record
 * from another policy's run, when a level reaches them:
 *
 *   - it sends nothing of its own: their open page's notifications stand for
 *     both. The person's log of it (UserOnCallLog) and the run's line for
 *     them say "Already Paged", naming the policy that is paging them, so
 *     the execution log, the record's feed and the run's Slack and
 *     Microsoft Teams message say why it sent nothing;
 *   - the level still waits its minutes before its next level, as a level
 *     that paged somebody does: the person was reached, by the other page.
 *     It is no level that paged nobody (OnCallEmptyLevel), which passes at
 *     once;
 *   - answering that one page answers it for every run it stands for: each
 *     merged page is acknowledged by them too, and its run records them as
 *     who acknowledged it (UserOnCallLogTimelineService.acknowledgePage);
 *   - nobody misses a page for it. Their open page can end without their
 *     answer while this run still needs them: they escalated it from one of
 *     its messages (which escalates that policy only), it failed, or its run
 *     stopped. Then the merged page takes the page over within a minute and
 *     pages them itself, from where the other left off: what the other page
 *     sent counts as sent, the rest of their On-Call Rules go out on this
 *     page's own clock - all of them, when the other page failed. Nothing is
 *     sent when the other page had sent everything already. Acknowledging
 *     the record ends a merged page as it ends any page of its kind.
 *
 * WHICH PAGES ARE MERGED (isOnCallPageMergeable): a page of a policy's run
 * that ends once its record is acknowledged - a run OneUptime started for
 * the record, or one a workflow or an API key started. Never:
 *
 *   - a page again (OnCallAcknowledgementTimeout): it pages again on
 *     purpose;
 *   - a policy a person started by hand (OnCallPolicyStartedByHand): it is
 *     asked for, its notifications say who started it and carry their
 *     message, and it goes on until one of its own people answers it - so
 *     it never counts another run's page as its own;
 *   - a page a person sent from Slack or Microsoft Teams (OnCallPersonPage),
 *     for the same reasons, and any other direct page: it names who it
 *     pages, and no policy;
 *   - an observer's page (OnCallObserverPage): an observer's page and a
 *     responder's page are never merged;
 *   - a test page (OnCallTestPage), which has no record.
 *
 * WHICH PAGES THEY ARE MERGED INTO (isOnCallPageACover): the person's page
 * from another policy's run about the same record, of the same kind
 * (userNotificationEventType), not answered, not escalated and not failed,
 * that is still open: its notifications are still going out, or its run is
 * still paging. Any responder's page of a policy may be one, a page again
 * and a policy started by hand included - each lasts at least as long as a
 * page that ends on the acknowledgement. Never an observer's page, a direct
 * page or a test page. Of two, the earlier: the person's first page.
 *
 * It is always on: nobody misses a page for it, and the second set of
 * notifications told them nothing new.
 *
 * React-free and server-safe: the server, the Dashboard and their tests read
 * it.
 */

// A run, read with what tells the kinds of page apart.
export interface OnCallPageMergeRun extends OnCallAcknowledgePageRun {
  onCallDutyPolicyId?: ObjectID | string | null | undefined;
  onCallDutyPolicy?: unknown;
}

/*
 * Whether a run's page of a person may be merged into their open page from
 * another policy's run (see above).
 */
export function isOnCallPageMergeable(
  run: OnCallPageMergeRun | null | undefined,
): boolean {
  if (!run) {
    return false;
  }

  return (
    !isOnCallDirectPage(run) &&
    !isOnCallTestPage(run) &&
    !isOnCallPageEndedOnlyByAnAnswer(run)
  );
}

/*
 * Whether a person's page in a run can stand for the page another policy's
 * run would send them (see above).
 */
export function isOnCallPageACover(
  run: OnCallPageMergeRun | null | undefined,
): boolean {
  if (!run) {
    return false;
  }

  return (
    !isOnCallDirectPage(run) &&
    !isOnCallTestPage(run) &&
    !isOnCallObserverPage(run)
  );
}

/*
 * The other policy, when its name is not known: a page merged into a page
 * whose policy has since lost its name.
 */
export const ON_CALL_PAGE_MERGE_UNNAMED_POLICY: string =
  "another on-call policy";

const MERGED_MESSAGE_START: string = "Already paged about this by ";
const MERGED_MESSAGE_END: string = ", so not paged again.";

const TAKEN_OVER_MESSAGE_START: string = "Their page from ";
const TAKEN_OVER_MESSAGE_END: string =
  " is over, so this policy pages them now.";

function getPolicyNameInMessage(policyName: string | null | undefined): string {
  return (policyName || "").trim() || ON_CALL_PAGE_MERGE_UNNAMED_POLICY;
}

/*
 * A merged page's line, on the person's log and on the run's timeline:
 * "Already paged about this by Payments, so not paged again."
 */
export function getOnCallPageMergedMessage(data: {
  policyName: string | null | undefined;
}): string {
  return `${MERGED_MESSAGE_START}${getPolicyNameInMessage(data.policyName)}${MERGED_MESSAGE_END}`;
}

/*
 * The line of a merged page that took the page over (see above): "Their page
 * from Payments is over, so this policy pages them now."
 */
export function getOnCallPageMergeTakenOverMessage(data: {
  policyName: string | null | undefined;
}): string {
  return `${TAKEN_OVER_MESSAGE_START}${getPolicyNameInMessage(data.policyName)}${TAKEN_OVER_MESSAGE_END}`;
}

/*
 * The policy a line names between its fixed words, as written; null for any
 * other line. The name is whatever lies between them, so a name with a
 * comma or a full stop in it reads back whole.
 */
function readPolicyNameBetween(
  message: string | null | undefined,
  start: string,
  end: string,
): string | null {
  const line: string = (message || "").trim();

  if (
    !line.startsWith(start) ||
    !line.endsWith(end) ||
    line.length <= start.length + end.length
  ) {
    return null;
  }

  const name: string = line.slice(start.length, line.length - end.length);

  return name.trim() ? name : null;
}

/*
 * The other policy a merged page's line names - "Payments" - or null when
 * the line is no merged page's. ON_CALL_PAGE_MERGE_UNNAMED_POLICY when it
 * names none.
 */
export function readOnCallPageMergedMessage(
  message: string | null | undefined,
): string | null {
  return readPolicyNameBetween(
    message,
    MERGED_MESSAGE_START,
    MERGED_MESSAGE_END,
  );
}

// The other policy the line of a page that took the page over names.
export function readOnCallPageMergeTakenOverMessage(
  message: string | null | undefined,
): string | null {
  return readPolicyNameBetween(
    message,
    TAKEN_OVER_MESSAGE_START,
    TAKEN_OVER_MESSAGE_END,
  );
}
