/*
 * THE NAMES-AND-ADDRESSES MODEL'S TOKENIZER, EXACTLY AS ITS tokenizer.json
 * SETS IT UP.
 *
 * The model (NameAddressModel.json) is a BERT with a cased WordPiece
 * vocabulary, and a model only reads well the token ids it was trained on.
 * Its tokenizer.json says how text becomes those ids, and this does the same,
 * step by step, so no tokenizer library (and none of the native code or
 * downloads such libraries bring) is needed:
 *
 *  1. The special tokens ([CLS], [SEP], [MASK], [PAD], [UNK]) written in the
 *     text are matched first, as they are, wherever they are.
 *  2. BertNormalizer: control and format characters are dropped (a tab, a
 *     line feed and a carriage return are white space), white space becomes
 *     a space, and each CJK ideograph becomes a word of its own. The model is
 *     cased: no lower-casing, no accents stripped.
 *  3. BertPreTokenizer: words are split at white space, and every
 *     punctuation character is a word of its own.
 *  4. WordPiece: each word is the longest piece of the vocabulary it starts
 *     with, then the longest "##" piece that goes on from there, until the
 *     word is used up. A word of more than 100 characters, or one some part
 *     of which no piece matches, is [UNK].
 *
 * Which characters steps 2 and 3 drop, split at or isolate comes from the
 * tables below, read out of the tokenizers library the model was made with
 * (Hugging Face tokenizers 0.23.3), one code point at a time: its idea of a
 * control character or a punctuation mark is an older Unicode's than the
 * JavaScript engine's, and only the same tables give the same ids for every
 * text. WordPieceTokenizer.test.ts holds this to the library's own ids and
 * offsets over the test set, a benchmark and generated text.
 *
 * Offsets are positions in the text as given (UTF-16 code units, as
 * String.slice counts), so a token always points back at the characters it
 * came from.
 */

export interface WordPieceToken {
  id: number;
  // Where the token's characters start and end in the text.
  start: number;
  end: number;
  /*
   * The word (step 3) the token belongs to: the pieces of one word share it,
   * so the first piece of each word is the one whose label counts.
   */
  word: number;
}

// The longest word WordPiece reads; a longer one is [UNK].
export const MAX_CHARACTERS_PER_WORD: number = 100;

export const SPECIAL_TOKENS: ReadonlyArray<string> = [
  "[PAD]",
  "[UNK]",
  "[CLS]",
  "[SEP]",
  "[MASK]",
];

const CONTINUING_PREFIX: string = "##";

/*
 * [first, last] code points of each kind of character the tokenizer treats
 * specially. Every other code point is an ordinary character of a word.
 */
const REMOVED_RANGES: ReadonlyArray<number> = [
  0x0000, 0x0008, 0x000b, 0x000c, 0x000e, 0x001f, 0x007f, 0x009f, 0x00ad,
  0x00ad, 0x0600, 0x0605, 0x061c, 0x061c, 0x06dd, 0x06dd, 0x070f, 0x070f,
  0x180e, 0x180e, 0x200b, 0x200f, 0x202a, 0x202e, 0x2060, 0x2064, 0x2066,
  0x206f, 0xd800, 0xf8ff, 0xfeff, 0xfeff, 0xfff9, 0xfffb, 0xfffd, 0xfffd,
  0x110bd, 0x110bd, 0x1bca0, 0x1bca3, 0x1d173, 0x1d17a, 0xe0001, 0xe0001,
  0xe0020, 0xe007f, 0xf0000, 0xffffd, 0x100000, 0x10fffd,
];

const SEPARATOR_RANGES: ReadonlyArray<number> = [
  0x0009, 0x000a, 0x000d, 0x000d, 0x0020, 0x0020, 0x00a0, 0x00a0, 0x1680,
  0x1680, 0x2000, 0x200a, 0x2028, 0x2029, 0x202f, 0x202f, 0x205f, 0x205f,
  0x3000, 0x3000,
];

const CJK_RANGES: ReadonlyArray<number> = [
  0x3400, 0x4dbf, 0x4e00, 0x9fff, 0xf900, 0xfaff, 0x20000, 0x2a6df, 0x2a700,
  0x2b81f, 0x2b920, 0x2ceaf, 0x2f800, 0x2fa1f,
];

const PUNCTUATION_RANGES: ReadonlyArray<number> = [
  0x0021, 0x002f, 0x003a, 0x0040, 0x005b, 0x0060, 0x007b, 0x007e, 0x00a1,
  0x00a1, 0x00a7, 0x00a7, 0x00ab, 0x00ab, 0x00b6, 0x00b7, 0x00bb, 0x00bb,
  0x00bf, 0x00bf, 0x037e, 0x037e, 0x0387, 0x0387, 0x055a, 0x055f, 0x0589,
  0x058a, 0x05be, 0x05be, 0x05c0, 0x05c0, 0x05c3, 0x05c3, 0x05c6, 0x05c6,
  0x05f3, 0x05f4, 0x0609, 0x060a, 0x060c, 0x060d, 0x061b, 0x061b, 0x061e,
  0x061f, 0x066a, 0x066d, 0x06d4, 0x06d4, 0x0700, 0x070d, 0x07f7, 0x07f9,
  0x0830, 0x083e, 0x085e, 0x085e, 0x0964, 0x0965, 0x0970, 0x0970, 0x0af0,
  0x0af0, 0x0df4, 0x0df4, 0x0e4f, 0x0e4f, 0x0e5a, 0x0e5b, 0x0f04, 0x0f12,
  0x0f14, 0x0f14, 0x0f3a, 0x0f3d, 0x0f85, 0x0f85, 0x0fd0, 0x0fd4, 0x0fd9,
  0x0fda, 0x104a, 0x104f, 0x10fb, 0x10fb, 0x1360, 0x1368, 0x1400, 0x1400,
  0x166d, 0x166e, 0x169b, 0x169c, 0x16eb, 0x16ed, 0x1735, 0x1736, 0x17d4,
  0x17d6, 0x17d8, 0x17da, 0x1800, 0x180a, 0x1944, 0x1945, 0x1a1e, 0x1a1f,
  0x1aa0, 0x1aa6, 0x1aa8, 0x1aad, 0x1b5a, 0x1b60, 0x1bfc, 0x1bff, 0x1c3b,
  0x1c3f, 0x1c7e, 0x1c7f, 0x1cc0, 0x1cc7, 0x1cd3, 0x1cd3, 0x2010, 0x2027,
  0x2030, 0x2043, 0x2045, 0x2051, 0x2053, 0x205e, 0x207d, 0x207e, 0x208d,
  0x208e, 0x2308, 0x230b, 0x2329, 0x232a, 0x2768, 0x2775, 0x27c5, 0x27c6,
  0x27e6, 0x27ef, 0x2983, 0x2998, 0x29d8, 0x29db, 0x29fc, 0x29fd, 0x2cf9,
  0x2cfc, 0x2cfe, 0x2cff, 0x2d70, 0x2d70, 0x2e00, 0x2e2e, 0x2e30, 0x2e42,
  0x3001, 0x3003, 0x3008, 0x3011, 0x3014, 0x301f, 0x3030, 0x3030, 0x303d,
  0x303d, 0x30a0, 0x30a0, 0x30fb, 0x30fb, 0xa4fe, 0xa4ff, 0xa60d, 0xa60f,
  0xa673, 0xa673, 0xa67e, 0xa67e, 0xa6f2, 0xa6f7, 0xa874, 0xa877, 0xa8ce,
  0xa8cf, 0xa8f8, 0xa8fa, 0xa8fc, 0xa8fc, 0xa92e, 0xa92f, 0xa95f, 0xa95f,
  0xa9c1, 0xa9cd, 0xa9de, 0xa9df, 0xaa5c, 0xaa5f, 0xaade, 0xaadf, 0xaaf0,
  0xaaf1, 0xabeb, 0xabeb, 0xfd3e, 0xfd3f, 0xfe10, 0xfe19, 0xfe30, 0xfe52,
  0xfe54, 0xfe61, 0xfe63, 0xfe63, 0xfe68, 0xfe68, 0xfe6a, 0xfe6b, 0xff01,
  0xff03, 0xff05, 0xff0a, 0xff0c, 0xff0f, 0xff1a, 0xff1b, 0xff1f, 0xff20,
  0xff3b, 0xff3d, 0xff3f, 0xff3f, 0xff5b, 0xff5b, 0xff5d, 0xff5d, 0xff5f,
  0xff65, 0x10100, 0x10102, 0x1039f, 0x1039f, 0x103d0, 0x103d0, 0x1056f,
  0x1056f, 0x10857, 0x10857, 0x1091f, 0x1091f, 0x1093f, 0x1093f, 0x10a50,
  0x10a58, 0x10a7f, 0x10a7f, 0x10af0, 0x10af6, 0x10b39, 0x10b3f, 0x10b99,
  0x10b9c, 0x11047, 0x1104d, 0x110bb, 0x110bc, 0x110be, 0x110c1, 0x11140,
  0x11143, 0x11174, 0x11175, 0x111c5, 0x111c9, 0x111cd, 0x111cd, 0x111db,
  0x111db, 0x111dd, 0x111df, 0x11238, 0x1123d, 0x112a9, 0x112a9, 0x114c6,
  0x114c6, 0x115c1, 0x115d7, 0x11641, 0x11643, 0x1173c, 0x1173e, 0x12470,
  0x12474, 0x16a6e, 0x16a6f, 0x16af5, 0x16af5, 0x16b37, 0x16b3b, 0x16b44,
  0x16b44, 0x1bc9f, 0x1bc9f, 0x1da87, 0x1da8b,
];

export enum CharacterKind {
  Ordinary = 0,
  // Dropped by the normalizer: a control or format character.
  Removed = 1,
  // White space: words are split at it.
  Separator = 2,
  // A CJK ideograph: a word of its own.
  Cjk = 3,
  // A punctuation character: a word of its own.
  Punctuation = 4,
}

interface KindRange {
  first: number;
  last: number;
  kind: CharacterKind;
}

const KIND_RANGES: ReadonlyArray<KindRange> = ((): Array<KindRange> => {
  const ranges: Array<KindRange> = [];
  const add: (pairs: ReadonlyArray<number>, kind: CharacterKind) => void = (
    pairs: ReadonlyArray<number>,
    kind: CharacterKind,
  ): void => {
    for (let index: number = 0; index + 1 < pairs.length; index += 2) {
      ranges.push({ first: pairs[index]!, last: pairs[index + 1]!, kind });
    }
  };

  add(REMOVED_RANGES, CharacterKind.Removed);
  add(SEPARATOR_RANGES, CharacterKind.Separator);
  add(CJK_RANGES, CharacterKind.Cjk);
  add(PUNCTUATION_RANGES, CharacterKind.Punctuation);

  return ranges.sort((a: KindRange, b: KindRange): number => {
    return a.first - b.first;
  });
})();

// ASCII, looked up without a search: most text is mostly ASCII.
const ASCII_KINDS: ReadonlyArray<CharacterKind> = ((): Array<CharacterKind> => {
  const kinds: Array<CharacterKind> = [];

  for (let code: number = 0; code < 128; code++) {
    kinds.push(searchKind(code));
  }

  return kinds;
})();

function searchKind(code: number): CharacterKind {
  let low: number = 0;
  let high: number = KIND_RANGES.length - 1;

  while (low <= high) {
    const middle: number = (low + high) >> 1;
    const range: KindRange = KIND_RANGES[middle]!;

    if (code < range.first) {
      high = middle - 1;
    } else if (code > range.last) {
      low = middle + 1;
    } else {
      return range.kind;
    }
  }

  return CharacterKind.Ordinary;
}

export function getCharacterKind(code: number): CharacterKind {
  return code < 128 ? ASCII_KINDS[code]! : searchKind(code);
}

interface Word {
  // The word's characters (code points), as kept by the normalizer.
  characters: Array<string>;
  // Where each character starts and ends in the text.
  starts: Array<number>;
  ends: Array<number>;
}

export default class WordPieceTokenizer {
  private readonly vocabulary: ReadonlyMap<string, number>;
  public readonly unknownId: number;
  public readonly clsId: number;
  public readonly sepId: number;
  public readonly padId: number;
  private readonly specialIds: ReadonlyMap<string, number>;

  /*
   * From the model's vocab.txt: one piece a line, its id the line's number
   * from 0. The special tokens must be in it.
   */
  public constructor(vocabularyText: string) {
    const vocabulary: Map<string, number> = new Map();
    const lines: Array<string> = vocabularyText.split("\n");

    // A vocabulary file ends with a line feed: no piece is the empty string.
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }

    lines.forEach((line: string, index: number): void => {
      const piece: string = line.endsWith("\r") ? line.slice(0, -1) : line;

      if (!vocabulary.has(piece)) {
        vocabulary.set(piece, index);
      }
    });

    const idOf: (piece: string) => number = (piece: string): number => {
      const id: number | undefined = vocabulary.get(piece);

      if (id === undefined) {
        throw new Error(`The vocabulary has no ${piece} token.`);
      }

      return id;
    };

    this.vocabulary = vocabulary;
    this.unknownId = idOf("[UNK]");
    this.clsId = idOf("[CLS]");
    this.sepId = idOf("[SEP]");
    this.padId = idOf("[PAD]");

    const specialIds: Map<string, number> = new Map();

    for (const special of SPECIAL_TOKENS) {
      specialIds.set(special, idOf(special));
    }

    this.specialIds = specialIds;
  }

  public get size(): number {
    return this.vocabulary.size;
  }

  // The text's tokens, without [CLS] and [SEP] around them.
  public tokenize(text: string): Array<WordPieceToken> {
    const tokens: Array<WordPieceToken> = [];
    let wordCount: number = 0;
    let segmentStart: number = 0;
    let index: number = 0;

    // Step 1: special tokens split the text, and are kept as they are.
    while (index < text.length) {
      if (text.charCodeAt(index) === 91 /* [ */) {
        const special: string | null = this.specialAt(text, index);

        if (special !== null) {
          wordCount = this.tokenizeSegment(
            text,
            segmentStart,
            index,
            tokens,
            wordCount,
          );
          tokens.push({
            id: this.specialIds.get(special)!,
            start: index,
            end: index + special.length,
            word: wordCount++,
          });
          index += special.length;
          segmentStart = index;
          continue;
        }
      }

      index++;
    }

    this.tokenizeSegment(text, segmentStart, text.length, tokens, wordCount);

    return tokens;
  }

  private specialAt(text: string, index: number): string | null {
    for (const special of SPECIAL_TOKENS) {
      if (text.startsWith(special, index)) {
        return special;
      }
    }

    return null;
  }

  // Steps 2 to 4 over text[from, to). Returns the word count after it.
  private tokenizeSegment(
    text: string,
    from: number,
    to: number,
    tokens: Array<WordPieceToken>,
    wordCount: number,
  ): number {
    let word: Word | null = null;
    let words: number = wordCount;

    const finish: () => void = (): void => {
      if (word && word.characters.length > 0) {
        this.addWordPieces(word, words++, tokens);
      }

      word = null;
    };

    let index: number = from;

    while (index < to) {
      const code: number = text.codePointAt(index)!;
      /*
       * A pair of surrogates is one character. A lone surrogate, which no
       * UTF-8 text can hold, is a surrogate code point: dropped, as the
       * normalizer drops every one.
       */
      const width: number = code > 0xffff ? 2 : 1;
      const kind: CharacterKind = getCharacterKind(code);
      const character: string = text.slice(index, index + width);

      if (kind === CharacterKind.Removed) {
        // Dropped from the word, which goes on after it.
      } else if (kind === CharacterKind.Separator) {
        finish();
      } else if (
        kind === CharacterKind.Cjk ||
        kind === CharacterKind.Punctuation
      ) {
        finish();
        this.addWordPieces(
          {
            characters: [character],
            starts: [index],
            ends: [index + width],
          },
          words++,
          tokens,
        );
      } else {
        if (!word) {
          word = { characters: [], starts: [], ends: [] };
        }

        const current: Word = word;

        current.characters.push(character);
        current.starts.push(index);
        current.ends.push(index + width);
      }

      index += width;
    }

    finish();

    return words;
  }

  // Step 4: the word's pieces, longest first, or [UNK] for the whole word.
  private addWordPieces(
    word: Word,
    wordIndex: number,
    tokens: Array<WordPieceToken>,
  ): void {
    const length: number = word.characters.length;
    const wordStart: number = word.starts[0]!;
    const wordEnd: number = word.ends[length - 1]!;

    if (length > MAX_CHARACTERS_PER_WORD) {
      tokens.push({
        id: this.unknownId,
        start: wordStart,
        end: wordEnd,
        word: wordIndex,
      });
      return;
    }

    const pieces: Array<WordPieceToken> = [];
    let start: number = 0;

    while (start < length) {
      let end: number = length;
      let found: number | undefined = undefined;

      while (end > start) {
        let piece: string = word.characters.slice(start, end).join("");

        if (start > 0) {
          piece = CONTINUING_PREFIX + piece;
        }

        found = this.vocabulary.get(piece);

        if (found !== undefined) {
          break;
        }

        end--;
      }

      if (found === undefined) {
        tokens.push({
          id: this.unknownId,
          start: wordStart,
          end: wordEnd,
          word: wordIndex,
        });
        return;
      }

      pieces.push({
        id: found,
        start: word.starts[start]!,
        end: word.ends[end - 1]!,
        word: wordIndex,
      });
      start = end;
    }

    for (const piece of pieces) {
      tokens.push(piece);
    }
  }
}
