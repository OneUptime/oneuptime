import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../Types/ObjectID";
import PublicNoteApproval, {
  PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH,
  PublicNoteApprovalColumns,
  PublicNoteApprovalDecision,
  PublicNoteApprovalGiven,
  PublicNoteApprovalMessages,
  PublicNoteApprovalPosition,
  PublicNoteApprovalRound,
  PublicNoteApprovalState,
  PublicNoteApprovalStepRule,
} from "../../../Types/StatusPage/PublicNoteApproval";
import { WorkspaceModalBlock } from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import IncidentEpisodePublicNoteService from "../../Services/IncidentEpisodePublicNoteService";
import IncidentPublicNoteService from "../../Services/IncidentPublicNoteService";
import ScheduledMaintenancePublicNoteService from "../../Services/ScheduledMaintenancePublicNoteService";
import WorkspaceNotificationLogService from "../../Services/WorkspaceNotificationLogService";
import Query from "../../Types/Database/Query";
import Select from "../../Types/Database/Select";
import logger from "../Logger";
import PublicNoteApprovalEngine, {
  PublicNoteApprovalHost,
  PublicNoteApprovalOutcome,
  PublicNoteApprovalRecordInfo,
  PublicNoteKind,
} from "../Notes/PublicNoteApprovalEngine";
import PublicNoteApprovalFeed, {
  PublicNoteApprovalWaitingFor,
} from "../Notes/PublicNoteApprovalFeed";
import PublicNoteApprovalNotifications from "../Notes/PublicNoteApprovalNotifications";
import PublicNoteApprovalPolicy from "../Notes/PublicNoteApprovalPolicy";
import ProductBrandingText from "../ProductBrandingText";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { WorkspaceAnswer } from "./WorkspaceActionAnswers";
import WorkspaceActionAuthorization from "./WorkspaceActionAuthorization";
import WorkspaceMemberActions from "./WorkspaceMemberActions";
import WorkspaceMessageTime from "./WorkspaceMessageTime";
import WorkspacePublicNoteApproval, {
  PUBLIC_NOTE_APPROVAL_CHAT_WORDS,
  PublicNoteApprovalButtonValue,
} from "./WorkspacePublicNoteApproval";

/*
 * A PRESS OF APPROVE OR REJECT ON A PUBLIC NOTE'S APPROVAL MESSAGE (#6289),
 * THE SAME IN SLACK, MICROSOFT TEAMS AND MATTERMOST.
 *
 * Each chat reads its press - whose account pressed, which OneUptime member
 * it is connected to, with the props the Dashboard would use for them
 * (WorkspaceActionAuthorization.getProjectMemberProps) - and asks here what
 * it does and what it answers. Nothing in the button decides who acts: the
 * member is the one the pressing account is connected to, and what the
 * button carries only names the note and what its message asked
 * (WorkspacePublicNoteApproval, signed).
 *
 * In this order:
 *
 *   1. The note is read as it is now, in the project the button was signed
 *      for. Gone - deleted with its record, say - is said as news.
 *   2. The member must be able to read it, as the Dashboard reads it for
 *      them: if not, they are told why in the chats' words
 *      (WorkspaceActionAuthorization.getUnreadableRefusal) - a permission
 *      they lack, a record that is private - before anything about it is
 *      told.
 *   3. A note that no longer is what the message asked about is not
 *      decided, and the answer says what happened, as news rather than as
 *      an error (compare WorkspaceActionAnswers.getAlreadyAnswer): approved
 *      and published or rejected by somebody, and when; published without
 *      approval once approval was turned off; edited, or sent for approval
 *      again, since; its step approved by somebody else, or its steps
 *      changed. A press never decides a note its message did not show, nor
 *      for a step it did not ask about, nor publishes one its message said
 *      would wait.
 *   4. Otherwise it is decided by PublicNoteApprovalEngine.decide, as the
 *      member - the Dashboard's rules, every one of them: someone named on
 *      the step it waits for, directly or through a team they are on now,
 *      who did not send it and did not approve an earlier step of it, and a
 *      rejection says why. Its refusals are told in its own words; one who
 *      decided a moment earlier (decidedMeanwhile) is told what they
 *      decided, as news.
 *
 * The answers are the feed's words, said to the person who decided:
 * "✅ You approved a **public note** on [Incident INC-42](...) for step 1 of
 * 2 (Support). It waits for step 2 of 2 (Legal): Carol." Each chat delivers
 * them where the press was, only to the person who pressed where the chat
 * allows it.
 */

// What a press came to.
export enum PublicNoteApprovalPressOutcome {
  // Decided: approved for a step, approved and published, or rejected.
  Decided = "Decided",
  // Nothing decided, and the answer says why, as news: decided, changed, gone.
  News = "News",
  // Refused, in the engine's words, or the chats' for who may read the note.
  Refused = "Refused",
}

export interface PublicNoteApprovalPressAnswer {
  outcome: PublicNoteApprovalPressOutcome;
  answer: WorkspaceAnswer;
}

// What Reject opens: the form, or the answer instead of it.
export interface PublicNoteRejectFormResult {
  form?: WorkspaceModalBlock | undefined;
  answer?: PublicNoteApprovalPressAnswer | undefined;
}

// A note's columns, as a press reads them.
interface PressedNoteColumns extends PublicNoteApprovalColumns {
  _id?: string | undefined;
  projectId?: ObjectID | undefined;
  note?: string | null | undefined;
  pendingNote?: string | null | undefined;
  isPublished?: boolean | null | undefined;
}

// The note a press is about, as it is now.
interface PressedNote {
  host: PublicNoteApprovalHost<BaseModel>;
  columns: PressedNoteColumns;
  state: PublicNoteApprovalState;
  round: PublicNoteApprovalRound | null;
}

export default class WorkspacePublicNoteApprovalActions {
  // Completes "You do not have permission to ...", "Could not ...".
  public static readonly APPROVE_ACTION: string = "approve this public note";
  public static readonly REJECT_ACTION: string = "reject this public note";

  // What a press whose value this installation did not sign is told.
  public static getUnverifiedMessage(): string {
    return `This button could not be verified, so nothing was decided. Open the public note in ${ProductBrandingText.getProductName()} instead.`;
  }

  // What a press on a note that is gone is told.
  public static getGoneMessage(): string {
    return `This public note is no longer in ${ProductBrandingText.getProductName()}. It may have been deleted.`;
  }

  /*
   * The value a press carried - or a refusal (BadDataException) the chat
   * tells its presser, when it is not one this installation signed.
   */
  public static readValue(value: unknown): PublicNoteApprovalButtonValue {
    const read: PublicNoteApprovalButtonValue | null =
      WorkspacePublicNoteApproval.readValue(value);

    if (!read) {
      throw new BadDataException(
        WorkspacePublicNoteApprovalActions.getUnverifiedMessage(),
      );
    }

    return read;
  }

  // What the engine knows of a kind of note: the note service's own.
  public static getHost(
    kind: PublicNoteKind,
  ): PublicNoteApprovalHost<BaseModel> {
    switch (kind) {
      case PublicNoteKind.Incident:
        return IncidentPublicNoteService.getApprovalHost() as unknown as PublicNoteApprovalHost<BaseModel>;
      case PublicNoteKind.IncidentEpisode:
        return IncidentEpisodePublicNoteService.getApprovalHost() as unknown as PublicNoteApprovalHost<BaseModel>;
      case PublicNoteKind.ScheduledMaintenance:
        return ScheduledMaintenancePublicNoteService.getApprovalHost() as unknown as PublicNoteApprovalHost<BaseModel>;
    }
  }

  /*
   * Approve, as the member (`props`): decided by the engine while the note
   * is what the message showed, and answered with what it came to.
   */
  @CaptureSpan()
  public static async approve(data: {
    value: PublicNoteApprovalButtonValue;
    props: DatabaseCommonInteractionProps;
  }): Promise<PublicNoteApprovalPressAnswer> {
    const action: string = WorkspacePublicNoteApprovalActions.APPROVE_ACTION;
    const pressed: PressedNote | null =
      await WorkspacePublicNoteApprovalActions.readNote(data.value);

    const early: PublicNoteApprovalPressAnswer | null =
      await WorkspacePublicNoteApprovalActions.getEarlyAnswer({
        value: data.value,
        props: data.props,
        pressed: pressed,
        action: action,
      });

    if (early || !pressed) {
      return early!;
    }

    try {
      const outcome: PublicNoteApprovalOutcome =
        await PublicNoteApprovalEngine.decide({
          host: pressed.host,
          noteId: data.value.noteId,
          decision: PublicNoteApprovalDecision.Approve,
          props: data.props,
        });

      return {
        outcome: PublicNoteApprovalPressOutcome.Decided,
        answer: await WorkspacePublicNoteApprovalActions.getApprovedAnswer({
          value: data.value,
          pressed: pressed,
          outcome: outcome,
          props: data.props,
        }),
      };
    } catch (err) {
      return await WorkspacePublicNoteApprovalActions.getRefusal({
        err: err,
        value: data.value,
        props: data.props,
        action: action,
      });
    }
  }

  /*
   * Reject, pressed: the form that asks why, for a member who may reject
   * the note now - or, when they may not, or the note is no longer what the
   * message asked about, the answer instead, before anything is typed. Who
   * may reject is the engine's own rule (PublicNoteApproval
   * .getDecisionRefusal), and the submission is decided by the engine
   * again.
   */
  @CaptureSpan()
  public static async getRejectForm(data: {
    value: PublicNoteApprovalButtonValue;
    props: DatabaseCommonInteractionProps;
    workspaceType: WorkspaceType;
  }): Promise<PublicNoteRejectFormResult> {
    const action: string = WorkspacePublicNoteApprovalActions.REJECT_ACTION;
    const pressed: PressedNote | null =
      await WorkspacePublicNoteApprovalActions.readNote(data.value);

    const early: PublicNoteApprovalPressAnswer | null =
      await WorkspacePublicNoteApprovalActions.getEarlyAnswer({
        value: data.value,
        props: data.props,
        pressed: pressed,
        action: action,
      });

    if (early || !pressed) {
      return { answer: early! };
    }

    const steps: Array<PublicNoteApprovalStepRule> =
      await PublicNoteApprovalPolicy.getSteps({
        projectId: data.value.projectId,
        eventType: pressed.host.eventType,
      });

    const userTeamIds: Array<string> = data.props.userId
      ? await PublicNoteApprovalPolicy.getUserTeamIds({
          projectId: data.value.projectId,
          userId: data.props.userId,
        })
      : [];

    const refusal: string | null = PublicNoteApproval.getDecisionRefusal({
      state: pressed.state,
      round: pressed.round,
      steps: steps,
      userId: data.props.userId?.toString(),
      userTeamIds: userTeamIds,
      decision: PublicNoteApprovalDecision.Reject,
    });

    if (refusal) {
      return {
        answer: WorkspacePublicNoteApprovalActions.refused(refusal),
      };
    }

    const record: PublicNoteApprovalRecordInfo | null =
      await WorkspacePublicNoteApprovalActions.readRecord({
        value: data.value,
        pressed: pressed,
      });

    return {
      form: WorkspacePublicNoteApproval.getRejectForm({
        value: WorkspacePublicNoteApproval.encodeValue(data.value),
        workspaceType: data.workspaceType,
        recordLabel: record?.label,
        recordTitle: record?.title,
      }),
    };
  }

  /*
   * What is wrong with a reason a form sent, or null: one is required, and
   * kept to PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH characters - the form's own
   * limit, checked again here, since a submission is whatever was sent.
   */
  public static getReasonError(reason: unknown): string | null {
    const text: string = typeof reason === "string" ? reason.trim() : "";

    if (!text) {
      return PublicNoteApprovalMessages.reasonRequired;
    }

    if (text.length > PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH) {
      return PUBLIC_NOTE_APPROVAL_CHAT_WORDS.reasonTooLong;
    }

    return null;
  }

  /*
   * Reject, submitted with its reason, as the member: decided by the engine
   * while the note is what the message showed, and answered with what it
   * came to. A reason that is missing or too long rejects nothing.
   */
  @CaptureSpan()
  public static async reject(data: {
    value: PublicNoteApprovalButtonValue;
    props: DatabaseCommonInteractionProps;
    reason: unknown;
  }): Promise<PublicNoteApprovalPressAnswer> {
    const action: string = WorkspacePublicNoteApprovalActions.REJECT_ACTION;
    const reasonError: string | null =
      WorkspacePublicNoteApprovalActions.getReasonError(data.reason);

    if (reasonError) {
      return WorkspacePublicNoteApprovalActions.refused(reasonError);
    }

    const pressed: PressedNote | null =
      await WorkspacePublicNoteApprovalActions.readNote(data.value);

    const early: PublicNoteApprovalPressAnswer | null =
      await WorkspacePublicNoteApprovalActions.getEarlyAnswer({
        value: data.value,
        props: data.props,
        pressed: pressed,
        action: action,
      });

    if (early || !pressed) {
      return early!;
    }

    try {
      await PublicNoteApprovalEngine.decide({
        host: pressed.host,
        noteId: data.value.noteId,
        decision: PublicNoteApprovalDecision.Reject,
        props: data.props,
        text: (data.reason as string).trim(),
      });

      return {
        outcome: PublicNoteApprovalPressOutcome.Decided,
        answer: await WorkspacePublicNoteApprovalActions.getRejectedAnswer({
          value: data.value,
          pressed: pressed,
        }),
      };
    } catch (err) {
      return await WorkspacePublicNoteApprovalActions.getRefusal({
        err: err,
        value: data.value,
        props: data.props,
        action: action,
      });
    }
  }

  /*
   * Approve pressed before the chat account was connected, finished now as
   * the member it was just connected to (WorkspaceConnectCompletion): the
   * value it carried, read again, in the project the account was connected
   * in, and decided exactly as the press would have been - only while the
   * note is still what the message showed.
   */
  @CaptureSpan()
  public static async approveOnceConnected(data: {
    value: string;
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<PublicNoteApprovalPressAnswer> {
    const value: PublicNoteApprovalButtonValue | null =
      WorkspacePublicNoteApproval.readValue(data.value);

    if (
      !value ||
      value.projectId.toString().toLowerCase() !==
        data.projectId.toString().toLowerCase()
    ) {
      return WorkspacePublicNoteApprovalActions.refused(
        WorkspacePublicNoteApprovalActions.getUnverifiedMessage(),
      );
    }

    let props: DatabaseCommonInteractionProps;

    try {
      props = await WorkspaceActionAuthorization.getProjectMemberProps({
        userId: data.userId,
        projectId: data.projectId,
      });
    } catch (err) {
      if (WorkspaceActionAuthorization.isReadRefusal(err)) {
        return WorkspacePublicNoteApprovalActions.refused(
          (err as Error).message,
        );
      }

      throw err;
    }

    return await WorkspacePublicNoteApprovalActions.approve({
      value: value,
      props: props,
    });
  }

  /*
   * The press, in the project's workspace logs: "approve_public_note",
   * "reject_public_note", with the record the note is on. Best effort.
   */
  @CaptureSpan()
  public static async logPress(data: {
    value: PublicNoteApprovalButtonValue;
    workspaceType: WorkspaceType;
    userId: ObjectID;
    buttonAction: "approve_public_note" | "reject_public_note";
    channelId?: string | undefined;
  }): Promise<void> {
    try {
      const logData: Parameters<
        typeof WorkspaceNotificationLogService.logButtonPressed
      >[0] = {
        projectId: data.value.projectId,
        workspaceType: data.workspaceType,
        userId: data.userId,
        buttonAction: data.buttonAction,
      };

      if (data.channelId) {
        logData.channelId = data.channelId;
      }

      switch (data.value.kind) {
        case PublicNoteKind.Incident:
          logData.incidentId = data.value.recordId;
          break;
        case PublicNoteKind.IncidentEpisode:
          logData.incidentEpisodeId = data.value.recordId;
          break;
        case PublicNoteKind.ScheduledMaintenance:
          logData.scheduledMaintenanceId = data.value.recordId;
          break;
      }

      await WorkspaceNotificationLogService.logButtonPressed(logData, {
        isRoot: true,
      });
    } catch (err) {
      logger.error("Could not log a public note approval press.", {
        projectId: data.value.projectId.toString(),
      });
      logger.error(err, { projectId: data.value.projectId.toString() });
    }
  }

  // ---------- reading the note ----------

  /*
   * The note a press names, as it is now, read as OneUptime in the project
   * the button was signed for and on the record it names: null when there
   * is no such note.
   */
  private static async readNote(
    value: PublicNoteApprovalButtonValue,
  ): Promise<PressedNote | null> {
    const host: PublicNoteApprovalHost<BaseModel> =
      WorkspacePublicNoteApprovalActions.getHost(value.kind);

    const found: BaseModel | null = await host.service.findOneBy({
      query: {
        _id: value.noteId.toString(),
        projectId: value.projectId,
        [host.parentIdColumn]: value.recordId,
      } as unknown as Query<BaseModel>,
      select: {
        _id: true,
        projectId: true,
        note: true,
        pendingNote: true,
        isPublished: true,
        approvalStatus: true,
        approval: true,
      } as unknown as Select<BaseModel>,
      props: {
        isRoot: true,
      },
    });

    if (!found) {
      return null;
    }

    const columns: PressedNoteColumns = found as unknown as PressedNoteColumns;

    return {
      host: host,
      columns: columns,
      state: PublicNoteApproval.getState(columns),
      round: PublicNoteApproval.readRound(columns.approval),
    };
  }

  // The note's record, as answers name and link it; null when it cannot be read.
  private static async readRecord(data: {
    value: PublicNoteApprovalButtonValue;
    pressed: PressedNote;
  }): Promise<PublicNoteApprovalRecordInfo | null> {
    try {
      return await data.pressed.host.getRecord({
        projectId: data.value.projectId,
        parentId: data.value.recordId,
      });
    } catch (err) {
      logger.debug("Could not name the record of a public note for chat.");
      logger.debug(err);
      return null;
    }
  }

  /*
   * What a press is answered with before anything is decided, or null to
   * decide it: the note is gone, the member may not read it, or it is no
   * longer what the message asked about (see the header).
   */
  private static async getEarlyAnswer(data: {
    value: PublicNoteApprovalButtonValue;
    props: DatabaseCommonInteractionProps;
    pressed: PressedNote | null;
    action: string;
  }): Promise<PublicNoteApprovalPressAnswer | null> {
    if (!data.pressed) {
      return WorkspacePublicNoteApprovalActions.news(
        WorkspacePublicNoteApprovalActions.textAnswer(
          WorkspacePublicNoteApprovalActions.getGoneMessage(),
        ),
      );
    }

    const unreadable: Error | null =
      await WorkspacePublicNoteApprovalActions.getUnreadableRefusal({
        value: data.value,
        props: data.props,
        pressed: data.pressed,
        action: data.action,
      });

    if (unreadable) {
      return WorkspacePublicNoteApprovalActions.refused(unreadable.message);
    }

    const late: WorkspaceAnswer | null =
      await WorkspacePublicNoteApprovalActions.getLateAnswer({
        value: data.value,
        pressed: data.pressed,
      });

    return late ? WorkspacePublicNoteApprovalActions.news(late) : null;
  }

  /*
   * Why the member may not read the note, worded for the chat - or null
   * when they may. Read with their own props, as the Dashboard reads it.
   */
  private static async getUnreadableRefusal(data: {
    value: PublicNoteApprovalButtonValue;
    props: DatabaseCommonInteractionProps;
    pressed: PressedNote;
    action: string;
  }): Promise<Error | null> {
    let readable: BaseModel | null = null;
    let readError: unknown = undefined;

    try {
      readable = await data.pressed.host.service.findOneBy({
        query: {
          _id: data.value.noteId.toString(),
          projectId: data.value.projectId,
        } as unknown as Query<BaseModel>,
        select: {
          _id: true,
        } as unknown as Select<BaseModel>,
        props: data.props,
      });
    } catch (err) {
      if (!WorkspaceActionAuthorization.isReadRefusal(err)) {
        throw err;
      }

      readError = err;
    }

    if (readable) {
      return null;
    }

    return await WorkspaceActionAuthorization.getUnreadableRefusal({
      action: data.action,
      service: data.pressed.host.service,
      id: data.value.noteId,
      props: data.props,
      readError: readError,
    });
  }

  /*
   * What a press on a note that is no longer what its message asked about
   * says, as news - or null while it still is: waiting, in the same round
   * of approval, for the same step, which still publishes it or still does
   * not, with the same text.
   */
  private static async getLateAnswer(data: {
    value: PublicNoteApprovalButtonValue;
    pressed: PressedNote;
  }): Promise<WorkspaceAnswer | null> {
    const { value, pressed } = data;
    const round: PublicNoteApprovalRound | null = pressed.round;
    const isSameRound: boolean = round?.submittedAt === value.submittedAt;
    // What the message asked about: an edit of a published note, or a new note.
    const isEdit: boolean = value.isEdit;
    const record: MarkdownText =
      await WorkspacePublicNoteApprovalActions.getRecordMarkdown(data);
    const subject: MarkdownText = isEdit
      ? mdText`The edit of this public note on ${record}`
      : mdText`This public note on ${record}`;

    if (!PublicNoteApproval.isWaiting(pressed.state)) {
      // Approved by its last step, in the round the message asked about.
      if (
        isSameRound &&
        pressed.state === PublicNoteApprovalState.Published &&
        round?.publishedAt
      ) {
        const lastApproval: PublicNoteApprovalGiven | undefined =
          round.approvals[round.approvals.length - 1];

        return {
          markdown:
            mdText`✅ ${subject} was already approved${await WorkspacePublicNoteApprovalActions.getByAndWhen(
              {
                userId: lastApproval?.userId,
                at: lastApproval?.at || round.publishedAt,
              },
            )}. ${
              isEdit
                ? mdText`Status pages show the edited note.`
                : mdText`It is published on status pages.`
            }`.toString(),
          text: "This public note was already approved",
        };
      }

      if (
        isSameRound &&
        PublicNoteApproval.isRejected(pressed.state) &&
        round?.rejection
      ) {
        return {
          markdown:
            mdText`↩️ ${subject} was already rejected${await WorkspacePublicNoteApprovalActions.getByAndWhen(
              {
                userId: round.rejection.userId,
                at: round.rejection.at,
              },
            )}. ${
              isEdit
                ? mdText`Status pages keep showing the note as it was approved.`
                : mdText`It is not published.`
            }`.toString(),
          text: "This public note was already rejected",
        };
      }

      // Published without approval, its edit withdrawn, or sent again and decided.
      return {
        markdown:
          mdText`${subject} no longer waits for approval, so nothing was decided.`.toString(),
        text: "This public note no longer waits for approval",
      };
    }

    const readAgain: MarkdownText = mdText`Read it as it is now in ${ProductBrandingText.getProductName()} before you decide.`;

    // Sent for approval again since: edited, or rejected and sent as it was.
    if (!isSameRound) {
      return WorkspacePublicNoteApprovalActions.isSameText(data)
        ? {
            markdown:
              mdText`📝 ${subject} was sent for approval again after you were asked about it, so nothing was decided. ${readAgain}`.toString(),
            text: "This public note was sent for approval again",
          }
        : {
            markdown:
              mdText`📝 ${subject} changed after you were asked about it, so nothing was decided. ${readAgain}`.toString(),
            text: "This public note changed after you were asked about it",
          };
    }

    const steps: Array<PublicNoteApprovalStepRule> =
      await PublicNoteApprovalPolicy.getSteps({
        projectId: value.projectId,
        eventType: pressed.host.eventType,
      });

    const position: PublicNoteApprovalPosition = PublicNoteApproval.getPosition(
      round,
      steps,
    );

    if (
      position.step?.id === value.stepId &&
      position.isFinal === value.isFinal
    ) {
      if (WorkspacePublicNoteApprovalActions.isSameText(data)) {
        return null;
      }

      return {
        markdown:
          mdText`📝 ${subject} changed after you were asked about it, so nothing was decided. ${readAgain}`.toString(),
        text: "This public note changed after you were asked about it",
      };
    }

    const waitingFor: MarkdownText =
      await WorkspacePublicNoteApprovalActions.getWaitingForMarkdown(pressed);

    // The step the message asked about, approved by somebody already.
    const approvedStep: PublicNoteApprovalGiven | undefined =
      round?.approvals.find((given: PublicNoteApprovalGiven): boolean => {
        return given.stepId === value.stepId;
      });
    const sorted: Array<PublicNoteApprovalStepRule> =
      PublicNoteApproval.sortSteps(steps);
    const approvedIndex: number = sorted.findIndex(
      (step: PublicNoteApprovalStepRule): boolean => {
        return step.id === value.stepId;
      },
    );

    if (approvedStep && approvedIndex >= 0) {
      const stepName: MarkdownText = PublicNoteApprovalFeed.approvedStepName({
        step: sorted[approvedIndex]!,
        number: approvedIndex + 1,
        count: sorted.length,
        isFinal: false,
        isAskedAgain: false,
      });

      return {
        markdown:
          mdText`✅ ${subject} was already approved for ${stepName}${await WorkspacePublicNoteApprovalActions.getByAndWhen(
            {
              userId: approvedStep.userId,
              at: approvedStep.at,
            },
          )}. ${waitingFor}`.toString(),
        text: "This public note was already approved for this step",
      };
    }

    return {
      markdown: mdText`${
        isEdit
          ? mdText`The approval steps of the edit of this public note on ${record}`
          : mdText`The approval steps of this public note on ${record}`
      } changed after you were asked about it, so nothing was decided. ${waitingFor}`.toString(),
      text: "The approval steps of this public note changed",
    };
  }

  // Whether the note still says what its message showed.
  private static isSameText(data: {
    value: PublicNoteApprovalButtonValue;
    pressed: PressedNote;
  }): boolean {
    return (
      WorkspacePublicNoteApproval.getTextDigest(
        PublicNoteApprovalEngine.getTextToApprove(data.pressed.columns),
      ) === data.value.textDigest
    );
  }

  // ---------- answering ----------

  /*
   * What an approval came to, in the feed's words, said to the approver:
   * approved and published, or approved for its step with who it waits for
   * next - the step the engine wrote their approval for.
   */
  private static async getApprovedAnswer(data: {
    value: PublicNoteApprovalButtonValue;
    pressed: PressedNote;
    outcome: PublicNoteApprovalOutcome;
    props: DatabaseCommonInteractionProps;
  }): Promise<WorkspaceAnswer> {
    const isEdit: boolean = data.pressed.columns.isPublished !== false;
    const record: MarkdownText =
      await WorkspacePublicNoteApprovalActions.getRecordMarkdown(data);
    const what: MarkdownText = isEdit
      ? mdText`the edit of a **public note**`
      : mdText`a **public note**`;

    if (data.outcome.state === PublicNoteApprovalState.Published) {
      return isEdit
        ? {
            markdown:
              mdText`✅ You approved ${what} on ${record}. Status pages now show the edited note.`.toString(),
            text: "You approved the edit of a public note. Status pages now show it",
          }
        : {
            markdown:
              mdText`✅ You approved ${what} on ${record}. It is now published on status pages.`.toString(),
            text: "You approved a public note. It is now published on status pages",
          };
    }

    const approvedFor: MarkdownText | null =
      await WorkspacePublicNoteApprovalActions.getApprovedFor(data);

    if (!approvedFor) {
      return {
        markdown: mdText`✅ You approved ${what} on ${record}.`.toString(),
        text: "You approved a public note",
      };
    }

    return {
      markdown:
        mdText`✅ You approved ${what} on ${record} for ${approvedFor}`.toString(),
      text: "You approved a public note for its step",
    };
  }

  /*
   * "step 1 of 2 (Support). It waits for step 2 of 2 (Legal): Carol." - the
   * step the member's approval was written for, as the note reads after
   * it, and who it waits for now. Null when it cannot be read: the answer
   * then says only that they approved it.
   */
  private static async getApprovedFor(data: {
    value: PublicNoteApprovalButtonValue;
    props: DatabaseCommonInteractionProps;
  }): Promise<MarkdownText | null> {
    try {
      const after: PressedNote | null =
        await WorkspacePublicNoteApprovalActions.readNote(data.value);
      const userId: string = data.props.userId?.toString() || "";

      if (!after || !after.round || !userId) {
        return null;
      }

      const given: PublicNoteApprovalGiven | undefined = [
        ...after.round.approvals,
      ]
        .reverse()
        .find((approval: PublicNoteApprovalGiven): boolean => {
          return approval.userId === userId;
        });

      const steps: Array<PublicNoteApprovalStepRule> =
        PublicNoteApproval.sortSteps(
          await PublicNoteApprovalPolicy.getSteps({
            projectId: data.value.projectId,
            eventType: after.host.eventType,
          }),
        );

      const index: number = given
        ? steps.findIndex((step: PublicNoteApprovalStepRule): boolean => {
            return step.id === given.stepId;
          })
        : -1;

      if (index < 0) {
        return null;
      }

      const stepName: MarkdownText = PublicNoteApprovalFeed.approvedStepName({
        step: steps[index]!,
        number: index + 1,
        count: steps.length,
        isFinal: false,
        isAskedAgain: false,
      });

      return mdText`${stepName}. ${await WorkspacePublicNoteApprovalActions.getWaitingForMarkdown(after)}`;
    } catch (err) {
      logger.error(
        "Could not read where a public note approved from chat stands.",
      );
      logger.error(err);
      return null;
    }
  }

  // What a rejection came to, said to the approver who rejected it.
  private static async getRejectedAnswer(data: {
    value: PublicNoteApprovalButtonValue;
    pressed: PressedNote;
  }): Promise<WorkspaceAnswer> {
    const isEdit: boolean = data.pressed.columns.isPublished !== false;
    const record: MarkdownText =
      await WorkspacePublicNoteApprovalActions.getRecordMarkdown(data);

    return isEdit
      ? {
          markdown:
            mdText`↩️ You rejected the edit of a **public note** on ${record}. Status pages keep showing the note as it was approved, and its author sees your reason.`.toString(),
          text: "You rejected the edit of a public note",
        }
      : {
          markdown:
            mdText`↩️ You rejected a **public note** on ${record}. It is not published, and its author sees your reason.`.toString(),
          text: "You rejected a public note",
        };
  }

  /*
   * A refusal of the engine's, told in its words - and the two that are not
   * refusals of the member: a note decided by somebody else a moment
   * earlier, told as what they decided, and a note the engine could not
   * read for them, told as why.
   */
  private static async getRefusal(data: {
    err: unknown;
    value: PublicNoteApprovalButtonValue;
    props: DatabaseCommonInteractionProps;
    action: string;
  }): Promise<PublicNoteApprovalPressAnswer> {
    const { err } = data;

    if (
      err instanceof BadDataException &&
      err.message === PublicNoteApprovalMessages.decidedMeanwhile
    ) {
      const pressed: PressedNote | null =
        await WorkspacePublicNoteApprovalActions.readNote(data.value);

      if (!pressed) {
        return WorkspacePublicNoteApprovalActions.news(
          WorkspacePublicNoteApprovalActions.textAnswer(
            WorkspacePublicNoteApprovalActions.getGoneMessage(),
          ),
        );
      }

      const late: WorkspaceAnswer | null =
        await WorkspacePublicNoteApprovalActions.getLateAnswer({
          value: data.value,
          pressed: pressed,
        });

      return late
        ? WorkspacePublicNoteApprovalActions.news(late)
        : WorkspacePublicNoteApprovalActions.refused(err.message);
    }

    if (err instanceof NotFoundException) {
      const pressed: PressedNote | null =
        await WorkspacePublicNoteApprovalActions.readNote(data.value);

      if (!pressed) {
        return WorkspacePublicNoteApprovalActions.news(
          WorkspacePublicNoteApprovalActions.textAnswer(
            WorkspacePublicNoteApprovalActions.getGoneMessage(),
          ),
        );
      }

      const unreadable: Error | null =
        await WorkspacePublicNoteApprovalActions.getUnreadableRefusal({
          value: data.value,
          props: data.props,
          pressed: pressed,
          action: data.action,
        });

      return WorkspacePublicNoteApprovalActions.refused(
        unreadable ? unreadable.message : err.message,
      );
    }

    if (err instanceof PaymentRequiredException) {
      return WorkspacePublicNoteApprovalActions.refused(
        `Could not ${data.action}: ${err.message}`,
      );
    }

    if (
      err instanceof BadDataException ||
      err instanceof NotAuthorizedException
    ) {
      return WorkspacePublicNoteApprovalActions.refused(err.message);
    }

    throw err;
  }

  // "[Incident INC-42](its public notes)", or "the incident" when it cannot be read.
  private static async getRecordMarkdown(data: {
    value: PublicNoteApprovalButtonValue;
    pressed: PressedNote;
  }): Promise<MarkdownText> {
    const record: PublicNoteApprovalRecordInfo | null =
      await WorkspacePublicNoteApprovalActions.readRecord(data);

    if (record?.label && record.notesUrl) {
      return FeedMarkdown.link(record.label, record.notesUrl);
    }

    if (record?.label) {
      return mdText`${record.label}`;
    }

    return mdText`the ${WorkspaceMemberActions.getNoun(
      WorkspacePublicNoteApproval.getEventType(data.value.kind),
    )}`;
  }

  // "It waits for step 2 of 2 (Legal): Carol." - the feed's words.
  private static async getWaitingForMarkdown(
    pressed: PressedNote,
  ): Promise<MarkdownText> {
    const waitingFor: PublicNoteApprovalWaitingFor | null =
      await PublicNoteApprovalEngine.getWaitingForNote({
        eventType: pressed.host.eventType,
        note: pressed.columns,
      });

    return waitingFor
      ? PublicNoteApprovalFeed.waitingFor(waitingFor)
      : FeedMarkdown.empty();
  }

  // " by **Carol** at 5:28 PM", " at 5:28 PM", or nothing.
  private static async getByAndWhen(data: {
    userId?: string | undefined;
    at?: string | undefined;
  }): Promise<MarkdownText> {
    let name: string = "";

    if (data.userId) {
      try {
        name =
          (await PublicNoteApprovalNotifications.getUserNames([data.userId]))[
            data.userId
          ] || "";
      } catch (err) {
        logger.debug("Could not read who decided a public note.");
        logger.debug(err);
      }
    }

    const at: Date | null = data.at ? new Date(data.at) : null;
    const when: MarkdownText | null =
      at && !Number.isNaN(at.getTime()) ? WorkspaceMessageTime.time(at) : null;

    if (name && when) {
      return mdText` by **${name}** at ${when}`;
    }

    if (name) {
      return mdText` by **${name}**`;
    }

    if (when) {
      return mdText` at ${when}`;
    }

    return FeedMarkdown.empty();
  }

  private static textAnswer(message: string): WorkspaceAnswer {
    return { markdown: mdText`${message}`.toString(), text: message };
  }

  private static news(answer: WorkspaceAnswer): PublicNoteApprovalPressAnswer {
    return { outcome: PublicNoteApprovalPressOutcome.News, answer: answer };
  }

  private static refused(message: string): PublicNoteApprovalPressAnswer {
    return {
      outcome: PublicNoteApprovalPressOutcome.Refused,
      answer: WorkspacePublicNoteApprovalActions.textAnswer(message),
    };
  }
}
