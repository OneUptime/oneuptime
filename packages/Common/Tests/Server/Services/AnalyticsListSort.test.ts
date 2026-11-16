import "../TestingUtils/Init";
import AnalyticsModels from "../../../Models/AnalyticsModels/Index";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "../../../Models/AnalyticsModels/Log";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import Span from "../../../Models/AnalyticsModels/Span";
import AnalyticsDatabaseService from "../../../Server/Services/AnalyticsDatabaseService";
import LogService from "../../../Server/Services/LogService";
import { ClickhouseAppInstance } from "../../../Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import logger from "../../../Server/Utils/Logger";
import AnalyticsTableColumn from "../../../Types/AnalyticsDatabase/TableColumn";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import {
  DashboardWidgetSortDirection,
  DashboardWidgetSortChoice,
} from "../../../Types/Dashboard/DashboardWidgetSort";
import BadDataException from "../../../Types/Exception/BadDataException";
import {
  DashboardWidgetListReadStep,
  DashboardWidgetListSortColumn,
  DashboardWidgetListSortSpec,
  getDashboardWidgetListReadSteps,
  getDashboardWidgetSortSpec,
} from "../../../Utils/Dashboard/DashboardWidgetSorts";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A TELEMETRY LIST'S SORT (#8141).
 *
 * Logs, spans, metrics, exceptions and every other ClickHouse table are
 * ordered by StatementGenerator.toSortStatement, the one place each of
 * their reads - a list, an aggregate, a metric's own builders - writes its
 * ORDER BY. It knew two directions; anything else - "desc", -1,
 * { direction, nulls } - it wrote into the SQL as the word "undefined", and
 * ClickHouse failed the read as a server fault. Held here, with no
 * database:
 *
 *  - every column of every telemetry model still sorts both ways;
 *  - another direction is refused as bad data before any SQL is made, in a
 *    list and in an aggregate;
 *  - every order a dashboard's telemetry widgets read passes.
 */

type AnalyticsModelType = { new (): AnalyticsBaseModel };

const generatorFor: (
  modelType: AnalyticsModelType,
) => StatementGenerator<AnalyticsBaseModel> = (
  modelType: AnalyticsModelType,
): StatementGenerator<AnalyticsBaseModel> => {
  return new StatementGenerator<AnalyticsBaseModel>({
    modelType: modelType,
    database: ClickhouseAppInstance,
  });
};

beforeEach(() => {
  jest.spyOn(logger, "debug").mockImplementation(() => {
    return undefined!;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("every column of every telemetry model sorts both ways, as before", () => {
  test("ASC and DESC build an ORDER BY term for each", () => {
    let columns: number = 0;

    for (const modelType of AnalyticsModels as Array<AnalyticsModelType>) {
      const generator: StatementGenerator<AnalyticsBaseModel> =
        generatorFor(modelType);

      for (const column of new modelType().getTableColumns()) {
        for (const order of [SortOrder.Ascending, SortOrder.Descending]) {
          columns++;

          expect(
            generator.toSortStatement({ [column.key]: order } as never).query,
          ).toBe(`{p0:Identifier} ${order}`);
        }
      }
    }

    expect(columns).toBeGreaterThan(500);
  });
});

describe("a direction a telemetry list does not take is bad data, refused before any SQL", () => {
  test.each([
    ["a lower-case direction", { time: "desc" }],
    ["-1", { time: -1 }],
    [
      "descending with rows that have no value last",
      {
        time: { direction: "DESC", nulls: "LAST" },
      },
    ],
    ["a word for a direction", { time: "descending" }],
  ] as Array<[string, Record<string, unknown>]>)(
    "a list of logs sorted with %s",
    (_name: string, sort: Record<string, unknown>) => {
      expect(() => {
        return LogService.toFindStatement({
          query: {},
          select: { body: true },
          sort: sort as never,
          limit: 10,
          skip: 0,
          props: { isRoot: true },
        } as never);
      }).toThrow(BadDataException);
    },
  );

  test("the refusal says what to send", () => {
    expect(() => {
      return LogService.toFindStatement({
        query: {},
        select: { body: true },
        sort: { time: "desc" } as never,
        limit: 10,
        skip: 0,
        props: { isRoot: true },
      } as never);
    }).toThrow(
      'Logs cannot be sorted by "time" with "desc". Sort it "ASC" or "DESC".',
    );
  });

  test("a column logs do not have is refused, naming the column they sort by", () => {
    expect(() => {
      return LogService.toFindStatement({
        query: {},
        select: { body: true },
        sort: { nope: SortOrder.Ascending } as never,
        limit: 10,
        skip: 0,
        props: { isRoot: true },
      } as never);
    }).toThrow(
      `Logs have no column "nope" to sort by. Sort by one of their columns, as in { "${new Log().defaultSortColumn}": "DESC" }.`,
    );
  });

  test("an aggregate of logs sorted with a direction it does not take", () => {
    expect(() => {
      return (
        LogService as unknown as AnalyticsDatabaseService<Log>
      ).toAggregateStatement({
        aggregationType: AggregationType.Count,
        aggregateColumnName: "time",
        aggregationTimestampColumnName: "time",
        startTimestamp: new Date("2024-01-01"),
        endTimestamp: new Date("2024-01-02"),
        query: {},
        sort: { time: "desc" },
        limit: 10,
        skip: 0,
        props: { isRoot: true },
      } as never);
    }).toThrow(BadDataException);
  });

  test("a list of logs sorted ASC or DESC builds as before", () => {
    for (const order of [SortOrder.Ascending, SortOrder.Descending]) {
      const query: string = LogService.toFindStatement({
        query: {},
        select: { body: true },
        sort: { time: order } as never,
        limit: 10,
        skip: 0,
        props: { isRoot: true },
      } as never).statement.query;

      expect(query).toContain(`ORDER BY {p`);
      expect(query).not.toContain("undefined");
    }
  });
});

describe("every order a dashboard's telemetry widgets read passes", () => {
  test.each([
    [DashboardComponentType.TraceList, Span],
    [DashboardComponentType.SecurityEventsList, SecurityEvent],
  ] as Array<[DashboardComponentType, AnalyticsModelType]>)(
    "%s, by every column, both ways",
    (componentType: DashboardComponentType, modelType: AnalyticsModelType) => {
      const spec: DashboardWidgetListSortSpec | null =
        getDashboardWidgetSortSpec(componentType);

      expect(spec).not.toBeNull();

      const generator: StatementGenerator<AnalyticsBaseModel> =
        generatorFor(modelType);

      for (const column of (spec as DashboardWidgetListSortSpec).columns) {
        for (const direction of [
          DashboardWidgetSortDirection.Ascending,
          DashboardWidgetSortDirection.Descending,
        ]) {
          const choice: DashboardWidgetSortChoice = {
            column: (column as DashboardWidgetListSortColumn).key,
            direction: direction,
          };

          for (const step of getDashboardWidgetListReadSteps({
            componentType: componentType,
            choice: choice,
            query: {},
          }) as Array<DashboardWidgetListReadStep>) {
            expect(() => {
              return generator.toSortStatement(step.sort as never);
            }).not.toThrow();
          }
        }
      }
    },
  );
});

describe("the columns a telemetry list sorts by are its model's", () => {
  test("every analytics model names a default sort column it has", () => {
    for (const modelType of AnalyticsModels as Array<AnalyticsModelType>) {
      const model: AnalyticsBaseModel = new modelType();

      expect(
        model.getTableColumns().some((column: AnalyticsTableColumn) => {
          return column.key === model.defaultSortColumn;
        }),
      ).toBe(true);
    }
  });
});
