/*
 * The Switch / Case step, run as the workflow runner runs it: its cases
 * resolved by RunWorkflow.getComponentArguments, and its settings as they are
 * configured handed over in options.configuredArguments, which is what the
 * canvas shows.
 *
 * What a run of it must do: take the output of the first case that matches -
 * a case matches exactly when If / Else would say Yes - or Default; never
 * more than one; name the output and say why in the configured words, never
 * a resolved value (a case compared with a secret variable); log each case it
 * checked; and stop with a sentence when a case cannot be compared at all.
 */

import Switch from "../../../../../Server/Types/Workflow/Components/Conditions/Switch";
import IfElse from "../../../../../Server/Types/Workflow/Components/Conditions/IfElse";
import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import VMUtil from "../../../../../Server/Utils/VM/VMAPI";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
  Port,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import {
  ConditionOperator,
  ConditionValueType,
} from "../../../../../Types/Workflow/Components/Condition";
import {
  CONDITION_COMPARISONS,
  ConditionComparison,
} from "../../../../../Types/Workflow/Components/ConditionComparison";
import {
  SWITCH_DEFAULT_PORT,
  SWITCH_DEFAULT_PORT_ID,
} from "../../../../../Types/Workflow/Components/Switch";
import {
  getTemplateGraphSpec,
  getWorkflowTemplates,
  WorkflowTemplate,
} from "../../../../../Types/Workflow/Templates";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";

interface OptionsFixture {
  options: RunOptions;
  log: Mock<(item: unknown) => void>;
  onError: Mock<(exception: Exception) => Exception>;
}

function makeOptions(configuredArguments?: JSONObject): OptionsFixture {
  const log: Mock<(item: unknown) => void> = jest.fn(
    (_item: unknown): void => {},
  );
  const onError: Mock<(exception: Exception) => Exception> = jest.fn(
    (exception: Exception): Exception => {
      return exception;
    },
  );

  const options: RunOptions = {
    log: log as unknown as RunOptions["log"],
    workflowLogId: ObjectID.generate(),
    workflowId: ObjectID.generate(),
    projectId: ObjectID.generate(),
    onError: onError as unknown as RunOptions["onError"],
    executeWorkflow: async (): Promise<void> => {},
  };

  if (configuredArguments) {
    options.configuredArguments = configuredArguments;
  }

  return { log: log, onError: onError, options: options };
}

type CaseFunction = (
  id: string,
  comparison: string,
  value?: string,
  compareAs?: string,
) => JSONObject;

const aCase: CaseFunction = (
  id: string,
  comparison: string,
  value: string = "",
  compareAs: string = ConditionValueType.Text,
): JSONObject => {
  return { id: id, comparison: comparison, value: value, compareAs: compareAs };
};

const SEVERITY_CASES: Array<JSONObject> = [
  aCase("case-1", ConditionOperator.EqualTo, "Critical Incident"),
  aCase("case-2", ConditionOperator.EqualTo, "Major Incident"),
];

type RunFunction = (
  args: JSONObject,
  configuredArguments?: JSONObject,
) => Promise<RunReturnType>;

const run: RunFunction = async (
  args: JSONObject,
  configuredArguments?: JSONObject,
): Promise<RunReturnType> => {
  return await new Switch().run(
    args,
    makeOptions(configuredArguments || args).options,
  );
};

type PortOfFunction = (args: JSONObject) => Promise<string | undefined>;

const portOf: PortOfFunction = async (
  args: JSONObject,
): Promise<string | undefined> => {
  const result: RunReturnType = await run(args);

  expect(result.returnValues).toEqual({});

  return result.executePort?.id;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the step's metadata", () => {
  const metadata: ComponentMetadata = new Switch().getMetadata();

  test("is the Switch / Case step of the Conditions category", () => {
    expect(metadata.id).toBe(ComponentID.Switch);
    expect(metadata.title).toBe("Switch / Case");
    expect(metadata.category).toBe("Conditions");
    expect(metadata.componentType).toBe(ComponentType.Component);
    expect(metadata.returnValues).toEqual([]);
  });

  test("has a value to check and a list of cases, both required", () => {
    expect(
      metadata.arguments.map(
        (argument: {
          id: string;
          name: string;
          type: ComponentInputType;
          required: boolean;
        }) => {
          return [argument.id, argument.name, argument.type, argument.required];
        },
      ),
    ).toEqual([
      ["value", "Value to check", ComponentInputType.Text, true],
      ["cases", "Cases", ComponentInputType.SwitchCases, true],
    ]);
  });

  test("always has In and Default; the cases' outputs come from its settings", () => {
    expect(
      metadata.inPorts.map((port: Port): string => {
        return port.id;
      }),
    ).toEqual(["in"]);
    expect(metadata.outPorts).toEqual([SWITCH_DEFAULT_PORT]);
  });

  test("its In reads like If / Else's", () => {
    expect(metadata.inPorts[0]?.description).toBe(
      new IfElse().getMetadata().inPorts[0]?.description,
    );
  });
});

describe("which output a run takes", () => {
  test("the first case that matches, named as the canvas names it", async () => {
    const result: RunReturnType = await run({
      value: "Critical Incident",
      cases: SEVERITY_CASES,
    });

    expect(result.returnValues).toEqual({});
    expect(result.executePort).toEqual({
      id: "case-1",
      title: "Critical Incident",
      description: "Runs next when the value is equal to “Critical Incident”.",
    });
    expect(result.executePortReason).toBe(
      "Case 1 matched: the value is equal to “Critical Incident”.",
    );
  });

  test("a later case, saying the ones above it did not match", async () => {
    const result: RunReturnType = await run({
      value: "Major Incident",
      cases: SEVERITY_CASES,
    });

    expect(result.executePort?.id).toBe("case-2");
    expect(result.executePort?.title).toBe("Major Incident");
    expect(result.executePortReason).toBe(
      "Case 2 matched: the value is equal to “Major Incident”. Case 1 did not.",
    );
  });

  test("Default when no case matches", async () => {
    const result: RunReturnType = await run({
      value: "Minor Incident",
      cases: SEVERITY_CASES,
    });

    expect(result.executePort).toEqual(SWITCH_DEFAULT_PORT);
    expect(result.executePort?.id).toBe(SWITCH_DEFAULT_PORT_ID);
    expect(result.executePortReason).toBe(
      "None of the 2 cases matched, so the step took Default.",
    );
  });

  test("Default when the step has no cases at all, or they were never set", async () => {
    for (const args of [
      { value: "x", cases: [] },
      { value: "x" },
      { cases: SEVERITY_CASES },
    ] as Array<JSONObject>) {
      expect({ args, port: await portOf(args) }).toEqual({
        args,
        port: SWITCH_DEFAULT_PORT_ID,
      });
    }
  });

  test("a value to check that was never set is compared as nothing, as If / Else compares it", async () => {
    expect(
      await portOf({
        cases: [aCase("case-1", ConditionOperator.IsEmpty)],
      }),
    ).toBe("case-1");
  });

  test("the first match wins: no case below it is taken, however well it matches", async () => {
    expect(
      await portOf({
        value: "Critical Incident",
        cases: [
          aCase("case-1", ConditionOperator.Contains, "Critical"),
          aCase("case-2", ConditionOperator.EqualTo, "Critical Incident"),
          aCase("case-3", ConditionOperator.IsNotEmpty),
        ],
      }),
    ).toBe("case-1");
  });

  test("ranges: the order of the cases decides", async () => {
    const cases: Array<JSONObject> = [
      aCase("case-1", ConditionOperator.LessThan, "300", "number"),
      aCase("case-2", ConditionOperator.LessThan, "500", "number"),
    ];

    expect(await portOf({ value: 204, cases })).toBe("case-1");
    expect(await portOf({ value: "404", cases })).toBe("case-2");
    expect(await portOf({ value: 503, cases })).toBe(SWITCH_DEFAULT_PORT_ID);
  });

  test("the cases as a hand-written workflow may hold them: JSON text", async () => {
    expect(
      await portOf({
        value: "staging",
        cases: JSON.stringify([
          aCase("case-1", ConditionOperator.EqualTo, "production"),
          aCase("case-2", ConditionOperator.EqualTo, "staging"),
        ]),
      }),
    ).toBe("case-2");
  });
});

describe("every comparison, through the step", () => {
  /*
   * Each comparison If / Else offers, as a case, with a value that meets it
   * and one that does not: the step must take the case for the first and
   * Default for the second, as If / Else takes Yes and No.
   */
  const MEETS: Record<string, [JSONValue, JSONValue, string, string]> = {
    "==": ["production", "staging", "production", "text"],
    "!=": ["staging", "production", "production", "text"],
    contains: ["Sev 1: db down", "Sev 2: slow", "Sev 1", "text"],
    "does not contain": ["Sev 2: slow", "Sev 1: db down", "Sev 1", "text"],
    "starts with": ["prod-eu-1", "dev-eu-1", "prod", "text"],
    "ends with": ["db-primary", "db-replica", "primary", "text"],
    ">": [503, 200, "499", "number"],
    ">=": [500, 499, "500", "number"],
    "<": [200, 503, "300", "number"],
    "<=": [300, 301, "300", "number"],
    "is empty": ["", "something", "", "text"],
    "is not empty": ["something", "", "", "text"],
    "is true": [true, false, "true", "boolean"],
    "is false": [false, true, "false", "boolean"],
  };

  test.each(
    CONDITION_COMPARISONS.map((comparison: ConditionComparison) => {
      return [comparison.label, comparison] as [string, ConditionComparison];
    }),
  )("%s", async (_label: string, comparison: ConditionComparison) => {
    const entry: [JSONValue, JSONValue, string, string] | undefined =
      MEETS[comparison.id];

    expect(entry).toBeDefined();

    const [meets, doesNot, value, compareAs] = entry as [
      JSONValue,
      JSONValue,
      string,
      string,
    ];

    const cases: Array<JSONObject> = [
      aCase("case-1", comparison.operator, value, compareAs),
    ];

    expect(await portOf({ value: meets, cases })).toBe("case-1");
    expect(await portOf({ value: doesNot, cases })).toBe(
      SWITCH_DEFAULT_PORT_ID,
    );

    // As If / Else decides the same condition.
    const ifElse: IfElse = new IfElse();
    const asIfElse: (valueToCheck: JSONValue) => Promise<string | undefined> =
      async (valueToCheck: JSONValue): Promise<string | undefined> => {
        return (
          await ifElse.run(
            {
              "input-1": valueToCheck,
              operator: comparison.operator,
              "input-2": value,
              "input-1-type": compareAs,
              "input-2-type": compareAs,
            },
            makeOptions().options,
          )
        ).executePort?.id;
      };

    expect(await asIfElse(meets)).toBe("yes");
    expect(await asIfElse(doesNot)).toBe("no");
  });
});

describe("naming the output and saying why, as configured", () => {
  const CONFIGURED: JSONObject = {
    value: "{{local.components.webhook-1.returnValues.request-body.token}}",
    cases: [
      aCase("case-1", ConditionOperator.EqualTo, "{{global.variables.TOKEN}}"),
    ],
  };

  const RESOLVED: JSONObject = {
    value: "s3cr3t-t0ken",
    cases: [aCase("case-1", ConditionOperator.EqualTo, "s3cr3t-t0ken")],
  };

  test("a case compared with a secret variable is named after the variable, never its value", async () => {
    const fixture: OptionsFixture = makeOptions(CONFIGURED);
    const result: RunReturnType = await new Switch().run(
      RESOLVED,
      fixture.options,
    );

    expect(result.executePort?.id).toBe("case-1");
    expect(result.executePort?.title).toBe("TOKEN");
    expect(result.executePort?.description).toBe(
      "Runs next when the value is equal to TOKEN.",
    );
    expect(result.executePortReason).toBe(
      "Case 1 matched: the value is equal to TOKEN.",
    );

    const everything: string = JSON.stringify([
      result,
      fixture.log.mock.calls,
    ]);

    expect(everything).not.toContain("s3cr3t");
  });

  test("the run's log has a line for each case checked, then why", async () => {
    const fixture: OptionsFixture = makeOptions();

    await new Switch().run(
      {
        value: "Major Incident",
        cases: [
          ...SEVERITY_CASES,
          aCase("case-3", ConditionOperator.IsNotEmpty),
        ],
      },
      fixture.options,
    );

    expect(
      fixture.log.mock.calls.map((call: Array<unknown>): unknown => {
        return call[0];
      }),
    ).toEqual([
      "Case 1 (Critical Incident): no match.",
      "Case 2 (Major Incident): matched.",
      "Case 2 matched: the value is equal to “Major Incident”. Case 1 did not.",
    ]);
  });

  test("without the configured settings - a caller other than the runner - the cases name themselves", async () => {
    const result: RunReturnType = await new Switch().run(
      { value: "Major Incident", cases: SEVERITY_CASES },
      makeOptions().options,
    );

    expect(result.executePort?.title).toBe("Major Incident");
  });

  test("a case the configuration says nothing about is named by its place, not its resolved value", async () => {
    const result: RunReturnType = await new Switch().run(
      RESOLVED,
      makeOptions({ value: "x", cases: [] }).options,
    );

    expect(result.executePort?.id).toBe("case-1");
    expect(result.executePort?.title).toBe("Case 1");
    expect(result.executePortReason).toBe("Case 1 matched.");
    expect(JSON.stringify(result)).not.toContain("s3cr3t");
  });

  test("a configured case with another id is not mistaken for the resolved one", async () => {
    const result: RunReturnType = await new Switch().run(
      RESOLVED,
      makeOptions({
        cases: [aCase("case-9", ConditionOperator.EqualTo, "elsewhere")],
      }).options,
    );

    expect(result.executePort?.id).toBe("case-1");
    expect(result.executePort?.title).toBe("Case 1");
  });
});

describe("what stops a run", () => {
  test("a case whose comparison the step does not know, with a sentence naming the case", async () => {
    const fixture: OptionsFixture = makeOptions();

    await expect(
      new Switch().run(
        {
          value: "x",
          cases: [
            aCase("case-1", ConditionOperator.EqualTo, "x"),
            aCase("case-2", "~=", "y"),
          ],
        },
        fixture.options,
      ),
    ).rejects.toThrow(BadDataException);

    expect(fixture.onError).toHaveBeenCalledTimes(1);
    expect(fixture.log).toHaveBeenCalledWith("Could not check the cases.");
    expect(fixture.log).toHaveBeenCalledWith(
      'Switch / Case cannot compare case 2 with "~=". Open the step and choose a comparison for it, such as is equal to.',
    );
  });

  test("even when an earlier case matches: a broken case stops every run", async () => {
    const fixture: OptionsFixture = makeOptions();

    await expect(
      new Switch().run(
        {
          value: "x",
          cases: [
            aCase("case-1", ConditionOperator.EqualTo, "x"),
            aCase("case-2", "~=", "y"),
          ],
        },
        fixture.options,
      ),
    ).rejects.toThrow("Switch / Case cannot compare case 2");
  });

  test("the message quotes the comparison as configured, not as a reference resolved it", async () => {
    const fixture: OptionsFixture = makeOptions({
      cases: [aCase("case-1", "{{global.variables.OPERATOR}}", "x")],
    });

    await expect(
      new Switch().run(
        { cases: [aCase("case-1", "s3cr3t-operator", "x")] },
        fixture.options,
      ),
    ).rejects.toThrow('with "{{global.variables.OPERATOR}}"');

    expect(JSON.stringify(fixture.log.mock.calls)).not.toContain("s3cr3t");
  });

  test("cases that are not a list cannot be read, and say so", async () => {
    const fixture: OptionsFixture = makeOptions();

    await expect(
      new Switch().run(
        { value: "x", cases: { id: "case-1" } as unknown as JSONValue },
        fixture.options,
      ),
    ).rejects.toThrow(
      "The cases of this Switch / Case could not be read: they are not a list. Open the step and save its cases again.",
    );
    expect(fixture.onError).toHaveBeenCalledTimes(1);
  });

  test("nothing a case holds reaches the script sandbox", async () => {
    const sandbox: SpyInstance = jest.spyOn(
      VMUtil,
      "runCodeInSandbox",
    ) as unknown as SpyInstance;

    for (const comparison of CONDITION_COMPARISONS) {
      await run({
        value: "10",
        cases: [
          aCase(
            "case-1",
            comparison.operator,
            "9",
            comparison.fixedCompareWith ? "boolean" : "text",
          ),
        ],
      });
    }

    await expect(
      run({
        value: "a",
        cases: [
          aCase(
            "case-1",
            "== input2 || (() => { throw new Error('ran'); })() ||",
            "b",
          ),
        ],
      }),
    ).rejects.toThrow("Switch / Case cannot compare case 1");

    expect(sandbox).not.toHaveBeenCalled();
  });
});

describe("the templates' Switch / Case steps", () => {
  test("take each of their cases for the value it names, and Default for anything else", async () => {
    let checked: number = 0;

    for (const template of getWorkflowTemplates() as Array<WorkflowTemplate>) {
      for (const node of getTemplateGraphSpec(template.id)?.nodes || []) {
        if (node.metadataId !== ComponentID.Switch) {
          continue;
        }

        const cases: Array<JSONObject> = (node.args?.["cases"] ||
          []) as Array<JSONObject>;

        expect(cases.length).toBeGreaterThan(0);

        for (const switchCase of cases) {
          expect({
            template: template.id,
            port: await portOf({
              value: switchCase["value"] as string,
              cases: cases,
            }),
          }).toEqual({ template: template.id, port: switchCase["id"] });
        }

        expect({
          template: template.id,
          port: await portOf({ value: "something else entirely", cases }),
        }).toEqual({ template: template.id, port: SWITCH_DEFAULT_PORT_ID });

        checked++;
      }
    }

    expect(checked).toBeGreaterThanOrEqual(2);
  });
});
