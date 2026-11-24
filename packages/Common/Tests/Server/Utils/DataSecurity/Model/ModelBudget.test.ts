import { describe, expect, test } from "@jest/globals";
import {
  CONTENT_SCAN_MODEL_TIME_IN_MS,
  describeDuration,
  ModelBudget,
  ModelStoreBudget,
  TELEMETRY_SCAN_MODEL_TIME_IN_MS,
  TELEMETRY_STORE_MODEL_TIME_IN_MS,
} from "../../../../../Server/Utils/DataSecurity/Model/ModelBudget";

/*
 * The model's time is budgeted per scan and per store, as bytes are, and a
 * scan that runs out says how much the model read - never what.
 */

describe("ModelBudget", () => {
  test("a content scan gives its one store the scan's two minutes; the telemetry scan gives each store a slice of its minute", () => {
    const content: ModelBudget = ModelBudget.forScope("content");
    const telemetry: ModelBudget = ModelBudget.forScope("telemetry");

    expect(content.limitInMs).toBe(CONTENT_SCAN_MODEL_TIME_IN_MS);
    expect(content.storeLimitInMs).toBe(CONTENT_SCAN_MODEL_TIME_IN_MS);
    expect(CONTENT_SCAN_MODEL_TIME_IN_MS).toBe(120_000);
    expect(telemetry.limitInMs).toBe(TELEMETRY_SCAN_MODEL_TIME_IN_MS);
    expect(telemetry.storeLimitInMs).toBe(TELEMETRY_STORE_MODEL_TIME_IN_MS);
    expect(TELEMETRY_STORE_MODEL_TIME_IN_MS).toBeLessThan(
      TELEMETRY_SCAN_MODEL_TIME_IN_MS,
    );
  });

  test("a store's budget is the same object every time it is asked for", () => {
    const budget: ModelBudget = new ModelBudget({
      scanLimitInMs: 100,
      storeLimitInMs: 50,
    });

    expect(budget.forStore("logs:a")).toBe(budget.forStore("logs:a"));
    expect(budget.forStore("logs:a")).not.toBe(budget.forStore("logs:b"));
  });

  test("a store may spend until its own share or the scan's is used, whichever comes first", () => {
    const budget: ModelBudget = new ModelBudget({
      scanLimitInMs: 100,
      storeLimitInMs: 60,
    });
    const first: ModelStoreBudget = budget.forStore("a");
    const second: ModelStoreBudget = budget.forStore("b");

    expect(first.canSpend()).toBe(true);
    first.charge(60);
    expect(first.canSpend()).toBe(false);
    expect(first.spentInMs).toBe(60);
    expect(budget.spentInMs).toBe(60);
    // The second store has its own 60, of which the scan has 40 left.
    expect(second.remainingInMs).toBe(40);
    second.charge(40);
    expect(second.canSpend()).toBe(false);
    expect(budget.remainingInMs).toBe(0);
  });

  test("a negative charge counts as nothing", () => {
    const budget: ModelBudget = new ModelBudget({
      scanLimitInMs: 10,
      storeLimitInMs: 10,
    });

    budget.forStore("a").charge(-5);
    expect(budget.spentInMs).toBe(0);
  });

  test("says nothing when the model read every value, or had none to read", () => {
    const budget: ModelBudget = new ModelBudget({
      scanLimitInMs: 100,
      storeLimitInMs: 100,
    });

    expect(budget.forStore("a").getWarnings()).toEqual([]);
    budget.forStore("b").noteValues({ toRead: 3, read: 3 });
    expect(budget.forStore("b").getWarnings()).toEqual([]);
  });

  test("says how many free-text values the model read when the store's time ran out", () => {
    const budget: ModelBudget = new ModelBudget({
      scanLimitInMs: 120_000,
      storeLimitInMs: 6_000,
    });
    const store: ModelStoreBudget = budget.forStore("a");

    store.charge(6_000);
    expect(store.canSpend()).toBe(false);
    store.noteValues({ toRead: 500, read: 120 });

    expect(store.ranOutBy).toBe("store");
    expect(store.valuesToRead).toBe(500);
    expect(store.valuesRead).toBe(120);
    expect(store.getWarnings()).toEqual([
      "Names and street addresses were looked for in 120 of 500 free-text values: this store's 6 seconds of model time ran out.",
    ]);
  });

  test("names the scan's budget when it was the scan's time that ran out", () => {
    const budget: ModelBudget = new ModelBudget({
      scanLimitInMs: 120_000,
      storeLimitInMs: 120_000,
    });
    const store: ModelStoreBudget = budget.forStore("a");

    budget.forStore("b").charge(120_000);
    expect(store.canSpend()).toBe(false);
    store.noteValues({ toRead: 40, read: 0 });

    expect(store.getWarnings()).toEqual([
      "Names and street addresses were looked for in 0 of 40 free-text values: the scan's 2 minutes of model time ran out.",
    ]);
  });

  test("adds up what each read was given, and never counts more read than given", () => {
    const store: ModelStoreBudget = new ModelBudget({
      scanLimitInMs: 100,
      storeLimitInMs: 100,
    }).forStore("a");

    store.noteValues({ toRead: 10, read: 10 });
    store.noteValues({ toRead: 5, read: 9 });
    expect(store.valuesToRead).toBe(15);
    expect(store.valuesRead).toBe(15);
  });

  test("says why the model did not run, once there was free text to read", () => {
    const store: ModelStoreBudget = new ModelBudget({
      scanLimitInMs: 100,
      storeLimitInMs: 100,
    }).forStore("a");

    store.noteUnavailable(
      "the model's model_quantized.onnx is not installed on this probe",
      0,
    );
    expect(store.getWarnings()).toEqual([]);

    store.noteUnavailable("another reason", 12);
    expect(store.getWarnings()).toEqual([
      "Names and street addresses in free text were not looked for: the model's model_quantized.onnx is not installed on this probe.",
    ]);
  });

  test("its warnings never carry anything but counts and durations", () => {
    const store: ModelStoreBudget = new ModelBudget({
      scanLimitInMs: 1,
      storeLimitInMs: 1,
    }).forStore("Maria Gonzalez, 14 Calle Mayor");

    store.charge(1);
    store.canSpend();
    store.noteValues({ toRead: 2, read: 1 });

    for (const warning of store.getWarnings()) {
      expect(warning).not.toContain("Maria");
      expect(warning).not.toContain("Calle");
    }
  });
});

describe("describeDuration", () => {
  test.each([
    [500, "1 second"],
    [1000, "1 second"],
    [6000, "6 seconds"],
    [60_000, "1 minute"],
    [120_000, "2 minutes"],
    [90_000, "90 seconds"],
  ])("%s ms is %s", (milliseconds: number, text: string) => {
    expect(describeDuration(milliseconds)).toBe(text);
  });
});
