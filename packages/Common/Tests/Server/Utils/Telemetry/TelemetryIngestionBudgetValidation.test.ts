import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * What may be saved as a telemetry ingestion budget (issue #5917), for the
 * three services that save them, and the nesting rule: a key's budget only
 * subdivides its project's, so one above the project's is refused when it is
 * saved.
 */

jest.mock(
  "../../../../Server/Utils/Telemetry/TelemetryIngestionBudgetSettings",
  () => {
    return {
      __esModule: true,
      default: {
        getInstanceSettings: jest.fn(),
        getProjectOverrides: jest.fn(),
      },
    };
  },
);

import TelemetryIngestionBudgetValidation, {
  isTelemetryIngestionBudgetColumnTouched,
  isTelemetryIngestionBudgetInstanceSettingTouched,
} from "../../../../Server/Utils/Telemetry/TelemetryIngestionBudgetValidation";
import TelemetryIngestionBudgetSettings from "../../../../Server/Utils/Telemetry/TelemetryIngestionBudgetSettings";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ProductType from "../../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../../Types/ObjectID";
import {
  getEmptyTelemetryIngestionBudgetStoredSettings,
  TelemetryIngestionBudgetStoredSettings,
} from "../../../../Types/Telemetry/TelemetryIngestionBudget";

type MockFn = jest.Mock;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-1111111111c1",
);

const stored: (
  logsDaily: number | null,
  logsRate: number | null,
) => TelemetryIngestionBudgetStoredSettings = (
  logsDaily: number | null,
  logsRate: number | null,
): TelemetryIngestionBudgetStoredSettings => {
  const settings: TelemetryIngestionBudgetStoredSettings =
    getEmptyTelemetryIngestionBudgetStoredSettings();
  settings[ProductType.Logs] = {
    dailyBudgetInGB: logsDaily,
    rateLimitInMBPerSecond: logsRate,
  };
  return settings;
};

const thrown: (fn: () => unknown) => Promise<unknown> = async (
  fn: () => unknown,
): Promise<unknown> => {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  return null;
};

beforeEach(() => {
  jest.clearAllMocks();
  (
    TelemetryIngestionBudgetSettings.getInstanceSettings as unknown as MockFn
  ).mockResolvedValue({
    budgets: stored(50, 20),
    warningPercent: 80,
    resetTime: "00:00",
    timezone: "UTC",
  } as never);
  (
    TelemetryIngestionBudgetSettings.getProjectOverrides as unknown as MockFn
  ).mockResolvedValue(null as never);
});

describe("applyBudgetColumnRules", () => {
  test("normalizes what may be saved, and leaves untouched columns alone", () => {
    const data: Record<string, unknown> = {
      logsDailyIngestionBudgetInGB: "12.5",
      tracesIngestionRateLimitInMBPerSecond: 3,
      metricsDailyIngestionBudgetInGB: null,
      profilesDailyIngestionBudgetInGB: "",
      name: "unrelated",
    };

    TelemetryIngestionBudgetValidation.applyBudgetColumnRules(data, {
      allowZero: false,
    });

    expect(data).toEqual({
      logsDailyIngestionBudgetInGB: 12.5,
      tracesIngestionRateLimitInMBPerSecond: 3,
      metricsDailyIngestionBudgetInGB: null,
      profilesDailyIngestionBudgetInGB: null,
      name: "unrelated",
    });
  });

  test("refuses 0 where it means nothing, and allows it on a project as no limit", () => {
    expect(() => {
      TelemetryIngestionBudgetValidation.applyBudgetColumnRules(
        { logsDailyIngestionBudgetInGB: 0 },
        { allowZero: false },
      );
    }).toThrow(BadDataException);

    const project: Record<string, unknown> = {
      logsDailyIngestionBudgetInGB: 0,
    };
    TelemetryIngestionBudgetValidation.applyBudgetColumnRules(project, {
      allowZero: true,
    });
    expect(project["logsDailyIngestionBudgetInGB"]).toBe(0);
  });

  test("says which signal and which limit was wrong", () => {
    expect(() => {
      TelemetryIngestionBudgetValidation.applyBudgetColumnRules(
        { securityEventsIngestionRateLimitInMBPerSecond: -2 },
        { allowZero: false },
      );
    }).toThrow(
      "Security events rate limit: A rate limit must be more than 0 MB per second. Leave it empty for no limit.",
    );
    expect(() => {
      TelemetryIngestionBudgetValidation.applyBudgetColumnRules(
        { tracesDailyIngestionBudgetInGB: "lots" },
        { allowZero: true },
      );
    }).toThrow(
      "Traces daily budget: A daily budget must be a number of GB per day.",
    );
  });

  test("tells which writes touch a budget", () => {
    expect(isTelemetryIngestionBudgetColumnTouched({ name: "x" })).toBe(false);
    expect(
      isTelemetryIngestionBudgetColumnTouched({
        logsDailyIngestionBudgetInGB: undefined,
      }),
    ).toBe(false);
    expect(
      isTelemetryIngestionBudgetColumnTouched({
        logsDailyIngestionBudgetInGB: null,
      }),
    ).toBe(true);
    expect(
      isTelemetryIngestionBudgetInstanceSettingTouched({
        telemetryIngestionBudgetResetTime: "06:00",
      }),
    ).toBe(true);
    expect(
      isTelemetryIngestionBudgetInstanceSettingTouched({ host: "x" }),
    ).toBe(false);
  });
});

describe("applyInstanceSettingRules", () => {
  test("normalizes the warning, the reset time and the zone", () => {
    const data: Record<string, unknown> = {
      telemetryIngestionBudgetWarningPercent: "90",
      telemetryIngestionBudgetResetTime: "6:30",
      telemetryIngestionBudgetResetTimezone: " Europe/Berlin ",
    };

    TelemetryIngestionBudgetValidation.applyInstanceSettingRules(data);

    expect(data).toEqual({
      telemetryIngestionBudgetWarningPercent: 90,
      telemetryIngestionBudgetResetTime: "06:30",
      telemetryIngestionBudgetResetTimezone: "Europe/Berlin",
    });
  });

  test("clears an emptied field, and refuses what is not one", () => {
    const cleared: Record<string, unknown> = {
      telemetryIngestionBudgetResetTime: "",
    };
    TelemetryIngestionBudgetValidation.applyInstanceSettingRules(cleared);
    expect(cleared["telemetryIngestionBudgetResetTime"]).toBe(null);

    for (const data of [
      { telemetryIngestionBudgetWarningPercent: 100 },
      { telemetryIngestionBudgetResetTime: "25:00" },
      { telemetryIngestionBudgetResetTimezone: "Moon/Base" },
    ]) {
      expect(() => {
        TelemetryIngestionBudgetValidation.applyInstanceSettingRules(data);
      }).toThrow(BadDataException);
    }
  });
});

describe("assertIngestionKeyBudgetsWithinProject", () => {
  test("allows a key budget at or below the project's", async () => {
    expect(
      await thrown(() => {
        return TelemetryIngestionBudgetValidation.assertIngestionKeyBudgetsWithinProject(
          {
            projectId: PROJECT_ID,
            patch: {
              logsDailyIngestionBudgetInGB: 50,
              logsIngestionRateLimitInMBPerSecond: 20,
            },
          },
        );
      }),
    ).toBe(null);
  });

  test("refuses a key budget above the project's, saying the most it may be", async () => {
    const error: unknown = await thrown(() => {
      return TelemetryIngestionBudgetValidation.assertIngestionKeyBudgetsWithinProject(
        {
          projectId: PROJECT_ID,
          patch: { logsDailyIngestionBudgetInGB: 51 },
        },
      );
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(
      "This key's daily logs budget (51 GB) is more than the project's (50 GB). A key's budget can only subdivide its project's: set 50 GB or less, or leave it empty to use the project's.",
    );
  });

  test("refuses a key rate above the project's", async () => {
    expect(
      await thrown(() => {
        return TelemetryIngestionBudgetValidation.assertIngestionKeyBudgetsWithinProject(
          {
            projectId: PROJECT_ID,
            patch: { logsIngestionRateLimitInMBPerSecond: 21 },
          },
        );
      }),
    ).toBeInstanceOf(BadDataException);
  });

  test("compares with the project's own budget where the instance admin set one", async () => {
    (
      TelemetryIngestionBudgetSettings.getProjectOverrides as unknown as MockFn
    ).mockResolvedValue(stored(5, null) as never);

    expect(
      await thrown(() => {
        return TelemetryIngestionBudgetValidation.assertIngestionKeyBudgetsWithinProject(
          {
            projectId: PROJECT_ID,
            patch: { logsDailyIngestionBudgetInGB: 6 },
          },
        );
      }),
    ).toBeInstanceOf(BadDataException);
  });

  test("allows any key budget where the project has none, or a project override of 0 lifted it", async () => {
    (
      TelemetryIngestionBudgetSettings.getProjectOverrides as unknown as MockFn
    ).mockResolvedValue(stored(0, 0) as never);

    expect(
      await thrown(() => {
        return TelemetryIngestionBudgetValidation.assertIngestionKeyBudgetsWithinProject(
          {
            projectId: PROJECT_ID,
            patch: {
              logsDailyIngestionBudgetInGB: 5000,
              logsIngestionRateLimitInMBPerSecond: 5000,
            },
          },
        );
      }),
    ).toBe(null);
  });

  test("reads the project's limits fresh, not from the ingest cache", async () => {
    await TelemetryIngestionBudgetValidation.assertIngestionKeyBudgetsWithinProject(
      {
        projectId: PROJECT_ID,
        patch: { logsDailyIngestionBudgetInGB: 1 },
      },
    );

    expect(
      TelemetryIngestionBudgetSettings.getInstanceSettings,
    ).toHaveBeenCalledWith({ fresh: true });
    expect(
      TelemetryIngestionBudgetSettings.getProjectOverrides,
    ).toHaveBeenCalledWith(PROJECT_ID, { fresh: true });
  });

  test("reads nothing for a write that touches no budget", async () => {
    await TelemetryIngestionBudgetValidation.assertIngestionKeyBudgetsWithinProject(
      { projectId: PROJECT_ID, patch: { name: "renamed" } },
    );

    expect(
      TelemetryIngestionBudgetSettings.getInstanceSettings,
    ).not.toHaveBeenCalled();
  });

  test("refuses the write when the project's limits cannot be read", async () => {
    (
      TelemetryIngestionBudgetSettings.getProjectOverrides as unknown as MockFn
    ).mockRejectedValue(new Error("Postgres is down") as never);

    expect(
      await thrown(() => {
        return TelemetryIngestionBudgetValidation.assertIngestionKeyBudgetsWithinProject(
          {
            projectId: PROJECT_ID,
            patch: { logsDailyIngestionBudgetInGB: 1 },
          },
        );
      }),
    ).toBeInstanceOf(Error);
  });
});
