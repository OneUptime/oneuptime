import { describe, expect, test } from "@jest/globals";
import ObjectID from "../../../../Types/ObjectID";
import {
  buildTableErrorLogsStatement,
  readTableErrorLog,
} from "../../../../Server/Utils/DataObservability/DataTableErrors";
import { buildAiServicesStatement } from "../../../../Server/Utils/DataObservability/TableUsageDiscovery";

/*
 * The errors of the services that write a table, that name it, and which
 * services also call a model.
 */

const PROJECT: ObjectID = new ObjectID("7f9c24e8-3b12-4fef-91e2-111111111111");
const SERVICE: ObjectID = new ObjectID("7f9c24e8-3b12-4fef-91e2-222222222222");
const OTHER: ObjectID = new ObjectID("7f9c24e8-3b12-4fef-91e2-333333333333");

describe("the error logs that name a table", () => {
  const statement: { query: string } = buildTableErrorLogsStatement({
    projectId: PROJECT,
    serviceIds: [SERVICE, OTHER],
    tableName: "orders",
    since: new Date(Date.UTC(2026, 10, 3)),
  });

  test("only errors, only of its writers, only naming it", () => {
    expect(statement.query).toContain("severityNumber >=");
    expect(statement.query).toContain("positionCaseInsensitive(body,");
    expect(statement.query.match(/primaryEntityId =/g)).toHaveLength(2);
    expect(statement.query).toContain(" OR ");
  });

  test("the newest first, and only a few", () => {
    expect(statement.query).toContain("ORDER BY time DESC LIMIT");
  });

  test("a row says what and who", () => {
    expect(
      readTableErrorLog(
        {
          time: "2026-11-04 10:00:00.000000",
          severityText: "ERROR",
          body: `column "total" of relation "orders" does not exist`,
          primaryEntityId: SERVICE.toString(),
        },
        new Map([[SERVICE.toString(), "checkout"]]),
      ),
    ).toEqual({
      time: "2026-11-04T10:00:00.000Z",
      severity: "ERROR",
      body: `column "total" of relation "orders" does not exist`,
      serviceName: "checkout",
    });
  });

  test("a row with no time is no row", () => {
    expect(readTableErrorLog({ body: "x" }, new Map())).toBeNull();
  });
});

describe("the services that call a model", () => {
  test("come from their LLM spans", () => {
    const query: string = buildAiServicesStatement({
      projectId: PROJECT,
      since: new Date(Date.UTC(2026, 10, 3)),
      until: new Date(Date.UTC(2026, 10, 4)),
    }).query;

    expect(query).toContain("SELECT DISTINCT primaryEntityId");
    expect(query).toContain("isLlmSpan = 1");
  });
});
