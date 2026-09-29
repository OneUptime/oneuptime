import { MetricPointType } from "../../../../Models/AnalyticsModels/Metric";
import GlobalConfig from "../../../../Models/DatabaseModels/GlobalConfig";
import MetricType from "../../../../Models/DatabaseModels/MetricType";
import Project from "../../../../Models/DatabaseModels/Project";
import RumApplication from "../../../../Models/DatabaseModels/RumApplication";
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import MetricService from "../../../../Server/Services/MetricService";
import ProjectService from "../../../../Server/Services/ProjectService";
import RumApplicationService from "../../../../Server/Services/RumApplicationService";
import FindBy from "../../../../Server/Types/Database/FindBy";
import logger from "../../../../Server/Utils/Logger";
import MonitorMetricUtil from "../../../../Server/Utils/Monitor/MonitorMetricUtil";
import SessionReplayBudgetMetrics, {
  SESSION_REPLAY_BUDGET_SWEEP_MAX_CONSECUTIVE_FAILED_PAGES,
  SESSION_REPLAY_BUDGET_SWEEP_PAGE_SIZE,
  SessionReplayBudgetApplication,
  SessionReplayBudgetSweepSummary,
} from "../../../../Server/Utils/SessionReplay/SessionReplayBudgetMetrics";
import SessionReplayUsage from "../../../../Server/Utils/SessionReplay/SessionReplayUsage";
import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import SessionReplayBudgetMetricType from "../../../../Types/Rum/SessionReplayBudgetMetricType";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import SessionReplayBudgetMetricTypeUtil from "../../../../Utils/Rum/SessionReplayBudgetMetricType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * SessionReplayBudgetMetrics turns the session replay byte-budget counters
 * into the oneuptime.rum.session.replay.budget.* gauges monitors alert on.
 * What is pinned here is everything a monitor depends on and no type system
 * checks:
 *
 *   - the percent is rounded DOWN, so ">= 80" and ">= 100" fire exactly
 *     when the gate's own comparison does - never a byte early or late;
 *   - rows are keyed to the RUM application, in the same shape as monitor
 *     metric rows; the project's daily value goes under every recording
 *     application of the project with only a projectId attribute;
 *   - zero and unknown usage post nothing (never a 0), the monthly pair only
 *     exists with a budget, and a project with replay switched off posts
 *     nothing;
 *   - the sweep pages by id, reads each counter once per page in one batch,
 *     inserts once per page, registers each name once per project, and stops
 *     cleanly on every failure it can meet without ever throwing.
 */

const GIB: number = 1024 * 1024 * 1024;
const DAILY_LIMIT: number = GIB;
const NOW: Date = new Date("2026-09-29T12:34:56.000Z");

function projectId(n: number): ObjectID {
  return new ObjectID(`10000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
}

function applicationId(n: number): ObjectID {
  return new ObjectID(`20000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
}

const PROJECT_A: ObjectID = projectId(1);
const PROJECT_B: ObjectID = projectId(2);

function makeApplication(data: {
  id: ObjectID;
  projectId: ObjectID;
  name?: string | undefined;
  monthlyBudgetInGB?: number | null | undefined;
}): RumApplication {
  const application: RumApplication = new RumApplication();
  application.id = data.id;
  application.projectId = data.projectId;
  application.name = data.name === undefined ? "Storefront" : data.name;

  if (data.monthlyBudgetInGB !== undefined && data.monthlyBudgetInGB !== null) {
    application.sessionReplayMonthlyBudgetInGB = data.monthlyBudgetInGB;
  }

  return application;
}

function makeProject(id: ObjectID): Project {
  const project: Project = new Project();
  project.id = id;
  return project;
}

function dailyKey(id: ObjectID): string {
  return SessionReplayUsage.getDailyProjectByteKey(id);
}

function monthlyKey(project: ObjectID, application: ObjectID): string {
  return SessionReplayUsage.getMonthlyApplicationByteKey({
    projectId: project,
    rumApplicationId: application,
  });
}

describe("SessionReplayBudgetMetrics.computePercentUsed", () => {
  test.each([
    { usedBytes: 0, limitBytes: GIB, expected: 0 },
    { usedBytes: GIB, limitBytes: GIB, expected: 100 },
    { usedBytes: GIB - 1, limitBytes: GIB, expected: 99.99 },
    { usedBytes: 2 * GIB, limitBytes: GIB, expected: 200 },
    // The crossing request stays charged: a 2 MiB overshoot reads over 100.
    { usedBytes: GIB + 2 * 1024 * 1024, limitBytes: GIB, expected: 100.19 },
    { usedBytes: Math.ceil(0.8 * GIB), limitBytes: GIB, expected: 80 },
    { usedBytes: Math.ceil(0.8 * GIB) - 1, limitBytes: GIB, expected: 79.99 },
    { usedBytes: 44 * 1024 * 1024, limitBytes: GIB, expected: 4.29 },
    // A handful of bytes is still "some", but rounds down to 0.00.
    { usedBytes: 10, limitBytes: GIB, expected: 0 },
  ])(
    "$usedBytes of $limitBytes bytes reads $expected",
    (row: { usedBytes: number; limitBytes: number; expected: number }) => {
      expect(
        SessionReplayBudgetMetrics.computePercentUsed({
          usedBytes: row.usedBytes,
          limitBytes: row.limitBytes,
        }),
      ).toBe(row.expected);
    },
  );

  test("a negative count (a refund across 00:00 UTC) reads as 0", () => {
    expect(
      SessionReplayBudgetMetrics.computePercentUsed({
        usedBytes: -4096,
        limitBytes: GIB,
      }),
    ).toBe(0);
  });

  test.each([0, -1, NaN, Infinity, -Infinity])(
    "a limit of %p has no percent",
    (limitBytes: number) => {
      expect(
        SessionReplayBudgetMetrics.computePercentUsed({
          usedBytes: 100,
          limitBytes: limitBytes,
        }),
      ).toBeNull();
    },
  );

  test("an unusable count has no percent", () => {
    expect(
      SessionReplayBudgetMetrics.computePercentUsed({
        usedBytes: NaN,
        limitBytes: GIB,
      }),
    ).toBeNull();
  });

  /*
   * The property the alert thresholds depend on, checked for every whole-GiB
   * budget a customer is likely to set and for the default daily limit: the
   * published percent crosses 80 and 100 on exactly the byte where the true
   * ratio does. The gate refuses once used > limit, so used == limit is
   * "spent" - and must read exactly 100.
   */
  test("crosses 80 and 100 on exactly the right byte for every whole-GiB budget up to 2,000", () => {
    const misfires: Array<string> = [];

    for (let gigabytes: number = 1; gigabytes <= 2000; gigabytes++) {
      const limitBytes: number = gigabytes * GIB;

      for (const threshold of [80, 100]) {
        // Smallest whole byte count at or above threshold% of the limit.
        const firstByte: number = Math.ceil((limitBytes * threshold) / 100);

        const atFirstByte: number | null =
          SessionReplayBudgetMetrics.computePercentUsed({
            usedBytes: firstByte,
            limitBytes: limitBytes,
          });
        const justBelow: number | null =
          SessionReplayBudgetMetrics.computePercentUsed({
            usedBytes: firstByte - 1,
            limitBytes: limitBytes,
          });

        if (atFirstByte === null || atFirstByte < threshold) {
          misfires.push(
            `${gigabytes} GiB: ${firstByte} bytes read ${atFirstByte}`,
          );
        }

        if (justBelow === null || justBelow >= threshold) {
          misfires.push(
            `${gigabytes} GiB: ${firstByte - 1} bytes read ${justBelow}`,
          );
        }
      }
    }

    expect(misfires).toEqual([]);
  });
});

describe("SessionReplayBudgetMetrics.getMonthlyBudgetInBytes", () => {
  test("GB is GiB, rounded down to a whole byte, as the gate computes it", () => {
    expect(SessionReplayBudgetMetrics.getMonthlyBudgetInBytes(10)).toBe(
      10 * GIB,
    );
    expect(SessionReplayBudgetMetrics.getMonthlyBudgetInBytes(1.5)).toBe(
      Math.floor(1.5 * GIB),
    );
  });

  test("accepts a numeric string, the way the gate's policy reader does", () => {
    expect(SessionReplayBudgetMetrics.getMonthlyBudgetInBytes("25")).toBe(
      25 * GIB,
    );
  });

  test.each([0, -5, null, undefined, NaN, Infinity, "", "   ", "abc", {}])(
    "%p means no monthly budget",
    (value: unknown) => {
      expect(
        SessionReplayBudgetMetrics.getMonthlyBudgetInBytes(value),
      ).toBeNull();
    },
  );
});

describe("SessionReplayBudgetMetrics.isDailyLimitMismatchSuspected", () => {
  test("only past twice the limit - a spent counter rests at most one request over it", () => {
    expect(
      SessionReplayBudgetMetrics.isDailyLimitMismatchSuspected({
        usedBytes: 2 * DAILY_LIMIT + 1,
        dailyByteLimit: DAILY_LIMIT,
      }),
    ).toBe(true);
    expect(
      SessionReplayBudgetMetrics.isDailyLimitMismatchSuspected({
        usedBytes: 2 * DAILY_LIMIT,
        dailyByteLimit: DAILY_LIMIT,
      }),
    ).toBe(false);
    expect(
      SessionReplayBudgetMetrics.isDailyLimitMismatchSuspected({
        usedBytes: DAILY_LIMIT + 2 * 1024 * 1024,
        dailyByteLimit: DAILY_LIMIT,
      }),
    ).toBe(false);
  });

  test("never without a usable limit", () => {
    expect(
      SessionReplayBudgetMetrics.isDailyLimitMismatchSuspected({
        usedBytes: 10 * GIB,
        dailyByteLimit: 0,
      }),
    ).toBe(false);
  });
});

describe("SessionReplayBudgetMetrics.buildMetricRow", () => {
  const ingestionDate: Date = new Date("2026-09-29T10:00:00.000Z");
  const retentionDate: Date = new Date("2026-10-29T10:00:00.000Z");

  function build(attributes: JSONObject = { projectId: "p" }): JSONObject {
    return SessionReplayBudgetMetrics.buildMetricRow({
      projectId: PROJECT_A,
      rumApplicationId: applicationId(1),
      metricType: SessionReplayBudgetMetricType.ProjectDailyUsedPercent,
      value: 42.5,
      attributes: attributes,
      ingestionDate: ingestionDate,
      retentionDate: retentionDate,
    });
  }

  test("keys the row to the RUM application, so a monitor scoped to it finds it", () => {
    const row: JSONObject = build();

    expect(row["projectId"]).toBe(PROJECT_A.toString());
    expect(row["primaryEntityId"]).toBe(applicationId(1).toString());
    expect(row["primaryEntityType"]).toBe(ServiceType.RealUserMonitor);
    expect(row["name"]).toBe(
      SessionReplayBudgetMetricType.ProjectDailyUsedPercent,
    );
    expect(row["metricPointType"]).toBe(MetricPointType.Gauge);
    expect(row["value"]).toBe(42.5);
  });

  test("stamps the sweep's time and the retention it was given", () => {
    const row: JSONObject = build();

    expect(row["time"]).toBe(OneUptimeDate.toClickhouseDateTime(ingestionDate));
    expect(row["createdAt"]).toBe(
      OneUptimeDate.toClickhouseDateTime(ingestionDate),
    );
    expect(row["timeUnixNano"]).toBe(
      OneUptimeDate.toUnixNano(ingestionDate).toString(),
    );
    expect(row["retentionDate"]).toBe(
      OneUptimeDate.toClickhouseDateTime(retentionDate),
    );
    expect(typeof row["_id"]).toBe("string");
  });

  test("publishes the attribute keys (the pickers read keys, not the map) and copies the map", () => {
    const attributes: JSONObject = { projectId: "p", rumApplicationId: "a" };
    const row: JSONObject = build(attributes);

    expect(row["attributeKeys"]).toEqual(["projectId", "rumApplicationId"]);
    expect(row["attributes"]).toEqual(attributes);

    (row["attributes"] as JSONObject)["mutated"] = "yes";
    expect(attributes["mutated"]).toBeUndefined();
  });

  test("writes exactly the columns MonitorMetricUtil.buildMonitorMetricRow writes (the lockstep)", async () => {
    // The monitor builder reads its retention setting; there is no database.
    jest
      .spyOn(GlobalConfigService, "findOneBy")
      .mockResolvedValue(null as never);

    const monitorRow: JSONObject = await (
      MonitorMetricUtil as unknown as {
        buildMonitorMetricRow: (data: {
          projectId: ObjectID;
          monitorId: ObjectID;
          metricName: string;
          value: number | null | undefined;
          attributes: JSONObject;
        }) => Promise<JSONObject>;
      }
    ).buildMonitorMetricRow({
      projectId: PROJECT_A,
      monitorId: applicationId(1),
      metricName: "oneuptime.monitor.online",
      value: 1,
      attributes: { monitorId: applicationId(1).toString() },
    });

    const row: JSONObject = build();

    expect(Object.keys(row).sort()).toEqual(Object.keys(monitorRow).sort());

    for (const column of [
      "aggregationTemporality",
      "startTime",
      "startTimeUnixNano",
      "isMonotonic",
      "count",
      "sum",
      "min",
      "max",
      "bucketCounts",
      "explicitBounds",
    ]) {
      expect(row[column]).toEqual(monitorRow[column]);
    }

    jest.restoreAllMocks();
  });
});

describe("SessionReplayBudgetMetrics.buildApplicationRows", () => {
  const ingestionDate: Date = new Date("2026-09-29T10:00:00.000Z");
  const retentionDate: Date = new Date("2026-10-29T10:00:00.000Z");

  function application(
    overrides: Partial<SessionReplayBudgetApplication> = {},
  ): SessionReplayBudgetApplication {
    return {
      rumApplicationId: applicationId(1),
      projectId: PROJECT_A,
      name: "Storefront",
      monthlyBudgetInBytes: null,
      ...overrides,
    };
  }

  function rows(data: {
    application?: SessionReplayBudgetApplication;
    daily: number | null;
    monthly?: number | null;
    dailyByteLimit?: number;
  }): Array<JSONObject> {
    return SessionReplayBudgetMetrics.buildApplicationRows({
      application: data.application || application(),
      projectDailyUsedBytes: data.daily,
      applicationMonthlyUsedBytes:
        data.monthly === undefined ? null : data.monthly,
      dailyByteLimit:
        data.dailyByteLimit === undefined ? DAILY_LIMIT : data.dailyByteLimit,
      ingestionDate: ingestionDate,
      retentionDate: retentionDate,
    });
  }

  function byName(
    list: Array<JSONObject>,
    name: SessionReplayBudgetMetricType,
  ): JSONObject | undefined {
    return list.find((row: JSONObject) => {
      return row["name"] === name;
    });
  }

  test("an application without a monthly budget gets the project's daily pair only", () => {
    const list: Array<JSONObject> = rows({ daily: 858993460, monthly: 999 });

    expect(
      list.map((row: JSONObject) => {
        return row["name"];
      }),
    ).toEqual([
      SessionReplayBudgetMetricType.ProjectDailyUsedBytes,
      SessionReplayBudgetMetricType.ProjectDailyUsedPercent,
    ]);
    expect(
      byName(list, SessionReplayBudgetMetricType.ProjectDailyUsedBytes)?.[
        "value"
      ],
    ).toBe(858993460);
    expect(
      byName(list, SessionReplayBudgetMetricType.ProjectDailyUsedPercent)?.[
        "value"
      ],
    ).toBe(80);
  });

  test("the daily pair carries only the project id - it is the project's budget, not this application's usage", () => {
    for (const row of rows({ daily: 1000 })) {
      expect(row["attributes"]).toEqual({ projectId: PROJECT_A.toString() });
      expect(row["attributeKeys"]).toEqual(["projectId"]);
      // Still keyed to the application, which is what a scoped monitor reads.
      expect(row["primaryEntityId"]).toBe(applicationId(1).toString());
    }
  });

  test("an application with a monthly budget also gets its own monthly pair, with its identity", () => {
    const list: Array<JSONObject> = rows({
      application: application({ monthlyBudgetInBytes: 10 * GIB }),
      daily: 1000,
      monthly: 9 * GIB,
    });

    expect(list).toHaveLength(4);

    const monthlyBytes: JSONObject | undefined = byName(
      list,
      SessionReplayBudgetMetricType.ApplicationMonthlyUsedBytes,
    );
    const monthlyPercent: JSONObject | undefined = byName(
      list,
      SessionReplayBudgetMetricType.ApplicationMonthlyUsedPercent,
    );

    expect(monthlyBytes?.["value"]).toBe(9 * GIB);
    expect(monthlyPercent?.["value"]).toBe(90);

    for (const row of [monthlyBytes, monthlyPercent]) {
      expect(row?.["attributes"]).toEqual({
        projectId: PROJECT_A.toString(),
        rumApplicationId: applicationId(1).toString(),
        rumApplicationName: "Storefront",
      });
      expect(row?.["attributeKeys"]).toEqual([
        "projectId",
        "rumApplicationId",
        "rumApplicationName",
      ]);
    }
  });

  test("a blank application name is left off rather than posted empty", () => {
    const list: Array<JSONObject> = rows({
      application: application({
        name: "   ",
        monthlyBudgetInBytes: 10 * GIB,
      }),
      daily: null,
      monthly: GIB,
    });

    expect(list).toHaveLength(2);

    for (const row of list) {
      expect(Object.keys(row["attributes"] as JSONObject).sort()).toEqual([
        "projectId",
        "rumApplicationId",
      ]);
    }
  });

  test("zero usage posts nothing - a zero cannot cross a threshold", () => {
    expect(
      rows({
        application: application({ monthlyBudgetInBytes: 10 * GIB }),
        daily: 0,
        monthly: 0,
      }),
    ).toEqual([]);
  });

  test("an unknown count (null) posts nothing, never 0", () => {
    expect(
      rows({
        application: application({ monthlyBudgetInBytes: 10 * GIB }),
        daily: null,
        monthly: null,
      }),
    ).toEqual([]);
  });

  test("a negative daily count reads as 0, so it posts nothing", () => {
    expect(rows({ daily: -2048 })).toEqual([]);
  });

  test("the bytes point goes out even when the percent rounds down to 0.00", () => {
    const list: Array<JSONObject> = rows({ daily: 10 });

    expect(list).toHaveLength(2);
    expect(
      byName(list, SessionReplayBudgetMetricType.ProjectDailyUsedPercent)?.[
        "value"
      ],
    ).toBe(0);
  });

  test("without a usable daily limit only the bytes point is posted", () => {
    const list: Array<JSONObject> = rows({ daily: 1000, dailyByteLimit: 0 });

    expect(
      list.map((row: JSONObject) => {
        return row["name"];
      }),
    ).toEqual([SessionReplayBudgetMetricType.ProjectDailyUsedBytes]);
  });

  test("a spent budget reads 100 or more, not capped", () => {
    const list: Array<JSONObject> = rows({
      application: application({ monthlyBudgetInBytes: GIB }),
      daily: DAILY_LIMIT + 1024,
      monthly: 3 * GIB,
    });

    expect(
      byName(list, SessionReplayBudgetMetricType.ProjectDailyUsedPercent)?.[
        "value"
      ],
    ).toBe(100);
    expect(
      byName(
        list,
        SessionReplayBudgetMetricType.ApplicationMonthlyUsedPercent,
      )?.["value"],
    ).toBe(300);
  });
});

describe("SessionReplayBudgetMetrics.toBudgetApplication", () => {
  test("reads the id, project, name and monthly budget off the row", () => {
    const budgetApplication: SessionReplayBudgetApplication | null =
      SessionReplayBudgetMetrics.toBudgetApplication(
        makeApplication({
          id: applicationId(7),
          projectId: PROJECT_B,
          name: "Checkout",
          monthlyBudgetInGB: 3,
        }),
      );

    expect(budgetApplication?.rumApplicationId.toString()).toBe(
      applicationId(7).toString(),
    );
    expect(budgetApplication?.projectId.toString()).toBe(PROJECT_B.toString());
    expect(budgetApplication?.name).toBe("Checkout");
    expect(budgetApplication?.monthlyBudgetInBytes).toBe(3 * GIB);
  });

  test("a row that cannot be keyed is skipped", () => {
    const withoutProject: RumApplication = new RumApplication();
    withoutProject.id = applicationId(1);

    const withoutId: RumApplication = new RumApplication();
    withoutId.projectId = PROJECT_A;

    expect(
      SessionReplayBudgetMetrics.toBudgetApplication(withoutProject),
    ).toBeNull();
    expect(
      SessionReplayBudgetMetrics.toBudgetApplication(withoutId),
    ).toBeNull();
  });

  test("no budget and no name read as null and empty", () => {
    const row: RumApplication = makeApplication({
      id: applicationId(1),
      projectId: PROJECT_A,
    });
    delete (row as unknown as JSONObject)["name"];

    const budgetApplication: SessionReplayBudgetApplication | null =
      SessionReplayBudgetMetrics.toBudgetApplication(row);

    expect(budgetApplication?.name).toBe("");
    expect(budgetApplication?.monthlyBudgetInBytes).toBeNull();
  });
});

describe("SessionReplayBudgetMetrics.publishAll", () => {
  let pages: Array<Array<RumApplication>>;
  let findCalls: Array<FindBy<RumApplication>>;
  let projectFindCalls: Array<FindBy<Project>>;
  let allowedProjects: Array<ObjectID>;
  let counters: Dictionary<number>;
  let counterReads: Array<Array<string>>;
  let countersAvailable: boolean;
  let insertedBatches: Array<Array<JSONObject>>;
  let registrations: Array<{
    projectId: string;
    names: Array<string>;
    metricTypes: Dictionary<MetricType>;
  }>;
  let retentionConfig: GlobalConfig | null;

  beforeEach(() => {
    pages = [];
    findCalls = [];
    projectFindCalls = [];
    allowedProjects = [PROJECT_A, PROJECT_B];
    counters = {};
    counterReads = [];
    countersAvailable = true;
    insertedBatches = [];
    registrations = [];
    retentionConfig = null;

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return new Date(NOW.getTime());
    });

    jest
      .spyOn(RumApplicationService, "findBy")
      .mockImplementation(
        async (
          findBy: FindBy<RumApplication>,
        ): Promise<Array<RumApplication>> => {
          findCalls.push(findBy);
          return pages[findCalls.length - 1] || [];
        },
      );

    jest
      .spyOn(ProjectService, "findBy")
      .mockImplementation(
        async (findBy: FindBy<Project>): Promise<Array<Project>> => {
          projectFindCalls.push(findBy);
          return allowedProjects.map((id: ObjectID) => {
            return makeProject(id);
          });
        },
      );

    jest
      .spyOn(SessionReplayUsage, "readByteCounters")
      .mockImplementation(
        async (keys: Array<string>): Promise<Array<number> | null> => {
          counterReads.push(keys);

          if (!countersAvailable) {
            return null;
          }

          return keys.map((key: string) => {
            return counters[key] || 0;
          });
        },
      );

    jest
      .spyOn(MetricService, "insertJsonRows")
      .mockImplementation(async (rows: Array<JSONObject>): Promise<void> => {
        insertedBatches.push(rows);
      });

    jest
      .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
      .mockImplementation(
        async (data: {
          projectId: ObjectID;
          metricNameServiceNameMap: Dictionary<MetricType>;
        }): Promise<void> => {
          registrations.push({
            projectId: data.projectId.toString(),
            names: Object.keys(data.metricNameServiceNameMap).sort(),
            metricTypes: data.metricNameServiceNameMap,
          });
        },
      );

    jest
      .spyOn(GlobalConfigService, "findOneBy")
      .mockImplementation(async (): Promise<GlobalConfig | null> => {
        return retentionConfig;
      });

    jest.spyOn(logger, "debug").mockImplementation((): void => {});
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
    jest.spyOn(logger, "error").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  async function sweep(
    options: {
      shouldContinue?: () => boolean;
      deadline?: Date;
      dailyByteLimit?: number;
    } = {},
  ): Promise<SessionReplayBudgetSweepSummary> {
    return SessionReplayBudgetMetrics.publishAll({
      dailyByteLimit:
        options.dailyByteLimit === undefined
          ? DAILY_LIMIT
          : options.dailyByteLimit,
      shouldContinue: options.shouldContinue,
      deadline: options.deadline,
    });
  }

  function insertedRows(): Array<JSONObject> {
    return insertedBatches.flat();
  }

  // A full page of applications, all in one project, with ids from `from`.
  function fullPage(from: number, project: ObjectID): Array<RumApplication> {
    return Array.from(
      { length: SESSION_REPLAY_BUDGET_SWEEP_PAGE_SIZE },
      (_: unknown, index: number) => {
        return makeApplication({
          id: applicationId(from + index),
          projectId: project,
        });
      },
    );
  }

  test("reads only applications that record replay, by id, as root", async () => {
    await sweep();

    expect(findCalls).toHaveLength(1);

    const findBy: FindBy<RumApplication> = findCalls[0]!;
    const query: JSONObject = findBy.query as unknown as JSONObject;

    expect(query["isSessionReplayEnabled"]).toBe(true);
    /*
     * "Has ever recorded": replay is on by default for every RUM application,
     * so the enabled flag alone would include every web-vitals-only app.
     */
    const lastChunk: { getSql?: (alias: string) => string } = query[
      "sessionReplayLastChunkReceivedAt"
    ] as unknown as { getSql?: (alias: string) => string };
    expect(lastChunk.getSql?.("column")).toBe("(column IS NOT NULL)");
    expect(query["_id"]).toBeUndefined();

    expect(findBy.select).toEqual({
      _id: true,
      projectId: true,
      name: true,
      sessionReplayMonthlyBudgetInGB: true,
    });
    expect(findBy.sort).toEqual({ _id: SortOrder.Ascending });
    expect(findBy.skip).toBe(0);
    expect(findBy.limit).toBe(SESSION_REPLAY_BUDGET_SWEEP_PAGE_SIZE);
    expect(findBy.props).toEqual({ isRoot: true });
  });

  test("an empty instance finishes without touching projects, Redis or ClickHouse", async () => {
    const summary: SessionReplayBudgetSweepSummary = await sweep();

    expect(summary.stopReason).toBe("done");
    expect(summary.pagesScanned).toBe(0);
    expect(projectFindCalls).toHaveLength(0);
    expect(counterReads).toHaveLength(0);
    expect(insertedBatches).toHaveLength(0);
  });

  test("pages on past the last id of a full page", async () => {
    pages = [
      fullPage(1, PROJECT_A),
      [makeApplication({ id: applicationId(9999), projectId: PROJECT_A })],
    ];

    const summary: SessionReplayBudgetSweepSummary = await sweep();

    expect(findCalls).toHaveLength(2);

    const secondQuery: JSONObject = findCalls[1]!
      .query as unknown as JSONObject;
    const cursor: { getSql?: (alias: string) => string } = secondQuery[
      "_id"
    ] as unknown as { getSql?: (alias: string) => string };

    // QueryHelper.greaterThan: the cursor is the last id of the first page.
    expect(cursor.getSql?.("id")).toMatch(/^\(id > :/);
    expect(
      Object.values(
        (cursor as unknown as { objectLiteralParameters: JSONObject })
          .objectLiteralParameters,
      ).map((value: unknown) => {
        return String(value);
      }),
    ).toContain(
      applicationId(SESSION_REPLAY_BUDGET_SWEEP_PAGE_SIZE).toString(),
    );

    expect(summary.pagesScanned).toBe(2);
    expect(summary.applicationsScanned).toBe(
      SESSION_REPLAY_BUDGET_SWEEP_PAGE_SIZE + 1,
    );
  });

  test("drops applications whose project has replay switched off", async () => {
    pages = [
      [
        makeApplication({ id: applicationId(1), projectId: PROJECT_A }),
        makeApplication({ id: applicationId(2), projectId: PROJECT_B }),
      ],
    ];
    allowedProjects = [PROJECT_A];
    counters[dailyKey(PROJECT_A)] = 5000;
    counters[dailyKey(PROJECT_B)] = 7000;

    await sweep();

    expect(projectFindCalls).toHaveLength(1);

    const projectQuery: JSONObject = projectFindCalls[0]!
      .query as unknown as JSONObject;
    expect(projectQuery["isSessionReplayAllowed"]).toBe(true);
    expect(projectFindCalls[0]!.select).toEqual({ _id: true });
    // One row per distinct project on the page, however many apps it has.
    expect(projectFindCalls[0]!.limit).toBe(2);
    expect(projectFindCalls[0]!.props).toEqual({ isRoot: true });

    expect(counterReads).toEqual([[dailyKey(PROJECT_A)]]);

    const entityIds: Array<unknown> = insertedRows().map((row: JSONObject) => {
      return row["primaryEntityId"];
    });

    expect(new Set(entityIds)).toEqual(new Set([applicationId(1).toString()]));
  });

  test("reads one daily key per project and one monthly key per budgeted application, in one batch", async () => {
    pages = [
      [
        makeApplication({
          id: applicationId(1),
          projectId: PROJECT_A,
          monthlyBudgetInGB: 10,
        }),
        makeApplication({ id: applicationId(2), projectId: PROJECT_A }),
        makeApplication({
          id: applicationId(3),
          projectId: PROJECT_B,
          monthlyBudgetInGB: 0,
        }),
      ],
    ];

    await sweep();

    expect(counterReads).toEqual([
      [
        dailyKey(PROJECT_A),
        monthlyKey(PROJECT_A, applicationId(1)),
        dailyKey(PROJECT_B),
      ],
    ]);
  });

  test("posts the project's daily value under every recording application, identically", async () => {
    pages = [
      [
        makeApplication({ id: applicationId(1), projectId: PROJECT_A }),
        makeApplication({ id: applicationId(2), projectId: PROJECT_A }),
      ],
    ];
    counters[dailyKey(PROJECT_A)] = Math.ceil(0.85 * DAILY_LIMIT);

    const summary: SessionReplayBudgetSweepSummary = await sweep();

    // One insert for the whole page.
    expect(insertedBatches).toHaveLength(1);

    const percentRows: Array<JSONObject> = insertedRows().filter(
      (row: JSONObject) => {
        return (
          row["name"] === SessionReplayBudgetMetricType.ProjectDailyUsedPercent
        );
      },
    );

    expect(
      percentRows.map((row: JSONObject) => {
        return [row["primaryEntityId"], row["value"]];
      }),
    ).toEqual([
      [applicationId(1).toString(), 85],
      [applicationId(2).toString(), 85],
    ]);

    for (const row of insertedRows()) {
      expect(row["attributes"]).toEqual({ projectId: PROJECT_A.toString() });
    }

    expect(summary.rowsWritten).toBe(4);
  });

  test("posts the monthly pair only for budgeted applications, from their own counters", async () => {
    pages = [
      [
        makeApplication({
          id: applicationId(1),
          projectId: PROJECT_A,
          name: "Checkout",
          monthlyBudgetInGB: 4,
        }),
        makeApplication({ id: applicationId(2), projectId: PROJECT_A }),
      ],
    ];
    counters[monthlyKey(PROJECT_A, applicationId(1))] = 3 * GIB;

    await sweep();

    // No daily usage today, so only the budgeted application's monthly pair.
    expect(
      insertedRows().map((row: JSONObject) => {
        return [row["primaryEntityId"], row["name"], row["value"]];
      }),
    ).toEqual([
      [
        applicationId(1).toString(),
        SessionReplayBudgetMetricType.ApplicationMonthlyUsedBytes,
        3 * GIB,
      ],
      [
        applicationId(1).toString(),
        SessionReplayBudgetMetricType.ApplicationMonthlyUsedPercent,
        75,
      ],
    ]);
    expect(insertedRows()[0]!["attributes"]).toEqual({
      projectId: PROJECT_A.toString(),
      rumApplicationId: applicationId(1).toString(),
      rumApplicationName: "Checkout",
    });
  });

  test("zero usage everywhere inserts nothing and registers nothing", async () => {
    pages = [
      [
        makeApplication({
          id: applicationId(1),
          projectId: PROJECT_A,
          monthlyBudgetInGB: 4,
        }),
      ],
    ];

    const summary: SessionReplayBudgetSweepSummary = await sweep();

    expect(counterReads).toHaveLength(1);
    expect(insertedBatches).toHaveLength(0);
    expect(registrations).toHaveLength(0);
    expect(summary.stopReason).toBe("done");
    expect(summary.rowsWritten).toBe(0);
  });

  test("unreadable counters end the sweep without posting anything - an unknown is never a 0", async () => {
    pages = [
      fullPage(1, PROJECT_A),
      [makeApplication({ id: applicationId(9999), projectId: PROJECT_A })],
    ];
    countersAvailable = false;

    const summary: SessionReplayBudgetSweepSummary = await sweep();

    expect(summary.stopReason).toBe("counters-unavailable");
    expect(insertedBatches).toHaveLength(0);
    // It does not go on to spend queries on pages it cannot publish.
    expect(findCalls).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("could not be read from Redis"),
    );
  });

  test("a page that cannot be read ends the sweep quietly - it never throws", async () => {
    jest
      .spyOn(RumApplicationService, "findBy")
      .mockRejectedValue(new Error("Postgres is down") as never);

    const summary: SessionReplayBudgetSweepSummary = await sweep();

    expect(summary.stopReason).toBe("page-fetch-failed");
    expect(logger.error).toHaveBeenCalled();
    expect(insertedBatches).toHaveLength(0);
  });

  test("a page that does not advance the cursor ends the sweep instead of looping", async () => {
    const page: Array<RumApplication> = fullPage(1, PROJECT_A);
    pages = [page, page];

    const summary: SessionReplayBudgetSweepSummary = await sweep();

    expect(summary.stopReason).toBe("page-fetch-failed");
    expect(findCalls).toHaveLength(2);
    expect(summary.pagesScanned).toBe(1);
  });

  test("a failed insert skips its page, the cursor still moves past it, and the next page is published", async () => {
    pages = [
      fullPage(1, PROJECT_A),
      [makeApplication({ id: applicationId(9999), projectId: PROJECT_B })],
    ];
    counters[dailyKey(PROJECT_A)] = 1000;
    counters[dailyKey(PROJECT_B)] = 2000;

    let insertAttempts: number = 0;

    jest
      .spyOn(MetricService, "insertJsonRows")
      .mockImplementation(async (rows: Array<JSONObject>): Promise<void> => {
        insertAttempts++;

        if (insertAttempts === 1) {
          throw new Error("ClickHouse hiccup");
        }

        insertedBatches.push(rows);
      });

    const summary: SessionReplayBudgetSweepSummary = await sweep();

    expect(summary.stopReason).toBe("done");
    expect(summary.pagesFailed).toBe(1);
    expect(findCalls).toHaveLength(2);
    expect(
      new Set(
        insertedRows().map((row: JSONObject) => {
          return row["primaryEntityId"];
        }),
      ),
    ).toEqual(new Set([applicationId(9999).toString()]));
    // The failed page's project is not registered: nothing of it was written.
    expect(
      registrations.map((registration: { projectId: string }) => {
        return registration.projectId;
      }),
    ).toEqual([PROJECT_B.toString()]);
  });

  test(`${SESSION_REPLAY_BUDGET_SWEEP_MAX_CONSECUTIVE_FAILED_PAGES} failed pages in a row end the sweep`, async () => {
    pages = Array.from({ length: 6 }, (_: unknown, index: number) => {
      return fullPage(
        1 + index * SESSION_REPLAY_BUDGET_SWEEP_PAGE_SIZE,
        PROJECT_A,
      );
    });
    counters[dailyKey(PROJECT_A)] = 1000;

    jest
      .spyOn(MetricService, "insertJsonRows")
      .mockRejectedValue(new Error("ClickHouse is down") as never);

    const summary: SessionReplayBudgetSweepSummary = await sweep();

    expect(summary.stopReason).toBe("too-many-failed-pages");
    expect(summary.pagesFailed).toBe(
      SESSION_REPLAY_BUDGET_SWEEP_MAX_CONSECUTIVE_FAILED_PAGES,
    );
    expect(findCalls).toHaveLength(
      SESSION_REPLAY_BUDGET_SWEEP_MAX_CONSECUTIVE_FAILED_PAGES,
    );
  });

  test("a failed Project lookup is a failed page, not a crash", async () => {
    pages = [[makeApplication({ id: applicationId(1), projectId: PROJECT_A })]];

    jest
      .spyOn(ProjectService, "findBy")
      .mockRejectedValue(new Error("Postgres timeout") as never);

    const summary: SessionReplayBudgetSweepSummary = await sweep();

    expect(summary.pagesFailed).toBe(1);
    expect(summary.stopReason).toBe("done");
    expect(counterReads).toHaveLength(0);
  });

  test("stops between pages once the sweep lock is lost", async () => {
    pages = [
      fullPage(1, PROJECT_A),
      [makeApplication({ id: applicationId(9999), projectId: PROJECT_A })],
    ];

    let checks: number = 0;

    const summary: SessionReplayBudgetSweepSummary = await sweep({
      shouldContinue: (): boolean => {
        checks++;
        return checks === 1;
      },
    });

    expect(summary.stopReason).toBe("lock-lost");
    expect(findCalls).toHaveLength(1);
  });

  test("stops between pages once the deadline has passed", async () => {
    pages = [
      fullPage(1, PROJECT_A),
      [makeApplication({ id: applicationId(9999), projectId: PROJECT_A })],
    ];

    let now: number = NOW.getTime();

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      const current: Date = new Date(now);
      // Each read of the clock is a minute later than the last.
      now += 60 * 1000;
      return current;
    });

    const summary: SessionReplayBudgetSweepSummary = await sweep({
      deadline: new Date(NOW.getTime() + 90 * 1000),
    });

    expect(summary.stopReason).toBe("deadline");
    expect(findCalls).toHaveLength(1);
  });

  test("stamps every row of the sweep with one timestamp", async () => {
    pages = [
      fullPage(1, PROJECT_A),
      [
        makeApplication({
          id: applicationId(9999),
          projectId: PROJECT_B,
          monthlyBudgetInGB: 1,
        }),
      ],
    ];
    counters[dailyKey(PROJECT_A)] = 1000;
    counters[dailyKey(PROJECT_B)] = 1000;
    counters[monthlyKey(PROJECT_B, applicationId(9999))] = 1000;

    let now: number = NOW.getTime();

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      now += 1000;
      return new Date(now);
    });

    await sweep();

    const times: Set<unknown> = new Set(
      insertedRows().map((row: JSONObject) => {
        return row["time"];
      }),
    );

    expect(insertedBatches).toHaveLength(2);
    expect(times.size).toBe(1);
  });

  test("registers each written name once per project, with its unit and description and no services", async () => {
    pages = [
      fullPage(1, PROJECT_A),
      [
        makeApplication({
          id: applicationId(9999),
          projectId: PROJECT_A,
          monthlyBudgetInGB: 1,
        }),
      ],
    ];
    counters[dailyKey(PROJECT_A)] = 1000;
    counters[monthlyKey(PROJECT_A, applicationId(9999))] = 1000;

    await sweep();

    /*
     * Page 1 wrote only the daily pair; page 2 wrote the daily pair again
     * (already registered this sweep) and the monthly pair (new).
     */
    expect(
      registrations.map(
        (registration: { projectId: string; names: Array<string> }) => {
          return [registration.projectId, registration.names];
        },
      ),
    ).toEqual([
      [
        PROJECT_A.toString(),
        [
          SessionReplayBudgetMetricType.ProjectDailyUsedBytes,
          SessionReplayBudgetMetricType.ProjectDailyUsedPercent,
        ].sort(),
      ],
      [
        PROJECT_A.toString(),
        [
          SessionReplayBudgetMetricType.ApplicationMonthlyUsedBytes,
          SessionReplayBudgetMetricType.ApplicationMonthlyUsedPercent,
        ].sort(),
      ],
    ]);

    for (const registration of registrations) {
      for (const [name, metricType] of Object.entries(
        registration.metricTypes,
      )) {
        const type: SessionReplayBudgetMetricType =
          name as SessionReplayBudgetMetricType;

        expect(metricType.name).toBe(name);
        expect(metricType.unit).toBe(
          SessionReplayBudgetMetricTypeUtil.getUnit(type),
        );
        expect(metricType.description).toBe(
          SessionReplayBudgetMetricTypeUtil.getDescription(type),
        );
        expect(metricType.services).toBeUndefined();
      }
    }
  });

  test("registers project by project, one at a time", async () => {
    pages = [
      [
        makeApplication({ id: applicationId(1), projectId: PROJECT_A }),
        makeApplication({ id: applicationId(2), projectId: PROJECT_B }),
      ],
    ];
    counters[dailyKey(PROJECT_A)] = 1000;
    counters[dailyKey(PROJECT_B)] = 1000;

    let inFlight: number = 0;
    let maxInFlight: number = 0;

    jest
      .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
      .mockImplementation(async (): Promise<void> => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        await Promise.resolve();
        inFlight--;
      });

    await sweep();

    expect(maxInFlight).toBe(1);
  });

  test("a catalog failure is logged; the rows stay written and the sweep goes on", async () => {
    pages = [[makeApplication({ id: applicationId(1), projectId: PROJECT_A })]];
    counters[dailyKey(PROJECT_A)] = 1000;

    jest
      .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
      .mockRejectedValue(new Error("catalog down") as never);

    const summary: SessionReplayBudgetSweepSummary = await sweep();

    expect(summary.stopReason).toBe("done");
    expect(summary.pagesFailed).toBe(0);
    expect(summary.rowsWritten).toBe(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("could not register"),
    );
  });

  describe("retention", () => {
    async function retentionWritten(): Promise<unknown> {
      pages = [
        [makeApplication({ id: applicationId(1), projectId: PROJECT_A })],
      ];
      counters[dailyKey(PROJECT_A)] = 1000;

      await sweep();

      return insertedRows()[0]!["retentionDate"];
    }

    function daysFromNow(days: number): string {
      return OneUptimeDate.toClickhouseDateTime(
        OneUptimeDate.addRemoveDays(new Date(NOW.getTime()), days),
      );
    }

    test("follows the monitor metric retention setting", async () => {
      const config: GlobalConfig = new GlobalConfig();
      config.monitorMetricRetentionInDays = 7;
      retentionConfig = config;

      expect(await retentionWritten()).toBe(daysFromNow(7));
    });

    test.each([undefined, 0, -3])(
      "defaults to 30 days when the setting is %p",
      async (value: number | undefined) => {
        const config: GlobalConfig = new GlobalConfig();

        if (value !== undefined) {
          config.monitorMetricRetentionInDays = value;
        }

        retentionConfig = config;

        expect(await retentionWritten()).toBe(daysFromNow(30));
      },
    );

    test("defaults to 30 days when there is no config row", async () => {
      retentionConfig = null;

      expect(await retentionWritten()).toBe(daysFromNow(30));
    });

    test("defaults to 30 days when the setting cannot be read", async () => {
      jest
        .spyOn(GlobalConfigService, "findOneBy")
        .mockRejectedValue(new Error("Postgres is down") as never);

      expect(await retentionWritten()).toBe(daysFromNow(30));
    });

    test("reads the setting once per sweep, however many pages it has", async () => {
      pages = [
        fullPage(1, PROJECT_A),
        [makeApplication({ id: applicationId(9999), projectId: PROJECT_A })],
      ];

      await sweep();

      expect(GlobalConfigService.findOneBy).toHaveBeenCalledTimes(1);
    });
  });

  test("warns once when a daily counter is more than twice the worker's limit", async () => {
    pages = [
      [
        makeApplication({ id: applicationId(1), projectId: PROJECT_A }),
        makeApplication({ id: applicationId(2), projectId: PROJECT_B }),
      ],
    ];
    counters[dailyKey(PROJECT_A)] = 5 * DAILY_LIMIT;
    counters[dailyKey(PROJECT_B)] = 3 * DAILY_LIMIT;

    const summary: SessionReplayBudgetSweepSummary = await sweep();

    expect(summary.dailyLimitMismatchSuspected).toBe(true);

    const mismatchWarnings: Array<unknown> = (
      logger.warn as unknown as jest.Mock
    ).mock.calls.filter((call: Array<unknown>) => {
      return String(call[0]).includes(
        "SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY",
      );
    });

    expect(mismatchWarnings).toHaveLength(1);
    // It still publishes what it knows.
    expect(summary.rowsWritten).toBe(4);
  });

  test("does not warn about the limit for an ordinary spent budget", async () => {
    pages = [[makeApplication({ id: applicationId(1), projectId: PROJECT_A })]];
    counters[dailyKey(PROJECT_A)] = DAILY_LIMIT + 2 * 1024 * 1024;

    const summary: SessionReplayBudgetSweepSummary = await sweep();

    expect(summary.dailyLimitMismatchSuspected).toBe(false);
  });

  test("skips rows it cannot key and keeps the rest", async () => {
    const orphan: RumApplication = new RumApplication();
    orphan.id = applicationId(1);

    pages = [
      [orphan, makeApplication({ id: applicationId(2), projectId: PROJECT_A })],
    ];
    counters[dailyKey(PROJECT_A)] = 1000;

    await sweep();

    expect(
      new Set(
        insertedRows().map((row: JSONObject) => {
          return row["primaryEntityId"];
        }),
      ),
    ).toEqual(new Set([applicationId(2).toString()]));
  });

  /*
   * The keys are built from the wall clock at read time, in UTC, and the
   * counters roll over with them: the last sweep of a month still reads that
   * day and that month, and the first sweep after midnight reads the new
   * ones (where nothing has been charged yet).
   */
  describe("UTC day and month boundaries", () => {
    function keysReadAt(now: Date): Array<string> {
      jest.useFakeTimers({ now: now, doNotFake: ["nextTick", "setImmediate"] });

      return [
        SessionReplayUsage.getDailyProjectByteKey(PROJECT_A),
        SessionReplayUsage.getMonthlyApplicationByteKey({
          projectId: PROJECT_A,
          rumApplicationId: applicationId(1),
        }),
      ];
    }

    test("the last second of September reads September's day and month", async () => {
      const expectedKeys: Array<string> = keysReadAt(
        new Date("2026-09-30T23:59:59.000Z"),
      );

      expect(expectedKeys).toEqual([
        `replay:rate:bytes:${PROJECT_A.toString()}:2026-09-30`,
        `replay:rate:bytes-month:${PROJECT_A.toString()}:${applicationId(1).toString()}:2026-09`,
      ]);

      pages = [
        [
          makeApplication({
            id: applicationId(1),
            projectId: PROJECT_A,
            monthlyBudgetInGB: 1,
          }),
        ],
      ];

      await sweep();

      expect(counterReads).toEqual([expectedKeys]);
    });

    test("the first second of October reads October's", async () => {
      const expectedKeys: Array<string> = keysReadAt(
        new Date("2026-10-01T00:00:00.000Z"),
      );

      expect(expectedKeys).toEqual([
        `replay:rate:bytes:${PROJECT_A.toString()}:2026-10-01`,
        `replay:rate:bytes-month:${PROJECT_A.toString()}:${applicationId(1).toString()}:2026-10`,
      ]);

      pages = [
        [
          makeApplication({
            id: applicationId(1),
            projectId: PROJECT_A,
            monthlyBudgetInGB: 1,
          }),
        ],
      ];

      await sweep();

      expect(counterReads).toEqual([expectedKeys]);
    });
  });
});
