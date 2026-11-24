import { describe, expect, test } from "@jest/globals";
import {
  ModelBudget,
  ModelStoreBudget,
} from "../../../../../Server/Utils/DataSecurity/Model/ModelBudget";
import { LABELS } from "../../../../../Server/Utils/DataSecurity/Model/NameAddressDecoder";
import {
  closeNameAddressRecognizer,
  getNameAddressRecognizer,
  MAX_BATCH_ROWS,
  MAX_BATCH_TOKENS,
  MODEL_MAX_TEXT_LENGTH,
  NameAddressRecognizer,
  RecognizerAvailability,
} from "../../../../../Server/Utils/DataSecurity/Model/NameAddressRecognizer";
import {
  ModelBatch,
  ModelBatchResult,
} from "../../../../../Server/Utils/DataSecurity/Model/NameAddressModelThread";
import WordPieceTokenizer from "../../../../../Server/Utils/DataSecurity/Model/WordPieceTokenizer";
import { RecognizedEntity } from "../../../../../Utils/DataSecurity/Model/RecognizedEntity";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * The recogniser without the model: a small vocabulary, and a runner that
 * labels each piece by its id the way the model would, recording every
 * batch it is sent, on a clock the test moves. What is held here is what the
 * recogniser does around the model: batches, budgets, what it reads and what
 * it answers.
 */

const VOCABULARY: Array<string> = [
  "[PAD]",
  "[UNK]",
  "[CLS]",
  "[SEP]",
  "[MASK]",
  "Maria",
  "Gonzalez",
  "Calle",
  "Mayor",
  "14",
  ",",
  "Madrid",
  "approved",
  "x",
];

const LABEL_OF_PIECE: Record<string, string> = {
  Maria: "B-PER",
  Gonzalez: "I-PER",
  Calle: "B-LOC",
  Mayor: "I-LOC",
  Madrid: "B-LOC",
};

const tokenizer: WordPieceTokenizer = new WordPieceTokenizer(
  VOCABULARY.join("\n"),
);

interface FakeModel {
  runner: (batch: ModelBatch) => Promise<ModelBatchResult>;
  batches: Array<ModelBatch>;
  clock: { now: number };
}

function fakeModel(
  data: {
    millisecondsPerBatch?: number;
    reportElapsed?: number;
    labels?: number;
  } = {},
): FakeModel {
  const batches: Array<ModelBatch> = [];
  const clock: { now: number } = { now: 0 };

  return {
    batches,
    clock,
    runner: async (batch: ModelBatch): Promise<ModelBatchResult> => {
      batches.push(batch);
      clock.now += data.millisecondsPerBatch ?? 100;

      const labels: number = data.labels ?? LABELS.length;
      const logits: Float32Array = new Float32Array(
        batch.rows * batch.width * labels,
      );

      for (
        let position: number = 0;
        position < batch.rows * batch.width;
        position++
      ) {
        const piece: string = VOCABULARY[Number(batch.inputIds[position])]!;
        const label: number = Math.max(
          0,
          LABELS.indexOf(LABEL_OF_PIECE[piece] || "O"),
        );

        logits[position * labels + Math.min(label, labels - 1)] = 10;
      }

      return {
        logits,
        labels,
        elapsedInMs: data.reportElapsed,
      };
    },
  };
}

function recognizerOf(model: FakeModel): NameAddressRecognizer {
  return new NameAddressRecognizer({
    tokenizer,
    runner: model.runner,
    now: (): number => {
      return model.clock.now;
    },
  });
}

function storeBudget(storeLimitInMs: number = 1e9): ModelStoreBudget {
  return new ModelBudget({ scanLimitInMs: 1e9, storeLimitInMs }).forStore("s");
}

const SENTENCE: string =
  "Refund approved for Maria Gonzalez, 14 Calle Mayor, Madrid";

function described(
  text: string,
  entities: ReadonlyArray<RecognizedEntity> | undefined,
): Array<string> {
  return (entities || []).map((entity: RecognizedEntity): string => {
    return `${entity.dataTypeId}: ${text.slice(entity.start, entity.end)}`;
  });
}

describe("NameAddressRecognizer", () => {
  test("finds the issue's sentence's name and street address, and not its city", async () => {
    const model: FakeModel = fakeModel();
    const found: Map<string, Array<RecognizedEntity>> = await recognizerOf(
      model,
    ).recognize([SENTENCE], storeBudget());

    expect(described(SENTENCE, found.get(SENTENCE))).toEqual([
      "person-name: Maria Gonzalez",
      "postal-address: 14 Calle Mayor",
    ]);
  });

  test("sends each chunk as a row: [CLS], its pieces, [SEP], padded with [PAD] and masked", async () => {
    const model: FakeModel = fakeModel();

    await recognizerOf(model).recognize(
      ["Maria", "Maria Gonzalez x"],
      storeBudget(),
    );

    expect(model.batches).toHaveLength(1);

    const batch: ModelBatch = model.batches[0]!;

    expect(batch.rows).toBe(2);
    expect(batch.width).toBe(5);
    expect(Array.from(batch.inputIds).map(Number)).toEqual([
      2, 5, 3, 0, 0, 2, 5, 6, 13, 3,
    ]);
    expect(Array.from(batch.attentionMask).map(Number)).toEqual([
      1, 1, 1, 0, 0, 1, 1, 1, 1, 1,
    ]);
    expect(
      Array.from(batch.tokenTypeIds).every((id: bigint): boolean => {
        return id === BigInt(0);
      }),
    ).toBe(true);
  });

  test(`keeps every batch within ${MAX_BATCH_ROWS} rows and ${MAX_BATCH_TOKENS} pieces`, async () => {
    const model: FakeModel = fakeModel();
    const texts: Array<string> = [];

    for (let index: number = 0; index < 120; index++) {
      // Different lengths, so widths vary.
      texts.push(`Maria ${"x ".repeat(index % 40)}${index}`);
    }

    const found: Map<string, Array<RecognizedEntity>> = await recognizerOf(
      model,
    ).recognize(texts, storeBudget());

    expect(found.size).toBe(120);
    expect(model.batches.length).toBeGreaterThan(1);

    for (const batch of model.batches) {
      expect(batch.rows).toBeLessThanOrEqual(MAX_BATCH_ROWS);
      expect(batch.rows * batch.width).toBeLessThanOrEqual(MAX_BATCH_TOKENS);
    }
  });

  test("reads a long text in overlapping chunks and finds what is in each", async () => {
    const model: FakeModel = fakeModel();
    const text: string = `${"x ".repeat(400)}Maria Gonzalez ${"x ".repeat(400)}14 Calle Mayor`;
    const found: Map<string, Array<RecognizedEntity>> = await recognizerOf(
      model,
    ).recognize([text], storeBudget());

    expect(described(text, found.get(text))).toEqual([
      "person-name: Maria Gonzalez",
      "postal-address: 14 Calle Mayor",
    ]);
    expect(model.batches.length).toBeGreaterThan(1);
  });

  test(`reads at most the first ${MODEL_MAX_TEXT_LENGTH} characters of a text`, async () => {
    const model: FakeModel = fakeModel();
    const text: string = `${"x ".repeat(MODEL_MAX_TEXT_LENGTH)}Maria Gonzalez`;
    const found: Map<string, Array<RecognizedEntity>> = await recognizerOf(
      model,
    ).recognize([text], storeBudget());

    expect(found.get(text)).toEqual([]);
  });

  test("reads a text given twice once, and a blank text is read with nothing in it", async () => {
    const model: FakeModel = fakeModel();
    const budget: ModelStoreBudget = storeBudget();
    const found: Map<string, Array<RecognizedEntity>> = await recognizerOf(
      model,
    ).recognize(["Maria", "Maria", " \n "], budget);

    expect(model.batches).toHaveLength(1);
    expect(model.batches[0]!.rows).toBe(1);
    expect(found.get(" \n ")).toEqual([]);
    expect(budget.valuesToRead).toBe(2);
    expect(budget.valuesRead).toBe(2);
  });

  test("stops before a batch once the store's model time is used, and says how many values it read", async () => {
    const model: FakeModel = fakeModel({ millisecondsPerBatch: 100 });
    const budget: ModelStoreBudget = storeBudget(250);
    // 40 texts of 16 rows a batch would be 3 batches: only those before 250 ms run.
    const texts: Array<string> = Array.from(
      { length: 40 },
      (_: unknown, index: number): string => {
        return `Maria ${index}`;
      },
    );
    const found: Map<string, Array<RecognizedEntity>> = await recognizerOf(
      model,
    ).recognize(texts, budget);

    expect(model.batches).toHaveLength(3);
    expect(budget.spentInMs).toBe(300);
    expect(found.size).toBe(40);

    const tight: ModelStoreBudget = storeBudget(150);
    const second: FakeModel = fakeModel({ millisecondsPerBatch: 100 });
    const partly: Map<string, Array<RecognizedEntity>> = await recognizerOf(
      second,
    ).recognize(texts, tight);

    expect(second.batches).toHaveLength(2);
    expect(partly.size).toBe(32);
    expect(tight.valuesRead).toBe(32);
    expect(tight.valuesToRead).toBe(40);
    expect(tight.ranOutBy).toBe("store");
    expect(tight.getWarnings()[0]).toContain("32 of 40 free-text values");
  });

  test("charges what the model's thread measured, not the wait for it", async () => {
    const model: FakeModel = fakeModel({
      millisecondsPerBatch: 900,
      reportElapsed: 40,
    });
    const budget: ModelStoreBudget = storeBudget();

    await recognizerOf(model).recognize(["Maria"], budget);
    expect(budget.spentInMs).toBe(40);
  });

  test("a runner that fails fails the reading, and its time is still charged", async () => {
    const budget: ModelStoreBudget = storeBudget();
    const recognizer: NameAddressRecognizer = new NameAddressRecognizer({
      tokenizer,
      runner: async (): Promise<ModelBatchResult> => {
        throw new Error("The model took too long on a batch.");
      },
      now: ((): (() => number) => {
        let now: number = 0;

        return (): number => {
          now += 25;
          return now;
        };
      })(),
    });

    await expect(recognizer.recognize(["Maria"], budget)).rejects.toThrow(
      "The model took too long on a batch.",
    );
    expect(budget.spentInMs).toBe(25);
  });

  test("refuses logits of another number of labels than the model has", async () => {
    const model: FakeModel = fakeModel({ labels: 5 });

    await expect(
      recognizerOf(model).recognize(["Maria"], storeBudget()),
    ).rejects.toThrow("The model gave 5 labels for each piece; it has 9.");
  });
});

describe("getNameAddressRecognizer without the model's files", () => {
  test("gives no recogniser and the reason, and remembers it rather than looking at every scan", async () => {
    await closeNameAddressRecognizer();

    const empty: string = fs.mkdtempSync(path.join(os.tmpdir(), "no-model-"));

    try {
      const first: RecognizerAvailability = await getNameAddressRecognizer({
        directory: empty,
      });

      expect(first).toEqual({
        reason: "the model's model_quantized.onnx is not installed",
      });

      // Files that appear now are not looked for until the retry time passes.
      const second: RecognizerAvailability = await getNameAddressRecognizer({
        directory: empty,
      });

      expect(second).toEqual(first);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
      await closeNameAddressRecognizer();
    }
  });

  test("files that are not the pinned ones are refused, by name", async () => {
    await closeNameAddressRecognizer();

    const directory: string = fs.mkdtempSync(
      path.join(os.tmpdir(), "bad-model-"),
    );

    try {
      fs.writeFileSync(
        path.join(directory, "model_quantized.onnx"),
        "not the model",
      );

      expect(await getNameAddressRecognizer({ directory })).toEqual({
        reason: "the model's model_quantized.onnx is not the pinned file",
      });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
      await closeNameAddressRecognizer();
    }
  });
});
