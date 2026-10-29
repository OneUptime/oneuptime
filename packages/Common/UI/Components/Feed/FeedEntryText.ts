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
 *    a sentence without a subject on the next. A record's created entry,
 *    which opens with a heading ("#### Incident INC-8 Created:"), reads
 *    "Nitin created Incident INC-8". Where the first block is not a
 *    sentence that can follow a name (another heading, a list, a noun
 *    phrase), the name stays on a line of its own above it. Without anyone
 *    to follow, a sentence written to follow a name starts with a capital
 *    ("Posted private note ..."), as a sentence does.
 *
 * Only the start of the Markdown is ever looked at - never a whole entry,
 * which can be megabytes long (a log pasted into a note).
 *
 * Which sentences follow a name, and how they read after one, are the
 * rules Slack and Microsoft Teams messages lead with their author by too
 * (Utils/Markdown/FeedLead), so the feed and the channel never read
 * differently.
 *
 * React-free so the rules can be tested on their own.
 */

import {
  FEED_LEAD_SCAN_LENGTH,
  FEED_LEADING_EMOJI,
  getSentenceAfterName,
  opensWithFeedLeadVerb,
} from "../../../Utils/Markdown/FeedLead";

/*
 * How much of the start of an entry the rules below read. Generous for a
 * first sentence, and small enough that no regular expression ever runs
 * over a long value.
 */
const LEAD_SCAN_LENGTH: number = FEED_LEAD_SCAN_LENGTH;

// A Markdown heading's opening: "#### ".
const HEADING_OPENING: RegExp = /^#{1,6}[ \t]+/;

// An opening that is not a paragraph: a heading, list, quote, table, code, rule.
const BLOCK_OPENING: RegExp =
  /^(?:#{1,6}[ \t]|[-*+][ \t]|\d+[.)][ \t]|>|\||```|~~~|<|---|\*\*\*|___|===)/;

// A letter or a digit in any script: what a name cannot run on into.
const NAME_CHARACTER: RegExp = /[\p{L}\p{N}]/u;

/*
 * How a record's created entry opens: "#### Incident INC-8 Created:",
 * "#### Scheduled Maintenance #58 Created:". Matched against its first line
 * only, which is never long.
 */
const CREATED_HEADING: RegExp = /^#{1,6}[ \t]+(\S.*?)[ \t]+Created:?[ \t]*$/;

// The longest first line read as a created heading.
const CREATED_HEADING_MAX_LENGTH: number = 200;

// A record named by its number ("Incident INC-8"), not by its kind alone.
const HAS_DIGIT: RegExp = /\d/;

// "on call policy", as the product writes it: "on-call policy".
const ON_CALL_WORDS: RegExp = /\bon call\b/g;

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

  const emoji: RegExpMatchArray | null = rest.match(FEED_LEADING_EMOJI);

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

/*
 * How a created entry's record reads after its creator's name: by its
 * number when the heading has one ("created Incident INC-8"), else as the
 * record whose feed this is ("#### Monitor Created:" - "created this
 * monitor").
 */
const getCreatedLead: (record: string) => string = (record: string): string => {
  if (HAS_DIGIT.test(record)) {
    return `created ${record}`;
  }

  return `created this ${record.toLowerCase().replace(ON_CALL_WORDS, "on-call")}`;
};

/*
 * The record a created entry's heading names - "Incident INC-8" for
 * "#### Incident INC-8 Created:" - or null for any other opening.
 */
const readCreatedHeading: (text: string) => string | null = (
  text: string,
): string | null => {
  const lineEnd: number = text.indexOf("\n");
  const firstLine: string = (
    lineEnd === -1 ? text : text.slice(0, lineEnd)
  ).trim();

  if (firstLine.length > CREATED_HEADING_MAX_LENGTH) {
    return null;
  }

  const match: RegExpMatchArray | null = firstLine.match(CREATED_HEADING);
  const name: string = (match?.[1] || "").trim();

  return name || null;
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

  // "#### Incident INC-8 Created:" reads "Nitin created Incident INC-8".
  const createdRecord: string | null = readCreatedHeading(head);

  if (createdRecord !== null) {
    const lineEnd: number = text.indexOf("\n");

    return {
      lead: getCreatedLead(createdRecord),
      body: lineEnd === -1 ? "" : text.slice(lineEnd + 1).trim(),
      leadNamesActor: false,
    };
  }

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

  /*
   * A sentence that opens in lower case already follows a name; one that
   * opens with an action's verb reads with it in lower case (FeedLead).
   */
  const sentence: string | null = getSentenceAfterName(firstBlock);

  if (sentence !== null) {
    return { lead: sentence, body: body, leadNamesActor: false };
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
 * How older owner notifications named each person they reached: one line
 * each, "**Notified:** Nitin Kumar (nitin@example.com)" ("**Notified**:" in
 * the created ones).
 */
const NOTIFIED_LINE_LABELS: ReadonlyArray<string> = [
  "**Notified:**",
  "**Notified**:",
];

const readNotifiedLine: (line: string) => string | null = (
  line: string,
): string | null => {
  for (const label of NOTIFIED_LINE_LABELS) {
    if (line.startsWith(label)) {
      return line.slice(label.length).trim();
    }
  }

  return null;
};

/*
 * An entry's details as the feed unfolds them. Who an owner notification
 * reached was once written as "**Notified:** <person>" lines, which
 * Markdown runs together into one paragraph ("Notified: Nitin (...)
 * Notified: Aidil (...)"); those details are shown as the list newer
 * entries write ("- Nitin (...)"). Any other details are shown as written.
 */
export const tidyFeedEntryDetails: (markdown: string | undefined) => string = (
  markdown: string | undefined,
): string => {
  const text: string = markdown || "";

  if (text.indexOf("**Notified") === -1) {
    return text;
  }

  const people: Array<string> = [];

  for (const line of text.split("\n")) {
    const trimmed: string = line.trim();

    if (!trimmed) {
      continue;
    }

    const person: string | null = readNotifiedLine(trimmed);

    // Anything but a "Notified" line: the details are not just a list.
    if (person === null) {
      return text;
    }

    if (person) {
      people.push(person);
    }
  }

  if (people.length === 0) {
    return text;
  }

  return (
    people
      .map((person: string) => {
        return `- ${person}`;
      })
      .join("\n") + "\n"
  );
};

/*
 * A sentence written to follow somebody's name ("posted **private note**
 * for this ..."), drawn where there is nobody to follow - a note an API key
 * posted - starts with a capital, as a sentence does. Only the verbs an
 * action is written with are touched, so a body that happens to open in
 * lower case ("iOS builds failed") is left alone.
 */
const capitalizeLeadVerb: (markdown: string) => string = (
  markdown: string,
): string => {
  const leadingWhitespaceLength: number =
    markdown.length - markdown.trimStart().length;
  const text: string = markdown.slice(leadingWhitespaceLength);

  // The verb must be a word of its own: "created-item" is not "created".
  if (!opensWithFeedLeadVerb(text)) {
    return markdown;
  }

  return (
    markdown.slice(0, leadingWhitespaceLength) +
    text.charAt(0).toUpperCase() +
    text.slice(1)
  );
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
  const entry: FeedEntryLead = getFeedEntryLead({
    markdown: stripLeadingDecoration(data.markdown || ""),
    actorName: data.actorName,
  });

  if ((data.actorName || "").trim()) {
    return entry;
  }

  return { ...entry, body: capitalizeLeadVerb(entry.body) };
};

export interface FeedNoteParts {
  /*
   * The sentence that introduces what was written, drawn as the entry's
   * text: "OneUptime AI posted a root cause analysis". Undefined when the
   * entry is nothing but what was written.
   */
  intro?: string | undefined;
  // What was written: drawn in the note's card.
  note: string;
}

/*
 * A note's entry (FeedEntryKind.isNote) without a sentence led by its
 * author - nobody to lead it, or an author line of its own - split into
 * the first paragraph that introduces the note and the note itself, so
 * only what was written goes in the note's card. A single paragraph is all
 * note.
 */
export const getFeedNoteParts: (body: string) => FeedNoteParts = (
  body: string,
): FeedNoteParts => {
  const text: string = (body || "").trim();
  const firstBlockEnd: number = findFirstBlockEnd(text);

  // A first paragraph longer than a sentence is the note itself.
  if (firstBlockEnd > LEAD_SCAN_LENGTH) {
    return { note: text };
  }

  const intro: string = text.slice(0, firstBlockEnd).trim();
  const note: string = text.slice(firstBlockEnd).trim();

  if (!intro || !note) {
    return { note: text };
  }

  return { intro: intro, note: note };
};
