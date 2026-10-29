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
 *
 * A record with no owners of its own is told to the project's owners
 * instead (ProjectService.getOwners) - the person who made the project, at
 * first, which is how a new project's first incident reaches anyone at all.
 * The entry says so ("isProjectOwners"): "Owners were notified" beside an
 * Owners field that reads "Add" left the reader guessing who was told.
 *
 *   The project's owners were notified that this incident was created, as
 *   it has no owners yet.
 */
export type OwnerNotificationRecordNoun =
  | "incident"
  | "alert"
  | "incident episode"
  | "alert episode"
  | "scheduled maintenance event";

/*
 * Who was told: the record's own owners, or the project's owners standing in
 * for a record that has none.
 */
export interface OwnerNotificationAudience {
  isProjectOwners?: boolean | undefined;
}

export default class OwnerNotificationFeedText {
  /*
   * "Owners were notified that this incident was created.", or, for a record
   * nobody owns, "The project's owners were notified that this incident was
   * created, as it has no owners yet."
   */
  public static created(
    recordNoun: OwnerNotificationRecordNoun,
    audience?: OwnerNotificationAudience,
  ): string {
    return OwnerNotificationFeedText.told({
      sentence: mdText`were notified that this ${recordNoun} was created`,
      audience: audience,
    });
  }

  // "Owners were notified that this incident is now **Identified**."
  public static stateChanged(
    data: {
      recordNoun: OwnerNotificationRecordNoun;
      stateName: string | undefined;
    } & OwnerNotificationAudience,
  ): string {
    const stateName: string = (data.stateName || "").trim();

    if (!stateName) {
      return OwnerNotificationFeedText.told({
        sentence: mdText`were notified that this ${data.recordNoun} changed state`,
        audience: data,
      });
    }

    return OwnerNotificationFeedText.told({
      sentence: mdText`were notified that this ${data.recordNoun} is now **${stateName}**`,
      audience: data,
    });
  }

  /*
   * "Owners were notified of the new private note." For a record nobody
   * owns, the record is named: "The project's owners were notified of the
   * new private note, as this incident has no owners yet."
   */
  public static notePosted(
    data: {
      isPrivateNote: boolean;
      recordNoun?: OwnerNotificationRecordNoun | undefined;
    } & OwnerNotificationAudience,
  ): string {
    return OwnerNotificationFeedText.told({
      sentence: mdText`were notified of the new ${data.isPrivateNote ? "private" : "public"} note`,
      audience: data,
      recordNoun: data.recordNoun,
    });
  }

  /*
   * One sentence of who was told, ending with why the project's owners were
   * when they stood in. `sentence` is everything after the subject, without
   * its full stop. A record noun names the record in the reason when the
   * sentence itself does not ("this" record of a note).
   */
  private static told(data: {
    sentence: MarkdownText;
    audience?: OwnerNotificationAudience | undefined;
    recordNoun?: OwnerNotificationRecordNoun | undefined;
  }): string {
    if (!data.audience?.isProjectOwners) {
      return mdText`Owners ${data.sentence}.`.toString();
    }

    const reason: MarkdownText = data.recordNoun
      ? mdText`, as this ${data.recordNoun} has no owners yet`
      : mdText`, as it has no owners yet`;

    return mdText`The project's owners ${data.sentence}${reason}.`.toString();
  }

  /*
   * "Owners were reminded that this incident is still **Investigating**,
   * open for **2 hours**."
   */
  public static reminder(
    data: {
      recordNoun: OwnerNotificationRecordNoun;
      stateName: string | undefined;
      openDuration: string | undefined;
    } & OwnerNotificationAudience,
  ): string {
    const stateName: string = (data.stateName || "").trim();
    const openDuration: string = (data.openDuration || "").trim();

    const state: MarkdownText = stateName
      ? mdText` still **${stateName}**`
      : mdText` still open`;
    const duration: MarkdownText = openDuration
      ? mdText`, open for **${openDuration}**`
      : FeedMarkdown.empty();

    return OwnerNotificationFeedText.told({
      sentence: mdText`were reminded that this ${data.recordNoun} is${state}${duration}`,
      audience: data,
    });
  }

  /*
   * "Owners were notified that 3 incidents were added to this episode."
   */
  public static membersAdded(
    data: {
      memberNoun: "incident" | "alert";
      count: number;
    } & OwnerNotificationAudience,
  ): string {
    const count: number = Math.max(0, Math.floor(data.count));
    const members: string =
      count === 1
        ? `1 ${data.memberNoun} was`
        : `${count} ${data.memberNoun}s were`;

    return OwnerNotificationFeedText.told({
      sentence: mdText`were notified that ${members} added to this episode`,
      audience: data,
    });
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
