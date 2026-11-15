import {
  SetupGuideContent,
  SetupGuideStep,
  SetupGuideStepVariant,
  SetupGuideTopic,
} from "./SetupGuide";
import {
  setsPunctuationApart,
  withFrenchSpacing,
} from "Common/Types/NoBreakSpaces";

/*
 * A SETUP GUIDE'S MARKDOWN, IN THE READER'S LANGUAGE (#8341).
 *
 * A product's Help > Documentation page is its setup guide (Kubernetes,
 * Docker, Ceph and the others), and the card already draws the guide's
 * titles, descriptions and notes in the reader's language: each is a key of
 * the locale files. Its markdown - every step's body, every tab, every
 * topic under Advanced and Troubleshooting - was English in every language.
 *
 * That markdown is built in code, around the commands the reader copies,
 * with the reader's OneUptime URL, key and cluster name in them, and with
 * the picked platform's own sentences. So a guide cannot hold one text per
 * language, as Data Observability's page does (DocumentationInReadersLanguage).
 * It holds, per language, each piece of its English markdown and that
 * language's words for it: a paragraph, a list item, a table row, a heading
 * or a quote. The card builds the English guide as before, and every piece
 * the reader's language has is drawn in it; code is never translated.
 *
 * A piece is found by its shape: its words, with each `code` span and each
 * link's target set aside. A guide's code spans carry values - the host
 * name, the URL - so "Replace `my-docker-host` with a name for this host"
 * is one piece whatever name is in it, and the translation's code spans
 * are the English's, as the guide wrote them for this reader. A piece the
 * language has no words for reads in English.
 *
 * Pure on purpose, like SetupGuide.ts: strings in, strings out.
 */

/*
 * One language's words for a guide: each piece of the English markdown, as
 * the guide writes it, and the language's text for it.
 */
export type SetupGuideTranslation = Readonly<Record<string, string>>;

// One language's words, as a module whose default export they are.
export type SetupGuideTranslationLoader = () => Promise<{
  default: SetupGuideTranslation;
}>;

// Each language's words but English's, by the Dashboard's language code.
export type SetupGuideTranslations = Readonly<
  Partial<Record<string, SetupGuideTranslationLoader>>
>;

// A piece's words in a language, found by the shape of its English.
export interface SetupGuidePieceWords {
  english: string;
  words: string;
}

// A language's words for a guide, ready to be drawn.
export interface SetupGuideWords {
  language: string;
  pieces: ReadonlyMap<string, SetupGuidePieceWords>;
}

// One piece of a guide's markdown: one or more lines, drawn whole.
export interface SetupGuidePiece {
  text: string;
  // False for code, a blank line, a table's divider and an alert's marker.
  isWords: boolean;
}

const FENCE_LINE: RegExp = /^\s*```/;

// "> [!NOTE]": the marker of a GitHub alert, which the viewer draws as one.
const ALERT_MARKER_LINE: RegExp = /^\s*>\s*\[![A-Za-z]+\]\s*$/;

const QUOTE_LINE: RegExp = /^\s*>/;

const LIST_ITEM_LINE: RegExp = /^\s*(?:[-*+]|\d+[.)])\s/;

const TABLE_LINE: RegExp = /^\s*\|/;

const HEADING_LINE: RegExp = /^\s*#{1,6}\s/;

// A code span: what a translation keeps as the English writes it.
const CODE_SPAN: RegExp = /`[^`\n]+`/g;

// A link's target: "](/docs/...)".
const LINK_TARGET: RegExp = /\]\([^)\s]*\)/g;

// Where a piece's code span or link target stood, in its shape.
const CODE_IN_SHAPE: string = "``";
const LINK_IN_SHAPE: string = "]()";

// A word: two letters, outside code and link targets.
const A_WORD: RegExp = /\p{L}{2}/u;

type LineKind = "fence" | "blank" | "marker" | "quote" | "single" | "paragraph";

function getLineKind(line: string): LineKind {
  if (FENCE_LINE.test(line)) {
    return "fence";
  }
  if (!line.trim()) {
    return "blank";
  }
  if (ALERT_MARKER_LINE.test(line)) {
    return "marker";
  }
  if (QUOTE_LINE.test(line)) {
    return "quote";
  }
  if (
    LIST_ITEM_LINE.test(line) ||
    TABLE_LINE.test(line) ||
    HEADING_LINE.test(line)
  ) {
    return "single";
  }
  return "paragraph";
}

// Whether a piece of the guide has words in it, outside its code and links.
export function hasWords(text: string): boolean {
  return A_WORD.test(
    text
      .replace(CODE_SPAN, " ")
      .replace(LINK_TARGET, "]")
      .replace(/<[^<>]+>/g, " "),
  );
}

/*
 * A guide's markdown as the pieces it is drawn from, in order: each code
 * block's lines and each blank line as they are, each list item, table row
 * and heading on its own, and the lines of a paragraph, and of a quote,
 * together. Joined with "\n", the pieces are the markdown again.
 */
export function getSetupGuidePieces(markdown: string): Array<SetupGuidePiece> {
  const pieces: Array<SetupGuidePiece> = [];
  const lines: Array<string> = markdown.split("\n");
  let isInCode: boolean = false;
  let index: number = 0;

  while (index < lines.length) {
    const line: string = lines[index]!;
    const kind: LineKind = getLineKind(line);

    if (kind === "fence" || isInCode) {
      if (kind === "fence") {
        isInCode = !isInCode;
      }
      pieces.push({ text: line, isWords: false });
      index++;
      continue;
    }

    if (kind === "blank" || kind === "marker") {
      pieces.push({ text: line, isWords: false });
      index++;
      continue;
    }

    if (kind === "single") {
      pieces.push({ text: line, isWords: hasWords(line) });
      index++;
      continue;
    }

    // A paragraph, or a quote: its lines until a line of another kind.
    const together: Array<string> = [line];
    index++;
    while (index < lines.length && getLineKind(lines[index]!) === kind) {
      together.push(lines[index]!);
      index++;
    }
    const text: string = together.join("\n");
    pieces.push({ text: text, isWords: hasWords(text) });
  }

  return pieces;
}

/*
 * The shape a piece is found by: its words, with every code span and link
 * target set aside, so the values a guide writes in them do not matter.
 */
export function getSetupGuidePieceShape(piece: string): string {
  return piece
    .replace(CODE_SPAN, CODE_IN_SHAPE)
    .replace(LINK_TARGET, LINK_IN_SHAPE);
}

/*
 * `words` with each of `english`'s code spans (or link targets) as `drawn`
 * writes it: `drawn` is the piece as the guide built it for this reader,
 * `english` the same piece as the language's words were written for. A
 * span the translation writes that the English does not have stays as it
 * is.
 */
function withDrawnSpans(data: {
  words: string;
  english: string;
  drawn: string;
  pattern: RegExp;
}): string {
  const englishSpans: Array<string> = data.english.match(data.pattern) || [];
  const drawnSpans: Array<string> = data.drawn.match(data.pattern) || [];
  const used: Array<boolean> = englishSpans.map((): boolean => {
    return false;
  });

  return data.words.replace(data.pattern, (span: string): string => {
    let at: number = englishSpans.findIndex(
      (candidate: string, position: number): boolean => {
        return candidate === span && !used[position];
      },
    );
    if (at === -1) {
      at = englishSpans.indexOf(span);
    } else {
      used[at] = true;
    }
    return at === -1 ? span : drawnSpans[at] ?? span;
  });
}

// A language's words for a guide, each piece found by the shape of its English.
export function getSetupGuideWords(data: {
  language: string;
  translation: SetupGuideTranslation;
}): SetupGuideWords {
  const pieces: Map<string, SetupGuidePieceWords> = new Map<
    string,
    SetupGuidePieceWords
  >();

  for (const english of Object.keys(data.translation)) {
    const words: string | undefined = data.translation[english];
    const shape: string = getSetupGuidePieceShape(english);

    if (typeof words === "string" && words.trim() && !pieces.has(shape)) {
      pieces.set(shape, { english: english, words: words });
    }
  }

  return { language: data.language, pieces: pieces };
}

/*
 * One piece in the language: its words with the drawn piece's code and
 * links, or undefined when the language has none for it.
 */
export function translateSetupGuidePiece(
  piece: string,
  words: SetupGuideWords,
): string | undefined {
  const found: SetupGuidePieceWords | undefined = words.pieces.get(
    getSetupGuidePieceShape(piece),
  );

  if (!found) {
    return undefined;
  }

  const withCode: string = withDrawnSpans({
    words: found.words,
    english: found.english,
    drawn: piece,
    pattern: CODE_SPAN,
  });

  return withDrawnSpans({
    words: withCode,
    english: found.english,
    drawn: piece,
    pattern: LINK_TARGET,
  });
}

/*
 * A guide's markdown in the language: each piece it has words for in
 * them, every other piece as it is, the code as it is written; and set as
 * the language sets a line (French's marks with their words).
 */
export function translateSetupGuideMarkdown(
  markdown: string,
  words: SetupGuideWords,
): string {
  /*
   * French writes a space before » ? ! : and ; and after «, where a line
   * could break: drawn as French's no-break ones, as the Translator draws
   * every French wording and the Documentation pages draw theirs (#8032).
   * Only words: code is left as it is written, a block and a span.
   */
  const setsApart: boolean = setsPunctuationApart(words.language);

  return getSetupGuidePieces(markdown)
    .map((piece: SetupGuidePiece): string => {
      if (!piece.isWords) {
        return piece.text;
      }
      const text: string =
        translateSetupGuidePiece(piece.text, words) ?? piece.text;
      return setsApart ? withFrenchSpacing(text) : text;
    })
    .join("\n");
}

/*
 * The guide in the language: its markdown - the intro, Before you start,
 * every step's body, tab and details, every topic - in the language's
 * words, and the guide said to be in that language, so the card lays every
 * block out its way. Titles, descriptions and notes are keys the card
 * words itself, and stay as the guide gives them.
 */
export function translateSetupGuideContent(
  content: SetupGuideContent,
  words: SetupGuideWords,
): SetupGuideContent {
  const inLanguage: (markdown: string) => string = (
    markdown: string,
  ): string => {
    return translateSetupGuideMarkdown(markdown, words);
  };

  const topicInLanguage: (topic: SetupGuideTopic) => SetupGuideTopic = (
    topic: SetupGuideTopic,
  ): SetupGuideTopic => {
    return { ...topic, markdown: inLanguage(topic.markdown) };
  };

  return {
    ...content,
    language: words.language,
    intro: content.intro ? inLanguage(content.intro) : content.intro,
    prerequisites: content.prerequisites?.map(inLanguage),
    steps: content.steps.map((step: SetupGuideStep): SetupGuideStep => {
      return {
        ...step,
        markdown: step.markdown ? inLanguage(step.markdown) : step.markdown,
        variants: step.variants?.map(
          (variant: SetupGuideStepVariant): SetupGuideStepVariant => {
            return { ...variant, markdown: inLanguage(variant.markdown) };
          },
        ),
        details: step.details ? inLanguage(step.details) : step.details,
      };
    }),
    advanced: content.advanced?.map(topicInLanguage),
    troubleshooting: content.troubleshooting?.map(topicInLanguage),
  };
}

/*
 * Every piece of a guide's markdown that has words in it, in reading
 * order: what a language's words for the guide are written for.
 */
export function getSetupGuideWordPieces(
  content: SetupGuideContent,
): Array<string> {
  const markdowns: Array<string> = [
    content.intro || "",
    ...(content.prerequisites || []),
  ];

  for (const step of content.steps) {
    markdowns.push(step.markdown || "");
    for (const variant of step.variants || []) {
      markdowns.push(variant.markdown);
    }
    markdowns.push(step.details || "");
  }

  for (const topic of [
    ...(content.advanced || []),
    ...(content.troubleshooting || []),
  ]) {
    markdowns.push(topic.markdown);
  }

  return markdowns.flatMap((markdown: string): Array<string> => {
    return getSetupGuidePieces(markdown)
      .filter((piece: SetupGuidePiece): boolean => {
        return piece.isWords;
      })
      .map((piece: SetupGuidePiece): string => {
        return piece.text;
      });
  });
}
