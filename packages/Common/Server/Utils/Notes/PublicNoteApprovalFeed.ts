import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import { PublicNoteApprovalPosition } from "../../../Types/StatusPage/PublicNoteApproval";

/*
 * What a record's feed says about each step of a public note's approval
 * (Types/StatusPage/PublicNoteApproval). Every entry is the record's own,
 * on its timeline in the Dashboard, and never posted to a chat channel: a
 * note that is not published goes nowhere outside the team's view of the
 * record. Only the entry a published note always had - "posted public note
 * ... on status page" - reaches Slack and Microsoft Teams, at the moment the
 * note is published.
 *
 * Each entry opens with what the person did: the feed names them before it
 * (the entry's user), as every note entry does. The record is a link; names
 * and step names are text, and the note is the Markdown its author wrote
 * (FeedMarkdown.asMarkdown); a reason is plain text (multilineText).
 */

// [Incident INC-42](https://...): the record, as every note entry links it.
export interface PublicNoteApprovalFeedRecord {
  label: string;
  url: string;
}

export interface PublicNoteApprovalWaitingFor {
  position: PublicNoteApprovalPosition;
  // Who the step names, as the feed shows them: people, then teams.
  approverNames: Array<string>;
}

export default class PublicNoteApprovalFeed {
  // [Incident INC-42](url)
  public static recordLink(record: PublicNoteApprovalFeedRecord): MarkdownText {
    return FeedMarkdown.link(record.label, record.url);
  }

  /*
   * "Step 2 of 3 (Legal): Alice, Platform team." - who the note waits for
   * now. "Nobody is set up to approve it yet." when no step names anyone.
   */
  public static waitingFor(data: PublicNoteApprovalWaitingFor): MarkdownText {
    const step: MarkdownText =
      data.position.count > 1
        ? data.position.step?.name
          ? mdText`step ${String(data.position.number)} of ${String(data.position.count)} (${data.position.step.name})`
          : mdText`step ${String(data.position.number)} of ${String(data.position.count)}`
        : data.position.step?.name
          ? mdText`${data.position.step.name}`
          : mdText`the approvers`;

    if (data.approverNames.length === 0) {
      return mdText`It waits for ${step}, which names nobody who can approve it yet.`;
    }

    return mdText`It waits for ${step}: ${FeedMarkdown.join(data.approverNames)}.`;
  }

  // A new note, or an edit of one, sent for approval.
  public static submitted(data: {
    record: PublicNoteApprovalFeedRecord;
    note: string | null | undefined;
    isEdit: boolean;
    isAgain: boolean;
    waitingFor: PublicNoteApprovalWaitingFor;
  }): MarkdownText {
    const link: MarkdownText = this.recordLink(data.record);

    const headline: MarkdownText = data.isEdit
      ? data.isAgain
        ? mdText`📝 sent an edit of a **public note** on ${link} for approval again. Status pages keep showing the note as it was approved until the edit is approved.`
        : mdText`📝 sent an edit of a **public note** on ${link} for approval. Status pages keep showing the note as it was approved until the edit is approved.`
      : data.isAgain
        ? mdText`📝 sent a **public note** on ${link} for approval again. It is published once it is approved.`
        : mdText`📝 sent a **public note** on ${link} for approval. It is published once it is approved.`;

    return mdText`${headline} ${this.waitingFor(data.waitingFor)}

${FeedMarkdown.asMarkdown(data.note)}`;
  }

  // One step approved; another one is next.
  public static approvedStep(data: {
    record: PublicNoteApprovalFeedRecord;
    isEdit: boolean;
    approvedPosition: PublicNoteApprovalPosition;
    waitingFor: PublicNoteApprovalWaitingFor;
  }): MarkdownText {
    const link: MarkdownText = this.recordLink(data.record);
    const what: MarkdownText = data.isEdit
      ? mdText`the edit of a **public note**`
      : mdText`a **public note**`;

    return mdText`✅ approved ${what} on ${link} for ${this.approvedStepName(data.approvedPosition)}. ${this.waitingFor(data.waitingFor)}`;
  }

  /*
   * "step 1 of 2 (Support)": the step an approval was given for, as the
   * feed's entry names it - and the answer to the approver who gave it
   * from chat (WorkspacePublicNoteApprovalActions).
   */
  public static approvedStepName(
    position: PublicNoteApprovalPosition,
  ): MarkdownText {
    return position.step?.name
      ? mdText`step ${String(position.number)} of ${String(position.count)} (${position.step.name})`
      : mdText`step ${String(position.number)} of ${String(position.count)}`;
  }

  /*
   * The last step approved: the note, or its edit, is published. The note
   * itself follows in the entry a published note always gets.
   */
  public static approvedAndPublished(data: {
    record: PublicNoteApprovalFeedRecord;
    isEdit: boolean;
  }): MarkdownText {
    const link: MarkdownText = this.recordLink(data.record);

    return data.isEdit
      ? mdText`✅ approved the edit of a **public note** on ${link}. Status pages now show the edited note.`
      : mdText`✅ approved a **public note** on ${link}. It is now published on status pages.`;
  }

  // Rejected, with the reason the author is shown.
  public static rejected(data: {
    record: PublicNoteApprovalFeedRecord;
    isEdit: boolean;
    reason: string;
  }): MarkdownText {
    const link: MarkdownText = this.recordLink(data.record);

    const headline: MarkdownText = data.isEdit
      ? mdText`↩️ rejected the edit of a **public note** on ${link}. Status pages keep showing the note as it was approved.`
      : mdText`↩️ rejected a **public note** on ${link}. It is not published.`;

    return mdText`${headline}

${FeedMarkdown.multilineText(data.reason)}`;
  }

  // A waiting edit taken back: the published note stays as it was.
  public static editWithdrawn(data: {
    record: PublicNoteApprovalFeedRecord;
  }): MarkdownText {
    return mdText`↩️ withdrew the waiting edit of a **public note** on ${this.recordLink(data.record)}. Status pages keep showing the note as it was approved.`;
  }

  /*
   * A note that waited, published by a person once approval was turned off:
   * nobody had approved it, and the entry says so.
   */
  public static publishedWithoutApproval(data: {
    record: PublicNoteApprovalFeedRecord;
    isEdit: boolean;
  }): MarkdownText {
    const link: MarkdownText = this.recordLink(data.record);

    return data.isEdit
      ? mdText`📄 published the waiting edit of a **public note** on ${link}. Public notes no longer need approval, so it was not approved.`
      : mdText`📄 published a waiting **public note** on ${link}. Public notes no longer need approval, so it was not approved.`;
  }

  /*
   * The line the published note's own entry ends with: who approved it, so
   * the chat channels it is posted to know it was approved. Nothing when
   * nobody did.
   */
  public static approvedByLine(names: ReadonlyArray<string>): MarkdownText {
    if (names.length === 0) {
      return FeedMarkdown.empty();
    }

    return mdText`

Approved by ${FeedMarkdown.join(names)}.`;
  }
}
