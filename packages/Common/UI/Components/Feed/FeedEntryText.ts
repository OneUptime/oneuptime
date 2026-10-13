/*
 * How a feed entry's stored Markdown is read as a sentence.
 *
 * Feed entries are written once, by the server, as Markdown, and kept for
 * years - so the way they are shown has to make old entries read well too,
 * without rewriting them. Two things are done when they are drawn:
 *
 * 1. The decoration goes. Entries open with an emoji ("📄 posted private
 *    note", "#### 🚨 Incident INC-8 Created", "**📞 On Call Policy ...**")
 *    because Slack and Teams show them as plain messages. In the feed every
 *    entry already has an icon of its kind beside it, so the emoji only
 *    repeats it.
 *
 * 2. The person who did it leads the sentence. An entry written for
 *    someone's action reads after their name - chat puts it there ("@nitin
 *    posted private note ...") - so the feed does too: "Nitin posted a
 *    private note", with the avatar, instead of the name on one line and
 *    a sentence without a subject on the next. Where the first block is not
 *    a sentence that can follow a name (a heading, a list, a noun phrase),
 *    the name stays on a line of its own above it.
 *
 * Only the start of the Markdown is ever looked at - never a whole entry,
 * which can be megabytes long (a log pasted into a note).
 *
 * React-free so the rules can be tested on their own.
 */

/*
 * How much of the start of an entry the rules below read. Generous for a
 * first sentence, and small enough that no regular expression ever runs
 * over a long value.
 */
const LEAD_SCAN_LENGTH: number = 600;

/*
 * A leading emoji, with its modifiers, joiners and variation selectors -
 * "👨🏻‍💻 ", "🏷️ ", "⚠️ " - and the space after it.
 */
const LEADING_EMOJI: RegExp =
  /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|‍|️)+[ \t]*/u;

// A Markdown heading's opening: "#### ".
const HEADING_OPENING: RegExp = /^#{1,6}[ \t]+/;

// An opening that is not a paragraph: a heading, list, quote, table, code, rule.
const BLOCK_OPENING: RegExp =
  /^(?:#{1,6}[ \t]|[-*+][ \t]|\d+[.)][ \t]|>|\||```|~~~|<|---|\*\*\*|___|===)/;

// The first word of a sentence: letters only.
const FIRST_WORD: RegExp = /^[A-Za-z]+/;

// A letter or a digit in any script: what a name cannot run on into.
const NAME_CHARACTER: RegExp = /[\p{L}\p{N}]/u;

/*
 * Past-tense verbs an entry written for someone's action opens with, as
 * the server writes them ("Added", "Changed", "posted"). After the name
 * they read in lower case: "Nitin changed the state".
 */
const LEAD_VERBS: ReadonlySet<string> = new Set<string>([
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
  "enabled",
  "ended",
  "escalated",
  "executed",
  "invited",
  "joined",
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
  "triggered",
  "unassigned",
  "unlinked",
  "unmuted",
  "updated",
  "uploaded",
]);

type StripDecorationFunction = (markdown: string) => string;

/*
 * The entry without the emoji it opens with, wherever the server put it:
 * at the very start, after a heading's #s, or inside the bold the first
 * words are in. Nothing else in the entry changes.
 */
export const stripLeadingDecoration: StripDecorationFunction = (
  markdown: string,
): string => {
  if (!markdown) {
    return markdown;
  }

  const leadingWhitespaceLength: number =
    markdown.length - markdown.trimStart().length;
  const text: string = markdown.slice(leadingWhitespaceLength);
  const head: string = text.slice(0, LEAD_SCAN_LENGTH);
  const tail: string = text.slice(LEAD_SCAN_LENGTH);

  let prefix: string = "";
  let rest: string = head;

  const heading: RegExpMatchArray | null = rest.match(HEADING_OPENING);

  if (heading) {
    prefix = heading[0];
    rest = rest.slice(heading[0].length);
  }

  // "**📞 On Call Policy ...**" keeps its bold.
  if (rest.startsWith("**") || rest.startsWith("__")) {
    prefix += rest.slice(0, 2);
    rest = rest.slice(2);
  }

  const emoji: RegExpMatchArray | null = rest.match(LEADING_EMOJI);

  if (!emoji || emoji[0].length === 0) {
    return markdown;
  }

  const afterEmoji: string = rest.slice(emoji[0].length);

  // An entry that is nothing but an emoji keeps it: it is the whole message.
  if (afterEmoji.trim().length === 0 && tail.length === 0) {
    return markdown;
  }

  return (
    markdown.slice(0, leadingWhitespaceLength) + prefix + afterEmoji + tail
  );
};

export interface FeedEntryLead {
  /*
   * The first paragraph, to be read after the person's name, its first
   * verb in lower case. Undefined when the entry does not open with a
   * paragraph that can follow a name.
   */
  lead?: string | undefined;
  // Everything after the lead, or the whole entry when there is no lead.
  body: string;
  /*
   * True when the lead already opens with the person's name ("Nitin is
   * no longer on call"): the name is not put in front of it a second time.
   */
  leadNamesActor: boolean;
}

type FindFirstBlockEndFunction = (text: string) => number;

// Where the first paragraph ends: the first blank line, or the end.
const findFirstBlockEnd: FindFirstBlockEndFunction = (text: string): number => {
  let index: number = text.indexOf("\n");

  while (index !== -1) {
    let next: number = index + 1;

    while (next < text.length && (text[next] === " " || text[next] === "\t")) {
      next += 1;
    }

    if (next >= text.length || text[next] === "\n" || text[next] === "\r") {
      return index;
    }

    index = text.indexOf("\n", index + 1);
  }

  return text.length;
};

type NormalizeForNameFunction = (text: string) => string;

// Text with Markdown's emphasis, link and escape marks taken out.
const normalizeForName: NormalizeForNameFunction = (text: string): string => {
  let result: string = "";

  for (const character of text) {
    if (
      character === "*" ||
      character === "_" ||
      character === "[" ||
      character === "]" ||
      character === "\\" ||
      character === "`" ||
      character === "@"
    ) {
      continue;
    }

    result += character;
  }

  return result.trimStart().toLocaleLowerCase();
};

type StartsWithNameFunction = (lead: string, name: string) => boolean;

export const leadStartsWithName: StartsWithNameFunction = (
  lead: string,
  name: string,
): boolean => {
  const trimmedName: string = name.trim();

  if (!trimmedName) {
    return false;
  }

  const normalizedName: string = normalizeForName(trimmedName);
  const normalizedLead: string = normalizeForName(
    lead.slice(0, trimmedName.length * 2 + 16),
  );

  if (!normalizedLead.startsWith(normalizedName)) {
    return false;
  }

  // "Nitin" must not match "Nitinder".
  const after: string = normalizedLead.charAt(normalizedName.length);

  return after === "" || !NAME_CHARACTER.test(after);
};

type LowerCaseLeadVerbFunction = (lead: string) => string | null;

/*
 * The lead with its opening verb in lower case, or null when it does not
 * open with one of the verbs an action is written with.
 */
const lowerCaseLeadVerb: LowerCaseLeadVerbFunction = (
  lead: string,
): string | null => {
  const word: RegExpMatchArray | null = lead.match(FIRST_WORD);

  if (!word) {
    return null;
  }

  const lowerCaseWord: string = word[0].toLowerCase();

  if (!LEAD_VERBS.has(lowerCaseWord)) {
    return null;
  }

  // The word must end there: "Setup ..." is not "Set".
  const after: string = lead.charAt(word[0].length);

  if (after !== "" && after !== " " && after !== "\t") {
    return null;
  }

  return lowerCaseWord + lead.slice(word[0].length);
};

/*
 * Splits an entry (already without its decoration) into the sentence that
 * follows the person's name and the rest. Without a person there is no
 * lead: the entry is drawn as it is.
 */
export const getFeedEntryLead: (data: {
  markdown: string;
  actorName?: string | undefined;
}) => FeedEntryLead = (data: {
  markdown: string;
  actorName?: string | undefined;
}): FeedEntryLead => {
  const markdown: string = data.markdown || "";
  const actorName: string = (data.actorName || "").trim();

  if (!actorName) {
    return { body: markdown, leadNamesActor: false };
  }

  const text: string = markdown.trimStart();
  const head: string = text.slice(0, LEAD_SCAN_LENGTH);

  if (!head || BLOCK_OPENING.test(head)) {
    return { body: markdown, leadNamesActor: false };
  }

  const firstBlockEnd: number = findFirstBlockEnd(text);

  // A first paragraph longer than a sentence stays where it is.
  if (firstBlockEnd > LEAD_SCAN_LENGTH) {
    return { body: markdown, leadNamesActor: false };
  }

  const firstBlock: string = text.slice(0, firstBlockEnd).trim();
  const body: string = text.slice(firstBlockEnd).trim();

  if (!firstBlock) {
    return { body: markdown, leadNamesActor: false };
  }

  if (leadStartsWithName(firstBlock, actorName)) {
    return { lead: firstBlock, body: body, leadNamesActor: true };
  }

  const startsLowerCase: boolean =
    firstBlock.charAt(0) !== firstBlock.charAt(0).toUpperCase();

  if (startsLowerCase) {
    return { lead: firstBlock, body: body, leadNamesActor: false };
  }

  const withLowerCaseVerb: string | null = lowerCaseLeadVerb(firstBlock);

  if (withLowerCaseVerb !== null) {
    return { lead: withLowerCaseVerb, body: body, leadNamesActor: false };
  }

  return { body: markdown, leadNamesActor: false };
};

/*
 * Whether "More information" has anything in it. The server used to write
 * a label with nothing after it - "**Cause:**" for a state change no one
 * gave a cause for - and the feed offered a button that opened an empty
 * box. A lone short label ending in ":" counts as nothing.
 */
export const hasFeedEntryDetails: (markdown: string | undefined) => boolean = (
  markdown: string | undefined,
): boolean => {
  const trimmed: string = (markdown || "").trim();

  if (!trimmed) {
    return false;
  }

  // Long details are details, whatever they end with.
  if (trimmed.length > 80) {
    return true;
  }

  let plain: string = "";

  for (const character of trimmed) {
    if (character === "*" || character === "_" || character === "#") {
      continue;
    }

    plain += character;
  }

  plain = plain.trim();

  if (!plain) {
    return false;
  }

  const isLoneLabel: boolean = !plain.includes("\n") && plain.endsWith(":");

  return !isLoneLabel;
};

/*
 * The entry as the feed draws it: decoration off, and for an entry with a
 * person, split into the sentence that follows their name and the rest.
 */
export const getFeedEntryText: (data: {
  markdown: string;
  actorName?: string | undefined;
}) => FeedEntryLead = (data: {
  markdown: string;
  actorName?: string | undefined;
}): FeedEntryLead => {
  return getFeedEntryLead({
    markdown: stripLeadingDecoration(data.markdown || ""),
    actorName: data.actorName,
  });
};
