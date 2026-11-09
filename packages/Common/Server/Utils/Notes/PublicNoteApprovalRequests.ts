import PublicNoteApprovalRequest, {
  PublicNoteApprovalRequestKind,
} from "../../../Models/DatabaseModels/PublicNoteApprovalRequest";
import ObjectID from "../../../Types/ObjectID";
import PublicNoteApprovalRequestService, {
  PublicNoteApprovalRequestNoteColumn,
  PublicNoteApprovalRequestRow,
} from "../../Services/PublicNoteApprovalRequestService";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { PublicNoteKind } from "./PublicNoteApprovalEngine";

/*
 * WHO WAS ASKED TO APPROVE A PUBLIC NOTE, AND HOW (#6353).
 *
 * An approver of the step a note waits for is asked when the note is sent,
 * when the step before is approved, and - since who approves can change
 * while the note waits - whenever the steps or a team's members change
 * (PublicNoteApproverChanges). Every one of those asks the people the step
 * names now, so what decides whom to ask is not who the step names but
 * whom it asked already, read from what was recorded, never from timing:
 *
 *  - by their notification settings - email, push and the rest - a person
 *    is asked about a step of a round once, and once more when its last
 *    step is asked again (every step had approved it, one that had not was
 *    taken out). What was sent cannot be taken back, so that stands;
 *  - in Slack, Microsoft Teams or Mattermost, a person is asked once for
 *    each message that asks: whether approving the step publishes the note,
 *    as its Approve says. A message that no longer asks what is true is
 *    replaced, without Approve and Reject (WorkspacePublicNoteApprovalMessages),
 *    and that takes its request back, so a note that comes back to the step
 *    asks them in chat again - and a step that now publishes the note, or no
 *    longer does, asks them there with the buttons it has now.
 *
 * Each request is claimed before the person is asked (claim): the database
 * writes each row once (PublicNoteApprovalRequestService.claim), so two
 * asks at once - two saves of the steps, a save racing a decision - ask a
 * person once between them. A request whose ask failed is taken back
 * (release), for the next ask to try again.
 */

// One step of one round of a note, which an ask is about.
export interface PublicNoteApprovalRequestKey {
  kind: PublicNoteKind;
  projectId: ObjectID;
  noteId: ObjectID;
  // The round: when the note was sent for approval.
  submittedAt: string;
  stepId: string;
  // Approving the step publishes the note: what a chat message's Approve says.
  isFinal: boolean;
  // Every step had approved the note, so its last step is asked once more.
  isAskedAgain: boolean;
}

// What one person may be asked by this time: what nobody asked them by yet.
export interface PublicNoteApprovalRequestClaim {
  // Email, SMS, call, push, and the rest of their notification settings.
  notifications: boolean;
  // Slack, Microsoft Teams and Mattermost, with Approve and Reject.
  chat: boolean;
}

export const ASK_BY_EVERYTHING: PublicNoteApprovalRequestClaim = {
  notifications: true,
  chat: true,
};

export const ASK_BY_NOTHING: PublicNoteApprovalRequestClaim = {
  notifications: false,
  chat: false,
};

export default class PublicNoteApprovalRequests {
  // The column that ties a request to a note of this kind.
  public static getNoteColumn(
    kind: PublicNoteKind,
  ): PublicNoteApprovalRequestNoteColumn {
    switch (kind) {
      case PublicNoteKind.Incident:
        return "incidentPublicNoteId";
      case PublicNoteKind.IncidentEpisode:
        return "incidentEpisodePublicNoteId";
      case PublicNoteKind.ScheduledMaintenance:
        return "scheduledMaintenancePublicNoteId";
    }
  }

  /*
   * The requests a person asked about `key` holds, one of each kind: the
   * notifications' for the step (asked again or not), the chat's for its
   * message (final or not). Each with only what tells it apart.
   */
  public static getRows(
    key: PublicNoteApprovalRequestKey,
    claim: PublicNoteApprovalRequestClaim = ASK_BY_EVERYTHING,
  ): Array<PublicNoteApprovalRequestRow> {
    const rows: Array<PublicNoteApprovalRequestRow> = [];

    if (claim.notifications) {
      rows.push({
        kind: PublicNoteApprovalRequestKind.Notifications,
        isFinal: false,
        isAskedAgain: key.isAskedAgain,
      });
    }

    if (claim.chat) {
      rows.push({
        kind: PublicNoteApprovalRequestKind.Chat,
        isFinal: key.isFinal,
        isAskedAgain: false,
      });
    }

    return rows;
  }

  /*
   * Whom `key` asked already, and by what, by person: what a follow-up need
   * not look at again. Throws when it cannot be read.
   */
  @CaptureSpan()
  public static async readAsked(
    key: PublicNoteApprovalRequestKey,
  ): Promise<Map<string, PublicNoteApprovalRequestClaim>> {
    const requests: Array<PublicNoteApprovalRequest> =
      await PublicNoteApprovalRequestService.findForStep({
        projectId: key.projectId,
        noteId: key.noteId,
        submittedAt: key.submittedAt,
        stepId: key.stepId,
      });

    const asked: Map<string, PublicNoteApprovalRequestClaim> = new Map();

    for (const request of requests) {
      const userId: string = request.userId?.toString().toLowerCase() || "";

      if (!userId) {
        continue;
      }

      const was: PublicNoteApprovalRequestClaim = asked.get(userId) || {
        ...ASK_BY_NOTHING,
      };

      if (
        request.kind === PublicNoteApprovalRequestKind.Notifications &&
        Boolean(request.isAskedAgain) === key.isAskedAgain
      ) {
        was.notifications = true;
      }

      if (
        request.kind === PublicNoteApprovalRequestKind.Chat &&
        Boolean(request.isFinal) === key.isFinal
      ) {
        was.chat = true;
      }

      asked.set(userId, was);
    }

    return asked;
  }

  /*
   * Claims asking `userId` about `key`: what this call may ask them by -
   * whatever nobody claimed for them yet. Throws when it cannot claim.
   */
  @CaptureSpan()
  public static async claim(data: {
    key: PublicNoteApprovalRequestKey;
    userId: ObjectID;
  }): Promise<PublicNoteApprovalRequestClaim> {
    const claimed: Array<PublicNoteApprovalRequestKind> =
      await PublicNoteApprovalRequestService.claim({
        projectId: data.key.projectId,
        noteColumn: this.getNoteColumn(data.key.kind),
        noteId: data.key.noteId,
        userId: data.userId,
        submittedAt: data.key.submittedAt,
        stepId: data.key.stepId,
        rows: this.getRows(data.key),
      });

    return {
      notifications: claimed.includes(
        PublicNoteApprovalRequestKind.Notifications,
      ),
      chat: claimed.includes(PublicNoteApprovalRequestKind.Chat),
    };
  }

  /*
   * Takes back what claim gave for `userId`, once asking them failed: the
   * next ask asks them again. Best effort: logged when it cannot.
   */
  @CaptureSpan()
  public static async release(data: {
    key: PublicNoteApprovalRequestKey;
    userId: ObjectID;
    claim: PublicNoteApprovalRequestClaim;
  }): Promise<void> {
    try {
      await PublicNoteApprovalRequestService.release({
        projectId: data.key.projectId,
        noteId: data.key.noteId,
        submittedAt: data.key.submittedAt,
        stepId: data.key.stepId,
        userIds: [data.userId],
        rows: this.getRows(data.key, data.claim),
      });
    } catch (error) {
      logger.error(
        "Public note approval: could not take back the request of an approver who was not asked, so the next change does not ask them either.",
        { projectId: data.key.projectId.toString() },
      );
      logger.error(error, { projectId: data.key.projectId.toString() });
    }
  }

  /*
   * These people's chat messages about a step - final or not - were
   * replaced (WorkspacePublicNoteApprovalMessages): they no longer hold a
   * message that asks it, and may be asked in chat about it again. Best
   * effort: logged when it cannot.
   */
  @CaptureSpan()
  public static async releaseChat(data: {
    projectId: ObjectID;
    noteId: ObjectID;
    submittedAt: string;
    stepId: string;
    isFinal: boolean;
    userIds: Array<ObjectID>;
  }): Promise<void> {
    if (data.userIds.length === 0) {
      return;
    }

    try {
      await PublicNoteApprovalRequestService.release({
        projectId: data.projectId,
        noteId: data.noteId,
        submittedAt: data.submittedAt,
        stepId: data.stepId,
        userIds: data.userIds,
        rows: [
          {
            kind: PublicNoteApprovalRequestKind.Chat,
            isFinal: data.isFinal,
            isAskedAgain: false,
          },
        ],
      });
    } catch (error) {
      logger.error(
        "Public note approval: could not take back the chat requests of replaced approval messages.",
        { projectId: data.projectId.toString() },
      );
      logger.error(error, { projectId: data.projectId.toString() });
    }
  }

  /*
   * Records these people as asked about `key`, by everything, without
   * asking them: what a note that waited before requests were kept was
   * asked. How many requests were written.
   */
  @CaptureSpan()
  public static async record(data: {
    key: PublicNoteApprovalRequestKey;
    userIds: ReadonlyArray<string>;
  }): Promise<number> {
    let written: number = 0;

    for (const userId of new Set<string>(data.userIds)) {
      const claimed: PublicNoteApprovalRequestClaim = await this.claim({
        key: data.key,
        userId: new ObjectID(userId),
      });

      written += (claimed.notifications ? 1 : 0) + (claimed.chat ? 1 : 0);
    }

    return written;
  }
}
