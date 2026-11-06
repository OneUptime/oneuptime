import { JSONObject } from "../../../Types/JSON";
import {
  MAX_TRIGGER_VALUES_LENGTH,
  RunAgainColumns,
  getRunAgainColumns,
  readTriggerValues,
} from "../../../Types/Workflow/WorkflowRunAgain";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * Issue #5944: what a run keeps of what it started with, and what a new run
 * reads back. "The same payload" means exactly that, so it is kept as text.
 */

describe("getRunAgainColumns", () => {
  test("keeps what the run starts with, as JSON text", () => {
    expect(getRunAgainColumns({ returnValues: { body: { id: 1 } } })).toEqual({
      triggerValues: '{"body":{"id":1}}',
      canRunAgain: true,
    });
  });

  test("keeps its keys in their order: a signature may be over them", () => {
    expect(
      getRunAgainColumns({ returnValues: { z: 1, a: { y: 2, b: 3 } } })
        .triggerValues,
    ).toBe('{"z":1,"a":{"y":2,"b":3}}');
  });

  test.each([
    ["no values", {}],
    ["nothing at all", null],
    ["nothing said", undefined],
  ])(
    "a run that starts with %s keeps an empty set",
    (_name: string, value: unknown) => {
      expect(getRunAgainColumns({ returnValues: value as JSONObject })).toEqual(
        { triggerValues: "{}", canRunAgain: true },
      );
    },
  );

  test("a test of one step keeps nothing: it is run again from the step", () => {
    expect(
      getRunAgainColumns({
        returnValues: { body: "x" },
        runOnlyComponentId: "step-1",
      }),
    ).toEqual({ triggerValues: undefined, canRunAgain: false });
  });

  test("no step named is a run of the whole workflow", () => {
    for (const runOnlyComponentId of [undefined, null, ""]) {
      expect(
        getRunAgainColumns({
          returnValues: {},
          runOnlyComponentId: runOnlyComponentId,
        }).canRunAgain,
      ).toBe(true);
    }
  });

  describe("how much is kept", () => {
    type OfLengthFunction = (length: number) => JSONObject;

    // {"b":"xxx"} is 8 characters around its value.
    const ofLength: OfLengthFunction = (length: number): JSONObject => {
      return { b: "x".repeat(length - 8) };
    };

    test("up to the limit, exactly", () => {
      const columns: RunAgainColumns = getRunAgainColumns({
        returnValues: ofLength(MAX_TRIGGER_VALUES_LENGTH),
      });

      expect(columns.canRunAgain).toBe(true);
      expect(columns.triggerValues).toHaveLength(MAX_TRIGGER_VALUES_LENGTH);
    });

    test("nothing past it: never a part of a payload", () => {
      expect(
        getRunAgainColumns({
          returnValues: ofLength(MAX_TRIGGER_VALUES_LENGTH + 1),
        }),
      ).toEqual({ triggerValues: undefined, canRunAgain: false });
    });

    test("the limit is a megabyte", () => {
      expect(MAX_TRIGGER_VALUES_LENGTH).toBe(1024 * 1024);
    });
  });

  test("what cannot be written as JSON keeps nothing, and does not throw", () => {
    const circular: JSONObject = {};
    circular["self"] = circular;

    expect(getRunAgainColumns({ returnValues: circular })).toEqual({
      triggerValues: undefined,
      canRunAgain: false,
    });
  });

  test("values become what the queue would make of them", () => {
    const at: Date = new Date("2026-11-05T10:00:00.000Z");

    expect(
      getRunAgainColumns({
        returnValues: { at: at, gone: undefined } as unknown as JSONObject,
      }).triggerValues,
    ).toBe('{"at":"2026-11-05T10:00:00.000Z"}');
  });
});

describe("readTriggerValues", () => {
  test("reads back what was kept", () => {
    expect(readTriggerValues('{"body":{"id":1}}')).toEqual({ body: { id: 1 } });
  });

  test("an empty set is still a set: a run with no values can be run again", () => {
    expect(readTriggerValues("{}")).toEqual({});
  });

  test.each([
    ["nothing kept", undefined],
    ["null", null],
    ["an empty text", ""],
    ["something that is no JSON", "{oops"],
    ["a list", "[1,2]"],
    ["a text", '"text"'],
    ["a number", "12"],
    ["the JSON null", "null"],
  ])(
    "%s is nothing to start from",
    (_name: string, stored: string | null | undefined) => {
      expect(readTriggerValues(stored)).toBeNull();
    },
  );
});

describe("keeping and reading back", () => {
  test.each([
    ["a NUL, which jsonb refuses", { body: "a\u0000b" }],
    ["half an emoji, which jsonb refuses", { body: "\ud83d" }],
    ["a whole emoji", { body: "🚀" }],
    ["markup", { body: "<script>alert(1)</script>" }],
    ["a reference, which stays a value", { body: "{{local.variables.x}}" }],
    ["a backslash and quotes", { body: 'C:\\temp "x"' }],
    ["a number too long for a float's text", { body: 1.7976931348623157e308 }],
    ["false, 0 and an empty text", { a: false, b: 0, c: "" }],
    ["a deep payload", { a: { b: { c: { d: [{ e: [null, 1, "x"] }] } } } }],
  ] as Array<[string, JSONObject]>)(
    "%s comes back as it was",
    (_name: string, values: JSONObject) => {
      expect(
        readTriggerValues(
          getRunAgainColumns({ returnValues: values }).triggerValues,
        ),
      ).toEqual(values);
    },
  );

  test("any payload comes back as it was, keys in order", () => {
    type RandomValueFunction = (depth: number) => unknown;

    const random: SeededRandom = seededRandom(5944);

    const randomValue: RandomValueFunction = (depth: number): unknown => {
      const kind: number = random(depth > 3 ? 4 : 6);

      switch (kind) {
        case 0:
          return random() < 0.5;
        case 1:
          return random(100000) / 100;
        case 2:
          return String.fromCharCode(
            ...Array.from({ length: random(12) }, () => {
              return random(0xffff);
            }),
          );
        case 3:
          return null;
        case 4:
          return Array.from({ length: random(4) }, () => {
            return randomValue(depth + 1);
          });
        default: {
          const object: JSONObject = {};

          for (let i: number = random(5); i > 0; i--) {
            object[`key${random(1000)}`] = randomValue(depth + 1) as JSONObject;
          }

          return object;
        }
      }
    };

    for (let i: number = 0; i < 300; i++) {
      const values: JSONObject = { payload: randomValue(0) } as JSONObject;
      const kept: string = getRunAgainColumns({ returnValues: values })
        .triggerValues as string;

      expect(JSON.stringify(readTriggerValues(kept))).toBe(kept);
    }
  });
});
