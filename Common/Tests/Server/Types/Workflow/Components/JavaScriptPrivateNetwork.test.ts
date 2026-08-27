import JavaScriptCode from "../../../../../Server/Types/Workflow/Components/JavaScript";
import ProjectService from "../../../../../Server/Services/ProjectService";
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
 * axios, so its SSRF guard lives inside VMRunner. That guard cannot resolve
 * the project opt-in itself — the same runner executes custom code monitors
 * inside the Probe, which has no database — so the component has to resolve it
 * and pass it down.
 *
 * These tests pin that hand-off. If the option stops being passed, the sandbox
 * silently keeps the strict policy (a bug, but a safe one); if it starts being
 * passed unconditionally, every project gets the exception (not safe at all).
 */

jest.mock("../../../../../Server/Utils/VM/VMAPI", () => {
  return {
    __esModule: true,
    default: {
      runCodeInSandbox: jest.fn(),
    },
  };
});

const PROJECT_ID: ObjectID = ObjectID.generate();

function makeOptions(): RunOptions {
  return {
    log: jest.fn() as RunOptions["log"],
    workflowLogId: ObjectID.generate(),
    workflowId: ObjectID.generate(),
    projectId: PROJECT_ID,
    onError: ((exception: Exception): Exception => {
      return exception;
    }) as RunOptions["onError"],
    executeWorkflow: async (): Promise<void> => {},
  };
}

function sandboxMock(): jest.Mock {
  return VMUtil.runCodeInSandbox as unknown as jest.Mock;
}

describe("JavaScript workflow component — private network opt-in", () => {
  let allowedSpy: jest.SpiedFunction<
    (projectId: ObjectID | null | undefined) => Promise<boolean>
  >;

  beforeEach(() => {
    jest.clearAllMocks();

    allowedSpy = jest.spyOn(
      ProjectService,
      "isPrivateNetworkWebhookAllowed",
    ) as unknown as typeof allowedSpy;
    allowedSpy.mockResolvedValue(false);

    sandboxMock().mockResolvedValue({
      returnValue: { ok: true },
      logMessages: [],
      capturedMetrics: [],
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("asks about the project the workflow is running in", async () => {
    await new JavaScriptCode().run(
      { code: "return {};", arguments: {} },
      makeOptions(),
    );

    expect(allowedSpy).toHaveBeenCalledWith(PROJECT_ID);
  });

  test("runs the sandbox with the strict policy when the project has not opted in", async () => {
    await new JavaScriptCode().run(
      { code: "return {};", arguments: {} },
      makeOptions(),
    );

    expect(sandboxMock()).toHaveBeenCalledTimes(1);
    expect(
      (sandboxMock().mock.calls[0] as Array<Record<string, unknown>>)[0]?.[
        "options"
      ],
    ).toMatchObject({ allowPrivateNetworkRequests: false });
  });

  test("passes the opt-in through when the project has it", async () => {
    allowedSpy.mockResolvedValue(true);

    await new JavaScriptCode().run(
      { code: "return {};", arguments: {} },
      makeOptions(),
    );

    expect(
      (sandboxMock().mock.calls[0] as Array<Record<string, unknown>>)[0]?.[
        "options"
      ],
    ).toMatchObject({ allowPrivateNetworkRequests: true });
  });
});
