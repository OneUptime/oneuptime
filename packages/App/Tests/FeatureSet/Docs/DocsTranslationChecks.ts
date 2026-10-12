import { DocsLanguageDirection } from "../../../FeatureSet/Docs/Utils/I18n";
import DocsPlaceholders from "../../../FeatureSet/Docs/Utils/Placeholders";
import DocsRender from "../../../FeatureSet/Docs/Utils/Render";
import {
  DocsFence,
  DocsLink,
  DocsPageLink,
  ScannedPage,
  anchorsOf,
  hasPage,
  parseDocsLink,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import { stripHtmlTags } from "./DocsHtmlText";
import fs from "fs";
import path from "path";

/*
 * What a translated docs page must keep of its English page, as functions
 * the per-group translation suites share (IncidentDocsTranslations,
 * OnCallDocsTranslations): the code exactly, the diagrams by how they are
 * built, the inline code, the shape of the tables and lists, the cards,
 * links that land on a heading of the page they open, and no emphasis
 * marker left on the page as the reader sees it (strayMarkers). Two more
 * read how wide a diagram's labels draw (diagramLabelLines,
 * labelLineWidth), so a suite can hold a diagram that fills the 590px docs
 * column to the label lines measured to fit it, and one escapes text for a
 * pattern built from it (escapeRegExp). The last read which way the lines
 * of a diagram read (drawnDiagramLines, drawnOrder, linesLaidOutBackwards):
 * every page is held to them by DiagramReadingDirection.
 *
 * Each is a plain function of the Markdown, so the suites can also show that
 * it catches the break it is there for. Suites import these rather than
 * copy them: DocsTagStripGuard fails on a suite that writes its own
 * strayMarkers, or takes tags out of HTML any way but stripHtmlTags
 * (DocsHtmlText), and DocsCodeScanningGuard on one that escapes text for a
 * pattern itself or writes its own class of wide characters.
 */

const BOLD: RegExp = /\*\*([^*\n]+?)\*\*/g;
const INLINE_CODE: RegExp = /`([^`\n]+)`/g;
const LIST_ITEM: RegExp = /^\s*(?:[-*]|\d+\.)\s/;
const CARDS_OPEN: RegExp = /^:::\s*cards\s*$/;
const CONTAINER_CLOSE: RegExp = /^:::\s*$/;
// A diagram's title, which a translation translates.
const DIAGRAM_TITLE: RegExp = /\btitle="[^"]+"/;
const PERSIAN_DIGITS: string = "۰۱۲۳۴۵۶۷۸۹";

/*
 * The text with Persian digits written as Latin ones. A number the code
 * defines is then found on a page that writes numbers as its language does:
 * the Persian Dashboard draws "30 minutes" as "۳۰ دقیقه".
 */
export function toLatinDigits(text: string): string {
  return text.replace(/[۰-۹]/g, (digit: string): string => {
    return String(PERSIAN_DIGITS.indexOf(digit));
  });
}

// Every character a pattern reads as syntax outside a character class.
const PATTERN_SYNTAX: RegExp = /[.*+?^${}()|[\]\\]/g;

/*
 * Text as a pattern that matches that text and nothing else, for a regular
 * expression built from text, as in new RegExp(`^${escapeRegExp(label)}:`).
 * Each of \ ^ $ . * + ? ( ) [ ] { } | gets a backslash. Escaping only some
 * of them - the dots of "props.showIncidentsOnStatusPage" - leaves a
 * backslash or a bracket in the text free to change the pattern, which code
 * scanning reports as incomplete sanitization (js/incomplete-sanitization,
 * #2215). The text goes outside a character class: a "-" is left as it is.
 */
export function escapeRegExp(text: string): string {
  return text.replace(PATTERN_SYNTAX, "\\$&");
}

// A card's line: its link, then an ASCII ": " and the description.
export const CARD_LINE: RegExp = /^- \[[^\]]+\]\([^)\s]+\): \S/;

// A card's target: the page it opens, without its anchor.
export const CARD_TARGET: RegExp = /\]\(([^)#]*)/;

// The page without its fenced code blocks.
export function prose(markdown: string): string {
  return markdown.replace(/^ {0,3}```[\s\S]*?^ {0,3}```[^\n]*$/gm, "");
}

// Every bold span, once each, in order.
export function boldSpans(markdown: string): Array<string> {
  const spans: Array<string> = [];

  for (const match of Array.from(markdown.matchAll(BOLD))) {
    const span: string = (match[1] as string).trim();

    if (!spans.includes(span)) {
      spans.push(span);
    }
  }

  return spans;
}

// Every inline code span outside the code blocks, sorted: a multiset.
export function inlineCode(markdown: string): Array<string> {
  return Array.from(prose(markdown).matchAll(INLINE_CODE))
    .map((match: RegExpMatchArray): string => {
      return match[1] as string;
    })
    .sort();
}

// What a diagram says, as opposed to how it is built: labels and message text.
const DIAGRAM_QUOTED_LABEL: RegExp = /"[^"\n]*"/g;
const DIAGRAM_EDGE_LABEL: RegExp = /\|[^|\n]*\|/g;
// A participant's or an actor's display name: "actor U as Person".
const DIAGRAM_PARTICIPANT_ALIAS: RegExp =
  /^(\s*(?:participant|actor)\s+\S+)\s+as\s+.*$/;
const DIAGRAM_MESSAGE_TEXT: RegExp = /:.*$/;
/*
 * A sequence diagram's block and its label: "loop Every 10 seconds",
 * "alt The step failed". The label is words, like a message's text; the
 * block is how the diagram is built.
 */
const DIAGRAM_BLOCK_LABEL: RegExp =
  /^(\s*(?:loop|alt|else|opt|par|and|critical|break))(?:\s.*)?$/;

/*
 * A Mermaid diagram with its words taken out: node ids, shapes, arrows and
 * the order of its lines. A translation translates a diagram's labels, so a
 * diagram is compared by this; every other code block must be the English
 * one exactly.
 */
export function diagramSkeleton(code: string): string {
  const isSequence: boolean = code.trimStart().startsWith("sequenceDiagram");

  return code
    .split("\n")
    .map((line: string): string => {
      const built: string = isSequence
        ? line.replace(DIAGRAM_BLOCK_LABEL, "$1")
        : line;

      return built
        .replace(DIAGRAM_QUOTED_LABEL, '""')
        .replace(DIAGRAM_EDGE_LABEL, "||")
        .replace(DIAGRAM_PARTICIPANT_ALIAS, "$1")
        .replace(DIAGRAM_MESSAGE_TEXT, ":")
        .trimEnd();
    })
    .join("\n");
}

const LABEL_BREAK: string = "<br/>";
// A label in a flowchart: a node's text or a link's.
const DIAGRAM_LABEL: RegExp = /"([^"]*)"/g;
// A sequence diagram's participant and the name it is drawn under.
const SEQUENCE_PARTICIPANT_NAME: RegExp =
  /^\s*(?:participant|actor)\s+\S+\s+as\s+(.*)$/;
// A sequence diagram's message ("P->>O: text") or note ("Note over P: text").
const SEQUENCE_TEXT: RegExp =
  /^\s*(?:Note\s[^:]*|[^\s:]*-[-x)>]*[^\s:]*):(.*)$/;

/*
 * A character drawn about twice as wide as a Latin letter: a letter of the
 * Chinese, Japanese or Korean scripts (Han, Hiragana, Katakana, Hangul,
 * Bopomofo), or any character of the blocks their punctuation and symbols
 * are filed under, most of them in the Common script: Ideographic
 * Description Characters, CJK Symbols and Punctuation, the Hiragana and
 * Katakana blocks (their sound marks, middle dot and long vowel mark),
 * Kanbun, CJK Strokes, Enclosed CJK Letters and Months, CJK Compatibility,
 * and Halfwidth and Fullwidth Forms. Anything else counts once, an emoji
 * too.
 *
 * Scripts by name, and blocks by their exact bounds written as escapes.
 * Ranges typed as the characters themselves spanned blocks of other
 * scripts - Yijing hexagrams, Yi, Vai, the private use area (code scanning
 * #2216, #2217) - and the first CJK compatibility ideograph, typed to start
 * one, had become its canonical twin in CJK Unified Ideographs (U+8C48 for
 * U+F900). Every character the docs' diagrams draw, in every language,
 * counts as the 590px measurements counted it (DocsLabelWidth).
 */
const WIDE_CHARACTER: RegExp =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}\u{2FF0}-\u{2FFF}\u{3000}-\u{303F}\u{3040}-\u{309F}\u{30A0}-\u{30FF}\u{3190}-\u{319F}\u{31C0}-\u{31EF}\u{3200}-\u{32FF}\u{3300}-\u{33FF}\u{FF00}-\u{FFEF}]/u;

/*
 * Every line of every label a diagram draws, as the diagram breaks them
 * (<br/>): a flowchart's node and link labels; a sequence diagram's
 * participant names, messages and notes.
 */
export function diagramLabelLines(code: string): Array<string> {
  const labels: Array<string> = [];

  if (code.trimStart().startsWith("sequenceDiagram")) {
    for (const line of code.split("\n")) {
      const label: string | undefined =
        line.match(SEQUENCE_PARTICIPANT_NAME)?.[1] ||
        line.match(SEQUENCE_TEXT)?.[1];

      if (label !== undefined) {
        labels.push(label.trim());
      }
    }
  } else {
    for (const match of Array.from(code.matchAll(DIAGRAM_LABEL))) {
      labels.push(match[1] as string);
    }
  }

  return labels.flatMap((label: string): Array<string> => {
    return label.split(LABEL_BREAK);
  });
}

/*
 * How wide a line of a diagram's label draws, in Latin letters: a Chinese,
 * Japanese or Korean character counts twice (WIDE_CHARACTER).
 */
export function labelLineWidth(line: string): number {
  return Array.from(line).reduce((width: number, character: string): number => {
    return width + (WIDE_CHARACTER.test(character) ? 2 : 1);
  }, 0);
}

// A code block as a translation must keep it: code exactly, a diagram by its build.
export function comparableFence(fence: DocsFence): string {
  if (fence.lang === "mermaid") {
    // The title is translated; that there is one is not.
    const titled: boolean = DIAGRAM_TITLE.test(fence.info);

    return `mermaid titled=${titled}\n${diagramSkeleton(fence.code)}`;
  }

  return `${fence.info}\n${fence.code}`;
}

// The number of body rows of each table, in order.
export function tableShape(markdown: string): Array<number> {
  const shape: Array<number> = [];
  let rows: number = 0;

  for (const line of prose(markdown).split("\n")) {
    if (line.startsWith("|")) {
      rows++;
      continue;
    }

    if (rows > 0) {
      // Minus the header and the delimiter row.
      shape.push(rows - 2);
      rows = 0;
    }
  }

  if (rows > 0) {
    shape.push(rows - 2);
  }

  return shape;
}

export function listItemCount(markdown: string): number {
  return prose(markdown)
    .split("\n")
    .filter((line: string): boolean => {
      return LIST_ITEM.test(line);
    }).length;
}

// The lines of every :::cards block.
export function cardLines(markdown: string): Array<string> {
  const lines: Array<string> = [];
  let inCards: boolean = false;

  for (const line of markdown.split("\n")) {
    if (CARDS_OPEN.test(line)) {
      inCards = true;
      continue;
    }

    if (inCards && CONTAINER_CLOSE.test(line)) {
      inCards = false;
      continue;
    }

    if (inCards && line.trim()) {
      lines.push(line);
    }
  }

  return lines;
}

// The pages a set of card lines opens, in order.
export function cardTargets(lines: Array<string>): Array<string> {
  return lines.map((line: string): string => {
    return (CARD_TARGET.exec(line)?.[1] as string) || "";
  });
}

// A docs nav link's title in a language, as the docs' locale files name it.
export function navTitle(language: string, englishTitle: string): string {
  const locale: { navLinks: Record<string, string> } = JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../FeatureSet/Docs/Locales",
        `${language}.json`,
      ),
      "utf8",
    ),
  ) as { navLinks: Record<string, string> };

  return locale.navLinks[englishTitle] as string;
}

/*
 * Where a link's #anchor must be a heading: the page it opens, in this
 * language when the language has the page, else the English page the docs
 * serve instead.
 */
export function anchorProblems(language: string, page: string): Array<string> {
  const scanned: ScannedPage = scanMarkdown(readPage(language, page));
  const problems: Array<string> = [];

  for (const link of scanned.links) {
    const docsLink: DocsLink = link;
    let target: DocsPageLink | null = null;

    if (docsLink.target.startsWith("#")) {
      target = { page: page, anchor: docsLink.target.slice(1) };
    } else {
      target = parseDocsLink(docsLink.target);
    }

    if (!target || target.anchor === null || target.anchor === "") {
      continue;
    }

    const served: string = hasPage(language, target.page) ? language : "en";
    const anchor: string = decodeURIComponent(target.anchor);

    if (!anchorsOf(served, target.page).has(anchor)) {
      problems.push(`${page}:${docsLink.line} -> ${docsLink.target}`);
    }
  }

  return problems;
}

/*
 * What Markdown never reads, in rendered HTML: code samples, inline code and
 * a diagram's source (its caption is text, and stays). An underscore there
 * is code or a diagram's words ("con_name" in a node), not emphasis.
 */
const NOT_MARKDOWN: RegExp =
  /<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>|<div class="mermaid">[\s\S]*?<\/div>/g;

/*
 * A name written with underscores outside code, as a metric is in a details
 * title ("pve_network_receive_bytes"): CommonMark never reads an underscore
 * between two letters or digits as emphasis, so it is the name, not a
 * marker left over.
 */
const UNDERSCORED_NAME: RegExp = /[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+/g;

/*
 * A page as the docs route draws it, without its title line, and the
 * emphasis markers left in its text: a bold or italic span CommonMark did
 * not close. A bold span that ends in punctuation and runs straight into a
 * letter, as in "**リクエストタイムアウト（秒）**を", is not closed, and its
 * asterisks show. An underscore never closes inside a word, so "_之后_的"
 * shows both underscores.
 *
 * What it returns are the lines of the drawn page, as text, that show "**"
 * or an underscore (the renderer draws a run of paragraphs on one line); a
 * page that draws every span it opens returns none. Code and diagram source
 * are left out first, then the tags (stripHtmlTags), so an underscore in an
 * attribute - a link's address, an image's file name - is no marker either.
 */
export async function strayMarkers(
  markdown: string,
  language: string,
): Promise<Array<string>> {
  const html: string = await DocsRender.render(
    DocsPlaceholders.render(markdown.split("\n").slice(1).join("\n"), language),
  );

  return stripHtmlTags(html.replace(NOT_MARKDOWN, ""))
    .split("\n")
    .filter((line: string): boolean => {
      return (
        line.includes("**") || line.replace(UNDERSCORED_NAME, "").includes("_")
      );
    });
}

/*
 * ---------------------------------------------------------------------------
 * Which way the lines of a diagram read.
 * ---------------------------------------------------------------------------
 *
 * The docs lay out each line a diagram draws the way its page reads
 * (style.css, held by RightToLeftDocsLayout). On a left-to-right page a line
 * of a label, and the caption, take the direction of their first letter
 * (unicode-bidi: plaintext), so "Rule 1:" keeps its colon at its end, and a
 * sequence diagram's text is left to right. On a right-to-left page every
 * line reads right to left, as the page's paragraphs do, whatever word it
 * starts with: a Persian line that opens with a Latin word ("OneUptime
 * حساب", the OneUptime account) still reads from its first word. Laid out
 * by its first letter, that line was laid out left to right and read back
 * to front (#4694 found 88 such lines on 51 Persian pages).
 *
 * A line is meant to read in the direction of its script: right to left
 * when it holds a right-to-left character, left to right when it does not.
 * drawnOrder lays a line out as the Unicode Bidirectional Algorithm (UAX
 * #9) does, for the one paragraph a line is, and linesLaidOutBackwards
 * finds the lines a page lays out in an order other than the one they are
 * meant to read in: on a right-to-left page, a line of Latin words only
 * that starts or ends with punctuation or a number ("Rule 1:", "200 OK",
 * "~/.codex/config.toml"), whose punctuation a right-to-left line draws on
 * its other side; on a left-to-right page, a line that holds right-to-left
 * words but opens with a Latin one.
 */

// A letter or mark of a script written right to left: Persian's (Arabic), Hebrew.
const RIGHT_TO_LEFT_CHARACTER: RegExp =
  /[\p{Script_Extensions=Arabic}\p{Script_Extensions=Hebrew}\u{200F}]/u;

/*
 * Each character's bidirectional type (UAX #9, Bidi_Class), read for the
 * scripts and punctuation the docs write: a type a later pattern would also
 * match is tested first. What none of them matches is an other neutral (ON):
 * punctuation, symbols, arrows.
 */
// Explicit embeddings, overrides and isolates, which drawnOrder does not lay out.
const BIDI_FORMATTING: RegExp = /[\u{202A}-\u{202E}\u{2066}-\u{2069}]/u;
// Removed before a line is laid out (X9): zero-width joiners and the like.
const BOUNDARY_NEUTRAL: RegExp =
  /[\u{AD}\u{180E}\u{200B}-\u{200D}\u{2060}-\u{2064}\u{FEFF}]/u;
const WHITESPACE: RegExp =
  /[\t\f \u{1680}\u{2000}-\u{200A}\u{2028}\u{205F}\u{3000}]/u;
// Latin and Persian digits, superscript, subscript and fullwidth ones.
const EUROPEAN_NUMBER: RegExp =
  /[0-9\u{B2}\u{B3}\u{B9}\u{6F0}-\u{6F9}\u{2070}\u{2074}-\u{2079}\u{2080}-\u{2089}\u{FF10}-\u{FF19}]/u;
// Arabic-Indic digits and the Arabic decimal and thousands separators.
const ARABIC_NUMBER: RegExp =
  /[\u{600}-\u{605}\u{660}-\u{669}\u{66B}\u{66C}\u{6DD}\u{8E2}]/u;
const EUROPEAN_SEPARATOR: RegExp =
  /[+\-\u{207A}\u{207B}\u{208A}\u{208B}\u{2212}\u{FB29}\u{FE62}\u{FE63}\u{FF0B}\u{FF0D}]/u;
// Signs written with a number: #, $, %, degrees, currencies, per mille.
const EUROPEAN_TERMINATOR: RegExp =
  /[#$%\u{A2}-\u{A5}\u{B0}\u{B1}\u{609}\u{60A}\u{66A}\u{2030}-\u{2034}\u{20A0}-\u{20CF}\u{212E}\u{2213}\u{FE5F}\u{FE69}\u{FE6A}\u{FF03}-\u{FF05}\u{FFE0}\u{FFE1}\u{FFE5}\u{FFE6}]/u;
// What separates the parts of a number: , . / : and the Arabic comma.
const COMMON_SEPARATOR: RegExp =
  /[,./:\u{A0}\u{60C}\u{202F}\u{2044}\u{FE50}\u{FE52}\u{FE55}\u{FF0C}\u{FF0E}\u{FF0F}\u{FF1A}]/u;
const NONSPACING_MARK: RegExp = /[\p{Mn}\p{Me}]/u;
// The letters of the Arabic script, Persian's, and its question mark.
const ARABIC_LETTER: RegExp = /\p{Script_Extensions=Arabic}/u;
// Hebrew, and the right-to-left mark.
const RIGHT_TO_LEFT_LETTER: RegExp = /[\p{Script_Extensions=Hebrew}\u{200F}]/u;
// Every other letter, and digits of other scripts: Latin, Cyrillic, CJK, Devanagari.
const LEFT_TO_RIGHT_LETTER: RegExp = /[\p{L}\p{Mc}\p{Nl}\p{Nd}\u{200E}]/u;
// The left-to-right, right-to-left and Arabic letter marks: they order a line, and are never drawn.
const DIRECTION_MARK: RegExp = /[\u{200E}\u{200F}\u{61C}]/u;

type BidiType =
  | "L"
  | "R"
  | "AL"
  | "EN"
  | "ES"
  | "ET"
  | "AN"
  | "CS"
  | "NSM"
  | "BN"
  | "WS"
  | "ON"
  | "FORMATTING";

function bidiTypeOf(character: string): BidiType {
  const tests: Array<[RegExp, BidiType]> = [
    [BIDI_FORMATTING, "FORMATTING"],
    [BOUNDARY_NEUTRAL, "BN"],
    [WHITESPACE, "WS"],
    [EUROPEAN_NUMBER, "EN"],
    [ARABIC_NUMBER, "AN"],
    [EUROPEAN_SEPARATOR, "ES"],
    [EUROPEAN_TERMINATOR, "ET"],
    [COMMON_SEPARATOR, "CS"],
    [NONSPACING_MARK, "NSM"],
    [ARABIC_LETTER, "AL"],
    [RIGHT_TO_LEFT_LETTER, "R"],
    [LEFT_TO_RIGHT_LETTER, "L"],
  ];

  for (const [pattern, type] of tests) {
    if (pattern.test(character)) {
      return type;
    }
  }

  return "ON";
}

// Bracket pairs (BidiBrackets.txt) the docs write, each opening one first.
const BRACKET_PAIRS: ReadonlyArray<string> = [
  "()",
  "[]",
  "{}",
  "\u{27E8}\u{27E9}",
  "\u{3008}\u{3009}",
  "\u{300A}\u{300B}",
  "\u{300C}\u{300D}",
  "\u{300E}\u{300F}",
  "\u{3010}\u{3011}",
  "\u{3014}\u{3015}",
  "\u{FF08}\u{FF09}",
  "\u{FF3B}\u{FF3D}",
  "\u{FF5B}\u{FF5D}",
];

// Characters drawn as their mirror image in a right-to-left run (Bidi_Mirrored).
const MIRRORED_PAIRS: ReadonlyArray<string> = [
  ...BRACKET_PAIRS,
  "<>",
  "\u{AB}\u{BB}",
  "\u{2039}\u{203A}",
  "\u{2264}\u{2265}",
];

function mirrorOf(character: string): string {
  for (const pair of MIRRORED_PAIRS) {
    const [first, second] = Array.from(pair) as [string, string];

    if (character === first) {
      return second;
    }

    if (character === second) {
      return first;
    }
  }

  return character;
}

// The strong direction a type counts as: numbers count as right to left (N0, N1).
function strongDirectionOf(type: BidiType): "L" | "R" | null {
  if (type === "L") {
    return "L";
  }

  if (type === "R" || type === "AL" || type === "EN" || type === "AN") {
    return "R";
  }

  return null;
}

// The pairs of brackets of a line (BD16), as their positions, in the order they open.
function bracketPairsOf(
  characters: Array<string>,
  types: Array<BidiType>,
): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  const open: Array<{ closing: string; at: number }> = [];

  for (let at: number = 0; at < characters.length; at++) {
    if (types[at] !== "ON") {
      continue;
    }

    const character: string = characters[at] as string;
    const opening: string | undefined = BRACKET_PAIRS.find(
      (pair: string): boolean => {
        return Array.from(pair)[0] === character;
      },
    );

    if (opening !== undefined) {
      if (open.length === 63) {
        break;
      }

      open.push({ closing: Array.from(opening)[1] as string, at: at });
      continue;
    }

    for (let depth: number = open.length - 1; depth >= 0; depth--) {
      if (open[depth]?.closing === character) {
        pairs.push([open[depth]?.at as number, at]);
        open.length = depth;
        break;
      }
    }
  }

  return pairs.sort((a: [number, number], b: [number, number]): number => {
    return a[0] - b[0];
  });
}

/*
 * A line as it is drawn, read from left to right, when it is laid out as a
 * paragraph of its own in this direction: the Unicode Bidirectional
 * Algorithm's rules for one paragraph with no explicit embeddings - W1-W7,
 * N0-N2, I1-I2, L1, L2 and L4 - with each character drawn mirrored where a
 * right-to-left run draws it so ("(" as ")"), and the direction marks,
 * which are never drawn, left out. Null for a line holding an explicit
 * embedding, override or isolate, which no diagram should need.
 */
export function drawnOrder(
  line: string,
  direction: DocsLanguageDirection,
): string | null {
  const characters: Array<string> = Array.from(line).filter(
    (character: string): boolean => {
      return bidiTypeOf(character) !== "BN";
    },
  );
  const original: Array<BidiType> = characters.map(bidiTypeOf);

  if (original.includes("FORMATTING")) {
    return null;
  }

  const count: number = characters.length;
  const paragraphLevel: number = direction === "rtl" ? 1 : 0;
  // The embedding direction, and the type before and after the line (sos, eos).
  const embedding: "L" | "R" = direction === "rtl" ? "R" : "L";
  const types: Array<BidiType> = [...original];

  // W1: a mark takes the type of what it is on.
  for (let at: number = 0; at < count; at++) {
    if (types[at] === "NSM") {
      types[at] = at === 0 ? embedding : (types[at - 1] as BidiType);
    }
  }

  // W2: a European number after an Arabic letter is an Arabic number.
  let lastStrong: BidiType = embedding;

  for (let at: number = 0; at < count; at++) {
    const type: BidiType = types[at] as BidiType;

    if (type === "L" || type === "R" || type === "AL") {
      lastStrong = type;
    } else if (type === "EN" && lastStrong === "AL") {
      types[at] = "AN";
    }
  }

  // W3: an Arabic letter is right to left.
  for (let at: number = 0; at < count; at++) {
    if (types[at] === "AL") {
      types[at] = "R";
    }
  }

  // W4: one separator between two numbers of a kind joins them.
  for (let at: number = 1; at < count - 1; at++) {
    const before: BidiType = types[at - 1] as BidiType;
    const after: BidiType = types[at + 1] as BidiType;

    if (types[at] === "ES" && before === "EN" && after === "EN") {
      types[at] = "EN";
    } else if (
      types[at] === "CS" &&
      before === after &&
      (before === "EN" || before === "AN")
    ) {
      types[at] = before;
    }
  }

  // W5: terminators next to a European number are part of it.
  for (let at: number = 0; at < count; at++) {
    if (types[at] !== "ET") {
      continue;
    }

    let end: number = at;

    while (end < count && types[end] === "ET") {
      end++;
    }

    if ((at > 0 && types[at - 1] === "EN") || types[end] === "EN") {
      for (let inRun: number = at; inRun < end; inRun++) {
        types[inRun] = "EN";
      }
    }

    at = end - 1;
  }

  // W6: what is left of the separators and terminators is neutral.
  for (let at: number = 0; at < count; at++) {
    const type: BidiType = types[at] as BidiType;

    if (type === "ES" || type === "ET" || type === "CS") {
      types[at] = "ON";
    }
  }

  // W7: a European number after left-to-right text is left to right.
  let previousStrong: BidiType = embedding;

  for (let at: number = 0; at < count; at++) {
    const type: BidiType = types[at] as BidiType;

    if (type === "L" || type === "R") {
      previousStrong = type;
    } else if (type === "EN" && previousStrong === "L") {
      types[at] = "L";
    }
  }

  // N0: a pair of brackets takes the direction of what it holds, or of what is before it.
  for (const [opening, closing] of bracketPairsOf(characters, types)) {
    let holdsEmbedding: boolean = false;
    let holdsOpposite: boolean = false;

    for (let at: number = opening + 1; at < closing; at++) {
      const strong: "L" | "R" | null = strongDirectionOf(types[at] as BidiType);

      if (strong === embedding) {
        holdsEmbedding = true;
      } else if (strong !== null) {
        holdsOpposite = true;
      }
    }

    if (!holdsEmbedding && !holdsOpposite) {
      continue;
    }

    let resolved: "L" | "R" = embedding;

    if (!holdsEmbedding) {
      let context: "L" | "R" = embedding;

      for (let at: number = opening - 1; at >= 0; at--) {
        const strong: "L" | "R" | null = strongDirectionOf(
          types[at] as BidiType,
        );

        if (strong !== null) {
          context = strong;
          break;
        }
      }

      resolved = context;
    }

    for (const bracket of [opening, closing]) {
      types[bracket] = resolved;

      for (
        let mark: number = bracket + 1;
        mark < count && original[mark] === "NSM";
        mark++
      ) {
        types[mark] = resolved;
      }
    }
  }

  // N1, N2: a run of neutrals between two of a direction takes it; else the embedding's.
  for (let at: number = 0; at < count; at++) {
    if (types[at] !== "ON" && types[at] !== "WS") {
      continue;
    }

    let end: number = at;

    while (end < count && (types[end] === "ON" || types[end] === "WS")) {
      end++;
    }

    const before: "L" | "R" =
      at === 0
        ? embedding
        : (strongDirectionOf(types[at - 1] as BidiType) as "L" | "R");
    const after: "L" | "R" =
      end === count
        ? embedding
        : (strongDirectionOf(types[end] as BidiType) as "L" | "R");
    const resolved: "L" | "R" = before === after ? before : embedding;

    for (let inRun: number = at; inRun < end; inRun++) {
      types[inRun] = resolved;
    }

    at = end - 1;
  }

  // I1, I2: each character's level.
  const levels: Array<number> = types.map((type: BidiType): number => {
    if (paragraphLevel === 0) {
      return type === "R" ? 1 : type === "EN" || type === "AN" ? 2 : 0;
    }

    return type === "L" || type === "EN" || type === "AN" ? 2 : 1;
  });

  // L1: whitespace at the end of the line is at the paragraph's level.
  for (let at: number = count - 1; at >= 0 && original[at] === "WS"; at--) {
    levels[at] = paragraphLevel;
  }

  // L2: reverse every run at each level, from the highest down to the lowest odd one.
  const order: Array<number> = characters.map(
    (_character: string, at: number): number => {
      return at;
    },
  );
  const highest: number = Math.max(paragraphLevel, ...levels);
  const lowest: number = Math.min(paragraphLevel, ...levels);
  const lowestOdd: number = lowest % 2 === 1 ? lowest : lowest + 1;

  for (let level: number = highest; level >= lowestOdd; level--) {
    for (let at: number = 0; at < count; at++) {
      if ((levels[order[at] as number] as number) < level) {
        continue;
      }

      let end: number = at;

      while (end < count && (levels[order[end] as number] as number) >= level) {
        end++;
      }

      order.splice(at, end - at, ...order.slice(at, end).reverse());
      at = end - 1;
    }
  }

  // L4: a mirrored character in a right-to-left run is drawn as its mirror image.
  return order
    .filter((at: number): boolean => {
      return !DIRECTION_MARK.test(characters[at] as string);
    })
    .map((at: number): string => {
      const character: string = characters[at] as string;

      return (levels[at] as number) % 2 === 1 ? mirrorOf(character) : character;
    })
    .join("");
}

/*
 * The direction of a line's first letter (rules P2 and P3), as
 * unicode-bidi: plaintext lays the line out; null when it has none.
 */
export function firstLetterDirection(
  line: string,
): DocsLanguageDirection | null {
  for (const character of Array.from(line)) {
    const type: BidiType = bidiTypeOf(character);

    if (type === "L") {
      return "ltr";
    }

    if (type === "R" || type === "AL") {
      return "rtl";
    }
  }

  return null;
}

// The direction a line is meant to read in: right to left when it holds a right-to-left character.
export function meantDirection(line: string): DocsLanguageDirection {
  return RIGHT_TO_LEFT_CHARACTER.test(line) ? "rtl" : "ltr";
}

export interface DrawnDiagramLine {
  text: string;
  /*
   * Drawn as SVG text, as a sequence diagram's names, messages and notes
   * are, rather than as an HTML label or the caption.
   */
  svg: boolean;
}

const BREAK_TAG: RegExp = /<br\s*\/?>/gi;
const SPACE_RUN: RegExp = /\s+/g;
// A diagram's title, which the docs draw as its caption.
const DIAGRAM_TITLE_TEXT: RegExp = /\btitle=(?:"([^"]*)"|'([^']*)')/;
const QUOTED_TEXT: RegExp = /"([^"]*)"/g;
const QUOTED_PLACEHOLDER: string = '""';
// A comment, in any kind of diagram.
const COMMENT_LINE: RegExp = /^\s*%%/;
// What a flowchart line declares but never draws.
const FLOWCHART_DIRECTIVE: RegExp =
  /^\s*(?:flowchart|graph|classDef|class|style|linkStyle|click|direction|end)\b/;
// A link's label written between bars: -->|label|.
const BARRED_LINK_TEXT: RegExp = /\|([^|]*)\|/g;
/*
 * A link's label written inside the link: -- label -->, == label ==>,
 * -. label .->. The link it opens is not the end of a longer one, so the
 * node between two open links (A --- B --- C) is never read as a label.
 */
const INLINE_LINK_TEXT: RegExp =
  /(?<![-=.])(?:--|==|-\.)\s+([^\s"-][^"]*?)\s+(?:-->|---|==>|===|\.->|\.-)/g;
/*
 * A node's label written without quotes, in any of the shapes a flowchart
 * draws, after its id: an id starts and ends with a letter or digit, so the
 * ">" of an arrow ("-->") is never read as the asymmetric shape (id>label]).
 */
const UNQUOTED_NODE_TEXT: RegExp =
  /(?<![\w-])\w(?:[\w-]*\w)?\s*(?:\(\(\(([^)]*)\)\)\)|\(\[([^\]]*)\]\)|\[\[([^\]]*)\]\]|\[\(([^)]*)\)\]|\(\(([^)]*)\)\)|\{\{([^}]*)\}\}|\[\/([^\]]*)[/\\]\]|\[\\([^\]]*)[/\\]\]|>([^\]]*)\]|\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\})/g;
const SEQUENCE_PARTICIPANT: RegExp =
  /^\s*(?:participant|actor)\s+(\S+)(?:\s+as\s+(.+))?$/;
// A message, its two ends and its text: "Twilio->>OneUptime: POST /voice".
const SEQUENCE_MESSAGE: RegExp =
  /^\s*([^\s:<>+-][^\s:<>]*?)\s*(?:<<)?-{1,2}(?:>>|>|x|\))?\s*[+-]?\s*([^\s:<>+-][^\s:<>]*?)\s*:(.*)$/;
const SEQUENCE_NOTE: RegExp =
  /^\s*note\s+(?:left of|right of|over)\s+[^:]+:(.*)$/i;
/*
 * A block's label: "loop Every 10 seconds", "alt The step failed". mermaid
 * draws it in brackets, "[Every 10 seconds]", wrapped to the block's width.
 */
const SEQUENCE_BLOCK_TEXT: RegExp =
  /^\s*(?:loop|alt|else|opt|par|and|critical|option|break)\b(.*)$/;
// A state's description: state "Reporting" as Reporting, or Reporting : Reporting.
const STATE_DESCRIPTION: RegExp = /^\s*([\w-]+)\s*:(.*)$/;
// A transition, its two ends and its label: "Reporting --> Archived: 7 days".
const STATE_TRANSITION: RegExp =
  /^\s*(\[\*\]|[^\s:[\]-][^\s:]*?)\s*-->\s*(\[\*\]|[^\s:[\]-][^\s:]*?)\s*(?::(.*))?$/;
const STATE_DECLARATION: RegExp = /^\s*state\s+""\s+as\s+([\w-]+)/;
const STATE_NOTE: RegExp = /^\s*note\s+(?:left|right)\s+of\s+[^:]+:(.*)$/i;

// A diagram's lines after the one naming its kind, its comments left out.
function statementsOf(code: string): Array<string> {
  return code
    .split("\n")
    .slice(1)
    .filter((line: string): boolean => {
      return !COMMENT_LINE.test(line);
    });
}

// The lines of a label as it draws them: broken at each <br/>, with its spaces collapsed.
function labelLines(label: string): Array<string> {
  return label
    .split(BREAK_TAG)
    .map((line: string): string => {
      return line.replace(SPACE_RUN, " ").trim();
    })
    .filter((line: string): boolean => {
      return line.length > 0;
    });
}

function flowchartLabels(code: string): Array<string> {
  const labels: Array<string> = [];

  for (const line of statementsOf(code)) {
    if (FLOWCHART_DIRECTIVE.test(line)) {
      continue;
    }

    for (const match of Array.from(line.matchAll(QUOTED_TEXT))) {
      labels.push(match[1] as string);
    }

    const unquoted: string = line.replace(QUOTED_TEXT, QUOTED_PLACEHOLDER);

    for (const pattern of [
      BARRED_LINK_TEXT,
      INLINE_LINK_TEXT,
      UNQUOTED_NODE_TEXT,
    ]) {
      for (const match of Array.from(unquoted.matchAll(pattern))) {
        const text: string | undefined = match
          .slice(1)
          .find((group: string | undefined): boolean => {
            return group !== undefined;
          });

        if (text !== undefined && text !== QUOTED_PLACEHOLDER) {
          labels.push(text);
        }
      }
    }
  }

  return labels;
}

function sequenceLabels(code: string): Array<string> {
  const labels: Array<string> = [];
  const declared: Set<string> = new Set();

  for (const line of statementsOf(code)) {
    const participant: RegExpMatchArray | null =
      line.match(SEQUENCE_PARTICIPANT);

    if (participant) {
      declared.add(participant[1] as string);
      labels.push(participant[2] ?? (participant[1] as string));
      continue;
    }

    const note: RegExpMatchArray | null = line.match(SEQUENCE_NOTE);

    if (note) {
      labels.push(note[1] as string);
      continue;
    }

    const message: RegExpMatchArray | null = line.match(SEQUENCE_MESSAGE);

    if (message) {
      // A participant no line declares is drawn under its name.
      for (const end of [message[1] as string, message[2] as string]) {
        if (!declared.has(end)) {
          declared.add(end);
          labels.push(end);
        }
      }

      labels.push(message[3] as string);
      continue;
    }

    const block: RegExpMatchArray | null = line.match(SEQUENCE_BLOCK_TEXT);

    if (block && (block[1] as string).trim()) {
      labels.push(`[${(block[1] as string).trim()}]`);
    }
  }

  return labels;
}

function stateLabels(code: string): Array<string> {
  const labels: Array<string> = [];
  const described: Set<string> = new Set(["[*]"]);
  const named: Array<string> = [];

  for (const line of statementsOf(code)) {
    const unquoted: string = line.replace(QUOTED_TEXT, QUOTED_PLACEHOLDER);
    const declaration: RegExpMatchArray | null =
      unquoted.match(STATE_DECLARATION);

    // state "Reporting" as Reporting: the state is drawn under its description.
    if (declaration) {
      described.add(declaration[1] as string);

      for (const match of Array.from(line.matchAll(QUOTED_TEXT))) {
        labels.push(match[1] as string);
      }

      continue;
    }

    const note: RegExpMatchArray | null = line.match(STATE_NOTE);

    if (note) {
      labels.push(note[1] as string);
      continue;
    }

    const transition: RegExpMatchArray | null = line.match(STATE_TRANSITION);

    if (transition) {
      named.push(transition[1] as string, transition[2] as string);

      if (transition[3] !== undefined) {
        labels.push(transition[3]);
      }

      continue;
    }

    const description: RegExpMatchArray | null = line.match(STATE_DESCRIPTION);

    if (description) {
      described.add(description[1] as string);
      labels.push(description[2] as string);
    }
  }

  // A state with no description is drawn under its name.
  for (const name of named) {
    if (!described.has(name)) {
      described.add(name);
      labels.push(name);
    }
  }

  return labels;
}

/*
 * Every line a diagram draws, as a reader meets it: its title, which the
 * docs draw as the caption under it; a flowchart's node, link and subgraph
 * labels, quoted or not; a sequence diagram's participant names, messages,
 * notes and block labels, drawn as SVG text; a state diagram's state names,
 * descriptions and transition labels. Each label is broken at its <br/>s.
 */
export function drawnDiagramLines(fence: DocsFence): Array<DrawnDiagramLine> {
  const lines: Array<DrawnDiagramLine> = [];
  const titleMatch: RegExpMatchArray | null =
    fence.info.match(DIAGRAM_TITLE_TEXT);
  const title: string | undefined = titleMatch
    ? titleMatch[1] ?? titleMatch[2]
    : undefined;

  if (title !== undefined) {
    for (const text of labelLines(title)) {
      lines.push({ text: text, svg: false });
    }
  }

  const kind: string = fence.code.trimStart().split(SPACE_RUN)[0] || "";
  const isSequence: boolean = kind === "sequenceDiagram";
  const labels: Array<string> = isSequence
    ? sequenceLabels(fence.code)
    : kind.startsWith("stateDiagram")
      ? stateLabels(fence.code)
      : flowchartLabels(fence.code);

  for (const label of labels) {
    for (const text of labelLines(label)) {
      lines.push({ text: text, svg: isSequence });
    }
  }

  return lines;
}

/*
 * The direction a page lays a line out in (style.css): right to left on a
 * right-to-left page; on a left-to-right one, the direction of its first
 * letter, left to right for a sequence diagram's SVG text.
 */
function laidOutDirection(
  line: DrawnDiagramLine,
  pageDirection: DocsLanguageDirection,
): DocsLanguageDirection {
  if (pageDirection === "rtl") {
    return "rtl";
  }

  return line.svg ? "ltr" : firstLetterDirection(line.text) || "ltr";
}

/*
 * The lines of a page's diagrams, their captions included, that the page
 * lays out in an order other than the one they are meant to read in: drawn
 * in the direction the page gives them, they come out unlike the same line
 * drawn in its own script's direction (meantDirection). On a right-to-left
 * page, a line of Latin words only that starts or ends with punctuation or
 * a number, as "Rule 1:" (drawn ":Rule 1"); on a left-to-right page, a line
 * holding right-to-left words that opens with a Latin word. A line with an
 * explicit embedding or isolate is listed too: write none in a diagram.
 */
export function linesLaidOutBackwards(
  markdown: string,
  pageDirection: DocsLanguageDirection,
): Array<string> {
  return scanMarkdown(markdown)
    .fences.filter((fence: DocsFence): boolean => {
      return fence.lang === "mermaid";
    })
    .flatMap(drawnDiagramLines)
    .filter((line: DrawnDiagramLine): boolean => {
      const drawn: string | null = drawnOrder(
        line.text,
        laidOutDirection(line, pageDirection),
      );

      return (
        drawn === null ||
        drawn !== drawnOrder(line.text, meantDirection(line.text))
      );
    })
    .map((line: DrawnDiagramLine): string => {
      return line.text;
    });
}
