import { afterEach, describe, expect, jest, test } from "@jest/globals";
import SloHistory from "../../../Models/AnalyticsModels/SloHistory";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import AggregateBy from "../../../Types/BaseDatabase/AggregateBy";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import Timezone from "../../../Types/Timezone";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import { getJestSpyOn } from "../../Spy";
import {
  PublicDashboardContext,
  setPublicDashboardContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import SloWidgetData from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/SloWidgetData";

/*
 * An SLO widget's history chart over days is read in the viewer's zone,
 * where each of its day buckets starts (issue #7277). Signed in, the read
 * goes to AnalyticsModelAPI.aggregate, which adds the zone itself
 * (AnalyticsModelAPIReaderTimezone.test.ts). On a public dashboard the
 * widget posts the read to the public SLO route, which keeps a listed zone
 * and nothing else of the query (PublicDashboardSloHistoryPolicy): the
 * widget adds the zone to the body it posts.
 */

const DASHBOARD_ID: ObjectID = new ObjectID(
  "d4d4d4d4-1111-4111-8111-d4d4d4d4d4d4",
);
const COMPONENT_ID: ObjectID = new ObjectID(
  "c0c0c0c0-2222-4222-8222-c0c0c0c0c0c0",
);

interface Posted {
  route: string;
  body: JSONObject;
}

function historyRead(window: {
  start: Date;
  end: Date;
}): AggregateBy<SloHistory> {
  return {
    query: {},
    aggregateColumnName: "value",
    aggregationType: AggregationType.Avg,
    aggregationTimestampColumnName: "time",
    startTimestamp: window.start,
    endTimestamp: window.end,
    limit: 1000,
    skip: 0,
  } as unknown as AggregateBy<SloHistory>;
}

// The public page's client: it records what the widget posts, as JSON.
function publicPage(posted: Array<Posted>): PublicDashboardContext {
  return {
    dashboardId: DASHBOARD_ID,
    apiUrl: URL.fromString("http://localhost/public-dashboard-api"),
    postJSON: async (
      route: string,
      data: JSONObject,
    ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      posted.push({ route: route, body: JSON.parse(JSON.stringify(data)) });

      return new HTTPResponse<JSONObject>(200, { data: [] }, {});
    },
    apiClient: {} as PublicDashboardContext["apiClient"],
  };
}

// The read as the public route revives it.
function readOf(posted: Posted): JSONObject {
  return JSONFunctions.deserialize(posted.body["aggregateBy"] as JSONObject);
}

const MONTH: { start: Date; end: Date } = {
  start: new Date("2026-10-01T04:00:00.000Z"),
  end: new Date("2026-11-01T04:00:00.000Z"),
};

afterEach(() => {
  setPublicDashboardContext(null);
  OneUptimeDate.setUserTimezone(null);
  jest.restoreAllMocks();
});

describe("an SLO widget's history over days on a public dashboard", () => {
  test("posts the viewer's zone with its window to the public SLO route", async () => {
    for (const reader of [
      Timezone.AmericaNew_York,
      Timezone.AsiaKolkata,
      Timezone.UTC,
    ]) {
      OneUptimeDate.setUserTimezone(reader);

      const posted: Array<Posted> = [];
      setPublicDashboardContext(publicPage(posted));

      await SloWidgetData.aggregateSloHistory({
        componentId: COMPONENT_ID,
        aggregateBy: historyRead(MONTH),
      });

      expect(posted).toHaveLength(1);
      expect(posted[0]!.route).toBe(
        `/slo-history-aggregate/${DASHBOARD_ID.toString()}`,
      );
      expect(posted[0]!.body["componentId"]).toBe(COMPONENT_ID.toString());

      const read: JSONObject = readOf(posted[0]!);

      expect(read["timezone"]).toBe(reader);
      expect((read["startTimestamp"] as Date).toISOString()).toBe(
        MONTH.start.toISOString(),
      );
      expect((read["endTimestamp"] as Date).toISOString()).toBe(
        MONTH.end.toISOString(),
      );
    }
  });

  test("a day's window, read by the quarter hour, posts no zone: a quarter hour starts at the same instant everywhere", async () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    const posted: Array<Posted> = [];
    setPublicDashboardContext(publicPage(posted));

    await SloWidgetData.aggregateSloHistory({
      componentId: COMPONENT_ID,
      aggregateBy: historyRead({
        start: new Date("2026-10-31T04:00:00.000Z"),
        end: new Date("2026-11-01T04:00:00.000Z"),
      }),
    });

    expect(readOf(posted[0]!)).not.toHaveProperty("timezone");
  });

  test("the widget's own read is left as it was", async () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    const posted: Array<Posted> = [];
    setPublicDashboardContext(publicPage(posted));

    const aggregateBy: AggregateBy<SloHistory> = historyRead(MONTH);

    await SloWidgetData.aggregateSloHistory({
      componentId: COMPONENT_ID,
      aggregateBy: aggregateBy,
    });

    expect(aggregateBy).not.toHaveProperty("timezone");
    expect(readOf(posted[0]!)["timezone"]).toBe(Timezone.AmericaNew_York);
  });
});

describe("an SLO widget's history signed in", () => {
  test("hands its read to AnalyticsModelAPI.aggregate, which adds the zone", async () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    const aggregate: jest.SpyInstance<any, any> = getJestSpyOn(
      AnalyticsModelAPI,
      "aggregate",
    ).mockResolvedValue({ data: [] });

    const aggregateBy: AggregateBy<SloHistory> = {
      ...historyRead(MONTH),
      aggregationInterval: AggregationInterval.Day,
    } as AggregateBy<SloHistory>;

    await SloWidgetData.aggregateSloHistory({
      componentId: COMPONENT_ID,
      aggregateBy: aggregateBy,
    });

    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(aggregate.mock.calls[0]![0]).toEqual({
      modelType: SloHistory,
      aggregateBy: aggregateBy,
    });
  });
});
