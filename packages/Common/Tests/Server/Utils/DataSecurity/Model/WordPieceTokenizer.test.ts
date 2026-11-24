import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import WordPieceTokenizer, {
  CharacterKind,
  getCharacterKind,
  MAX_CHARACTERS_PER_WORD,
  WordPieceToken,
} from "../../../../../Server/Utils/DataSecurity/Model/WordPieceTokenizer";
import { fetchModelIntoCache } from "./ModelCache";

/*
 * The names-and-addresses model's tokenizer must give the ids the model was
 * trained on: the same as its tokenizer.json, run by the library the model
 * was made with. The first half holds each rule on a small vocabulary; the
 * second holds the whole tokenizer, with the model's own vocabulary (fetched
 * once into the test cache, checked against its SHA-256), to the library's
 * ids, offsets and words over the test set and generated text
 * (WordPieceReference.json, written by Hugging Face tokenizers 0.23.3).
 */

const SMALL_VOCABULARY: string = [
  "[PAD]",
  "[UNK]",
  "[CLS]",
  "[SEP]",
  "[MASK]",
  "Maria",
  "Gon",
  "##za",
  "##lez",
  ",",
  "'",
  "1",
  "##4",
  "14",
  "Calle",
  "May",
  "##or",
  "日",
  "本",
  "😀",
  "a",
  "##b",
  "b",
  "x",
  "##a",
].join("\n");

const tokenizer: WordPieceTokenizer = new WordPieceTokenizer(
  `${SMALL_VOCABULARY}\n`,
);

function idsOf(text: string): Array<number> {
  return tokenizer.tokenize(text).map((token: WordPieceToken): number => {
    return token.id;
  });
}

function piecesOf(text: string): Array<string> {
  const vocabulary: Array<string> = SMALL_VOCABULARY.split("\n");

  return idsOf(text).map((id: number): string => {
    return vocabulary[id]!;
  });
}

describe("WordPieceTokenizer, rule by rule", () => {
  test("reads a vocabulary file: one piece a line, its id the line, the special tokens found", () => {
    expect(tokenizer.size).toBe(25);
    expect(tokenizer.padId).toBe(0);
    expect(tokenizer.unknownId).toBe(1);
    expect(tokenizer.clsId).toBe(2);
    expect(tokenizer.sepId).toBe(3);
    // Windows line endings read the same.
    expect(
      new WordPieceTokenizer(SMALL_VOCABULARY.split("\n").join("\r\n")).sepId,
    ).toBe(3);
  });

  test("refuses a vocabulary without the special tokens", () => {
    expect(() => {
      return new WordPieceTokenizer("a\nb\n");
    }).toThrow("The vocabulary has no [UNK] token.");
  });

  test("splits words at white space and takes the longest piece first, then ## pieces", () => {
    expect(piecesOf("Maria Gonzalez")).toEqual([
      "Maria",
      "Gon",
      "##za",
      "##lez",
    ]);
    expect(piecesOf("Calle Mayor")).toEqual(["Calle", "May", "##or"]);
  });

  test("a word's pieces share its word; punctuation is a word of its own", () => {
    const tokens: Array<WordPieceToken> =
      tokenizer.tokenize("Gonzalez, 14 Calle");

    expect(
      tokens.map((token: WordPieceToken): number => {
        return token.word;
      }),
    ).toEqual([0, 0, 0, 1, 2, 3]);
    expect(piecesOf("Gonzalez,14")).toEqual([
      "Gon",
      "##za",
      "##lez",
      ",",
      "14",
    ]);
  });

  test("offsets point back at the text, in UTF-16 units", () => {
    const text: string = "😀 Maria, 日本";
    const tokens: Array<WordPieceToken> = tokenizer.tokenize(text);

    expect(
      tokens.map((token: WordPieceToken): string => {
        return text.slice(token.start, token.end);
      }),
    ).toEqual(["😀", "Maria", ",", "日", "本"]);
    expect(tokens[0]).toEqual({ id: 19, start: 0, end: 2, word: 0 });
  });

  test("a CJK ideograph is a word of its own even inside a run of them", () => {
    expect(piecesOf("日本")).toEqual(["日", "本"]);
  });

  test("a word with any part no piece matches is one [UNK], over the whole word", () => {
    const tokens: Array<WordPieceToken> = tokenizer.tokenize("Mariaz x");

    expect(tokens[0]).toEqual({ id: 1, start: 0, end: 6, word: 0 });
    expect(tokens[1]!.id).toBe(20 + 3);
  });

  test(`a word longer than ${MAX_CHARACTERS_PER_WORD} characters is [UNK]`, () => {
    expect(idsOf("a".repeat(MAX_CHARACTERS_PER_WORD))).not.toContain(1);
    expect(idsOf("a".repeat(MAX_CHARACTERS_PER_WORD + 1))).toEqual([1]);
  });

  test("control and format characters are dropped and the word goes on; tab, line feed and carriage return split words", () => {
    // A zero-width space, a soft hyphen and a byte order mark inside a name.
    expect(piecesOf("Ma​ria Gon­za﻿lez")).toEqual([
      "Maria",
      "Gon",
      "##za",
      "##lez",
    ]);
    expect(piecesOf("a\tb\na\rb")).toEqual(["a", "b", "a", "b"]);
    // Vertical tab, form feed and NEL are control characters, not spaces.
    expect(piecesOf("a\u000bb")).toEqual(["a", "##b"]);
    expect(piecesOf("a\u000cb")).toEqual(["a", "##b"]);
    expect(piecesOf("a\u0085b")).toEqual(["a", "##b"]);
    // A no-break space and an ideographic space split.
    expect(piecesOf("a b　a")).toEqual(["a", "b", "a"]);
  });

  test("a dropped character's offset is skipped: the next piece starts after it", () => {
    const tokens: Array<WordPieceToken> = tokenizer.tokenize("​Maria");

    expect(tokens).toEqual([{ id: 5, start: 1, end: 6, word: 0 }]);
  });

  test("a lone surrogate is dropped, as no UTF-8 text holds one", () => {
    expect(piecesOf("a\ud800b")).toEqual(["a", "##b"]);
    expect(piecesOf("a\udc00")).toEqual(["a"]);
  });

  test("special tokens written in the text are matched as they are, wherever they are", () => {
    // Lower case is not a special token: "[", "cls" and "]" are words.
    expect(piecesOf("a[SEP]b [MASK]x[cls]")).toEqual([
      "a",
      "[SEP]",
      "b",
      "[MASK]",
      "x",
      "[UNK]",
      "[UNK]",
      "[UNK]",
    ]);

    const tokens: Array<WordPieceToken> = tokenizer.tokenize("a[CLS]b");

    expect(tokens).toEqual([
      { id: 20, start: 0, end: 1, word: 0 },
      { id: 2, start: 1, end: 6, word: 1 },
      { id: 22, start: 6, end: 7, word: 2 },
    ]);
  });

  test("an empty or blank text has no tokens", () => {
    expect(tokenizer.tokenize("")).toEqual([]);
    expect(tokenizer.tokenize(" \t\n​ ")).toEqual([]);
  });
});

describe("the character classes read out of the model's tokenizer", () => {
  test.each([
    [0x0041, CharacterKind.Ordinary],
    [0x00e9, CharacterKind.Ordinary],
    [0x0020, CharacterKind.Separator],
    [0x0009, CharacterKind.Separator],
    [0x00a0, CharacterKind.Separator],
    [0x2003, CharacterKind.Separator],
    [0x3000, CharacterKind.Separator],
    [0x0000, CharacterKind.Removed],
    [0x000b, CharacterKind.Removed],
    [0x0085, CharacterKind.Removed],
    [0x00ad, CharacterKind.Removed],
    [0x200b, CharacterKind.Removed],
    [0xfeff, CharacterKind.Removed],
    [0xe000, CharacterKind.Removed],
    [0x10fffd, CharacterKind.Removed],
    [0x4e00, CharacterKind.Cjk],
    [0x9fff, CharacterKind.Cjk],
    [0x2b81f, CharacterKind.Cjk],
    // Between the two ranges the library counts as CJK.
    [0x2b820, CharacterKind.Ordinary],
    [0x2b920, CharacterKind.Cjk],
    [0x0021, CharacterKind.Punctuation],
    [0x007e, CharacterKind.Punctuation],
    [0x00ab, CharacterKind.Punctuation],
    [0x2014, CharacterKind.Punctuation],
    [0x3001, CharacterKind.Punctuation],
    // Symbols are not punctuation, outside ASCII.
    [0x20ac, CharacterKind.Ordinary],
    [0x00b0, CharacterKind.Ordinary],
    [0x1f600, CharacterKind.Ordinary],
  ])("U+%s", (code: number, kind: CharacterKind) => {
    expect(getCharacterKind(code)).toBe(kind);
  });
});

interface ReferenceCase {
  text: string;
  ids: Array<number>;
  offsets: Array<[number, number]>;
  words: Array<number>;
}

describe("WordPieceTokenizer with the model's vocabulary, against its tokenizer.json", () => {
  test("gives the reference library's ids, offsets and words for every text", async () => {
    const directory: string = await fetchModelIntoCache(["vocab.txt"]);
    const model: WordPieceTokenizer = new WordPieceTokenizer(
      fs.readFileSync(path.join(directory, "vocab.txt"), "utf8"),
    );
    const reference: { tokenizers: string; cases: Array<ReferenceCase> } =
      JSON.parse(
        fs.readFileSync(
          path.join(__dirname, "WordPieceReference.json"),
          "utf8",
        ),
      );
    const mismatches: Array<string> = [];

    expect(model.size).toBe(70606);
    expect(reference.cases.length).toBeGreaterThan(450);

    for (const item of reference.cases) {
      const tokens: Array<WordPieceToken> = model.tokenize(item.text);
      const mine: ReferenceCase = {
        text: item.text,
        ids: tokens.map((token: WordPieceToken): number => {
          return token.id;
        }),
        offsets: tokens.map((token: WordPieceToken): [number, number] => {
          return [token.start, token.end];
        }),
        words: tokens.map((token: WordPieceToken): number => {
          return token.word;
        }),
      };

      if (JSON.stringify(mine) !== JSON.stringify(item)) {
        mismatches.push(item.text.slice(0, 80));
      }
    }

    expect(mismatches).toEqual([]);
  }, 300000);
});
