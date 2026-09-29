import { escapeMarkdownInline } from "./MarkdownEscape";
import { Lexer, Token, Tokens } from "marked";

/*
 * MARKDOWN WRITTEN BY SOMEBODY OUTSIDE - an incident form's reporter, who
 * needs no account, only the form's link - made safe to store as an
 * incident's own text.
 *
 * Nobody reads such text over before it is posted: the incident's title and
 * description go straight into its "Incident Created" feed item, which is
 * posted to the project's Slack and Microsoft Teams channels, and the
 * description and Markdown custom field answers are rendered for every
 * responder who opens the incident (the dashboard renders incident text
 * without the viewer's safe mode) and in the owners' and on-call emails.
 * Three things in it act on their own there, before anybody decides to
 * click anything:
 *
 *   - CHAT CONTROL SEQUENCES. Slack reads <!channel>, <!here>, <!everyone>,
 *     <!subteam^ID>, <@U123> and <#C123> in a bot's message as mentions, so
 *     a stranger could make OneUptime's bot notify a whole channel.
 *     neutralizeChatControlSequences puts an invisible word joiner (U+2060)
 *     between the "<" and the "!", "@" or "#": the text reads exactly as
 *     typed everywhere, but is no longer a sequence Slack (or slackify, which
 *     then escapes the lone "<") recognises. It is applied everywhere in the
 *     text, code included: slackify passes code through untouched, so a
 *     mention inside a code span would reach Slack as it is, and the joiner
 *     changes nothing a reader can see.
 *
 *   - IMAGES. ![alt](https://tracker.example/p.png) is fetched from the
 *     outsider's server by every responder's browser and mail client that
 *     shows the incident: a zero-click beacon of who looked, when, and from
 *     where. Each image becomes a plain link to the same address, so nothing
 *     is fetched until somebody chooses to follow it: the "!" is escaped,
 *     which is the one change that turns an image into a link without
 *     rewriting anything else, and an image with no alt text is given its
 *     address as the link's text, so the link is not an empty, invisible
 *     one. Reference-style images (![alt][ref], ![ref]) are covered: they
 *     start with the same "![".
 *
 *   - MERMAID DIAGRAMS. A ```mermaid fence is rendered as a diagram, which
 *     runs mermaid's renderer (and can load images) in the responder's
 *     browser. Its info string becomes "text", so it shows as the code the
 *     reporter typed.
 *
 * WHAT MAKES IT SAFE DOES NOT DEPEND ON HOW ANY ONE RENDERER READS THE TEXT.
 * The same text is read by marked (the emails), by remark with its GitHub
 * extensions, footnotes included (the dashboard), and by slackify, and they
 * do not agree on everything. "[a]: https://a.example" followed by an
 * indented "![x](...)" line, or a footnote's indented paragraph, is an
 * indented code block to marked and a paragraph - with a live image - to
 * the dashboard; a footnote definition is no more than a link definition to
 * marked. So the guarantee is made on the characters, where every renderer
 * agrees:
 *
 *   - Nothing is an image unless it starts with "![" (an entity is only
 *     text, and raw HTML is shown as text in the dashboard and escaped in
 *     the emails). Every "![" whose "!" is not already escaped, and which
 *     something after it could complete - a "](" or "][" before its
 *     paragraph can end at a blank line, or any reference definition in
 *     the text - is broken: a backslash goes before the "!", or an
 *     invisible word joiner between the "!" and the "[". Either way no
 *     renderer finds an image there.
 *   - The dashboard draws a diagram only for a fence whose language is
 *     "mermaid". Every "mermaid" right after a fence run is renamed "text",
 *     or has a word joiner put before it, so no info string starts with it.
 *
 * A real Markdown lexer (marked) only decides which of those the text gets,
 * so that it still reads as typed: an image it finds gets the backslash (and
 * its address as link text when it had no alt text); a "![" inside what it
 * reads as a code span, a code block or raw HTML - where a backslash would
 * show - gets the invisible joiner; any other "![" gets the backslash, which
 * every renderer turns back into the "!" as typed, in a link's address too.
 * A mermaid fence it finds is renamed; any other "mermaid" after a fence run
 * gets the joiner. Code with no image in it - "Wow![sic]", Rust's vec![1, 2]
 * - has nothing that could complete one, and is left byte for byte.
 *
 * The lexer does not say where in the text a token came from, so every place
 * to change is first tagged with a numbered marker the lexer passes through
 * untouched (private use characters, inert to Markdown); a marker that ends
 * up right before an image token, inside a code span, a code block or HTML,
 * or at the start of a code block's language, says what that place is. Should
 * the lexer fail, every place gets the backslash (or the joiner, for a
 * diagram): still safe, only less tidy.
 *
 * Links are left alone: a reporter linking the page that is broken is the
 * point of a report, and a link does nothing until somebody clicks it.
 *
 * Pure, with no database or React imports.
 */

const WORD_JOINER: string = "\u2060";

const CHAT_CONTROL_SEQUENCE_START_PATTERN: RegExp = /<(?=[!@#])/g;

export type NeutralizeChatControlSequencesFunction = (
  value: string | undefined | null,
) => string;

/**
 * The text as typed, with every "<!", "<@" and "<#" broken by an invisible
 * word joiner, so no chat tool reads a mention in it. Idempotent: a joiner
 * already there is not doubled.
 */
export const neutralizeChatControlSequences: NeutralizeChatControlSequencesFunction =
  (value: string | undefined | null): string => {
    if (value === undefined || value === null) {
      return "";
    }

    return String(value).replace(
      CHAT_CONTROL_SEQUENCE_START_PATTERN,
      `<${WORD_JOINER}`,
    );
  };

/*
 * Private use characters, which nobody types and Markdown treats as plain
 * text: MARKER_START, a number and MARKER_END tag one place in the probe.
 * A marker only steers which change a place gets, never whether it gets
 * one, so a reporter who does type these characters decides nothing.
 */
const MARKER_START: string = "\uE000";
const MARKER_END: string = "\uE001";
const MARKER_PATTERN: RegExp = /\uE000(\d+)\uE001/g;
const MARKER_AT_END_PATTERN: RegExp = /\uE000(\d+)\uE001$/;
const MARKER_AT_START_PATTERN: RegExp = /^\uE000(\d+)\uE001/;

/*
 * A fence run, then only spaces or tabs, then "mermaid": where a mermaid
 * code block's info string can begin. Not anchored to the start of the
 * line: container prefixes such as "> " and list indentation come first.
 */
const MERMAID_INFO_PATTERN: RegExp = /(?:`{3,}|~{3,})[^\S\n]*(?=mermaid)/gi;

const MERMAID: string = "mermaid";
const DEMOTED_LANGUAGE: string = "text";

/*
 * What can complete an image after its "![": a closing bracket followed by
 * an address, "](", or by a reference label, "][" - with spaces or tabs
 * allowed between, although no renderer here allows them. None can reach
 * past a blank line, where every paragraph ends; and a reference definition
 * anywhere in the text could complete any "![label]".
 */
const IMAGE_COMPLETION_PATTERN: RegExp = /\][ \t]*[([]/g;
const BLANK_LINE_PATTERN: RegExp = /\n[ \t]*(?=\n|$)/g;
const REFERENCE_DEFINITION_PATTERN: RegExp = /\]:/;

// An image link's text, when the image had no alt text: its address.
const IMAGE_LINK_LABEL_MAX_LENGTH: number = 80;
const IMAGE_LINK_FALLBACK_LABEL: string = "image";

enum CandidateKind {
  Image = "image",
  Mermaid = "mermaid",
}

interface Candidate {
  kind: CandidateKind;
  // Where the "![" or the "mermaid" starts, in the line-ending normalised text.
  position: number;
}

interface Edit {
  position: number;
  deleteCount: number;
  insert: string;
}

type LexFunction = (markdown: string) => Array<Token>;

/*
 * The options marked's own parse uses by default (GitHub flavoured, no
 * line-break extension), given afresh each time: the lexer writes into the
 * options object it is handed, and must not see what another caller set up
 * with marked.use().
 */
const lex: LexFunction = (markdown: string): Array<Token> => {
  return new Lexer({ gfm: true, breaks: false, pedantic: false }).lex(markdown);
};

type GetChildTokensFunction = (token: Token) => Array<Token>;

const getChildTokens: GetChildTokensFunction = (token: Token): Array<Token> => {
  if (token.type === "list") {
    return (token as Tokens.List).items;
  }

  if (token.type === "table") {
    const table: Tokens.Table = token as Tokens.Table;
    const cells: Array<Tokens.TableCell> = [...table.header];

    for (const row of table.rows) {
      cells.push(...row);
    }

    return cells.flatMap((cell: Tokens.TableCell): Array<Token> => {
      return cell.tokens || [];
    });
  }

  const nested: unknown = (token as { tokens?: unknown }).tokens;

  return Array.isArray(nested) ? (nested as Array<Token>) : [];
};

type WalkTokensFunction = (
  tokens: Array<Token>,
  visit: (token: Token, isLeaf: boolean) => void,
) => void;

// Every token, depth first, in the order its text appears.
const walkTokens: WalkTokensFunction = (
  tokens: Array<Token>,
  visit: (token: Token, isLeaf: boolean) => void,
): void => {
  for (const token of tokens) {
    const children: Array<Token> = getChildTokens(token);

    visit(token, children.length === 0);
    walkTokens(children, visit);
  }
};

type GetMatchPositionsFunction = (
  source: string,
  pattern: RegExp,
) => Array<number>;

// Where each match of a global pattern starts, in order.
const getMatchPositions: GetMatchPositionsFunction = (
  source: string,
  pattern: RegExp,
): Array<number> => {
  const positions: Array<number> = [];

  for (const match of source.matchAll(pattern)) {
    positions.push(match.index || 0);
  }

  return positions;
};

type FindCandidatesFunction = (source: string) => Array<Candidate>;

/*
 * Every place to change, in order: each "![" that could open an image - its
 * "!" not escaped (an even number of backslashes before it) and something
 * after it that could complete one (see IMAGE_COMPLETION_PATTERN) - and each
 * "mermaid" right after a fence run.
 */
const findCandidates: FindCandidatesFunction = (
  source: string,
): Array<Candidate> => {
  const candidates: Array<Candidate> = [];

  const hasReferenceDefinition: boolean =
    REFERENCE_DEFINITION_PATTERN.test(source);
  const completions: Array<number> = getMatchPositions(
    source,
    IMAGE_COMPLETION_PATTERN,
  );
  const paragraphEnds: Array<number> = [
    ...getMatchPositions(source, BLANK_LINE_PATTERN),
    source.length,
  ];

  // Both only move forward, as the openers do.
  let nextCompletion: number = 0;
  let nextParagraphEnd: number = 0;

  for (
    let position: number = source.indexOf("![");
    position !== -1;
    position = source.indexOf("![", position + 1)
  ) {
    let backslashes: number = 0;

    while (
      position - backslashes - 1 >= 0 &&
      source[position - backslashes - 1] === "\\"
    ) {
      backslashes++;
    }

    if (backslashes % 2 !== 0) {
      continue;
    }

    while (
      nextCompletion < completions.length &&
      completions[nextCompletion]! <= position
    ) {
      nextCompletion++;
    }

    while (paragraphEnds[nextParagraphEnd]! <= position) {
      nextParagraphEnd++;
    }

    const isCompletable: boolean =
      hasReferenceDefinition ||
      (nextCompletion < completions.length &&
        completions[nextCompletion]! < paragraphEnds[nextParagraphEnd]!);

    if (isCompletable) {
      candidates.push({ kind: CandidateKind.Image, position: position });
    }
  }

  for (const match of source.matchAll(MERMAID_INFO_PATTERN)) {
    candidates.push({
      kind: CandidateKind.Mermaid,
      position: (match.index || 0) + match[0].length,
    });
  }

  return candidates.sort((a: Candidate, b: Candidate): number => {
    return a.position - b.position;
  });
};

interface FoundInProbe {
  // By candidate index: the images the lexer found.
  images: Map<number, Tokens.Image>;
  // The candidates in a code span, a code block or raw HTML.
  literal: Set<number>;
  // The candidates that begin a code block's language.
  diagrams: Set<number>;
}

type FindInProbeFunction = (
  source: string,
  candidates: Array<Candidate>,
) => FoundInProbe;

/*
 * What the lexer makes of each candidate place: the text is lexed with
 * every one of them tagged by its number.
 */
const findInProbe: FindInProbeFunction = (
  source: string,
  candidates: Array<Candidate>,
): FoundInProbe => {
  let probe: string = "";
  let cursor: number = 0;

  candidates.forEach((candidate: Candidate, index: number): void => {
    probe +=
      source.slice(cursor, candidate.position) +
      `${MARKER_START}${index}${MARKER_END}`;
    cursor = candidate.position;
  });

  probe += source.slice(cursor);

  const found: FoundInProbe = {
    images: new Map<number, Tokens.Image>(),
    literal: new Set<number>(),
    diagrams: new Set<number>(),
  };

  const markLiteral: (text: string | undefined) => void = (
    text: string | undefined,
  ): void => {
    for (const marker of (text || "").matchAll(MARKER_PATTERN)) {
      found.literal.add(Number(marker[1]));
    }
  };

  let previousLeafRaw: string = "";

  walkTokens(lex(probe), (token: Token, isLeaf: boolean): void => {
    if (token.type === "image") {
      /*
       * The marker sits right before the "!", so it ends the text the
       * lexer read just before this image.
       */
      const marker: RegExpExecArray | null =
        MARKER_AT_END_PATTERN.exec(previousLeafRaw);

      if (marker) {
        found.images.set(Number(marker[1]), token as Tokens.Image);
      }
    }

    if (token.type === "code") {
      const code: Tokens.Code = token as Tokens.Code;

      const marker: RegExpExecArray | null = MARKER_AT_START_PATTERN.exec(
        (code.lang || "").trim(),
      );

      if (marker) {
        found.diagrams.add(Number(marker[1]));
      }

      // The block's content, not its info string.
      markLiteral(code.text);
    }

    if (token.type === "codespan" || token.type === "html") {
      markLiteral(token.raw);
    }

    if (isLeaf) {
      previousLeafRaw = token.raw || "";
    }
  });

  return found;
};

type GetImageLinkLabelFunction = (href: string | undefined) => string;

/*
 * The text of the link an image without alt text becomes: its address,
 * shortened and escaped so it reads as typed, or a plain word when it has
 * none.
 */
const getImageLinkLabel: GetImageLinkLabelFunction = (
  href: string | undefined,
): string => {
  const address: string = (href || "").replace(MARKER_PATTERN, "").trim();

  if (!address) {
    return IMAGE_LINK_FALLBACK_LABEL;
  }

  return escapeMarkdownInline(
    address.length > IMAGE_LINK_LABEL_MAX_LENGTH
      ? `${address.slice(0, IMAGE_LINK_LABEL_MAX_LENGTH)}...`
      : address,
  );
};

type GetEditsFunction = (data: {
  source: string;
  candidate: Candidate;
  index: number;
  found: FoundInProbe;
}) => Array<Edit>;

// What changes one candidate place into something that does nothing.
const getEdits: GetEditsFunction = (data: {
  source: string;
  candidate: Candidate;
  index: number;
  found: FoundInProbe;
}): Array<Edit> => {
  const position: number = data.candidate.position;

  if (data.candidate.kind === CandidateKind.Mermaid) {
    // A diagram the lexer found is renamed; anything else is broken.
    return data.found.diagrams.has(data.index)
      ? [
          {
            position: position,
            deleteCount: MERMAID.length,
            insert: DEMOTED_LANGUAGE,
          },
        ]
      : [{ position: position, deleteCount: 0, insert: WORD_JOINER }];
  }

  const image: Tokens.Image | undefined = data.found.images.get(data.index);

  // In code or HTML a backslash would show; the joiner cannot be seen.
  if (!image && data.found.literal.has(data.index)) {
    return [{ position: position + 1, deleteCount: 0, insert: WORD_JOINER }];
  }

  const edits: Array<Edit> = [
    { position: position, deleteCount: 0, insert: "\\" },
  ];

  /*
   * "![]" - an image with no alt text, whose link would have no text to
   * see or click. Only for an image the lexer found, whose address is known.
   */
  if (image && data.source.startsWith("![]", position)) {
    edits.push({
      position: position + 2,
      deleteCount: 0,
      insert: getImageLinkLabel(image.href),
    });
  }

  return edits;
};

type ApplyEditsFunction = (source: string, edits: Array<Edit>) => string;

const applyEdits: ApplyEditsFunction = (
  source: string,
  edits: Array<Edit>,
): string => {
  let result: string = source;

  // From the end, so the positions still to come stay where they were.
  const ordered: Array<Edit> = [...edits].sort((a: Edit, b: Edit): number => {
    return b.position - a.position;
  });

  for (const edit of ordered) {
    result =
      result.slice(0, edit.position) +
      edit.insert +
      result.slice(edit.position + edit.deleteCount);
  }

  return result;
};

export type NeutralizeMarkdownImagesAndDiagramsFunction = (
  markdown: string | undefined | null,
) => string;

/**
 * The Markdown with every image turned into a link to the same address and
 * every mermaid diagram into a plain code block, whatever renderer reads it
 * (see above); everything else reads exactly as written. Text with neither
 * comes back unchanged; otherwise its line endings come back as "\n".
 */
export const neutralizeMarkdownImagesAndDiagrams: NeutralizeMarkdownImagesAndDiagramsFunction =
  (markdown: string | undefined | null): string => {
    if (markdown === undefined || markdown === null) {
      return "";
    }

    const original: string = String(markdown);

    // As marked reads it, so a position here is a position in what it lexed.
    const source: string = original.replace(/\r\n|\r/g, "\n");

    const candidates: Array<Candidate> = findCandidates(source);

    // Nothing that could be an image or a diagram.
    if (candidates.length === 0) {
      return original;
    }

    let found: FoundInProbe;

    try {
      found = findInProbe(source, candidates);
    } catch {
      /*
       * Not read at all: every "![" gets the backslash and every "mermaid"
       * the joiner - as safe, only less tidy where one sits in code.
       */
      found = {
        images: new Map<number, Tokens.Image>(),
        literal: new Set<number>(),
        diagrams: new Set<number>(),
      };
    }

    return applyEdits(
      source,
      candidates.flatMap((candidate: Candidate, index: number): Array<Edit> => {
        return getEdits({
          source: source,
          candidate: candidate,
          index: index,
          found: found,
        });
      }),
    );
  };

export type NeutralizeUntrustedMarkdownFunction = (
  markdown: string | undefined | null,
) => string;

/**
 * Both of the above, for Markdown an outsider wrote: no image or diagram
 * that acts on its own, and no chat mention.
 */
export const neutralizeUntrustedMarkdown: NeutralizeUntrustedMarkdownFunction =
  (markdown: string | undefined | null): string => {
    return neutralizeChatControlSequences(
      neutralizeMarkdownImagesAndDiagrams(markdown),
    );
  };
