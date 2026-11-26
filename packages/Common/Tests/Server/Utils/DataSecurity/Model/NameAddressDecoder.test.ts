import { describe, expect, test } from "@jest/globals";
import {
  Chunk,
  CHUNK_OVERLAP,
  decodeEntities,
  LABELS,
  MAX_PIECES_PER_CHUNK,
  planChunks,
  softmaxRows,
} from "../../../../../Server/Utils/DataSecurity/Model/NameAddressDecoder";
import { WordPieceToken } from "../../../../../Server/Utils/DataSecurity/Model/WordPieceTokenizer";
import { RecognizedEntity } from "../../../../../Utils/DataSecurity/Model/RecognizedEntity";

/*
 * From the model's labels to names and street addresses, without the model:
 * texts split into words by hand, each word given the label (and the
 * probability) a test wants, then decoded as the scanner decodes the real
 * model's output.
 */

interface LabelledWord {
  text: string;
  label: string;
  probability?: number;
  // Pieces after the first, which carry the same word.
  pieces?: number;
}

/*
 * A text, its tokens and their probabilities, from words joined by single
 * spaces - or by what `glue` says comes before a word.
 */
function build(words: Array<LabelledWord & { glue?: string }>): {
  text: string;
  tokens: Array<WordPieceToken>;
  probabilities: Float32Array;
} {
  let text: string = "";
  const tokens: Array<WordPieceToken> = [];
  const rows: Array<Array<number>> = [];

  words.forEach((word: LabelledWord & { glue?: string }, index: number) => {
    text += index === 0 ? "" : word.glue ?? " ";

    const start: number = text.length;
    const pieces: number = 1 + (word.pieces || 0);
    const length: number = word.text.length;

    text += word.text;

    for (let piece: number = 0; piece < pieces; piece++) {
      const pieceStart: number = start + Math.floor((length * piece) / pieces);
      const pieceEnd: number =
        start + Math.floor((length * (piece + 1)) / pieces);
      const row: Array<number> = LABELS.map((): number => {
        return 0;
      });
      // Later pieces say something else: only the first piece's label counts.
      const label: string = piece === 0 ? word.label : "B-ORG";
      const probability: number = word.probability ?? 0.9;

      row[LABELS.indexOf(label)] = probability;
      row[0] = (row[0] ?? 0) + 1 - probability;
      tokens.push({
        id: 1000 + index,
        start: pieceStart,
        end: pieceEnd,
        word: index,
      });
      rows.push(row);
    }
  });

  return { text, tokens, probabilities: Float32Array.from(rows.flat()) };
}

function decode(words: Array<LabelledWord & { glue?: string }>): Array<{
  type: string;
  value: string;
  score: number;
}> {
  const built: ReturnType<typeof build> = build(words);

  return decodeEntities(built).map(
    (
      entity: RecognizedEntity,
    ): { type: string; value: string; score: number } => {
      return {
        type: entity.dataTypeId,
        value: built.text.slice(entity.start, entity.end),
        score: Math.round(entity.score * 1000) / 1000,
      };
    },
  );
}

const O: (text: string) => LabelledWord = (text: string): LabelledWord => {
  return { text, label: "O" };
};

describe("decodeEntities", () => {
  test("a run of person words is a person's name, scored by its words' mean probability", () => {
    expect(
      decode([
        O("Refund"),
        O("approved"),
        O("for"),
        { text: "Maria", label: "B-PER", probability: 0.9 },
        { text: "Gonzalez", label: "I-PER", probability: 0.7 },
      ]),
    ).toEqual([{ type: "person-name", value: "Maria Gonzalez", score: 0.8 }]);
  });

  test("only a word's first piece labels it, and its later pieces belong to it", () => {
    expect(
      decode([{ text: "Gonzalez", label: "B-PER", pieces: 2 }, O("called")]),
    ).toEqual([{ type: "person-name", value: "Gonzalez", score: 0.9 }]);
  });

  test("an I- word with no run before it starts one; an O word or another kind ends one", () => {
    expect(
      decode([
        { text: "Maria", label: "I-PER" },
        O("and"),
        { text: "Jonas", label: "B-PER" },
        { text: "Becker", label: "I-ORG" },
      ]),
    ).toEqual([
      { type: "person-name", value: "Maria", score: 0.9 },
      { type: "person-name", value: "Jonas", score: 0.9 },
    ]);
  });

  test("a B- word right after a run of the same kind starts another, and the two merge when only a space or a comma is between them", () => {
    expect(
      decode([
        { text: "Maria", label: "B-PER" },
        { text: "Gonzalez", label: "B-PER", probability: 0.6 },
      ]),
    ).toEqual([{ type: "person-name", value: "Maria Gonzalez", score: 0.6 }]);
    expect(
      decode([
        { text: "Gonzalez", label: "B-PER" },
        { text: ",", label: "O", glue: "" },
        { text: "Maria", label: "B-PER" },
      ]),
    ).toEqual([{ type: "person-name", value: "Gonzalez, Maria", score: 0.9 }]);
    // Further apart, they stay two names.
    expect(
      decode([
        { text: "Maria", label: "B-PER" },
        O("and"),
        { text: "Jonas", label: "B-PER" },
      ]),
    ).toHaveLength(2);
  });

  test("a place with a house number before it is a street address, the number with it", () => {
    expect(
      decode([
        { text: "Maria", label: "B-PER" },
        { text: "Gonzalez", label: "I-PER" },
        { text: ",", label: "O", glue: "" },
        O("14"),
        { text: "Calle", label: "B-LOC" },
        { text: "Mayor", label: "I-LOC" },
        { text: ",", label: "O", glue: "" },
        { text: "Madrid", label: "B-LOC" },
      ]),
    ).toEqual([
      { type: "person-name", value: "Maria Gonzalez", score: 0.9 },
      { type: "postal-address", value: "14 Calle Mayor", score: 0.9 },
    ]);
  });

  test("a place with a house number after it is one too: Lindenstraße 23, Via Roma 112b", () => {
    expect(
      decode([
        { text: "Lindenstraße", label: "B-LOC" },
        O("23"),
        { text: ",", label: "O", glue: "" },
        O("Berlin"),
      ]),
    ).toEqual([
      { type: "postal-address", value: "Lindenstraße 23", score: 0.9 },
    ]);
    expect(
      decode([
        { text: "Via", label: "B-LOC" },
        { text: "Roma", label: "I-LOC" },
        O("112b"),
      ]),
    ).toEqual([{ type: "postal-address", value: "Via Roma 112b", score: 0.9 }]);
  });

  test("a place with a number in it is a street address", () => {
    expect(decode([{ text: "Keizersgracht 415-II", label: "B-LOC" }])).toEqual([
      { type: "postal-address", value: "Keizersgracht 415-II", score: 0.9 },
    ]);
  });

  test("a city or a country alone is no finding", () => {
    expect(
      decode([
        O("Deployed"),
        O("to"),
        { text: "Frankfurt", label: "B-LOC" },
        O("and"),
        { text: "Madrid", label: "B-LOC" },
      ]),
    ).toEqual([]);
  });

  test("a number further than a few characters from the place does not make it an address", () => {
    expect(
      decode([
        O("Order"),
        O("1029384"),
        O("shipped"),
        O("from"),
        O("our"),
        { text: "Rotterdam", label: "B-LOC" },
        O("warehouse"),
      ]),
    ).toEqual([]);
  });

  test("a street named after a person is one address when the model reads it as one place: 58 cours Victor Hugo", () => {
    expect(
      decode([
        O("58"),
        { text: "cours", label: "B-LOC" },
        { text: "Victor", label: "I-LOC" },
        { text: "Hugo", label: "I-LOC" },
      ]),
    ).toEqual([
      { type: "postal-address", value: "58 cours Victor Hugo", score: 0.9 },
    ]);
    // Where the model reads the person in it, the name is a name of its own.
    expect(
      decode([
        O("58"),
        { text: "cours", label: "B-LOC" },
        { text: "Victor", label: "B-PER" },
        { text: "Hugo", label: "B-LOC" },
      ]).map((entity: { type: string; value: string }): string => {
        return `${entity.type}: ${entity.value}`;
      }),
    ).toEqual(["postal-address: 58 cours", "person-name: Victor"]);
  });

  test("organisations and dates are no findings", () => {
    expect(
      decode([
        { text: "Banco", label: "B-ORG" },
        { text: "Santander", label: "I-ORG" },
        { text: "2026-11-24", label: "B-DATE" },
      ]),
    ).toEqual([]);
  });

  test("punctuation at either end of a run is left out, and a run of it alone is dropped", () => {
    expect(
      decode([
        { text: "'Maria", label: "B-PER" },
        { text: "Gonzalez',", label: "I-PER" },
      ]),
    ).toEqual([{ type: "person-name", value: "Maria Gonzalez", score: 0.9 }]);
    expect(decode([{ text: "--", label: "B-PER" }])).toEqual([]);
  });

  test("an astral character at the end of a run is never split", () => {
    const entities: ReturnType<typeof decode> = decode([
      { text: "Maria😀", label: "B-PER" },
    ]);

    expect(entities).toEqual([
      { type: "person-name", value: "Maria", score: 0.9 },
    ]);
  });

  test("an empty text has no findings", () => {
    expect(
      decodeEntities({
        text: "",
        tokens: [],
        probabilities: new Float32Array(),
      }),
    ).toEqual([]);
  });
});

function tokensOfWords(wordLengths: Array<number>): Array<WordPieceToken> {
  const tokens: Array<WordPieceToken> = [];
  let position: number = 0;

  wordLengths.forEach((pieces: number, word: number): void => {
    for (let piece: number = 0; piece < pieces; piece++) {
      tokens.push({ id: 1, start: position, end: position + 1, word });
      position++;
    }

    position++;
  });

  return tokens;
}

describe("planChunks", () => {
  test("a short text is one chunk that labels every piece", () => {
    expect(planChunks(tokensOfWords([1, 2, 3]))).toEqual([
      { start: 0, end: 6, ownStart: 0, ownEnd: 6 },
    ]);
    expect(planChunks([])).toEqual([]);
  });

  test("a long text is read in chunks of at most 256 pieces that overlap, start at a word, and label every piece once", () => {
    // 600 words of one to three pieces each.
    const lengths: Array<number> = Array.from(
      { length: 600 },
      (_: unknown, index: number): number => {
        return 1 + (index % 3);
      },
    );
    const tokens: Array<WordPieceToken> = tokensOfWords(lengths);
    const chunks: Array<Chunk> = planChunks(tokens);
    const owner: Array<number> = tokens.map((): number => {
      return 0;
    });

    expect(chunks.length).toBeGreaterThan(4);

    chunks.forEach((chunk: Chunk, index: number): void => {
      expect(chunk.end - chunk.start).toBeLessThanOrEqual(MAX_PIECES_PER_CHUNK);

      // Every chunk starts and ends at a word.
      for (const edge of [chunk.start, chunk.end]) {
        if (edge > 0 && edge < tokens.length) {
          expect(tokens[edge]!.word).not.toBe(tokens[edge - 1]!.word);
        }
      }

      if (index > 0) {
        const previous: Chunk = chunks[index - 1]!;

        // They overlap by about CHUNK_OVERLAP pieces, a word's worth more at most.
        expect(previous.end - chunk.start).toBeGreaterThanOrEqual(
          CHUNK_OVERLAP - 3,
        );
        expect(previous.end - chunk.start).toBeLessThanOrEqual(CHUNK_OVERLAP);
        expect(chunk.ownStart).toBe(previous.ownEnd);
        // A piece is labelled by a chunk it is inside, away from that chunk's edge.
        expect(chunk.ownStart).toBeGreaterThan(chunk.start);
        expect(previous.ownEnd).toBeLessThan(previous.end);
      }

      for (let token: number = chunk.ownStart; token < chunk.ownEnd; token++) {
        owner[token]!++;
        expect(token).toBeGreaterThanOrEqual(chunk.start);
        expect(token).toBeLessThan(chunk.end);
      }
    });

    expect(new Set(owner)).toEqual(new Set([1]));
    expect(chunks[chunks.length - 1]!.end).toBe(tokens.length);
  });

  test("a word longer than a chunk is still read: the chunk cuts it", () => {
    const tokens: Array<WordPieceToken> = tokensOfWords([300, 2]);
    const chunks: Array<Chunk> = planChunks(tokens);

    expect(chunks[0]).toEqual(
      expect.objectContaining({ start: 0, end: MAX_PIECES_PER_CHUNK }),
    );
    expect(chunks[chunks.length - 1]!.end).toBe(302);
  });
});

describe("softmaxRows", () => {
  test("turns each row of logits into probabilities, in place", () => {
    const values: Float32Array = Float32Array.from([0, 0, 1000, 1, 2, 3]);

    expect(softmaxRows(values, 3)).toBe(values);
    expect(values[0]).toBeCloseTo(0);
    expect(values[2]).toBeCloseTo(1);
    expect(values[3]! + values[4]! + values[5]!).toBeCloseTo(1);
    expect(values[5]).toBeGreaterThan(values[4]!);
  });
});
