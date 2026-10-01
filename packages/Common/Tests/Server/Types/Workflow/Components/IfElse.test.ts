/*
 * The If / Else step, run as the workflow runner runs it: with the arguments
 * RunWorkflow.getComponentArguments hands over - references already filled
 * in, and empty settings left out altogether.
 *
 * It decides in TypeScript now (Types/Workflow/Components/ConditionEvaluation,
 * which has its own exhaustive tests against the old generated code). Here:
 * each comparison through the step itself, the shapes saved workflows and
 * templates have, and that nothing reaches the script sandbox.
 */

import IfElse from "../../../../../Server/Types/Workflow/Components/Conditions/IfElse";
import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import VMUtil from "../../../../../Server/Utils/VM/VMAPI";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { NodeDataProp } from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import {
  ConditionOperator,
  ConditionValueType,
} from "../../../../../Types/Workflow/Components/Condition";
import {
  WorkflowTemplate,
  getTemplateGraphSpec,
  getWorkflowTemplates,
} from "../../../../../Types/Workflow/Templates";
import { afterEach, describe, expect, test } from "@jest/globals";

interface OptionsFixture {
  options: RunOptions;
  log: jest.Mock;
  onError: jest.Mock;
}

function makeOptions(): OptionsFixture {
  const log: jest.Mock = jest.fn();
  const onError: jest.Mock = jest.fn((exception: Exception): Exception => {
    return exception;
  });

  return {
    log: log,
    onError: onError,
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

type RunFunction = (args: JSONObject) => Promise<string | undefined>;

// The port the step leaves through.
const run: RunFunction = async (
  args: JSONObject,
): Promise<string | undefined> => {
  const result: RunReturnType = await new IfElse().run(
    args,
    makeOptions().options,
  );

  expect(result.returnValues).toEqual({});

  return result.executePort?.id;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("If / Else, text", () => {
  test("compares text containing quotes without generating invalid JavaScript", async () => {
    expect(
      await run({
        "input-1-type": ConditionValueType.Text,
        "input-1": 'The service said "ready".',
        operator: ConditionOperator.EqualTo,
        "input-2-type": ConditionValueType.Text,
        "input-2": 'The service said "ready".',
      }),
    ).toBe("yes");
  });

  test("keeps literal backslashes distinct from escape characters", async () => {
    expect(
      await run({
        "input-1": "C:\\temp\\file",
        operator: ConditionOperator.Contains,
        "input-2": "\t",
      }),
    ).toBe("no");
  });

  test("does not replace newlines with user-visible placeholder text", async () => {
    expect(
      await run({
        "input-1": "line one\nline two",
        operator: ConditionOperator.EqualTo,
        "input-2": "line one--newline--line two",
      }),
    ).toBe("no");
  });

  test.each([
    [ConditionOperator.EqualTo, "production", "production", "yes"],
    [ConditionOperator.EqualTo, "Production", "production", "no"],
    [ConditionOperator.NotEqualTo, "staging", "production", "yes"],
    [ConditionOperator.Contains, "Sev 1: db down", "Sev 1", "yes"],
    [ConditionOperator.DoesNotContain, "Sev 1: db down", "Sev 2", "yes"],
    [ConditionOperator.StartsWith, "prod-eu-1", "prod", "yes"],
    [ConditionOperator.EndsWith, "prod-eu-1", "eu", "no"],
    // Text, letter by letter: dates written this way order correctly.
    [ConditionOperator.GreaterThan, "2026-10-01", "2026-09-30", "yes"],
    [ConditionOperator.LessThan, "10", "9", "yes"],
  ])(
    "%s: %s and %s → %s",
    async (
      operator: ConditionOperator,
      valueToCheck: string,
      compareWith: string,
      port: string,
    ) => {
      expect(
        await run({
          "input-1": valueToCheck,
          operator: operator,
          "input-2": compareWith,
        }),
      ).toBe(port);
    },
  );
});

describe("If / Else, numbers and true or false", () => {
  const AS_NUMBERS: JSONObject = {
    "input-1-type": ConditionValueType.Number,
    "input-2-type": ConditionValueType.Number,
  };

  test.each([
    [ConditionOperator.GreaterThan, "10", "9", "yes"],
    [ConditionOperator.GreaterThanOrEqualTo, 400, "400", "yes"],
    [ConditionOperator.LessThan, "503", "400", "no"],
    [ConditionOperator.LessThanOrEqualTo, "200", "200.0", "yes"],
    [ConditionOperator.EqualTo, " 12 ", "12", "yes"],
    [ConditionOperator.NotEqualTo, "abc", "0", "no"],
  ])(
    "%s: %s and %s as numbers → %s",
    async (
      operator: ConditionOperator,
      valueToCheck: string | number,
      compareWith: string,
      port: string,
    ) => {
      expect(
        await run({
          ...AS_NUMBERS,
          "input-1": valueToCheck,
          operator: operator,
          "input-2": compareWith,
        }),
      ).toBe(port);
    },
  );

  test("a status code from a whole-field reference arrives as a number", async () => {
    // getComponentArguments hands a whole-field reference's own value over.
    expect(
      await run({
        ...AS_NUMBERS,
        "input-1": 503,
        operator: ConditionOperator.GreaterThanOrEqualTo,
        "input-2": "500",
      }),
    ).toBe("yes");
  });

  test("true or false: only true is true", async () => {
    const AS_TRUE_FALSE: JSONObject = {
      "input-1-type": ConditionValueType.Boolean,
      "input-2-type": ConditionValueType.Boolean,
      operator: ConditionOperator.EqualTo,
      "input-2": "true",
    };

    expect(await run({ ...AS_TRUE_FALSE, "input-1": true })).toBe("yes");
    expect(await run({ ...AS_TRUE_FALSE, "input-1": "true" })).toBe("yes");
    expect(await run({ ...AS_TRUE_FALSE, "input-1": "True" })).toBe("no");
    expect(await run({ ...AS_TRUE_FALSE, "input-1": "yes" })).toBe("no");
  });
});

describe("If / Else, is empty and is not empty", () => {
  test.each([
    [
      "a field the webhook did not send",
      "{{local.components.webhook-1.returnValues.request-body.environment}}",
      "yes",
    ],
    ["a setting left empty, which the runner leaves out", undefined, "yes"],
    ["blank text", "  ", "yes"],
    ["an empty list from a reference", "[]", "yes"],
    ["a field sent as null", null, "yes"],
    ["a value", "staging", "no"],
    ["0", 0, "no"],
    ["false", false, "no"],
  ])(
    "%s: is empty → %s",
    async (_name: string, valueToCheck: unknown, port: string) => {
      const args: JSONObject = { operator: ConditionOperator.IsEmpty };

      if (valueToCheck !== undefined) {
        args["input-1"] = valueToCheck as JSONObject[string];
      }

      expect(await run(args)).toBe(port);
      expect(
        await run({ ...args, operator: ConditionOperator.IsNotEmpty }),
      ).toBe(port === "yes" ? "no" : "yes");
    },
  );
});

describe("shapes workflows already have", () => {
  test("no comparison stored is is equal to", async () => {
    expect(await run({ "input-1": "a", "input-2": "a" })).toBe("yes");
    expect(await run({ "input-1": "a", "input-2": "b" })).toBe("no");
  });

  test("a missing Compare with is empty text, as it always was", async () => {
    expect(await run({ "input-1": "", operator: "==" })).toBe("yes");
    expect(await run({ operator: "==" })).toBe("yes");
  });

  test("a value compared as Null ignores what it holds, as it always did", async () => {
    expect(
      await run({
        "input-1": "",
        operator: "==",
        "input-2": "null",
        "input-2-type": ConditionValueType.Null,
      }),
    ).toBe("no");
  });

  test("=== and !== still run", async () => {
    expect(await run({ "input-1": "a", operator: "===", "input-2": "a" })).toBe(
      "yes",
    );
    expect(await run({ "input-1": "a", operator: "!==", "input-2": "a" })).toBe(
      "no",
    );
  });

  test("a comparison spelt with capitals runs (it used to fail the run)", async () => {
    expect(
      await run({
        "input-1": "Sev 1 outage",
        operator: "Contains",
        "input-2": "Sev 1",
      }),
    ).toBe("yes");
  });

  /*
   * Every If / Else the templates create, with each reference filled in the
   * two ways a run can fill it: the branch must follow the values.
   */
  test("every template's If / Else follows its values", async () => {
    let checked: number = 0;

    for (const template of getWorkflowTemplates()) {
      for (const node of getTemplateGraphSpec((template as WorkflowTemplate).id)
        ?.nodes || []) {
        if (node.metadataId !== ComponentID.IfElse) {
          continue;
        }

        const args: JSONObject = { ...(node.args || {}) };
        const isTrueFalse: boolean =
          args["input-2-type"] === ConditionValueType.Boolean;

        // Met: the value to check is what it is compared with.
        const matching: JSONObject = {
          ...args,
          "input-1": isTrueFalse ? true : "same",
          "input-2": isTrueFalse ? args["input-2"] : "same",
        };
        // Not met.
        const different: JSONObject = {
          ...args,
          "input-1": isTrueFalse ? false : "one",
          "input-2": isTrueFalse ? args["input-2"] : "other",
        };

        expect({ step: node.componentId, port: await run(matching) }).toEqual({
          step: node.componentId,
          port: "yes",
        });
        expect({ step: node.componentId, port: await run(different) }).toEqual({
          step: node.componentId,
          port: "no",
        });
        checked++;
      }
    }

    expect(checked).toBeGreaterThan(3);
  });
});

describe("what fails a run", () => {
  test("a comparison the step does not know fails the run, with a sentence", async () => {
    const { options, onError, log }: OptionsFixture = makeOptions();

    await expect(
      new IfElse().run(
        { "input-1": "a", operator: "~=", "input-2": "a" },
        options,
      ),
    ).rejects.toThrow(BadDataException);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("Could not check the condition.");
    expect(log).toHaveBeenCalledWith(
      'If / Else cannot compare with "~=". Open the step and choose a comparison, such as is equal to.',
    );
  });

  test("a comparison taken from a value cannot run as code", async () => {
    const sandbox: jest.SpyInstance = jest.spyOn(VMUtil, "runCodeInSandbox");
    const { options }: OptionsFixture = makeOptions();

    // What a webhook could send, if the comparison were taken from its body.
    await expect(
      new IfElse().run(
        {
          "input-1": "a",
          operator: "== input2 || (() => { throw new Error('ran'); })() ||",
          "input-2": "b",
        },
        options,
      ),
    ).rejects.toThrow("If / Else cannot compare with");
    expect(sandbox).not.toHaveBeenCalled();
  });

  test("no comparison reaches the script sandbox", async () => {
    const sandbox: jest.SpyInstance = jest.spyOn(VMUtil, "runCodeInSandbox");

    for (const operator of Object.values(ConditionOperator)) {
      await run({ "input-1": "10", operator: operator, "input-2": "9" });
    }

    expect(sandbox).not.toHaveBeenCalled();
  });
});

describe("the step's metadata", () => {
  test("Yes and No, and settings named for what they are", () => {
    const metadata: NodeDataProp["metadata"] = new IfElse().getMetadata();

    expect(
      metadata.outPorts.map((port: { id: string }) => {
        return port.id;
      }),
    ).toEqual(["yes", "no"]);
    expect(
      metadata.arguments.map((argument: { id: string; name: string }) => {
        return [argument.id, argument.name];
      }),
    ).toEqual([
      ["input-1", "Value to check"],
      ["operator", "Comparison"],
      ["input-2", "Compare with"],
      ["input-1-type", "Value to check type"],
      ["input-2-type", "Compare with type"],
    ]);
  });
});
