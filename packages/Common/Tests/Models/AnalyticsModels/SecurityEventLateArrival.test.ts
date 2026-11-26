import { describe, expect, test } from "@jest/globals";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsModels from "../../../Models/AnalyticsModels/Index";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import SecurityEventLateArrival from "../../../Models/AnalyticsModels/SecurityEventLateArrival";
import { AnalyticsServices } from "../../../Server/Services/Index";
import SecurityEventLateArrivalService from "../../../Server/Services/SecurityEventLateArrivalService";
import { isDetectionArrivalCandidate } from "../../../Server/Utils/SecurityEvent/DetectionArrivalRead";
import {
  applyClusterToMaterializedViewQuery,
  getStorageTableName,
} from "../../../Server/Utils/AnalyticsDatabase/ClusterConfig";
import AnalyticsTableEngine from "../../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn from "../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import ProductKey from "../../../Types/Product/ProductKey";
import { PRODUCT_RECORD_TABLES } from "../../../Types/Product/ProductRecordTables";
import {
  SECURITY_EVENT_LATE_ARRIVAL_IN_SECONDS,
  SECURITY_EVENT_LATE_ARRIVAL_KEPT_DAYS,
} from "../../../Types/SecurityEvent/SecurityEventLateArrival";

/*
 * THE COUNT OF EVENTS THAT ARRIVED TOO LATE FOR THE RULES (#10491).
 *
 * A view on every insert into the security events table keeps the rows
 * written more than a day after they happened - the complement, to the
 * second, of what a rule's run reads - per project, day they arrived and
 * source, in an AggregatingMergeTree that boot creates beside the events.
 */

const model: SecurityEventLateArrival = new SecurityEventLateArrival();
const viewQuery: string = model.materializedViews[0]?.query || "";

describe("the table", () => {
  test("is an aggregate target with no base columns", () => {
    expect(model.tableName).toBe("SecurityEventLateArrivalV1");
    expect(model.tableName).toBe(AnalyticsTableName.SecurityEventLateArrival);
    expect(model.tableEngine).toBe(AnalyticsTableEngine.AggregatingMergeTree);
    expect(model.getTableColumn("_id")).toBeNull();
    expect(model.getTableColumn("createdAt")).toBeNull();
  });

  test("is keyed by project, the day they arrived and the source; every other column is a state", () => {
    expect(model.sortKeys).toEqual([
      "projectId",
      "day",
      "primaryEntityId",
      "vendorName",
      "productName",
    ]);
    expect(model.primaryKeys).toEqual(model.sortKeys);

    const states: Array<[string, string | undefined]> = model.tableColumns
      .filter((column: AnalyticsTableColumn): boolean => {
        return !model.sortKeys.includes(column.key);
      })
      .map((column: AnalyticsTableColumn): [string, string | undefined] => {
        expect(column.type).toBe(TableColumnType.AggregateFunction);
        return [column.key, column.aggregateFunctionDefinition];
      });

    // Each state's type is the source column's: time is DateTime64(9), createdAt DateTime.
    expect(states).toEqual([
      ["eventCountState", "count"],
      ["happenedFromState", "min, DateTime64(9)"],
      ["happenedToState", "max, DateTime64(9)"],
      ["arrivedFromState", "min, DateTime"],
      ["arrivedToState", "max, DateTime"],
    ]);
  });

  test("the project is its tenant, and a source is the column a reader's scope narrows", () => {
    expect(model.getTableColumn("projectId")?.isTenantId).toBe(true);
    expect(model.getTableColumn("primaryEntityId")?.type).toBe(
      new SecurityEvent().getTableColumn("primaryEntityId")?.type,
    );
  });

  test("keeps a month, by the day they arrived", () => {
    expect(SECURITY_EVENT_LATE_ARRIVAL_KEPT_DAYS).toBe(30);
    expect(model.partitionKey).toBe("toYYYYMM(day)");
    expect(model.ttlExpression).toBe("day + INTERVAL 30 DAY");
  });

  test("has no CRUD API: it is read through its service alone", () => {
    expect(model.crudApiPath).toBeFalsy();
  });
});

describe("the view", () => {
  test("reads every insert into the security events table, into this one", () => {
    expect(model.materializedViews).toHaveLength(1);
    expect(model.materializedViews[0]?.name).toBe(
      "SecurityEventLateArrivalV1_mv",
    );
    expect(viewQuery).toContain(
      "CREATE MATERIALIZED VIEW IF NOT EXISTS SecurityEventLateArrivalV1_mv\nTO SecurityEventLateArrivalV1\nAS",
    );
    expect(viewQuery).toContain(`FROM ${new SecurityEvent().tableName}\n`);
  });

  test("keeps exactly the rows a rule's run does not read: written more than a day after they happened", () => {
    expect(viewQuery).toContain(
      "WHERE time < createdAt - toIntervalSecond(86400)\n",
    );
    expect(SECURITY_EVENT_LATE_ARRIVAL_IN_SECONDS).toBe(86400);

    // The run's own bound, as it reads: the same expression, the other side of it.
    const run: { query: string; query_params: Record<string, unknown> } =
      isDetectionArrivalCandidate({
        kind: "run",
        arrivedAfter: new Date("2026-11-19T00:00:00.000Z"),
        arrivedUntil: new Date("2026-11-19T00:01:00.000Z"),
        candidateStartTime: new Date("2026-11-18T00:00:00.000Z"),
        candidateEndTime: new Date("2026-11-19T01:01:00.000Z"),
      }) as unknown as { query: string; query_params: Record<string, unknown> };

    expect(run.query).toContain(
      "time >= createdAt - toIntervalSecond({p2:Int32})",
    );
    expect(run.query_params["p2"]).toBe(SECURITY_EVENT_LATE_ARRIVAL_IN_SECONDS);
  });

  test("on a cluster, it reads the events' local table into its own, the filter untouched", () => {
    const clustered: string = applyClusterToMaterializedViewQuery(viewQuery);

    expect(clustered).toContain(
      "CREATE MATERIALIZED VIEW IF NOT EXISTS SecurityEventLateArrivalV1_mv ON CLUSTER",
    );
    expect(clustered).toContain(
      `\nTO ${getStorageTableName(model.tableName)}\n`,
    );
    expect(clustered).toContain(
      `\nFROM ${getStorageTableName(new SecurityEvent().tableName)}\n`,
    );
    // Lower-case toDate and toIntervalSecond, and the states named From, are left as written.
    expect(clustered).toContain("toDate(createdAt) AS day");
    expect(clustered).toContain("minState(createdAt) AS arrivedFromState");
    expect(clustered).toContain(
      "WHERE time < createdAt - toIntervalSecond(86400)\n",
    );
  });

  test("groups by the table's key, and fills each state from its column", () => {
    expect(viewQuery).toContain("toDate(createdAt) AS day");
    expect(viewQuery).toContain("countState() AS eventCountState");
    expect(viewQuery).toContain("minState(time) AS happenedFromState");
    expect(viewQuery).toContain("maxState(time) AS happenedToState");
    expect(viewQuery).toContain("minState(createdAt) AS arrivedFromState");
    expect(viewQuery).toContain("maxState(createdAt) AS arrivedToState");
    expect(viewQuery).toMatch(
      /GROUP BY projectId, day, primaryEntityId, vendorName, productName$/,
    );
  });
});

describe("registration", () => {
  test("in the analytics models and the services boot creates tables and views for", () => {
    expect(
      AnalyticsModels.map((modelType: { new (): AnalyticsBaseModel }) => {
        return new modelType().tableName;
      }),
    ).toContain(model.tableName);
    expect(AnalyticsServices).toContain(SecurityEventLateArrivalService);
  });

  test("its view is created after the table it reads exists: every table is created before any view", () => {
    const tableNames: Array<string> = AnalyticsServices.map(
      (service: { model: AnalyticsBaseModel }): string => {
        return service.model.tableName;
      },
    );

    expect(tableNames).toContain(new SecurityEvent().tableName);
    expect(tableNames).toContain(model.tableName);
  });

  test("its records are Security Events'", () => {
    expect(PRODUCT_RECORD_TABLES[ProductKey.SecurityEvents]).toContain(
      AnalyticsTableName.SecurityEventLateArrival,
    );
  });
});
