import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import PublicNoteApproval, {
  PublicNoteApprovalColumns,
  PublicNoteApprovalState,
} from "Common/Types/StatusPage/PublicNoteApproval";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What the notes feed shows about a public note's approval
 * (Common/Types/StatusPage/PublicNoteApproval), and the calls it makes:
 * where each note stands, who it waits for, and the Approve, Reject, Send
 * again and Withdraw edit buttons. The server decides who may do what
 * (Server/Utils/Notes/PublicNoteApprovalEngine); this only draws it.
 *
 * React-free, so every decision here is pinned in plain tests.
 */

// Who approves one kind of note, as the server describes it.
export interface PublicNoteApprovalPolicySummary {
  isRequired: boolean;
  steps: Array<{
    id: string;
    number: number;
    name?: string | undefined;
    people: Array<string>;
    teams: Array<string>;
  }>;
}

export interface PublicNoteApprovalStepSummary {
  number: number;
  count: number;
  name?: string | undefined;
  isFinal: boolean;
  isAskedAgain: boolean;
  people: Array<string>;
  teams: Array<string>;
}

// Where one note stands, for the person reading it.
export interface PublicNoteApprovalNoteSummary {
  noteId: string;
  state: PublicNoteApprovalState;
  isEdit: boolean;
  submittedAt?: string | undefined;
  submittedBy?: string | undefined;
  step?: PublicNoteApprovalStepSummary | undefined;
  approvals: Array<{
    by: string;
    at: string;
    stepName?: string | undefined;
    comment?: string | undefined;
  }>;
  rejection?:
    | { by: string; at: string; reason: string; stepName?: string | undefined }
    | undefined;
  canApprove: boolean;
  canReject: boolean;
  decisionRefusal?: string | undefined;
}

export type PublicNoteApprovalTone = "waiting" | "rejected" | "approved";

export interface PublicNoteApprovalBadge {
  // An English key, looked up where it is shown.
  label: string;
  tone: PublicNoteApprovalTone;
}

export const PublicNoteApprovalCopy: {
  waiting: string;
  rejected: string;
  editWaiting: string;
  editRejected: string;
  approved: string;
  stepOf: string;
  stepOfNamed: string;
  waitingFor: string;
  nobodyToApprove: string;
  approve: string;
  approveAndPublish: string;
  reject: string;
  sendAgain: string;
  publishNow: string;
  withdrawEdit: string;
  proposedEdit: string;
  rejectedBy: string;
  approvedBy: string;
  sentBy: string;
  approveTitle: string;
  approveFinalDescription: string;
  approveStepDescription: string;
  approveEditFinalDescription: string;
  rejectTitle: string;
  rejectDescription: string;
  rejectReasonTitle: string;
  rejectReasonDescription: string;
  rejectReasonPlaceholder: string;
  withdrawTitle: string;
  withdrawDescription: string;
  composerNotice: string;
  composerNoticeApprovers: string;
  composerSubmit: string;
  editNotice: string;
  editSubmit: string;
  editFilesLocked: string;
  heldNotificationNotice: string;
  /*
   * What failed, said first for an error nobody explained
   * (ErrorExplanation): sending a note or an edit for approval, and each
   * of the approval's own actions.
   */
  sendFailed: string;
  editSendFailed: string;
  approveFailed: string;
  rejectFailed: string;
  publishFailed: string;
  withdrawEditFailed: string;
} = {
  waiting: translationKey("Waiting for approval"),
  rejected: translationKey("Rejected"),
  editWaiting: translationKey("Edit waiting for approval"),
  editRejected: translationKey("Edit rejected"),
  approved: translationKey("Approved"),
  stepOf: translationKey("Step {{number}} of {{count}}"),
  stepOfNamed: translationKey("Step {{number}} of {{count}}: {{name}}"),
  waitingFor: translationKey("Waiting for {{approvers}}"),
  nobodyToApprove: translationKey(
    "Nobody can approve this step yet. A project admin can add approvers in Settings > Public Note Approval.",
  ),
  approve: translationKey("Approve"),
  approveAndPublish: translationKey("Approve and publish"),
  reject: translationKey("Reject"),
  sendAgain: translationKey("Send for approval again"),
  publishNow: translationKey("Publish now"),
  withdrawEdit: translationKey("Withdraw edit"),
  proposedEdit: translationKey("Proposed edit"),
  rejectedBy: translationKey("Rejected by {{name}}"),
  approvedBy: translationKey("Approved by {{names}}"),
  sentBy: translationKey("Sent by {{name}}"),
  approveTitle: translationKey("Approve this public note?"),
  approveFinalDescription: translationKey(
    "It will be published on status pages right away, and subscribers will be told about it if the note says to notify them.",
  ),
  approveStepDescription: translationKey(
    "It then waits for the next approval step before it is published.",
  ),
  approveEditFinalDescription: translationKey(
    "Status pages will show the edited note right away.",
  ),
  rejectTitle: translationKey("Reject this public note?"),
  rejectDescription: translationKey(
    "It will not be published. Its author sees your reason and can change the note and send it again.",
  ),
  rejectReasonTitle: translationKey("Why are you rejecting it?"),
  rejectReasonDescription: translationKey("The author sees this."),
  rejectReasonPlaceholder: translationKey(
    "e.g. Please do not name the vendor until legal has reviewed the wording.",
  ),
  withdrawTitle: translationKey("Withdraw this edit?"),
  withdrawDescription: translationKey(
    "Status pages keep showing the note as it was approved.",
  ),
  composerNotice: translationKey(
    "Public notes need approval in this project: this note is published once it is approved.",
  ),
  composerNoticeApprovers: translationKey("Approvers: {{approvers}}"),
  composerSubmit: translationKey("Send for approval"),
  editNotice: translationKey(
    "Edits of published notes need approval: status pages keep showing the note as it was approved until your edit is approved.",
  ),
  editSubmit: translationKey("Send edit for approval"),
  editFilesLocked: translationKey(
    "The files of a published note cannot change while public notes need approval. Post a new note with the files instead.",
  ),
  heldNotificationNotice: translationKey(
    "Subscribers are told once it is published.",
  ),
  sendFailed: translationKey("Couldn't send the note for approval."),
  editSendFailed: translationKey("Couldn't send the edit for approval."),
  approveFailed: translationKey("Couldn't approve the note."),
  rejectFailed: translationKey("Couldn't reject the note."),
  publishFailed: translationKey("Couldn't publish the note."),
  withdrawEditFailed: translationKey("Couldn't withdraw the edit."),
};

// How a note reads, from the columns the feed loads.
export function getNoteApprovalState(
  note: PublicNoteApprovalColumns | null | undefined,
): PublicNoteApprovalState {
  return PublicNoteApproval.getState(note);
}

/*
 * Whether the note is on status pages: published, with or without an edit
 * waiting. A note that waits, or was rejected, is not - so its subscriber
 * notification badges say nothing yet.
 */
export function isNotePublished(state: PublicNoteApprovalState): boolean {
  return (
    state !== PublicNoteApprovalState.WaitingForApproval &&
    state !== PublicNoteApprovalState.Rejected
  );
}

/*
 * The badge a note's header carries: where it stands in approval, or
 * "Approved" for a published note an approver approved. None for every
 * other note - most notes never needed approval.
 */
export function getApprovalBadge(
  state: PublicNoteApprovalState,
  summary?: PublicNoteApprovalNoteSummary | undefined,
): PublicNoteApprovalBadge | null {
  switch (state) {
    case PublicNoteApprovalState.WaitingForApproval:
      return { label: PublicNoteApprovalCopy.waiting, tone: "waiting" };
    case PublicNoteApprovalState.Rejected:
      return { label: PublicNoteApprovalCopy.rejected, tone: "rejected" };
    case PublicNoteApprovalState.EditWaitingForApproval:
      return { label: PublicNoteApprovalCopy.editWaiting, tone: "waiting" };
    case PublicNoteApprovalState.EditRejected:
      return { label: PublicNoteApprovalCopy.editRejected, tone: "rejected" };
    default:
      return summary && summary.approvals.length > 0
        ? { label: PublicNoteApprovalCopy.approved, tone: "approved" }
        : null;
  }
}

/*
 * "Step 2 of 3: Legal" - which step a note waits for, when it has more than
 * one. Null for a single step: "waiting for approval" says it all.
 */
export function getStepTemplate(
  step: PublicNoteApprovalStepSummary | undefined,
): { template: string; values: Record<string, string> } | null {
  if (!step || step.count <= 1) {
    return null;
  }

  const values: Record<string, string> = {
    number: String(step.number),
    count: String(step.count),
  };

  if (step.name) {
    values["name"] = step.name;
    return { template: PublicNoteApprovalCopy.stepOfNamed, values };
  }

  return { template: PublicNoteApprovalCopy.stepOf, values };
}

// Who the step names, people first: what "Waiting for ..." lists.
export function getApproverNames(
  step: { people: Array<string>; teams: Array<string> } | undefined,
): Array<string> {
  if (!step) {
    return [];
  }

  return [...step.people, ...step.teams].filter(Boolean);
}

/*
 * What a note that is not published, or whose edit is not, offers the
 * person reading it. The server decides again on every press.
 */
export interface PublicNoteApprovalActions {
  canApprove: boolean;
  canReject: boolean;
  // Send a rejected note again - or publish it, once approval is not asked for.
  canResubmit: boolean;
  canWithdrawEdit: boolean;
  resubmitLabel: string;
  // What failed when the resubmit fails: sending it again, or publishing it.
  resubmitFailed: string;
  // Approving publishes the note.
  isApprovalFinal: boolean;
}

export function getApprovalActions(data: {
  state: PublicNoteApprovalState;
  summary?: PublicNoteApprovalNoteSummary | undefined;
  // The project asks for this kind of note to be approved now.
  isRequired: boolean;
  // The reader may edit the note.
  canEdit: boolean;
}): PublicNoteApprovalActions {
  const isWaiting: boolean = PublicNoteApproval.isWaiting(data.state);
  const isRejected: boolean = PublicNoteApproval.isRejected(data.state);
  const hasEdit: boolean =
    data.state === PublicNoteApprovalState.EditWaitingForApproval ||
    data.state === PublicNoteApprovalState.EditRejected;

  return {
    canApprove: isWaiting && Boolean(data.summary?.canApprove),
    canReject: isWaiting && Boolean(data.summary?.canReject),
    /*
     * A rejected note goes for approval again; a note that waits - or was
     * rejected - is published straight away once approval is no longer
     * asked for, by whoever may edit it.
     */
    canResubmit:
      data.canEdit && (isRejected || (isWaiting && !data.isRequired)),
    canWithdrawEdit: data.canEdit && hasEdit,
    resubmitLabel: data.isRequired
      ? PublicNoteApprovalCopy.sendAgain
      : PublicNoteApprovalCopy.publishNow,
    resubmitFailed: data.isRequired
      ? PublicNoteApprovalCopy.sendFailed
      : PublicNoteApprovalCopy.publishFailed,
    isApprovalFinal: Boolean(data.summary?.step?.isFinal),
  };
}

// The notes of a page whose approval the feed asks the server about.
export function getNoteIdsToDescribe(
  notes: Array<
    PublicNoteApprovalColumns & {
      _id?: string | undefined;
      id?: { toString: () => string } | null | undefined;
    }
  >,
): Array<string> {
  const ids: Array<string> = [];

  for (const note of notes) {
    const state: PublicNoteApprovalState = getNoteApprovalState(note);
    const hasApproval: boolean =
      state !== PublicNoteApprovalState.Published ||
      Boolean(note.approvalStatus);

    const id: string = (note._id || note.id?.toString() || "").toString();

    if (hasApproval && id && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
}

// ---------- calls ----------

function getUrl(apiPath: string, route: string): URL {
  return URL.fromString(APP_API_URL.toString()).addRoute(`${apiPath}${route}`);
}

async function post(
  apiPath: string,
  route: string,
  body: JSONObject,
): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: getUrl(apiPath, route),
      data: body,
      headers: ModelAPI.getCommonHeaders(),
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw new Error(API.getFriendlyMessage(response));
  }

  return (response.data || {}) as JSONObject;
}

export async function fetchApprovalPolicy(
  apiPath: string,
): Promise<PublicNoteApprovalPolicySummary> {
  const data: JSONObject = await post(apiPath, "/approval/policy", {});

  return {
    isRequired: data["isRequired"] === true,
    steps: Array.isArray(data["steps"])
      ? (data["steps"] as unknown as PublicNoteApprovalPolicySummary["steps"])
      : [],
  };
}

export async function fetchApprovalSummaries(
  apiPath: string,
  noteIds: Array<string>,
): Promise<Array<PublicNoteApprovalNoteSummary>> {
  if (noteIds.length === 0) {
    return [];
  }

  const data: JSONObject = await post(apiPath, "/approval/notes", {
    noteIds: noteIds,
  });

  const notes: JSONArray = Array.isArray(data["notes"])
    ? (data["notes"] as JSONArray)
    : [];

  return notes as unknown as Array<PublicNoteApprovalNoteSummary>;
}

export async function approveNote(data: {
  apiPath: string;
  noteId: string;
  comment?: string | undefined;
}): Promise<void> {
  await post(data.apiPath, `/${data.noteId}/approve`, {
    comment: data.comment || "",
  });
}

export async function rejectNote(data: {
  apiPath: string;
  noteId: string;
  reason: string;
}): Promise<void> {
  await post(data.apiPath, `/${data.noteId}/reject`, {
    reason: data.reason,
  });
}

export async function resubmitNote(data: {
  apiPath: string;
  noteId: string;
}): Promise<void> {
  await post(data.apiPath, `/${data.noteId}/resubmit`, {});
}

export async function withdrawNoteEdit(data: {
  apiPath: string;
  noteId: string;
}): Promise<void> {
  await post(data.apiPath, `/${data.noteId}/discard-edit`, {});
}
