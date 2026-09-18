import JsonToText from "../../../../../Server/Types/Workflow/Components/JSON/JsonToText";
import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import logger from "../../../../../Server/Utils/Logger";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import ComponentMetadata, {
  Port,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Fixture bundling the RunOptions passed to the component together with the
 * spy-able mocks embedded inside it, so a test can both drive the component and
 * assert on how the component talked back through `onError` / `log`.
 */
interface OptionsFixture {
  options: RunOptions;
  onError: jest.Mock;
  log: jest.Mock;
}

/*
 * Build a deterministic RunOptions object. `onError` echoes the exception it is
 * given (mirroring the real runner, which returns the exception so callers can
 * `throw options.onError(...)`) while recording that it was invoked. No wall
 * clock, network, or randomness is involved.
 */
function makeOptions(): OptionsFixture {
  const log: jest.Mock = jest.fn();
  const onError: jest.Mock = jest.fn((exception: Exception): Exception => {
    return exception;
  });

  return {
    log,
    onError,
    options: {
      log: log as RunOptions["log"],
      workflowLogId: ObjectID.generate(),
      workflowId: ObjectID.generate(),
      projectId: ObjectID.generate(),
      onError: onError as RunOptions["onError"],
      executeWorkflow: async (): Promise<void> => {},
    } as RunOptions,
  };
}

/*
 * Convenience wrapper: run a fresh JsonToText with the supplied args and return
 * both the fixture (for `onError` / `log` assertions) and the promise, without
 * awaiting, so error-path tests can use `expect(...).rejects`.
 */
function runJsonToText(args: JSONObject): {
  fixture: OptionsFixture;
  result: Promise<RunReturnType>;
} {
  const fixture: OptionsFixture = makeOptions();
  const result: Promise<RunReturnType> = new JsonToText().run(
    args,
    fixture.options,
  );

  return { fixture, result };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("JsonToText constructor and metadata", () => {
  test("wires up the JSON to Text component metadata", () => {
    const component: JsonToText = new JsonToText();
    const metadata: ComponentMetadata = component.getMetadata();

    expect(metadata.id).toBe(ComponentID.JsonToText);
    expect(metadata.title).toBe("JSON to Text");
  });

  test("exposes both success and error out ports", () => {
    const metadata: ComponentMetadata = new JsonToText().getMetadata();
    const portIds: Array<string> = metadata.outPorts.map((p: Port): string => {
      return p.id;
    });

    expect(portIds).toContain("success");
    expect(portIds).toContain("error");
  });

  test("declares a single `text` return value", () => {
    const metadata: ComponentMetadata = new JsonToText().getMetadata();
    const returnValueIds: Array<string> = metadata.returnValues.map(
      (r: { id: string }): string => {
        return r.id;
      },
    );

    expect(returnValueIds).toEqual(["text"]);
  });
});

describe("JsonToText successful conversions from object input", () => {
  test("serializes a simple object and routes to the success port", async () => {
    const {
      fixture,
      result,
    }: { fixture: OptionsFixture; result: Promise<RunReturnType> } =
      runJsonToText({ json: { a: 1, b: "two" } });

    const value: RunReturnType = await result;

    expect(value.executePort?.id).toBe("success");
    expect(value.returnValues).toEqual({ text: '{"a":1,"b":"two"}' });
    expect(fixture.onError).not.toHaveBeenCalled();
    expect(fixture.log).not.toHaveBeenCalled();
  });

  test("returns the text as a string type, not the original object", async () => {
    const value: RunReturnType = await runJsonToText({
      json: { nested: { deep: [1, 2, 3] } },
    }).result;

    expect(typeof value.returnValues["text"]).toBe("string");
    expect(value.returnValues["text"]).toBe('{"nested":{"deep":[1,2,3]}}');
  });

  test("serializes an empty object to the two-character string {}", async () => {
    const value: RunReturnType = await runJsonToText({ json: {} }).result;

    expect(value.returnValues).toEqual({ text: "{}" });
    expect(value.executePort?.id).toBe("success");
  });

  test("preserves key insertion order in the serialized text", async () => {
    const value: RunReturnType = await runJsonToText({
      json: { z: 1, a: 2, m: 3 },
    }).result;

    expect(value.returnValues["text"]).toBe('{"z":1,"a":2,"m":3}');
  });
});

describe("JsonToText array inputs", () => {
  /*
   * `typeof [] === "object"` and a populated array is truthy, so an array slips
   * past both guards and is serialized as a JSON array. This documents the real
   * (arguably surprising) behavior rather than prescribing it.
   */
  test("serializes a populated array to a JSON array string via the success port", async () => {
    const value: RunReturnType = await runJsonToText({
      json: ["x", "y"] as unknown as JSONObject,
    }).result;

    expect(value.returnValues["text"]).toBe('["x","y"]');
    expect(value.executePort?.id).toBe("success");
  });

  test("serializes an empty array to the two-character string []", async () => {
    /*
     * An empty array is still truthy, so it is not rejected by the
     * `!args["json"]` guard the way an empty object literal-string would be.
     */
    const value: RunReturnType = await runJsonToText({
      json: [] as unknown as JSONObject,
    }).result;

    expect(value.returnValues["text"]).toBe("[]");
    expect(value.executePort?.id).toBe("success");
  });
});

describe("JsonToText string inputs parsed as JSON", () => {
  test("parses a strict JSON string, then re-serializes it as text", async () => {
    const value: RunReturnType = await runJsonToText({
      json: '{"name":"alice","age":30}',
    }).result;

    expect(value.returnValues["text"]).toBe('{"name":"alice","age":30}');
    expect(value.executePort?.id).toBe("success");
  });

  test("canonicalizes lenient JSON5 (single quotes, unquoted keys, trailing commas)", async () => {
    const value: RunReturnType = await runJsonToText({
      json: "{ a: 'one', b: 'two', }",
    }).result;

    /*
     * JSONFunctions.parse delegates to JSON5, so lenient syntax parses; the
     * subsequent JSON.stringify emits strict, canonical JSON.
     */
    expect(value.returnValues["text"]).toBe('{"a":"one","b":"two"}');
  });

  test("treats the string 'null' as a parsed null that passes the object guard", async () => {
    /*
     * JSON5 parses the literal to `null`, and `typeof null === "object"`, so the
     * type guard does not fire and JSON.stringify(null) yields the text "null".
     * Contrast this with a direct null argument, which is rejected as undefined.
     */
    const {
      fixture,
      result,
    }: { fixture: OptionsFixture; result: Promise<RunReturnType> } =
      runJsonToText({ json: "null" });

    const value: RunReturnType = await result;

    expect(value.returnValues["text"]).toBe("null");
    expect(value.executePort?.id).toBe("success");
    expect(fixture.onError).not.toHaveBeenCalled();
  });

  test("surfaces a raw parse error (not routed through onError) for a malformed json string", async () => {
    const {
      fixture,
      result,
    }: { fixture: OptionsFixture; result: Promise<RunReturnType> } =
      runJsonToText({ json: "{ this is not valid" });

    await expect(result).rejects.toThrow();
    /*
     * The parse happens outside the onError-wrapped guards, so a bad JSON string
     * escapes as a raw parser exception rather than being routed to the
     * component's error port.
     */
    expect(fixture.onError).not.toHaveBeenCalled();
  });
});

describe("JsonToText json argument validation", () => {
  test("rejects when json is undefined", async () => {
    const {
      fixture,
      result,
    }: { fixture: OptionsFixture; result: Promise<RunReturnType> } =
      runJsonToText({});

    await expect(result).rejects.toThrow("JSON is undefined.");
    expect(fixture.onError).toHaveBeenCalledTimes(1);
  });

  test("treats an empty string as undefined", async () => {
    const { result }: { result: Promise<RunReturnType> } = runJsonToText({
      json: "",
    });

    await expect(result).rejects.toThrow("JSON is undefined.");
  });

  test("treats the falsy number 0 as undefined", async () => {
    const { result }: { result: Promise<RunReturnType> } = runJsonToText({
      json: 0,
    });

    await expect(result).rejects.toThrow("JSON is undefined.");
  });

  test("treats a false boolean as undefined", async () => {
    const { result }: { result: Promise<RunReturnType> } = runJsonToText({
      json: false,
    });

    await expect(result).rejects.toThrow("JSON is undefined.");
  });

  test("treats a direct null as undefined despite typeof null being object", async () => {
    const { result }: { result: Promise<RunReturnType> } = runJsonToText({
      json: null,
    });

    await expect(result).rejects.toThrow("JSON is undefined.");
  });

  test("rejects a non-object, non-string number with a type error", async () => {
    const {
      fixture,
      result,
    }: { fixture: OptionsFixture; result: Promise<RunReturnType> } =
      runJsonToText({ json: 42 });

    await expect(result).rejects.toThrow("JSON is should be of type object.");
    expect(fixture.onError).toHaveBeenCalledTimes(1);
  });

  test("rejects a string that parses to a bare number", async () => {
    const { result }: { result: Promise<RunReturnType> } = runJsonToText({
      json: "42",
    });

    await expect(result).rejects.toThrow("JSON is should be of type object.");
  });

  test("rejects a string that parses to a boolean", async () => {
    const { result }: { result: Promise<RunReturnType> } = runJsonToText({
      json: "true",
    });

    await expect(result).rejects.toThrow("JSON is should be of type object.");
  });
});

describe("JsonToText serialization failure routes to the error port", () => {
  test("routes a circular-reference object to the error port and logs a message", async () => {
    /*
     * A circular object is truthy and `typeof === "object"`, so it clears both
     * guards, but JSON.stringify throws on the cycle. That exception is caught
     * and the run resolves to the error port instead of rejecting. The logger is
     * stubbed to keep the assertion deterministic and the console quiet.
     */
    const errorLogSpy: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {});

    const circular: JSONObject = {};
    circular["self"] = circular;

    const {
      fixture,
      result,
    }: { fixture: OptionsFixture; result: Promise<RunReturnType> } =
      runJsonToText({ json: circular });

    const value: RunReturnType = await result;

    expect(value.executePort?.id).toBe("error");
    expect(value.returnValues).toEqual({});
    expect(fixture.log).toHaveBeenCalledWith(
      "JSON is not in the correct format.",
    );
    expect(errorLogSpy).toHaveBeenCalledTimes(1);
    /*
     * The failure is handled internally, so the onError guard channel is never
     * touched.
     */
    expect(fixture.onError).not.toHaveBeenCalled();
  });
});

describe("JsonToText out-port guards", () => {
  /*
   * These guards live before any argument handling. They are normally
   * unreachable because the real metadata always defines both ports, so we drive
   * them by swapping in a metadata clone whose out ports are missing.
   */
  test("throws when the success port is missing from metadata", async () => {
    const component: JsonToText = new JsonToText();
    const base: ComponentMetadata = component.getMetadata();
    component.setMetadata({
      ...base,
      outPorts: base.outPorts.filter((p: Port): boolean => {
        return p.id !== "success";
      }),
    });

    const fixture: OptionsFixture = makeOptions();

    await expect(
      component.run({ json: { a: 1 } }, fixture.options),
    ).rejects.toThrow("Success port not found");
    expect(fixture.onError).toHaveBeenCalled();
  });

  test("throws when the error port is missing from metadata", async () => {
    const component: JsonToText = new JsonToText();
    const base: ComponentMetadata = component.getMetadata();
    component.setMetadata({
      ...base,
      outPorts: base.outPorts.filter((p: Port): boolean => {
        return p.id !== "error";
      }),
    });

    const fixture: OptionsFixture = makeOptions();

    await expect(
      component.run({ json: { a: 1 } }, fixture.options),
    ).rejects.toThrow("Error port not found");
    expect(fixture.onError).toHaveBeenCalled();
  });
});
