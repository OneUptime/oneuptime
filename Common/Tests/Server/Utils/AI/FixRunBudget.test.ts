import FixRunBudget, {
  DEFAULT_DAILY_FIX_RUN_LIMIT,
  FixRunBudgetDecision,
} from "../../../../Server/Utils/AI/CodeFix/FixRunBudget";
import ProjectService from "../../../../Server/Services/ProjectService";
import AIRunService from "../../../../Server/Services/AIRunService";
import Project from "../../../../Models/DatabaseModels/Project";
import AIRunType from "../../../../Types/AI/AIRunType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * The per-project daily fix-run budget (G11 guardrail): every CodeFix
 * AIRun counts against Project.aiDailyFixTaskLimit per UTC day. Unlike the
 * token budget, an UNSET limit is NOT unlimited — fix runs open pull
 * requests on customer repositories, so the default cap applies. 0 pauses
 * fix tasks entirely (the same kill-switch semantics as the token budget).
 */

const projectId: ObjectID = ObjectID.generate();

describe("FixRunBudget.evaluate (pure decision)", () => {
  test("unset limit uses the default cap — under it is allowed", () => {
    const decision: FixRunBudgetDecision = FixRunBudget.evaluate({
      configuredLimit: null,
      runsToday: DEFAULT_DAILY_FIX_RUN_LIMIT - 1,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.limit).toBe(DEFAULT_DAILY_FIX_RUN_LIMIT);
    expect(decision.paused).toBe(false);
  });

  test("unset limit is NOT unlimited: at the default cap is rejected", () => {
    const decision: FixRunBudgetDecision = FixRunBudget.evaluate({
      configuredLimit: undefined,
      runsToday: DEFAULT_DAILY_FIX_RUN_LIMIT,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.paused).toBe(false);
  });

  test("a custom limit overrides the default in both directions", () => {
    expect(
      FixRunBudget.evaluate({ configuredLimit: 2, runsToday: 1 }).allowed,
    ).toBe(true);
    expect(
      FixRunBudget.evaluate({ configuredLimit: 2, runsToday: 2 }).allowed,
    ).toBe(false);
    // A limit above the default allows more than the default would.
    expect(
      FixRunBudget.evaluate({
        configuredLimit: 100,
        runsToday: DEFAULT_DAILY_FIX_RUN_LIMIT,
      }).allowed,
    ).toBe(true);
  });

  test("0 pauses fix tasks outright — even with zero runs today", () => {
    const decision: FixRunBudgetDecision = FixRunBudget.evaluate({
      configuredLimit: 0,
      runsToday: 0,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.paused).toBe(true);
  });

  test("a negative limit reads as paused, never as unlimited", () => {
    const decision: FixRunBudgetDecision = FixRunBudget.evaluate({
      configuredLimit: -5,
      runsToday: 0,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.paused).toBe(true);
  });

  test("over the limit is rejected and reports the counts", () => {
    const decision: FixRunBudgetDecision = FixRunBudget.evaluate({
      configuredLimit: 3,
      runsToday: 7,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.runsToday).toBe(7);
    expect(decision.limit).toBe(3);
  });
});

describe("FixRunBudget.describeRejection", () => {
  test("paused rejection names the setting and the 0 value", () => {
    const message: string = FixRunBudget.describeRejection(
      FixRunBudget.evaluate({ configuredLimit: 0, runsToday: 0 }),
    );

    expect(message).toMatch(/Daily AI Fix Task Limit/);
    expect(message).toMatch(/0/);
  });

  test("over-budget rejection names the counts, the setting and the default", () => {
    const message: string = FixRunBudget.describeRejection(
      FixRunBudget.evaluate({ configuredLimit: 10, runsToday: 10 }),
    );

    expect(message).toMatch(/10 of 10/);
    expect(message).toMatch(/Daily AI Fix Task Limit/);
    expect(message).toMatch(new RegExp(String(DEFAULT_DAILY_FIX_RUN_LIMIT)));
  });
});

describe("FixRunBudget.getBudgetStatus (IO wiring)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("counts the project's CodeFix runs created since UTC midnight", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      aiDailyFixTaskLimit: 10,
    } as unknown as Project);

    const countBy: jest.SpyInstance = jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(4));

    const decision: FixRunBudgetDecision =
      await FixRunBudget.getBudgetStatus(projectId);

    expect(decision).toEqual({
      allowed: true,
      limit: 10,
      paused: false,
      runsToday: 4,
    });

    expect(countBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          projectId,
          runType: AIRunType.CodeFix,
          // createdAt >= UTC midnight rides in a QueryHelper find operator.
          createdAt: expect.anything(),
        }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
  });

  test("a paused project (limit 0) short-circuits without the count query", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      aiDailyFixTaskLimit: 0,
    } as unknown as Project);

    const countBy: jest.SpyInstance = jest.spyOn(AIRunService, "countBy");

    const decision: FixRunBudgetDecision =
      await FixRunBudget.getBudgetStatus(projectId);

    expect(decision.allowed).toBe(false);
    expect(decision.paused).toBe(true);
    expect(countBy).not.toHaveBeenCalled();
  });

  test("a missing project row falls back to the default cap (fail-safe, not fail-open)", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(null);
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(DEFAULT_DAILY_FIX_RUN_LIMIT));

    const decision: FixRunBudgetDecision =
      await FixRunBudget.getBudgetStatus(projectId);

    expect(decision.limit).toBe(DEFAULT_DAILY_FIX_RUN_LIMIT);
    expect(decision.allowed).toBe(false);
  });
});

describe("FixRunBudget.assertWithinBudget", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("under budget resolves silently", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      aiDailyFixTaskLimit: 5,
    } as unknown as Project);
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));

    await expect(
      FixRunBudget.assertWithinBudget(projectId),
    ).resolves.toBeUndefined();
  });

  test("over budget throws a BadDataException naming the setting", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      aiDailyFixTaskLimit: 5,
    } as unknown as Project);
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(5));

    await expect(FixRunBudget.assertWithinBudget(projectId)).rejects.toThrow(
      BadDataException,
    );
    await expect(FixRunBudget.assertWithinBudget(projectId)).rejects.toThrow(
      /Daily AI Fix Task Limit/,
    );
  });
});
