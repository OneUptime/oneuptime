import { beforeEach, describe, expect, test } from "@jest/globals";
import Dictionary from "Common/Types/Dictionary";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import { PROJECT_METRICS_DATA_SOURCE_ID } from "Common/Types/DataSource/ProjectMetricsDataSource";
import { DataSourceResultKind } from "Common/Types/DataSource/DataSourceQueryConfig";
import { PrometheusSeries } from "Common/Utils/PromQL/PrometheusResponse";

/*
 * Issue #10227: what a PromQL monitor's charts ask for, and what they make
 * of the answer. They read through the Data Source widgets' built-in source
 * - the PromQL engine and limits of the API, as the person viewing, for the
 * services they may read - narrowed to the services the monitor reads and,
 * on an incident, to the one series that opened it. The browser-bound
 * modules are mocked: Common/UI/Config reads `window` at import time.
 */
jest.mock("Common/UI/Config", () => {
  const { default: MockURL } = jest.requireActual("Common/Types/API/URL") as {
    default: { fromString: (value: string) => unknown };
  };
  return {
    __esModule: true,
    APP_API_URL: MockURL.fromString("http://localhost/api"),
  };
});

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: jest.fn(),
    },
  };
});

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: jest.fn(),
      post: jest.fn(),
    },
  };
});

import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PromQLQueryUtil from "../../FeatureSet/Dashboard/src/Utils/PromQLQuery";

const postMock: jest.Mock = API.post as unknown as jest.Mock;
const getCommonHeadersMock: jest.Mock =
  ModelAPI.getCommonHeaders as unknown as jest.Mock;

const TENANT_HEADERS: Dictionary<string> = {
  tenantid: "3f1b6b0e-0000-4000-8000-0000000000aa",
};

const SERVICE_ID: string = "44444444-4444-4444-8444-444444444444";
const START: Date = new Date("2026-11-07T09:00:00.000Z");
const END: Date = new Date("2026-11-07T12:00:00.000Z");

interface CallOptions {
  url: URL;
  data: JSONObject;
  headers: Dictionary<string>;
}

function lastCall(): CallOptions {
  const calls: Array<Array<unknown>> = postMock.mock.calls;
  return calls[calls.length - 1]![0] as CallOptions;
}

function answer(result: JSONObject): void {
  postMock.mockResolvedValue(
    new HTTPResponse<JSONObject>(200, { result } as JSONObject, {}),
  );
}

beforeEach(() => {
  postMock.mockReset();
  getCommonHeadersMock.mockReset();
  getCommonHeadersMock.mockReturnValue(TENANT_HEADERS);
  answer({ kind: DataSourceResultKind.TimeSeries, data: [] });
});

describe("what a PromQL monitor's chart asks for", () => {
  test("the expression over the window, through the built-in source, as the person viewing", async () => {
    await PromQLQueryUtil.queryMonitorRange({
      query: "up == 0",
      startDate: START,
      endDate: END,
    });

    const call: CallOptions = lastCall();
    expect(call.url.toString()).toBe("http://localhost/api/data-source/query");
    expect(call.headers).toBe(TENANT_HEADERS);
    expect(call.data).toEqual({
      dataSourceId: PROJECT_METRICS_DATA_SOURCE_ID,
      query: "up == 0",
      resultKind: DataSourceResultKind.TimeSeries,
      startDate: START.toISOString(),
      endDate: END.toISOString(),
    });
  });

  test("for the services the monitor reads, and the one series an incident opened for", async () => {
    await PromQLQueryUtil.queryMonitorRange({
      query: "up == 0",
      startDate: START,
      endDate: END,
      serviceIds: [SERVICE_ID],
      seriesLabels: { job: "api", instance: "a:9090" },
    });

    expect(lastCall().data["serviceIds"]).toEqual([SERVICE_ID]);
    expect(lastCall().data["seriesLabels"]).toEqual({
      job: "api",
      instance: "a:9090",
    });
  });

  test("no services is every service the viewer may read: none sent", async () => {
    await PromQLQueryUtil.queryMonitorRange({
      query: "up",
      startDate: START,
      endDate: END,
      serviceIds: [],
    });

    expect(lastCall().data).not.toHaveProperty("serviceIds");
    expect(lastCall().data).not.toHaveProperty("seriesLabels");
  });

  test("a series of no labels is still asked for by its labels", async () => {
    await PromQLQueryUtil.queryMonitorRange({
      query: "sum(up)",
      startDate: START,
      endDate: END,
      seriesLabels: {},
    });

    expect(lastCall().data["seriesLabels"]).toEqual({});
  });

  test("a refusal is thrown, for the chart to say", async () => {
    const refusal: HTTPErrorResponse = new HTTPErrorResponse(
      403,
      { message: "You do not have permission to read this project's metrics." },
      {},
    );
    postMock.mockResolvedValue(refusal);

    await expect(
      PromQLQueryUtil.queryMonitorRange({
        query: "up",
        startDate: START,
        endDate: END,
      }),
    ).rejects.toBe(refusal);
  });
});

describe("what it makes of the answer", () => {
  test("one series per label set, in the order they first come, each point in time order", async () => {
    answer({
      kind: DataSourceResultKind.TimeSeries,
      data: [
        {
          timestamp: "2026-11-07T11:00:00.000Z",
          value: 3,
          attributes: { job: "api", instance: "a:9090" },
        },
        {
          timestamp: "2026-11-07T11:00:00.000Z",
          value: 1,
          attributes: { instance: "b:9090", job: "api" },
        },
        {
          timestamp: "2026-11-07T11:05:00.000Z",
          value: 8,
          // The same labels in another order: the same series.
          attributes: { instance: "a:9090", job: "api" },
        },
      ],
      truncated: false,
    });

    const read: { series: Array<PrometheusSeries>; isCut: boolean } =
      await PromQLQueryUtil.queryMonitorRange({
        query: "up",
        startDate: START,
        endDate: END,
      });

    expect(read.isCut).toBe(false);
    expect(read.series).toEqual([
      {
        labels: { job: "api", instance: "a:9090" },
        points: [
          { timestampMs: Date.parse("2026-11-07T11:00:00.000Z"), value: 3 },
          { timestampMs: Date.parse("2026-11-07T11:05:00.000Z"), value: 8 },
        ],
      },
      {
        labels: { instance: "b:9090", job: "api" },
        points: [
          { timestampMs: Date.parse("2026-11-07T11:00:00.000Z"), value: 1 },
        ],
      },
    ]);
  });

  test("says when the source cut the answer to its series or point caps", async () => {
    answer({
      kind: DataSourceResultKind.TimeSeries,
      data: [{ timestamp: "2026-11-07T11:00:00.000Z", value: 1 }],
      truncated: true,
    });

    const read: { series: Array<PrometheusSeries>; isCut: boolean } =
      await PromQLQueryUtil.queryMonitorRange({
        query: "up",
        startDate: START,
        endDate: END,
      });

    expect(read.isCut).toBe(true);
    // A point of no labels is the one series of an aggregation.
    expect(read.series).toEqual([
      {
        labels: {},
        points: [
          { timestampMs: Date.parse("2026-11-07T11:00:00.000Z"), value: 1 },
        ],
      },
    ]);
  });

  test("a point with no time or no number is no point", () => {
    expect(
      PromQLQueryUtil.toSeries([
        { timestamp: "not a time", value: 1 },
        { timestamp: "2026-11-07T11:00:00.000Z", value: "1" },
        { timestamp: "2026-11-07T11:00:00.000Z", value: null },
        { value: 2 },
      ] as unknown as Array<JSONObject>),
    ).toEqual([]);
  });

  test("an answer with no result is no series", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, {} as JSONObject, {}),
    );

    expect(
      await PromQLQueryUtil.queryMonitorRange({
        query: "up",
        startDate: START,
        endDate: END,
      }),
    ).toEqual({ series: [], isCut: false });
  });
});
