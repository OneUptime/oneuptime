import GitHubActions, {
  GitHubAction,
} from "../../../../../Server/Types/Workflow/Components/GitHub/Actions";
import GitHubWorkflowClient from "../../../../../Server/Utils/CodeRepository/GitHub/GitHubWorkflowClient";
import GitHubUtil from "../../../../../Server/Utils/CodeRepository/GitHub/GitHub";
import GitHubInstallationBinding from "../../../../../Server/Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import CodeRepositoryService from "../../../../../Server/Services/CodeRepositoryService";
import ComponentCode, {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryType from "../../../../../Types/CodeRepository/CodeRepositoryType";
import Exception from "../../../../../Types/Exception/Exception";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import ComponentMetadata, {
  Argument,
  Port,
} from "../../../../../Types/Workflow/Component";
import GitHubMetadata from "../../../../../Types/Workflow/Components/GitHubActions";
import API from "../../../../../Utils/API";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

const projectId: ObjectID = ObjectID.generate();
const options: RunOptions = {
  projectId,
  workflowId: ObjectID.generate(),
  workflowLogId: ObjectID.generate(),
  log: jest.fn(),
  onError: (error: Exception): Exception => {
    return error;
  },
  executeWorkflow: jest.fn<Promise<void>, []>(),
  getRemainingExecutionTimeInMs: (): number => {
    return 10_000;
  },
};

function run(id: ComponentID, args: JSONObject): Promise<RunReturnType> {
  return GitHubActions.find((action: ComponentCode): boolean => {
    return action.getMetadata().id === id;
  })!.run({ repository: "acme/api", ...args }, options);
}

interface OperationCase {
  id: ComponentID;
  args: JSONObject;
  method: string;
  path: string;
  body?: JSONObject;
  permission: JSONObject;
}

const operations: Array<OperationCase> = [
  {
    id: ComponentID.GitHubCreateIssue,
    args: {
      title: "Investigate outage",
      body: "Impact",
      labels: ["incident"],
      assignees: ["octocat"],
    },
    method: "POST",
    path: "issues",
    body: {
      title: "Investigate outage",
      body: "Impact",
      labels: ["incident"],
      assignees: ["octocat"],
    },
    permission: { issues: "write" },
  },
  {
    id: ComponentID.GitHubUpdateIssue,
    args: {
      number: 7,
      title: "Resolved",
      body: "",
      state: "closed",
      labels: [],
      assignees: [],
    },
    method: "PATCH",
    path: "issues/7",
    body: {
      title: "Resolved",
      body: "",
      state: "closed",
      labels: [],
      assignees: [],
    },
    permission: { issues: "write" },
  },
  {
    id: ComponentID.GitHubGetIssue,
    args: { number: 7 },
    method: "GET",
    path: "issues/7",
    permission: { issues: "read" },
  },
  {
    id: ComponentID.GitHubAddComment,
    args: { number: 7, body: "Incident acknowledged" },
    method: "POST",
    path: "issues/7/comments",
    body: { body: "Incident acknowledged" },
    permission: { issues: "write" },
  },
  {
    id: ComponentID.GitHubAddLabels,
    args: { number: 7, labels: ["incident", "urgent"] },
    method: "POST",
    path: "issues/7/labels",
    body: { labels: ["incident", "urgent"] },
    permission: { issues: "write" },
  },
  {
    id: ComponentID.GitHubRemoveLabel,
    args: { number: 7, label: "needs/triage" },
    method: "DELETE",
    path: "issues/7/labels/needs%2Ftriage",
    permission: { issues: "write" },
  },
  {
    id: ComponentID.GitHubGetPullRequest,
    args: { number: 7 },
    method: "GET",
    path: "pulls/7",
    permission: { pull_requests: "read" },
  },
  {
    id: ComponentID.GitHubUpdatePullRequest,
    args: {
      number: 7,
      title: "Fix outage",
      body: "Details",
      state: "open",
      base: "release",
    },
    method: "PATCH",
    path: "pulls/7",
    body: {
      title: "Fix outage",
      body: "Details",
      state: "open",
      base: "release",
    },
    permission: { pull_requests: "write" },
  },
  {
    id: ComponentID.GitHubRequestReview,
    args: { number: 7, reviewers: ["octocat"], "team-reviewers": ["platform"] },
    method: "POST",
    path: "pulls/7/requested_reviewers",
    body: { reviewers: ["octocat"], team_reviewers: ["platform"] },
    permission: { pull_requests: "write" },
  },
];

describe("GitHub workflow actions end-to-end through connected repository authorization and HTTP transport", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(CodeRepositoryService, "findOneBy").mockResolvedValue(
      Object.assign(new CodeRepository(), {
        _id: ObjectID.generate().toString(),
        projectId,
        repositoryHostedAt: CodeRepositoryType.GitHub,
        gitHubAppInstallationId: "12345",
        organizationName: "acme",
        repositoryName: "api",
      }),
    );
    jest
      .spyOn(GitHubInstallationBinding, "isRepositoryInstallationBound")
      .mockResolvedValue(true);
    jest
      .spyOn(GitHubUtil, "getInstallationAccessToken")
      .mockResolvedValue({ token: "ghs_secret_token", expiresAt: new Date() });
    jest
      .spyOn(API, "fetch")
      .mockImplementation(
        async (
          request: Parameters<typeof API.fetch>[0],
        ): Promise<HTTPResponse<JSONObject | JSONArray>> => {
          if (request.url.toString().includes("/labels")) {
            return new HTTPResponse(200, [{ name: "incident" }], {});
          }
          return new HTTPResponse(
            200,
            {
              id: 9007,
              number: 7,
              html_url: "https://github.com/acme/api/issues/7",
              title: "Investigate outage",
              body: "Impact",
              state: "open",
              labels: [{ name: "incident" }],
            },
            { Authorization: "do-not-return" },
          );
        },
      );
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each(operations)(
    "$id uses the correct method, path, narrowed scope, and body",
    async (operation: OperationCase) => {
      const result: RunReturnType = await run(operation.id, operation.args);
      expect(result.executePort?.id).toBe("success");
      expect(GitHubUtil.getInstallationAccessToken).toHaveBeenCalledWith(
        "12345",
        expect.objectContaining({
          permissions: { metadata: "read", ...operation.permission },
          repositories: ["api"],
        }),
      );
      const call: Parameters<typeof API.fetch>[0] = (API.fetch as jest.Mock)
        .mock.calls[0]![0] as Parameters<typeof API.fetch>[0];
      expect(call.method).toBe(operation.method);
      expect(call.url.toString()).toBe(
        `https://api.github.com/repos/acme/api/${operation.path}`,
      );
      expect(call.data).toEqual(operation.body);
      expect(call.options?.timeout).toBe(9500);
      const isLabelAction: boolean =
        operation.id === ComponentID.GitHubAddLabels ||
        operation.id === ComponentID.GitHubRemoveLabel;
      expect(result.returnValues).toMatchObject({
        id: isLabelAction ? null : 9007,
        number: 7,
        url: isLabelAction ? null : "https://github.com/acme/api/issues/7",
        title: isLabelAction ? null : "Investigate outage",
        body: isLabelAction ? null : "Impact",
        state: isLabelAction ? null : "open",
        labels: ["incident"],
        "response-status": 200,
        error: null,
      });
      expect(JSON.stringify(result.returnValues)).not.toContain(
        "ghs_secret_token",
      );
      expect(JSON.stringify(result.returnValues)).not.toContain(
        "do-not-return",
      );
      expect(options.log).not.toHaveBeenCalled();
    },
  );

  test("a create issue needs only a title, and preserves Markdown whitespace", async () => {
    await run(ComponentID.GitHubCreateIssue, {
      title: "Outage",
      body: "\n  ```\n  stack trace\n  ```\n",
    });
    expect((API.fetch as jest.Mock).mock.calls[0]![0].data).toEqual({
      title: "Outage",
      body: "\n  ```\n  stack trace\n  ```\n",
    });
  });

  test.each([
    [
      ComponentID.GitHubCreateIssue,
      { title: "Outage", assignees: ["mona-cat_octo"] },
      "assignees",
    ],
    [
      ComponentID.GitHubUpdateIssue,
      { number: 7, assignees: ["mona-cat_octo"] },
      "assignees",
    ],
    [
      ComponentID.GitHubRequestReview,
      { number: 7, reviewers: ["mona-cat_octo"] },
      "reviewers",
    ],
  ])(
    "%s supports Enterprise Managed User accounts",
    async (id: unknown, args: unknown, field: unknown) => {
      const result: RunReturnType = await run(
        id as ComponentID,
        args as JSONObject,
      );
      expect(result.executePort?.id).toBe("success");
      expect(
        (API.fetch as jest.Mock).mock.calls[0]![0].data[field as string],
      ).toEqual(["mona-cat_octo"]);
    },
  );

  test("accepts number strings from workflow template substitutions", async () => {
    const result: RunReturnType = await run(ComponentID.GitHubAddComment, {
      number: "7",
      body: "Done",
    });
    expect(result.executePort?.id).toBe("success");
    expect((API.fetch as jest.Mock).mock.calls[0]![0].url.toString()).toContain(
      "issues/7/comments",
    );
  });

  test("accepts JSON string arrays and deduplicates labels", async () => {
    await run(ComponentID.GitHubAddLabels, {
      number: 7,
      labels: '["incident", "incident", "urgent"]',
    });
    expect((API.fetch as jest.Mock).mock.calls[0]![0].data).toEqual({
      labels: ["incident", "urgent"],
    });
  });

  test.each([
    ComponentID.GitHubUpdateIssue,
    ComponentID.GitHubUpdatePullRequest,
  ])("%s sends only provided update fields", async (id: ComponentID) => {
    await run(id, { number: 7, state: "closed" });
    expect((API.fetch as jest.Mock).mock.calls[0]![0].data).toEqual({
      state: "closed",
    });
  });

  test("comment responses keep the target item number and GitHub comment URL", async () => {
    jest.mocked(API.fetch).mockResolvedValue(
      new HTTPResponse(
        201,
        {
          id: 991,
          body: "Done",
          html_url: "https://github.com/acme/api/pull/7#issuecomment-991",
        },
        {},
      ),
    );
    const result: RunReturnType = await run(ComponentID.GitHubAddComment, {
      number: 7,
      body: "Done",
    });
    expect(result.returnValues).toMatchObject({
      id: 991,
      number: 7,
      body: "Done",
      url: "https://github.com/acme/api/pull/7#issuecomment-991",
      "response-status": 201,
    });
  });

  test.each([ComponentID.GitHubAddLabels, ComponentID.GitHubRemoveLabel])(
    "%s maps GitHub's array response",
    async (id: ComponentID) => {
      jest
        .mocked(API.fetch)
        .mockResolvedValue(
          new HTTPResponse(200, [{ name: "incident" }, { name: "urgent" }], {}),
        );
      const result: RunReturnType = await run(id, {
        number: 7,
        label: "triage",
        labels: ["urgent"],
      });
      expect(result.returnValues).toMatchObject({
        number: 7,
        labels: ["incident", "urgent"],
        error: null,
      });
    },
  );

  test.each([
    { reviewers: ["octocat"] },
    { "team-reviewers": ["platform-team"] },
  ])(
    "request review supports users or teams alone: %j",
    async (args: JSONObject) => {
      jest.mocked(API.fetch).mockResolvedValue(
        new HTTPResponse(
          201,
          {
            id: 9007,
            number: 7,
            requested_reviewers: [{ login: "octocat" }],
            requested_teams: [{ slug: "platform-team" }],
          },
          {},
        ),
      );
      const result: RunReturnType = await run(ComponentID.GitHubRequestReview, {
        number: 7,
        ...args,
      });
      expect(result.executePort?.id).toBe("success");
      expect(result.returnValues).toMatchObject({
        reviewers: ["octocat"],
        "team-reviewers": ["platform-team"],
      });
    },
  );

  test.each([
    undefined,
    null,
    "",
    0,
    -1,
    1.5,
    "1e2",
    "07",
    " 7 ",
    "../7",
    true,
    {},
    [],
    Number.MAX_SAFE_INTEGER + 1,
  ])(
    "rejects invalid issue number %j before authorization",
    async (number: unknown) => {
      const result: RunReturnType = await run(ComponentID.GitHubGetIssue, {
        number: number as never,
      });
      expect(result.executePort?.id).toBe("error");
      expect(result.returnValues["error"]).toContain("positive whole");
      expect(CodeRepositoryService.findOneBy).not.toHaveBeenCalled();
      expect(API.fetch).not.toHaveBeenCalled();
    },
  );

  test.each([
    [ComponentID.GitHubCreateIssue, {}],
    [ComponentID.GitHubCreateIssue, { title: "   " }],
    [ComponentID.GitHubCreateIssue, { title: 99 }],
    [ComponentID.GitHubCreateIssue, { title: "x".repeat(257) }],
    [ComponentID.GitHubUpdateIssue, { number: 7 }],
    [ComponentID.GitHubUpdatePullRequest, { number: 7 }],
    [ComponentID.GitHubUpdateIssue, { number: 7, state: "merged" }],
    [ComponentID.GitHubUpdatePullRequest, { number: 7, state: "merged" }],
    [ComponentID.GitHubUpdatePullRequest, { number: 7, title: "" }],
    [ComponentID.GitHubUpdatePullRequest, { number: 7, base: " " }],
    [ComponentID.GitHubAddComment, { number: 7, body: "" }],
    [ComponentID.GitHubAddComment, { number: 7, body: " " }],
    [ComponentID.GitHubAddComment, { number: 7, body: { unsafe: true } }],
    [ComponentID.GitHubAddComment, { number: 7, body: "x".repeat(65537) }],
    [ComponentID.GitHubAddComment, { number: 7, body: "test\0text" }],
    [ComponentID.GitHubAddLabels, { number: 7, labels: [] }],
    [ComponentID.GitHubAddLabels, { number: 7, labels: "not json" }],
    [ComponentID.GitHubAddLabels, { number: 7, labels: { name: "bug" } }],
    [ComponentID.GitHubAddLabels, { number: 7, labels: [1] }],
    [ComponentID.GitHubAddLabels, { number: 7, labels: [""] }],
    [ComponentID.GitHubAddLabels, { number: 7, labels: ["x".repeat(101)] }],
    [
      ComponentID.GitHubAddLabels,
      { number: 7, labels: Array(101).fill("bug") },
    ],
    [ComponentID.GitHubRemoveLabel, { number: 7, label: ".." }],
    [ComponentID.GitHubRemoveLabel, { number: 7, label: "." }],
    [ComponentID.GitHubRemoveLabel, { number: 7, label: "" }],
    [ComponentID.GitHubRequestReview, { number: 7 }],
    [ComponentID.GitHubRequestReview, { number: 7, reviewers: [] }],
    [ComponentID.GitHubRequestReview, { number: 7, reviewers: ["org/user"] }],
    [
      ComponentID.GitHubRequestReview,
      { number: 7, "team-reviewers": ["org/team"] },
    ],
    [ComponentID.GitHubCreateIssue, { title: "Issue", assignees: ["../user"] }],
  ])(
    "validates %s arguments without API side effects",
    async (id: unknown, args: unknown) => {
      const result: RunReturnType = await run(
        id as ComponentID,
        args as JSONObject,
      );
      expect(result.executePort?.id).toBe("error");
      expect(result.returnValues["error"]).toEqual(expect.any(String));
      expect(CodeRepositoryService.findOneBy).not.toHaveBeenCalled();
      expect(API.fetch).not.toHaveBeenCalled();
    },
  );

  test.each(operations)(
    "$id cannot use a repository from another project",
    async (operation: OperationCase) => {
      jest.mocked(CodeRepositoryService.findOneBy).mockResolvedValue(
        Object.assign(new CodeRepository(), {
          projectId: ObjectID.generate(),
          repositoryHostedAt: CodeRepositoryType.GitHub,
          gitHubAppInstallationId: "9999",
          organizationName: "acme",
          repositoryName: "api",
        }),
      );
      const result: RunReturnType = await run(operation.id, operation.args);
      expect(result.executePort?.id).toBe("error");
      expect(GitHubUtil.getInstallationAccessToken).not.toHaveBeenCalled();
      expect(API.fetch).not.toHaveBeenCalled();
    },
  );

  test.each(operations)(
    "$id rejects malformed successful payloads without exposing their contents or retrying",
    async (operation: OperationCase) => {
      const statusCode: number = operation.method === "GET" ? 200 : 201;
      const malformed: Array<JSONObject | JSONArray> = [
        {},
        { message: "private upstream response content" },
        { id: "9007", number: 7 },
        [{ unexpected: true }],
      ];
      for (const payload of malformed) {
        jest
          .mocked(API.fetch)
          .mockClear()
          .mockResolvedValue(new HTTPResponse(statusCode, payload, {}));
        const result: RunReturnType = await run(operation.id, operation.args);
        expect(result.executePort?.id).toBe("error");
        expect(result.returnValues["response-status"]).toBe(statusCode);
        expect(result.returnValues["error"]).toContain(
          "invalid response for this action",
        );
        if (operation.method !== "GET") {
          expect(result.returnValues["error"]).toContain(
            "Check GitHub before retrying",
          );
        }
        expect(JSON.stringify(result.returnValues)).not.toContain(
          "private upstream response content",
        );
        expect(API.fetch).toHaveBeenCalledTimes(1);
      }
    },
  );

  test.each(operations)(
    "$id accepts its minimum valid response without requiring optional fields",
    async (operation: OperationCase) => {
      const isLabelAction: boolean =
        operation.id === ComponentID.GitHubAddLabels ||
        operation.id === ComponentID.GitHubRemoveLabel;
      const payload: JSONObject | JSONArray = isLabelAction
        ? [{ name: "incident" }]
        : operation.id === ComponentID.GitHubAddComment
          ? { id: 9007 }
          : { id: 9007, number: 7 };
      jest
        .mocked(API.fetch)
        .mockResolvedValue(new HTTPResponse(200, payload, {}));
      const result: RunReturnType = await run(operation.id, operation.args);
      expect(result.executePort?.id).toBe("success");
      expect(result.returnValues).toMatchObject({
        error: null,
        number: 7,
        url: null,
        title: null,
        body: null,
      });
    },
  );

  test.each(
    operations.filter((operation: OperationCase): boolean => {
      return ![
        ComponentID.GitHubAddComment,
        ComponentID.GitHubAddLabels,
        ComponentID.GitHubRemoveLabel,
      ].includes(operation.id);
    }),
  )(
    "$id requires positive numeric identities and the correct issue or PR number",
    async (operation: OperationCase) => {
      const malformed: Array<JSONObject | JSONArray> = [
        [],
        { number: 7 },
        { id: 0, number: 7 },
        { id: -1, number: 7 },
        { id: 1.5, number: 7 },
        { id: 9007 },
        { id: 9007, number: "7" },
        { id: 9007, number: 0 },
        { id: 9007, number: -1 },
        { id: 9007, number: 1.5 },
      ];
      if (operation.id !== ComponentID.GitHubCreateIssue) {
        malformed.push({ id: 9007, number: 8 });
      }
      for (const payload of malformed) {
        jest
          .mocked(API.fetch)
          .mockResolvedValue(new HTTPResponse(200, payload, {}));
        const result: RunReturnType = await run(operation.id, operation.args);
        expect(result.executePort?.id).toBe("error");
        expect(result.returnValues["response-status"]).toBe(200);
      }
    },
  );

  test("comment creation requires a positive numeric comment identity", async () => {
    for (const identity of [
      undefined,
      null,
      "991",
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      jest
        .mocked(API.fetch)
        .mockResolvedValue(
          new HTTPResponse(201, { id: identity, body: "Done" }, {}),
        );
      const result: RunReturnType = await run(ComponentID.GitHubAddComment, {
        number: 7,
        body: "Done",
      });
      expect(result.executePort?.id).toBe("error");
      expect(result.returnValues["response-status"]).toBe(201);
      expect(result.returnValues["error"]).toContain(
        "Check GitHub before retrying",
      );
    }
  });

  test.each([ComponentID.GitHubAddLabels, ComponentID.GitHubRemoveLabel])(
    "%s rejects malformed label entries instead of reporting partial labels",
    async (id: ComponentID) => {
      for (const label of [
        null,
        false,
        "incident",
        [],
        {},
        { name: null },
        { name: "" },
        { name: 1 },
      ]) {
        jest
          .mocked(API.fetch)
          .mockResolvedValue(
            new HTTPResponse(
              200,
              [{ name: "valid" }, label as unknown as JSONObject],
              {},
            ),
          );
        const result: RunReturnType = await run(id, {
          number: 7,
          label: "incident",
          labels: ["incident"],
        });
        expect(result.executePort?.id).toBe("error");
        expect(result.returnValues["response-status"]).toBe(200);
      }
    },
  );

  test.each([ComponentID.GitHubAddLabels, ComponentID.GitHubRemoveLabel])(
    "%s accepts a valid empty label array",
    async (id: ComponentID) => {
      jest.mocked(API.fetch).mockResolvedValue(new HTTPResponse(200, [], {}));
      const result: RunReturnType = await run(id, {
        number: 7,
        label: "incident",
        labels: ["incident"],
      });
      expect(result.executePort?.id).toBe("success");
      expect(result.returnValues).toMatchObject({
        number: 7,
        labels: [],
        error: null,
        "response-status": 200,
      });
    },
  );

  test.each(operations)(
    "$id follows its Error port for GitHub errors",
    async (operation: OperationCase) => {
      jest
        .mocked(API.fetch)
        .mockResolvedValue(
          new HTTPErrorResponse(
            403,
            { message: "Authorization: ghs_secret_token" },
            {},
          ),
        );
      const result: RunReturnType = await run(operation.id, operation.args);
      expect(result.executePort?.id).toBe("error");
      expect(result.returnValues["response-status"]).toBe(403);
      expect(JSON.stringify(result.returnValues)).not.toContain(
        "ghs_secret_token",
      );
      expect(API.fetch).toHaveBeenCalledTimes(1);
      expect(options.log).not.toHaveBeenCalled();
    },
  );

  test("untrusted exception messages are replaced before they enter workflow output", async () => {
    jest
      .spyOn(GitHubWorkflowClient, "request")
      .mockRejectedValue(new Error("secret credentials from database"));
    const result: RunReturnType = await run(ComponentID.GitHubGetIssue, {
      number: 7,
    });
    expect(result.executePort?.id).toBe("error");
    expect(JSON.stringify(result)).not.toContain("secret credentials");
  });

  test("fails safely for a runtime component with an unsupported ID", async () => {
    const metadata: ComponentMetadata = {
      ...GitHubMetadata[0]!,
      id: "invalid-action",
    };
    const result: RunReturnType = await new GitHubAction(metadata).run(
      { repository: "acme/api", number: 7 },
      options,
    );
    expect(result.executePort?.id).toBe("error");
    expect(result.returnValues["error"]).toBe("Unsupported GitHub action.");
    expect(API.fetch).not.toHaveBeenCalled();
  });

  test("reports missing execution ports through the runner error handler", async () => {
    const metadata: ComponentMetadata = { ...GitHubMetadata[0]!, outPorts: [] };
    await expect(new GitHubAction(metadata).run({}, options)).rejects.toThrow(
      "ports are not configured",
    );
  });

  test("all nine actions expose matching metadata, success/error ports, and sensitive content annotations", () => {
    expect(GitHubActions).toHaveLength(9);
    expect(
      new Set(
        GitHubMetadata.map((metadata: ComponentMetadata): string => {
          return metadata.id;
        }),
      ).size,
    ).toBe(9);
    for (const action of GitHubActions) {
      const metadata: ComponentMetadata = action.getMetadata();
      expect(
        metadata.arguments.find((arg: Argument): boolean => {
          return arg.id === "repository";
        })?.required,
      ).toBe(true);
      expect(
        metadata.outPorts.map((port: Port): string => {
          return port.id;
        }),
      ).toEqual(["success", "error"]);
      for (const field of [...metadata.arguments, ...metadata.returnValues]) {
        if (field.id === "body" || field.id === "title") {
          expect(field.isSensitive).toBe(true);
        }
      }
    }
  });
});
