import JavaScriptCode from "../../../../../Server/Types/Workflow/Components/JavaScript";
import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import VMUtil from "../../../../../Server/Utils/VM/VMAPI";
import Exception from "../../../../../Types/Exception/Exception";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../../../Server/Utils/VM/VMAPI", () => {
  return {
    __esModule: true,
    default: {
      runCodeInSandbox: jest.fn(),
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

describe("JavaScript workflow component", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("returns the script diagnostic through the Error port", async () => {
    jest
      .spyOn(VMUtil, "runCodeInSandbox")
      .mockRejectedValue(new Error("Unexpected token") as never);

    const result: RunReturnType = await new JavaScriptCode().run(
      { code: "invalid code", arguments: {} },
      makeOptions(),
    );

    expect(result.executePort?.id).toBe("error");
    expect(result.returnValues).toEqual({ error: "Unexpected token" });
  });
});
