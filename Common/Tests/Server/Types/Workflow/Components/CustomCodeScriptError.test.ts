import JavaScriptCode from "../../../../../Server/Types/Workflow/Components/JavaScript";
import IfElse from "../../../../../Server/Types/Workflow/Components/Conditions/IfElse";
import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import VMUtil from "../../../../../Server/Utils/VM/VMAPI";
import ReturnResult from "../../../../../Types/IsolatedVM/ReturnResult";
import Exception from "../../../../../Types/Exception/Exception";
import ObjectID from "../../../../../Types/ObjectID";
import { describe, expect, test, afterEach } from "@jest/globals";

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

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Custom JavaScript component scriptError routing", () => {
  test("routes to the error port when the sandbox resolves with scriptError", async () => {
    const sandboxResult: ReturnResult = {
      returnValue: undefined,
      logMessages: ["before failure"],
      capturedMetrics: [],
      scriptError: new Error("script exploded"),
    };
    jest.spyOn(VMUtil, "runCodeInSandbox").mockResolvedValue(sandboxResult);

    const { options, log }: OptionsFixture = makeOptions();
    const result: RunReturnType = await new JavaScriptCode().run(
      { code: "throw new Error('script exploded');" },
      options,
    );

    expect(result.executePort?.id).toBe("error");
    expect(log).toHaveBeenCalledWith("before failure");
    expect(log).toHaveBeenCalledWith("Error running script");
    expect(log).toHaveBeenCalledWith("script exploded");
  });

  test("routes to the success port with the return value on success", async () => {
    const sandboxResult: ReturnResult = {
      returnValue: { answer: 42 },
      logMessages: [],
      capturedMetrics: [],
    };
    jest.spyOn(VMUtil, "runCodeInSandbox").mockResolvedValue(sandboxResult);

    const { options }: OptionsFixture = makeOptions();
    const result: RunReturnType = await new JavaScriptCode().run(
      { code: "return { answer: 42 };" },
      options,
    );

    expect(result.executePort?.id).toBe("success");
    expect(result.returnValues).toEqual({ returnValue: { answer: 42 } });
  });
});

describe("If/Else component scriptError handling", () => {
  test("fails the run instead of silently taking a branch when the expression errors", async () => {
    const sandboxResult: ReturnResult = {
      returnValue: undefined,
      logMessages: [],
      capturedMetrics: [],
      scriptError: new Error("expression exploded"),
    };
    jest.spyOn(VMUtil, "runCodeInSandbox").mockResolvedValue(sandboxResult);

    const { options, onError }: OptionsFixture = makeOptions();

    await expect(
      new IfElse().run(
        { "input-1": "a", "input-2": "b", operator: "==" },
        options,
      ),
    ).rejects.toThrow("expression exploded");
    expect(onError).toHaveBeenCalled();
  });

  test("takes the Yes branch when the expression evaluates truthy", async () => {
    const sandboxResult: ReturnResult = {
      returnValue: true,
      logMessages: [],
      capturedMetrics: [],
    };
    jest.spyOn(VMUtil, "runCodeInSandbox").mockResolvedValue(sandboxResult);

    const { options }: OptionsFixture = makeOptions();
    const result: RunReturnType = await new IfElse().run(
      { "input-1": "a", "input-2": "a", operator: "==" },
      options,
    );

    expect(result.executePort?.id).toBe("yes");
  });
});
