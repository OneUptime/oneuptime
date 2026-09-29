import MergeJSON from "../../../../../Server/Types/Workflow/Components/JSON/MergeJson";
import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import ComponentMetadata, {
  Port,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import { describe, expect, test } from "@jest/globals";

/*
 * Fixture bundling the RunOptions passed to a component together with the
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
 * `throw options.onError(...)`) while recording that it was invoked.
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
 * Convenience wrapper: run a fresh MergeJSON with the supplied args and return
 * both the fixture (for `onError` assertions) and the promise, without awaiting,
 * so error-path tests can use `expect(...).rejects`.
 */
function runMerge(args: JSONObject): {
  fixture: OptionsFixture;
  result: Promise<RunReturnType>;
} {
  const fixture: OptionsFixture = makeOptions();
  const result: Promise<RunReturnType> = new MergeJSON().run(
    args,
    fixture.options,
  );

  return { fixture, result };
}

describe("MergeJSON constructor and metadata", () => {
  test("wires up the Merge JSON component metadata", () => {
    const component: MergeJSON = new MergeJSON();
    const metadata: ComponentMetadata = component.getMetadata();

    expect(metadata.id).toBe(ComponentID.MergeJson);
    expect(metadata.title).toBe("Merge JSON");
  });

  test("exposes both success and error out ports", () => {
    const metadata: ComponentMetadata = new MergeJSON().getMetadata();
    const portIds: Array<string> = metadata.outPorts.map((p: Port): string => {
      return p.id;
    });

    expect(portIds).toContain("success");
    expect(portIds).toContain("error");
  });
});

describe("MergeJSON successful merges", () => {
  test("merges two disjoint objects and routes to the success port", async () => {
    const {
      fixture,
      result,
    }: { fixture: OptionsFixture; result: Promise<RunReturnType> } = runMerge({
      json1: { a: 1 },
      json2: { b: 2 },
    });

    const value: RunReturnType = await result;

    expect(value.executePort?.id).toBe("success");
    expect(value.returnValues).toEqual({ json: { a: 1, b: 2 } });
    expect(fixture.onError).not.toHaveBeenCalled();
  });

  test("gives json2 precedence over json1 on conflicting keys", async () => {
    const value: RunReturnType = await runMerge({
      json1: { shared: "from-json1", onlyOne: 1 },
      json2: { shared: "from-json2", onlyTwo: 2 },
    }).result;

    expect(value.returnValues["json"]).toEqual({
      shared: "from-json2",
      onlyOne: 1,
      onlyTwo: 2,
    });
  });

  test("performs a shallow merge so a nested value from json2 fully replaces json1", async () => {
    const value: RunReturnType = await runMerge({
      json1: { user: { name: "alice", age: 30 } },
      json2: { user: { name: "bob" } },
    }).result;

    /*
     * A deep merge would keep `age`; the spread-based implementation replaces
     * the whole nested object, so only json2's `user` survives.
     */
    expect(value.returnValues["json"]).toEqual({ user: { name: "bob" } });
  });

  test("returns an empty object when both inputs are empty objects", async () => {
    const value: RunReturnType = await runMerge({
      json1: {},
      json2: {},
    }).result;

    expect(value.returnValues).toEqual({ json: {} });
    expect(value.executePort?.id).toBe("success");
  });

  test("keeps every key when one input is empty", async () => {
    const value: RunReturnType = await runMerge({
      json1: {},
      json2: { only: "json2" },
    }).result;

    expect(value.returnValues["json"]).toEqual({ only: "json2" });
  });

  test("does not mutate the returned json to share a reference with either input", async () => {
    const json1: JSONObject = { a: 1 };
    const json2: JSONObject = { b: 2 };
    const value: RunReturnType = await runMerge({ json1, json2 }).result;

    expect(value.returnValues["json"]).not.toBe(json1);
    expect(value.returnValues["json"]).not.toBe(json2);
  });
});

describe("MergeJSON string inputs parsed as JSON", () => {
  test("parses json1 supplied as a JSON string before merging", async () => {
    const value: RunReturnType = await runMerge({
      json1: '{"a":1}',
      json2: { b: 2 },
    }).result;

    expect(value.returnValues["json"]).toEqual({ a: 1, b: 2 });
    expect(value.executePort?.id).toBe("success");
  });

  test("parses both json1 and json2 when both are JSON strings", async () => {
    const value: RunReturnType = await runMerge({
      json1: '{"a":1}',
      json2: '{"b":2}',
    }).result;

    expect(value.returnValues["json"]).toEqual({ a: 1, b: 2 });
  });

  test("accepts lenient JSON5 syntax (single quotes, unquoted keys, trailing commas)", async () => {
    const value: RunReturnType = await runMerge({
      json1: "{ a: 'one', }",
      json2: "{ b: 'two', }",
    }).result;

    expect(value.returnValues["json"]).toEqual({ a: "one", b: "two" });
  });

  test("surfaces a raw parse error (not routed through onError) for malformed json1", async () => {
    const {
      fixture,
      result,
    }: { fixture: OptionsFixture; result: Promise<RunReturnType> } = runMerge({
      json1: "{ this is not valid",
      json2: { b: 2 },
    });

    await expect(result).rejects.toThrow();
    /*
     * The parse happens outside the onError-wrapped guards, so a bad JSON
     * string escapes as a raw parser exception rather than being routed to the
     * component's error port.
     */
    expect(fixture.onError).not.toHaveBeenCalled();
  });
});

describe("MergeJSON json1 validation failures", () => {
  test("rejects when json1 is undefined", async () => {
    const {
      fixture,
      result,
    }: { fixture: OptionsFixture; result: Promise<RunReturnType> } = runMerge({
      json2: { b: 2 },
    });

    await expect(result).rejects.toThrow("JSON1 is undefined.");
    expect(fixture.onError).toHaveBeenCalledTimes(1);
  });

  test("treats an empty string json1 as undefined", async () => {
    const {
      fixture,
      result,
    }: { fixture: OptionsFixture; result: Promise<RunReturnType> } = runMerge({
      json1: "",
      json2: { b: 2 },
    });

    await expect(result).rejects.toThrow("JSON1 is undefined.");
    expect(fixture.onError).toHaveBeenCalled();
  });

  test("treats the falsy number 0 json1 as undefined", async () => {
    const { result }: { result: Promise<RunReturnType> } = runMerge({
      json1: 0,
      json2: { b: 2 },
    });

    await expect(result).rejects.toThrow("JSON1 is undefined.");
  });

  test("treats a false json1 as undefined", async () => {
    const { result }: { result: Promise<RunReturnType> } = runMerge({
      json1: false,
      json2: { b: 2 },
    });

    await expect(result).rejects.toThrow("JSON1 is undefined.");
  });

  test("rejects a non-object, non-string json1 with a type error", async () => {
    const {
      fixture,
      result,
    }: { fixture: OptionsFixture; result: Promise<RunReturnType> } = runMerge({
      json1: 42,
      json2: { b: 2 },
    });

    await expect(result).rejects.toThrow("JSON1 is should be of type object.");
    expect(fixture.onError).toHaveBeenCalled();
  });

  test("rejects a json1 string that parses to a non-object", async () => {
    const { result }: { result: Promise<RunReturnType> } = runMerge({
      json1: "42",
      json2: { b: 2 },
    });

    await expect(result).rejects.toThrow("JSON1 is should be of type object.");
  });
});

describe("MergeJSON json2 validation failures", () => {
  test("rejects when json2 is undefined", async () => {
    const {
      fixture,
      result,
    }: { fixture: OptionsFixture; result: Promise<RunReturnType> } = runMerge({
      json1: { a: 1 },
    });

    await expect(result).rejects.toThrow("JSON2 is undefined.");
    expect(fixture.onError).toHaveBeenCalledTimes(1);
  });

  test("treats an empty string json2 as undefined", async () => {
    const { result }: { result: Promise<RunReturnType> } = runMerge({
      json1: { a: 1 },
      json2: "",
    });

    await expect(result).rejects.toThrow("JSON2 is undefined.");
  });

  test("rejects a non-object, non-string json2 with a type error", async () => {
    const {
      fixture,
      result,
    }: { fixture: OptionsFixture; result: Promise<RunReturnType> } = runMerge({
      json1: { a: 1 },
      json2: 42,
    });

    await expect(result).rejects.toThrow("JSON2 is should be of type object.");
    expect(fixture.onError).toHaveBeenCalled();
  });

  test("rejects a json2 string that parses to a non-object", async () => {
    const { result }: { result: Promise<RunReturnType> } = runMerge({
      json1: { a: 1 },
      json2: "true",
    });

    await expect(result).rejects.toThrow("JSON2 is should be of type object.");
  });
});

describe("MergeJSON validation ordering", () => {
  test("reports the json1 failure first when both inputs are missing", async () => {
    const { result }: { result: Promise<RunReturnType> } = runMerge({});

    await expect(result).rejects.toThrow("JSON1 is undefined.");
  });

  test("only reaches the json2 checks once json1 is valid", async () => {
    const { result }: { result: Promise<RunReturnType> } = runMerge({
      json1: { a: 1 },
    });

    await expect(result).rejects.toThrow("JSON2 is undefined.");
  });
});

describe("MergeJSON out-port guards", () => {
  /*
   * These guards live before any argument handling. They are normally
   * unreachable because the real metadata always defines both ports, so we
   * drive them by swapping in a metadata clone whose out ports are missing.
   */
  test("throws when the success port is missing from metadata", async () => {
    const component: MergeJSON = new MergeJSON();
    const base: ComponentMetadata = component.getMetadata();
    component.setMetadata({
      ...base,
      outPorts: base.outPorts.filter((p: Port): boolean => {
        return p.id !== "success";
      }),
    });

    const fixture: OptionsFixture = makeOptions();

    await expect(
      component.run({ json1: { a: 1 }, json2: { b: 2 } }, fixture.options),
    ).rejects.toThrow("Success port not found");
    expect(fixture.onError).toHaveBeenCalled();
  });

  test("throws when the error port is missing from metadata", async () => {
    const component: MergeJSON = new MergeJSON();
    const base: ComponentMetadata = component.getMetadata();
    component.setMetadata({
      ...base,
      outPorts: base.outPorts.filter((p: Port): boolean => {
        return p.id !== "error";
      }),
    });

    const fixture: OptionsFixture = makeOptions();

    await expect(
      component.run({ json1: { a: 1 }, json2: { b: 2 } }, fixture.options),
    ).rejects.toThrow("Error port not found");
    expect(fixture.onError).toHaveBeenCalled();
  });
});

describe("MergeJSON array inputs", () => {
  /*
   * Arrays are truthy and `typeof [] === "object"`, so they pass the guards and
   * get spread by index. This documents the real (arguably surprising)
   * behavior rather than prescribing it.
   */
  test("spreads array inputs by numeric index into the merged object", async () => {
    const value: RunReturnType = await runMerge({
      json1: ["x"],
      json2: { a: 1 },
    }).result;

    expect(value.returnValues["json"]).toEqual({ "0": "x", a: 1 });
  });

  test("adds nothing for an empty array input", async () => {
    const value: RunReturnType = await runMerge({
      json1: { a: 1 },
      json2: [],
    }).result;

    expect(value.returnValues["json"]).toEqual({ a: 1 });
  });
});
