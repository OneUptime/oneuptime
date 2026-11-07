import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import {
  PublicNoteApprovalColumns,
  PublicNoteApprovalEventType,
} from "../../../Types/StatusPage/PublicNoteApproval";
import { MarkdownText, mdText } from "../../../Utils/Markdown/FeedMarkdown";
import PublicNoteApprovalEngine from "../Notes/PublicNoteApprovalEngine";
import PublicNoteApprovalFeed, {
  PublicNoteApprovalWaitingFor,
} from "../Notes/PublicNoteApprovalFeed";
import PublicNoteApprovalPolicy from "../Notes/PublicNoteApprovalPolicy";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import WorkspaceActionAnswers, {
  WorkspaceAnswer,
  WorkspaceRecordName,
} from "./WorkspaceActionAnswers";
import WorkspaceMemberActions, {
  WorkspaceEvent,
  WorkspaceEventRecord,
  WorkspaceEventType,
} from "./WorkspaceMemberActions";

/*
 * A PUBLIC NOTE SENT FROM CHAT THAT WAITS FOR APPROVAL (#6254).
 *
 * While a project asks for its public notes to be approved, a public note
 * added from Slack, Microsoft Teams or Mattermost - the Add Note form of a
 * record's message, or a message saved as a note - is held: no status page
 * shows it and no channel is told until it is approved
 * (PublicNoteApprovalEngine). The record's channel post used to be the
 * answer that a note was posted, and a held note makes none, so the person
 * who sent it heard nothing and could think it failed and send it again.
 * They are told here instead, in the words the Dashboard uses: it was sent
 * for approval, it is published on status pages once it is approved, and
 * who it waits for - "⏳ Sent for approval: your public note on Incident
 * INC-42 is published on status pages once it is approved. It waits for
 * step 1 of 2 (Support): Bob, Platform."
 *
 * The forms say so before anything is sent: their public option reads
 * "Posted on Status Page once approved" while approval is on
 * (WorkspaceNoteForm.getPublicOption).
 *
 * Names - people's, teams', steps' - are text (mdText), as the feed writes
 * them: a name is whoever chose it.
 */

// The record types that take public notes, and whose approval each waits for.
const APPROVAL_EVENT_TYPES: Partial<
  Record<WorkspaceEventType, PublicNoteApprovalEventType>
> = {
  // Incidents and their episodes share one approval: the incident workflow's.
  [WorkspaceEventType.Incident]: PublicNoteApprovalEventType.Incident,
  [WorkspaceEventType.IncidentEpisode]: PublicNoteApprovalEventType.Incident,
  [WorkspaceEventType.ScheduledMaintenance]:
    PublicNoteApprovalEventType.ScheduledMaintenance,
};

export default class WorkspaceHeldPublicNote {
  // Whose approval a record's public notes wait for; null for one with no public notes.
  public static getApprovalEventType(
    type: WorkspaceEventType,
  ): PublicNoteApprovalEventType | null {
    return APPROVAL_EVENT_TYPES[type] || null;
  }

  /*
   * Whether a record's public notes wait for approval now, for its form to
   * say so before anything is sent. A failed read says no: the form is
   * still offered, as it always was, and the answer after the note is
   * written says what became of it.
   */
  @CaptureSpan()
  public static async isApprovalRequired(data: {
    type: WorkspaceEventType;
    projectId: ObjectID | null | undefined;
  }): Promise<boolean> {
    const eventType: PublicNoteApprovalEventType | null =
      this.getApprovalEventType(data.type);

    if (!eventType || !data.projectId) {
      return false;
    }

    try {
      return await PublicNoteApprovalPolicy.isRequired({
        projectId: data.projectId,
        eventType: eventType,
      });
    } catch (err) {
      logger.error(
        "Could not read whether public notes need approval for a chat form.",
      );
      logger.error(err);
      return false;
    }
  }

  /*
   * Who a public note just added waits for: null when it was published as
   * it was posted - its project asks for no approval - or when the record
   * takes no public notes.
   */
  @CaptureSpan()
  public static async getWaitingFor(data: {
    type: WorkspaceEventType;
    note: DatabaseBaseModel | null | undefined;
  }): Promise<PublicNoteApprovalWaitingFor | null> {
    const eventType: PublicNoteApprovalEventType | null =
      this.getApprovalEventType(data.type);

    if (!eventType || !data.note) {
      return null;
    }

    return await PublicNoteApprovalEngine.getWaitingForNote({
      eventType: eventType,
      note: data.note as unknown as PublicNoteApprovalColumns & {
        projectId?: ObjectID | null | undefined;
      },
    });
  }

  // Whether a note just written was held for approval rather than published.
  public static isHeldForApproval(
    note: DatabaseBaseModel | null | undefined,
  ): boolean {
    return (
      (note as unknown as PublicNoteApprovalColumns | null | undefined)
        ?.isPublished === false
    );
  }

  /*
   * "⏳ Sent for approval: your public note on **[Incident INC-42](link)**
   * is published on status pages once it is approved. It waits for step 1
   * of 2 (Support): Bob, Platform." - and the line a notification shows.
   * A record the member cannot read is "the incident"; who it waits for is
   * left out when it could not be read.
   */
  public static getAnswer(data: {
    // The record as the member can read it; null when they cannot.
    record: WorkspaceRecordName | null;
    type: WorkspaceEventType;
    waitingFor: PublicNoteApprovalWaitingFor | null;
  }): WorkspaceAnswer {
    const noun: string = WorkspaceMemberActions.getNoun(data.type);

    const recordMarkdown: MarkdownText = data.record
      ? WorkspaceActionAnswers.getRecordMarkdown(data.record)
      : mdText`the ${noun}`;

    const sentence: MarkdownText = mdText`⏳ Sent for approval: your public note on ${recordMarkdown} is published on status pages once it is approved.`;

    const markdown: MarkdownText = data.waitingFor
      ? mdText`${sentence} ${PublicNoteApprovalFeed.waitingFor(data.waitingFor)}`
      : sentence;

    return {
      markdown: markdown.toString(),
      text: `Sent for approval: your public note on ${
        data.record ? data.record.label : `the ${noun}`
      } is published on status pages once it is approved`,
    };
  }

  /*
   * The answer a member gets for the public note they just added from
   * chat, when it waits for approval - with the record named as they can
   * read it ("the incident" when they cannot). Null when it was published:
   * the record's channels are told it was posted, as before. The note is
   * written by now, so a read that fails here leaves its part out of the
   * answer rather than failing it: an error then would read as a note that
   * was not sent, and invite sending it again.
   */
  @CaptureSpan()
  public static async getAnswerForAddedNote(data: {
    event: WorkspaceEvent;
    note: DatabaseBaseModel | null | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<WorkspaceAnswer | null> {
    if (!this.isHeldForApproval(data.note)) {
      return null;
    }

    let waitingFor: PublicNoteApprovalWaitingFor | null = null;

    try {
      waitingFor = await this.getWaitingFor({
        type: data.event.type,
        note: data.note,
      });
    } catch (err) {
      logger.error("Could not read who a public note sent from chat waits for.");
      logger.error(err);
    }

    let record: WorkspaceRecordName | null = null;

    try {
      record = await this.getRecordName(data);
    } catch (err) {
      logger.error("Could not name the record of a public note sent from chat.");
      logger.error(err);
    }

    return this.getAnswer({
      record: record,
      type: data.event.type,
      waitingFor: waitingFor,
    });
  }

  // The record as the member can read it; null when they cannot.
  private static async getRecordName(data: {
    event: WorkspaceEvent;
    props: DatabaseCommonInteractionProps;
  }): Promise<WorkspaceRecordName | null> {
    const found: {
      record: DatabaseBaseModel;
      event: WorkspaceEventRecord;
    } | null = await WorkspaceMemberActions.findEventForMember<DatabaseBaseModel>(
      {
        event: data.event,
        props: data.props,
        select: {
          _id: true,
        },
      },
    );

    if (!found) {
      return null;
    }

    return await WorkspaceActionAnswers.getRecordName(found.event);
  }
}
