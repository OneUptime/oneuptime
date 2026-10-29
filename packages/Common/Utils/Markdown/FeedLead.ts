/*
 * HOW A FEED ENTRY'S SENTENCE READS AFTER THE NAME OF WHOEVER DID IT.
 *
 * An entry written for somebody's action is a sentence written to follow
 * their name: "👤 Added **Deane Looi** as **Responder** to Incident INC-18",
 * "📄 posted **private note** ...". Both places that show it put the name in
 * front, by these same rules, so they can never read differently:
 *
 *   - the Dashboard's feed (UI/Components/Feed/FeedEntryText), which draws
 *     the name with its avatar and drops the emoji: "Valeria Mustafaeva
 *     added Deane Looi as Responder to Incident INC-18";
 *   - Slack and Microsoft Teams (leadWithAuthor below, through
 *     WorkspaceUtil.getMessageBlocksByMarkdown), which keep the emoji first,
 *     as every line in the channel starts: "👤 Valeria Mustafaeva added
 *     Deane Looi as Responder to Incident INC-18". Messages used to put the
 *     name before the emoji and keep the verb's capital - "Valeria
 *     Mustafaeva 👤 Added Deane Looi ..." - two fragments instead of one
 *     sentence.
 *
 * Only the start of the Markdown is ever looked at - never a whole entry,
 * which can be megabytes long (a log pasted into a note) - and every
 * pattern is anchored at the start, so the work does not grow with it.
 *
 * React-free and database-free, so the rules can be tested on their own.
 */

/*
 * How much of the start of an entry the rules read. Generous for a first
 * sentence, and small enough that no regular expression ever runs over a
 * long value.
 */
export const FEED_LEAD_SCAN_LENGTH: number = 600;

/*
 * A leading emoji, with its modifiers, joiners and variation selectors -
 * "👨🏻‍💻 ", "🏷️ ", "⚠️ " - and the space after it.
 */
export const FEED_LEADING_EMOJI: RegExp =
  /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|‍|️)+[ \t]*/u;

// The first word of a sentence: letters only.
const FIRST_WORD: RegExp = /^[A-Za-z]+/;

/*
 * Past-tense verbs an entry written for someone's action opens with, as
 * the server writes them ("Added", "Changed", "posted"). After the name
 * they read in lower case: "Nitin changed the state".
 */
export const FEED_LEAD_VERBS: ReadonlySet<string> = new Set<string>([
  "acknowledged",
  "added",
  "applied",
  "approved",
  "archived",
  "assigned",
  "attached",
  "cancelled",
  "changed",
  "closed",
  "completed",
  "connected",
  "created",
  "declared",
  "deleted",
  "disabled",
  "disconnected",
  "dismissed",
  "enabled",
  "ended",
  "escalated",
  "executed",
  "invited",
  "joined",
  // "Valeria left the Responder role on Incident INC-18" (IncidentRoleFeedText).
  "left",
  "linked",
  "marked",
  "merged",
  "moved",
  "muted",
  "notified",
  "paged",
  "posted",
  "ran",
  "reassigned",
  "rejected",
  "removed",
  "renamed",
  "reopened",
  "requested",
  "reset",
  "resolved",
  "restored",
  "resumed",
  "scheduled",
  "sent",
  "set",
  "shared",
  "skipped",
  "snoozed",
  "started",
  "stopped",
  // "Valeria took the Incident Commander role on Incident INC-18".
  "took",
  "triggered",
  "unassigned",
  "unlinked",
  "unmuted",
  "updated",
  "uploaded",
]);

/*
 * The emoji an entry opens with, with the space after it ("👤 "), or "" when
 * it opens with none.
 */
export const readFeedLeadingEmoji: (text: string) => string = (
  text: string,
): string => {
  const emoji: RegExpMatchArray | null = text
    .slice(0, FEED_LEAD_SCAN_LENGTH)
    .match(FEED_LEADING_EMOJI);

  return emoji ? emoji[0] : "";
};

/*
 * A sentence as it reads after somebody's name, or null when it is not one
 * written to follow a name. One that opens in lower case already is
 * ("posted **private note** ..."); one that opens with an action's verb
 * reads with the verb in lower case ("Added" - "added"). Anything else - a
 * heading, a noun phrase ("**Incident INC-18 was updated.**"), a word that
 * only looks like a verb ("Setup ...") - is not.
 */
export const getSentenceAfterName: (sentence: string) => string | null = (
  sentence: string,
): string | null => {
  if (!sentence) {
    return null;
  }

  const firstCharacter: string = sentence.charAt(0);

  if (firstCharacter !== firstCharacter.toUpperCase()) {
    return sentence;
  }

  const word: RegExpMatchArray | null = sentence
    .slice(0, FEED_LEAD_SCAN_LENGTH)
    .match(FIRST_WORD);

  if (!word) {
    return null;
  }

  const lowerCaseWord: string = word[0].toLowerCase();

  if (!FEED_LEAD_VERBS.has(lowerCaseWord)) {
    return null;
  }

  // The word must end there: "Setup ..." is not "Set".
  const after: string = sentence.charAt(word[0].length);

  if (after !== "" && after !== " " && after !== "\t") {
    return null;
  }

  return lowerCaseWord + sentence.slice(word[0].length);
};

/*
 * Whether a sentence opens with one of the verbs an action is written with,
 * capitalized or not, as a word of its own: "Added ...", "posted ...".
 */
export const opensWithFeedLeadVerb: (sentence: string) => boolean = (
  sentence: string,
): boolean => {
  const word: RegExpMatchArray | null = sentence
    .slice(0, FEED_LEAD_SCAN_LENGTH)
    .match(FIRST_WORD);

  if (!word || !FEED_LEAD_VERBS.has(word[0].toLowerCase())) {
    return false;
  }

  // The verb must be a word of its own: "created-item" is not "created".
  const after: string = sentence.charAt(word[0].length);

  return after === "" || after === " " || after === "\t";
};

/*
 * A Slack or Microsoft Teams message, opened by whoever did what it says:
 * the emoji the entry starts with, then their name, then the sentence with
 * its verb in lower case - "👤 Valeria Mustafaeva added Deane Looi as
 * Responder to Incident INC-18". `authorMarkdown` is the name as the
 * workspace shows it, ending in a space ("@valeria ", "[Valeria
 * Mustafaeva](...) ", "Jira Automation (API key) "). An entry that is not a
 * sentence written to follow a name keeps the name in front of it, as it
 * is written.
 */
export const leadWithAuthorMarkdown: (data: {
  authorMarkdown: string;
  markdown: string;
}) => string = (data: { authorMarkdown: string; markdown: string }): string => {
  const markdown: string = data.markdown || "";

  if (!data.authorMarkdown.trim()) {
    return markdown;
  }

  const author: string = data.authorMarkdown.trimEnd() + " ";
  const text: string = markdown.trimStart();
  const emoji: string = readFeedLeadingEmoji(text);
  const sentence: string | null = getSentenceAfterName(
    text.slice(emoji.length),
  );

  if (sentence === null) {
    return data.authorMarkdown + markdown;
  }

  if (!emoji) {
    return author + sentence;
  }

  return emoji.trimEnd() + " " + author + sentence;
};
