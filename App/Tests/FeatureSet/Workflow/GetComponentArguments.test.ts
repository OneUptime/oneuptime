import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Exception from "Common/Types/Exception/Exception";
import ComponentID from "Common/Types/Workflow/ComponentID";
import GitHubMetadata from "Common/Types/Workflow/Components/GitHubActions";
import { GitHubAction } from "Common/Server/Types/Workflow/Components/GitHub/Actions";
import {
  RunOptions,
  RunReturnType,
} from "Common/Server/Types/Workflow/ComponentCode";
import GitHubWorkflowClient from "Common/Server/Utils/CodeRepository/GitHub/GitHubWorkflowClient";
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

  test("preserves explicitly supplied false and zero", () => {
    const runner: RunWorkflow = new RunWorkflow();
    logsOf(runner);

    const args: JSONObject = runner.getComponentArguments(
      makeStorage({}),
      makeNode(
        [
          makeArgument("enabled", ComponentInputType.Boolean),
          makeArgument("temperature", ComponentInputType.Number),
        ],
        { enabled: false, temperature: 0 },
      ),
    );

    expect(args).toEqual({ enabled: false, temperature: 0 });
  });

  test("keeps unrelated optional blank, null, and undefined arguments omitted", () => {
    const runner: RunWorkflow = new RunWorkflow();
    logsOf(runner);

    const args: JSONObject = runner.getComponentArguments(
      makeStorage({}),
      makeNode(
        [
          makeArgument("body", ComponentInputType.Markdown),
          makeArgument("json", ComponentInputType.JSON),
          makeArgument("missing", ComponentInputType.Text),
          makeArgument("null", ComponentInputType.Text),
        ],
        { body: "", json: "", missing: undefined, null: null },
      ),
    );

    expect(args).toEqual({});
  });
});

describe("getComponentArguments — native GitHub updates", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const options: RunOptions = {
    projectId: new ObjectID("33333333-3333-4333-8333-333333333333"),
    workflowId: new ObjectID("11111111-1111-4111-8111-111111111111"),
    workflowLogId: new ObjectID("22222222-2222-4222-8222-222222222222"),
    log: (): void => {},
    onError: (error: Exception): Exception => {
      return error;
    },
    executeWorkflow: async (): Promise<void> => {},
  };

  for (const id of [
    ComponentID.GitHubUpdateIssue,
    ComponentID.GitHubUpdatePullRequest,
  ]) {
    const metadata: ComponentMetadata = GitHubMetadata.find(
      (candidate: ComponentMetadata): boolean => {
        return candidate.id === id;
      },
    )!;

    const parsedArguments: (values: JSONObject) => JSONObject = (
      values: JSONObject,
    ): JSONObject => {
      const runner: RunWorkflow = new RunWorkflow();
      logsOf(runner);
      const node: NodeDataProp = makeNode(metadata.arguments, values);
      node.metadata = metadata;
      node.metadataId = metadata.id;
      return runner.getComponentArguments(makeStorage({}), node);
    };

    test(`${id} sends an explicitly empty body through the runner to GitHub`, async () => {
      jest.spyOn(GitHubWorkflowClient, "request").mockResolvedValue({
        statusCode: 200,
        data: { id: 1, number: 42, body: "" },
      });
      const args: JSONObject = parsedArguments({
        repository: "acme/api",
        number: 42,
        body: "",
      });

      const result: RunReturnType = await new GitHubAction(metadata).run(
        args,
        options,
      );

      expect(result.executePort?.id).toBe("success");
      expect(result.returnValues["body"]).toBe("");
      expect(GitHubWorkflowClient.request).toHaveBeenCalledWith(
        expect.objectContaining({
          repository: "acme/api",
          method: "PATCH",
          body: { body: "" },
        }),
      );
    });

    test.each([{}, { body: undefined }, { body: null }])(
      `${id} does not clear an unset body when updating a title: %j`,
      async (body: JSONObject) => {
        jest.spyOn(GitHubWorkflowClient, "request").mockResolvedValue({
          statusCode: 200,
          data: {
            id: 1,
            number: 42,
            body: "Original body",
            title: "Changed",
          },
        });
        const args: JSONObject = parsedArguments({
          repository: "acme/api",
          number: 42,
          title: "Changed",
          state: "",
          ...body,
        });

        const result: RunReturnType = await new GitHubAction(metadata).run(
          args,
          options,
        );

        expect(result.executePort?.id).toBe("success");
        expect(GitHubWorkflowClient.request).toHaveBeenCalledWith(
          expect.objectContaining({ body: { title: "Changed" } }),
        );
        expect(args).not.toHaveProperty("body");
        expect(args).not.toHaveProperty("state");
      },
    );

    test(`${id} omits an empty optional title while preserving an intentional body clear`, () => {
      expect(parsedArguments({ title: "", body: "" })).toEqual({ body: "" });
    });
  }
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
