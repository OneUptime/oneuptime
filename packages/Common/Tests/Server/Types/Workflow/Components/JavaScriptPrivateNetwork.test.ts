import JavaScriptCode from "../../../../../Server/Types/Workflow/Components/JavaScript";
import { RunOptions } from "../../../../../Server/Types/Workflow/ComponentCode";
import VMUtil from "../../../../../Server/Utils/VM/VMAPI";
import Exception from "../../../../../Types/Exception/Exception";
import ObjectID from "../../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The Custom JavaScript workflow component hands user code the host's real
 * axios, so its SSRF guard lives inside VMRunner rather than in the component.
 * That guard cannot read the instance policy through the component either —
 * the same runner executes custom code monitors inside the Probe — so the
 * component has to declare, as it starts the sandbox, that this script came
 * from a project member and is therefore eligible for the exception.
 *
 * These tests pin that hand-off. If the option stops being passed the sandbox
 * silently keeps the strict policy (a bug, but a safe one); if it is passed
 * from somewhere other than a constant, a workflow author could set it.
 */

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

function sandboxMock(): jest.Mock {
  return VMUtil.runCodeInSandbox as unknown as jest.Mock;
}

function sandboxOptions(): Record<string, unknown> {
  const call: Array<Record<string, unknown>> = sandboxMock().mock
    .calls[0] as Array<Record<string, unknown>>;

  return call[0]?.["options"] as Record<string, unknown>;
}

describe("JavaScript workflow component — private network exception", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    sandboxMock().mockResolvedValue({
      returnValue: { ok: true },
      logMessages: [],
      capturedMetrics: [],
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("declares the sandbox eligible for the exception", async () => {
    await new JavaScriptCode().run(
      { code: "return {};", arguments: {} },
      makeOptions(),
    );

    expect(sandboxMock()).toHaveBeenCalledTimes(1);
    expect(sandboxOptions()).toMatchObject({
      allowPrivateNetworkRequests: true,
    });
  });

  /*
   * The eligibility is a property of the call site, not of anything the
   * workflow supplies. A script that names the flag in its own arguments must
   * not be able to reach the option the runner reads.
   */
  test("does not take the flag from the workflow's own arguments", async () => {
    await new JavaScriptCode().run(
      {
        code: "return {};",
        arguments: { allowPrivateNetworkRequests: false },
      },
      makeOptions(),
    );

    expect(sandboxOptions()).toMatchObject({
      allowPrivateNetworkRequests: true,
    });
    expect(sandboxOptions()["args"]).toMatchObject({
      allowPrivateNetworkRequests: false,
    });
  });

  test("still passes the script and its timeout through unchanged", async () => {
    await new JavaScriptCode().run(
      { code: "return 1;", arguments: { a: 1 } },
      makeOptions(),
    );

    const options: Record<string, unknown> = sandboxOptions();

    expect(sandboxMock().mock.calls[0]?.[0]).toMatchObject({
      code: "return 1;",
    });
    expect(options["args"]).toEqual({ a: 1 });
    expect(typeof options["timeout"]).toBe("number");
  });
});
