import GitHubEventTrigger from "../../../../../Server/Types/Workflow/Components/GitHub/GitHubEvent";
import WorkflowService from "../../../../../Server/Services/WorkflowService";
import WorkflowLogService from "../../../../../Server/Services/WorkflowLogService";
import WorkflowVariableService from "../../../../../Server/Services/WorkflowVariableService";
import GitHubInstallationBinding from "../../../../../Server/Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import GitHubWorkflowClient from "../../../../../Server/Utils/CodeRepository/GitHub/GitHubWorkflowClient";
import GitHubEventUtil from "../../../../../Utils/CodeRepository/GitHubEventUtil";
import { GitHubEventEnvelope } from "../../../../../Types/CodeRepository/GitHubEvent";
import ObjectID from "../../../../../Types/ObjectID";
import Workflow from "../../../../../Models/DatabaseModels/Workflow";
import WorkflowVariable from "../../../../../Models/DatabaseModels/WorkflowVariable";
import { JSONObject } from "../../../../../Types/JSON";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import ComponentMetadata, {
  Argument,
  ReturnValue,
} from "../../../../../Types/Workflow/Component";
import { ExecuteWorkflowType } from "../../../../../Server/Types/Workflow/TriggerCode";
import Exception from "../../../../../Types/Exception/Exception";
import WorkflowStatus from "../../../../../Types/Workflow/WorkflowStatus";

jest.mock("../../../../../Server/Services/WorkflowService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});
jest.mock("../../../../../Server/Services/WorkflowLogService", () => {
  return { __esModule: true, default: { create: jest.fn() } };
});
jest.mock("../../../../../Server/Services/WorkflowVariableService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});
jest.mock(
  "../../../../../Server/Utils/CodeRepository/GitHub/GitHubInstallationBinding",
  () => {
    return {
      __esModule: true,
      default: { assertInstallationBoundToProject: jest.fn() },
    };
  },
);
jest.mock(
  "../../../../../Server/Utils/CodeRepository/GitHub/GitHubWorkflowClient",
  () => {
    return { __esModule: true, default: { hasWriteAccess: jest.fn() } };
  },
);
jest.mock("../../../../../Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../../../Server/Utils/Logger", () => {
  return { __esModule: true, default: { error: jest.fn(), debug: jest.fn() } };
});

const findWorkflows: jest.Mock = WorkflowService.findBy as jest.Mock;
const createLog: jest.Mock = WorkflowLogService.create as jest.Mock;
const findVariables: jest.Mock = WorkflowVariableService.findBy as jest.Mock;
const assertBound: jest.Mock =
  GitHubInstallationBinding.assertInstallationBoundToProject as jest.Mock;
const hasWriteAccess: jest.Mock =
  GitHubWorkflowClient.hasWriteAccess as jest.Mock;

function makeWorkflow(filters: JSONObject = {}): Workflow {
  const workflow: Workflow = new Workflow();
  workflow.id = ObjectID.generate();
  workflow.triggerArguments = { event: "issue_comment", ...filters };
  return workflow;
}

function makeEnvelope(event: string = "issue_comment"): GitHubEventEnvelope {
  const payload: JSONObject = {
    action: event === "pull_request_review" ? "submitted" : "created",
    installation: { id: 123 },
    repository: { id: 456, full_name: "acme/service" },
    sender: { login: "octocat", type: "User" },
    issue: {
      number: 7,
      title: "Production outage",
      body: "Details",
      labels: [{ name: "incident" }],
    },
    pull_request: { number: 7, title: "Fix outage", head: { ref: "main" } },
    comment: { body: "@oneuptime incident Production outage" },
    review: { body: "@oneuptime incident Production outage" },
    ref: "refs/heads/main",
  };
  return GitHubEventUtil.normalize({
    event,
    deliveryId: "delivery-1",
    payload,
    codeRepositoryId: ObjectID.generate().toString(),
  })!;
}

function variable(name: string, content: string): WorkflowVariable {
  const item: WorkflowVariable = new WorkflowVariable();
  item.name = name;
  item.content = content;
  return item;
}

function runOptions(projectId: ObjectID): RunOptions {
  return {
    projectId,
    workflowId: ObjectID.generate(),
    workflowLogId: ObjectID.generate(),
    log: jest.fn(),
    onError: (error: Exception): Exception => {
      return error;
    },
    executeWorkflow: async (): Promise<void> => {},
  };
}

describe("GitHub event workflow dispatch", () => {
  let trigger: GitHubEventTrigger;
  let projectId: ObjectID;
  let execute: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    trigger = new GitHubEventTrigger();
    projectId = ObjectID.generate();
    execute = jest.fn().mockResolvedValue(undefined);
    findWorkflows.mockResolvedValue([]);
    createLog.mockResolvedValue({});
    findVariables.mockResolvedValue([]);
    assertBound.mockResolvedValue(undefined);
    hasWriteAccess.mockResolvedValue(true);
  });

  test("queries only enabled GitHub workflows in the bound project", async () => {
    const envelope: GitHubEventEnvelope = makeEnvelope();
    expect(await trigger.dispatch({ projectId, envelope }, execute)).toBe(0);
    expect(assertBound).toHaveBeenCalledWith({
      projectId,
      installationId: "123",
    });
    expect(findWorkflows).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          projectId,
          triggerId: ComponentID.GitHubEvent,
          isEnabled: true,
        },
        props: { isRoot: true },
      }),
    );
    expect(execute).not.toHaveBeenCalled();
    expect(hasWriteAccess).not.toHaveBeenCalled();
  });

  test("rejects an installation that is no longer bound before reading workflows", async () => {
    assertBound.mockRejectedValue(new Error("installation disconnected"));
    await expect(
      trigger.dispatch({ projectId, envelope: makeEnvelope() }, execute),
    ).rejects.toThrow("installation disconnected");
    expect(findWorkflows).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  test("rejects events without a valid connected repository", async () => {
    await expect(
      trigger.dispatch(
        { projectId, envelope: { ...makeEnvelope(), codeRepositoryId: "" } },
        execute,
      ),
    ).rejects.toThrow("connected repository");
    expect(findWorkflows).not.toHaveBeenCalled();
  });

  test("ignores unsupported events", async () => {
    expect(
      await trigger.dispatch(
        { projectId, envelope: { event: "ping" } },
        execute,
      ),
    ).toBe(0);
    expect(assertBound).not.toHaveBeenCalled();
    expect(findWorkflows).not.toHaveBeenCalled();
  });

  test("emits normalized event fields and stable per-workflow delivery keys", async () => {
    const workflow: Workflow = makeWorkflow({
      commentCommand: "@oneuptime incident",
    });
    const envelope: GitHubEventEnvelope = makeEnvelope();
    findWorkflows.mockResolvedValue([workflow]);
    expect(await trigger.dispatch({ projectId, envelope }, execute)).toBe(1);
    expect(execute).toHaveBeenCalledWith({
      workflowId: workflow.id,
      idempotencyKey: `github:123:delivery-1:${workflow.id!.toString()}`,
      returnValues: { ...envelope, commandArguments: "Production outage" },
    });
    expect(hasWriteAccess).toHaveBeenCalledWith({
      projectId,
      repository: envelope.codeRepositoryId,
      username: "octocat",
    });
    expect(findVariables).not.toHaveBeenCalled();
  });

  test("re-normalizes supplied fields from verified payload instead of accepting forged envelope values", async () => {
    const envelope: GitHubEventEnvelope = makeEnvelope();
    findWorkflows.mockResolvedValue([
      makeWorkflow({
        sender: "octocat",
        commentCommand: "@oneuptime incident",
      }),
    ]);
    await trigger.dispatch(
      {
        projectId,
        envelope: {
          ...envelope,
          sender: "attacker",
          installationId: "999",
          repository: "another/repo",
          comment: "tampered",
          isBot: true,
        },
      },
      execute,
    );
    expect(assertBound).toHaveBeenCalledWith({
      projectId,
      installationId: "123",
    });
    expect(execute.mock.calls[0]![0].returnValues).toMatchObject({
      sender: "octocat",
      repository: "acme/service",
      comment: "@oneuptime incident Production outage",
      isBot: false,
    });
  });

  test("does not check permissions or schedule unmatched workflows", async () => {
    findWorkflows.mockResolvedValue([
      makeWorkflow({ repository: "other/repo" }),
      makeWorkflow({ commentCommand: "@oneuptime acknowledge" }),
    ]);
    expect(
      await trigger.dispatch({ projectId, envelope: makeEnvelope() }, execute),
    ).toBe(0);
    expect(hasWriteAccess).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  test("checks current writer permission once for multiple matching workflows", async () => {
    findWorkflows.mockResolvedValue([makeWorkflow(), makeWorkflow()]);
    expect(
      await trigger.dispatch({ projectId, envelope: makeEnvelope() }, execute),
    ).toBe(2);
    expect(hasWriteAccess).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0]![0].idempotencyKey).not.toBe(
      execute.mock.calls[1]![0].idempotencyKey,
    );
  });

  test("denies a non-writer even if webhook author_association claims owner", async () => {
    const envelope: GitHubEventEnvelope = makeEnvelope();
    (envelope.payload["comment"] as JSONObject)["author_association"] = "OWNER";
    findWorkflows.mockResolvedValue([makeWorkflow()]);
    hasWriteAccess.mockResolvedValue(false);
    expect(await trigger.dispatch({ projectId, envelope }, execute)).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });

  test("allows an explicit external-contributor workflow when another workflow requires writers", async () => {
    const publicWorkflow: Workflow = makeWorkflow({
      requireWriteAccess: false,
    });
    findWorkflows.mockResolvedValue([makeWorkflow(), publicWorkflow]);
    hasWriteAccess.mockResolvedValue(false);
    expect(
      await trigger.dispatch({ projectId, envelope: makeEnvelope() }, execute),
    ).toBe(1);
    expect(execute.mock.calls[0]![0].workflowId).toEqual(publicWorkflow.id);
  });

  test.each(["pull_request_review", "pull_request_review_comment"])(
    "applies permission checks to %s",
    async (event: string) => {
      findWorkflows.mockResolvedValue([makeWorkflow({ event })]);
      hasWriteAccess.mockResolvedValue(false);
      expect(
        await trigger.dispatch(
          { projectId, envelope: makeEnvelope(event) },
          execute,
        ),
      ).toBe(0);
      expect(hasWriteAccess).toHaveBeenCalledTimes(1);
      expect(execute).not.toHaveBeenCalled();
    },
  );

  test("does not check commenter access for push events", async () => {
    findWorkflows.mockResolvedValue([makeWorkflow({ event: "push" })]);
    expect(
      await trigger.dispatch(
        { projectId, envelope: makeEnvelope("push") },
        execute,
      ),
    ).toBe(1);
    expect(hasWriteAccess).not.toHaveBeenCalled();
  });

  test("ignores bot comments before requesting access", async () => {
    const envelope: GitHubEventEnvelope = makeEnvelope();
    envelope.payload["sender"] = { type: "Bot", login: "oneuptime[bot]" };
    findWorkflows.mockResolvedValue([makeWorkflow()]);
    expect(await trigger.dispatch({ projectId, envelope }, execute)).toBe(0);
    expect(hasWriteAccess).not.toHaveBeenCalled();
  });

  test("records a malformed filter and still runs independently configured workflows", async () => {
    const invalid: Workflow = makeWorkflow({ commentType: "bad" });
    const valid: Workflow = makeWorkflow();
    findWorkflows.mockResolvedValue([invalid, valid]);
    expect(
      await trigger.dispatch({ projectId, envelope: makeEnvelope() }, execute),
    ).toBe(1);
    expect(createLog).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workflowId: invalid.id,
        projectId,
        workflowStatus: WorkflowStatus.Error,
        logs: expect.stringContaining("commentType"),
      }),
      props: { isRoot: true },
    });
    expect(execute.mock.calls[0]![0].workflowId).toEqual(valid.id);
  });

  test("resolves local/global variables within the workflow's project before matching", async () => {
    const workflow: Workflow = makeWorkflow({
      repository: "{{local.variables.repository}}",
      event: "{{global.variables.event}}",
      commentCommand: "{{local.variables.command}}",
      requireWriteAccess: "{{global.variables.requireWriter}}",
    });
    findWorkflows.mockResolvedValue([workflow]);
    findVariables
      .mockResolvedValueOnce([
        variable("repository", "acme/service"),
        variable("command", "@oneuptime incident"),
      ])
      .mockResolvedValueOnce([
        variable("event", "issue_comment"),
        variable("requireWriter", "false"),
      ]);
    expect(
      await trigger.dispatch({ projectId, envelope: makeEnvelope() }, execute),
    ).toBe(1);
    expect(findVariables.mock.calls[0]![0].query).toEqual({
      projectId,
      workflowId: workflow.id,
    });
    expect(findVariables.mock.calls[1]![0].query.projectId).toEqual(projectId);
    expect(hasWriteAccess).not.toHaveBeenCalled();
    expect(workflow.triggerArguments!["repository"]).toBe(
      "{{local.variables.repository}}",
    );
  });

  test("does not substitute data from GitHub comments into configuration templates", async () => {
    const workflow: Workflow = makeWorkflow({
      repository: "{{payload.repository}}",
    });
    findWorkflows.mockResolvedValue([workflow]);
    expect(
      await trigger.dispatch({ projectId, envelope: makeEnvelope() }, execute),
    ).toBe(0);
    expect(createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          logs: expect.stringContaining("unresolved variable"),
        }),
      }),
    );
  });

  test("does not broaden unresolved repository variables into all repositories", async () => {
    findWorkflows.mockResolvedValue([
      makeWorkflow({ repository: "{{local.variables.missing}}" }),
    ]);
    expect(
      await trigger.dispatch({ projectId, envelope: makeEnvelope() }, execute),
    ).toBe(0);
    expect(createLog).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });

  test.each(["repository", "commentCommand"])(
    "does not broaden an empty %s variable into an unrestricted filter",
    async (filter: string) => {
      findWorkflows.mockResolvedValue([
        makeWorkflow({ [filter]: "{{local.variables.filter}}" }),
      ]);
      findVariables
        .mockResolvedValueOnce([variable("filter", "  ")])
        .mockResolvedValueOnce([]);
      expect(
        await trigger.dispatch(
          { projectId, envelope: makeEnvelope() },
          execute,
        ),
      ).toBe(0);
      expect(createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            logs: expect.stringContaining("empty value"),
          }),
        }),
      );
      expect(execute).not.toHaveBeenCalled();
    },
  );

  test("continues reading workflows beyond the first database page", async () => {
    const firstPage: Array<Workflow> = Array.from(
      { length: 10000 },
      (): Workflow => {
        return {} as Workflow;
      },
    );
    findWorkflows
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([makeWorkflow()]);
    expect(
      await trigger.dispatch({ projectId, envelope: makeEnvelope() }, execute),
    ).toBe(1);
    expect(
      findWorkflows.mock.calls.map((call: Array<{ skip: number }>): number => {
        return call[0]!.skip;
      }),
    ).toEqual([0, 10000]);
  });

  test("retries transient permission errors while still scheduling opted-out workflows", async () => {
    const publicWorkflow: Workflow = makeWorkflow({
      requireWriteAccess: false,
    });
    findWorkflows.mockResolvedValue([makeWorkflow(), publicWorkflow]);
    hasWriteAccess.mockRejectedValue(new Error("GitHub unavailable"));
    await expect(
      trigger.dispatch({ projectId, envelope: makeEnvelope() }, execute),
    ).rejects.toThrow("GitHub unavailable");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0].workflowId).toEqual(publicWorkflow.id);
  });

  test("continues independent workflows after enqueue failure and retries using the same keys", async () => {
    const workflows: Array<Workflow> = [makeWorkflow(), makeWorkflow()];
    findWorkflows.mockResolvedValue(workflows);
    const envelope: GitHubEventEnvelope = makeEnvelope();
    execute
      .mockRejectedValueOnce(new Error("queue unavailable"))
      .mockResolvedValue(undefined);
    await expect(
      trigger.dispatch({ projectId, envelope }, execute),
    ).rejects.toThrow("queue unavailable");
    expect(execute).toHaveBeenCalledTimes(2);
    const firstKeys: Array<string> = execute.mock.calls.map(
      (call: Array<ExecuteWorkflowType>): string => {
        return call[0]!.idempotencyKey!;
      },
    );
    execute.mockClear();
    expect(await trigger.dispatch({ projectId, envelope }, execute)).toBe(2);
    expect(
      execute.mock.calls.map((call: Array<ExecuteWorkflowType>): string => {
        return call[0]!.idempotencyKey!;
      }),
    ).toEqual(firstKeys);
  });

  test("propagates database failures instead of acknowledging lost work", async () => {
    findWorkflows.mockRejectedValue(new Error("database unavailable"));
    await expect(
      trigger.dispatch({ projectId, envelope: makeEnvelope() }, execute),
    ).rejects.toThrow("database unavailable");
  });

  test("retries failure reading variables without treating it as an invalid filter", async () => {
    findWorkflows.mockResolvedValue([
      makeWorkflow({ repository: "{{local.variables.repo}}" }),
    ]);
    findVariables.mockRejectedValue(new Error("variable database unavailable"));
    await expect(
      trigger.dispatch({ projectId, envelope: makeEnvelope() }, execute),
    ).rejects.toThrow("variable database unavailable");
    expect(createLog).not.toHaveBeenCalled();
  });

  test("retries errors persisting filter failures", async () => {
    findWorkflows.mockResolvedValue([makeWorkflow({ event: "invalid" })]);
    createLog.mockRejectedValue(new Error("cannot write log"));
    await expect(
      trigger.dispatch({ projectId, envelope: makeEnvelope() }, execute),
    ).rejects.toThrow("cannot write log");
  });

  test("returns event data through the success port at graph execution", async () => {
    const envelope: GitHubEventEnvelope = makeEnvelope();
    const options: RunOptions = {
      projectId,
      workflowId: ObjectID.generate(),
      workflowLogId: ObjectID.generate(),
      log: jest.fn(),
      onError: (error: Exception): Exception => {
        return error;
      },
      executeWorkflow: async (): Promise<void> => {},
    };
    expect(await trigger.run(envelope, options)).toEqual({
      returnValues: envelope,
      executePort: expect.objectContaining({ id: "success" }),
    });
  });

  test("offers optional manual samples for every event output", () => {
    const metadata: ComponentMetadata = trigger.getMetadata();
    expect(
      metadata.runWorkflowManuallyArguments!.map(
        (argument: Argument): string => {
          return argument.id;
        },
      ),
    ).toEqual(
      metadata.returnValues.map((value: ReturnValue): string => {
        return value.id;
      }),
    );
    expect(
      metadata.runWorkflowManuallyArguments!.every(
        (argument: Argument): boolean => {
          return !argument.required;
        },
      ),
    ).toBe(true);
    expect(
      metadata.runWorkflowManuallyArguments!.find(
        (argument: Argument): boolean => {
          return argument.id === "event";
        },
      )!.description,
    ).toContain("workflow actions will execute");
    expect(
      metadata.runWorkflowManuallyArguments!.find(
        (argument: Argument): boolean => {
          return argument.id === "comment";
        },
      )!.placeholder,
    ).toBe("@oneuptime incident Database unavailable");
  });

  test("parses manual JSON, number, and boolean samples without invoking webhook admission", async () => {
    const args: JSONObject = {
      event: "issue_comment",
      repository: "acme/service",
      issueNumber: "42",
      isBot: "false",
      isPullRequest: "true",
      labels: '["incident"]',
      payload: '{"sample":true}',
      comment: "Sample comment",
      commandArguments: "Sample incident",
    };
    const result: RunReturnType = await trigger.run(
      args,
      runOptions(projectId),
    );
    expect(result.returnValues).toMatchObject({
      issueNumber: 42,
      isBot: false,
      isPullRequest: true,
      labels: ["incident"],
      payload: { sample: true },
      commandArguments: "Sample incident",
    });
    expect(args["payload"]).toBe('{"sample":true}');
    expect(assertBound).not.toHaveBeenCalled();
    expect(hasWriteAccess).not.toHaveBeenCalled();
    expect(findWorkflows).not.toHaveBeenCalled();
  });

  test.each([
    { payload: "{" },
    { payload: "[]" },
    { payload: "null" },
    { labels: "{}" },
    { labels: "[1]" },
    { labels: "[" },
    { issueNumber: "-1" },
    { issueNumber: "1.5" },
    { issueNumber: "NaN" },
  ])("rejects invalid manual samples %p", async (args: JSONObject) => {
    await expect(trigger.run(args, runOptions(projectId))).rejects.toThrow(
      "Sample GitHub",
    );
  });
});
