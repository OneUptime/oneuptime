import crypto from "crypto";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import { PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH } from "../../../Types/StatusPage/PublicNoteApproval";
import {
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspaceModalBlock,
  WorkspacePayloadButtons,
  WorkspacePayloadMarkdown,
  WorkspaceTextAreaBlock,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import { getViewInProductTitle } from "../AutoRemediation/RemediationChatWords";
import { PublicNoteKind } from "../Notes/PublicNoteApprovalEngine";
import PublicNoteApprovalFeed, {
  PublicNoteApprovalWaitingFor,
} from "../Notes/PublicNoteApprovalFeed";
import TokenSigningKey from "../TokenSigningKey";
import type { WorkspaceSentDirectMessage } from "../../Services/WorkspaceUserNotificationService";
import SlackActionType from "./Slack/Actions/ActionTypes";
import type { WorkspaceAnswer } from "./WorkspaceActionAnswers";
import {
  WorkspaceConnectRequestAgainKind,
  WorkspacePendingActionKind,
  WorkspacePressDescription,
} from "./WorkspaceConnectRequest";
import { WorkspaceEventType } from "./WorkspaceMemberActions";

/*
 * APPROVING A WAITING PUBLIC NOTE FROM SLACK, MICROSOFT TEAMS OR MATTERMOST
 * (#6289): THE MESSAGE APPROVERS GET, AND WHAT ITS BUTTONS CARRY.
 *
 * While a project asks for its public notes to be approved, the people on
 * the step a note waits for are asked as their notification settings say
 * (PublicNoteApprovalNotifications.askApprovers): email and push by
 * default, and chat for those who turned it on in User Settings >
 * Notification Settings. Their chat accounts get this message, in their
 * direct messages with OneUptime's app: the note on its record, who sent
 * it, who it waits for, what approving it does, and Approve (Approve and
 * publish on the last step), Reject and a link to the note in OneUptime -
 * the Dashboard's own words (its approval panel and its approve dialog),
 * and the feed's for who it waits for (PublicNoteApprovalFeed.waitingFor).
 *
 * What the buttons carry is signed (encodeValue, readValue) under a key
 * derived for this purpose alone: the note and its record, the round of
 * approval the message asked about, the step it waited for, whether
 * approving that step published the note, whether it was an edit of a
 * published note, and a digest of the text the message showed. None of it says who may decide, or decides anything: a
 * press is decided by PublicNoteApprovalEngine.decide, as the member the
 * chat account that pressed is connected to, with the Dashboard's rules,
 * and only while the note is still the one the message showed
 * (WorkspacePublicNoteApprovalActions). A value this installation did not
 * sign is refused before anything is read.
 *
 * Reject opens a form that asks why - the Dashboard's question, required,
 * at most PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH characters (getRejectForm):
 * a Slack modal, a Microsoft Teams card, a Mattermost dialog.
 *
 * The words are in English, as every other chat answer is
 * (WorkspaceActionAnswers, WorkspaceNoteForm, RemediationChatWords). Names
 * and titles are text (mdText); the note is the Markdown its author wrote,
 * with any image a data: URL carries as its alt text (asChatMarkdown).
 */

// The field a reason is typed in, in each chat's form.
export const PUBLIC_NOTE_REJECT_REASON_FIELD: string = "reason";

// A value's first part: what it is, and the version of its fields.
const VALUE_PREFIX: string = "pna1";

const SIGNING_KEY_LABEL: string = "workspace-public-note-approval-button";

// No value this writes is near as long: anything longer is not one.
const MAX_VALUE_LENGTH: number = 1024;

// The longest id of a step a value carries.
const MAX_STEP_ID_LENGTH: number = 100;

// The longest moment a value carries: an ISO date is 24 characters.
const MAX_SUBMITTED_AT_LENGTH: number = 64;

// A digest of the text, as a value carries it: 132 bits of SHA-256.
const TEXT_DIGEST_LENGTH: number = 22;

export const PUBLIC_NOTE_APPROVAL_CHAT_WORDS: {
  approve: string;
  approveAndPublish: string;
  reject: string;
  cancel: string;
  rejectTitle: string;
  rejectDescription: string;
  rejectReasonLabel: string;
  // Mattermost's labels are at most 24 characters: the question is its help.
  rejectReasonShortLabel: string;
  rejectReasonHelp: string;
  rejectReasonPlaceholder: string;
  reasonTooLong: string;
} = {
  approve: "Approve",
  approveAndPublish: "Approve and publish",
  reject: "Reject",
  cancel: "Cancel",
  rejectTitle: "Reject this public note?",
  rejectDescription:
    "It will not be published. Its author sees your reason and can change the note and send it again.",
  rejectReasonLabel: "Why are you rejecting it?",
  rejectReasonShortLabel: "Reason",
  rejectReasonHelp: "The author sees this.",
  rejectReasonPlaceholder:
    "e.g. Please do not name the vendor until legal has reviewed the wording.",
  reasonTooLong: `A reason may have at most ${PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH} characters.`,
};

/*
 * What an approval message's buttons carry, signed: the note, and what the
 * message asked about it.
 */
export interface PublicNoteApprovalButtonValue {
  kind: PublicNoteKind;
  projectId: ObjectID;
  // The incident, episode or scheduled maintenance event the note is on.
  recordId: ObjectID;
  noteId: ObjectID;
  // The round of approval the message asked about: when it was sent.
  submittedAt: string;
  // The step it waited for, and whether approving that step published it.
  stepId: string;
  isFinal: boolean;
  // It asked about an edit of a published note, not a new note.
  isEdit: boolean;
  // The text the message showed (getTextDigest).
  textDigest: string;
}

// What a note waiting for a step is, as its approval message tells it.
export interface PublicNoteApprovalAsk {
  // "Incident INC-42", its title, and its public notes in the Dashboard.
  recordLabel: string;
  recordTitle: string;
  notesUrl: string;
  // The text to approve: the note, or the edit that waits.
  note: string;
  isEdit: boolean;
  // Who sent it for approval; null when OneUptime did, or an API key.
  sentBy: string | null;
  // The step it waits for, and who that step names (the feed's words).
  waitingFor: PublicNoteApprovalWaitingFor;
  value: PublicNoteApprovalButtonValue;
}

// A direct message: its blocks, and the line its notification shows.
export interface WorkspaceDirectMessage {
  messageBlocks: Array<WorkspaceMessageBlock>;
  notificationText: string;
  /*
   * Told where each copy landed, to keep it until the note is decided
   * (WorkspacePublicNoteApprovalMessages): one approver's own.
   */
  onSent?: ((sent: WorkspaceSentDirectMessage) => Promise<void>) | undefined;
}

/*
 * What an approval message says in its place once the note is no longer
 * what it asked about (WorkspacePublicNoteApprovalActions.getReplacement):
 * what happened, and the note's record in OneUptime when it can be named.
 */
export interface PublicNoteApprovalReplacement {
  answer: WorkspaceAnswer;
  notesUrl?: string | undefined;
}

export default class WorkspacePublicNoteApproval {
  // The buttons an approval message carries, and the form Reject opens.
  public static readonly ACTION_TYPES: ReadonlyArray<string> = [
    SlackActionType.ApprovePublicNote,
    SlackActionType.ViewRejectPublicNote,
    SlackActionType.SubmitRejectPublicNote,
  ];

  public static isApprovalAction(actionType: string | undefined): boolean {
    return (
      Boolean(actionType) &&
      WorkspacePublicNoteApproval.ACTION_TYPES.includes(actionType!)
    );
  }

  // The record a note of this kind is on, as the chats' presses name it.
  public static getEventType(kind: PublicNoteKind): WorkspaceEventType {
    switch (kind) {
      case PublicNoteKind.Incident:
        return WorkspaceEventType.Incident;
      case PublicNoteKind.IncidentEpisode:
        return WorkspaceEventType.IncidentEpisode;
      case PublicNoteKind.ScheduledMaintenance:
        return WorkspaceEventType.ScheduledMaintenance;
    }
  }

  /*
   * The project the first of these presses' approval values was signed
   * for: what tells a press's project apart in a workspace connected to
   * more than one (WorkspaceProjectResolution's drawnForProjectId), as the
   * project a form was drawn for does. It decides only where the press is
   * read; what it may do there is read as the member who pressed. Only a
   * value this installation signed counts.
   */
  public static getSignedProjectId(
    presses: ReadonlyArray<{
      actionType?: string | undefined;
      actionValue?: string | undefined;
    }>,
  ): string | undefined {
    for (const press of presses) {
      if (!WorkspacePublicNoteApproval.isApprovalAction(press.actionType)) {
        continue;
      }

      const value: PublicNoteApprovalButtonValue | null =
        WorkspacePublicNoteApproval.readValue(press.actionValue);

      if (value) {
        return value.projectId.toString();
      }
    }

    return undefined;
  }

  /*
   * What a press from a chat account that is not connected yet asks to be
   * connected for (SlackConnectPrompt, MicrosoftTeamsConnectPrompt), or
   * null for another press: Approve is decided for them once they are
   * connected - while the note is still what the message showed - and
   * Reject, which asks why in a form, is pressed again.
   */
  public static describePress(data: {
    actionType: string | undefined;
    actionValue?: string | undefined;
  }): WorkspacePressDescription | null {
    if (data.actionType === SlackActionType.ApprovePublicNote) {
      const purpose: string = "approve this public note";
      const value: PublicNoteApprovalButtonValue | null =
        WorkspacePublicNoteApproval.readValue(data.actionValue);

      if (!value) {
        return { purpose: purpose };
      }

      return {
        purpose: purpose,
        pendingAction: {
          kind: WorkspacePendingActionKind.ApprovePublicNote,
          eventType: WorkspacePublicNoteApproval.getEventType(value.kind),
          eventId: value.recordId,
          publicNoteApproval: data.actionValue,
        },
      };
    }

    if (
      data.actionType === SlackActionType.ViewRejectPublicNote ||
      data.actionType === SlackActionType.SubmitRejectPublicNote
    ) {
      return {
        purpose: "reject this public note",
        again: {
          kind: WorkspaceConnectRequestAgainKind.Button,
          label: PUBLIC_NOTE_APPROVAL_CHAT_WORDS.reject,
        },
      };
    }

    return null;
  }

  // The value an approval message's buttons carry, signed.
  public static encodeValue(value: PublicNoteApprovalButtonValue): string {
    const payload: string = Buffer.from(
      JSON.stringify([
        value.kind,
        value.projectId.toString(),
        value.recordId.toString(),
        value.noteId.toString(),
        value.submittedAt,
        value.stepId,
        value.isFinal ? 1 : 0,
        value.isEdit ? 1 : 0,
        value.textDigest,
      ]),
      "utf8",
    ).toString("base64url");

    return `${VALUE_PREFIX}.${payload}.${WorkspacePublicNoteApproval.sign(payload)}`;
  }

  /*
   * A button's value, read: null for anything this installation did not
   * sign as it is - another button's value, one changed by a character, one
   * signed with another key, one that is not text at all.
   */
  public static readValue(
    value: unknown,
  ): PublicNoteApprovalButtonValue | null {
    if (
      typeof value !== "string" ||
      !value ||
      value.length > MAX_VALUE_LENGTH
    ) {
      return null;
    }

    const parts: Array<string> = value.split(".");

    if (parts.length !== 3 || parts[0] !== VALUE_PREFIX) {
      return null;
    }

    const payload: string = parts[1] || "";
    const signature: string = parts[2] || "";

    if (
      !payload ||
      !signature ||
      !WorkspacePublicNoteApproval.signaturesMatch(
        WorkspacePublicNoteApproval.sign(payload),
        signature,
      )
    ) {
      return null;
    }

    let fields: unknown;

    try {
      fields = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch {
      return null;
    }

    if (!Array.isArray(fields) || fields.length !== 9) {
      return null;
    }

    const kind: unknown = fields[0];
    const projectId: unknown = fields[1];
    const recordId: unknown = fields[2];
    const noteId: unknown = fields[3];
    const submittedAt: unknown = fields[4];
    const stepId: unknown = fields[5];
    const isFinal: unknown = fields[6];
    const isEdit: unknown = fields[7];
    const textDigest: unknown = fields[8];

    if (
      !WorkspacePublicNoteApproval.isKind(kind) ||
      !WorkspacePublicNoteApproval.isId(projectId) ||
      !WorkspacePublicNoteApproval.isId(recordId) ||
      !WorkspacePublicNoteApproval.isId(noteId) ||
      typeof submittedAt !== "string" ||
      !submittedAt ||
      submittedAt.length > MAX_SUBMITTED_AT_LENGTH ||
      typeof stepId !== "string" ||
      !stepId ||
      stepId.length > MAX_STEP_ID_LENGTH ||
      (isFinal !== 0 && isFinal !== 1) ||
      (isEdit !== 0 && isEdit !== 1) ||
      typeof textDigest !== "string" ||
      textDigest.length !== TEXT_DIGEST_LENGTH
    ) {
      return null;
    }

    return {
      kind: kind,
      projectId: new ObjectID(projectId),
      recordId: new ObjectID(recordId),
      noteId: new ObjectID(noteId),
      submittedAt: submittedAt,
      stepId: stepId,
      isFinal: isFinal === 1,
      isEdit: isEdit === 1,
      textDigest: textDigest,
    };
  }

  /*
   * A digest of a note's text, as a value carries it: a press is decided
   * only while the note still says what its message showed.
   */
  public static getTextDigest(text: string | null | undefined): string {
    return crypto
      .createHash("sha256")
      .update(text || "", "utf8")
      .digest("base64url")
      .slice(0, TEXT_DIGEST_LENGTH);
  }

  /*
   * The message an approver gets:
   *
   *   📝 **Approval needed: public note on [Incident INC-42](...) - Checkout is down**
   *
   *   **Alice** sent it for approval. It waits for step 1 of 2 (Support): Bob, Platform.
   *   It is not on status pages and no subscriber is told about it until it is approved.
   *
   *   <the note>
   *
   *   Once you approve it, it waits for the next approval step before it is published.
   *
   *   [Approve] [Reject] [View in OneUptime]
   *
   * The note is a block of its own, so a note longer than a chat takes is
   * cut by that chat, ending with a note that it was - Slack at
   * SlackUtil.MARKDOWN_MAX_LENGTH, a Teams card by its budget
   * (MicrosoftTeamsMessageSize), a Mattermost post at its longest
   * (MattermostUtil.getMessageText) - while the lines around it and the
   * buttons stay whole.
   */
  public static getAskMessage(
    ask: PublicNoteApprovalAsk,
  ): WorkspaceDirectMessage {
    const value: string = WorkspacePublicNoteApproval.encodeValue(ask.value);
    const subject: string = WorkspacePublicNoteApproval.getSubject(ask);

    const what: string = ask.isEdit ? "edit of a public note" : "public note";
    const record: MarkdownText = FeedMarkdown.link(
      ask.recordLabel,
      ask.notesUrl,
    );
    const headline: MarkdownText = ask.recordTitle
      ? mdText`📝 **Approval needed: ${what} on ${record} - ${ask.recordTitle}**`
      : mdText`📝 **Approval needed: ${what} on ${record}**`;

    const waitingFor: MarkdownText = PublicNoteApprovalFeed.waitingFor(
      ask.waitingFor,
    );
    const sentAndWaiting: MarkdownText = ask.sentBy
      ? mdText`**${ask.sentBy}** sent it for approval. ${waitingFor}`
      : waitingFor;
    const notOnStatusPages: MarkdownText = ask.isEdit
      ? mdText`Status pages keep showing the note as it was approved until the edit is approved.`
      : mdText`It is not on status pages and no subscriber is told about it until it is approved.`;

    const intro: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: FeedMarkdown.join(
        [headline, sentAndWaiting, notOnStatusPages],
        "\n\n",
      ).toString(),
    };

    const note: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: FeedMarkdown.asChatMarkdown(ask.note).toString(),
    };

    const onApprove: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: WorkspacePublicNoteApproval.getOnApproveLine({
        isFinal: ask.value.isFinal,
        isEdit: ask.isEdit,
      }).toString(),
    };

    const buttons: Array<WorkspaceMessagePayloadButton> = [
      {
        _type: "WorkspaceMessagePayloadButton",
        title: ask.value.isFinal
          ? PUBLIC_NOTE_APPROVAL_CHAT_WORDS.approveAndPublish
          : PUBLIC_NOTE_APPROVAL_CHAT_WORDS.approve,
        value: value,
        actionId: SlackActionType.ApprovePublicNote,
        isPrimary: true,
      },
      {
        _type: "WorkspaceMessagePayloadButton",
        title: PUBLIC_NOTE_APPROVAL_CHAT_WORDS.reject,
        value: value,
        actionId: SlackActionType.ViewRejectPublicNote,
      },
    ];

    const notesUrl: URL | null = WorkspacePublicNoteApproval.toUrl(
      ask.notesUrl,
    );

    if (notesUrl) {
      buttons.push({
        _type: "WorkspaceMessagePayloadButton",
        title: getViewInProductTitle(),
        value: "",
        actionId: SlackActionType.OpenInOneUptime,
        url: notesUrl,
      });
    }

    const buttonsBlock: WorkspacePayloadButtons = {
      _type: "WorkspacePayloadButtons",
      buttons: buttons,
    };

    const messageBlocks: Array<WorkspaceMessageBlock> = [intro];

    // A note with no text has no block of its own.
    if (note.text.trim()) {
      messageBlocks.push(note);
    }

    messageBlocks.push(onApprove, buttonsBlock);

    return { messageBlocks: messageBlocks, notificationText: subject };
  }

  /*
   * An approval message, replaced once its note is no longer what it asked
   * about (WorkspacePublicNoteApprovalMessages): what happened, in the words
   * a late press gets, and View in OneUptime - no Approve, no Reject:
   *
   *   ✅ This public note on [Incident INC-42](...) was approved by **Bob**
   *   at 10:42. It is published on status pages.
   *
   *   [View in OneUptime]
   *
   * Each chat holds it to what it takes as it does every message: Slack at
   * SlackUtil.MARKDOWN_MAX_LENGTH, a Teams card by its budget
   * (MicrosoftTeamsMessageSize), a Mattermost post at its longest.
   */
  public static getReplacementMessage(
    replacement: PublicNoteApprovalReplacement,
  ): WorkspaceDirectMessage {
    const said: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: replacement.answer.markdown,
    };

    const messageBlocks: Array<WorkspaceMessageBlock> = [said];

    const notesUrl: URL | null = WorkspacePublicNoteApproval.toUrl(
      replacement.notesUrl || "",
    );

    if (notesUrl) {
      const buttons: WorkspacePayloadButtons = {
        _type: "WorkspacePayloadButtons",
        buttons: [
          {
            _type: "WorkspaceMessagePayloadButton",
            title: getViewInProductTitle(),
            value: "",
            actionId: SlackActionType.OpenInOneUptime,
            url: notesUrl,
          },
        ],
      };

      messageBlocks.push(buttons);
    }

    return {
      messageBlocks: messageBlocks,
      notificationText: replacement.answer.text,
    };
  }

  // "Approval needed: public note on Incident INC-42 - Checkout is down".
  public static getSubject(ask: {
    recordLabel: string;
    recordTitle: string;
    isEdit: boolean;
  }): string {
    const what: string = ask.isEdit ? "edit of a public note" : "public note";

    return ask.recordTitle
      ? `Approval needed: ${what} on ${ask.recordLabel} - ${ask.recordTitle}`
      : `Approval needed: ${what} on ${ask.recordLabel}`;
  }

  /*
   * What approving does, in the words of the Dashboard's approve dialog: the
   * note is published right away on the last step, and waits for the next
   * step on any other.
   */
  public static getOnApproveLine(data: {
    isFinal: boolean;
    isEdit: boolean;
  }): MarkdownText {
    if (!data.isFinal) {
      return mdText`Once you approve it, it waits for the next approval step before it is published.`;
    }

    return data.isEdit
      ? mdText`Once you approve it, status pages will show the edited note right away.`
      : mdText`Once you approve it, it will be published on status pages right away, and subscribers will be told about it if the note says to notify them.`;
  }

  /*
   * The form Reject opens: the Dashboard's question, required, at most
   * PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH characters - each chat counts them
   * as they are typed, and the submission is checked again
   * (WorkspacePublicNoteApprovalActions.getReasonError). `value` is the
   * button's, carried by the form to its submission. A Mattermost label is
   * at most 24 characters, so there the question is the field's help.
   */
  public static getRejectForm(data: {
    value: string;
    workspaceType: WorkspaceType;
    // The record, when it can be named: "Incident INC-42", its title.
    recordLabel?: string | undefined;
    recordTitle?: string | undefined;
  }): WorkspaceModalBlock {
    const words: typeof PUBLIC_NOTE_APPROVAL_CHAT_WORDS =
      PUBLIC_NOTE_APPROVAL_CHAT_WORDS;
    const isMattermost: boolean =
      data.workspaceType === WorkspaceType.Mattermost;

    const lines: Array<MarkdownText> = [];

    if (data.recordLabel) {
      lines.push(
        data.recordTitle
          ? mdText`Public note on **${data.recordLabel}** - ${data.recordTitle}`
          : mdText`Public note on **${data.recordLabel}**`,
      );
    }

    lines.push(mdText`${words.rejectDescription}`);

    const description: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: FeedMarkdown.join(lines, "\n\n").toString(),
    };

    const reason: WorkspaceTextAreaBlock = {
      _type: "WorkspaceTextAreaBlock",
      label: isMattermost
        ? words.rejectReasonShortLabel
        : words.rejectReasonLabel,
      blockId: PUBLIC_NOTE_REJECT_REASON_FIELD,
      placeholder: words.rejectReasonPlaceholder,
      description: isMattermost
        ? `${words.rejectReasonLabel} ${words.rejectReasonHelp}`
        : words.rejectReasonHelp,
      optional: false,
      maxLength: PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH,
    };

    return {
      _type: "WorkspaceModalBlock",
      title: words.rejectTitle,
      submitButtonTitle: words.reject,
      cancelButtonTitle: words.cancel,
      actionId: SlackActionType.SubmitRejectPublicNote,
      actionValue: data.value,
      blocks: [description, reason],
    };
  }

  private static isKind(value: unknown): value is PublicNoteKind {
    return (
      value === PublicNoteKind.Incident ||
      value === PublicNoteKind.IncidentEpisode ||
      value === PublicNoteKind.ScheduledMaintenance
    );
  }

  private static isId(value: unknown): value is string {
    return typeof value === "string" && ObjectID.isValidUUID(value);
  }

  private static toUrl(value: string): URL | null {
    try {
      return value ? URL.fromString(value) : null;
    } catch {
      return null;
    }
  }

  private static sign(payload: string): string {
    return crypto
      .createHmac("sha256", TokenSigningKey.deriveKey(SIGNING_KEY_LABEL))
      .update(payload, "utf8")
      .digest("base64url");
  }

  private static signaturesMatch(expected: string, given: string): boolean {
    const expectedBuffer: Buffer = Buffer.from(expected, "utf8");
    const givenBuffer: Buffer = Buffer.from(given, "utf8");

    return (
      expectedBuffer.length === givenBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, givenBuffer)
    );
  }
}
