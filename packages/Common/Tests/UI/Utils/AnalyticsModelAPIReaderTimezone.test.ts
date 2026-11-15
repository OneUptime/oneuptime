import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Metric from "../../../Models/AnalyticsModels/Metric";
import Project from "../../../Models/DatabaseModels/Project";
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
import DashboardAPI from "../../../UI/Utils/API/API";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * WHAT THE DASHBOARD SENDS WITH AN AGGREGATE (issue #7277).
 *
 * Every chart's aggregate goes through AnalyticsModelAPI.aggregate. For a
 * window bucketed by a day or longer it carries the reader's zone, so the
 * server starts each day at the reader's midnight and the chart, which
 * names its days on the reader's calendar, finds each day's total under its
 * own day. A request of hours or less is sent exactly as before, and one
 * that names its own zone (a cloud's bill is for a UTC day) keeps it.
 */

interface FetchSpy {
  mockResolvedValue: (value: unknown) => FetchSpy;
  mockClear: () => void;
  mock: { calls: Array<Array<unknown>> };
}

interface SentRequest {
  url: URL;
  data: JSONObject;
}

const PROJECT_ID: string = "019acd20-3333-4333-8333-333333333333";
const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;
const END: Date = new Date("2026-03-20T15:00:00.000Z");

let fetchSpy: FetchSpy;

function sentAggregateBy(): JSONObject {
  expect(fetchSpy.mock.calls).toHaveLength(1);

  const request: SentRequest = fetchSpy.mock.calls[0]![0] as SentRequest;

  return request.data["aggregateBy"] as JSONObject;
}

function aggregateOver(
  durationMs: number,
  extra: Partial<AggregateBy<Metric>> = {},
): AggregateBy<Metric> {
  return {
    query: { projectId: new ObjectID(PROJECT_ID) },
    aggregationType: AggregationType.Sum,
    aggregateColumnName: "value",
    aggregationTimestampColumnName: "time",
    startTimestamp: new Date(END.getTime() - durationMs),
    endTimestamp: END,
    limit: 100,
    skip: 0,
    ...extra,
  } as AggregateBy<Metric>;
}

async function send(aggregateBy: AggregateBy<Metric>): Promise<JSONObject> {
  await AnalyticsModelAPI.aggregate<Metric>({
    modelType: Metric,
    aggregateBy: aggregateBy,
  });

  return sentAggregateBy();
}

beforeEach(() => {
  fetchSpy = jest.spyOn(DashboardAPI, "fetch") as unknown as FetchSpy;
  fetchSpy.mockResolvedValue(new HTTPResponse<JSONObject>(200, {}, {}));

  const project: Project = new Project();
  project.id = new ObjectID(PROJECT_ID);
  jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(project);
});

afterEach(() => {
  OneUptimeDate.setUserTimezone(null);
  jest.restoreAllMocks();
});

describe("AnalyticsModelAPI.aggregate: the reader's zone", () => {
  test("a month of days goes to the model's aggregate route with the reader's zone", async () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    const sent: JSONObject = await send(aggregateOver(30 * DAY));
    const request: SentRequest = fetchSpy.mock.calls[0]![0] as SentRequest;

    expect(request.url.toString()).toMatch(/\/aggregate$/);
    expect(sent["timezone"]).toBe(Timezone.AmericaNew_York);
  });

  test("weeks, months and years carry it too, in whichever zone the reader picked", async () => {
    for (const [timezone, durationMs] of [
      [Timezone.AsiaTokyo, 100 * DAY],
      [Timezone.AsiaKolkata, 400 * DAY],
      [Timezone.UTC, 10 * 365 * DAY],
    ] as Array<[Timezone, number]>) {
      OneUptimeDate.setUserTimezone(timezone);
      fetchSpy.mockClear();

      expect((await send(aggregateOver(durationMs)))["timezone"]).toBe(
        timezone,
      );
    }
  });

  test("a request of hours or less is sent as it always was, with no zone in it", async () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    for (const durationMs of [HOUR, 12 * HOUR, 3 * DAY, 7 * DAY]) {
      fetchSpy.mockClear();

      const aggregateBy: AggregateBy<Metric> = aggregateOver(durationMs);
      const sent: JSONObject = await send(aggregateBy);

      expect(Object.keys(sent)).not.toContain("timezone");
      expect(sent).toEqual(JSONFunctions.serialize(aggregateBy as any));
    }
  });

  test("the interval a request pins decides: hours over a month carry no zone, days over an hour do", async () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    expect(
      Object.keys(
        await send(
          aggregateOver(30 * DAY, {
            aggregationInterval: AggregationInterval.Hour,
          }),
        ),
      ),
    ).not.toContain("timezone");

    fetchSpy.mockClear();

    expect(
      (
        await send(
          aggregateOver(HOUR, { aggregationInterval: AggregationInterval.Day }),
        )
      )["timezone"],
    ).toBe(Timezone.AmericaNew_York);
  });

  test("a request that names its zone keeps it, whatever the reader's", async () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    expect(
      (await send(aggregateOver(30 * DAY, { timezone: Timezone.UTC })))[
        "timezone"
      ],
    ).toBe(Timezone.UTC);
  });

  test("the caller's request is not changed: the zone is on the copy that is sent", async () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    const aggregateBy: AggregateBy<Metric> = aggregateOver(30 * DAY);

    await send(aggregateBy);

    expect("timezone" in aggregateBy).toBe(false);
  });

  test("a reader's zone the Timezone list does not name is left out, so the server answers in UTC rather than refusing", async () => {
    jest
      .spyOn(OneUptimeDate, "getCurrentTimezone")
      .mockReturnValue("Mars/Olympus_Mons" as Timezone);

    expect(Object.keys(await send(aggregateOver(30 * DAY)))).not.toContain(
      "timezone",
    );
  });
});
