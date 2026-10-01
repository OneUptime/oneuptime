import OpenPullRequestCap, {
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
 *
 * The cap is opt-in: a repository with no cap set has no limit on open AI
 * fix pull requests (it used to default to 5).
 */

const codeRepositoryId: ObjectID = ObjectID.generate();

describe("OpenPullRequestCap.evaluate (pure decision)", () => {
  test.each([[null], [undefined]])(
    "an unset (%p) cap means no cap",
    (configuredLimit: null | undefined) => {
      expect(
        OpenPullRequestCap.evaluate({ configuredLimit, openCount: 0 }),
      ).toEqual({
        allowed: true,
        limit: null,
        paused: false,
        openCount: 0,
      });
    },
  );

  // The old default cap was 5 open AI pull requests per repository.
  test.each([[4], [5], [6], [200]])(
    "an unset cap allows another AI fix PR with %p already open",
    (openCount: number) => {
      const decision: OpenPullRequestCapDecision = OpenPullRequestCap.evaluate({
        configuredLimit: null,
        openCount,
      });

      expect(decision.allowed).toBe(true);
      expect(decision.limit).toBeNull();
      expect(decision.paused).toBe(false);
    },
  );

  test("AT a set cap is rejected — the cap is a maximum of open PRs, not a trigger", () => {
    expect(
      OpenPullRequestCap.evaluate({
        configuredLimit: 5,
        openCount: 5,
      }).allowed,
    ).toBe(false);
  });

  test("a custom cap is enforced in both directions", () => {
    expect(
      OpenPullRequestCap.evaluate({ configuredLimit: 1, openCount: 0 }).allowed,
    ).toBe(true);
    expect(
      OpenPullRequestCap.evaluate({ configuredLimit: 1, openCount: 1 }).allowed,
    ).toBe(false);
    expect(
      OpenPullRequestCap.evaluate({ configuredLimit: 20, openCount: 19 })
        .allowed,
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

  test("a repository with no cap set short-circuits without the count query", async () => {
    const countBy: jest.SpyInstance = jest
      .spyOn(AIAgentTaskPullRequestService, "countBy")
      .mockResolvedValue(new PositiveNumber(50));

    for (const configuredLimit of [null, undefined]) {
      const decision: OpenPullRequestCapDecision =
        await OpenPullRequestCap.checkForRepository({
          codeRepositoryId,
          configuredLimit,
        });

      expect(decision).toEqual({
        allowed: true,
        limit: null,
        paused: false,
        openCount: 0,
      });
    }

    expect(countBy).not.toHaveBeenCalled();
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

  test("at-cap rejection names the counts, the setting and that clearing it lifts the cap", () => {
    const message: string = OpenPullRequestCap.describeRejection({
      decision: OpenPullRequestCap.evaluate({
        configuredLimit: 5,
        openCount: 5,
      }),
      repositoryName: "acme/backend",
    });

    expect(message).toMatch(/5 open of a maximum 5/);
    expect(message).toMatch(/Max Open Fix Pull Requests/);
    expect(message).toMatch(/clear it for no cap/);
    expect(message).not.toMatch(/default/i);
  });
});
