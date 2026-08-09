import FixRunBudget, {
  DEFAULT_DAILY_FIX_RUN_LIMIT,
  FixRunBudgetDecision,
} from "../../../../Server/Utils/AI/CodeFix/FixRunBudget";
import ProjectService from "../../../../Server/Services/ProjectService";
import AIRunService from "../../../../Server/Services/AIRunService";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import Project from "../../../../Models/DatabaseModels/Project";
import AIRunType from "../../../../Types/AI/AIRunType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * The per-project daily fix-run budget (G11 guardrail): incident, alert and
 * subjectless CodeFix AIRuns each count only against their own lane. Unlike
 * the token budget, an UNSET limit is NOT unlimited — fix runs open pull
 * requests on customer repositories, so the default cap applies. 0 pauses
 * that lane entirely (the same kill-switch semantics as the token budget).
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
  test("paused incident rejection names the incident setting and destination", () => {
    const message: string = FixRunBudget.describeRejection(
      FixRunBudget.evaluate({ configuredLimit: 0, runsToday: 0 }),
      { incidentId: ObjectID.generate() },
    );

    expect(message).toMatch(/Daily Incident AI Fix Task Limit/);
    expect(message).toMatch(/Incidents > Settings > AI/);
    expect(message).toMatch(/0/);
  });

  test("over-budget alert rejection names the alert setting and destination", () => {
    const message: string = FixRunBudget.describeRejection(
      FixRunBudget.evaluate({ configuredLimit: 10, runsToday: 10 }),
      { alertId: ObjectID.generate() },
    );

    expect(message).toMatch(/10 of 10/);
    expect(message).toMatch(/Daily Alert AI Fix Task Limit/);
    expect(message).toMatch(/Alerts > AI > Investigation/);
    expect(message).toMatch(new RegExp(String(DEFAULT_DAILY_FIX_RUN_LIMIT)));
  });

  test("subjectless rejection points to the always-visible AI Guardrails page", () => {
    const message: string = FixRunBudget.describeRejection(
      FixRunBudget.evaluate({ configuredLimit: 0, runsToday: 0 }),
    );

    expect(message).toMatch(/Daily Other AI Fix Task Limit/);
    expect(message).toMatch(/Project Settings > AI > AI Guardrails/);
  });
});

describe("FixRunBudget.getBudgetStatus (IO wiring)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockSubjectOperators(): {
    isNull: Record<string, string>;
    notNull: Record<string, string>;
  } {
    const isNull: Record<string, string> = { operator: "is-null" };
    const notNull: Record<string, string> = { operator: "not-null" };

    jest.spyOn(QueryHelper, "isNull").mockReturnValue(isNull);
    jest.spyOn(QueryHelper, "notNull").mockReturnValue(notNull);

    return { isNull, notNull };
  }

  test("rejects a run carrying both subject types before reading project settings", async () => {
    const findProject: jest.SpyInstance = jest.spyOn(
      ProjectService,
      "findOneById",
    );

    await expect(
      FixRunBudget.getBudgetStatus(projectId, {
        incidentId: ObjectID.generate(),
        alertId: ObjectID.generate(),
      }),
    ).rejects.toThrow(/both an incident and an alert/);

    expect(findProject).not.toHaveBeenCalled();
  });

  test("subjectless callers retain the fallback limit and count only subjectless CodeFix runs", async () => {
    const operators: ReturnType<typeof mockSubjectOperators> =
      mockSubjectOperators();
    const findProject: jest.SpyInstance = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue({
        id: projectId,
        aiDailyFixTaskLimit: 10,
        incidentAiDailyFixTaskLimit: 1,
        alertAiDailyFixTaskLimit: 2,
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
    expect(findProject).toHaveBeenCalledWith(
      expect.objectContaining({ select: { aiDailyFixTaskLimit: true } }),
    );

    const query: Record<string, unknown> = (
      countBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(query["projectId"]).toBe(projectId);
    expect(query["runType"]).toBe(AIRunType.CodeFix);
    expect(query["triggeredByIncidentId"]).toBe(operators.isNull);
    expect(query["triggeredByAlertId"]).toBe(operators.isNull);
    // createdAt >= UTC midnight rides in a QueryHelper find operator.
    expect(query["createdAt"]).toBeDefined();
  });

  test("an explicitly empty subject from SubjectCodeFixRun also stays in the subjectless lane", async () => {
    const operators: ReturnType<typeof mockSubjectOperators> =
      mockSubjectOperators();
    const findProject: jest.SpyInstance = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue({
        id: projectId,
        aiDailyFixTaskLimit: 3,
        incidentAiDailyFixTaskLimit: 0,
        alertAiDailyFixTaskLimit: 0,
      } as unknown as Project);
    const countBy: jest.SpyInstance = jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(2));

    const decision: FixRunBudgetDecision = await FixRunBudget.getBudgetStatus(
      projectId,
      { incidentId: undefined, alertId: undefined },
    );

    expect(decision.limit).toBe(3);
    expect(decision.allowed).toBe(true);
    expect(findProject).toHaveBeenCalledWith(
      expect.objectContaining({ select: { aiDailyFixTaskLimit: true } }),
    );

    const query: Record<string, unknown> = (
      countBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(query["triggeredByIncidentId"]).toBe(operators.isNull);
    expect(query["triggeredByAlertId"]).toBe(operators.isNull);
  });

  test("incident callers select the incident limit and count only incident CodeFix runs", async () => {
    const operators: ReturnType<typeof mockSubjectOperators> =
      mockSubjectOperators();
    const findProject: jest.SpyInstance = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue({
        id: projectId,
        aiDailyFixTaskLimit: 99,
        incidentAiDailyFixTaskLimit: 5,
        alertAiDailyFixTaskLimit: 1,
      } as unknown as Project);
    const countBy: jest.SpyInstance = jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(4));

    const decision: FixRunBudgetDecision = await FixRunBudget.getBudgetStatus(
      projectId,
      { incidentId: ObjectID.generate() },
    );

    expect(decision).toEqual({
      allowed: true,
      limit: 5,
      paused: false,
      runsToday: 4,
    });
    expect(findProject).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { incidentAiDailyFixTaskLimit: true },
      }),
    );

    const query: Record<string, unknown> = (
      countBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(query["runType"]).toBe(AIRunType.CodeFix);
    expect(query["triggeredByIncidentId"]).toBe(operators.notNull);
    expect(query["triggeredByAlertId"]).toBe(operators.isNull);
  });

  test("alert callers select the alert limit and count only alert CodeFix runs", async () => {
    const operators: ReturnType<typeof mockSubjectOperators> =
      mockSubjectOperators();
    const findProject: jest.SpyInstance = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue({
        id: projectId,
        aiDailyFixTaskLimit: 99,
        incidentAiDailyFixTaskLimit: 1,
        alertAiDailyFixTaskLimit: 7,
      } as unknown as Project);
    const countBy: jest.SpyInstance = jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(6));

    const decision: FixRunBudgetDecision = await FixRunBudget.getBudgetStatus(
      projectId,
      { alertId: ObjectID.generate() },
    );

    expect(decision).toEqual({
      allowed: true,
      limit: 7,
      paused: false,
      runsToday: 6,
    });
    expect(findProject).toHaveBeenCalledWith(
      expect.objectContaining({ select: { alertAiDailyFixTaskLimit: true } }),
    );

    const query: Record<string, unknown> = (
      countBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(query["runType"]).toBe(AIRunType.CodeFix);
    expect(query["triggeredByIncidentId"]).toBe(operators.isNull);
    expect(query["triggeredByAlertId"]).toBe(operators.notNull);
  });

  test("pausing the incident lane short-circuits without counting another lane", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      aiDailyFixTaskLimit: 50,
      incidentAiDailyFixTaskLimit: 0,
      alertAiDailyFixTaskLimit: 50,
    } as unknown as Project);
    const countBy: jest.SpyInstance = jest.spyOn(AIRunService, "countBy");

    const decision: FixRunBudgetDecision = await FixRunBudget.getBudgetStatus(
      projectId,
      { incidentId: ObjectID.generate() },
    );

    expect(decision.allowed).toBe(false);
    expect(decision.paused).toBe(true);
    expect(countBy).not.toHaveBeenCalled();
  });

  test("pausing the alert lane short-circuits without counting another lane", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      aiDailyFixTaskLimit: 50,
      incidentAiDailyFixTaskLimit: 50,
      alertAiDailyFixTaskLimit: 0,
    } as unknown as Project);
    const countBy: jest.SpyInstance = jest.spyOn(AIRunService, "countBy");

    const decision: FixRunBudgetDecision = await FixRunBudget.getBudgetStatus(
      projectId,
      { alertId: ObjectID.generate() },
    );

    expect(decision.allowed).toBe(false);
    expect(decision.paused).toBe(true);
    expect(countBy).not.toHaveBeenCalled();
  });

  test("a missing project row uses the default cap in the requested lane (fail-safe, not fail-open)", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(null);
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(DEFAULT_DAILY_FIX_RUN_LIMIT));

    const decision: FixRunBudgetDecision = await FixRunBudget.getBudgetStatus(
      projectId,
      { alertId: ObjectID.generate() },
    );

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

  test("over budget throws a BadDataException naming the subjectless setting", async () => {
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
      /Daily Other AI Fix Task Limit/,
    );
  });
});
