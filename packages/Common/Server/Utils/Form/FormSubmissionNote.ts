import { WHOLE_EMAIL_ADDRESS } from "../../../Types/Form/FormPublic";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";

/*
 * The private note a submission leaves on what it created: which form it
 * came through, who sent it as far as they said, and their answers to the
 * form's own questions (the answers to linked questions are on the record
 * already - its title, its severity, its custom fields). Private, so the
 * submitter's name and address never reach a status page the way a
 * description can.
 *
 * The note is posted as it is - no person reads it over first - and to the
 * record's Slack and Teams channels as well, so everything placed in it is
 * made inert where it is placed:
 *
 *   - names, labels and one-line answers are text, placed with mdText
 *     (which also breaks chat control sequences): "[x](javascript:...)"
 *     reaches the responders as those characters, "<!channel>" mentions
 *     nobody;
 *   - a multi-line answer is placed line by line, keeping its lines;
 *   - a Markdown answer is Markdown by design, and goes through
 *     FeedMarkdown.writtenOutside, as a description does: no image or
 *     diagram that acts on its own, and no chat mention;
 *   - the submitter's address is an autolink, <jane@example.com>, so every
 *     renderer links the whole of it - or, for an address an autolink would
 *     not carry whole everywhere, an explicit percent-encoded mailto: link.
 *     See EXPLICIT_LINK_ADDRESS_PATTERN.
 *
 * Pure, so it is tested on its own.
 */

/*
 * An address an autolink carries whole everywhere: letters, digits, dots
 * and hyphens, and of the rest of what an address may hold only "_", "~",
 * "$", "'", "*" and "+" - the characters a mailto: link may carry as they
 * are (RFC 6068) and that every renderer here keeps inside an autolink.
 * Every other one is written as an explicit link, because somewhere the
 * autolink would write to another address:
 *
 *   - "!" anywhere: micromark, behind the dashboard and slackify, does not
 *     take "!" in an autolink's address, so <first.last!ops@corp.example>
 *     became a link to ops@corp.example (and a leading "!", like a leading
 *     "#", opens like a Slack control sequence);
 *   - "^": marked, which renders the owners' email, drops "^" from its
 *     autolink rule, so <jane^doe@corp.example> linked doe@corp.example;
 *   - "#", "?" and "%": a mail client reads them in a mailto: link as a
 *     fragment, headers or an escape - <a#b@example.com> writes to "a",
 *     <a%41@example.com> to aA@example.com - and slackify cannot even read
 *     an address with a stray "%" in it;
 *   - "&", "/", "=", "`", "{", "|" and "}": RFC 6068 has them
 *     percent-encoded in a mailto: link, which an autolink cannot do.
 */
const EXPLICIT_LINK_ADDRESS_PATTERN: RegExp = /[^a-z0-9.@_~$'*+-]/i;

/*
 * The characters of an address a mailto: link carries only percent-encoded
 * (RFC 6068): all but unreserved characters and "!", "$", "'", "*", "+"
 * and "@".
 */
const MAILTO_ENCODED_CHARACTER_PATTERN: RegExp = /[^a-z0-9.@_~!$'*+-]/gi;

const LINE_BREAKS: RegExp = /\r\n|\r|\n/;

type GetMailtoLinkFunction = (email: string) => string;

// A mailto: link that writes to exactly this address.
const getMailtoLink: GetMailtoLinkFunction = (email: string): string => {
  return `mailto:${email.replace(
    MAILTO_ENCODED_CHARACTER_PATTERN,
    (character: string): string => {
      return `%${character
        .charCodeAt(0)
        .toString(16)
        .toUpperCase()
        .padStart(2, "0")}`;
    },
  )}`;
};

type LineFunction = (value: string | null | undefined) => string;

/*
 * One line of plain text, placed as text (mdText) wherever it goes - which
 * also turns a line break in it into a space.
 */
const line: LineFunction = (value: string | null | undefined): string => {
  return String(value ?? "").trim();
};

export type GetFormSubmitterTextFunction = (data: {
  email?: string | null | undefined;
}) => string;

/*
 * The submitter's address as the note writes it: an autolink, an explicit
 * mailto: link, or - for a value that is not one whole address (the
 * function is exported, and could be handed anything) - escaped like a name.
 */
export const getFormSubmitterEmailText: GetFormSubmitterTextFunction = (data: {
  email?: string | null | undefined;
}): string => {
  const email: string = String(data.email ?? "").trim();

  if (!email) {
    return "";
  }

  if (!WHOLE_EMAIL_ADDRESS.test(email)) {
    return mdText`${line(email)}`.toString();
  }

  return EXPLICIT_LINK_ADDRESS_PATTERN.test(email)
    ? mdText`[${email}](${getMailtoLink(email)})`.toString()
    : `<${email}>`;
};

// How an answer is laid out in the note.
export enum FormNoteAnswerFormat {
  // One line of text, a number, a date, a choice, a yes/no.
  SingleLine = "SingleLine",
  // Several lines of plain text.
  MultiLine = "MultiLine",
  // Markdown the submitter wrote.
  Markdown = "Markdown",
}

export interface FormNoteAnswer {
  label: string;
  displayValue: string;
  format: FormNoteAnswerFormat;
}

export type GetFormSubmissionNoteFunction = (data: {
  formName?: string | null | undefined;
  submitterName?: string | null | undefined;
  submitterEmail?: string | null | undefined;
  // The form's template the submission started from, if any.
  templateName?: string | null | undefined;
  answers?: Array<FormNoteAnswer> | undefined;
}) => string;

type FormatAnswerFunction = (answer: FormNoteAnswer) => MarkdownText;

const formatAnswerValue: FormatAnswerFunction = (
  answer: FormNoteAnswer,
): MarkdownText => {
  switch (answer.format) {
    case FormNoteAnswerFormat.Markdown:
      return FeedMarkdown.writtenOutside(answer.displayValue).trim();

    case FormNoteAnswerFormat.MultiLine:
      // A hard break ends each line, so the answer keeps its lines.
      return FeedMarkdown.join(
        answer.displayValue.split(LINE_BREAKS).map((text: string): string => {
          return line(text);
        }),
        "  \n",
      );

    default:
      return mdText`${line(answer.displayValue)}`;
  }
};

/**
 * The note: one sentence naming the form and the submitter, one naming the
 * template the submission started from when it started from one, then each
 * answer to the form's own questions under its question, in the form's
 * order.
 */
export const getFormSubmissionNote: GetFormSubmissionNoteFunction = (data: {
  formName?: string | null | undefined;
  submitterName?: string | null | undefined;
  submitterEmail?: string | null | undefined;
  templateName?: string | null | undefined;
  answers?: Array<FormNoteAnswer> | undefined;
}): string => {
  const formName: string = line(data.formName);
  const form: MarkdownText = formName
    ? mdText`the form **${formName}**`
    : mdText`a form`;

  const submitterName: string = line(data.submitterName);
  // Markdown: an autolink, a mailto: link, or the value as text.
  const submitterEmail: MarkdownText = FeedMarkdown.asMarkdown(
    getFormSubmitterEmailText({
      email: data.submitterEmail,
    }),
  );

  let sentence: MarkdownText = mdText`Submitted anonymously through ${form}.`;

  if (submitterName && !submitterEmail.isEmpty()) {
    sentence = mdText`Submitted through ${form} by ${submitterName} (${submitterEmail}).`;
  } else if (submitterName) {
    sentence = mdText`Submitted through ${form} by ${submitterName}.`;
  } else if (!submitterEmail.isEmpty()) {
    sentence = mdText`Submitted through ${form} by ${submitterEmail}.`;
  }

  const parts: Array<MarkdownText> = [sentence];

  // A template's name is the team's own words, placed as text all the same.
  const templateName: string = line(data.templateName);

  if (templateName) {
    parts.push(mdText`Started from the template **${templateName}**.`);
  }

  for (const answer of data.answers || []) {
    const label: string = line(answer.label) || "Question";
    const value: MarkdownText = formatAnswerValue(answer);

    if (value.isEmpty()) {
      continue;
    }

    /*
     * A hard break after the question keeps the answer on its own line; a
     * Markdown answer gets a paragraph of its own, so its blocks (a list, a
     * code block) start where they should.
     */
    parts.push(
      answer.format === FormNoteAnswerFormat.Markdown
        ? mdText`**${label}**\n\n${value}`
        : mdText`**${label}**  \n${value}`,
    );
  }

  return FeedMarkdown.join(parts, "\n\n").toString();
};
