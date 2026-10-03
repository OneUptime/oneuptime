import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Span from "../../../Models/AnalyticsModels/Span";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import DashboardAPI from "../../../UI/Utils/API/API";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * AnalyticsModelAPI.count's `exact` option (issue #4202): the telemetry
 * explorers ask POST /<model>/count for the exact number of rows their list
 * query matches. The option travels as `exact: true` in the body and only
 * when asked for, so every other count request is byte-for-byte what it was;
 * a count the server could not finish in time comes back as the 408 it is.
 */

interface FetchSpy {
  mockResolvedValue: (value: unknown) => FetchSpy;
  mock: { calls: Array<Array<unknown>> };
}

interface SentRequest {
  url: URL;
  data: JSONObject;
  headers: Dictionary<string>;
}

const PROJECT_ID: string = "019acd20-2222-4222-8222-222222222222";

let fetchSpy: FetchSpy;

const sentRequest: () => SentRequest = (): SentRequest => {
  expect(fetchSpy.mock.calls).toHaveLength(1);
  return fetchSpy.mock.calls[0]![0] as SentRequest;
};

beforeEach(() => {
  fetchSpy = jest.spyOn(DashboardAPI, "fetch") as unknown as FetchSpy;
  fetchSpy.mockResolvedValue(
    new HTTPResponse<JSONObject>(200, { count: 712345 }, {}),
  );

  const project: Project = new Project();
  project.id = new ObjectID(PROJECT_ID);
  jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(project);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AnalyticsModelAPI.count — the exact option", () => {
  const query: () => JSONObject = (): JSONObject => {
    return {
      projectId: new ObjectID(PROJECT_ID),
      startTime: new InBetween<Date>(
        new Date("2026-10-01T10:48:39.000Z"),
        new Date("2026-10-01T11:48:39.000Z"),
      ),
    } as unknown as JSONObject;
  };

  test("asks the model's count endpoint for an exact count, with the list's query", async () => {
    const count: number = await AnalyticsModelAPI.count<Span>(
      Span,
      query(),
      undefined,
      { exact: true },
    );

    expect(count).toBe(712345);

    const request: SentRequest = sentRequest();
    expect(request.url.toString()).toMatch(/\/span\/count$/);
    expect(request.data["exact"]).toBe(true);
    expect(request.data["query"]).toBeDefined();
  });

  test("keeps the project header: the option is not a request option", async () => {
    await AnalyticsModelAPI.count<Span>(Span, query(), undefined, {
      exact: true,
    });

    expect(sentRequest().headers["tenantid"]).toBe(PROJECT_ID);
  });

  test("without the option the request is what it always was", async () => {
    await AnalyticsModelAPI.count<Span>(Span, query());

    const data: JSONObject = sentRequest().data;
    expect(Object.keys(data)).toEqual(["query"]);
  });

  test("exact: false sends nothing extra either", async () => {
    await AnalyticsModelAPI.count<Span>(Span, query(), undefined, {
      exact: false,
    });

    expect(Object.keys(sentRequest().data)).toEqual(["query"]);
  });

  test("a count that ran out of time reaches the caller as its 408", async () => {
    fetchSpy.mockResolvedValue(
      new HTTPErrorResponse(
        408,
        {
          message:
            "Counting every matching span took longer than 45 seconds. Narrow the time range or add a filter to get an exact total.",
        },
        {},
      ),
    );

    let thrown: unknown = undefined;
    try {
      await AnalyticsModelAPI.count<Span>(Span, query(), undefined, {
        exact: true,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(HTTPErrorResponse);
    expect((thrown as HTTPErrorResponse).statusCode).toBe(408);
  });
});
