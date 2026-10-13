import FeedMarkdown, {
  MarkdownText,
  MarkdownValue,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";

/*
 * THE FEED ENTRY THAT SAYS A RECORD'S OWNERS WERE TOLD SOMETHING.
 *
 * When an incident, alert, episode or scheduled maintenance event is
 * created, changes state, gets a note or stays open too long, its owners are
 * notified by email, SMS, call or push, and the record's feed says so. Those
 * entries used to read like a log - "🔔 Owners Notified because private note
 * is posted Owners have been notified about the new private note posted on
 * the [Incident INC-8](...)." - naming the record whose feed they were in and
 * listing "Notified: Name (email)" lines run together into one paragraph.
 *
 * Each is now one sentence about "this" record (the feed is the record's
 * own), and who was notified is a list behind the entry's details
 * ("Show who was notified" in the Dashboard):
 *
 *   Owners were notified of the new private note.
 *     - Nitin Kumar
 *     - Aidil Rahman
 *
 * These entries stay in the Dashboard feed: they are never posted to Slack
 * or Microsoft Teams (WorkspaceSideEffectsStayInFeed).
 */
export type OwnerNotificationRecordNoun =
  | "incident"
  | "alert"
  | "incident episode"
  | "alert episode"
  | "scheduled maintenance event";

export default class OwnerNotificationFeedText {
  // "Owners were notified that this incident was created."
  public static created(recordNoun: OwnerNotificationRecordNoun): string {
    return mdText`Owners were notified that this ${recordNoun} was created.`.toString();
  }

  // "Owners were notified that this incident is now **Identified**."
  public static stateChanged(data: {
    recordNoun: OwnerNotificationRecordNoun;
    stateName: string | undefined;
  }): string {
    const stateName: string = (data.stateName || "").trim();

    if (!stateName) {
      return mdText`Owners were notified that this ${data.recordNoun} changed state.`.toString();
    }

    return mdText`Owners were notified that this ${data.recordNoun} is now **${stateName}**.`.toString();
  }

  // "Owners were notified of the new private note."
  public static notePosted(data: { isPrivateNote: boolean }): string {
    return mdText`Owners were notified of the new ${data.isPrivateNote ? "private" : "public"} note.`.toString();
  }

  /*
   * "Owners were reminded that this incident is still **Investigating**,
   * open for **2 hours**."
   */
  public static reminder(data: {
    recordNoun: OwnerNotificationRecordNoun;
    stateName: string | undefined;
    openDuration: string | undefined;
  }): string {
    const stateName: string = (data.stateName || "").trim();
    const openDuration: string = (data.openDuration || "").trim();

    const state: MarkdownText = stateName
      ? mdText` still **${stateName}**`
      : mdText` still open`;
    const duration: MarkdownText = openDuration
      ? mdText`, open for **${openDuration}**`
      : FeedMarkdown.empty();

    return mdText`Owners were reminded that this ${data.recordNoun} is${state}${duration}.`.toString();
  }

  /*
   * "Owners were notified that 3 incidents were added to this episode."
   */
  public static membersAdded(data: {
    memberNoun: "incident" | "alert";
    count: number;
  }): string {
    const count: number = Math.max(0, Math.floor(data.count));
    const members: string =
      count === 1
        ? `1 ${data.memberNoun} was`
        : `${count} ${data.memberNoun}s were`;

    return mdText`Owners were notified that ${members} added to this episode.`.toString();
  }

  /*
   * One person notified, as a Markdown line of the entry's details: "- Nitin
   * Kumar (nitin@example.com)" - a list, where the old "Notified:" lines ran
   * together into one paragraph. Named for Markdown, as what it returns is
   * appended to the details as it is (FeedAndChatPlainTextEscapedGuard).
   */
  public static notifiedLineMarkdown(person: MarkdownValue): string {
    return mdText`- ${person}\n`.toString();
  }

  // A person as their name and address: "Nitin Kumar (nitin@example.com)".
  public static nameAndEmail(data: {
    name: string | undefined;
    email: string | undefined;
  }): MarkdownText {
    const name: string = (data.name || "").trim();
    const email: string = (data.email || "").trim();

    if (name && email) {
      return mdText`${name} (${email})`;
    }

    return mdText`${name || email || "Unknown user"}`;
  }
}
