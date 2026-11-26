import { describe, expect, test } from "@jest/globals";
import {
  RUM_CLIENT_ROW_ATTRIBUTE_KEY,
  notRumClientRowSql,
} from "../../../../Server/Utils/Telemetry/RumClientRows";
import { buildDatabaseEndpointSql } from "../../../../Server/Utils/Telemetry/DatabaseEndpointDiscovery";
import {
  buildMessagingMetricDiscoverySql,
  buildMessagingSpanDiscoverySql,
} from "../../../../Server/Utils/Telemetry/MessageQueueDiscovery";
import { RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE } from "../../../../Types/Rum/RumClientKind";
import ServiceType from "../../../../Types/Telemetry/ServiceType";

/*
 * NO INVENTORY FROM A RUM CLIENT'S ROWS (issue #10539).
 *
 * The discovery that reads stored rows - a database from the CLIENT spans
 * that call it, a queue from messaging spans and broker metrics - reads a
 * span's or a datapoint's own attributes, which a Browser or Mobile key's
 * resource allowlist leaves as sent. A key copied out of a page could send
 * ten CLIENT spans to "prod-db.internal" and have a database added. So the
 * three queries read no row of a RUM client: none filed under a RUM
 * application, and none whose resource is stamped as one - with or without
 * an application to be filed under.
 */

const WINDOW: {
  projectId: string;
  startSql: string;
  endSql: string;
  maxRows: number;
} = {
  projectId: "10539000-0000-4000-8000-000000000001",
  startSql: "toDateTime64('2026-11-20 10:00:00', 9)",
  endSql: "toDateTime64('2026-11-20 10:10:00', 9)",
  maxRows: 500,
};

function collapse(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

describe("notRumClientRowSql", () => {
  test("names the stamp as a stored row carries it: its resource's, prefixed", () => {
    expect(RUM_CLIENT_ROW_ATTRIBUTE_KEY).toBe(
      `resource.${RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE}`,
    );
    expect(RUM_CLIENT_ROW_ATTRIBUTE_KEY).toBe(
      "resource.oneuptime.rum.client.kind",
    );
  });

  test("leaves out a RUM application's rows and every stamped row", () => {
    expect(notRumClientRowSql()).toBe(
      `(ifNull(primaryEntityType, '') != '${ServiceType.RealUserMonitor}' AND NOT has(attributeKeys, 'resource.oneuptime.rum.client.kind'))`,
    );
  });

  test("keeps a row with no primary entity type: ifNull, never a bare != that drops it", () => {
    expect(notRumClientRowSql()).toContain("ifNull(primaryEntityType, '')");
    expect(notRumClientRowSql()).not.toMatch(/\(primaryEntityType !=/);
  });
});

describe.each([
  ["the database endpoint query", buildDatabaseEndpointSql(WINDOW)],
  ["the messaging span query", buildMessagingSpanDiscoverySql(WINDOW)],
  ["the messaging metric query", buildMessagingMetricDiscoverySql(WINDOW)],
])("%s", (_name: string, sql: string) => {
  test("reads no row of a RUM client", () => {
    expect(collapse(sql)).toContain(`AND ${notRumClientRowSql()}`);
  });

  test("still reads the project's own rows in the window", () => {
    expect(collapse(sql)).toContain(`projectId = '${WINDOW.projectId}'`);
  });
});
