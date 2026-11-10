import { ClickhouseAppInstance } from "../../../Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import "../../Server/TestingUtils/Init";
import AnalyticsModels from "../../../Models/AnalyticsModels/Index";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import RumSession from "../../../Models/AnalyticsModels/RumSession";
import RumProductAnalyticsEvent, {
  PRODUCT_ANALYTICS_EVENT_TTL,
} from "../../../Models/AnalyticsModels/RumProductAnalyticsEvent";
import { PRODUCT_ANALYTICS_READ_PERMISSIONS } from "../../../Models/AnalyticsModels/RumProductAnalyticsSession";
import RumProductAnalyticsEventService from "../../../Server/Services/RumProductAnalyticsEventService";
import AnalyticsTableColumn from "../../../Types/AnalyticsDatabase/TableColumn";
import AnalyticsTableEngine from "../../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import { PRODUCT_ANALYTICS_RETENTION_MONTHS } from "../../../Types/Rum/ProductAnalytics";
import { describe, expect, test } from "@jest/globals";

/*
 * The product analytics events table (issue #6444, part two): one row per
 * event a recorder sent. Boot-time schema reconciliation only ever adds,
 * so a sort key, partition, TTL or engine that is wrong ships for good:
 * the shape is pinned here, with the privacy promise the table makes - it
 * keeps who a person is only as the one-way key, never their reference.
 */

function fullText(statement: Statement): string {
  return statement.query + " :: " + JSON.stringify(statement.query_params);
}

describe("RumProductAnalyticsEvent", () => {
  const model: RumProductAnalyticsEvent = new RumProductAnalyticsEvent();

  test("is a plain MergeTree keyed by application, event and time, with no base columns", () => {
    expect(model.tableName).toBe(AnalyticsTableName.RumProductAnalyticsEvent);
    expect(model.tableName).toBe("RumProductAnalyticsEventV1");
    expect(model.tableEngine).toBe(AnalyticsTableEngine.MergeTree);
    expect(model.getTableColumn("_id")).toBeNull();
    expect(model.getTableColumn("createdAt")).toBeNull();
    expect(model.sortKeys).toEqual([
      "projectId",
      "rumApplicationId",
      "kind",
      "name",
      "time",
    ]);
    expect(model.primaryKeys).toEqual(model.sortKeys);
    expect(model.sortKeys).toContain(model.defaultSortColumn);
    expect(model.partitionKey).toBe("toYYYYMM(time)");
    /* A session's events on one shard. */
    expect(model.shardingKey).toBe("cityHash64(projectId, sessionId)");
    expect(model.materializedViews).toEqual([]);
  });

  test("creates its Replicated local table ON CLUSTER, monthly, kept 13 months and dropped by whole parts", () => {
    const statement: Statement = new StatementGenerator<AnalyticsBaseModel>({
      modelType: RumProductAnalyticsEvent,
      database: ClickhouseAppInstance,
    }).toTableCreateStatement();
    const ddl: string = fullText(statement);

    expect(statement.query).toContain("ENGINE = ReplicatedMergeTree");
    expect(statement.query).toContain("ON CLUSTER");
    expect(ddl).toContain(`${model.tableName}Local`);
    expect(statement.query).toContain("PARTITION BY (toYYYYMM(time))");
    expect(statement.query).toContain(`TTL ${PRODUCT_ANALYTICS_EVENT_TTL}`);
    expect(PRODUCT_ANALYTICS_EVENT_TTL).toBe(
      `toStartOfMonth(time) + INTERVAL ${PRODUCT_ANALYTICS_RETENTION_MONTHS} MONTH DELETE`,
    );
    expect(statement.query).toContain("ttl_only_drop_parts = 1");
  });

  test("the low-cardinality columns are LowCardinality, the maps are maps", () => {
    for (const key of [
      "kind",
      "deviceType",
      "browserName",
      "osName",
      "countryCode",
      "appVersion",
    ]) {
      expect(model.getTableColumn(key)?.isLowCardinality).toBe(true);
    }

    for (const key of ["properties", "userProperties"]) {
      expect(model.getTableColumn(key)?.type).toBe(
        TableColumnType.MapStringString,
      );
    }

    expect(model.getTableColumn("time")?.type).toBe(TableColumnType.DateTime64);
  });

  test("the people-finding columns carry bloom filters", () => {
    for (const key of ["sessionId", "identifiedUserKey", "visitorId"]) {
      expect(model.getTableColumn(key)?.skipIndex?.type).toBeDefined();
    }
  });

  test("keeps no name: no reference, no label, no address", () => {
    for (const key of [
      "identifiedUserLabel",
      "identifiedUserRef",
      "userRef",
      "identifiedUserTraits",
      "clientIp",
      "url",
    ]) {
      expect(model.getTableColumn(key)).toBeNull();
    }
  });

  test("is read like the session list, on session replay's plan, and has no generic API", () => {
    const listPermissions: Array<string> = [
      ...(new RumSession().accessControl?.read || []),
    ].sort();

    expect([...(model.accessControl?.read || [])].sort()).toEqual(
      listPermissions,
    );
    expect([...PRODUCT_ANALYTICS_READ_PERMISSIONS].sort()).toEqual(
      listPermissions,
    );
    expect(model.accessControl?.create).toEqual([]);
    expect(model.accessControl?.update).toEqual([]);
    expect(model.accessControl?.delete).toEqual([]);

    for (const column of model.tableColumns) {
      expect([...(column.accessControl?.read || [])].sort()).toEqual(
        listPermissions,
      );
      expect(column.accessControl?.create).toEqual([]);
    }

    expect(model.getReadBillingPlan()).toBe(
      new RumSession().getReadBillingPlan(),
    );
    expect(model.crudApiPath).toBeUndefined();
    expect(model.enableMCP).toBe(false);
  });

  test("is registered, with a service on its own table", () => {
    expect(
      AnalyticsModels.some(
        (registered: { new (): AnalyticsBaseModel }): boolean => {
          return registered === RumProductAnalyticsEvent;
        },
      ),
    ).toBe(true);
    expect(RumProductAnalyticsEventService.model.tableName).toBe(
      model.tableName,
    );
  });

  test("every column is required, so a row never holds a null", () => {
    for (const column of model.tableColumns) {
      expect(
        `${column.key}: ${String((column as AnalyticsTableColumn).required)}`,
      ).toBe(`${column.key}: true`);
    }
  });
});
