import { JSONObject } from "../../../Types/JSON";
import {
  cutLogText,
  cutLogValue,
  cutLogValues,
  getLeftOutMarker,
  MAX_LOG_VALUE_LENGTH,
} from "../../../Types/Workflow/RunLogValues";
import { MAX_TRACE_VALUE_LENGTH } from "../../../Types/Workflow/StepTrace";
import { describe, expect, test } from "@jest/globals";

/*
 * HOW MUCH OF EACH VALUE A WORKFLOW RUN'S TEXT LOG WRITES (#11476): up to
 * 65,536 characters, then how many were left out. Through the runner, with
 * secrets and sensitive values: App's RunWorkflowLogValues.
 */

describe("the limit", () => {
  test("64 KB of text: 65,536 characters, roomier than the Steps view's", () => {
    expect(MAX_LOG_VALUE_LENGTH).toBe(65536);
    expect(MAX_LOG_VALUE_LENGTH).toBeGreaterThan(MAX_TRACE_VALUE_LENGTH);
  });

  test("the marker says how many characters were left out, in digits grouped as English groups them", () => {
    expect(getLeftOutMarker(1)).toBe("… (1 more characters left out)");
    expect(getLeftOutMarker(10420113)).toBe(
      "… (10,420,113 more characters left out)",
    );
  });
});

describe("cutLogText", () => {
  test("a text that fits is written whole, the longest that fits too", () => {
    expect(cutLogText("short")).toBe("short");

    const exactly: string = "x".repeat(MAX_LOG_VALUE_LENGTH);

    expect(cutLogText(exactly)).toBe(exactly);
  });

  test("one character over: cut, with one left out", () => {
    const over: string = "x".repeat(MAX_LOG_VALUE_LENGTH + 1);

    expect(cutLogText(over)).toBe(
      "x".repeat(MAX_LOG_VALUE_LENGTH) + getLeftOutMarker(1),
    );
  });

  test("ten megabytes: the first 65,536 characters, and how many more there were", () => {
    const tenMegabytes: string = "a".repeat(10 * 1024 * 1024);
    const cut: string = cutLogText(tenMegabytes);

    expect(cut.startsWith("a".repeat(MAX_LOG_VALUE_LENGTH))).toBe(true);
    expect(
      cut.endsWith(getLeftOutMarker(10 * 1024 * 1024 - MAX_LOG_VALUE_LENGTH)),
    ).toBe(true);
    expect(cut.length).toBeLessThan(MAX_LOG_VALUE_LENGTH + 64);
  });

  test("a character written as two is never split: the cut is made before it", () => {
    // "x" fills all but the last place; the emoji's two halves straddle the cut.
    const text: string = "x".repeat(MAX_LOG_VALUE_LENGTH - 1) + "😀" + "tail";
    const cut: string = cutLogText(text);

    expect(cut).toBe(
      "x".repeat(MAX_LOG_VALUE_LENGTH - 1) + getLeftOutMarker(6),
    );
    // What is kept holds no half of a character.
    expect(cut.slice(0, MAX_LOG_VALUE_LENGTH - 1).includes("\ud83d")).toBe(
      false,
    );
  });

  test("a character written as two that fits whole is kept whole", () => {
    const text: string = "x".repeat(MAX_LOG_VALUE_LENGTH - 2) + "😀" + "tail";

    expect(cutLogText(text)).toBe(
      "x".repeat(MAX_LOG_VALUE_LENGTH - 2) + "😀" + getLeftOutMarker(4),
    );
  });
});

describe("cutLogValue", () => {
  test("a text, as cutLogText cuts it", () => {
    const long: string = "b".repeat(MAX_LOG_VALUE_LENGTH + 10);

    expect(cutLogValue(long)).toBe(cutLogText(long));
  });

  test("numbers, booleans and nothing as they are", () => {
    for (const value of [0, 42, -1.5, true, false, null]) {
      expect(cutLogValue(value)).toBe(value);
    }

    expect(cutLogValue(undefined as never)).toBeUndefined();
  });

  test("a list or an object that fits, as it is", () => {
    const value: JSONObject = { status: 200, body: "ok" };

    expect(cutLogValue(value)).toBe(value);
    expect(cutLogValue([1, 2, 3])).toEqual([1, 2, 3]);
  });

  test("one too long: its JSON, cut - a string, since half an object is not one", () => {
    const value: JSONObject = { body: "c".repeat(MAX_LOG_VALUE_LENGTH * 2) };
    const cut: unknown = cutLogValue(value);
    const json: string = JSON.stringify(value);

    expect(typeof cut).toBe("string");
    expect(cut).toBe(
      json.slice(0, MAX_LOG_VALUE_LENGTH) +
        getLeftOutMarker(json.length - MAX_LOG_VALUE_LENGTH),
    );
  });

  test("a value that cannot be written as JSON says so instead of throwing", () => {
    const loop: Record<string, unknown> = {};
    loop["self"] = loop;

    expect(cutLogValue(loop as never)).toBe("[value could not be logged]");
  });
});

describe("cutLogValues: a step's arguments or returned values", () => {
  test("each value cut on its own: a long one does not cut the next one off", () => {
    const values: JSONObject = {
      body: "d".repeat(MAX_LOG_VALUE_LENGTH + 100),
      status: 200,
      subject: "Checkout is down",
    };

    expect(cutLogValues(values)).toEqual({
      body: "d".repeat(MAX_LOG_VALUE_LENGTH) + getLeftOutMarker(100),
      status: 200,
      subject: "Checkout is down",
    });
  });

  test("a copy: the values are never changed", () => {
    const values: JSONObject = { body: "e".repeat(MAX_LOG_VALUE_LENGTH + 1) };

    cutLogValues(values);

    expect((values["body"] as string).length).toBe(MAX_LOG_VALUE_LENGTH + 1);
  });

  test("no values, none written", () => {
    expect(cutLogValues({})).toEqual({});
    expect(cutLogValues(undefined as never)).toEqual({});
  });
});
