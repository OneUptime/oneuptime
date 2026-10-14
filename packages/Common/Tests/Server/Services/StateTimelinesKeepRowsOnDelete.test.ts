import Models from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BaseService from "../../../Server/Services/BaseService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import Services from "../../../Server/Services/Index";
import { MONITOR_UPTIME_HISTORY_DAYS } from "../../../Types/Monitor/MonitorUptimeSummary";
import {
  KEPT_STATUS_HISTORY_DAYS,
  ROWS_KEPT_ON_DELETE_BY_QUERY,
} from "../../../Types/StateTimeline/RowsKeptOnDelete";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { getMetadataArgsStorage } from "typeorm";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";

/*
 * EVERY STATE TIMELINE KEEPS WHAT ITS READERS DRAW FROM A DELETE BY QUERY,
 * AND THE KEPT HISTORY COVERS EVERY READER.
 *
 * Types/StateTimeline/RowsKeptOnDelete lists the state timelines, and
 * DatabaseService narrows a delete by query of each to leave its records'
 * current rows (and a status timeline's last 90 days) - but only for a
 * service that declares the rule. This holds the list, the services and the
 * models together, so a new timeline, or a service that forgets the rule,
 * fails here rather than on a status page:
 *
 *   - every listed table's service declares the rule of its own table, and
 *     no other service declares one;
 *   - every model named like a state timeline is listed;
 *   - every listed table has the columns the rule reads, and the
 *     (record, startsAt) index each row's probe runs on;
 *   - the history kept in full is at least as long as any history a status
 *     page, a monitor's overview or a network site's page draws.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");

// What names a state timeline: one row per state a record has been in.
const STATE_TIMELINE_SUFFIXES: Array<string> = [
  "StateTimeline",
  "StatusTimeline",
];

const databaseServices: Array<DatabaseService<BaseModel>> = (
  Services as Array<BaseService>
).filter((service: BaseService): boolean => {
  return service instanceof DatabaseService;
}) as Array<DatabaseService<BaseModel>>;

function serviceOf(tableName: string): DatabaseService<BaseModel> | undefined {
  return databaseServices.find(
    (service: DatabaseService<BaseModel>): boolean => {
      return service.getModel().tableName === tableName;
    },
  );
}

function modelTypeOf(tableName: string): (new () => BaseModel) | undefined {
  return (Models as Array<new () => BaseModel>).find(
    (modelType: new () => BaseModel): boolean => {
      return new modelType().tableName === tableName;
    },
  );
}

// The whole number written right after `marker` in a source file.
const LEADING_NUMBER: RegExp = /^\s*(\d+)/;

function numberAfter(relativePath: string, marker: string): number {
  const source: string = fs.readFileSync(
    path.join(REPOSITORY_ROOT, relativePath),
    "utf8",
  );
  const at: number = source.indexOf(marker);

  expect({ relativePath, marker, found: at >= 0 }).toEqual({
    relativePath,
    marker,
    found: true,
  });

  const match: RegExpMatchArray | null = source
    .slice(at + marker.length, at + marker.length + 40)
    .match(LEADING_NUMBER);

  expect(match).not.toBeNull();

  return Number(match![1]);
}

describe("the services of the state timelines", () => {
  test.each(Object.keys(ROWS_KEPT_ON_DELETE_BY_QUERY))(
    "%s's service declares its own table's rule",
    (tableName: string) => {
      const service: DatabaseService<BaseModel> | undefined =
        serviceOf(tableName);

      expect(service).toBeDefined();
      expect(service!.getRowsKeptOnDeleteByQuery()?.tableName).toBe(
        tableName,
      );
    },
  );

  test("no other service keeps rows from a delete", () => {
    const others: Array<string> = databaseServices
      .filter((service: DatabaseService<BaseModel>): boolean => {
        return (
          service.getRowsKeptOnDeleteByQuery() !== null &&
          !Object.prototype.hasOwnProperty.call(
            ROWS_KEPT_ON_DELETE_BY_QUERY,
            service.getModel().tableName || "",
          )
        );
      })
      .map((service: DatabaseService<BaseModel>): string => {
        return service.getModel().tableName || "";
      });

    expect(others).toEqual([]);
  });
});

describe("the models of the state timelines", () => {
  test("every model named like a state timeline is listed", () => {
    const named: Array<string> = (Models as Array<new () => BaseModel>)
      .map((modelType: new () => BaseModel): string => {
        return new modelType().tableName || "";
      })
      .filter((tableName: string): boolean => {
        return STATE_TIMELINE_SUFFIXES.some((suffix: string): boolean => {
          return tableName.endsWith(suffix);
        });
      })
      .sort();

    expect(named).toEqual(Object.keys(ROWS_KEPT_ON_DELETE_BY_QUERY).sort());
  });

  test.each(Object.keys(ROWS_KEPT_ON_DELETE_BY_QUERY))(
    "%s has the columns the rule reads, and the index each row's probe runs on",
    (tableName: string) => {
      const modelType: (new () => BaseModel) | undefined =
        modelTypeOf(tableName);

      expect(modelType).toBeDefined();

      const model: BaseModel = new modelType!();
      const parentColumn: string =
        ROWS_KEPT_ON_DELETE_BY_QUERY[tableName]!.parentColumn;

      for (const column of [parentColumn, "startsAt", "endsAt"]) {
        expect({ tableName, column, isColumn: model.isTableColumn(column) })
          .toEqual({ tableName, column, isColumn: true });
      }

      const indexes: Array<IndexMetadataArgs> =
        getMetadataArgsStorage().indices.filter(
          (index: IndexMetadataArgs): boolean => {
            return index.target === modelType;
          },
        );

      expect(
        indexes.some((index: IndexMetadataArgs): boolean => {
          const columns: unknown = index.columns;

          return (
            Array.isArray(columns) &&
            columns[0] === parentColumn &&
            columns.includes("startsAt")
          );
        }),
      ).toBe(true);
    },
  );
});

describe("the history a status timeline keeps in full", () => {
  test("is as long as the monitor overview's bars", () => {
    expect(KEPT_STATUS_HISTORY_DAYS).toBeGreaterThanOrEqual(
      MONITOR_UPTIME_HISTORY_DAYS,
    );
  });

  test("is as long as the longest uptime history a status page shows or answers", () => {
    // Show the last ... days is clamped here.
    expect(KEPT_STATUS_HISTORY_DAYS).toBeGreaterThanOrEqual(
      numberAfter(
        "packages/Common/Server/API/StatusPageAPI.ts",
        "if (uptimeHistoryDays >",
      ),
    );

    // And the uptime endpoint refuses a longer range.
    expect(KEPT_STATUS_HISTORY_DAYS).toBeGreaterThanOrEqual(
      numberAfter(
        "packages/Common/Server/API/StatusPageAPI.ts",
        "OneUptimeDate.getDaysBetweenTwoDatesInclusive(startDate, endDate) >",
      ),
    );
  });

  test("is as long as the longest window a network site's Status Timeline page shows", () => {
    const source: string = fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        "packages/App/FeatureSet/Dashboard/src/Pages/NetworkSite/View/StatusTimeline.tsx",
      ),
      "utf8",
    );
    const marker: string = "const UPTIME_WINDOWS_IN_DAYS: Array<number> = [";
    const at: number = source.indexOf(marker);

    expect(at).toBeGreaterThanOrEqual(0);

    const windows: Array<number> = source
      .slice(at + marker.length, source.indexOf("]", at))
      .split(",")
      .map((day: string): number => {
        return Number(day.trim());
      });

    expect(windows.length).toBeGreaterThan(0);
    expect(KEPT_STATUS_HISTORY_DAYS).toBeGreaterThanOrEqual(
      Math.max(...windows),
    );
  });
});
