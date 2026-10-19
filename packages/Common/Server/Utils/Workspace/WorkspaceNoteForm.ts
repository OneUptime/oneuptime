import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import { PrivateRecordKind } from "../../../Types/StatusPage/PrivateRecordPublicNotes";
import {
  WorkspaceDropdownBlock,
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
  WorkspaceTextAreaBlock,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import { WorkspaceNoteType } from "../../../Types/Workspace/WorkspaceNoteReaction";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import PrivateRecordPublicNoteRule from "../Notes/PrivateRecordPublicNoteRule";
import CaptureSpan from "../Telemetry/CaptureSpan";
import WorkspaceActionAnswers, {
  WorkspaceAnswer,
  WorkspaceRecordName,
} from "./WorkspaceActionAnswers";
import WorkspaceMemberActions, {
  WorkspaceEventRecord,
  WorkspaceEventType,
} from "./WorkspaceMemberActions";

/*
 * THE ADD NOTE FORM OF AN INCIDENT'S OR AN EPISODE'S CHAT MESSAGE.
 *
 * "📄 Add Note" on a Slack or Microsoft Teams message opens a form for the
 * record's note: which kind - a public note, posted on the status page, or
 * a private one, for the team - and the note itself.
 *
 * A private incident or episode takes no public notes
 * (Types/StatusPage/PrivateRecordPublicNotes): it is on no status page and
 * told to no subscriber. So its form asks for no kind. It is titled "Add
 * Private Note" and says why in one line, and what it sends is a private
 * note. A form opened before the record was made private can still send
 * "public": that note is saved as a private note too, and the answer says
 * so (getSubmittedNoteType) - the person's words are kept, for the people
 * who can see the record, and nothing reaches anyone else.
 */

// The words of the form, shared by both chats.
export const WORKSPACE_NOTE_FORM_TEXT: {
  title: string;
  privateTitle: string;
  noteTypeLabel: string;
  noteTypePlaceholder: string;
  publicOption: string;
  privateOption: string;
  noteLabel: string;
  notePlaceholder: string;
  noteDescription: string;
  submit: string;
  cancel: string;
} = {
  title: "Add Note",
  privateTitle: "Add Private Note",
  noteTypeLabel: "Note Type",
  noteTypePlaceholder: "Select Note Type",
  publicOption: "Public Note (Will be posted on Status Page)",
  privateOption: "Private Note (Only visible to team members)",
  noteLabel: "Note",
  notePlaceholder: "Note",
  noteDescription: "Please type in plain text or markdown.",
  submit: "Submit",
  cancel: "Cancel",
};

// The form's Note Type values, as the forms send them.
export enum WorkspaceNoteFormType {
  Public = "public",
  Private = "private",
}

// What a submission writes, and whether that is what it asked for.
export interface WorkspaceSubmittedNote {
  noteType: WorkspaceNoteType;
  /*
   * A public note was asked for on a record that is private now: it is
   * written as a private note, and the answer says why.
   */
  isPublicAskedOnPrivateRecord: boolean;
}

// How the form's line and answers name each record.
const RECORD_NOUNS: Record<PrivateRecordKind, string> = {
  [PrivateRecordKind.Incident]: "incident",
  [PrivateRecordKind.IncidentEpisode]: "incident episode",
};

// The record, as a chat press names it.
const RECORD_EVENT_TYPES: Record<PrivateRecordKind, WorkspaceEventType> = {
  [PrivateRecordKind.Incident]: WorkspaceEventType.Incident,
  [PrivateRecordKind.IncidentEpisode]: WorkspaceEventType.IncidentEpisode,
};

export default class WorkspaceNoteForm {
  /*
   * Whether the record's form asks for no kind: it is private, so it takes
   * private notes only. Read as OneUptime when the form opens - the form
   * shows nothing of the record but that - and again when it is sent.
   */
  @CaptureSpan()
  public static async isPrivateRecord(data: {
    kind: PrivateRecordKind;
    recordId: ObjectID;
    projectId?: ObjectID | null | undefined;
  }): Promise<boolean> {
    return await PrivateRecordPublicNoteRule.isPrivate({
      kind: data.kind,
      recordId: data.recordId,
      projectId: data.projectId,
    });
  }

  /*
   * The one line of a private record's form, above the note: "🔒 This
   * incident is private, so this note is private too: only the people who
   * can see the incident can read it."
   */
  public static getPrivateRecordLine(kind: PrivateRecordKind): string {
    const noun: string = RECORD_NOUNS[kind];

    return `🔒 This ${noun} is private, so this note is private too: only the people who can see the ${noun} can read it.`;
  }

  /*
   * Why a note asked for as public was saved as a private note: "The
   * incident is private, so public notes cannot be added to it."
   */
  public static getSavedPrivatelyReason(kind: PrivateRecordKind): string {
    return `The ${RECORD_NOUNS[kind]} is private, so public notes cannot be added to it.`;
  }

  /*
   * The answer to a note asked for as public and added as a private one:
   * "📄 You added a private note to Incident INC-42. The incident is
   * private, so public notes cannot be added to it." The record is read as
   * the member, as the note was added: with nothing they can read, "the
   * incident".
   */
  @CaptureSpan()
  public static async getSavedPrivatelyAnswer(data: {
    kind: PrivateRecordKind;
    recordId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<WorkspaceAnswer> {
    const reason: string = WorkspaceNoteForm.getSavedPrivatelyReason(data.kind);

    let found: {
      record: DatabaseBaseModel;
      event: WorkspaceEventRecord;
    } | null = null;

    try {
      found = await WorkspaceMemberActions.findEventForMember({
        event: { type: RECORD_EVENT_TYPES[data.kind], id: data.recordId },
        props: data.props,
        select: {
          _id: true,
        },
      });
    } catch {
      found = null;
    }

    if (!found) {
      return {
        markdown:
          mdText`📄 You added a private note to the ${RECORD_NOUNS[data.kind]}. ${reason}`.toString(),
        text: `You added a private note to the ${RECORD_NOUNS[data.kind]}`,
      };
    }

    const record: WorkspaceRecordName =
      await WorkspaceActionAnswers.getRecordName(found.event);

    return {
      markdown:
        mdText`📄 You added a private note to ${WorkspaceActionAnswers.getRecordMarkdown(
          record,
        )}. ${reason}`.toString(),
      text: `You added a private note to ${record.label}`,
    };
  }

  /*
   * A Slack form's title, and its blocks: the Note Type and the note, or -
   * for a private record - its one line and the note.
   */
  public static getSlackForm(data: {
    kind: PrivateRecordKind;
    isPrivateRecord: boolean;
  }): { title: string; blocks: Array<WorkspaceMessageBlock> } {
    const noteTextArea: WorkspaceTextAreaBlock = {
      _type: "WorkspaceTextAreaBlock",
      label: WORKSPACE_NOTE_FORM_TEXT.noteLabel,
      blockId: "note",
      placeholder: WORKSPACE_NOTE_FORM_TEXT.notePlaceholder,
      description: WORKSPACE_NOTE_FORM_TEXT.noteDescription,
    };

    if (data.isPrivateRecord) {
      const line: WorkspacePayloadMarkdown = {
        _type: "WorkspacePayloadMarkdown",
        text: mdText`${WorkspaceNoteForm.getPrivateRecordLine(
          data.kind,
        )}`.toString(),
      };

      return {
        title: WORKSPACE_NOTE_FORM_TEXT.privateTitle,
        blocks: [line, noteTextArea],
      };
    }

    const notePickerDropdown: WorkspaceDropdownBlock = {
      _type: "WorkspaceDropdownBlock",
      label: WORKSPACE_NOTE_FORM_TEXT.noteTypeLabel,
      blockId: "noteType",
      placeholder: WORKSPACE_NOTE_FORM_TEXT.noteTypePlaceholder,
      options: [
        {
          label: WORKSPACE_NOTE_FORM_TEXT.publicOption,
          value: WorkspaceNoteFormType.Public,
        },
        {
          label: WORKSPACE_NOTE_FORM_TEXT.privateOption,
          value: WorkspaceNoteFormType.Private,
        },
      ],
    };

    return {
      title: WORKSPACE_NOTE_FORM_TEXT.title,
      blocks: [notePickerDropdown, noteTextArea],
    };
  }

  /*
   * The note a submission writes, from its Note Type - "public", "private",
   * or nothing at all from a private record's form, which asks for none: a
   * private note - and the record as it is now. A public note on a record
   * that is private now is written as a private note. Null for a Note Type
   * no form offers.
   */
  @CaptureSpan()
  public static async getSubmittedNote(data: {
    submittedNoteType: unknown;
    kind: PrivateRecordKind;
    recordId: ObjectID;
    projectId?: ObjectID | null | undefined;
  }): Promise<WorkspaceSubmittedNote | null> {
    const submitted: string =
      data.submittedNoteType === undefined || data.submittedNoteType === null
        ? WorkspaceNoteFormType.Private
        : String(data.submittedNoteType);

    if (submitted === WorkspaceNoteFormType.Private) {
      return {
        noteType: WorkspaceNoteType.Private,
        isPublicAskedOnPrivateRecord: false,
      };
    }

    if (submitted !== WorkspaceNoteFormType.Public) {
      return null;
    }

    if (
      await WorkspaceNoteForm.isPrivateRecord({
        kind: data.kind,
        recordId: data.recordId,
        projectId: data.projectId,
      })
    ) {
      return {
        noteType: WorkspaceNoteType.Private,
        isPublicAskedOnPrivateRecord: true,
      };
    }

    return {
      noteType: WorkspaceNoteType.Public,
      isPublicAskedOnPrivateRecord: false,
    };
  }
}
