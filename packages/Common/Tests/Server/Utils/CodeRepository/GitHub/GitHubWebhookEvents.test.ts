import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../../../Types/JSON";
import GitHubWebhookEvents, {
  DEFAULT_GITHUB_TRIGGER_LABEL,
  GitHubWebhookEvent,
  GitHubWebhookRepository,
  GitHubWebhookSender,
} from "../../../../../Server/Utils/CodeRepository/GitHub/GitHubWebhookEvents";

/*
 * These readers are the boundary where a raw, attacker-influenced webhook
 * body becomes typed values the interactive GitHub app acts on - it opens
 * pull requests against whatever repository they name - so what matters is
 * as much what they REFUSE as what they extract. Every case below is a
 * payload shape GitHub can send or an attacker can forge, not a synthetic
 * type exercise.
 */

describe("GitHubWebhookEvents.getRepository", () => {
  test("splits owner/repo on the first slash", () => {
    const repository: GitHubWebhookRepository | null =
      GitHubWebhookEvents.getRepository({
        repository: { full_name: "OneUptime/oneuptime" },
      });

    expect(repository).toEqual({
      organizationName: "OneUptime",
      repositoryName: "oneuptime",
    });
  });

  /*
   * Neither half of a real full_name can contain a slash, so a name that
   * does is either a different shape than we think or an attempt to make
   * the repository read as one path and resolve as another. Splitting on
   * the first slash keeps everything after it in the repository name,
   * where it cannot become an extra path segment on its own.
   */
  test("keeps every later slash inside the repository name", () => {
    expect(
      GitHubWebhookEvents.getRepository({
        repository: { full_name: "owner/repo/../../other" },
      }),
    ).toEqual({
      organizationName: "owner",
      repositoryName: "repo/../../other",
    });
  });

  test.each([
    ["no repository key at all", {}],
    ["a repository that is not an object", { repository: "OneUptime/x" }],
    ["no full_name", { repository: { id: 1 } }],
    ["an empty full_name", { repository: { full_name: "" } }],
    ["no slash", { repository: { full_name: "oneuptime" } }],
    ["a leading slash, so no owner", { repository: { full_name: "/repo" } }],
    [
      "a trailing slash, so no repository",
      { repository: { full_name: "owner/" } },
    ],
    ["only a slash", { repository: { full_name: "/" } }],
  ])("returns null for %s", (_name: string, payload: JSONObject) => {
    expect(GitHubWebhookEvents.getRepository(payload)).toBeNull();
  });
});

describe("GitHubWebhookEvents.getInstallationId", () => {
  test("stringifies the numeric id GitHub actually sends", () => {
    expect(
      GitHubWebhookEvents.getInstallationId({ installation: { id: 12345678 } }),
    ).toBe("12345678");
  });

  /*
   * The installation id is what binds a webhook to a customer's stored
   * credentials, so "0" must not be read as "absent" and then fall through
   * to whatever the caller does without one.
   */
  test("keeps a zero id rather than reading it as missing", () => {
    expect(
      GitHubWebhookEvents.getInstallationId({ installation: { id: 0 } }),
    ).toBe("0");
  });

  test.each([
    ["no installation", {}],
    ["an installation without an id", { installation: { account: {} } }],
    ["an empty string id", { installation: { id: "" } }],
  ])("returns null for %s", (_name: string, payload: JSONObject) => {
    expect(GitHubWebhookEvents.getInstallationId(payload)).toBeNull();
  });
});

describe("GitHubWebhookEvents.getSender", () => {
  test("reads the login and the account type", () => {
    const sender: GitHubWebhookSender | null = GitHubWebhookEvents.getSender({
      sender: { login: "octocat", type: "User" },
    });

    expect(sender).toEqual({ login: "octocat", type: "User" });
  });

  /*
   * The app's own comments come back as webhooks, and the only thing
   * separating "a person asked for something" from "we are reacting to
   * ourselves" is this type being "Bot". It must survive a payload that
   * omits it as undefined rather than becoming some other string.
   */
  test("leaves the type undefined when GitHub omits it", () => {
    expect(
      GitHubWebhookEvents.getSender({ sender: { login: "octocat" } }),
    ).toEqual({ login: "octocat", type: undefined });
  });

  test("reports a Bot sender as a Bot", () => {
    expect(
      GitHubWebhookEvents.getSender({
        sender: { login: "oneuptime[bot]", type: "Bot" },
      })?.type,
    ).toBe("Bot");
  });

  test.each([
    ["no sender", {}],
    ["a sender with no login", { sender: { type: "User" } }],
    ["an empty login", { sender: { login: "", type: "User" } }],
  ])("returns null for %s", (_name: string, payload: JSONObject) => {
    expect(GitHubWebhookEvents.getSender(payload)).toBeNull();
  });
});

describe("GitHubWebhookEvents.getAction", () => {
  test("returns the action", () => {
    expect(GitHubWebhookEvents.getAction({ action: "opened" })).toBe("opened");
  });

  test.each([
    ["no action", {}],
    ["an empty action", { action: "" }],
  ])("returns null for %s", (_name: string, payload: JSONObject) => {
    expect(GitHubWebhookEvents.getAction(payload)).toBeNull();
  });
});

describe("GitHubWebhookEvents.isPullRequestIssue", () => {
  /*
   * issue_comment fires for both issues and pull requests and the payloads
   * are otherwise identical. Reading this wrong means trying to implement
   * an issue, or to revise a pull request that does not exist.
   */
  test("is true when the issue carries a pull_request link", () => {
    expect(
      GitHubWebhookEvents.isPullRequestIssue({
        number: 7,
        pull_request: { url: "https://api.github.com/repos/o/r/pulls/7" },
      }),
    ).toBe(true);
  });

  test.each([
    ["a plain issue", { number: 7 }],
    ["an explicitly null pull_request", { number: 7, pull_request: null }],
    ["undefined", undefined],
  ])("is false for %s", (_name: string, issue: JSONObject | undefined) => {
    expect(GitHubWebhookEvents.isPullRequestIssue(issue)).toBe(false);
  });
});

describe("GitHubWebhookEvents.getNumber", () => {
  test("returns the issue or pull request number", () => {
    expect(GitHubWebhookEvents.getNumber({ number: 3743 })).toBe(3743);
  });

  test("returns zero rather than null when the number is zero", () => {
    expect(GitHubWebhookEvents.getNumber({ number: 0 })).toBe(0);
  });

  /*
   * A number that arrives as a string is not coerced: everything
   * downstream builds API paths out of it, and "3743 OR 1=1" is a string
   * too. An unrecognised shape has to read as absent.
   */
  test.each([
    ["a stringified number", { number: "3743" }],
    ["no number", {}],
    ["undefined", undefined],
  ])(
    "returns null for %s",
    (_name: string, container: JSONObject | undefined) => {
      expect(GitHubWebhookEvents.getNumber(container)).toBeNull();
    },
  );
});

describe("GitHubWebhookEvents.getLabelNames", () => {
  test("returns every label name in order", () => {
    expect(
      GitHubWebhookEvents.getLabelNames({
        labels: [{ name: "bug" }, { name: "oneuptime" }],
      }),
    ).toEqual(["bug", "oneuptime"]);
  });

  test("drops entries with no usable name instead of emitting blanks", () => {
    expect(
      GitHubWebhookEvents.getLabelNames({
        labels: [{ name: "bug" }, { color: "ff0000" }, { name: "" }],
      }),
    ).toEqual(["bug"]);
  });

  test.each([
    ["an issue with no labels key", {}],
    ["an empty label array", { labels: [] }],
    ["undefined", undefined],
  ])(
    "returns an empty array for %s",
    (_name: string, issue: JSONObject | undefined) => {
      expect(GitHubWebhookEvents.getLabelNames(issue)).toEqual([]);
    },
  );
});

describe("GitHubWebhookEvents.hasLabel", () => {
  /*
   * GitHub labels are case-preserving but case-insensitively unique, so
   * "OneUptime" and "oneuptime" are the same label. An exact match would
   * silently ignore half the ways a customer can type the trigger.
   */
  test.each(["oneuptime", "OneUptime", "ONEUPTIME", "  OneUptime  "])(
    "matches %j against a differently-cased label",
    (labelName: string) => {
      expect(
        GitHubWebhookEvents.hasLabel({
          labelNames: ["Bug", "OnEuPtImE"],
          labelName: labelName,
        }),
      ).toBe(true);
    },
  );

  test("ignores surrounding whitespace on the label itself too", () => {
    expect(
      GitHubWebhookEvents.hasLabel({
        labelNames: [" oneuptime "],
        labelName: "oneuptime",
      }),
    ).toBe(true);
  });

  test("does not match a label that merely contains the wanted name", () => {
    expect(
      GitHubWebhookEvents.hasLabel({
        labelNames: ["oneuptime-triage"],
        labelName: "oneuptime",
      }),
    ).toBe(false);
  });

  /*
   * A blank configured label would otherwise match every empty-ish string
   * and hand the app every issue in the repository.
   */
  test.each(["", "   "])(
    "never matches when the wanted label is %j",
    (labelName: string) => {
      expect(
        GitHubWebhookEvents.hasLabel({
          labelNames: ["", "   ", "oneuptime"],
          labelName: labelName,
        }),
      ).toBe(false);
    },
  );

  test("is false when nothing is labelled", () => {
    expect(
      GitHubWebhookEvents.hasLabel({ labelNames: [], labelName: "oneuptime" }),
    ).toBe(false);
  });
});

describe("GitHubWebhookEvents contract", () => {
  /*
   * These strings are the values GitHub puts in the X-GitHub-Event header
   * and the default label customers are told to add. They are a wire
   * contract with GitHub and with existing repositories: renaming one
   * stops the app responding, with no error anywhere.
   */
  test("subscribes to the documented event names", () => {
    expect(
      Object.values(GitHubWebhookEvent).sort((a: string, b: string): number => {
        return a.localeCompare(b);
      }),
    ).toEqual([
      "installation",
      "installation_repositories",
      "issue_comment",
      "issues",
      "pull_request",
      "pull_request_review",
      "pull_request_review_comment",
    ]);
  });

  test("keeps the default trigger label lowercase", () => {
    expect(DEFAULT_GITHUB_TRIGGER_LABEL).toBe("oneuptime");
  });

  test("the default trigger label matches itself however it is cased", () => {
    expect(
      GitHubWebhookEvents.hasLabel({
        labelNames: ["OneUptime"],
        labelName: DEFAULT_GITHUB_TRIGGER_LABEL,
      }),
    ).toBe(true);
  });
});
