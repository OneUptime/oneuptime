import {
  FIELD_ANSWER_LIFETIME_IN_DAYS,
  FieldAnswer,
  FieldSuggestionState,
  getFieldAnswerKey,
  keepStandingAnswers,
  MAX_FIELD_ANSWERS,
  readFieldSuggestionState,
  toStoredFieldSuggestionState,
  withPendingFields,
} from "../../../../Server/Utils/DataSecurity/FieldSuggestionState";
import { DataStoreLocationKind } from "../../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import { JSONObject } from "../../../../Types/JSON";
import {
  MAX_UNPLACED_FIELDS_PER_SCAN,
  UnplacedField,
} from "../../../../Utils/DataSecurity/UnplacedFields";
import { describe, expect, test } from "@jest/globals";

/*
 * A store's fields no detector placed and OneUptime AI's answers about them
 * (DataStore.fieldSuggestionState), read defensively and kept bounded.
 */

const NOW: Date = new Date("2026-10-27T12:00:00.000Z");
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
// A hash of what was asked: 32 hexadecimal digits.
const ANSWER_KEY: RegExp = /^[0-9a-f]{32}$/;

function field(location: string, shape: string = "AA-999999"): UnplacedField {
  return {
    location,
    locationKind: DataStoreLocationKind.Column,
    neighbours: ["email"],
    shapes: [{ shape, share: 1 }],
    valueCount: 20,
    averageLength: 9,
  };
}

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY_IN_MS).toISOString();
}

describe("getFieldAnswerKey", () => {
  test("is the same while the field looks the same, and another when it does not", () => {
    const key: string = getFieldAnswerKey(field("t.kundennr"));

    expect(key).toMatch(ANSWER_KEY);
    expect(getFieldAnswerKey({ ...field("t.kundennr"), valueCount: 3 })).toBe(
      key,
    );
    expect(getFieldAnswerKey(field("t.kundennr", "99999"))).not.toBe(key);
    expect(getFieldAnswerKey(field("t.kunde"))).not.toBe(key);
  });
});

describe("readFieldSuggestionState", () => {
  test("anything that is not a state is an empty one", () => {
    for (const value of [undefined, null, "state", 7, [], { pending: "x" }]) {
      expect(readFieldSuggestionState(value)).toEqual({
        pending: [],
        scannedAt: undefined,
        answers: {},
      });
    }
  });

  test("reads back what is stored", () => {
    const state: FieldSuggestionState = {
      pending: [field("t.kundennr")],
      scannedAt: NOW.toISOString(),
      answers: {
        a: { at: daysAgo(1), dataTypeId: "de-tax-id", reason: "Steuer." },
        b: { at: daysAgo(2) },
      },
    };

    expect(
      readFieldSuggestionState(
        JSON.parse(JSON.stringify(toStoredFieldSuggestionState(state))),
      ),
    ).toEqual(state);
  });

  test("leaves out answers that are not answers, and fields that are not fields", () => {
    const state: FieldSuggestionState = readFieldSuggestionState({
      pending: [
        field("t.kundennr"),
        { ...field("t.bad"), locationKind: "Table" },
        { ...field("t.value"), shapes: [{ shape: "Jane", share: 1 }] },
      ],
      scannedAt: "yesterday",
      answers: {
        good: { at: daysAgo(1), dataTypeId: "iban" },
        noDate: { dataTypeId: "iban" },
        badDate: { at: "soon" },
        longType: { at: daysAgo(1), dataTypeId: "x".repeat(101) },
        list: [],
        [`${"k".repeat(65)}`]: { at: daysAgo(1) },
      },
    });

    expect(
      state.pending.map((entry: UnplacedField) => {
        return entry.location;
      }),
    ).toEqual(["t.kundennr"]);
    expect(state.scannedAt).toBeUndefined();
    expect(state.answers).toEqual({
      good: { at: daysAgo(1), dataTypeId: "iban" },
      longType: { at: daysAgo(1) },
    });
  });

  test("a reason is kept only with a type, and held to its length", () => {
    const state: FieldSuggestionState = readFieldSuggestionState({
      answers: {
        typed: { at: daysAgo(1), dataTypeId: "iban", reason: "r".repeat(900) },
        none: { at: daysAgo(1), reason: "No type." },
      },
    });

    expect(state.answers["typed"]!.reason).toHaveLength(300);
    expect(state.answers["none"]).toEqual({ at: daysAgo(1) });
  });

  test("reads at most MAX_FIELD_ANSWERS answers", () => {
    const answers: Record<string, JSONObject> = {};

    for (let index: number = 0; index < MAX_FIELD_ANSWERS + 40; index++) {
      answers[`k${index}`] = { at: daysAgo(1) };
    }

    expect(
      Object.keys(readFieldSuggestionState({ answers }).answers),
    ).toHaveLength(MAX_FIELD_ANSWERS);
  });
});

describe("keepStandingAnswers", () => {
  test("an answer stands for a month, the newest first, never one from the future", () => {
    const answers: Record<string, FieldAnswer> = {
      old: { at: daysAgo(FIELD_ANSWER_LIFETIME_IN_DAYS + 1) },
      edge: { at: daysAgo(FIELD_ANSWER_LIFETIME_IN_DAYS) },
      week: { at: daysAgo(7), dataTypeId: "iban" },
      today: { at: daysAgo(0) },
      future: { at: new Date(NOW.getTime() + DAY_IN_MS).toISOString() },
    };

    expect(Object.keys(keepStandingAnswers(answers, NOW))).toEqual([
      "today",
      "week",
      "edge",
    ]);
  });

  test("keeps the newest MAX_FIELD_ANSWERS", () => {
    const answers: Record<string, FieldAnswer> = {};

    for (let index: number = 0; index < MAX_FIELD_ANSWERS + 10; index++) {
      answers[`k${index}`] = {
        at: new Date(NOW.getTime() - index * 60 * 1000).toISOString(),
      };
    }

    const kept: Record<string, FieldAnswer> = keepStandingAnswers(answers, NOW);

    expect(Object.keys(kept)).toHaveLength(MAX_FIELD_ANSWERS);
    expect(kept["k0"]).toBeDefined();
    expect(kept[`k${MAX_FIELD_ANSWERS + 5}`]).toBeUndefined();
  });
});

describe("withPendingFields", () => {
  test("the scan's fields are the pending ones; the answers that stand are kept", () => {
    const stored: JSONObject = withPendingFields({
      previous: {
        pending: [field("t.gone")],
        scannedAt: daysAgo(1),
        answers: {
          kept: { at: daysAgo(3), dataTypeId: "iban", reason: "Bank." },
          expired: { at: daysAgo(40) },
        },
      },
      pending: [field("t.kundennr")],
      scannedAt: NOW,
    });

    expect(stored).toEqual({
      pending: [field("t.kundennr")],
      scannedAt: NOW.toISOString(),
      answers: {
        kept: { at: daysAgo(3), dataTypeId: "iban", reason: "Bank." },
      },
    });
  });

  test("from nothing, and at most MAX_UNPLACED_FIELDS_PER_SCAN fields", () => {
    const many: Array<UnplacedField> = Array.from(
      { length: MAX_UNPLACED_FIELDS_PER_SCAN + 20 },
      (_value: unknown, index: number) => {
        return field(`t.c${index}`);
      },
    );
    const stored: JSONObject = withPendingFields({
      previous: undefined,
      pending: many,
      scannedAt: NOW,
    });

    expect(stored["pending"]).toHaveLength(MAX_UNPLACED_FIELDS_PER_SCAN);
    expect(stored["answers"]).toEqual({});
  });
});
