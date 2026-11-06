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

/*
 * A value with nothing in it (Types/Workflow/EmptyValues, issue 5761): which
 * settings take one, and how it is written in each. The run as a whole is in
 * RunWorkflowEmptyValues.test.ts.
 */
describe("getComponentArguments — a value with nothing in it", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const MODEL: string = "local.components.find-1.returnValues.model";

  const storageWith: (model: JSONObject | null) => StorageMap = (
    model: JSONObject | null,
  ): StorageMap => {
    return makeStorage({
      components: {
        "find-1": { returnValues: { model: model as JSONObject } },
      },
    });
  };

  const withNoMonitor: StorageMap = storageWith({
    title: "From an SLO",
    description: null,
    monitor: null,
  });

  type ArgumentsOfFunction = (
    type: ComponentInputType,
    value: JSONObject[string],
    storage?: StorageMap,
  ) => { value: JSONObject[string]; logs: Array<string> };

  const argumentOfType: ArgumentsOfFunction = (
    type: ComponentInputType,
    value: JSONObject[string],
    storage: StorageMap = withNoMonitor,
  ): { value: JSONObject[string]; logs: Array<string> } => {
    const runner: RunWorkflow = new RunWorkflow();
    const logs: Array<string> = logsOf(runner);

    const args: JSONObject = runner.getComponentArguments(
      storage,
      makeNode([makeArgument("setting", type)], { setting: value }),
    );

    return { value: args["setting"], logs: logs };
  };

  describe.each([
    ComponentInputType.Text,
    ComponentInputType.LongText,
    ComponentInputType.Markdown,
    ComponentInputType.HTML,
    ComponentInputType.AnyValue,
  ])("a %s setting", (type: ComponentInputType) => {
    test("a field of a related record the record does not have is nothing", () => {
      expect(
        argumentOfType(type, `Monitor: [{{${MODEL}.monitor.name}}]`).value,
      ).toBe("Monitor: []");
    });

    test("a field holding null is nothing, never the word null", () => {
      expect(
        argumentOfType(type, `Details: [{{${MODEL}.description}}]`).value,
      ).toBe("Details: []");
    });

    test("a whole setting with no value is null", () => {
      expect(
        argumentOfType(type, `{{${MODEL}.monitor.name}}`).value,
      ).toBeNull();
    });

    test("a value that is there is written", () => {
      expect(argumentOfType(type, `Title: {{${MODEL}.title}}`).value).toBe(
        "Title: From an SLO",
      );
    });

    test("a reference to nothing is left as written", () => {
      const reference: string = "{{local.components.nope.returnValues.x}}";

      expect(argumentOfType(type, `[${reference}]`).value).toBe(
        `[${reference}]`,
      );
    });
  });

  test("a JSON setting: empty inside a string, null on its own", () => {
    expect(
      argumentOfType(
        ComponentInputType.JSON,
        `{"quoted": "{{${MODEL}.monitor.name}}", "own": {{${MODEL}.monitor.name}}, "kept": "{{${MODEL}.title}}"}`,
      ).value,
    ).toEqual({ quoted: "", own: null, kept: "From an SLO" });
  });

  test("a JSON setting that is one such reference is null", () => {
    expect(
      argumentOfType(ComponentInputType.JSON, `{{${MODEL}.monitor.name}}`)
        .value,
    ).toBeNull();
  });

  test("a dictionary kept as an object stays one", () => {
    expect(
      argumentOfType(ComponentInputType.StringDictionary, {
        "X-Monitor": `{{${MODEL}.monitor.name}}`,
        "X-Title": `{{${MODEL}.title}}`,
      }).value,
    ).toEqual({ "X-Monitor": "", "X-Title": "From an SLO" });
  });

  test("a dictionary kept as text has its value blanked in place", () => {
    expect(
      argumentOfType(
        ComponentInputType.StringDictionary,
        `{"X-Monitor": "{{${MODEL}.monitor.name}}"}`,
      ).value,
    ).toBe('{"X-Monitor": ""}');
  });

  test("the record of a Find One that found none is nothing", () => {
    expect(
      argumentOfType(
        ComponentInputType.Text,
        `Owner: [{{${MODEL}.name}}]`,
        storageWith(null),
      ).value,
    ).toBe("Owner: []");
  });

  test("the log says so, with no warning: nothing is wrong", () => {
    const logs: Array<string> = argumentOfType(
      ComponentInputType.Text,
      `{{${MODEL}.monitor.name}} {{${MODEL}.description}} {{${MODEL}.monitor.name}}`,
    ).logs;

    expect(logs).toEqual([
      `{{${MODEL}.monitor.name}} in "setting" has no value in this run, so it came through empty.`,
      `{{${MODEL}.description}} in "setting" has no value in this run, so it came through empty.`,
    ]);
  });

  /*
   * What keeps a reference as written: a setting where a blank is not harmless.
   * JavaScript has `const x = {{...}};`, which must stay code; an address must
   * not quietly become another; a date or a number must be one or nothing.
   */
  describe.each([
    ComponentInputType.URL,
    ComponentInputType.JavaScript,
    ComponentInputType.Password,
    ComponentInputType.Email,
    ComponentInputType.CronTab,
    ComponentInputType.Date,
    ComponentInputType.DateTime,
    ComponentInputType.Number,
    ComponentInputType.Decimal,
    ComponentInputType.Boolean,
    ComponentInputType.Choice,
    ComponentInputType.UserList,
    ComponentInputType.TeamList,
    ComponentInputType.OnCallScheduleList,
    ComponentInputType.OnCallPolicyList,
    ComponentInputType.WorkflowSelect,
  ])("a %s setting", (type: ComponentInputType) => {
    test("keeps a path through a null as written, and warns", () => {
      const result: { value: JSONObject[string]; logs: Array<string> } =
        argumentOfType(type, `x/{{${MODEL}.monitor.name}}`);

      expect(result.value).toBe(`x/{{${MODEL}.monitor.name}}`);
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0]).toMatch(/^Warning: .*literal text/);
    });

    test("writes a field holding null as it always did", () => {
      expect(argumentOfType(type, `x/{{${MODEL}.description}}`).value).toBe(
        "x/null",
      );
    });
  });

  test("JavaScript's null stays code that runs", () => {
    expect(
      argumentOfType(
        ComponentInputType.JavaScript,
        `const description = {{${MODEL}.description}};`,
      ).value,
    ).toBe("const description = null;");
  });

  /*
   * A step that reads or writes records: every setting, whatever its type. A
   * Query's {"monitorId": null} would match every alert with no monitor.
   */
  describe("a setting of a step that reads or writes records", () => {
    const recordStepNode: (
      type: ComponentInputType,
      value: JSONObject[string],
    ) => NodeDataProp = (
      type: ComponentInputType,
      value: JSONObject[string],
    ): NodeDataProp => {
      const node: NodeDataProp = makeNode([makeArgument("setting", type)], {
        setting: value,
      });

      node.metadata = { ...node.metadata, tableName: "Alert" };

      return node;
    };

    const argumentsOfRecordStep: (
      type: ComponentInputType,
      value: JSONObject[string],
    ) => JSONObject[string] = (
      type: ComponentInputType,
      value: JSONObject[string],
    ): JSONObject[string] => {
      const runner: RunWorkflow = new RunWorkflow();
      logsOf(runner);

      return runner.getComponentArguments(
        withNoMonitor,
        recordStepNode(type, value),
      )["setting"];
    };

    test.each([
      ComponentInputType.Query,
      ComponentInputType.JSON,
      ComponentInputType.BaseModel,
    ])(
      "a %s keeps the reference in a string, for the step to stop on",
      (type: ComponentInputType) => {
        const query: JSONObject = { monitorId: `{{${MODEL}.monitor._id}}` };

        expect(argumentsOfRecordStep(type, query)).toEqual(query);
      },
    );

    test("a Query with the reference on its own never comes out as null", () => {
      expect(() => {
        return argumentsOfRecordStep(
          ComponentInputType.Query,
          `{"monitorId": {{${MODEL}.monitor._id}}}`,
        );
      }).toThrow(/Invalid JSON/);
    });

    test("a text setting keeps it too", () => {
      expect(
        argumentsOfRecordStep(
          ComponentInputType.Text,
          `{{${MODEL}.monitor._id}}`,
        ),
      ).toBe(`{{${MODEL}.monitor._id}}`);
    });
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
