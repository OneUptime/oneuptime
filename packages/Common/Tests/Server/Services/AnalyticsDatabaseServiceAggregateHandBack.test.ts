import AnalyticsDatabaseService from "../../../Server/Services/AnalyticsDatabaseService";
import logger from "../../../Server/Utils/Logger";
import EventLoop from "../../../Server/Utils/EventLoop";
import "../TestingUtils/Init";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Route from "../../../Types/API/Route";
import AnalyticsTableEngine from "../../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableColumn from "../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import OneUptimeDate from "../../../Types/Date";
import GenericObject from "../../../Types/GenericObject";
import ObjectID from "../../../Types/ObjectID";
import ModelPermission from "../../../Server/Types/AnalyticsDatabase/ModelPermission";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * AN AGGREGATE READ OF THOUSANDS OF ROWS HANDS THE EVENT LOOP BACK
 * (issue #10108).
 *
 * A grouped Metrics monitor's read is a row per series and bucket: 40,000
 * rows a query for the #10108 fleet, each turned into an aggregated row (its
 * time parsed, its value read as a number) in one loop that held the event
 * loop throughout. The loop now hands it back once the work since the last
 * hand-back took its budget (EventLoopBudget), and its rows are as before.
 * The clock is moved by hand, so nothing here depends on the machine.
 */

class MetricLikeModel extends AnalyticsBaseModel {
  public constructor() {
    super({
      tableName: "MetricLike",
      singularName: "Metric",
      pluralName: "Metrics",
      tableColumns: [
        new AnalyticsTableColumn({
          key: "projectId",
          title: "Project",
          description: "The project",
          required: true,
          type: TableColumnType.ObjectID,
        }),
        new AnalyticsTableColumn({
          key: "time",
          title: "Time",
          description: "When",
          required: true,
          type: TableColumnType.DateTime64,
        }),
        new AnalyticsTableColumn({
          key: "value",
          title: "Value",
          description: "A number",
          required: false,
          type: TableColumnType.Number,
        }),
      ],
      crudApiPath: new Route("metric-like"),
      primaryKeys: ["projectId", "time"],
      sortKeys: ["projectId", "time"],
      partitionKey: "projectId",
      tableEngine: AnalyticsTableEngine.MergeTree,
    });
  }
}

const PROJECT_ID: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000010108",
);

const ROWS: number = 5_000;

// ClickHouse's answer: a row per minute, the value as text now and then.
function answerRows(): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];

  for (let index: number = 0; index < ROWS; index++) {
    const minute: number = index % 60;
    rows.push({
      time: `2026-11-17 10:${String(minute).padStart(2, "0")}:00`,
      value: index % 3 === 0 ? String(index / 4) : index / 4,
    });
  }

  // A row without a time is left out, as before.
  rows.push({ value: 1 });

  return rows;
}

let service: AnalyticsDatabaseService<MetricLikeModel>;
let handBacks: number;
let now: number;

beforeEach(() => {
  service = new AnalyticsDatabaseService({ modelType: MetricLikeModel });
  handBacks = 0;
  now = 0;

  const body: string = JSON.stringify({ data: answerRows() });

  (service as unknown as { databaseClient: unknown }).databaseClient = {
    query: async (): Promise<unknown> => {
      return {
        query_id: "query-10108",
        response_headers: {},
        json: async (): Promise<unknown> => {
          return JSON.parse(body);
        },
        text: async (): Promise<string> => {
          return body;
        },
      };
    },
  };

  jest
    .spyOn(ModelPermission, "checkReadPermission")
    .mockImplementation((_modelType: unknown, query: unknown) => {
      return Promise.resolve({ query, select: null } as never);
    });
  jest.spyOn(logger, "debug").mockImplementation(() => {
    return undefined!;
  });

  // Each look at the clock: half a millisecond of work.
  jest.spyOn(EventLoop, "now").mockImplementation((): number => {
    now += 0.5;
    return now;
  });
  jest
    .spyOn(EventLoop, "yieldToEventLoop")
    .mockImplementation(async (): Promise<void> => {
      handBacks++;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function aggregate(): Promise<AggregatedResult> {
  return service.aggregateBy({
    query: { projectId: PROJECT_ID } as GenericObject,
    aggregationType: AggregationType.Max,
    aggregateColumnName: "value" as keyof MetricLikeModel,
    aggregationTimestampColumnName: "time" as keyof MetricLikeModel,
    startTimestamp: new Date("2026-11-17T10:00:00.000Z"),
    endTimestamp: new Date("2026-11-17T11:00:00.000Z"),
    limit: 50_000,
    skip: 0,
    props: { isRoot: true },
  });
}

describe("AnalyticsDatabaseService.aggregateBy over thousands of rows", () => {
  test("hands the event loop back as it reads the rows, about every 20 ms of work", async () => {
    await aggregate();

    // 5,000 rows at half a millisecond: some 2.5 s of work.
    expect(handBacks).toBeGreaterThanOrEqual(100);
    expect(handBacks).toBeLessThan(ROWS);
  });

  test("reads every row as before: its time, its value as a number", async () => {
    const result: AggregatedResult = await aggregate();

    expect(result.data).toHaveLength(ROWS);

    result.data.forEach((row: AggregatedModel, index: number) => {
      expect(row.value).toBe(index / 4);
      expect(row.timestamp).toEqual(
        OneUptimeDate.fromString(
          `2026-11-17 10:${String(index % 60).padStart(2, "0")}:00`,
        ),
      );
    });
  });
});
