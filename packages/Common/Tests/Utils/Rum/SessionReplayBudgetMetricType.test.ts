import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import SessionReplayBudgetMetricType from "../../../Types/Rum/SessionReplayBudgetMetricType";
import SessionReplayBudgetMetricTypeUtil, {
  SESSION_REPLAY_BUDGET_METRIC_INTERVAL_MINUTES,
  SESSION_REPLAY_BUDGET_METRIC_PROJECT_ID_ATTRIBUTE,
  SESSION_REPLAY_BUDGET_METRIC_RUM_APPLICATION_ID_ATTRIBUTE,
  SESSION_REPLAY_BUDGET_METRIC_RUM_APPLICATION_NAME_ATTRIBUTE,
  SESSION_REPLAY_METRIC_NAME_PREFIX,
} from "../../../Utils/Rum/SessionReplayBudgetMetricType";
import MetricUnitUtil from "../../../Utils/MetricUnitUtil";
import { MutableMetricService } from "../../../Server/Services/MutableMetricService";
import { describe, expect, test } from "@jest/globals";

/*
 * SessionReplayBudgetMetricTypeUtil is the one table every side of the
 * session replay budget metrics reads: the sweep registers each name's unit
 * and description from it, the alert templates read the names, billing
 * excludes by getAll(), and OTLP ingest refuses isReservedMetricName(). Two
 * kinds of test, as in SloMetricType.test.ts:
 *
 *   - Targeted: the exact name / unit / aggregation per member, because a
 *     stored row, a monitor threshold or a chart depends on each.
 *   - Invariant: every lookup resolves for EVERY enum member. The switches
 *     throw on an unknown value, so a member added to the enum and forgotten
 *     in one switch fails here instead of inside the worker.
 */

const ALL_BUDGET_METRIC_TYPES: Array<SessionReplayBudgetMetricType> =
  Object.values(SessionReplayBudgetMetricType);

// A value outside the enum, to drive the throwing default branches.
const UNKNOWN_METRIC_TYPE: SessionReplayBudgetMetricType =
  "oneuptime.rum.session.replay.budget.not.a.metric" as SessionReplayBudgetMetricType;

describe("SessionReplayBudgetMetricType names", () => {
  /*
   * The names are an append-only contract: every point already stored and
   * every monitor already watching one is keyed on the exact string.
   */
  test("are exactly the four published names", () => {
    expect(SessionReplayBudgetMetricType.ProjectDailyUsedBytes).toBe(
      "oneuptime.rum.session.replay.budget.project.daily.used.bytes",
    );
    expect(SessionReplayBudgetMetricType.ProjectDailyUsedPercent).toBe(
      "oneuptime.rum.session.replay.budget.project.daily.used.percent",
    );
    expect(SessionReplayBudgetMetricType.ApplicationMonthlyUsedBytes).toBe(
      "oneuptime.rum.session.replay.budget.application.monthly.used.bytes",
    );
    expect(SessionReplayBudgetMetricType.ApplicationMonthlyUsedPercent).toBe(
      "oneuptime.rum.session.replay.budget.application.monthly.used.percent",
    );
    expect(ALL_BUDGET_METRIC_TYPES).toHaveLength(4);
  });

  test.each(ALL_BUDGET_METRIC_TYPES)(
    "%s lives under the reserved prefix, in lower case, within the catalog's name length",
    (metricType: SessionReplayBudgetMetricType) => {
      expect(metricType.startsWith(SESSION_REPLAY_METRIC_NAME_PREFIX)).toBe(
        true,
      );
      // OTLP ingest lowercases names; a mixed-case name could never match one.
      expect(metricType).toBe(metricType.toLowerCase());
      expect(metricType).not.toMatch(/\s/);
      // MetricType.name is a ShortText column (100 characters).
      expect(metricType.length).toBeLessThanOrEqual(100);
      // "budget" is how the product names this, and the picker searches names.
      expect(metricType).toContain(".budget.");
    },
  );

  test.each(ALL_BUDGET_METRIC_TYPES)(
    "%s is read from the immutable metric table, where the sweep writes it",
    (metricType: SessionReplayBudgetMetricType) => {
      expect(MutableMetricService.isMutableMetricName(metricType)).toBe(false);
    },
  );
});

describe("SessionReplayBudgetMetricTypeUtil.getAll", () => {
  test("lists every member exactly once - the sweep and billing only see what is listed", () => {
    const all: Array<SessionReplayBudgetMetricType> =
      SessionReplayBudgetMetricTypeUtil.getAll();

    expect([...all].sort()).toEqual([...ALL_BUDGET_METRIC_TYPES].sort());
    expect(new Set(all).size).toBe(all.length);
  });

  test("lists the project series first", () => {
    expect(SessionReplayBudgetMetricTypeUtil.getAll()).toEqual([
      SessionReplayBudgetMetricType.ProjectDailyUsedBytes,
      SessionReplayBudgetMetricType.ProjectDailyUsedPercent,
      SessionReplayBudgetMetricType.ApplicationMonthlyUsedBytes,
      SessionReplayBudgetMetricType.ApplicationMonthlyUsedPercent,
    ]);
  });

  test("returns a fresh array, so one caller reordering it cannot reorder another's", () => {
    const first: Array<SessionReplayBudgetMetricType> =
      SessionReplayBudgetMetricTypeUtil.getAll();
    first.reverse();

    expect(SessionReplayBudgetMetricTypeUtil.getAll()[0]).toBe(
      SessionReplayBudgetMetricType.ProjectDailyUsedBytes,
    );
  });
});

describe("SessionReplayBudgetMetricTypeUtil.isReservedMetricName", () => {
  test.each(ALL_BUDGET_METRIC_TYPES)(
    "reserves %s",
    (metricType: SessionReplayBudgetMetricType) => {
      expect(
        SessionReplayBudgetMetricTypeUtil.isReservedMetricName(metricType),
      ).toBe(true);
    },
  );

  test("reserves the whole session replay namespace, not only today's names", () => {
    expect(
      SessionReplayBudgetMetricTypeUtil.isReservedMetricName(
        "oneuptime.rum.session.replay.anything.new",
      ),
    ).toBe(true);
  });

  test("is case-insensitive, because ingest lowercases names onto the same series", () => {
    expect(
      SessionReplayBudgetMetricTypeUtil.isReservedMetricName(
        "OneUptime.RUM.Session.Replay.Budget.Project.Daily.Used.Percent",
      ),
    ).toBe(true);
  });

  test.each([
    "oneuptime.rum.application.id",
    "oneuptime.llm.budget.percent.used",
    "oneuptime.monitor.response.time",
    "oneuptime.host.heartbeat",
    "web_vital.lcp",
    "session.replay.budget",
    // No separator: a different namespace, however close.
    "oneuptime.rum.session.replayed",
    "oneuptime.rum.session.replay",
    " oneuptime.rum.session.replay.budget.project.daily.used.bytes",
  ])("leaves %p alone", (name: string) => {
    expect(SessionReplayBudgetMetricTypeUtil.isReservedMetricName(name)).toBe(
      false,
    );
  });

  test("answers false for a missing name instead of throwing", () => {
    expect(SessionReplayBudgetMetricTypeUtil.isReservedMetricName("")).toBe(
      false,
    );
    expect(SessionReplayBudgetMetricTypeUtil.isReservedMetricName(null)).toBe(
      false,
    );
    expect(
      SessionReplayBudgetMetricTypeUtil.isReservedMetricName(undefined),
    ).toBe(false);
  });
});

describe("units", () => {
  test("bytes series are 'By', which charts scale as bytes", () => {
    for (const metricType of [
      SessionReplayBudgetMetricType.ProjectDailyUsedBytes,
      SessionReplayBudgetMetricType.ApplicationMonthlyUsedBytes,
    ]) {
      const unit: string =
        SessionReplayBudgetMetricTypeUtil.getUnit(metricType);

      expect(unit).toBe("By");
      expect(MetricUnitUtil.getFamilyBaseUnit(unit)).toBe("B");
    }
  });

  test("percent series are '%', never '1' (which the chart formatter would multiply by 100)", () => {
    for (const metricType of [
      SessionReplayBudgetMetricType.ProjectDailyUsedPercent,
      SessionReplayBudgetMetricType.ApplicationMonthlyUsedPercent,
    ]) {
      const unit: string =
        SessionReplayBudgetMetricTypeUtil.getUnit(metricType);

      expect(unit).toBe("%");
      expect(MetricUnitUtil.getFamilyBaseUnit(unit)).toBe("%");
    }
  });
});

describe("aggregation, titles, descriptions and scope", () => {
  test.each(ALL_BUDGET_METRIC_TYPES)(
    "%s aggregates with Max - Sum would multiply the shared project value",
    (metricType: SessionReplayBudgetMetricType) => {
      expect(
        SessionReplayBudgetMetricTypeUtil.getAggregationType(metricType),
      ).toBe(AggregationType.Max);
    },
  );

  test("titles match the Health page's own labels", () => {
    expect(
      SessionReplayBudgetMetricTypeUtil.getTitle(
        SessionReplayBudgetMetricType.ProjectDailyUsedBytes,
      ),
    ).toBe("Project Bytes Today");
    expect(
      SessionReplayBudgetMetricTypeUtil.getTitle(
        SessionReplayBudgetMetricType.ProjectDailyUsedPercent,
      ),
    ).toBe("Project Daily Budget Used");
    expect(
      SessionReplayBudgetMetricTypeUtil.getTitle(
        SessionReplayBudgetMetricType.ApplicationMonthlyUsedBytes,
      ),
    ).toBe("Application Bytes This Month");
    expect(
      SessionReplayBudgetMetricTypeUtil.getTitle(
        SessionReplayBudgetMetricType.ApplicationMonthlyUsedPercent,
      ),
    ).toBe("Application Monthly Budget Used");
  });

  test.each(ALL_BUDGET_METRIC_TYPES)(
    "%s has a catalog description that says how often it is written and that zero is not",
    (metricType: SessionReplayBudgetMetricType) => {
      const description: string =
        SessionReplayBudgetMetricTypeUtil.getDescription(metricType);

      expect(description.length).toBeGreaterThan(80);
      expect(description).toContain(
        `every ${SESSION_REPLAY_BUDGET_METRIC_INTERVAL_MINUTES} minutes`,
      );
      /*
       * "Usage", not the value: a percent point goes out with its bytes point
       * even when it rounds down to 0.00.
       */
      expect(description).toContain("while usage is above zero");
    },
  );

  test("the project series warn against Sum, and say which applications carry them", () => {
    for (const metricType of ALL_BUDGET_METRIC_TYPES) {
      const description: string =
        SessionReplayBudgetMetricTypeUtil.getDescription(metricType);
      const projectScoped: boolean =
        SessionReplayBudgetMetricTypeUtil.isProjectScoped(metricType);

      expect(description.includes("never Sum")).toBe(projectScoped);
      expect(
        description.includes(
          "every application that records (session replay on)",
        ),
      ).toBe(projectScoped);
    }
  });

  /*
   * The crossing upload is refused but stays counted, so the bytes were not
   * all "let through" - they are what the limit was charged.
   */
  test("the daily bytes are what the limit was charged, not what was let through", () => {
    const description: string =
      SessionReplayBudgetMetricTypeUtil.getDescription(
        SessionReplayBudgetMetricType.ProjectDailyUsedBytes,
      );

    expect(description).toContain("counted against the project's daily limit");
    expect(description).not.toContain("let through");
  });

  test("the percent descriptions say what 100 means and that the value is rounded down", () => {
    for (const metricType of [
      SessionReplayBudgetMetricType.ProjectDailyUsedPercent,
      SessionReplayBudgetMetricType.ApplicationMonthlyUsedPercent,
    ]) {
      const description: string =
        SessionReplayBudgetMetricTypeUtil.getDescription(metricType);

      expect(description).toContain("rounded down to 0.01");
      expect(description).toContain("At 100 or more");
    }
  });

  test("the monthly descriptions say the series only exists with a budget", () => {
    for (const metricType of [
      SessionReplayBudgetMetricType.ApplicationMonthlyUsedBytes,
      SessionReplayBudgetMetricType.ApplicationMonthlyUsedPercent,
    ]) {
      expect(
        SessionReplayBudgetMetricTypeUtil.getDescription(metricType),
      ).toContain("only for applications with a monthly budget");
    }
  });

  test("only the daily series are project-scoped", () => {
    expect(
      ALL_BUDGET_METRIC_TYPES.filter(
        (metricType: SessionReplayBudgetMetricType) => {
          return SessionReplayBudgetMetricTypeUtil.isProjectScoped(metricType);
        },
      ).sort(),
    ).toEqual(
      [
        SessionReplayBudgetMetricType.ProjectDailyUsedBytes,
        SessionReplayBudgetMetricType.ProjectDailyUsedPercent,
      ].sort(),
    );
  });
});

describe("every lookup resolves for every member and refuses an unknown one", () => {
  const lookups: Array<{
    name: string;
    run: (metricType: SessionReplayBudgetMetricType) => unknown;
  }> = [
    {
      name: "getTitle",
      run: (metricType: SessionReplayBudgetMetricType): unknown => {
        return SessionReplayBudgetMetricTypeUtil.getTitle(metricType);
      },
    },
    {
      name: "getDescription",
      run: (metricType: SessionReplayBudgetMetricType): unknown => {
        return SessionReplayBudgetMetricTypeUtil.getDescription(metricType);
      },
    },
    {
      name: "getUnit",
      run: (metricType: SessionReplayBudgetMetricType): unknown => {
        return SessionReplayBudgetMetricTypeUtil.getUnit(metricType);
      },
    },
    {
      name: "getAggregationType",
      run: (metricType: SessionReplayBudgetMetricType): unknown => {
        return SessionReplayBudgetMetricTypeUtil.getAggregationType(metricType);
      },
    },
    {
      name: "isProjectScoped",
      run: (metricType: SessionReplayBudgetMetricType): unknown => {
        return SessionReplayBudgetMetricTypeUtil.isProjectScoped(metricType);
      },
    },
  ];

  test.each(lookups)(
    "$name",
    (lookup: {
      name: string;
      run: (metricType: SessionReplayBudgetMetricType) => unknown;
    }) => {
      for (const metricType of ALL_BUDGET_METRIC_TYPES) {
        expect(lookup.run(metricType)).not.toBeUndefined();
      }

      expect(() => {
        return lookup.run(UNKNOWN_METRIC_TYPE);
      }).toThrow("Invalid SessionReplayBudgetMetricType value");
    },
  );
});

describe("attribute keys and cadence", () => {
  test("use the bare keys the other internal metrics use", () => {
    expect(SESSION_REPLAY_BUDGET_METRIC_PROJECT_ID_ATTRIBUTE).toBe("projectId");
    expect(SESSION_REPLAY_BUDGET_METRIC_RUM_APPLICATION_ID_ATTRIBUTE).toBe(
      "rumApplicationId",
    );
    expect(SESSION_REPLAY_BUDGET_METRIC_RUM_APPLICATION_NAME_ATTRIBUTE).toBe(
      "rumApplicationName",
    );
  });

  test("the sweep posts every five minutes", () => {
    // The alert templates' 15-minute window is three of these.
    expect(SESSION_REPLAY_BUDGET_METRIC_INTERVAL_MINUTES).toBe(5);
  });
});
