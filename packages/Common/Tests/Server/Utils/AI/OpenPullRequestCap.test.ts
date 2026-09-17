import OpenPullRequestCap, {
  DEFAULT_MAX_OPEN_FIX_PULL_REQUESTS,
  OpenPullRequestCapDecision,
} from "../../../../Server/Utils/AI/CodeFix/OpenPullRequestCap";
import AIAgentTaskPullRequestService from "../../../../Server/Services/AIAgentTaskPullRequestService";
import PullRequestState from "../../../../Types/CodeRepository/PullRequestState";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * The per-repository open-PR cap (G11 guardrail), enforced at the
 * repository-token gate: a repo already carrying its cap's worth of OPEN
 * AI fix pull requests refuses the token — no token, no push, no PR. The
 * open counts come from AIAgentTaskPullRequest rows kept current by the
 * SyncPullRequestStates worker, so merging/closing a PR frees a slot.
 */

const codeRepositoryId: ObjectID = ObjectID.generate();

describe("OpenPullRequestCap.evaluate (pure decision)", () => {
  test("unset cap uses the default — under it is allowed", () => {
    const decision: OpenPullRequestCapDecision = OpenPullRequestCap.evaluate({
      configuredLimit: null,
      openCount: DEFAULT_MAX_OPEN_FIX_PULL_REQUESTS - 1,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.limit).toBe(DEFAULT_MAX_OPEN_FIX_PULL_REQUESTS);
    expect(decision.paused).toBe(false);
  });

  test("AT the cap is rejected — the cap is a maximum of open PRs, not a trigger", () => {
    expect(
      OpenPullRequestCap.evaluate({
        configuredLimit: undefined,
        openCount: DEFAULT_MAX_OPEN_FIX_PULL_REQUESTS,
      }).allowed,
    ).toBe(false);
  });

  test("a custom cap overrides the default in both directions", () => {
    expect(
      OpenPullRequestCap.evaluate({ configuredLimit: 1, openCount: 0 }).allowed,
    ).toBe(true);
    expect(
      OpenPullRequestCap.evaluate({ configuredLimit: 1, openCount: 1 }).allowed,
    ).toBe(false);
    expect(
      OpenPullRequestCap.evaluate({
        configuredLimit: 20,
        openCount: DEFAULT_MAX_OPEN_FIX_PULL_REQUESTS,
      }).allowed,
    ).toBe(true);
  });

  test("0 blocks AI fix PRs for the repository outright", () => {
    const decision: OpenPullRequestCapDecision = OpenPullRequestCap.evaluate({
      configuredLimit: 0,
      openCount: 0,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.paused).toBe(true);
  });

  test("a negative cap reads as blocked, never as unlimited", () => {
    expect(
      OpenPullRequestCap.evaluate({ configuredLimit: -1, openCount: 0 })
        .allowed,
    ).toBe(false);
  });
});

describe("OpenPullRequestCap.checkForRepository (IO wiring)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("counts only OPEN pull requests for the repository", async () => {
    const countBy: jest.SpyInstance = jest
      .spyOn(AIAgentTaskPullRequestService, "countBy")
      .mockResolvedValue(new PositiveNumber(2));

    const decision: OpenPullRequestCapDecision =
      await OpenPullRequestCap.checkForRepository({
        codeRepositoryId,
        configuredLimit: 3,
      });

    expect(decision).toEqual({
      allowed: true,
      limit: 3,
      paused: false,
      openCount: 2,
    });

    expect(countBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          codeRepositoryId,
          pullRequestState: PullRequestState.Open,
        }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
  });

  test("at the cap rejects", async () => {
    jest
      .spyOn(AIAgentTaskPullRequestService, "countBy")
      .mockResolvedValue(new PositiveNumber(3));

    const decision: OpenPullRequestCapDecision =
      await OpenPullRequestCap.checkForRepository({
        codeRepositoryId,
        configuredLimit: 3,
      });

    expect(decision.allowed).toBe(false);
  });

  test("a blocked repository (cap 0) short-circuits without the count query", async () => {
    const countBy: jest.SpyInstance = jest.spyOn(
      AIAgentTaskPullRequestService,
      "countBy",
    );

    const decision: OpenPullRequestCapDecision =
      await OpenPullRequestCap.checkForRepository({
        codeRepositoryId,
        configuredLimit: 0,
      });

    expect(decision.allowed).toBe(false);
    expect(decision.paused).toBe(true);
    expect(countBy).not.toHaveBeenCalled();
  });
});

describe("OpenPullRequestCap.describeRejection", () => {
  test("blocked rejection names the repository and the setting", () => {
    const message: string = OpenPullRequestCap.describeRejection({
      decision: OpenPullRequestCap.evaluate({
        configuredLimit: 0,
        openCount: 0,
      }),
      repositoryName: "acme/backend",
    });

    expect(message).toMatch(/acme\/backend/);
    expect(message).toMatch(/Max Open Fix Pull Requests/);
  });

  test("at-cap rejection names the counts, the setting and the default", () => {
    const message: string = OpenPullRequestCap.describeRejection({
      decision: OpenPullRequestCap.evaluate({
        configuredLimit: 5,
        openCount: 5,
      }),
      repositoryName: "acme/backend",
    });

    expect(message).toMatch(/5 open of a maximum 5/);
    expect(message).toMatch(/Max Open Fix Pull Requests/);
    expect(message).toMatch(
      new RegExp(String(DEFAULT_MAX_OPEN_FIX_PULL_REQUESTS)),
    );
  });
});
