import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import MonitorRecommendationCoverageApi from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/MonitorRecommendationCoverageApi";
import { serveCoverageFrom } from "./MonitorCoverageServer";
import { answerCoverageFromModelApi } from "./MonitorCoverageAnswer";
import { getJestSpyOn } from "../../Spy";

/*
 * THE COVERAGE ROUTE, ANSWERED IN A SUITE THAT ANSWERS NOTHING (#11170).
 *
 * jest.setup.ts hands the Dashboard's coverage client
 * answerCoverageFromModelApi: a page asks which recommended monitors exist,
 * and is told from the monitors the suite's ModelAPI stands in for, read as
 * the pages read them before they asked the server - with no request, which
 * the network rule would fail. These pin that, and that a suite's own
 * answer still wins.
 */

const HOST: string = "web-1";

const ARGS: MonitorRecommendationArgs = {
  resourceIdentifier: HOST,
  onlineMonitorStatusId: ObjectID.getZeroObjectID(),
  offlineMonitorStatusId: ObjectID.getZeroObjectID(),
  defaultIncidentSeverityId: ObjectID.getZeroObjectID(),
  defaultAlertSeverityId: ObjectID.getZeroObjectID(),
  monitorName: HOST,
};

const RECOMMENDATIONS: Array<MonitorRecommendation> =
  MonitorRecommendationCatalog.getRecommendations(
    MonitorRecommendationResourceType.Host,
  );

const FIRST: MonitorRecommendation = RECOMMENDATIONS[0]!;

const MONITOR_ID: string = "6a000000-0000-4000-8000-000000000001";
const OTHER_MONITOR_ID: string = "6a000000-0000-4000-8000-000000000002";

// A monitor saved as Create on the Recommendations page saves it.
function monitorFor(
  recommendation: MonitorRecommendation,
  monitorId: string,
): Monitor {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [recommendation.getMonitorStep(ARGS)],
    defaultMonitorStatusId: ObjectID.getZeroObjectID(),
  };

  const monitor: Monitor = new Monitor();
  monitor._id = monitorId;
  monitor.name = `${HOST} - ${recommendation.name}`;
  monitor.monitorType = recommendation.monitorType;
  monitor.monitorSteps = monitorSteps;
  return monitor;
}

// The suite's ModelAPI, answering Monitor lists with `monitors`.
function standInMonitors(monitors: Array<Monitor>): jest.SpyInstance<any, any> {
  return getJestSpyOn(ModelAPI, "getList").mockImplementation((async (request: {
    modelType: new () => { tableName?: string };
  }): Promise<unknown> => {
    const modelName: string = new request.modelType().tableName || "";

    return modelName === "Monitor"
      ? { data: monitors, count: monitors.length }
      : { data: [], count: 0 };
  }) as never);
}

// A request would leave the suite: fail on one.
function refusePosts(): jest.SpyInstance<any, any> {
  return getJestSpyOn(API, "post").mockImplementation(
    (async (): Promise<unknown> => {
      throw new Error("The coverage client sent a request.");
    }) as never,
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a suite that answers no coverage of its own", () => {
  test("is told which recommendations its ModelAPI's monitors cover, with no request", async () => {
    standInMonitors([monitorFor(FIRST, MONITOR_ID)]);
    const post: jest.SpyInstance<any, any> = refusePosts();

    const covered: Map<string, ObjectID> =
      await MonitorRecommendationCoverageApi.getCoveredRecommendationMonitorIds(
        { recommendations: RECOMMENDATIONS, args: ARGS },
      );

    expect(
      Array.from(covered.entries()).map(
        ([key, monitorId]: [string, ObjectID]): [string, string] => {
          return [key, monitorId.toString()];
        },
      ),
    ).toEqual([[FIRST.recommendationId, MONITOR_ID]]);
    expect(post).not.toHaveBeenCalled();
  });

  test("with no monitors, nothing is covered: every recommendation reads as not created yet", async () => {
    standInMonitors([]);
    refusePosts();

    const covered: Map<string, ObjectID> =
      await MonitorRecommendationCoverageApi.getCoveredRecommendationMonitorIds(
        { recommendations: RECOMMENDATIONS, args: ARGS },
      );

    expect(covered.size).toBe(0);
  });

  test("reads the monitors as the pages read them before they asked the server", async () => {
    const list: jest.SpyInstance<any, any> = standInMonitors([]);

    await MonitorRecommendationCoverageApi.getCoveredRecommendationMonitorIds({
      recommendations: RECOMMENDATIONS.filter(
        (recommendation: MonitorRecommendation): boolean => {
          return recommendation.monitorType === FIRST.monitorType;
        },
      ),
      args: ARGS,
    });

    expect(list).toHaveBeenCalledTimes(1);
    expect(list.mock.calls[0]![0]).toEqual({
      modelType: Monitor,
      query: { monitorType: FIRST.monitorType },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: { name: true, monitorSteps: true },
      sort: { name: SortOrder.Ascending },
    });
  });

  test("questions of two monitor types are read in one list for each, as the Recommendations page read them", async () => {
    const list: jest.SpyInstance<any, any> = standInMonitors([]);

    await answerCoverageFromModelApi([
      { key: "a", monitorType: MonitorType.Host, fingerprints: ["x"] },
      { key: "b", monitorType: MonitorType.Logs, fingerprints: ["y"] },
      { key: "c", monitorType: MonitorType.Host, fingerprints: ["z"] },
    ]);

    expect(
      list.mock.calls.map((call: Array<unknown>): unknown => {
        return (call[0] as { query: { monitorType: unknown } }).query
          .monitorType;
      }),
    ).toEqual([MonitorType.Host, MonitorType.Logs]);
  });

  test("a list that answers every type with every monitor still covers each recommendation once, by its own type", async () => {
    standInMonitors([monitorFor(FIRST, MONITOR_ID)]);

    const covered: Map<string, ObjectID> =
      await MonitorRecommendationCoverageApi.getCoveredRecommendationMonitorIds(
        { recommendations: RECOMMENDATIONS, args: ARGS },
      );

    expect(Array.from(covered.keys())).toEqual([FIRST.recommendationId]);
  });

  test("no questions: no read, and nothing covered", async () => {
    const list: jest.SpyInstance<any, any> = standInMonitors([
      monitorFor(FIRST, MONITOR_ID),
    ]);

    expect((await answerCoverageFromModelApi([])).size).toBe(0);
    expect(list).not.toHaveBeenCalled();
  });

  test("a monitor of another type covers nothing of this one", async () => {
    const other: Monitor = monitorFor(FIRST, OTHER_MONITOR_ID);
    other.monitorType =
      FIRST.monitorType === MonitorType.Logs
        ? MonitorType.Metrics
        : MonitorType.Logs;
    standInMonitors([other]);

    const covered: Map<string, ObjectID> =
      await MonitorRecommendationCoverageApi.getCoveredRecommendationMonitorIds(
        { recommendations: [FIRST], args: ARGS },
      );

    expect(covered.size).toBe(0);
  });
});

describe("a suite that answers coverage itself", () => {
  test("is answered by its own answer, and the stand-in is back once it is restored", async () => {
    const list: jest.SpyInstance<any, any> = standInMonitors([
      monitorFor(FIRST, MONITOR_ID),
    ]);
    const served: SpyInstance<
      typeof MonitorRecommendationCoverageApi.findCoveringMonitors
    > = serveCoverageFrom((): Array<Monitor> => {
      return [];
    });

    const answered: Map<string, ObjectID> =
      await MonitorRecommendationCoverageApi.getCoveredRecommendationMonitorIds(
        { recommendations: RECOMMENDATIONS, args: ARGS },
      );

    expect(answered.size).toBe(0);
    expect(served).toHaveBeenCalledTimes(1);
    expect(list).not.toHaveBeenCalled();

    served.mockRestore();

    const fromModelApi: Map<string, ObjectID> =
      await MonitorRecommendationCoverageApi.getCoveredRecommendationMonitorIds(
        { recommendations: RECOMMENDATIONS, args: ARGS },
      );

    expect(fromModelApi.get(FIRST.recommendationId)?.toString()).toBe(
      MONITOR_ID,
    );
  });
});
