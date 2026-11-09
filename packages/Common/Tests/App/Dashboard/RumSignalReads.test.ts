import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The two reads behind a RUM application's setup check that are not on its
 * own record (issue #5770): the newest exception it reported, and the
 * newest Web Vital in the past 30 days. Each must stay one cheap row on a
 * busy project - one row, newest first, through the indexes the comments
 * in RumSignalReads name - and a read that fails must throw, so the check
 * says "couldn't be checked" rather than "none".
 */

const getListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
let currentProjectId: string | null = "10000000-0000-4000-8000-000000000005";

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return analyticsGetListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return currentProjectId ? new ObjectIDType(currentProjectId) : null;
      },
    },
  };
});

import {
  fetchNewestRumExceptionAt,
  fetchNewestRumWebVitalAt,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/SetupCheck/RumSignalReads";
import { RUM_WEB_VITALS_LOOKBACK_DAYS } from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/SetupCheck/RumSignalDiagnosis";
import { getWebVitalMetricNames } from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/SetupCheck/RumSignalFacts";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import Metric from "../../../Models/AnalyticsModels/Metric";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";

const APP_ID: ObjectID = new ObjectID("84858d6c-5555-4aaa-8bbb-000000000005");
const DAY_MS: number = 24 * 60 * 60 * 1000;
const NOW: Date = new Date("2026-11-09T12:00:00.000Z");

interface ListArguments {
  modelType: unknown;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
  limit: number;
  skip: number;
}

function lastArguments(mock: MockFunction): ListArguments {
  const calls: Array<Array<unknown>> = mock.mock.calls;
  return calls[calls.length - 1]![0] as ListArguments;
}

function answer(
  mock: MockFunction,
  rows: Array<Record<string, unknown>>,
): void {
  mock.mockImplementation(async () => {
    return { data: rows, count: rows.length, skip: 0, limit: 1 };
  });
}

beforeEach(() => {
  getListMock.mockReset();
  analyticsGetListMock.mockReset();
  currentProjectId = "10000000-0000-4000-8000-000000000005";
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the newest exception an application reported", () => {
  test("is one row of its exceptions, newest first, ignoring rows that never saw one", async () => {
    answer(getListMock, [{ lastSeenAt: "2026-11-08T12:00:00.000Z" }]);

    await fetchNewestRumExceptionAt(APP_ID);

    const args: ListArguments = lastArguments(getListMock);
    expect(args.modelType).toBe(TelemetryException);
    expect(String(args.query["primaryEntityId"])).toBe(APP_ID.toString());
    expect(args.query["lastSeenAt"]).toBeInstanceOf(NotNull);
    expect(args.select).toEqual({ lastSeenAt: true });
    expect(args.sort).toEqual({ lastSeenAt: SortOrder.Descending });
    expect({ limit: args.limit, skip: args.skip }).toEqual({
      limit: 1,
      skip: 0,
    });
  });

  test("answers when it was last seen, or null when there is none", async () => {
    answer(getListMock, [{ lastSeenAt: "2026-11-08T12:00:00.000Z" }]);
    await expect(fetchNewestRumExceptionAt(APP_ID)).resolves.toEqual(
      new Date(NOW.getTime() - DAY_MS),
    );

    answer(getListMock, []);
    await expect(fetchNewestRumExceptionAt(APP_ID)).resolves.toBeNull();
  });

  test("a read that fails throws: never 'none'", async () => {
    getListMock.mockImplementation(async () => {
      throw new Error("Request failed with status 500");
    });

    await expect(fetchNewestRumExceptionAt(APP_ID)).rejects.toThrow(
      "Request failed with status 500",
    );
  });
});

describe("the newest Web Vital an application reported", () => {
  test("is one point of a vital's metric in the past 30 days, newest first, in this project", async () => {
    answer(analyticsGetListMock, [{ time: "2026-11-01T12:00:00.000Z" }]);

    await fetchNewestRumWebVitalAt({ rumApplicationId: APP_ID, now: NOW });

    const args: ListArguments = lastArguments(analyticsGetListMock);
    expect(args.modelType).toBe(Metric);
    expect(String(args.query["projectId"])).toBe(
      "10000000-0000-4000-8000-000000000005",
    );
    expect(String(args.query["primaryEntityId"])).toBe(APP_ID.toString());

    const names: Includes = args.query["name"] as Includes;
    expect(names).toBeInstanceOf(Includes);
    expect(names.values).toEqual(getWebVitalMetricNames());

    const window: InBetween<Date> = args.query["time"] as InBetween<Date>;
    expect(window).toBeInstanceOf(InBetween);
    expect(RUM_WEB_VITALS_LOOKBACK_DAYS).toBe(30);
    expect(new Date(window.startValue).getTime()).toBe(
      NOW.getTime() - 30 * DAY_MS,
    );
    expect(new Date(window.endValue).getTime()).toBe(NOW.getTime());

    expect(args.select).toEqual({ time: true });
    expect(args.sort).toEqual({ time: SortOrder.Descending });
    expect({ limit: args.limit, skip: args.skip }).toEqual({
      limit: 1,
      skip: 0,
    });
  });

  test("answers when it arrived, or null when none did", async () => {
    answer(analyticsGetListMock, [{ time: "2026-11-01T12:00:00.000Z" }]);
    await expect(
      fetchNewestRumWebVitalAt({ rumApplicationId: APP_ID, now: NOW }),
    ).resolves.toEqual(new Date(NOW.getTime() - 8 * DAY_MS));

    answer(analyticsGetListMock, []);
    await expect(
      fetchNewestRumWebVitalAt({ rumApplicationId: APP_ID, now: NOW }),
    ).resolves.toBeNull();
  });

  test("with no current project, it asks without one rather than for another's", async () => {
    currentProjectId = null;
    answer(analyticsGetListMock, []);

    await fetchNewestRumWebVitalAt({ rumApplicationId: APP_ID, now: NOW });

    expect("projectId" in lastArguments(analyticsGetListMock).query).toBe(
      false,
    );
  });

  test("a read that fails throws: never 'none'", async () => {
    analyticsGetListMock.mockImplementation(async () => {
      throw new Error("Request timed out");
    });

    await expect(
      fetchNewestRumWebVitalAt({ rumApplicationId: APP_ID, now: NOW }),
    ).rejects.toThrow("Request timed out");
  });
});
