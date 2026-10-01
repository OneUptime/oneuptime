import FixRunBudget, {
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
 * The per-project daily fix-run limit (G11 guardrail): incident and alert
 * CodeFix AIRuns each count only against their own lane. Like the token
 * budget, an UNSET limit is no limit — AI opens fix tasks as often as the
 * work calls for until a project sets a ceiling (it used to default to 25 a
 * day). 0 pauses that lane entirely. Fix tasks with neither subject have no
 * setting, so they have no limit at all.
 */

const projectId: ObjectID = ObjectID.generate();

describe("FixRunBudget.evaluate (pure decision)", () => {
  test.each([[null], [undefined]])(
    "an unset (%p) limit means no limit",
    (configuredLimit: null | undefined) => {
      const decision: FixRunBudgetDecision = FixRunBudget.evaluate({
        configuredLimit,
        runsToday: 0,
      });

      expect(decision).toEqual({
        allowed: true,
        limit: null,
        paused: false,
        runsToday: 0,
      });
    },
  );

  // The old default cap was 25 a day; it must not come back as a ceiling.
  test.each([[24], [25], [26], [1000]])(
    "an unset limit allows a fix task after %p today",
    (runsToday: number) => {
      const decision: FixRunBudgetDecision = FixRunBudget.evaluate({
        configuredLimit: null,
        runsToday,
      });

      expect(decision.allowed).toBe(true);
      expect(decision.limit).toBeNull();
      expect(decision.paused).toBe(false);
      expect(decision.runsToday).toBe(runsToday);
    },
  );

  test("a custom limit is enforced in both directions", () => {
    expect(
      FixRunBudget.evaluate({ configuredLimit: 2, runsToday: 1 }).allowed,
    ).toBe(true);
    expect(
      FixRunBudget.evaluate({ configuredLimit: 2, runsToday: 2 }).allowed,
    ).toBe(false);
    expect(
      FixRunBudget.evaluate({ configuredLimit: 100, runsToday: 99 }).allowed,
    ).toBe(true);
  });

  test("0 pauses fix tasks outright — even with zero runs today", () => {
    const decision: FixRunBudgetDecision = FixRunBudget.evaluate({
      configuredLimit: 0,
      runsToday: 0,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.paused).toBe(true);
    expect(decision.limit).toBe(0);
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
  test("paused incident rejection names the incident setting and where it lives", () => {
    const message: string = FixRunBudget.describeRejection(
      FixRunBudget.evaluate({ configuredLimit: 0, runsToday: 0 }),
      { incidentId: ObjectID.generate() },
    );

    expect(message).toMatch(/Daily Incident AI Fix Task Limit/);
    expect(message).toMatch(/Incidents > Settings > AI/);
    expect(message).toMatch(/0/);
  });

  test("over-limit alert rejection names the alert setting, where it lives, and that clearing it lifts the limit", () => {
    const message: string = FixRunBudget.describeRejection(
      FixRunBudget.evaluate({ configuredLimit: 10, runsToday: 10 }),
      { alertId: ObjectID.generate() },
    );

    expect(message).toMatch(/10 of 10/);
    expect(message).toMatch(/Daily Alert AI Fix Task Limit/);
    expect(message).toMatch(/Alerts > Settings > AI/);
    expect(message).toMatch(/clear it for no limit/);
  });

  /*
   * The AI section these used to point at is gone from the side menu, and
   * there is no default to quote any more.
   */
  test("no rejection points at the removed AI menu section or quotes a default", () => {
    const messages: Array<string> = [
      FixRunBudget.describeRejection(
        FixRunBudget.evaluate({ configuredLimit: 0, runsToday: 0 }),
        { incidentId: ObjectID.generate() },
      ),
      FixRunBudget.describeRejection(
        FixRunBudget.evaluate({ configuredLimit: 4, runsToday: 4 }),
        { alertId: ObjectID.generate() },
      ),
      FixRunBudget.describeRejection(
        FixRunBudget.evaluate({ configuredLimit: 4, runsToday: 4 }),
        { incidentId: ObjectID.generate() },
      ),
    ];

    for (const message of messages) {
      expect(message).not.toMatch(/AI > Investigation/);
      expect(message).not.toMatch(/default/i);
    }
  });

  test("a subjectless rejection names no setting", () => {
    const message: string = FixRunBudget.describeRejection(
      FixRunBudget.evaluate({ configuredLimit: 5, runsToday: 5 }),
    );

    expect(message).toMatch(/5 of 5/);
    expect(message).not.toMatch(/AI Guardrails/);
    expect(message).not.toMatch(/Daily Other AI Fix Task Limit/);
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

  /*
   * Subjectless fix tasks (exception, insight and performance recipes) have
   * no setting. They used to run on a fixed 25 a day nobody could raise;
   * now nothing limits them, so there is nothing to read or count.
   */
  test("subjectless callers have no limit: no project read, no count", async () => {
    const findProject: jest.SpyInstance = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue({
        id: projectId,
        aiDailyFixTaskLimit: 1,
        incidentAiDailyFixTaskLimit: 1,
        alertAiDailyFixTaskLimit: 1,
      } as unknown as Project);
    const countBy: jest.SpyInstance = jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(1000));

    const decision: FixRunBudgetDecision =
      await FixRunBudget.getBudgetStatus(projectId);

    expect(decision).toEqual({
      allowed: true,
      limit: null,
      paused: false,
      runsToday: 0,
    });
    expect(findProject).not.toHaveBeenCalled();
    expect(countBy).not.toHaveBeenCalled();
  });

  test("an explicitly empty subject from SubjectCodeFixRun also stays in the subjectless lane", async () => {
    const findProject: jest.SpyInstance = jest.spyOn(
      ProjectService,
      "findOneById",
    );
    const countBy: jest.SpyInstance = jest.spyOn(AIRunService, "countBy");

    const decision: FixRunBudgetDecision = await FixRunBudget.getBudgetStatus(
      projectId,
      { incidentId: undefined, alertId: undefined },
    );

    expect(decision.allowed).toBe(true);
    expect(decision.limit).toBeNull();
    expect(findProject).not.toHaveBeenCalled();
    expect(countBy).not.toHaveBeenCalled();
  });

  test.each([
    ["incident", { incidentId: ObjectID.generate() }],
    ["alert", { alertId: ObjectID.generate() }],
  ])(
    "an %s lane with no limit set is allowed without counting today's fix tasks",
    async (
      _lane: string,
      subject: { incidentId?: ObjectID; alertId?: ObjectID },
    ) => {
      const findProject: jest.SpyInstance = jest
        .spyOn(ProjectService, "findOneById")
        .mockResolvedValue({ id: projectId } as unknown as Project);
      const countBy: jest.SpyInstance = jest
        .spyOn(AIRunService, "countBy")
        .mockResolvedValue(new PositiveNumber(500));

      const decision: FixRunBudgetDecision = await FixRunBudget.getBudgetStatus(
        projectId,
        subject,
      );

      expect(decision).toEqual({
        allowed: true,
        limit: null,
        paused: false,
        runsToday: 0,
      });
      expect(findProject).toHaveBeenCalledTimes(1);
      expect(countBy).not.toHaveBeenCalled();
    },
  );

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
    expect(query["projectId"]).toBe(projectId);
    expect(query["runType"]).toBe(AIRunType.CodeFix);
    expect(query["triggeredByIncidentId"]).toBe(operators.notNull);
    expect(query["triggeredByAlertId"]).toBe(operators.isNull);
    // createdAt >= UTC midnight rides in a QueryHelper find operator.
    expect(query["createdAt"]).toBeDefined();
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

  test("a configured limit that today's fix tasks reached is refused", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      alertAiDailyFixTaskLimit: 3,
    } as unknown as Project);
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(3));

    const decision: FixRunBudgetDecision = await FixRunBudget.getBudgetStatus(
      projectId,
      { alertId: ObjectID.generate() },
    );

    expect(decision).toEqual({
      allowed: false,
      limit: 3,
      paused: false,
      runsToday: 3,
    });
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

  test("a missing project row reads as no limit set in the requested lane", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(null);
    const countBy: jest.SpyInstance = jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(25));

    const decision: FixRunBudgetDecision = await FixRunBudget.getBudgetStatus(
      projectId,
      { alertId: ObjectID.generate() },
    );

    expect(decision.limit).toBeNull();
    expect(decision.allowed).toBe(true);
    expect(countBy).not.toHaveBeenCalled();
  });
});

describe("FixRunBudget.assertWithinBudget", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a subjectless fix task is never refused, however many ran today", async () => {
    const countBy: jest.SpyInstance = jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(1000));

    await expect(
      FixRunBudget.assertWithinBudget(projectId),
    ).resolves.toBeUndefined();
    expect(countBy).not.toHaveBeenCalled();
  });

  test("an incident fix task in a lane with no limit set is never refused", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue({ id: projectId } as unknown as Project);
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(1000));

    await expect(
      FixRunBudget.assertWithinBudget(projectId, {
        incidentId: ObjectID.generate(),
      }),
    ).resolves.toBeUndefined();
  });

  test("under a configured limit resolves silently", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      incidentAiDailyFixTaskLimit: 5,
    } as unknown as Project);
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));

    await expect(
      FixRunBudget.assertWithinBudget(projectId, {
        incidentId: ObjectID.generate(),
      }),
    ).resolves.toBeUndefined();
  });

  test("over a configured limit throws a BadDataException naming the setting", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      incidentAiDailyFixTaskLimit: 2,
    } as unknown as Project);
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(2));

    const assertion: Promise<void> = FixRunBudget.assertWithinBudget(
      projectId,
      { incidentId: ObjectID.generate() },
    );

    await expect(assertion).rejects.toThrow(BadDataException);
    await expect(assertion).rejects.toThrow(/Daily Incident AI Fix Task Limit/);
  });
});
