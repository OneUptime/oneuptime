import ObjectID from "../ObjectID";
import {
  OnCallAcknowledgePageRun,
  isOnCallPageEndedOnlyByAnAnswer,
} from "./OnCallAcknowledgePage";
import { isOnCallDirectPage } from "./OnCallDirectPage";
import { isOnCallObserverPage } from "./OnCallObserverPage";
import { isOnCallPersonPage } from "./OnCallPersonPage";
import { isOnCallTestPage } from "./OnCallTestPage";

/*
 * ONE PAGE FOR SOMEBODY TWO PAGES REACH ABOUT ONE RECORD (issues #7837,
 * #8859).
 *
 * An incident, an alert or an episode runs each of its on-call policies on
 * its own (#7596): Team A's and Team B's, each with fallback levels of its
 * own. Somebody on call in both was paged by both - two pushes, two calls,
 * two texts - though the second set said nothing the first had not. Within
 * one policy it was never so: a level that names somebody twice pages them
 * once (OnCallDutyPolicyEscalationRuleService, uniqueUserIds). And a direct
 * page - people paged with no policy behind the page, from Slack or
 * Microsoft Teams or by a workflow's Page Users, Page a Team or Page
 * Whoever Is On Call step (OnCallDirectPage) - paged on top of a policy, or
 * a policy on top of it (#8859).
 *
 * Now a person's page is MERGED into their open page about the same record
 * from another run, when a level - or a workflow's direct page - reaches
 * them:
 *
 *   - it sends nothing of its own: their open page's notifications stand for
 *     both. The person's log of it (UserOnCallLog) and the run's line for
 *     them say "Already Paged", naming what is paging them - the policy, the
 *     person who paged them from a chat, or the workflow - so the execution
 *     log, the record's feed and the run's Slack and Microsoft Teams message
 *     say why it sent nothing;
 *   - a policy's level still waits its minutes before its next level, as a
 *     level that paged somebody does: the person was reached, by the other
 *     page. It is no level that paged nobody (OnCallEmptyLevel), which
 *     passes at once. A direct page stays open while a merged page of it
 *     waits, as it does while its own pages are out;
 *   - answering that one page answers it for every run it stands for: each
 *     merged page is acknowledged by them too, and its run records them as
 *     who acknowledged it (UserOnCallLogTimelineService.acknowledgePage);
 *   - nobody misses a page for it. Their open page can end without their
 *     answer while this run still needs them: they escalated it from one of
 *     its messages (which escalates that page only), it failed, or its run
 *     stopped. Then the merged page takes the page over within a minute and
 *     pages them itself, from where the other left off: what the other page
 *     sent counts as sent, the rest of their On-Call Rules go out on this
 *     page's own clock - all of them, when the other page failed. Nothing is
 *     sent when the other page had sent everything already. Acknowledging
 *     the record ends a merged page as it ends any page of its kind.
 *
 * WHICH PAGES ARE MERGED (isOnCallPageMergeable): a page of a run that ends
 * once its record is acknowledged - a policy's run OneUptime started for the
 * record, one a workflow or an API key started, and a workflow's direct
 * page, whose notifications are worded as a page OneUptime starts (#8859).
 * Never:
 *
 *   - a page again (OnCallAcknowledgementTimeout): it pages again on
 *     purpose;
 *   - a policy a person started by hand (OnCallPolicyStartedByHand): it is
 *     asked for, its notifications say who started it and carry their
 *     message, and it goes on until one of its own people answers it - so
 *     it never counts another run's page as its own;
 *   - a page a person sent from Slack or Microsoft Teams (OnCallPersonPage),
 *     for the same reasons;
 *   - an observer's page (OnCallObserverPage): an observer's page and a
 *     responder's page are never merged;
 *   - a test page (OnCallTestPage), which has no record.
 *
 * WHICH PAGES THEY ARE MERGED INTO (isOnCallPageACover): the person's page
 * from another run about the same record, of the same kind
 * (userNotificationEventType), not answered, not escalated and not failed,
 * that is still open: its notifications are still going out, or its run is
 * still paging. Any responder's page may be one - a policy's (a page again
 * and a policy started by hand included), a page a person sent from a chat,
 * a workflow's direct page: each lasts at least as long as a page that ends
 * on the acknowledgement. Never an observer's page or a test page. Of two,
 * the earlier: the person's first page. A direct page that names nobody who
 * started it stands for nothing: its line would have nobody to name.
 *
 * It is always on: nobody misses a page for it, and the second set of
 * notifications told them nothing new.
 *
 * React-free and server-safe: the server, the Dashboard and their tests read
 * it. The mobile app keeps a copy of how it reads the lines below
 * (MobileApp/src/oncall/mergedPage), which OnCallPageMergeMobileParity holds
 * to these.
 */

// A run, read with what tells the kinds of page apart.
export interface OnCallPageMergeRun extends OnCallAcknowledgePageRun {
  onCallDutyPolicyId?: ObjectID | string | null | undefined;
  onCallDutyPolicy?: unknown;
}

/*
 * Whether a run's page of a person may be merged into their open page from
 * another run (see above).
 */
export function isOnCallPageMergeable(
  run: OnCallPageMergeRun | null | undefined,
): boolean {
  if (!run) {
    return false;
  }

  return !isOnCallTestPage(run) && !isOnCallPageEndedOnlyByAnAnswer(run);
}

/*
 * Whether a person's page in a run can stand for the page another run would
 * send them (see above).
 */
export function isOnCallPageACover(
  run: OnCallPageMergeRun | null | undefined,
): boolean {
  if (!run) {
    return false;
  }

  return !isOnCallTestPage(run) && !isOnCallObserverPage(run);
}

/*
 * WHAT A PAGE IS MERGED INTO, BY KIND (#8859): what its line names.
 */
export enum OnCallPageCoverKind {
  // Another on-call policy's run: the policy, by its name.
  Policy = "Policy",
  /*
   * A page a person sent from Slack or Microsoft Teams (OnCallPersonPage):
   * who sent it, by their name.
   */
  PersonPage = "PersonPage",
  /*
   * Any other direct page: a workflow's Page Users, Page a Team or Page
   * Whoever Is On Call step, by the workflow's name.
   */
  WorkflowPage = "WorkflowPage",
}

// What a merged page's line names: what kind of page, and its name.
export interface OnCallPageCoverName {
  kind: OnCallPageCoverKind;
  // As written; null when it has none.
  name: string | null;
}

/*
 * The kind of page a run's page is, as a line names it: a policy's, a page
 * a person sent, or a workflow's direct page. Asked of a run read as
 * isOnCallPersonPage asks.
 */
export function getOnCallPageCoverKind(
  run: OnCallPageMergeRun,
): OnCallPageCoverKind {
  if (!isOnCallDirectPage(run)) {
    return OnCallPageCoverKind.Policy;
  }

  return isOnCallPersonPage(run)
    ? OnCallPageCoverKind.PersonPage
    : OnCallPageCoverKind.WorkflowPage;
}

/*
 * The other policy, when its name is not known: a page merged into a page
 * whose policy has since lost its name.
 */
export const ON_CALL_PAGE_MERGE_UNNAMED_POLICY: string =
  "another on-call policy";

const MERGED_MESSAGE_START: string = "Already paged about this by ";
const MERGED_MESSAGE_END: string = ", so not paged again.";

/*
 * Merged into a direct page (#8859). No line's start begins another's - each
 * parts from the others before its name - so a line is read as one kind
 * only, whatever its name holds: a policy called "the workflow Nightly", a
 * person called "Payments".
 */
const MERGED_DIRECTLY_MESSAGE_START: string =
  "Already paged directly about this by ";
const MERGED_BY_WORKFLOW_MESSAGE_START: string =
  "Already paged about this through the workflow ";

const TAKEN_OVER_MESSAGE_START: string = "Their page from ";
const TAKEN_OVER_MESSAGE_END: string =
  " is over, so this policy pages them now.";
// The line of a merged direct page that took the page over (#8859).
const TAKEN_OVER_DIRECTLY_MESSAGE_END: string =
  " is over, so they are paged directly now.";

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
 * A merged page's line, for whatever kind of page it is merged into (#8859):
 *
 *   Already paged about this by Payments, so not paged again.
 *   Already paged directly about this by Jane Doe, so not paged again.
 *   Already paged about this through the workflow Nightly Checks, so not
 *     paged again.
 *
 * A direct page is only merged into while it names who started it
 * (OnCallPageMerge.findCovers), so one with no name is worded as a policy
 * with none.
 */
export function getOnCallPageMergedLine(cover: OnCallPageCoverName): string {
  const name: string = (cover.name || "").trim();

  if (name && cover.kind === OnCallPageCoverKind.PersonPage) {
    return `${MERGED_DIRECTLY_MESSAGE_START}${name}${MERGED_MESSAGE_END}`;
  }

  if (name && cover.kind === OnCallPageCoverKind.WorkflowPage) {
    return `${MERGED_BY_WORKFLOW_MESSAGE_START}${name}${MERGED_MESSAGE_END}`;
  }

  return getOnCallPageMergedMessage({
    policyName: cover.kind === OnCallPageCoverKind.Policy ? name : null,
  });
}

/*
 * The line of a merged page that took the page over (see above): "Their page
 * from Payments is over, so this policy pages them now." A merged direct
 * page (#8859): "... so they are paged directly now." `policyName` is what
 * the other page's line named it by - a policy's name, a person's, a
 * workflow's.
 */
export function getOnCallPageMergeTakenOverMessage(data: {
  policyName: string | null | undefined;
  // The page that takes the page over is a direct page's, with no policy.
  isDirectPage?: boolean | undefined;
}): string {
  return `${TAKEN_OVER_MESSAGE_START}${getPolicyNameInMessage(data.policyName)}${
    data.isDirectPage ? TAKEN_OVER_DIRECTLY_MESSAGE_END : TAKEN_OVER_MESSAGE_END
  }`;
}

/*
 * The name a line gives between its fixed words, as written; null for any
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
 * the line is no merged page's, or a page merged into a direct page's.
 * ON_CALL_PAGE_MERGE_UNNAMED_POLICY when it names none.
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

/*
 * What a merged page's line names, of any kind (#8859): a policy - with no
 * name for one that names none - a person who paged them directly, or a
 * workflow. Null for any other line.
 */
export function readOnCallPageMergedLine(
  message: string | null | undefined,
): OnCallPageCoverName | null {
  const workflowName: string | null = readPolicyNameBetween(
    message,
    MERGED_BY_WORKFLOW_MESSAGE_START,
    MERGED_MESSAGE_END,
  );

  if (workflowName !== null) {
    return { kind: OnCallPageCoverKind.WorkflowPage, name: workflowName };
  }

  const personName: string | null = readPolicyNameBetween(
    message,
    MERGED_DIRECTLY_MESSAGE_START,
    MERGED_MESSAGE_END,
  );

  if (personName !== null) {
    return { kind: OnCallPageCoverKind.PersonPage, name: personName };
  }

  const policyName: string | null = readOnCallPageMergedMessage(message);

  if (policyName !== null) {
    return {
      kind: OnCallPageCoverKind.Policy,
      name:
        policyName === ON_CALL_PAGE_MERGE_UNNAMED_POLICY ? null : policyName,
    };
  }

  return null;
}

// The other page the line of a page that took the page over names.
export function readOnCallPageMergeTakenOverMessage(
  message: string | null | undefined,
): string | null {
  return readPolicyNameBetween(
    message,
    TAKEN_OVER_MESSAGE_START,
    TAKEN_OVER_MESSAGE_END,
  );
}

// The same, for a merged direct page that took the page over (#8859).
export function readOnCallPageMergeTakenOverDirectlyMessage(
  message: string | null | undefined,
): string | null {
  return readPolicyNameBetween(
    message,
    TAKEN_OVER_MESSAGE_START,
    TAKEN_OVER_DIRECTLY_MESSAGE_END,
  );
}
