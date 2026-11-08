import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspacePublicNoteApprovalMessage from "../../../Models/DatabaseModels/WorkspacePublicNoteApprovalMessage";
import ColumnLength from "../../../Types/Database/ColumnLength";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceType, {
  getWorkspaceTypeDisplayName,
} from "../../../Types/Workspace/WorkspaceType";
import WorkspaceProjectAuthTokenService from "../../Services/WorkspaceProjectAuthTokenService";
import WorkspacePublicNoteApprovalMessageService, {
  Service as WorkspacePublicNoteApprovalMessageServiceClass,
  WorkspacePublicNoteApprovalMessageNoteColumn,
} from "../../Services/WorkspacePublicNoteApprovalMessageService";
import { WorkspaceSentDirectMessage } from "../../Services/WorkspaceUserNotificationService";
import logger, { EXTERNAL_FAULT, LogAttributes } from "../Logger";
import { PublicNoteKind } from "../Notes/PublicNoteApprovalEngine";
import CaptureSpan from "../Telemetry/CaptureSpan";
import MattermostUtil from "./Mattermost/Mattermost";
import MicrosoftTeamsUtil from "./MicrosoftTeams/MicrosoftTeams";
import SlackUtil from "./Slack/Slack";
import WorkspaceBase from "./WorkspaceBase";
import WorkspacePublicNoteApproval, {
  PublicNoteApprovalButtonValue,
  PublicNoteApprovalReplacement,
  WorkspaceDirectMessage,
} from "./WorkspacePublicNoteApproval";
import WorkspacePublicNoteApprovalActions from "./WorkspacePublicNoteApprovalActions";

/*
 * A PUBLIC NOTE'S APPROVAL MESSAGES, REPLACED ONCE THE NOTE IS DECIDED (#6317).
 *
 * Every approver of the step a public note waits for who chose Slack,
 * Microsoft Teams or Mattermost gets a copy of its approval message, with
 * Approve and Reject (WorkspacePublicNoteApproval). Each copy is kept as it
 * is sent (keep): where it landed, the workspace it was sent through, and
 * what it asked - the note, the round, the step, the text - as its buttons
 * carry it (WorkspacePublicNoteApprovalMessage).
 *
 * Once the note is no longer what a copy asked about - its step approved,
 * the note published, rejected, edited or sent for approval again,
 * published without approval once approval was turned off, its edit
 * withdrawn, the note deleted - the copy says what happened in its place,
 * in the words a press on it would get (WorkspacePublicNoteApprovalActions
 * .getReplacement), with View in OneUptime and without Approve or Reject
 * (WorkspacePublicNoteApproval.getReplacementMessage). The decider's own
 * copy is one of them, beside the answer their press got.
 *
 *  - What a copy says is worked out from the note as it is when the pass
 *    runs, so passes started in any order - two decisions a moment apart -
 *    leave every copy saying what is true, and a copy that still asks - the
 *    next step's, sent as its step began - is left as it is.
 *  - Never on a decision's way: each pass runs in the background once the
 *    decision is written (inBackground) and returns at once. A copy that
 *    cannot be replaced - deleted, the app removed, the token revoked, a
 *    rate limit - is logged and skipped.
 *  - A copy is taken out of the table before it is replaced (claim), so it
 *    is replaced once, and never kept past its round, whatever came of
 *    replacing it. A note deleted takes its copies with it (ON DELETE
 *    CASCADE): its services read them before the delete, and replace them
 *    after it.
 *  - A copy is replaced only through the project's connection to the very
 *    workspace it was sent through (workspaceProjectId): never with the
 *    token of another project, nor of another workspace the project was
 *    connected to since.
 *  - A copy sent as the note moved on - its message on its way while
 *    somebody decided - is looked at again as soon as it is kept, and
 *    replaced then.
 */
export default class WorkspacePublicNoteApprovalMessages {
  // The passes running in the background, for settle.
  private static running: Set<Promise<void>> = new Set<Promise<void>>();

  /*
   * Runs `work` in the background: the caller goes on at once, and nothing
   * of `work` - not its first read, not a failure - reaches it. A failure is
   * logged.
   */
  public static inBackground(what: string, work: () => Promise<unknown>): void {
    const run: Promise<void> = Promise.resolve()
      .then(work)
      .then(
        (): void => {
          return undefined;
        },
        (err: unknown): void => {
          logger.error(`Public note approval: could not ${what}.`);
          logger.error(err);
        },
      );

    WorkspacePublicNoteApprovalMessages.running.add(run);

    void run.then((): void => {
      WorkspacePublicNoteApprovalMessages.running.delete(run);
    });
  }

  /*
   * Waits for the passes started so far, and for those they start: what a
   * test, or a process about to stop, waits on.
   */
  public static async settle(): Promise<void> {
    while (WorkspacePublicNoteApprovalMessages.running.size > 0) {
      await Promise.all(Array.from(WorkspacePublicNoteApprovalMessages.running));
    }
  }

  // ---------- keeping a copy ----------

  /*
   * Keeps a copy of an approval message, as it was sent to `userId`: the
   * value its buttons carry, and where it landed (WorkspaceUserNotification
   * Service's onSent). A copy that asks about a note that moved on while it
   * was on its way is replaced at once. Best effort: a copy that cannot be
   * kept keeps its buttons, and a press on it is still told what happened.
   */
  @CaptureSpan()
  public static async keep(data: {
    value: PublicNoteApprovalButtonValue;
    userId: ObjectID;
    sent: WorkspaceSentDirectMessage;
  }): Promise<void> {
    const { value, sent } = data;
    const logAttributes: LogAttributes = {
      projectId: value.projectId.toString(),
      workspaceType: sent.workspaceType,
    };

    if (
      !WorkspacePublicNoteApprovalMessages.isKeepable(sent.channelId) ||
      !WorkspacePublicNoteApprovalMessages.isKeepable(sent.messageId) ||
      !WorkspacePublicNoteApprovalMessages.isKeepable(sent.workspaceProjectId)
    ) {
      logger.debug(
        `A ${getWorkspaceTypeDisplayName(sent.workspaceType)} approval message was sent, but where it landed cannot be kept, so it is not replaced once its note is decided.`,
        logAttributes,
      );
      return;
    }

    const row: WorkspacePublicNoteApprovalMessage =
      new WorkspacePublicNoteApprovalMessage();
    row.projectId = value.projectId;
    row.userId = data.userId;
    row[WorkspacePublicNoteApprovalMessages.getNoteColumn(value.kind)] =
      value.noteId;
    row.recordId = value.recordId;
    row.workspaceType = sent.workspaceType;
    row.workspaceProjectId = sent.workspaceProjectId;
    row.channelId = sent.channelId;
    row.messageId = sent.messageId;

    if (WorkspacePublicNoteApprovalMessages.isKeepable(sent.serviceUrl)) {
      row.serviceUrl = sent.serviceUrl!;
    }

    row.submittedAt = value.submittedAt;
    row.stepId = value.stepId;
    row.isFinal = value.isFinal;
    row.isEdit = value.isEdit;
    row.textDigest = value.textDigest;

    let kept: WorkspacePublicNoteApprovalMessage;

    try {
      kept = await WorkspacePublicNoteApprovalMessageService.create({
        data: row,
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      logger.error(
        "An approval message was sent, but OneUptime could not keep it to replace it once its note is decided.",
        logAttributes,
      );
      logger.error(err, logAttributes);
      return;
    }

    // Decided, or changed, while it was on its way: replaced now.
    await WorkspacePublicNoteApprovalMessages.replaceKept({
      kept: [kept],
      isClaimed: false,
    });
  }

  // ---------- replacing the copies ----------

  /*
   * Once a decision, a resubmission, an edit or a withdrawal of a note is
   * written: every kept copy of its approval message that no longer asks
   * what is true is replaced, in the background (replaceOver).
   */
  public static replaceWhenOver(data: {
    kind: PublicNoteKind;
    projectId: ObjectID;
    noteId: ObjectID;
  }): void {
    WorkspacePublicNoteApprovalMessages.inBackground(
      "replace the chat messages of a public note",
      async (): Promise<number> => {
        return await WorkspacePublicNoteApprovalMessages.replaceOver(data);
      },
    );
  }

  /*
   * Every kept copy of the note's approval message that no longer asks what
   * is true, replaced by what happened; the copies that still ask - the
   * step the note waits for now - are left as they are. How many were
   * replaced.
   */
  @CaptureSpan()
  public static async replaceOver(data: {
    kind: PublicNoteKind;
    projectId: ObjectID;
    noteId: ObjectID;
  }): Promise<number> {
    const kept: Array<WorkspacePublicNoteApprovalMessage> =
      await WorkspacePublicNoteApprovalMessageService.findForNotes({
        projectId: data.projectId,
        noteColumn: WorkspacePublicNoteApprovalMessages.getNoteColumn(
          data.kind,
        ),
        noteIds: [data.noteId],
      });

    return await WorkspacePublicNoteApprovalMessages.replaceKept({
      kept: kept,
      isClaimed: false,
    });
  }

  // ---------- a note deleted ----------

  /*
   * The copies kept for these notes, read before a delete of them takes
   * them out of the table (ON DELETE CASCADE): what replaceDeleted replaces
   * once the delete is done. Best effort: none when they cannot be read.
   */
  @CaptureSpan()
  public static async readForNotes(data: {
    kind: PublicNoteKind;
    notes: Array<{ id?: ObjectID | null | undefined; projectId?: ObjectID | undefined }>;
  }): Promise<Array<WorkspacePublicNoteApprovalMessage>> {
    return await WorkspacePublicNoteApprovalMessages.readByProject({
      rows: data.notes,
      read: async (
        projectId: ObjectID,
        ids: Array<ObjectID>,
      ): Promise<Array<WorkspacePublicNoteApprovalMessage>> => {
        return await WorkspacePublicNoteApprovalMessageService.findForNotes({
          projectId: projectId,
          noteColumn: WorkspacePublicNoteApprovalMessages.getNoteColumn(
            data.kind,
          ),
          noteIds: ids,
        });
      },
    });
  }

  /*
   * The same for the records a delete removes - incidents, episodes,
   * scheduled maintenance events - and the notes the database deletes with
   * them.
   */
  @CaptureSpan()
  public static async readForRecords(data: {
    kind: PublicNoteKind;
    records: Array<{
      id?: ObjectID | null | undefined;
      projectId?: ObjectID | undefined;
    }>;
  }): Promise<Array<WorkspacePublicNoteApprovalMessage>> {
    return await WorkspacePublicNoteApprovalMessages.readByProject({
      rows: data.records,
      read: async (
        projectId: ObjectID,
        ids: Array<ObjectID>,
      ): Promise<Array<WorkspacePublicNoteApprovalMessage>> => {
        return await WorkspacePublicNoteApprovalMessageService.findForRecords({
          projectId: projectId,
          noteColumn: WorkspacePublicNoteApprovalMessages.getNoteColumn(
            data.kind,
          ),
          recordIds: ids,
        });
      },
    });
  }

  /*
   * Once a delete is done: the copies read before it (readForNotes,
   * readForRecords) whose note - or record - it removed say the note was
   * deleted, in the background. `deletedIds` are the ids of the rows the
   * delete removed, notes or records, as `by` says.
   */
  public static replaceDeleted(data: {
    kept: Array<WorkspacePublicNoteApprovalMessage>;
    deletedIds: Array<ObjectID>;
    by: "note" | "record";
  }): void {
    const deleted: Set<string> = new Set<string>(
      data.deletedIds.map((id: ObjectID): string => {
        return id.toString().toLowerCase();
      }),
    );

    const gone: Array<WorkspacePublicNoteApprovalMessage> = data.kept.filter(
      (kept: WorkspacePublicNoteApprovalMessage): boolean => {
        const id: ObjectID | null | undefined =
          data.by === "note"
            ? WorkspacePublicNoteApprovalMessageServiceClass.getNoteId(kept)
            : kept.recordId;

        return Boolean(id && deleted.has(id.toString().toLowerCase()));
      },
    );

    if (gone.length === 0) {
      return;
    }

    WorkspacePublicNoteApprovalMessages.inBackground(
      "replace the chat messages of a deleted public note",
      async (): Promise<number> => {
        // Out of the table already, with their notes: nothing to claim.
        return await WorkspacePublicNoteApprovalMessages.replaceKept({
          kept: gone,
          isClaimed: true,
        });
      },
    );
  }

  // ---------- how a copy is replaced ----------

  /*
   * Replaces the kept copies whose message no longer asks what is true -
   * all the copies of one message at once: they carry the same value - and
   * leaves the others. Each copy is claimed first (unless `isClaimed`: its
   * row is gone already), so only one pass replaces it. How many were
   * replaced. A group that fails is logged, and the others go on.
   */
  private static async replaceKept(data: {
    kept: Array<WorkspacePublicNoteApprovalMessage>;
    isClaimed: boolean;
  }): Promise<number> {
    const groups: Map<
      string,
      {
        value: PublicNoteApprovalButtonValue | null;
        kept: Array<WorkspacePublicNoteApprovalMessage>;
      }
    > = new Map();

    for (const kept of data.kept) {
      const value: PublicNoteApprovalButtonValue | null =
        WorkspacePublicNoteApprovalMessages.toValue(kept);
      const key: string = value
        ? WorkspacePublicNoteApprovalMessages.getValueKey(value)
        : "";

      const group: {
        value: PublicNoteApprovalButtonValue | null;
        kept: Array<WorkspacePublicNoteApprovalMessage>;
      } = groups.get(key) || { value: value, kept: [] };

      group.kept.push(kept);
      groups.set(key, group);
    }

    let replaced: number = 0;

    for (const group of groups.values()) {
      try {
        // A copy that names no note it can be read for asks nothing: dropped.
        if (!group.value) {
          if (!data.isClaimed) {
            for (const kept of group.kept) {
              await WorkspacePublicNoteApprovalMessages.claim(kept);
            }
          }

          continue;
        }

        const replacement: PublicNoteApprovalReplacement | null =
          await WorkspacePublicNoteApprovalActions.getReplacement(group.value);

        // Still asks what is true: the step the note waits for now.
        if (!replacement) {
          continue;
        }

        const message: WorkspaceDirectMessage =
          WorkspacePublicNoteApproval.getReplacementMessage(replacement);

        for (const kept of group.kept) {
          if (
            !data.isClaimed &&
            !(await WorkspacePublicNoteApprovalMessages.claim(kept))
          ) {
            // Another pass took it: it replaces it.
            continue;
          }

          if (
            await WorkspacePublicNoteApprovalMessages.replaceMessage({
              kept: kept,
              message: message,
            })
          ) {
            replaced++;
          }
        }
      } catch (err) {
        logger.error(
          "Public note approval: could not replace the chat messages of a public note.",
          {
            projectId: group.value?.projectId.toString(),
          } as LogAttributes,
        );
        logger.error(err, {
          projectId: group.value?.projectId.toString(),
        } as LogAttributes);
      }
    }

    return replaced;
  }

  /*
   * Takes a kept copy out of the table: true when this pass took it. One
   * that cannot be taken is left, logged: the next pass tries again.
   */
  private static async claim(
    kept: WorkspacePublicNoteApprovalMessage,
  ): Promise<boolean> {
    if (!kept.id || !kept.projectId) {
      return false;
    }

    try {
      return await WorkspacePublicNoteApprovalMessageService.claim({
        id: kept.id,
        projectId: kept.projectId,
      });
    } catch (err) {
      logger.error(
        "Public note approval: could not take a kept chat message out of the table.",
        { projectId: kept.projectId.toString() },
      );
      logger.error(err, { projectId: kept.projectId.toString() });
      return false;
    }
  }

  /*
   * Puts `message` in place of one kept copy, through the project's
   * connection to the workspace the copy was sent through - and no other:
   * one the project is no longer connected to, or connected to another
   * workspace of since, is left as it is. True when the chat took the edit.
   * A refusal - the message deleted, the app removed, the token revoked, a
   * rate limit - is logged and skipped.
   */
  private static async replaceMessage(data: {
    kept: WorkspacePublicNoteApprovalMessage;
    message: WorkspaceDirectMessage;
  }): Promise<boolean> {
    const { kept, message } = data;
    const workspaceType: WorkspaceType | undefined = kept.workspaceType;
    const logAttributes: LogAttributes = {
      projectId: kept.projectId?.toString(),
      workspaceType: workspaceType,
    };

    if (!kept.projectId || !workspaceType || !kept.channelId || !kept.messageId) {
      return false;
    }

    const workspaceName: string = getWorkspaceTypeDisplayName(workspaceType);

    let projectAuth: WorkspaceProjectAuthToken | null = null;

    try {
      projectAuth = await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: kept.projectId,
        workspaceType: workspaceType,
      });
    } catch (err) {
      logger.error(
        `Could not read the project's ${workspaceName} connection to replace an approval message.`,
        logAttributes,
      );
      logger.error(err, logAttributes);
      return false;
    }

    if (!projectAuth || !projectAuth.authToken) {
      logger.debug(
        `${workspaceName} is no longer connected to the project: an approval message was not replaced.`,
        logAttributes,
      );
      return false;
    }

    if (
      !projectAuth.workspaceProjectId ||
      projectAuth.workspaceProjectId !== kept.workspaceProjectId
    ) {
      logger.debug(
        `The project is connected to another ${workspaceName} workspace than the one an approval message was sent through: it was not replaced.`,
        logAttributes,
      );
      return false;
    }

    const update: Parameters<typeof WorkspaceBase.updateMessage>[0] = {
      authToken: projectAuth.authToken,
      projectId: kept.projectId,
      location: {
        channelId: kept.channelId,
        // A Microsoft Teams direct message is a personal chat.
        ...(workspaceType === WorkspaceType.MicrosoftTeams
          ? {
              isChat: true,
              ...(kept.serviceUrl ? { serviceUrl: kept.serviceUrl } : {}),
            }
          : {}),
      },
      messageId: kept.messageId,
      messageBlocks: message.messageBlocks,
      text: message.notificationText,
    };

    let workspaceUtil: typeof WorkspaceBase;

    switch (workspaceType) {
      case WorkspaceType.Slack:
        workspaceUtil = SlackUtil;
        break;
      case WorkspaceType.MicrosoftTeams:
        workspaceUtil = MicrosoftTeamsUtil;
        break;
      case WorkspaceType.Mattermost:
        workspaceUtil = MattermostUtil;
        break;
      default:
        return false;
    }

    try {
      await workspaceUtil.updateMessage(update);
      return true;
    } catch (err) {
      logger.error(
        workspaceUtil.isMessageGoneError(err)
          ? `An approval message in ${workspaceName} was deleted, so it was not replaced.`
          : `Could not replace an approval message in ${workspaceName}: ${WorkspaceBase.getSendErrorMessage(err)}`,
        { ...EXTERNAL_FAULT, ...logAttributes },
      );
      return false;
    }
  }

  // ---------- reading what was kept ----------

  // The column that names a kind of note's row.
  public static getNoteColumn(
    kind: PublicNoteKind,
  ): WorkspacePublicNoteApprovalMessageNoteColumn {
    switch (kind) {
      case PublicNoteKind.Incident:
        return "incidentPublicNoteId";
      case PublicNoteKind.IncidentEpisode:
        return "incidentEpisodePublicNoteId";
      case PublicNoteKind.ScheduledMaintenance:
        return "scheduledMaintenancePublicNoteId";
    }
  }

  // The kind of note a kept message is about, by the column that names it.
  public static getKind(
    kept: WorkspacePublicNoteApprovalMessage,
  ): PublicNoteKind | null {
    if (kept.incidentPublicNoteId) {
      return PublicNoteKind.Incident;
    }

    if (kept.incidentEpisodePublicNoteId) {
      return PublicNoteKind.IncidentEpisode;
    }

    if (kept.scheduledMaintenancePublicNoteId) {
      return PublicNoteKind.ScheduledMaintenance;
    }

    return null;
  }

  // What a kept copy's buttons carried; null for a row that names no note.
  public static toValue(
    kept: WorkspacePublicNoteApprovalMessage,
  ): PublicNoteApprovalButtonValue | null {
    const kind: PublicNoteKind | null =
      WorkspacePublicNoteApprovalMessages.getKind(kept);
    const noteId: ObjectID | null =
      WorkspacePublicNoteApprovalMessageServiceClass.getNoteId(kept);

    if (
      !kind ||
      !noteId ||
      !kept.projectId ||
      !kept.recordId ||
      !kept.submittedAt ||
      !kept.stepId ||
      !kept.textDigest
    ) {
      return null;
    }

    return {
      kind: kind,
      projectId: kept.projectId,
      recordId: kept.recordId,
      noteId: noteId,
      submittedAt: kept.submittedAt,
      stepId: kept.stepId,
      isFinal: Boolean(kept.isFinal),
      isEdit: Boolean(kept.isEdit),
      textDigest: kept.textDigest,
    };
  }

  // The copies of one message carry one value.
  private static getValueKey(value: PublicNoteApprovalButtonValue): string {
    return JSON.stringify([
      value.kind,
      value.projectId.toString().toLowerCase(),
      value.recordId.toString().toLowerCase(),
      value.noteId.toString().toLowerCase(),
      value.submittedAt,
      value.stepId,
      value.isFinal,
      value.isEdit,
      value.textDigest,
    ]);
  }

  // A value a column of the table can hold.
  private static isKeepable(value: string | null | undefined): boolean {
    return (
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= ColumnLength.LongText
    );
  }

  // Rows of several projects, read project by project. Best effort.
  private static async readByProject(data: {
    rows: Array<{
      id?: ObjectID | null | undefined;
      projectId?: ObjectID | undefined;
    }>;
    read: (
      projectId: ObjectID,
      ids: Array<ObjectID>,
    ) => Promise<Array<WorkspacePublicNoteApprovalMessage>>;
  }): Promise<Array<WorkspacePublicNoteApprovalMessage>> {
    const byProject: Map<string, { projectId: ObjectID; ids: Array<ObjectID> }> =
      new Map();

    for (const row of data.rows) {
      if (!row.id || !row.projectId) {
        continue;
      }

      const key: string = row.projectId.toString().toLowerCase();
      const entry: { projectId: ObjectID; ids: Array<ObjectID> } =
        byProject.get(key) || { projectId: row.projectId, ids: [] };

      entry.ids.push(row.id);
      byProject.set(key, entry);
    }

    const kept: Array<WorkspacePublicNoteApprovalMessage> = [];

    for (const entry of byProject.values()) {
      try {
        kept.push(...(await data.read(entry.projectId, entry.ids)));
      } catch (err) {
        logger.error(
          "Public note approval: could not read the chat messages kept for public notes being deleted.",
          { projectId: entry.projectId.toString() },
        );
        logger.error(err, { projectId: entry.projectId.toString() });
      }
    }

    return kept;
  }
}
