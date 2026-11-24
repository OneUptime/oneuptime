import {
  RecognizedDataTypeId,
  RecognizedEntity,
} from "../../../../Utils/DataSecurity/Model/RecognizedEntity";
import { WordPieceToken } from "./WordPieceTokenizer";

/*
 * FROM THE MODEL'S LABELS TO NAMES AND STREET ADDRESSES.
 *
 * The model labels every word piece with one of its tags (LABELS, from its
 * config.json): a person (PER), a place (LOC), an organisation (ORG) or a
 * date (DATE), each as the beginning (B-) or the inside (I-) of a run, or
 * nothing (O). What the scanner makes of them:
 *
 *  - A word takes the label of its first piece, as the model was trained.
 *  - A B- word starts a run; an I- word of the same kind right after it goes
 *    on with it; anything else ends it.
 *  - A run of PER words is a person's name.
 *  - A run of LOC words is a street address only with a house number in it,
 *    or just before or after it ("14 Calle Mayor", "Lindenstraße 23"), and
 *    then the number is part of it. A city or a country alone - "Madrid" -
 *    is no finding: it says where something is, not who lives there.
 *  - A name inside an address ("58 cours Victor Hugo") is part of the
 *    address.
 *  - Organisations and dates are left to the detectors and to no one.
 *
 * Punctuation at either end of a run is left out. Each finding's score is
 * the mean probability the model gave its words.
 *
 * Long text is read in chunks of at most MAX_PIECES_PER_CHUNK pieces - the
 * windows the model was trained on - that start at a word and overlap by
 * CHUNK_OVERLAP pieces; each half of an overlap is labelled by the chunk it
 * is further inside, so no word is read at the edge of its context.
 *
 * NameAddressDecoder.test.ts holds this to the reference the model was
 * measured with (research for #10373, reference_openmasq.py).
 */

export const LABELS: ReadonlyArray<string> = [
  "O",
  "B-DATE",
  "I-DATE",
  "B-PER",
  "I-PER",
  "B-ORG",
  "I-ORG",
  "B-LOC",
  "I-LOC",
];

export const MAX_PIECES_PER_CHUNK: number = 256;
export const CHUNK_OVERLAP: number = 32;

export interface Chunk {
  // The pieces [start, end) the model reads together.
  start: number;
  end: number;
  // The pieces [ownStart, ownEnd) whose labels are taken from this chunk.
  ownStart: number;
  ownEnd: number;
}

// The first piece of the word the piece at `index` belongs to.
function wordStartOf(
  tokens: ReadonlyArray<WordPieceToken>,
  index: number,
): number {
  let start: number = index;

  while (
    start > 0 &&
    start < tokens.length &&
    tokens[start]!.word === tokens[start - 1]!.word
  ) {
    start--;
  }

  return start;
}

export function planChunks(
  tokens: ReadonlyArray<WordPieceToken>,
): Array<Chunk> {
  const count: number = tokens.length;

  if (count === 0) {
    return [];
  }

  const spans: Array<[number, number]> = [];
  let start: number = 0;

  for (;;) {
    let end: number = Math.min(count, start + MAX_PIECES_PER_CHUNK);

    if (end < count) {
      const atWord: number = wordStartOf(tokens, end);

      end = atWord > start ? atWord : end;
    }

    spans.push([start, end]);

    if (end >= count) {
      break;
    }

    start = Math.max(start + 1, wordStartOf(tokens, end - CHUNK_OVERLAP));
  }

  const chunks: Array<Chunk> = [];

  for (let index: number = 0; index < spans.length; index++) {
    const [chunkStart, chunkEnd] = spans[index]!;
    const ownStart: number = index === 0 ? 0 : chunks[index - 1]!.ownEnd;
    let ownEnd: number = count;

    if (index + 1 < spans.length) {
      const nextStart: number = spans[index + 1]![0];

      ownEnd = Math.max(
        ownStart,
        wordStartOf(tokens, nextStart + Math.floor((chunkEnd - nextStart) / 2)),
      );
    }

    chunks.push({ start: chunkStart, end: chunkEnd, ownStart, ownEnd });
  }

  return chunks;
}

const ALPHANUMERIC: RegExp = /[\p{L}\p{N}]/u;
const DIGIT: RegExp = /\p{Nd}/u;
// A house number just before a place, or just after it.
const NUMBER_BEFORE: RegExp = /(\p{Nd}{1,8}[A-Za-z]?)[ ,]*$/u;
const NUMBER_AFTER: RegExp = /^[ ,]*(\p{Nd}{1,8}[A-Za-z]?)/u;
// What may stand between two parts of one name or one address.
const JOINER_ONLY: RegExp = /^[ ,]*$/;
// How far before or after a place its house number is looked for.
const NUMBER_REACH: number = 8;

function isAlphanumeric(text: string, index: number): boolean {
  const code: number = text.codePointAt(index)!;

  return ALPHANUMERIC.test(String.fromCodePoint(code));
}

// A low surrogate: the second half of a character, never where a span ends.
function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function trim(text: string, start: number, end: number): [number, number] {
  let first: number = start;
  let last: number = end;

  while (first < last && !isAlphanumeric(text, first)) {
    first += text.codePointAt(first)! > 0xffff ? 2 : 1;
  }

  while (last > first) {
    let previous: number = last - 1;

    if (previous > first && isLowSurrogate(text.charCodeAt(previous))) {
      previous--;
    }

    if (isAlphanumeric(text, previous)) {
      break;
    }

    last = previous;
  }

  return [first, last];
}

interface Word {
  start: number;
  end: number;
  label: string;
  probability: number;
}

interface Run {
  kind: string;
  last: number;
  start: number;
  end: number;
  probabilities: Array<number>;
}

interface Span {
  start: number;
  end: number;
  dataTypeId: RecognizedDataTypeId;
  score: number;
}

/*
 * The names and street addresses in a text, from the label probabilities of
 * each of its pieces (pieces x LABELS.length, row-major, already a softmax).
 */
export function decodeEntities(data: {
  text: string;
  tokens: ReadonlyArray<WordPieceToken>;
  probabilities: Float32Array;
}): Array<RecognizedEntity> {
  const { text, tokens, probabilities } = data;
  const labelCount: number = LABELS.length;
  const words: Array<Word> = [];

  for (let index: number = 0; index < tokens.length; index++) {
    const token: WordPieceToken = tokens[index]!;

    if (index > 0 && token.word === tokens[index - 1]!.word) {
      words[words.length - 1]!.end = token.end;
      continue;
    }

    let best: number = 0;

    for (let label: number = 1; label < labelCount; label++) {
      if (
        probabilities[index * labelCount + label]! >
        probabilities[index * labelCount + best]!
      ) {
        best = label;
      }
    }

    words.push({
      start: token.start,
      end: token.end,
      label: LABELS[best]!,
      probability: probabilities[index * labelCount + best]!,
    });
  }

  const runs: Array<Run> = [];

  words.forEach((word: Word, index: number): void => {
    if (word.label === "O") {
      return;
    }

    const [prefix, kind] = word.label.split("-") as [string, string];
    const open: Run | undefined = runs[runs.length - 1];

    if (
      prefix === "I" &&
      open &&
      open.kind === kind &&
      open.last === index - 1
    ) {
      open.last = index;
      open.end = word.end;
      open.probabilities.push(word.probability);
      return;
    }

    runs.push({
      kind,
      last: index,
      start: word.start,
      end: word.end,
      probabilities: [word.probability],
    });
  });

  const spans: Array<Span> = [];

  for (const run of runs) {
    let [start, end] = trim(text, run.start, run.end);

    if (start >= end) {
      continue;
    }

    const score: number =
      run.probabilities.reduce((sum: number, value: number): number => {
        return sum + value;
      }, 0) / run.probabilities.length;

    if (run.kind === "PER") {
      spans.push({ start, end, dataTypeId: "person-name", score });
      continue;
    }

    if (run.kind !== "LOC") {
      continue;
    }

    const beforeFrom: number = Math.max(0, start - NUMBER_REACH);
    const before: RegExpMatchArray | null = text
      .slice(beforeFrom, start)
      .match(NUMBER_BEFORE);
    const after: RegExpMatchArray | null = text
      .slice(end, end + NUMBER_REACH)
      .match(NUMBER_AFTER);

    if (!DIGIT.test(text.slice(start, end)) && !before && !after) {
      continue;
    }

    if (before && before.index !== undefined) {
      start = beforeFrom + before.index;
    }

    if (after) {
      end += after[0].length;
    }

    spans.push({ start, end, dataTypeId: "postal-address", score });
  }

  // Parts of one name or one address that touch, or are apart by a comma or a space, are one.
  spans.sort((a: Span, b: Span): number => {
    return a.start - b.start || a.end - b.end;
  });

  const merged: Array<Span> = [];

  for (const span of spans) {
    const previous: Span | undefined = merged[merged.length - 1];

    if (previous && previous.dataTypeId === span.dataTypeId) {
      const gap: string = text.slice(previous.end, span.start);

      if (
        span.start <= previous.end ||
        (gap.length <= 3 && JOINER_ONLY.test(gap))
      ) {
        previous.end = Math.max(previous.end, span.end);
        previous.score = Math.min(previous.score, span.score);
        continue;
      }
    }

    merged.push({ ...span });
  }

  const addresses: Array<Span> = merged.filter((span: Span): boolean => {
    return span.dataTypeId === "postal-address";
  });

  return merged
    .filter((span: Span): boolean => {
      return (
        span.dataTypeId !== "person-name" ||
        !addresses.some((address: Span): boolean => {
          return span.start < address.end && address.start < span.end;
        })
      );
    })
    .map((span: Span): RecognizedEntity => {
      return {
        dataTypeId: span.dataTypeId,
        start: span.start,
        end: span.end,
        score: span.score,
      };
    });
}

// Each row of logits (pieces x labels) as probabilities, in place.
export function softmaxRows(
  values: Float32Array,
  labels: number,
): Float32Array {
  for (let row: number = 0; row + labels <= values.length; row += labels) {
    let max: number = -Infinity;

    for (let label: number = 0; label < labels; label++) {
      max = Math.max(max, values[row + label]!);
    }

    let sum: number = 0;

    for (let label: number = 0; label < labels; label++) {
      const exp: number = Math.exp(values[row + label]! - max);

      values[row + label] = exp;
      sum += exp;
    }

    for (let label: number = 0; label < labels; label++) {
      values[row + label] = values[row + label]! / sum;
    }
  }

  return values;
}
