/*
 * A PAGE MERGED INTO ANOTHER PAGE OF YOURS ABOUT THE SAME RECORD.
 *
 * When two of an incident's on-call policies page the same person - or a
 * policy and a page somebody sent from Slack, Microsoft Teams or a workflow
 * do - the second page of them is merged into their open page from the
 * first (the server's Common/Types/OnCallDutyPolicy/OnCallPageMerge): it
 * sends nothing of its own, its status is "Already Paged", and its line
 * says what is paging them already:
 *
 *   Already paged about this by Payments, so not paged again.
 *   Already paged directly about this by Jane Doe, so not paged again.
 *   Already paged about this through the workflow Nightly Checks, so not
 *     paged again.
 *
 * Answering that open page answers the merged one too. Should the open page
 * end without their answer - they escalated it from one of its messages, it
 * failed, its policy stopped - the merged page takes the page over and pages
 * them itself, and its status moves on to paging again.
 *
 * So My Pages draws it as what it is (components/OnCallPageCard.tsx): "Already
 * paged", in a calm tone, never "Not acknowledged", with a line that says
 * which page to answer - and it is not among the pages that need a response
 * (screens/MyOnCallPagesScreen.tsx): the page it stands on is. Once it takes
 * the page over it is a page like any other.
 *
 * The app is built without Common's code, so it keeps its own copy of the
 * status's stored value and of how the server's line reads back; Common's
 * OnCallPageMergeMobileParity holds both to the server's, line for line.
 * This file imports nothing, so that suite can run it as it is.
 */

export const MERGED_PAGE_TEXT: Readonly<{
  status: string;
  label: string;
}> = {
  // The page's status on the server (UserNotificationExecutionStatus.AlreadyPaged)...
  status: "Already Paged",
  // ...and the label My Pages shows for it: the Dashboard's, in the app's case.
  label: "Already paged",
};

// What a merged page stands on, as its line names it.
export type MergedPageCover =
  // Another on-call policy's page: its name - none when the line names none.
  | { kind: "policy"; name: string | null }
  // A page somebody sent from Slack or Microsoft Teams: who sent it.
  | { kind: "person"; name: string }
  // A workflow's page: the workflow.
  | { kind: "workflow"; name: string };

// The server's fixed words around the name (OnCallPageMerge).
const LINE_END: string = ", so not paged again.";
const BY_POLICY_START: string = "Already paged about this by ";
const BY_PERSON_START: string = "Already paged directly about this by ";
const BY_WORKFLOW_START: string =
  "Already paged about this through the workflow ";
const UNNAMED_POLICY: string = "another on-call policy";

// The name between a line's fixed words, as written; null for any other line.
function readNameBetween(
  line: string,
  start: string,
  end: string,
): string | null {
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
 * What a merged page's line names, or null for any other line - one that
 * took the page over, or a page's own.
 */
export function readMergedPageCover(
  statusMessage: string | null | undefined,
): MergedPageCover | null {
  const line: string = (statusMessage || "").trim();

  const workflow: string | null = readNameBetween(
    line,
    BY_WORKFLOW_START,
    LINE_END,
  );

  if (workflow !== null) {
    return { kind: "workflow", name: workflow };
  }

  const person: string | null = readNameBetween(
    line,
    BY_PERSON_START,
    LINE_END,
  );

  if (person !== null) {
    return { kind: "person", name: person };
  }

  const policy: string | null = readNameBetween(
    line,
    BY_POLICY_START,
    LINE_END,
  );

  if (policy !== null) {
    return {
      kind: "policy",
      name: policy === UNNAMED_POLICY ? null : policy,
    };
  }

  return null;
}

// Whether a page of the reader's is merged into another of theirs, and waits on it.
export function isMergedPage(page: {
  status?: string | undefined;
  acknowledgedAt?: string | null | undefined;
}): boolean {
  return page.status === MERGED_PAGE_TEXT.status && !page.acknowledgedAt;
}

/*
 * What My Pages says under a merged page: which page of theirs to answer -
 * "Answering your page from Payments answers this one too." A line the app
 * cannot read is shown as the server wrote it; none, nothing.
 */
export function getMergedPageLine(
  statusMessage: string | null | undefined,
): string | null {
  const cover: MergedPageCover | null = readMergedPageCover(statusMessage);

  if (!cover) {
    return (statusMessage || "").trim() || null;
  }

  if (cover.kind === "workflow") {
    return `Answering your page from the workflow ${cover.name} answers this one too.`;
  }

  if (cover.name) {
    return `Answering your page from ${cover.name} answers this one too.`;
  }

  return "Answering your other page about this answers this one too.";
}
