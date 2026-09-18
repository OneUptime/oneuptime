import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ComponentMetadata, {
  Argument,
  ComponentInputType,
  ComponentType,
  NodeDataProp,
  NodeType,
} from "Common/Types/Workflow/Component";
import RunWorkflow, {
  StorageMap,
} from "../../../FeatureSet/Workflow/Services/RunWorkflow";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

type MakeArgumentFunction = (id: string, type: ComponentInputType) => Argument;

const makeArgument: MakeArgumentFunction = (
  id: string,
  type: ComponentInputType,
): Argument => {
  return {
    id: id,
    name: id,
    description: `${id} argument`,
    type: type,
    required: false,
  };
};

type MakeNodeFunction = (
  args: Array<Argument>,
  values: JSONObject,
) => NodeDataProp;

const makeNode: MakeNodeFunction = (
  args: Array<Argument>,
  values: JSONObject,
): NodeDataProp => {
  const metadata: ComponentMetadata = {
    id: "test-component",
    title: "Test Component",
    category: "Test",
    description: "For tests",
    iconProp: IconProp.Bolt,
    componentType: ComponentType.Component,
    arguments: args,
    returnValues: [],
    inPorts: [],
    outPorts: [],
  };

  return {
    error: "",
    id: "test-component-1",
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: "internal-1",
    arguments: values,
    returnValues: {},
    componentType: ComponentType.Component,
  };
};

type MakeStorageFunction = (params: {
  variables?: Record<string, string> | undefined;
  components?: { [x: string]: { returnValues: JSONObject } } | undefined;
}) => StorageMap;

const makeStorage: MakeStorageFunction = (params: {
  variables?: Record<string, string> | undefined;
  components?: { [x: string]: { returnValues: JSONObject } } | undefined;
}): StorageMap => {
  return {
    local: {
      variables: params.variables || {},
      components: params.components || {},
    },
    global: {
      variables: {},
    },
  };
};

type CapturedLogsFunction = (runner: RunWorkflow) => Array<string>;

const logsOf: CapturedLogsFunction = (runner: RunWorkflow): Array<string> => {
  const captured: Array<string> = [];

  jest.spyOn(runner, "log").mockImplementation((data: unknown): void => {
    captured.push(typeof data === "string" ? data : JSON.stringify(data));
  });

  return captured;
};

describe("getComponentArguments — substitution", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("substitutes a variable into a text argument", () => {
    const runner: RunWorkflow = new RunWorkflow();
    logsOf(runner);

    const args: JSONObject = runner.getComponentArguments(
      makeStorage({ variables: { token: "abc" } }),
      makeNode([makeArgument("message", ComponentInputType.Text)], {
        message: "Bearer {{local.variables.token}}",
      }),
    );

    expect(args["message"]).toBe("Bearer abc");
  });

  test("parses a JSON argument into an object", () => {
    const runner: RunWorkflow = new RunWorkflow();
    logsOf(runner);

    const args: JSONObject = runner.getComponentArguments(
      makeStorage({}),
      makeNode([makeArgument("request-body", ComponentInputType.JSON)], {
        "request-body": '{"a": 1}',
      }),
    );

    expect(args["request-body"]).toEqual({ a: 1 });
  });

  test("preserves an object used as the whole JSON argument", () => {
    const runner: RunWorkflow = new RunWorkflow();
    logsOf(runner);
    const requestBody: JSONObject = {
      service: "api",
      nested: { healthy: true },
    };

    const args: JSONObject = runner.getComponentArguments(
      makeStorage({
        components: {
          "webhook-1": {
            returnValues: { "request-body": requestBody },
          },
        },
      }),
      makeNode([makeArgument("arguments", ComponentInputType.JSON)], {
        arguments: "{{local.components.webhook-1.returnValues.request-body}}",
      }),
    );

    expect(args["arguments"]).toEqual(requestBody);
    expect(typeof args["arguments"]).toBe("object");
  });

  test("throws with the argument named when a JSON argument is malformed", () => {
    const runner: RunWorkflow = new RunWorkflow();
    logsOf(runner);

    expect(() => {
      return runner.getComponentArguments(
        makeStorage({}),
        makeNode([makeArgument("request-body", ComponentInputType.JSON)], {
          "request-body": '{"a": 1,}',
        }),
      );
    }).toThrow(/request-body/);
  });

  test("skips arguments that were never set", () => {
    const runner: RunWorkflow = new RunWorkflow();
    logsOf(runner);

    const args: JSONObject = runner.getComponentArguments(
      makeStorage({}),
      makeNode([makeArgument("message", ComponentInputType.Text)], {}),
    );

    expect(args["message"]).toBeUndefined();
  });
});

describe("getComponentArguments — header dictionaries in both shapes", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const headerArgument: Argument = makeArgument(
    "request-headers",
    ComponentInputType.StringDictionary,
  );

  test("carries the legacy JSON-string shape through unchanged", () => {
    const runner: RunWorkflow = new RunWorkflow();
    logsOf(runner);

    const args: JSONObject = runner.getComponentArguments(
      makeStorage({ variables: { token: "abc" } }),
      makeNode([headerArgument], {
        "request-headers":
          '{"Authorization": "Bearer {{local.variables.token}}"}',
      }),
    );

    /*
     * StringDictionary is not parsed here — the component does that with JSON5
     * (ApiComponentUtils.sanitizeArgs), which is what lets a legacy value keep
     * working. What matters is that the substitution happened.
     */
    expect(args["request-headers"]).toBe('{"Authorization": "Bearer abc"}');
  });

  test("carries the object shape through as an object", () => {
    const runner: RunWorkflow = new RunWorkflow();
    logsOf(runner);

    const args: JSONObject = runner.getComponentArguments(
      makeStorage({ variables: { token: "abc" } }),
      makeNode([headerArgument], {
        "request-headers": {
          Authorization: "Bearer {{local.variables.token}}",
        },
      }),
    );

    expect(args["request-headers"]).toEqual({
      Authorization: "Bearer abc",
    });
  });

  test("keeps the object shape intact when a value contains a quote", () => {
    const runner: RunWorkflow = new RunWorkflow();
    logsOf(runner);

    const args: JSONObject = runner.getComponentArguments(
      makeStorage({ variables: { note: 'say "hi"' } }),
      makeNode([headerArgument], {
        "request-headers": { "X-Note": "{{local.variables.note}}" },
      }),
    );

    expect(args["request-headers"]).toEqual({ "X-Note": 'say "hi"' });
  });
});

describe("getComponentArguments — unresolved reference warnings", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("warns when a reference resolves to nothing and is left as text", () => {
    const runner: RunWorkflow = new RunWorkflow();
    const logs: Array<string> = logsOf(runner);

    const args: JSONObject = runner.getComponentArguments(
      makeStorage({}),
      makeNode([makeArgument("message", ComponentInputType.Text)], {
        message: "value is {{local.componets.api-get-1.returnValues.body}}",
      }),
    );

    // The literal text still goes through — the warning is the whole point.
    expect(args["message"]).toBe(
      "value is {{local.componets.api-get-1.returnValues.body}}",
    );

    const warning: string | undefined = logs.find((line: string) => {
      return line.startsWith("Warning:");
    });

    expect(warning).toBeDefined();
    expect(warning).toMatch(/local\.componets\.api-get-1/);
    expect(warning).toMatch(/"message"/);
    expect(warning).toMatch(/literal text/);
  });

  test("lists each unresolved reference once", () => {
    const runner: RunWorkflow = new RunWorkflow();
    const logs: Array<string> = logsOf(runner);

    runner.getComponentArguments(
      makeStorage({}),
      makeNode([makeArgument("message", ComponentInputType.Text)], {
        message:
          "{{local.variables.a}} {{local.variables.a}} {{local.variables.b}}",
      }),
    );

    const warning: string = logs.find((line: string) => {
      return line.startsWith("Warning:");
    }) as string;

    expect(warning.match(/local\.variables\.a/g)).toHaveLength(1);
    expect(warning).toMatch(/local\.variables\.b/);
  });

  test("says nothing when every reference resolved", () => {
    const runner: RunWorkflow = new RunWorkflow();
    const logs: Array<string> = logsOf(runner);

    runner.getComponentArguments(
      makeStorage({ variables: { token: "abc" } }),
      makeNode([makeArgument("message", ComponentInputType.Text)], {
        message: "{{local.variables.token}}",
      }),
    );

    expect(
      logs.filter((line: string) => {
        return line.startsWith("Warning:");
      }),
    ).toHaveLength(0);
  });

  test("says nothing about an argument with no references at all", () => {
    const runner: RunWorkflow = new RunWorkflow();
    const logs: Array<string> = logsOf(runner);

    runner.getComponentArguments(
      makeStorage({}),
      makeNode([makeArgument("message", ComponentInputType.Text)], {
        message: "plain text",
      }),
    );

    expect(logs).toHaveLength(0);
  });

  /*
   * A resolved value is allowed to contain braces of its own. Warning on that
   * would report a reference the author never wrote, so the check compares the
   * argument before and after substitution rather than scanning the output.
   */
  test("does not warn when the resolved value itself contains braces", () => {
    const runner: RunWorkflow = new RunWorkflow();
    const logs: Array<string> = logsOf(runner);

    runner.getComponentArguments(
      makeStorage({ variables: { tpl: "{{not.a.reference}}" } }),
      makeNode([makeArgument("message", ComponentInputType.Text)], {
        message: "x {{local.variables.tpl}} y",
      }),
    );

    expect(
      logs.filter((line: string) => {
        return line.startsWith("Warning:");
      }),
    ).toHaveLength(0);
  });

  test("does not warn for a whole-field reference that resolved to an object", () => {
    const runner: RunWorkflow = new RunWorkflow();
    const logs: Array<string> = logsOf(runner);

    runner.getComponentArguments(
      makeStorage({
        components: {
          "api-get-1": { returnValues: { "response-body": { a: 1 } } },
        },
      }),
      makeNode([makeArgument("message", ComponentInputType.Text)], {
        message: "{{local.components.api-get-1.returnValues.response-body}}",
      }),
    );

    expect(
      logs.filter((line: string) => {
        return line.startsWith("Warning:");
      }),
    ).toHaveLength(0);
  });

  test("warns about a reference padded with spaces, which never resolves", () => {
    const runner: RunWorkflow = new RunWorkflow();
    const logs: Array<string> = logsOf(runner);

    runner.getComponentArguments(
      makeStorage({ variables: { token: "abc" } }),
      makeNode([makeArgument("message", ComponentInputType.Text)], {
        message: "{{ local.variables.token }}",
      }),
    );

    expect(
      logs.filter((line: string) => {
        return line.startsWith("Warning:");
      }),
    ).toHaveLength(1);
  });
});
