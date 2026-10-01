/*
 * The cut-down copy a trace keeps of a value too big to keep whole.
 *
 * truncateTraceValue keeps such a value as cut-off JSON text, which nothing
 * can read a field out of - and a real webhook body (a GitHub event, an
 * Alertmanager group) is often that big. The copy keeps its shape within the
 * same limit, so the value picker can still list what is inside it.
 */

import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";
import {
  MAX_TRACE_VALUE_LENGTH,
  sampleTraceValue,
  sampleTraceValues,
  truncateTraceValue,
} from "../../../Types/Workflow/StepTrace";
import {
  STEP_SAMPLE_REDACTED_VALUE,
  StepSampleField,
  StepSampleValue,
  describeSampleValue,
} from "../../../Types/Workflow/StepSamples";
import { describe, expect, test } from "@jest/globals";

type GitHubLikeEventFunction = () => JSONObject;

// A body shaped like a real webhook event, comfortably over the limit.
const gitHubLikeEvent: GitHubLikeEventFunction = (): JSONObject => {
  const labels: JSONArray = [];

  for (let index: number = 0; index < 40; index++) {
    labels.push({
      id: index,
      name: `label-${index}`,
      color: "ededed",
      description: "x".repeat(200),
    });
  }

  return {
    action: "opened",
    issue: {
      title: "Database is down",
      body: "y".repeat(3000),
      number: 42,
      labels: labels,
      user: { login: "ada", id: 1, site_admin: false },
    },
    repository: { full_name: "acme/api", private: true },
    sender: { login: "ada" },
  };
};

type LengthFunction = (value: JSONValue | undefined) => number;

const lengthOf: LengthFunction = (value: JSONValue | undefined): number => {
  return JSON.stringify(value).length;
};

describe("sampleTraceValue", () => {
  test("is not needed for a value that fits: the trace has it whole", () => {
    expect(sampleTraceValue({ a: 1, b: [1, 2, 3] })).toBeUndefined();
  });

  test("is not needed for text, a number or nothing", () => {
    expect(sampleTraceValue("x".repeat(10000))).toBeUndefined();
    expect(sampleTraceValue(5)).toBeUndefined();
    expect(sampleTraceValue(null)).toBeUndefined();
    expect(sampleTraceValue(true)).toBeUndefined();
  });

  test("keeps a large body's shape within the trace's limit", () => {
    const event: JSONObject = gitHubLikeEvent();

    expect(lengthOf(event)).toBeGreaterThan(MAX_TRACE_VALUE_LENGTH);
    // What the trace itself keeps of it: text nothing can be read out of.
    expect(typeof truncateTraceValue(event)).toBe("string");

    const sample: JSONValue | undefined = sampleTraceValue(event);

    expect(sample).toBeDefined();
    expect(lengthOf(sample)).toBeLessThanOrEqual(MAX_TRACE_VALUE_LENGTH);

    const sampleObject: JSONObject = sample as JSONObject;

    expect(Object.keys(sampleObject)).toEqual([
      "action",
      "issue",
      "repository",
      "sender",
    ]);
    expect(sampleObject["action"]).toBe("opened");
    expect((sampleObject["issue"] as JSONObject)["title"]).toBe(
      "Database is down",
    );
    expect(
      ((sampleObject["issue"] as JSONObject)["user"] as JSONObject)["login"],
    ).toBe("ada");
  });

  test("keeps the first items of a list and cuts long text", () => {
    const sample: JSONObject = sampleTraceValue(
      gitHubLikeEvent(),
    ) as JSONObject;
    const issue: JSONObject = sample["issue"] as JSONObject;
    const labels: JSONArray = issue["labels"] as JSONArray;

    expect(labels.length).toBeGreaterThanOrEqual(1);
    expect(labels.length).toBeLessThan(40);
    expect((labels[0] as JSONObject)["name"]).toBe("label-0");
    expect((issue["body"] as string).endsWith("…")).toBe(true);
    expect((issue["body"] as string).length).toBeLessThan(3000);
  });

  test("its fields read as the original's, for the picker", () => {
    const value: StepSampleValue = describeSampleValue(
      sampleTraceValue(gitHubLikeEvent()),
      { ranAt: "2026-10-01T12:00:00.000Z", isCutDownCopy: true },
    );
    const paths: Array<string> = value.fields.map((field: StepSampleField) => {
      return field.path;
    });

    expect(paths).toEqual(
      expect.arrayContaining([
        "action",
        "issue.title",
        "issue.number",
        "issue.labels[0].name",
        "issue.user.login",
        "repository.full_name",
      ]),
    );
    expect(value.isPartial).toBe(true);
  });

  test("never cuts what the run redacted", () => {
    const value: JSONObject = {
      token: STEP_SAMPLE_REDACTED_VALUE,
      padding: "z".repeat(MAX_TRACE_VALUE_LENGTH * 3),
    };

    const sample: JSONObject = sampleTraceValue(value) as JSONObject;

    expect(sample["token"]).toBe(STEP_SAMPLE_REDACTED_VALUE);
  });

  test("a very wide object still comes back within the limit, or not at all", () => {
    const wide: JSONObject = {};

    for (let index: number = 0; index < 5000; index++) {
      wide[`field_${index}`] = `value ${index}`;
    }

    const sample: JSONValue | undefined = sampleTraceValue(wide);

    expect(sample).toBeDefined();
    expect(lengthOf(sample)).toBeLessThanOrEqual(MAX_TRACE_VALUE_LENGTH);
    expect(Object.keys(sample as JSONObject)[0]).toBe("field_0");
  });

  test("a list too big to keep keeps its first items", () => {
    const list: JSONArray = [];

    for (let index: number = 0; index < 500; index++) {
      list.push({ id: index, name: `item ${index}` });
    }

    const sample: JSONArray = sampleTraceValue(list) as JSONArray;

    expect(Array.isArray(sample)).toBe(true);
    expect((sample[0] as JSONObject)["name"]).toBe("item 0");
    expect(lengthOf(sample)).toBeLessThanOrEqual(MAX_TRACE_VALUE_LENGTH);
  });

  test("is the same every time for the same value", () => {
    expect(sampleTraceValue(gitHubLikeEvent())).toEqual(
      sampleTraceValue(gitHubLikeEvent()),
    );
  });

  test("gives up on a value it cannot serialize", () => {
    const circular: JSONObject = { padding: "p".repeat(5000) };
    circular["self"] = circular;

    expect(sampleTraceValue(circular)).toBeUndefined();
  });
});

describe("sampleTraceValues", () => {
  test("a copy for each value that needs one, by the same key", () => {
    const samples: JSONObject = sampleTraceValues({
      "request-body": gitHubLikeEvent(),
      "request-headers": { host: "example.com" },
      "request-params": {},
    });

    expect(Object.keys(samples)).toEqual(["request-body"]);
  });

  test("nothing when every value fits", () => {
    expect(sampleTraceValues({ a: { b: 1 } })).toEqual({});
    expect(sampleTraceValues({})).toEqual({});
  });
});
