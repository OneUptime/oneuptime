import { describe, expect, test } from "@jest/globals";
import {
  RecognitionMap,
  UnavailableRecognizer,
} from "../../../../../Server/Utils/DataSecurity/Model/EntityRecognizer";
import {
  CONTENT_SCAN_MODEL_TIME_IN_MS,
  ModelBudget,
  TELEMETRY_SCAN_MODEL_TIME_IN_MS,
} from "../../../../../Server/Utils/DataSecurity/Model/ModelBudget";
import {
  createModelScanContext,
  getModelWarnings,
  ModelScanContext,
  recognizeFields,
  recognizeTexts,
} from "../../../../../Server/Utils/DataSecurity/Model/ModelScan";
import {
  MODEL_MAX_CHARACTERS_PER_FIELD,
  MODEL_MAX_VALUES_PER_FIELD,
} from "../../../../../Utils/DataSecurity/FieldClassifier";
import { ModelRecognitions } from "../../../../../Utils/DataSecurity/Model/RecognizedEntity";
import FakeEntityRecognizer, { ISSUE_SENTENCE } from "./FakeEntityRecognizer";

/*
 * What a scan does with the model: whether it has one at all, what it hands
 * it, and what the store's warnings say afterwards.
 */

function contextOf(
  recognizer: FakeEntityRecognizer,
  storeLimitInMs: number = 1e9,
): ModelScanContext {
  return {
    recognizer,
    budget: new ModelBudget({ scanLimitInMs: 1e9, storeLimitInMs }),
  };
}

// A note long enough that its field is free text.
function note(index: number): string {
  return `Customer note ${index}: the courier rang twice and nobody answered the door, so the parcel went back to the depot. It goes out again tomorrow.`;
}

describe("createModelScanContext", () => {
  test("a project with the model off scans without it", async () => {
    let asked: boolean = false;

    expect(
      await createModelScanContext({
        isEnabled: false,
        scope: "content",
        place: "server",
        getRecognizer: async () => {
          asked = true;
          return { reason: "never asked" };
        },
      }),
    ).toBeUndefined();
    // The model is not even loaded for it.
    expect(asked).toBe(false);
  });

  test("a project with it on gets the process's recogniser and the scope's budget", async () => {
    const recognizer: FakeEntityRecognizer = new FakeEntityRecognizer();
    const content: ModelScanContext | undefined = await createModelScanContext({
      isEnabled: true,
      scope: "content",
      place: "server",
      getRecognizer: async () => {
        return { recognizer };
      },
    });
    const telemetry: ModelScanContext | undefined =
      await createModelScanContext({
        isEnabled: true,
        scope: "telemetry",
        place: "server",
        getRecognizer: async () => {
          return { recognizer };
        },
      });

    expect(content?.recognizer).toBe(recognizer);
    expect(content?.budget.limitInMs).toBe(CONTENT_SCAN_MODEL_TIME_IN_MS);
    expect(telemetry?.budget.limitInMs).toBe(TELEMETRY_SCAN_MODEL_TIME_IN_MS);
  });

  test("where the model cannot run, a recogniser that reads nothing, and a warning naming the probe or server", async () => {
    const context: ModelScanContext | undefined = await createModelScanContext({
      isEnabled: true,
      scope: "content",
      place: "probe",
      getRecognizer: async () => {
        return { reason: "the model's vocab.txt is not installed" };
      },
    });

    expect(context?.recognizer).toBeInstanceOf(UnavailableRecognizer);
    expect(await recognizeTexts(context, "store", [note(1)])).toBeUndefined();
    expect(getModelWarnings(context, "store")).toEqual([
      "Names and street addresses in free text were not looked for: the model's vocab.txt is not installed on this probe.",
    ]);
  });

  test("a recogniser that throws while loading is a model that could not start", async () => {
    const context: ModelScanContext | undefined = await createModelScanContext({
      isEnabled: true,
      scope: "content",
      place: "server",
      getRecognizer: async () => {
        throw new Error("boom");
      },
    });

    await recognizeTexts(context, "store", [note(1)]);
    expect(getModelWarnings(context, "store")).toEqual([
      "Names and street addresses in free text were not looked for: the model could not start on this server.",
    ]);
  });
});

describe("recognizeTexts", () => {
  test("hands the recogniser each different, non-blank text once, and gives back what it found", async () => {
    const recognizer: FakeEntityRecognizer = new FakeEntityRecognizer();
    const found: RecognitionMap | undefined = await recognizeTexts(
      contextOf(recognizer),
      "store",
      [ISSUE_SENTENCE, ISSUE_SENTENCE, "   ", "Nothing to see here"],
    );

    expect(recognizer.given).toEqual([ISSUE_SENTENCE, "Nothing to see here"]);
    expect(found?.get(ISSUE_SENTENCE)?.length).toBe(2);
    expect(found?.get("Nothing to see here")).toEqual([]);
    expect(found?.hasEntities).toBe(true);
  });

  test("nothing to read, or no model, is no recognitions", async () => {
    const recognizer: FakeEntityRecognizer = new FakeEntityRecognizer();

    expect(
      await recognizeTexts(contextOf(recognizer), "store", []),
    ).toBeUndefined();
    expect(
      await recognizeTexts(undefined, "store", [ISSUE_SENTENCE]),
    ).toBeUndefined();
    expect(recognizer.calls).toBe(0);
  });

  test("a recogniser that stops part-way leaves the scan to go on without it, and says so", async () => {
    const recognizer: FakeEntityRecognizer = new FakeEntityRecognizer({
      failWith: new Error("Maria Gonzalez broke the model"),
    });
    const context: ModelScanContext = contextOf(recognizer);

    expect(
      await recognizeTexts(context, "store", [ISSUE_SENTENCE]),
    ).toBeUndefined();

    const warnings: Array<string> = getModelWarnings(context, "store");

    expect(warnings).toEqual([
      "Names and street addresses in free text were not looked for: the model stopped part-way through this scan.",
    ]);
    // Nothing the recogniser said, a value among it, reaches the warning.
    expect(warnings.join(" ")).not.toContain("Maria");
  });

  test("each store keeps its own count and its own warnings", async () => {
    const recognizer: FakeEntityRecognizer = new FakeEntityRecognizer({
      millisecondsPerText: 10,
    });
    const context: ModelScanContext = contextOf(recognizer, 15);

    await recognizeTexts(context, "logs:a", [note(1), note(2), note(3)]);
    await recognizeTexts(context, "logs:b", [note(4)]);

    expect(getModelWarnings(context, "logs:a")).toEqual([
      "Names and street addresses were looked for in 2 of 3 free-text values: this store's 1 second of model time ran out.",
    ]);
    expect(getModelWarnings(context, "logs:b")).toEqual([]);
  });
});

describe("recognizeFields", () => {
  test("reads free-text fields, and the ones the scan marks as read with the model, and no others", async () => {
    const recognizer: FakeEntityRecognizer = new FakeEntityRecognizer();
    const recognitions: ModelRecognitions | undefined = await recognizeFields(
      contextOf(recognizer),
      "store",
      [
        {
          path: "public.orders.status",
          values: ["shipped", "pending", "shipped"],
        },
        { path: "public.orders.note", values: [note(1), ISSUE_SENTENCE, null] },
        { path: "body", values: [ISSUE_SENTENCE], readWithModel: true },
        { path: "public.orders.email", values: ["a@example.com"] },
      ],
    );

    expect(recognizer.given).toEqual([note(1), ISSUE_SENTENCE]);
    expect(recognitions?.get(ISSUE_SENTENCE)?.length).toBe(2);
    expect(recognitions?.get("shipped")).toBeUndefined();
  });

  test(`reads at most ${MODEL_MAX_VALUES_PER_FIELD} different values of one field, and ${MODEL_MAX_CHARACTERS_PER_FIELD} characters of them`, async () => {
    const recognizer: FakeEntityRecognizer = new FakeEntityRecognizer();
    const many: Array<string> = Array.from(
      { length: 300 },
      (_: unknown, index: number): string => {
        return note(index % 150);
      },
    );

    await recognizeFields(contextOf(recognizer), "store", [
      { path: "notes", values: many },
    ]);
    expect(recognizer.given).toHaveLength(MODEL_MAX_VALUES_PER_FIELD);
    expect(new Set(recognizer.given).size).toBe(MODEL_MAX_VALUES_PER_FIELD);

    const long: FakeEntityRecognizer = new FakeEntityRecognizer();
    const essays: Array<string> = Array.from(
      { length: 10 },
      (_: unknown, index: number): string => {
        return `${index} ${"long free text ".repeat(800)}`;
      },
    );

    await recognizeFields(contextOf(long), "store", [
      { path: "essays", values: essays },
    ]);

    const characters: number = long.given.reduce(
      (sum: number, text: string): number => {
        return sum + text.length;
      },
      0,
    );

    expect(long.given.length).toBeLessThan(10);
    expect(characters).toBeLessThanOrEqual(MODEL_MAX_CHARACTERS_PER_FIELD);
  });

  test("one value longer than the field's characters is still read", async () => {
    const recognizer: FakeEntityRecognizer = new FakeEntityRecognizer();
    const essay: string = "free text ".repeat(4000);

    await recognizeFields(contextOf(recognizer), "store", [
      { path: "essay", values: [essay] },
    ]);
    expect(recognizer.given).toEqual([essay.trim().slice(0, 16_384)]);
  });
});
