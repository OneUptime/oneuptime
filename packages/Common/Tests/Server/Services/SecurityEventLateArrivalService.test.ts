import SecurityEventLateArrivalService from "../../../Server/Services/SecurityEventLateArrivalService";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  SECURITY_EVENT_LATE_ARRIVAL_MAX_SOURCES,
  SecurityEventLateArrivals,
} from "../../../Types/SecurityEvent/SecurityEventLateArrival";
import { getJestSpyOn } from "../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * What Detection Rules asks the late-arrival counts (#10491) and what it
 * makes of the answer: one project's last week, a row per source, only the
 * sources the reader may read, every value a bound parameter. That the view
 * counts what it says against a real ClickHouse is in
 * DetectionRuleArrivalsClickhouse.test.ts (packages/App).
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const READABLE: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const BLOCKED: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const NOW: Date = new Date("2026-11-20T15:42:10.000Z");

function stubExecuteQuery(rows: Array<JSONObject>): Spy {
  getJestSpyOn(
    SecurityEventLateArrivalService.database,
    "getDatasourceOptions",
  ).mockReturnValue({
    database: "oneuptime",
  } as never);

  const result: Results = {
    json: (): Promise<unknown> => {
      return Promise.resolve({ data: rows });
    },
  } as unknown as Results;

  return getJestSpyOn(
    SecurityEventLateArrivalService,
    "executeQuery",
  ).mockResolvedValue(result as never);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SecurityEventLateArrivalService.getLateArrivals", () => {
  test("reads one project's last week from the counts, a row per source, the most first", async () => {
    const spy: Spy = stubExecuteQuery([]);

    await SecurityEventLateArrivalService.getLateArrivals({
      projectId: PROJECT_ID,
      now: NOW,
    });

    const statement: Statement = spy.mock.calls[0]![0] as Statement;

    expect(statement.query.split(" SETTINGS ")[0]).toBe(
      "SELECT vendorName, productName, countMerge(eventCountState) AS eventCount, minMerge(happenedFromState) AS happenedFrom, maxMerge(happenedToState) AS happenedTo, minMerge(arrivedFromState) AS arrivedFrom, maxMerge(arrivedToState) AS arrivedTo FROM oneuptime.SecurityEventLateArrivalV1 WHERE projectId = {p0:String} AND day >= {p1:DateTime} GROUP BY vendorName, productName ORDER BY eventCount DESC, productName ASC, vendorName ASC LIMIT {p2:Int32}",
    );
    // A notice's read: given up after 30 seconds rather than holding the page.
    expect(statement.query).toContain(" SETTINGS max_execution_time = 30,");
    expect(statement.query_params["p0"]).toBe(PROJECT_ID.toString());
    // Midnight UTC, six days before today: today and the six days before it.
    expect(String(statement.query_params["p1"])).toContain(
      "2026-11-14 00:00:00",
    );
    expect(statement.query_params["p2"]).toBe(
      SECURITY_EVENT_LATE_ARRIVAL_MAX_SOURCES,
    );
  });

  test("counts only the sources the reader may read", async () => {
    const spy: Spy = stubExecuteQuery([]);

    await SecurityEventLateArrivalService.getLateArrivals({
      projectId: PROJECT_ID,
      now: NOW,
      serviceFilter: {
        serviceIds: [READABLE],
        excludedServiceIds: [BLOCKED],
      },
    });

    const statement: Statement = spy.mock.calls[0]![0] as Statement;

    expect(statement.query).toContain(
      "AND day >= {p1:DateTime} AND primaryEntityId IN ({p2:Array(String)}) AND primaryEntityId NOT IN ({p3:Array(String)}) GROUP BY",
    );
    expect(statement.query_params["p2"]).toEqual([READABLE.toString()]);
    expect(statement.query_params["p3"]).toEqual([BLOCKED.toString()]);
  });

  test("reads each source's count and times, in UTC", async () => {
    stubExecuteQuery([
      {
        vendorName: "Okta",
        productName: "Okta Workforce Identity",
        // UInt64 comes back from ClickHouse as a string.
        eventCount: "300",
        happenedFrom: "2026-11-15 03:00:00.000000000",
        happenedTo: "2026-11-17 21:30:00.250000000",
        arrivedFrom: "2026-11-19 08:00:00",
        arrivedTo: "2026-11-19 08:40:00",
      },
      {
        vendorName: "CrowdStrike",
        productName: "Falcon",
        eventCount: "12",
        happenedFrom: "2026-11-12 10:00:00.000000000",
        happenedTo: "2026-11-12 11:00:00.000000000",
        arrivedFrom: "2026-11-14 09:00:00",
        arrivedTo: "2026-11-14 09:00:00",
      },
    ]);

    const late: SecurityEventLateArrivals =
      await SecurityEventLateArrivalService.getLateArrivals({
        projectId: PROJECT_ID,
        now: NOW,
      });

    expect(late).toEqual({
      arrivedSince: new Date("2026-11-14T00:00:00.000Z"),
      eventCount: 312,
      sources: [
        {
          vendorName: "Okta",
          productName: "Okta Workforce Identity",
          eventCount: 300,
          happenedFrom: new Date("2026-11-15T03:00:00.000Z"),
          happenedTo: new Date("2026-11-17T21:30:00.250Z"),
          arrivedFrom: new Date("2026-11-19T08:00:00.000Z"),
          arrivedTo: new Date("2026-11-19T08:40:00.000Z"),
        },
        {
          vendorName: "CrowdStrike",
          productName: "Falcon",
          eventCount: 12,
          happenedFrom: new Date("2026-11-12T10:00:00.000Z"),
          happenedTo: new Date("2026-11-12T11:00:00.000Z"),
          arrivedFrom: new Date("2026-11-14T09:00:00.000Z"),
          arrivedTo: new Date("2026-11-14T09:00:00.000Z"),
        },
      ],
    });
  });

  test("nothing late is nothing to say", async () => {
    stubExecuteQuery([]);

    expect(
      await SecurityEventLateArrivalService.getLateArrivals({
        projectId: PROJECT_ID,
        now: NOW,
      }),
    ).toEqual({
      arrivedSince: new Date("2026-11-14T00:00:00.000Z"),
      eventCount: 0,
      sources: [],
    });
  });

  test("a row without a count or a time is left out of the sources and the total", async () => {
    stubExecuteQuery([
      {
        vendorName: "Okta",
        productName: "Okta",
        eventCount: "0",
        happenedFrom: "2026-11-15 03:00:00.000000000",
        happenedTo: "2026-11-15 03:00:00.000000000",
        arrivedFrom: "2026-11-19 08:00:00",
        arrivedTo: "2026-11-19 08:00:00",
      },
      {
        vendorName: "Okta",
        productName: "Okta",
        eventCount: "4",
        happenedFrom: "",
        happenedTo: "2026-11-15 03:00:00.000000000",
        arrivedFrom: "2026-11-19 08:00:00",
        arrivedTo: "2026-11-19 08:00:00",
      },
    ]);

    expect(
      await SecurityEventLateArrivalService.getLateArrivals({
        projectId: PROJECT_ID,
        now: NOW,
      }),
    ).toEqual({
      arrivedSince: new Date("2026-11-14T00:00:00.000Z"),
      eventCount: 0,
      sources: [],
    });
  });
});
