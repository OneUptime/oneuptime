import IfElse from "../../../../../Server/Types/Workflow/Components/Conditions/IfElse";
import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import Exception from "../../../../../Types/Exception/Exception";
import ReturnResult from "../../../../../Types/IsolatedVM/ReturnResult";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  ConditionOperator,
  ConditionValueType,
} from "../../../../../Types/Workflow/Components/Condition";
import { describe, expect, test } from "@jest/globals";

jest.mock("../../../../../Server/Utils/VM/VMAPI", () => {
  const nodeVm: typeof import("vm") = jest.requireActual("vm");

  return {
    __esModule: true,
    default: {
      runCodeInSandbox: jest.fn(
        async (data: { code: string }): Promise<ReturnResult> => {
          const returnValue: unknown = await nodeVm.runInNewContext(
            `(async () => {${data.code}})()`,
          );

          return {
            returnValue,
            logMessages: [],
            capturedMetrics: [],
          };
        },
      ),
    },
  };
});

function makeOptions(): RunOptions {
  return {
    log: jest.fn() as RunOptions["log"],
    workflowLogId: ObjectID.generate(),
    workflowId: ObjectID.generate(),
    projectId: ObjectID.generate(),
    onError: ((exception: Exception): Exception => {
      return exception;
    }) as RunOptions["onError"],
    executeWorkflow: async (): Promise<void> => {},
  };
}

async function runTextCondition(data: {
  input1: string;
  input2: string;
  operator: ConditionOperator;
}): Promise<RunReturnType> {
  const args: JSONObject = {
    "input-1-type": ConditionValueType.Text,
    "input-1": data.input1,
    operator: data.operator,
    "input-2-type": ConditionValueType.Text,
    "input-2": data.input2,
  };

  return new IfElse().run(args, makeOptions());
}

describe("IfElse text comparisons", () => {
  test("compares text containing quotes without generating invalid JavaScript", async () => {
    const result: RunReturnType = await runTextCondition({
      input1: 'The service said "ready".',
      input2: 'The service said "ready".',
      operator: ConditionOperator.EqualTo,
    });

    expect(result.executePort?.id).toBe("yes");
  });

  test("keeps literal backslashes distinct from escape characters", async () => {
    const result: RunReturnType = await runTextCondition({
      input1: "C:\\temp\\file",
      input2: "\t",
      operator: ConditionOperator.Contains,
    });

    expect(result.executePort?.id).toBe("no");
  });

  test("does not replace newlines with user-visible placeholder text", async () => {
    const result: RunReturnType = await runTextCondition({
      input1: "line one\nline two",
      input2: "line one--newline--line two",
      operator: ConditionOperator.EqualTo,
    });

    expect(result.executePort?.id).toBe("no");
  });
});
