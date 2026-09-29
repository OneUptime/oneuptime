import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Which databases the Recommendations tab offers its engine's monitors to.
 *
 * Every recommended database monitor reads one collector receiver's metrics
 * filtered on `oneuptime.database.server.id`. The row's collector heartbeat
 * (collectorLastSeenAt) is stamped by ANY batch ingest attributes to the
 * row — its logs, an exporter, a MongoDB Atlas database's `mongodbatlas`
 * receiver (engine MongoDB, metrics `mongodbatlas.*`). Offered on the
 * heartbeat alone, "Engine Metrics Stopped" would open a Critical incident
 * on a healthy Atlas cluster ten minutes after it is created, and never
 * clear. So the tab asks the telemetry — one row, the monitors' own filter
 * — whether any metric they read has arrived.
 */

const getListMock: MockFunction = getJestMockFunction();

// The arrow wrapper is load bearing: jest.mock is hoisted above the mock.
jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

import RecommendationResourceRegistry from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationResourceRegistry";
import {
  DATABASE_ENGINE_METRICS_LOOKBACK_DAYS,
  buildDatabaseEngineMetricsProbeQuery,
  fetchDatabaseEngineMetricsArrived,
  getDatabaseRecommendationMetricNames,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseEngineMetricsProbe";
import Metric from "../../../Models/AnalyticsModels/Metric";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationContext,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import {
  DatabaseAlertTemplate,
  getDatabaseAlertTemplates,
} from "../../../Types/Monitor/DatabaseAlertTemplates";
import ObjectID from "../../../Types/ObjectID";
import { keyForDatabaseServerRow } from "../../../Utils/Telemetry/EntityKey";

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const DATABASE_ID: string = "84858d6c-1111-4aaa-8bbb-000000000001";
const ID_ATTRIBUTE: string = "oneuptime.database.server.id";

interface ListArgs {
  modelType: unknown;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  limit: number;
}

function probes(): Array<ListArgs> {
  return getListMock.mock.calls.map((call: Array<unknown>): ListArgs => {
    return call[0] as ListArgs;
  });
}

// A database row as the Recommendations page fetches it.
function databaseRow(values: {
  dbSystem: string;
  collectorLastSeenAt?: Date | null;
}): DatabaseServer {
  const row: DatabaseServer = new DatabaseServer();
  row._id = DATABASE_ID;
  row.projectId = new ObjectID(PROJECT_ID);
  row.name = "orders";
  row.dbSystem = values.dbSystem;
  if (values.collectorLastSeenAt) {
    row.collectorLastSeenAt = values.collectorLastSeenAt;
  }
  return row;
}

async function loadDatabaseContext(
  row: DatabaseServer,
): Promise<MonitorRecommendationContext> {
  return RecommendationResourceRegistry.loadContext({
    resourceType: MonitorRecommendationResourceType.DatabaseServer,
    model: row,
  });
}

function templateNames(context: MonitorRecommendationContext): Array<string> {
  return MonitorRecommendationCatalog.getRecommendations(
    MonitorRecommendationResourceType.DatabaseServer,
    context,
  ).map((recommendation: MonitorRecommendation): string => {
    return recommendation.name;
  });
}

beforeEach(() => {
  getListMock.mockReset();
});

describe("a database's recommendations wait for the metrics they read", () => {
  test("a MongoDB Atlas database (heartbeat, but no mongodb.* metric) is offered nothing", async () => {
    // The mongodbatlas receiver's batches keep the heartbeat fresh...
    getListMock.mockResolvedValue({ data: [], count: 0 });

    const context: MonitorRecommendationContext = await loadDatabaseContext(
      databaseRow({ dbSystem: "mongodb", collectorLastSeenAt: new Date() }),
    );

    // ...but none of the metrics the MongoDB monitors read ever arrived.
    expect(context).toEqual({
      databaseEngine: "mongodb",
      databaseEngineMetricsReported: false,
    });
    expect(templateNames(context)).not.toContain("Engine Metrics Stopped");
    expect(templateNames(context)).toEqual([]);

    const note: string | undefined =
      RecommendationResourceRegistry.describeContext({
        resourceType: MonitorRecommendationResourceType.DatabaseServer,
        context,
      });
    expect(note).toContain("mongodb receiver");
    expect(note).toContain("does not count");
  });

  test("a database whose engine metrics do arrive is offered its engine's library", async () => {
    getListMock.mockResolvedValue({ data: [{ time: new Date() }], count: 1 });

    const context: MonitorRecommendationContext = await loadDatabaseContext(
      databaseRow({ dbSystem: "postgresql", collectorLastSeenAt: new Date() }),
    );

    expect(context.databaseEngineMetricsReported).toBe(true);
    expect(templateNames(context)).toContain("Engine Metrics Stopped");
    expect(templateNames(context)).toHaveLength(
      getDatabaseAlertTemplates("postgresql").length,
    );
  });

  test("the probe is one row, filtered exactly as the monitors filter", async () => {
    getListMock.mockResolvedValue({ data: [], count: 0 });

    await loadDatabaseContext(
      databaseRow({ dbSystem: "postgresql", collectorLastSeenAt: new Date() }),
    );

    expect(probes()).toHaveLength(1);
    const probe: ListArgs = probes()[0]!;
    expect(probe.modelType).toBe(Metric);
    expect(probe.limit).toBe(1);
    expect(Object.keys(probe.select)).toEqual(["time"]);
    expect((probe.query["projectId"] as ObjectID).toString()).toBe(PROJECT_ID);
    expect(probe.query["attributes"]).toEqual({ [ID_ATTRIBUTE]: DATABASE_ID });
    expect((probe.query["entityKeys"] as Includes).values).toEqual([
      keyForDatabaseServerRow(PROJECT_ID, DATABASE_ID),
    ]);
    expect((probe.query["name"] as Includes).values).toEqual(
      getDatabaseRecommendationMetricNames("postgresql"),
    );
  });

  test("a database with no heartbeat at all is not probed: nothing arrived", async () => {
    const context: MonitorRecommendationContext = await loadDatabaseContext(
      databaseRow({ dbSystem: "postgresql" }),
    );

    expect(context.databaseEngineMetricsReported).toBe(false);
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("an engine without a library is not probed", async () => {
    const context: MonitorRecommendationContext = await loadDatabaseContext(
      databaseRow({ dbSystem: "cassandra", collectorLastSeenAt: new Date() }),
    );

    expect(context).toEqual({
      databaseEngine: "cassandra",
      databaseEngineMetricsReported: true,
    });
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("a failed probe is not held against the database", async () => {
    getListMock.mockRejectedValue(new Error("ClickHouse is down"));

    const context: MonitorRecommendationContext = await loadDatabaseContext(
      databaseRow({ dbSystem: "redis", collectorLastSeenAt: new Date() }),
    );

    expect(context.databaseEngineMetricsReported).toBe(true);
    expect(templateNames(context).length).toBeGreaterThan(0);
  });

  test("resource types without a telemetry question load exactly what they read", async () => {
    expect(
      await RecommendationResourceRegistry.loadContext({
        resourceType: MonitorRecommendationResourceType.Kubernetes,
        model: null,
      }),
    ).toEqual({});
    expect(getListMock).not.toHaveBeenCalled();
  });
});

describe("the probe's query", () => {
  const now: Date = new Date("2026-09-24T10:00:00.000Z");

  test("every metric of every template of the engine, over the lookback window", () => {
    const query: Record<string, unknown> = buildDatabaseEngineMetricsProbeQuery(
      {
        projectId: new ObjectID(PROJECT_ID),
        databaseServerId: DATABASE_ID,
        engine: "mariadb",
        now,
      },
    )!;

    // MariaDB is monitored by the mysql receiver: MySQL's templates.
    const expected: Array<string> = [];
    for (const template of getDatabaseAlertTemplates(
      "mariadb",
    ) as Array<DatabaseAlertTemplate>) {
      for (const name of template.metricNames) {
        if (!expected.includes(name)) {
          expected.push(name);
        }
      }
    }
    expect(expected.length).toBeGreaterThan(0);
    expect((query["name"] as Includes).values).toEqual(expected);

    const window: InBetween<Date> = query["time"] as InBetween<Date>;
    expect(window.endValue).toEqual(now);
    expect(now.getTime() - window.startValue.getTime()).toBe(
      DATABASE_ENGINE_METRICS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    );
  });

  test("nothing to ask is no query and no request", async () => {
    for (const input of [
      { projectId: null, databaseServerId: DATABASE_ID, engine: "postgresql" },
      { projectId: PROJECT_ID, databaseServerId: "", engine: "postgresql" },
      { projectId: PROJECT_ID, databaseServerId: DATABASE_ID, engine: null },
      {
        projectId: PROJECT_ID,
        databaseServerId: DATABASE_ID,
        engine: "cassandra",
      },
    ]) {
      expect(
        buildDatabaseEngineMetricsProbeQuery({ ...input, now }),
      ).toBeNull();
      await expect(
        fetchDatabaseEngineMetricsArrived(input),
      ).resolves.toBeNull();
    }
    expect(getListMock).not.toHaveBeenCalled();
  });
});
