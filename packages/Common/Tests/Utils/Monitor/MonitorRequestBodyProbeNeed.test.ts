import { describe, expect, test } from "@jest/globals";
import MonitorRequestBody from "../../../Utils/Monitor/MonitorRequestBody";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * WHICH BODIES ONLY A NEWER PROBE SENDS (#10737).
 *
 * A custom probe from before 17.2.0 reads every API monitor's body as a
 * JSON object (JSONFunctions.parseJSONObject): an array or a single value
 * fails its check with "Expected JSONObject, but got JSONArray", which says
 * nothing of the probe being too old. The server keeps such a step from a
 * probe that does not declare ProbeCapability.AnyRequestBody, and asks
 * MonitorRequestBody.needsProbeThatSendsAnyBody which steps those are, as
 * the step is handed over: its secrets filled in, a one-time code's
 * placeholder still in it.
 */

describe("a body only a probe that sends any body can send", () => {
  test.each([
    { name: "an array", body: '[{"id": 1}, {"id": 2}]' },
    { name: "an empty array", body: "[]" },
    { name: "a string", body: '"ping"' },
    { name: "a number", body: "42" },
    { name: "true", body: "true" },
    { name: "null", body: "null" },
    { name: "a JSON5 array", body: "[{id: 1,},] // the batch" },
    {
      name: "an array with a one-time code in a string",
      body: '[{"otp": "{{monitorSecrets.LoginCode}}"}]',
    },
    {
      name: "an array of a one-time code on its own",
      body: "[{{monitorSecrets.LoginCode}}]",
    },
    {
      name: "a one-time code as the whole body",
      body: "{{monitorSecrets.Code}}",
    },
  ])("$name", ({ body }: { name: string; body: string }) => {
    expect(MonitorRequestBody.needsProbeThatSendsAnyBody(body)).toBe(true);
  });
});

describe("a body every probe sends", () => {
  test.each([
    { name: "an object", body: '{"status": "ok"}' },
    { name: "an empty object", body: "{}" },
    { name: "a JSON5 object", body: "{a: 1, b: 'two',}" },
    {
      name: "an object with a one-time code",
      body: '{"otp": "{{monitorSecrets.LoginCode}}", "n": {{monitorSecrets.N}}}',
    },
    { name: "an object laid out over lines", body: '\n{\n  "a": [1, 2]\n}\n' },
  ])("$name", ({ body }: { name: string; body: string }) => {
    expect(MonitorRequestBody.needsProbeThatSendsAnyBody(body)).toBe(false);
  });

  test("no body", () => {
    for (const body of [undefined, null, "", "   \n\t", 7, {}, []]) {
      expect(MonitorRequestBody.needsProbeThatSendsAnyBody(body)).toBe(false);
    }
  });

  test.each([
    { name: "plain text", body: "hello world" },
    { name: "XML", body: "<ping/>" },
    { name: "an unclosed array", body: '[{"id": 1}' },
  ])(
    "$name, which no probe sends as JSON: it fails the check on any probe",
    ({ body }: { name: string; body: string }) => {
      expect(MonitorRequestBody.needsProbeThatSendsAnyBody(body)).toBe(false);
    },
  );
});

describe("drawn bodies", () => {
  test("only a body that reads as JSON but not as an object needs a newer probe", () => {
    const random: SeededRandom = seededRandom(10737);
    const values: ReadonlyArray<unknown> = [
      { a: 1 },
      [1, 2],
      "text",
      3.5,
      false,
      null,
      { nested: [{ deep: "x" }] },
      [],
      {},
    ];

    for (let draw: number = 0; draw < 200; draw++) {
      const value: unknown = values[random(values.length)];
      const indent: number | undefined = [undefined, 2, 4][random(3)];
      const body: string = JSON.stringify(value, null, indent);
      const isObject: boolean =
        value !== null && typeof value === "object" && !Array.isArray(value);

      expect([
        body,
        MonitorRequestBody.needsProbeThatSendsAnyBody(body),
      ]).toEqual([body, !isObject]);
    }
  });
});
