import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  ModelBudget,
  REREAD_MODEL_TIME_IN_MS,
} from "../../../../../Server/Utils/DataSecurity/Model/ModelBudget";
import { ModelRereads } from "../../../../../Server/Utils/DataSecurity/Model/ModelRereads";
import { RecognizerAvailability } from "../../../../../Server/Utils/DataSecurity/Model/NameAddressRecognizer";
import logger from "../../../../../Server/Utils/Logger";
import { RecognizedEntity } from "../../../../../Utils/DataSecurity/Model/RecognizedEntity";
import FakeEntityRecognizer, { ISSUE_SENTENCE } from "./FakeEntityRecognizer";

/*
 * THE MODEL, WHERE A FINDING'S RECORDS ARE READ AGAIN (#10926).
 *
 * A finding the names-and-addresses model made can only be told in its
 * records by the model: Show the records it was seen in, Scrub It's proof
 * and the check that a code fix worked hand it the values they read, within
 * a budget of their own. Here, against the tests' fake recogniser: who gets
 * one, what it reads and remembers, what it does when it has no time or no
 * model, and that nothing of a value reaches the log.
 */

function available(
  recognizer: FakeEntityRecognizer,
): () => Promise<RecognizerAvailability> {
  return async (): Promise<RecognizerAvailability> => {
    return { recognizer };
  };
}

async function rereadsWith(
  recognizer: FakeEntityRecognizer,
  budget?: ModelBudget,
): Promise<ModelRereads> {
  const rereads: ModelRereads | null = await ModelRereads.forFinding({
    isFoundByModel: true,
    getRecognizer: available(recognizer),
    budget,
  });

  if (!rereads) {
    throw new Error("A finding the model made gets the model.");
  }

  return rereads;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("who reads a finding's records with the model", () => {
  test("only a finding the model made: any other is read with its detectors alone", async () => {
    const recognizer: FakeEntityRecognizer = new FakeEntityRecognizer();

    for (const isFoundByModel of [false, undefined, null]) {
      expect(
        await ModelRereads.forFinding({
          isFoundByModel,
          getRecognizer: available(recognizer),
        }),
      ).toBeNull();
    }

    // Not even asked for: a finding of a pattern loads no model.
    expect(recognizer.calls).toBe(0);
  });

  test("a finding the model made gets the process's model", async () => {
    const rereads: ModelRereads = await rereadsWith(new FakeEntityRecognizer());

    expect(rereads.isAvailable).toBe(true);
    expect(rereads.unavailableReason).toBeNull();
    expect(rereads.isOutOfTime).toBe(false);
  });

  test("where the model is not installed, it says why, on this server", async () => {
    const rereads: ModelRereads | null = await ModelRereads.forFinding({
      isFoundByModel: true,
      getRecognizer: async (): Promise<RecognizerAvailability> => {
        return {
          reason: "the model's model_quantized.onnx is not installed",
        };
      },
    });

    expect(rereads?.isAvailable).toBe(false);
    expect(rereads?.unavailableReason).toBe(
      "the model's model_quantized.onnx is not installed on this server",
    );
  });

  test("a model that would not start is one that cannot run", async () => {
    const rereads: ModelRereads | null = await ModelRereads.forFinding({
      isFoundByModel: true,
      getRecognizer: async (): Promise<RecognizerAvailability> => {
        throw new Error("the worker thread exited");
      },
    });

    expect(rereads?.isAvailable).toBe(false);
    expect(rereads?.unavailableReason).toBe(
      "the model could not start on this server",
    );
  });

  test("a re-read has a budget of its own, the same for the scan and its one store", () => {
    const budget: ModelBudget = ModelBudget.forScope("reread");

    expect(REREAD_MODEL_TIME_IN_MS).toBe(20_000);
    expect(budget.limitInMs).toBe(REREAD_MODEL_TIME_IN_MS);
    expect(budget.storeLimitInMs).toBe(REREAD_MODEL_TIME_IN_MS);
  });
});

describe("what it reads and remembers", () => {
  test("the values as the classifier reads them: trimmed, and each once", async () => {
    const recognizer: FakeEntityRecognizer = new FakeEntityRecognizer();
    const rereads: ModelRereads = await rereadsWith(recognizer);

    await rereads.read([`  ${ISSUE_SENTENCE}\n`, ISSUE_SENTENCE, "", "   "]);
    await rereads.read([ISSUE_SENTENCE]);

    // Handed once, trimmed: the empty ones are no text to read.
    expect(recognizer.given).toEqual([ISSUE_SENTENCE]);
    expect(rereads.valuesRead).toBe(1);
    expect(rereads.valuesNotRead).toBe(0);
    expect(rereads.isRead(ISSUE_SENTENCE)).toBe(true);
    expect(rereads.isRead(`  ${ISSUE_SENTENCE}\n`)).toBe(true);
    expect(rereads.isRead("Refund approved for nobody")).toBe(false);
    expect(rereads.isRead("")).toBe(false);
  });

  test("what it found, by the value the classifier looks it up by", async () => {
    const rereads: ModelRereads = await rereadsWith(new FakeEntityRecognizer());

    await rereads.read([ISSUE_SENTENCE, "Disk 3 is full"]);

    expect(
      (rereads.get(ISSUE_SENTENCE) || []).map(
        (entity: RecognizedEntity): string => {
          return `${entity.dataTypeId}: ${ISSUE_SENTENCE.slice(entity.start, entity.end)}`;
        },
      ),
    ).toEqual([
      "person-name: Maria Gonzalez",
      "postal-address: 14 Calle Mayor",
    ]);
    // Read, with nothing in it.
    expect(rereads.get("Disk 3 is full")).toEqual([]);
    // Never handed to it.
    expect(rereads.get("Order 7 shipped")).toBeUndefined();
  });

  test("what it found in a value as a record holds it, at its places in that value", async () => {
    const rereads: ModelRereads = await rereadsWith(new FakeEntityRecognizer());
    const value: string = `\t  ${ISSUE_SENTENCE}  `;

    await rereads.read([value]);

    const entities: Array<RecognizedEntity> = rereads.entitiesIn(value) || [];

    expect(
      entities.map((entity: RecognizedEntity): string => {
        return value.slice(entity.start, entity.end);
      }),
    ).toEqual(["Maria Gonzalez", "14 Calle Mayor"]);
    expect(rereads.entitiesIn("never read")).toBeUndefined();
    expect(rereads.entitiesIn("   ")).toBeUndefined();
  });

  test("a value cut where the classifier cuts it is the one the model reads", async () => {
    const recognizer: FakeEntityRecognizer = new FakeEntityRecognizer();
    const rereads: ModelRereads = await rereadsWith(recognizer);
    const long: string = `${ISSUE_SENTENCE} ${"x".repeat(20_000)}`;

    await rereads.read([long]);

    expect(recognizer.given[0]!.length).toBe(16_384);
    expect(rereads.isRead(long)).toBe(true);
    expect(rereads.entitiesIn(long)?.length).toBe(2);
  });
});

describe("when its time runs out", () => {
  test("what it had no time for is not read, and counted", async () => {
    const recognizer: FakeEntityRecognizer = new FakeEntityRecognizer({
      millisecondsPerText: 400,
    });
    const rereads: ModelRereads = await rereadsWith(
      recognizer,
      new ModelBudget({ scanLimitInMs: 1000, storeLimitInMs: 1000 }),
    );
    const values: Array<string> = Array.from(
      { length: 6 },
      (_: unknown, index: number): string => {
        return `Line ${index}: ${ISSUE_SENTENCE}`;
      },
    );

    await rereads.read(values);

    // 400 ms each: the third starts at 800 ms, inside the second's budget.
    expect(rereads.valuesRead).toBe(3);
    expect(rereads.valuesNotRead).toBe(3);
    expect(rereads.isOutOfTime).toBe(true);
    expect(rereads.isRead(values[2]!)).toBe(true);
    expect(rereads.isRead(values[3]!)).toBe(false);
    expect(rereads.get(values[4]!)).toBeUndefined();
  });

  test("once it is out of time, the recogniser is not asked again and the rest are counted as not read", async () => {
    const recognizer: FakeEntityRecognizer = new FakeEntityRecognizer({
      millisecondsPerText: 1000,
    });
    const rereads: ModelRereads = await rereadsWith(
      recognizer,
      new ModelBudget({ scanLimitInMs: 1000, storeLimitInMs: 1000 }),
    );

    await rereads.read(["first", "second"]);

    const calls: number = recognizer.calls;

    await rereads.read(["third", "fourth", "fifth"]);

    expect(recognizer.calls).toBe(calls);
    expect(rereads.valuesRead).toBe(1);
    expect(rereads.valuesNotRead).toBe(4);
    expect(rereads.isOutOfTime).toBe(true);
  });

  test("a model that cannot run reads nothing, and counts what it was handed", async () => {
    const rereads: ModelRereads = new ModelRereads({
      recognizer: null,
      unavailableReason: "the model could not start on this probe",
    });

    await rereads.read(["one", "two"]);

    expect(rereads.isAvailable).toBe(false);
    expect(rereads.isOutOfTime).toBe(false);
    expect(rereads.valuesRead).toBe(0);
    expect(rereads.valuesNotRead).toBe(2);
    expect(rereads.isRead("one")).toBe(false);
  });
});

describe("when the model stops part-way", () => {
  test("it is logged by what failed, never a value, and the read goes on without it", async () => {
    const errors: Array<unknown> = [];

    jest.spyOn(logger, "error").mockImplementation((message: unknown) => {
      errors.push(message);
    });

    const recognizer: FakeEntityRecognizer = new FakeEntityRecognizer({
      failWith: new TypeError(`could not read ${ISSUE_SENTENCE}`),
    });
    const rereads: ModelRereads = await rereadsWith(recognizer);

    await rereads.read([ISSUE_SENTENCE]);
    await rereads.read(["another value"]);

    expect(rereads.isAvailable).toBe(false);
    expect(rereads.unavailableReason).toBe(
      "the model stopped part-way through this read",
    );
    // Asked once: a model that stopped is not asked again.
    expect(recognizer.calls).toBe(1);
    expect(rereads.valuesNotRead).toBe(2);
    expect(errors.length).toBe(1);
    expect(String(errors[0])).toContain("TypeError");

    for (const message of errors) {
      expect(String(message)).not.toContain("Maria");
      expect(String(message)).not.toContain("Calle");
    }
  });
});
