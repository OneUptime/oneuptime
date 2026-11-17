/*
 * A translated docs page's lines, each with the English it says, for the
 * suites that hold a translation's words to what its English line names
 * (OneAlertWordPerLanguage, OneWordInSentencesPerThing).
 *
 * A translation keeps its English page's lines, so a line says what the
 * English line in its place says. The English upgrade guide is the exception:
 * it wraps a paragraph, a list item or a quote over several lines, where its
 * translations write each on one, so a line there in the place of an English
 * one said something else. Its lines are paired block by block: a paragraph,
 * a list item, a nested item or a quote with the lines it wraps onto, or a
 * heading, a table row, a container's or a code block's line. A page whose
 * blocks do not pair either is paired line by line, as before.
 */
export interface PairedLine {
  // The 0-based line of the translated page the text starts on.
  line: number;
  text: string;
  english: string;
  // A code fence's line, or a line inside a code block.
  code: boolean;
}

const BLOCK_START: RegExp = /^\s*(?:[-*]\s|\d+\.\s|#|:::|@tab|\||>|<)/;
const TAKES_NO_CONTINUATION: RegExp = /^\s*(?:#|:::|@tab|\|)/;
const CODE_FENCE: RegExp = /^\s*(?:```|~~~)/;
const QUOTE_LINE: RegExp = /^\s*>/;
const QUOTE_MARKER: RegExp = /^\s*>\s*\[!\w+\]\s*$/;

function blocksOf(lines: Array<string>): Array<PairedLine> {
  const blocks: Array<PairedLine> = [];
  let inFence: boolean = false;
  let open: boolean = false;

  lines.forEach((line: string, index: number) => {
    const last: PairedLine | undefined = blocks[blocks.length - 1];

    if (CODE_FENCE.test(line) || inFence) {
      if (CODE_FENCE.test(line)) {
        inFence = !inFence;
      }
      blocks.push({ line: index, text: line, english: "", code: true });
      open = false;
      return;
    }

    if (line.trim() === "") {
      open = false;
      return;
    }

    if (
      open &&
      last &&
      QUOTE_LINE.test(line) &&
      QUOTE_LINE.test(last.text) &&
      !QUOTE_MARKER.test(last.text) &&
      !QUOTE_MARKER.test(line)
    ) {
      last.text += ` ${line.replace(/^\s*>\s?/, "").trim()}`;
      return;
    }

    if (open && last && !BLOCK_START.test(line)) {
      last.text += ` ${line.trim()}`;
      return;
    }

    blocks.push({ line: index, text: line, english: "", code: false });
    open = !TAKES_NO_CONTINUATION.test(line);
  });

  return blocks;
}

// Each line of a page whose translation keeps its English page's lines.
function linesOf(
  english: Array<string>,
  translated: Array<string>,
): Array<PairedLine> {
  let inFence: boolean = false;

  return translated.map((text: string, line: number): PairedLine => {
    const fence: boolean = CODE_FENCE.test(text);

    if (fence) {
      inFence = !inFence;
    }

    return {
      line,
      text,
      english: english[line] || "",
      code: fence || inFence,
    };
  });
}

export function pairedLines(
  english: Array<string>,
  translated: Array<string>,
): Array<PairedLine> {
  if (english.length !== translated.length) {
    const englishBlocks: Array<PairedLine> = blocksOf(english);
    const translatedBlocks: Array<PairedLine> = blocksOf(translated);

    if (englishBlocks.length === translatedBlocks.length) {
      return translatedBlocks.map(
        (block: PairedLine, index: number): PairedLine => {
          return { ...block, english: englishBlocks[index]!.text };
        },
      );
    }
  }

  return linesOf(english, translated);
}
