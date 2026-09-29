import { describe, expect, test } from "@jest/globals";
import Exception from "../../../../../Types/Exception/Exception";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import TextToJSON from "../../../../../Server/Types/Workflow/Components/JSON/TextToJson";

/*
 * A workflow's Text to JSON step sits between two things the author does not
 * control: whatever a webhook or an API step returned, and whatever the next
 * step reads off `json`. So the two branches have to stay honest.
 *
 * A misuse of the STEP - no text, or text that is not a string - is an author
 * mistake and stops the workflow through onError, because carrying on would
 * feed the rest of the graph a value nobody chose. Text that is simply not
 * JSON is a DATA condition, not an author mistake: it leaves through the error
 * port with a log line, so the author can branch on it and the workflow keeps
 * running.
 */

type BuildOptionsFunction = () => {
  options: RunOptions;
  logs: Array<unknown>;
};

const buildOptions: BuildOptionsFunction = (): {
  options: RunOptions;
  logs: Array<unknown>;
} => {
  const logs: Array<unknown> = [];

  return {
    logs: logs,
    options: {
      log: (item: unknown): void => {
        logs.push(item);
      },
      workflowLogId: ObjectID.generate(),
      workflowId: ObjectID.generate(),
      projectId: ObjectID.generate(),
      onError: (exception: Exception): Exception => {
        return exception;
      },
      executeWorkflow: async (): Promise<void> => {},
    } as RunOptions,
  };
};

describe("the component is wired to the catalogue entry the graph names", () => {
  test("adopts the TextToJson metadata", () => {
    expect(new TextToJSON().getMetadata().id).toBe(ComponentID.TextToJson);
  });

  test("declares both a success and an error port", () => {
    const portIds: Array<string> = new TextToJSON()
      .getMetadata()
      .outPorts.map((port: { id: string }) => {
        return port.id;
      });

    expect(portIds).toContain("success");
    expect(portIds).toContain("error");
  });
});

describe("text that parses leaves through the success port", () => {
  test("returns the parsed object", async () => {
    const result: RunReturnType = await new TextToJSON().run(
      { text: '{"status":"ok","count":2}' },
      buildOptions().options,
    );

    expect(result.executePort?.id).toBe("success");
    expect(result.returnValues["json"]).toEqual({ status: "ok", count: 2 });
  });

  test("keeps nested structure intact", async () => {
    const result: RunReturnType = await new TextToJSON().run(
      { text: '{"a":{"b":[1,2,{"c":true}]}}' },
      buildOptions().options,
    );

    expect(result.returnValues["json"]).toEqual({
      a: { b: [1, 2, { c: true }] },
    });
  });

  test("accepts an empty object", async () => {
    const result: RunReturnType = await new TextToJSON().run(
      { text: "{}" },
      buildOptions().options,
    );

    expect(result.executePort?.id).toBe("success");
    expect(result.returnValues["json"]).toEqual({});
  });

  test("accepts surrounding whitespace", async () => {
    const result: RunReturnType = await new TextToJSON().run(
      { text: '   {"a":1}\n' },
      buildOptions().options,
    );

    expect(result.executePort?.id).toBe("success");
    expect(result.returnValues["json"]).toEqual({ a: 1 });
  });

  test("logs nothing on the happy path", async () => {
    const built: { options: RunOptions; logs: Array<unknown> } = buildOptions();

    await new TextToJSON().run({ text: '{"a":1}' }, built.options);

    expect(built.logs).toEqual([]);
  });
});

describe("text that does not parse leaves through the error port", () => {
  const unparseable: Array<[string, string]> = [
    ["plain prose", "not json at all"],
    ["a truncated object", '{"a":'],
    ["an HTML error page", "<html><body>502</body></html>"],
    ["a bare string literal", '"just a string"'],
    ["a bare number", "42"],
    ["an empty-ish blob of whitespace", "   \n  "],
  ];

  test.each(unparseable)(
    "routes %s to the error port",
    async (_name: string, text: string) => {
      const result: RunReturnType = await new TextToJSON().run(
        { text: text },
        buildOptions().options,
      );

      expect(result.executePort?.id).toBe("error");
      expect(result.returnValues).toEqual({});
    },
  );

  test("a JSON ARRAY is not a JSON object, and takes the error port", async () => {
    const result: RunReturnType = await new TextToJSON().run(
      { text: '[{"a":1}]' },
      buildOptions().options,
    );

    expect(result.executePort?.id).toBe("error");
  });

  test("tells the author, in the workflow log, that the text was malformed", async () => {
    const built: { options: RunOptions; logs: Array<unknown> } = buildOptions();

    await new TextToJSON().run({ text: "not json at all" }, built.options);

    expect(built.logs).toContain("text is not in the correct format.");
  });

  test("does not throw - the workflow is expected to carry on", async () => {
    await expect(
      new TextToJSON().run({ text: "not json" }, buildOptions().options),
    ).resolves.toBeDefined();
  });
});

describe("a misconfigured step stops the workflow instead of guessing", () => {
  test("refuses a missing text argument", async () => {
    await expect(
      new TextToJSON().run({} as JSONObject, buildOptions().options),
    ).rejects.toThrow("text is undefined.");
  });

  test("refuses an empty text argument", async () => {
    await expect(
      new TextToJSON().run({ text: "" }, buildOptions().options),
    ).rejects.toThrow("text is undefined.");
  });

  test("refuses a text argument that is already an object", async () => {
    await expect(
      new TextToJSON().run({ text: { a: 1 } }, buildOptions().options),
    ).rejects.toThrow("text is should be of type string.");
  });

  test("refuses a numeric text argument", async () => {
    await expect(
      new TextToJSON().run({ text: 42 }, buildOptions().options),
    ).rejects.toThrow("text is should be of type string.");
  });

  test("raises the refusal as a BadDataException through onError", async () => {
    await expect(
      new TextToJSON().run({}, buildOptions().options),
    ).rejects.toBeInstanceOf(BadDataException);
  });

  test("routes the refusal through the caller's onError hook", async () => {
    const seen: Array<Exception> = [];
    const built: { options: RunOptions; logs: Array<unknown> } = buildOptions();

    built.options.onError = (exception: Exception): Exception => {
      seen.push(exception);
      return exception;
    };

    await expect(new TextToJSON().run({}, built.options)).rejects.toThrow();
    expect(seen.length).toBe(1);
  });
});
