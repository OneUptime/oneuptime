import { JSONObject } from "../../../Types/JSON";
import PublicNoteApproval, {
  PublicNoteApprovalBefore,
  PublicNoteApprovalRound,
  PublicNoteApprovalState,
  PublicNoteApprovalStatus,
} from "../../../Types/StatusPage/PublicNoteApproval";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberUpdateNotification from "../../../Types/StatusPage/SubscriberUpdateNotification";

/*
 * What each step of a public note's approval writes to the note
 * (Types/StatusPage/PublicNoteApproval): the columns, and nothing else.
 * PublicNoteApprovalEngine reads the note, decides with these and writes the
 * result in one version-checked update, so two people deciding at once
 * decide once. No database here: every write is pinned by tests.
 *
 * A key set to null clears the column.
 */

export type PublicNoteApprovalWrite = Record<string, unknown>;

// The columns OneUptime alone writes as a note is approved.
export const PUBLIC_NOTE_APPROVAL_COLUMNS: ReadonlyArray<string> = [
  "isPublished",
  "approvalStatus",
  "approval",
  "pendingNote",
];

export default class PublicNoteApprovalWrites {
  /*
   * A new note: held for approval when its project asks for it - not
   * published, waiting, sent by `submittedByUserId` - and published as every
   * note was before approval existed when it does not. Every approval column
   * is set, so nothing a caller sent stands.
   */
  public static forCreate(data: {
    isRequired: boolean;
    now: Date;
    submittedByUserId?: string | null | undefined;
    keepPostedAt: boolean;
  }): PublicNoteApprovalWrite {
    if (!data.isRequired) {
      return {
        isPublished: true,
        approvalStatus: null,
        approval: null,
        pendingNote: null,
      };
    }

    return {
      isPublished: false,
      approvalStatus: PublicNoteApprovalStatus.WaitingForApproval,
      approval: PublicNoteApproval.toJSON(
        PublicNoteApproval.startRound({
          now: data.now,
          submittedByUserId: data.submittedByUserId,
          isEdit: false,
          keepPostedAt: data.keepPostedAt,
        }),
      ),
      pendingNote: null,
    };
  }

  /*
   * A note that is not published, edited: it is sent for approval again
   * from the first step, by its editor - an approval is of the words it was
   * given. Its text and files are written as they were sent; it stays off
   * status pages.
   */
  public static forUnpublishedEdit(data: {
    round: PublicNoteApprovalRound | null;
    now: Date;
    editorUserId?: string | null | undefined;
  }): PublicNoteApprovalWrite {
    return {
      approvalStatus: PublicNoteApprovalStatus.WaitingForApproval,
      approval: PublicNoteApproval.toJSON(
        PublicNoteApproval.startRound({
          now: data.now,
          submittedByUserId: data.editorUserId,
          isEdit: false,
          keepPostedAt: Boolean(data.round?.keepPostedAt),
        }),
      ),
    };
  }

  /*
   * A published note's new text, held for approval: the note keeps showing
   * as it was approved, and the edit waits in pendingNote. An edit that
   * replaces one already waiting keeps what the note was before that one.
   */
  public static forHeldEdit(data: {
    state: PublicNoteApprovalState;
    approvalStatus: string | null | undefined;
    round: PublicNoteApprovalRound | null;
    pendingNote: string;
    now: Date;
    editorUserId?: string | null | undefined;
    notifySubscribersOfEdit: boolean;
  }): PublicNoteApprovalWrite {
    const before: PublicNoteApprovalBefore =
      data.state === PublicNoteApprovalState.Published
        ? {
            status: PublicNoteApproval.isStatus(data.approvalStatus)
              ? data.approvalStatus
              : null,
            round: data.round,
          }
        : data.round?.before || { status: null, round: null };

    return {
      pendingNote: data.pendingNote,
      approvalStatus: PublicNoteApprovalStatus.WaitingForApproval,
      approval: PublicNoteApproval.toJSON(
        PublicNoteApproval.startRound({
          now: data.now,
          submittedByUserId: data.editorUserId,
          isEdit: true,
          notifySubscribersOfEdit: data.notifySubscribersOfEdit,
          before: before,
        }),
      ),
    };
  }

  /*
   * A waiting or rejected edit dropped: the note's approval goes back to
   * what it was before the edit was sent.
   */
  public static forDroppedEdit(
    round: PublicNoteApprovalRound | null,
  ): PublicNoteApprovalWrite {
    const before: PublicNoteApprovalBefore | undefined = round?.before;

    return {
      pendingNote: null,
      approvalStatus: before?.status || null,
      approval: before?.round ? PublicNoteApproval.toJSON(before.round) : null,
    };
  }

  // One step approved, and another to go: the note still waits.
  public static forStepApproval(
    round: PublicNoteApprovalRound,
  ): PublicNoteApprovalWrite {
    return {
      approval: PublicNoteApproval.toJSON(round),
    };
  }

  // Rejected: off status pages still, or the edit not applied.
  public static forRejection(
    round: PublicNoteApprovalRound,
  ): PublicNoteApprovalWrite {
    return {
      approvalStatus: PublicNoteApprovalStatus.Rejected,
      approval: PublicNoteApproval.toJSON(round),
    };
  }

  /*
   * A rejected note, or a rejected edit, sent for approval again as it is:
   * a new round from the first step, sent by `submittedByUserId`.
   */
  public static forResubmission(data: {
    state: PublicNoteApprovalState;
    round: PublicNoteApprovalRound | null;
    now: Date;
    submittedByUserId?: string | null | undefined;
  }): PublicNoteApprovalWrite {
    const isEdit: boolean = data.state === PublicNoteApprovalState.EditRejected;

    return {
      approvalStatus: PublicNoteApprovalStatus.WaitingForApproval,
      approval: PublicNoteApproval.toJSON(
        PublicNoteApproval.startRound({
          now: data.now,
          submittedByUserId: data.submittedByUserId,
          isEdit: isEdit,
          notifySubscribersOfEdit: Boolean(
            data.round?.notifySubscribersOfEdit,
          ),
          keepPostedAt: Boolean(data.round?.keepPostedAt),
          before: data.round?.before,
        }),
      ),
    };
  }

  /*
   * Published - by its last approval (`round` holds it), or by a person
   * once approval is no longer asked for (`round` null: nobody approved it,
   * so it carries no approval).
   *
   * A new note goes on status pages: posted now, unless its time was chosen
   * when it was written (keepPostedAt), and its subscribers' notification,
   * queued when it was written, goes out (the jobs send published notes
   * only). An edit takes the note's place, and its update notification is
   * queued when its editor asked for one.
   */
  public static forPublish(data: {
    state: PublicNoteApprovalState;
    round: PublicNoteApprovalRound | null;
    // The round as it was before this decision, for what it asked.
    roundAsSent: PublicNoteApprovalRound | null;
    pendingNote: string | null | undefined;
    now: Date;
  }): PublicNoteApprovalWrite {
    const isEdit: boolean =
      data.state === PublicNoteApprovalState.EditWaitingForApproval ||
      data.state === PublicNoteApprovalState.EditRejected;

    const approvalColumns: PublicNoteApprovalWrite = data.round
      ? {
          approvalStatus: PublicNoteApprovalStatus.Approved,
          approval: this.withoutBefore(data.round),
        }
      : {
          approvalStatus: null,
          approval: null,
        };

    if (isEdit) {
      const write: PublicNoteApprovalWrite = {
        ...approvalColumns,
        note: data.pendingNote || "",
        pendingNote: null,
      };

      if (data.roundAsSent?.notifySubscribersOfEdit) {
        write["subscriberNotificationStatusOnNoteUpdated"] =
          StatusPageSubscriberNotificationStatus.Pending;
        write["subscriberNotificationStatusMessageOnNoteUpdated"] =
          SubscriberUpdateNotification.queuedMessage;
      }

      return write;
    }

    const write: PublicNoteApprovalWrite = {
      ...approvalColumns,
      isPublished: true,
    };

    if (!data.roundAsSent?.keepPostedAt) {
      write["postedAt"] = data.now;
    }

    return write;
  }

  // Whether an edit's text differs from what the note has.
  public static isChangedText(
    sent: unknown,
    stored: string | null | undefined,
  ): boolean {
    if (sent === undefined) {
      return false;
    }

    return (typeof sent === "string" ? sent : "") !== (stored || "");
  }

  /*
   * Whether an edit's files differ from the note's: the ids it names, as a
   * set. Files are sent as records ({ _id }) or as ids.
   */
  public static isChangedFiles(
    sent: unknown,
    storedIds: ReadonlyArray<string>,
  ): boolean {
    if (sent === undefined) {
      return false;
    }

    const sentIds: Set<string> = new Set<string>(this.idsOf(sent));
    const stored: Set<string> = new Set<string>(
      storedIds.map((id: string): string => {
        return id.toLowerCase();
      }),
    );

    if (sentIds.size !== stored.size) {
      return true;
    }

    for (const id of sentIds) {
      if (!stored.has(id)) {
        return true;
      }
    }

    return false;
  }

  // The ids of files as they are sent: records with an _id or id, or ids.
  public static idsOf(value: unknown): Array<string> {
    if (!Array.isArray(value)) {
      return [];
    }

    const ids: Array<string> = [];

    for (const item of value) {
      let id: string = "";

      if (typeof item === "string") {
        id = item;
      } else if (item && typeof item === "object") {
        const record: Record<string, unknown> = item as Record<string, unknown>;
        const raw: unknown = record["_id"] || record["id"];
        id = raw ? String(raw) : "";
      }

      if (id) {
        ids.push(id.toLowerCase());
      }
    }

    return ids;
  }

  private static withoutBefore(round: PublicNoteApprovalRound): JSONObject {
    const copy: PublicNoteApprovalRound = { ...round };
    delete copy.before;
    return PublicNoteApproval.toJSON(copy);
  }
}
