import { listPages, readPage } from "./DocsContentSupport";

/*
 * A docs page read block by block, for the checks that read a translation
 * beside its English page.
 *
 * A translation follows its English page block for block: the same
 * paragraphs, list items, table rows and diagram lines in the same order
 * (DocsTranslations holds the shape). So the block at a place in a
 * translated page says what the English block at that place says, and a
 * check can read the two side by side: MaintenanceEventDocsWords (a
 * maintenance event's word), ProbeWordPerLanguage (a probe's) and
 * PersianPortWordDocs (a port's).
 */

export interface DocsBlock {
  // 0-based line the block starts on.
  line: number;
  // The block's lines, joined with spaces.
  text: string;
  // Inside a code sample (a diagram is not code: its labels are prose).
  code: boolean;
  // A line of a Mermaid diagram: only its labels are words.
  diagram: boolean;
}

const FENCE: RegExp = /^\s*```/;
const BLOCK_START: RegExp = /^\s*(?:[-*+] |\d+[.)] |\||#|:::|```|>|<|$)/;
const LIST_ITEM: RegExp = /^\s*(?:[-*+] |\d+[.)] )/;
const INDENTED: RegExp = /^\s{2,}\S/;

/*
 * A page's blocks: a paragraph, a list item or a quote with the lines it
 * wraps onto; a table row, a heading or a code line on its own.
 */
export function blocksOf(markdown: string): Array<DocsBlock> {
  const blocks: Array<DocsBlock> = [];
  let inFence: boolean = false;
  let fenceIsCode: boolean = false;
  let afterBlank: boolean = true;

  markdown.split("\n").forEach((line: string, index: number) => {
    if (FENCE.test(line)) {
      inFence = !inFence;
      fenceIsCode = inFence && !line.includes("mermaid");
      blocks.push({ line: index, text: line, code: true, diagram: false });
      afterBlank = false;
      return;
    }

    if (inFence) {
      blocks.push({
        line: index,
        text: line,
        code: fenceIsCode,
        diagram: !fenceIsCode,
      });
      return;
    }

    if (line.trim() === "") {
      afterBlank = true;
      return;
    }

    const last: DocsBlock | undefined = blocks[blocks.length - 1];
    const continues: boolean =
      !afterBlank &&
      last !== undefined &&
      (!BLOCK_START.test(line) ||
        (INDENTED.test(line) && !LIST_ITEM.test(line)) ||
        (line.startsWith(">") && last.text.startsWith(">")));

    if (continues) {
      last!.text = `${last!.text} ${line.trim()}`;
    } else {
      blocks.push({ line: index, text: line, code: false, diagram: false });
    }

    afterBlank = false;
  });

  return blocks;
}

// What a block says: no bold labels, code, link targets or markup.
export function proseOf(text: string): string {
  return text
    .replace(/-<br\s*\/?>/g, "")
    .replace(/<br\s*\/?>/g, " ")
    .replace(/\*\*[^*]+\*\*/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/<[^>]+>/g, " ");
}

// A sequence diagram's message ("P->>O: text") or note ("Note over P: text").
const DIAGRAM_MESSAGE: RegExp =
  /^\s*(?:Note\s[^:]*|[^\s:]*-[-x)>]*[^\s:]*):(.*)$/;
// A sequence diagram's participant and the name it is drawn under.
const DIAGRAM_PARTICIPANT: RegExp =
  /^\s*(?:participant|actor)\s+\S+\s+as\s+(.*)$/;

/*
 * The words a Mermaid line draws: its quoted labels, its links' labels
 * (-->|label|), a sequence diagram's message, note or participant name.
 * Node ids, shapes and arrows are not words: a translated diagram keeps the
 * English page's ids (Probe["Sonde"]).
 */
export function diagramWordsOf(line: string): string {
  const labels: Array<string> = [];

  for (const match of Array.from(line.matchAll(/"([^"]*)"/g))) {
    labels.push(match[1]!);
  }

  const unquoted: string = line.replace(/"[^"]*"/g, " ");

  for (const match of Array.from(unquoted.matchAll(/\|([^|]+)\|/g))) {
    labels.push(match[1]!);
  }

  const said: string | undefined =
    unquoted.match(DIAGRAM_PARTICIPANT)?.[1] ||
    unquoted.match(DIAGRAM_MESSAGE)?.[1];

  if (said !== undefined) {
    labels.push(said);
  }

  return labels.join(" ").replace(/<br\s*\/?>/g, " ");
}

// A quote: "...", “...”, «...», each maybe in italics (_"..."_).
const QUOTE: RegExp = /[_*]?["“«]([^"”»\n]+)["”»][_*]?/g;
const BOLD: RegExp = /\*\*([^*\n]+)\*\*/g;

// A name or a message: two words or more. One word is a noun of the sentence.
const SEVERAL_WORDS: RegExp = /\S\s+\S/;
function isAName(text: string): boolean {
  return SEVERAL_WORDS.test(text.trim());
}

/*
 * The words a translated block says in its own language. What its English
 * block has word for word is the English kept as written, and is left out:
 * the whole block (a row or a paragraph not translated yet), a table cell
 * (a criteria's name), a bold label (a Dashboard label drawn in English,
 * **Switch to Probe Polling**), a quote (a message the product writes in
 * English, "This probe could not resolve"). A bold word or a quoted word
 * alone is a noun of the sentence, and read: "En **probe**" is Danish
 * that kept the English noun. A diagram line says only its labels. Bold
 * is unwrapped: a bold lead is the page's own words.
 */
export function ownWordsOf(english: DocsBlock, translation: DocsBlock): string {
  if (translation.text.trim() === english.text.trim()) {
    return "";
  }

  let text: string = translation.diagram
    ? diagramWordsOf(translation.text)
    : translation.text;

  if (!translation.diagram && text.trim().startsWith("|")) {
    const englishCells: Set<string> = new Set(
      english.text.split("|").map((cell: string): string => {
        return cell.trim();
      }),
    );

    text = text
      .split("|")
      .map((cell: string): string => {
        return englishCells.has(cell.trim()) ? " " : cell;
      })
      .join("|");
  }

  return text
    .replace(BOLD, (bold: string, inner: string): string => {
      return isAName(inner) && english.text.includes(bold) ? " " : inner;
    })
    .replace(QUOTE, (quote: string, inner: string): string => {
      return isAName(inner) && english.text.includes(inner) ? " " : quote;
    });
}

export interface PairedBlock {
  // "category/page", as listPages names it.
  page: string;
  // 1-based line of the translated page.
  line: number;
  english: DocsBlock;
  translation: DocsBlock;
}

export interface PairedPages {
  // Every block of the language's pages that has prose, beside its English.
  paired: Array<PairedBlock>;
  // Pages whose translation has a block more or less than the English.
  unpaired: Array<string>;
}

/*
 * Each prose block (not code) of a language's docs beside its English
 * block. A page the language has not translated is not read; a page whose
 * translation does not pair is in unpaired.
 */
export function pairedBlocksOf(language: string): PairedPages {
  const paired: Array<PairedBlock> = [];
  const unpaired: Array<string> = [];
  const translatedPages: Set<string> = new Set(listPages(language));

  for (const page of listPages("en")) {
    if (!translatedPages.has(page)) {
      continue;
    }

    const english: Array<DocsBlock> = blocksOf(readPage("en", page));
    const translated: Array<DocsBlock> = blocksOf(readPage(language, page));

    if (translated.length !== english.length) {
      unpaired.push(page);
      continue;
    }

    english.forEach((block: DocsBlock, index: number) => {
      if (block.code) {
        return;
      }

      paired.push({
        page,
        line: translated[index]!.line + 1,
        english: block,
        translation: translated[index]!,
      });
    });
  }

  return { paired, unpaired };
}
