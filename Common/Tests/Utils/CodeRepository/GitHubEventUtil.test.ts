import GitHubEventUtil from "../../../Utils/CodeRepository/GitHubEventUtil";
import {
  GITHUB_SUPPORTED_EVENTS,
  GitHubEventEnvelope,
} from "../../../Types/CodeRepository/GitHubEvent";
import { JSONObject } from "../../../Types/JSON";

function payloadFor(event: string): JSONObject {
  const issue: JSONObject = {
    number: 42,
    title: "Service is unavailable",
    body: "Please investigate.",
    html_url: "https://github.com/acme/service/issues/42",
    labels: [{ name: "incident" }, { name: "production" }],
  };
  const pullRequest: JSONObject = {
    ...issue,
    head: { ref: "fix/service" },
    html_url: "https://github.com/acme/service/pull/42",
  };
  const payload: JSONObject = {
    action: "created",
    installation: { id: 123 },
    repository: {
      id: 456,
      full_name: "acme/service",
      html_url: "https://github.com/acme/service",
    },
    sender: { login: "octocat", type: "User" },
  };
  if (event === "issues" || event === "issue_comment") {
    payload["issue"] = issue;
  }
  if (event.startsWith("pull_request")) {
    payload["pull_request"] = pullRequest;
  }
  if (event === "issue_comment" || event === "pull_request_review_comment") {
    payload["comment"] = {
      body: "@oneuptime incident Database unavailable",
      html_url: "https://github.com/acme/service/issues/42#issuecomment-1",
    };
  }
  if (event === "pull_request_review") {
    payload["action"] = "submitted";
    payload["review"] = {
      body: "@oneuptime incident Database unavailable",
      html_url: "https://github.com/acme/service/pull/42#pullrequestreview-1",
    };
  }
  if (event === "push") {
    delete payload["action"];
    payload["ref"] = "refs/heads/main";
    payload["compare"] = "https://github.com/acme/service/compare/a...b";
  }
  if (event === "workflow_run") {
    payload["workflow_run"] = {
      name: "CI",
      head_branch: "main",
      html_url: "https://github.com/acme/service/actions/runs/1",
    };
  }
  if (event === "check_run") {
    payload["check_run"] = {
      name: "Unit tests",
      check_suite: { head_branch: "main" },
    };
  }
  if (event === "check_suite") {
    payload["check_suite"] = { head_branch: "main" };
  }
  if (event === "release") {
    payload["release"] = {
      name: "v1.0",
      body: "Release notes",
      target_commitish: "main",
    };
  }
  if (event === "deployment_status") {
    delete payload["action"];
    payload["deployment_status"] = { state: "success" };
    payload["deployment"] = { ref: "main" };
  }
  return payload;
}

function normalize(
  event: string = "issue_comment",
  payload?: JSONObject,
): GitHubEventEnvelope {
  return GitHubEventUtil.normalize({
    event,
    deliveryId: "delivery-1",
    payload: payload || payloadFor(event),
    codeRepositoryId: "connected-repository",
  })!;
}

describe("GitHub event normalization", () => {
  test.each(GITHUB_SUPPORTED_EVENTS)(
    "normalizes supported %s payloads",
    (event: string) => {
      const payload: JSONObject = payloadFor(event);
      const result: GitHubEventEnvelope = normalize(event, payload);
      expect(result).toMatchObject({
        event,
        installationId: "123",
        repositoryId: "456",
        repository: "acme/service",
        sender: "octocat",
        isBot: false,
        deliveryId: "delivery-1",
        codeRepositoryId: "connected-repository",
        commandArguments: "",
      });
      expect(result.payload).toBe(payload);
      expect(GitHubEventUtil.isSupportedEvent(event)).toBe(true);
    },
  );

  test.each(["ping", "installation", "installation_repositories", "unknown"])(
    "ignores unsupported %s without requiring repository data",
    (event: string) => {
      expect(
        GitHubEventUtil.normalize({
          event,
          payload: {},
          deliveryId: "delivery",
          codeRepositoryId: "",
        }),
      ).toBeNull();
    },
  );

  test.each([
    ["issues", "issue"],
    ["issue_comment", "issue"],
    ["issue_comment", "comment"],
    ["pull_request", "pull_request"],
    ["pull_request_review", "review"],
    ["pull_request_review_comment", "comment"],
    ["workflow_run", "workflow_run"],
    ["check_run", "check_run"],
    ["check_suite", "check_suite"],
    ["release", "release"],
    ["deployment_status", "deployment"],
    ["deployment_status", "deployment_status"],
  ])("rejects %s without its %s object", (event: string, key: string) => {
    const payload: JSONObject = payloadFor(event);
    delete payload[key];
    expect(() => {
      normalize(event, payload);
    }).toThrow();
  });

  test.each(["installation", "repository", "sender"])(
    "requires %s",
    (key: string) => {
      const payload: JSONObject = payloadFor("issue_comment");
      delete payload[key];
      expect(() => {
        normalize("issue_comment", payload);
      }).toThrow();
    },
  );

  test.each([
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    "0",
    "-5",
    "1.2",
    "1e3",
    "",
    true,
    {},
    [],
  ])("rejects malformed installation ID %p", (id: unknown) => {
    const payload: JSONObject = payloadFor("issues");
    payload["installation"] = { id: id as string };
    expect(() => {
      normalize("issues", payload);
    }).toThrow("positive identifier");
  });

  test("accepts numeric IDs represented as strings without losing precision", () => {
    const payload: JSONObject = payloadFor("issues");
    payload["installation"] = { id: "9007199254740991000" };
    expect(normalize("issues", payload).installationId).toBe(
      "9007199254740991000",
    );
  });

  test.each([
    "acme",
    "acme/service/extra",
    "../service",
    "acme/..",
    "acme/service?x=1",
    "https://github.com/acme/service",
    "acme/service\n",
  ])("rejects invalid repository name %s", (name: string) => {
    const payload: JSONObject = payloadFor("issues");
    (payload["repository"] as JSONObject)["full_name"] = name;
    expect(() => {
      normalize("issues", payload);
    }).toThrow("full_name");
  });

  test("distinguishes PR conversation comments from ordinary issue comments", () => {
    const payload: JSONObject = payloadFor("issue_comment");
    expect(normalize("issue_comment", payload).isPullRequest).toBe(false);
    (payload["issue"] as JSONObject)["pull_request"] = {
      url: "https://api.github.com/repos/acme/service/pulls/42",
    };
    expect(normalize("issue_comment", payload).isPullRequest).toBe(true);
    expect(normalize("issue_comment", payload).issueNumber).toBe(42);
  });

  test.each([
    "pull_request",
    "pull_request_review",
    "pull_request_review_comment",
  ])("maps %s to a pull request and source branch", (event: string) => {
    expect(normalize(event)).toMatchObject({
      isPullRequest: true,
      issueNumber: 42,
      branch: "fix/service",
    });
  });

  test("preserves comment whitespace and Unicode verbatim", () => {
    const payload: JSONObject = payloadFor("issue_comment");
    (payload["comment"] as JSONObject)["body"] =
      "  @oneuptime incident café 🚨\n\tproduction  ";
    expect(normalize("issue_comment", payload).comment).toBe(
      "  @oneuptime incident café 🚨\n\tproduction  ",
    );
  });

  test("accepts nullable review bodies and prefers the review URL", () => {
    const payload: JSONObject = payloadFor("pull_request_review");
    (payload["review"] as JSONObject)["body"] = null;
    expect(normalize("pull_request_review", payload)).toMatchObject({
      comment: "",
      url: "https://github.com/acme/service/pull/42#pullrequestreview-1",
    });
  });

  test.each([
    ["Bot", "robot"],
    ["User", "oneuptime[bot]"],
  ])("recognizes bot type %s and login %s", (type: string, login: string) => {
    const payload: JSONObject = payloadFor("issues");
    payload["sender"] = { type, login };
    expect(normalize("issues", payload).isBot).toBe(true);
  });

  test("normalizes branch pushes while retaining tag refs", () => {
    expect(normalize("push")).toMatchObject({
      branch: "main",
      action: "pushed",
      issueNumber: null,
    });
    const payload: JSONObject = payloadFor("push");
    payload["ref"] = "refs/tags/v1.0";
    expect(normalize("push", payload).branch).toBe("refs/tags/v1.0");
  });

  test.each([
    "workflow_run",
    "check_run",
    "check_suite",
    "release",
    "deployment_status",
  ])("extracts branch from %s", (event: string) => {
    expect(normalize(event).branch).toBe("main");
  });

  test("uses deployment state as action", () => {
    expect(normalize("deployment_status").action).toBe("success");
  });

  test("rejects missing actions, push refs, senders, and delivery IDs", () => {
    const payload: JSONObject = payloadFor("issues");
    delete payload["action"];
    expect(() => {
      normalize("issues", payload);
    }).toThrow("action");
    expect(() => {
      normalize("push", { ...payloadFor("push"), ref: "" });
    }).toThrow("ref");
    expect(() => {
      normalize("issues", { ...payloadFor("issues"), sender: {} });
    }).toThrow("sender");
    expect(() => {
      GitHubEventUtil.normalize({
        event: "issues",
        payload: payloadFor("issues"),
        deliveryId: "",
        codeRepositoryId: "",
      });
    }).toThrow("delivery");
  });

  test("normalizes string and object labels, skipping malformed entries", () => {
    const payload: JSONObject = payloadFor("issues");
    (payload["issue"] as JSONObject)["labels"] = [
      "incident",
      { name: "production" },
      {},
      null,
    ];
    expect(normalize("issues", payload).labels).toEqual([
      "incident",
      "production",
    ]);
  });
});

describe("GitHub workflow event filters", () => {
  test("requires an explicit event and rejects unsupported events", () => {
    expect(() => {
      GitHubEventUtil.match(normalize(), {});
    }).toThrow("Select a GitHub event");
    expect(() => {
      GitHubEventUtil.match(normalize(), { event: "pullrequest" });
    }).toThrow("unsupported");
  });

  test.each(["*", "issue_comment", "issues, issue_comment"])(
    "matches event filter %s",
    (event: string) => {
      expect(GitHubEventUtil.match(normalize(), { event }).matches).toBe(true);
    },
  );

  test.each([
    { event: "issues" },
    { repository: "another/repo" },
    { actions: "edited, deleted" },
    { branch: "main" },
    { label: "other" },
    { sender: "another-user" },
    { commentType: "pull_request" },
  ])("rejects nonmatching filter %p", (filter: JSONObject) => {
    expect(
      GitHubEventUtil.match(normalize(), { event: "issue_comment", ...filter })
        .matches,
    ).toBe(false);
  });

  test.each(["ACME/Service", "connected-repository"])(
    "matches repository %s",
    (repository: string) => {
      expect(
        GitHubEventUtil.match(normalize(), { event: "*", repository }).matches,
      ).toBe(true);
    },
  );

  test("combines repository/action/label/sender/comment filters", () => {
    expect(
      GitHubEventUtil.match(normalize(), {
        event: "issue_comment",
        repository: "acme/service",
        actions: "created",
        label: "INCIDENT",
        sender: "other, OCTOCAT",
        commentType: "issue",
        commentCommand: "@oneuptime incident",
      }),
    ).toEqual({
      matches: true,
      commandArguments: "Database unavailable",
      requireWriteAccess: true,
    });
  });

  test("matches branch names exactly", () => {
    expect(
      GitHubEventUtil.match(normalize("push"), {
        event: "push",
        branch: "main",
      }).matches,
    ).toBe(true);
    expect(
      GitHubEventUtil.match(normalize("push"), {
        event: "push",
        branch: "Main",
      }).matches,
    ).toBe(false);
  });

  test.each(["labeled", "unlabeled"])(
    "matches changed label for %s instead of unrelated current labels",
    (action: string) => {
      const payload: JSONObject = {
        ...payloadFor("issues"),
        action,
        label: { name: "unrelated" },
      };
      expect(
        GitHubEventUtil.match(normalize("issues", payload), {
          event: "issues",
          label: "incident",
        }).matches,
      ).toBe(false);
      payload["label"] = { name: "INCIDENT" };
      (payload["issue"] as JSONObject)["labels"] = [];
      expect(
        GitHubEventUtil.match(normalize("issues", payload), {
          event: "issues",
          label: "incident",
        }).matches,
      ).toBe(true);
    },
  );

  test.each([
    "@oneuptime incidents",
    "@oneuptime incident-extra",
    "Please @oneuptime incident",
    "> @oneuptime incident",
    "```\n@oneuptime incident\n```",
    "@OneUptime incident",
  ])("does not execute command in %s", (comment: string) => {
    expect(
      GitHubEventUtil.match(
        { ...normalize(), comment },
        { event: "*", commentCommand: "@oneuptime incident" },
      ).matches,
    ).toBe(false);
  });

  test.each([
    ["@oneuptime incident", ""],
    [" \n@oneuptime incident\tproduction", "production"],
    [
      "@oneuptime incident\nDatabase 🚨\n unavailable  ",
      "Database 🚨\n unavailable",
    ],
  ])(
    "extracts command arguments from %s",
    (comment: string, expected: string) => {
      expect(
        GitHubEventUtil.match(
          { ...normalize(), comment },
          { event: "*", commentCommand: "@oneuptime incident" },
        ),
      ).toMatchObject({ matches: true, commandArguments: expected });
    },
  );

  test.each(["edited", "deleted"])(
    "ignores %s comment commands unless explicitly configured",
    (action: string) => {
      const envelope: GitHubEventEnvelope = { ...normalize(), action };
      expect(
        GitHubEventUtil.match(envelope, {
          event: "*",
          commentCommand: "@oneuptime incident",
        }).matches,
      ).toBe(false);
      expect(
        GitHubEventUtil.match(envelope, {
          event: "*",
          actions: action,
          commentCommand: "@oneuptime incident",
        }).matches,
      ).toBe(true);
    },
  );

  test("review commands default to submitted", () => {
    expect(
      GitHubEventUtil.match(normalize("pull_request_review"), {
        event: "*",
        commentCommand: "@oneuptime incident",
      }).matches,
    ).toBe(true);
  });

  test.each(["issues", "pull_request", "push"])(
    "does not treat %s bodies as comment commands",
    (event: string) => {
      expect(
        GitHubEventUtil.match(
          { ...normalize(event), comment: "@oneuptime incident" },
          { event: "*", commentCommand: "@oneuptime incident" },
        ).matches,
      ).toBe(false);
    },
  );

  test.each([undefined, "", true, "true"])(
    "ignores bots by default or with %p",
    (ignoreBots: unknown) => {
      expect(
        GitHubEventUtil.match(
          { ...normalize(), isBot: true },
          { event: "*", ignoreBots: ignoreBots as boolean },
        ).matches,
      ).toBe(false);
    },
  );

  test.each([false, "false"])(
    "permits an explicit bot opt-in %p",
    (ignoreBots: unknown) => {
      expect(
        GitHubEventUtil.match(
          { ...normalize(), isBot: true },
          { event: "*", ignoreBots: ignoreBots as boolean },
        ).matches,
      ).toBe(true);
    },
  );

  test.each([
    "issue_comment",
    "pull_request_review",
    "pull_request_review_comment",
  ])("requires write access for %s by default", (event: string) => {
    expect(
      GitHubEventUtil.match(normalize(event), { event: "*" })
        .requireWriteAccess,
    ).toBe(true);
    expect(
      GitHubEventUtil.match(normalize(event), {
        event: "*",
        requireWriteAccess: false,
      }).requireWriteAccess,
    ).toBe(false);
  });

  test("does not require commenter access for events with no comments", () => {
    expect(
      GitHubEventUtil.match(normalize("push"), { event: "push" })
        .requireWriteAccess,
    ).toBe(false);
  });

  test.each([
    "event",
    "repository",
    "actions",
    "branch",
    "label",
    "sender",
    "commentType",
    "commentCommand",
  ])("rejects malformed %s filters and unresolved templates", (key: string) => {
    expect(() => {
      GitHubEventUtil.match(normalize(), { event: "*", [key]: {} });
    }).toThrow("must be text");
    expect(() => {
      GitHubEventUtil.match(normalize(), {
        event: "*",
        [key]: "{{local.variables.missing}}",
      });
    }).toThrow("unresolved");
  });

  test.each(["ignoreBots", "requireWriteAccess"])(
    "rejects malformed %s instead of silently turning it off",
    (key: string) => {
      expect(() => {
        GitHubEventUtil.match(normalize(), { event: "*", [key]: "no" });
      }).toThrow("true or false");
    },
  );

  test("rejects invalid comment types", () => {
    expect(() => {
      GitHubEventUtil.match(normalize(), { event: "*", commentType: "pr" });
    }).toThrow("commentType");
  });
});
