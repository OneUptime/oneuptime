import "../TestingUtils/Init";
import BaseAnalyticsAPI from "../../../Server/API/BaseAnalyticsAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import AnalyticsDatabaseService from "../../../Server/Services/AnalyticsDatabaseService";
import CountBy from "../../../Server/Types/AnalyticsDatabase/CountBy";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import Span from "../../../Models/AnalyticsModels/Span";
import AnalyticsDataModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import TimeoutException from "../../../Types/Exception/TimeoutException";
import { mockRouter } from "./Helpers";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * POST /<analytics model>/count takes an optional `exact: true` (issue
 * #4202): the telemetry explorers' total, which must be the number of rows
 * the list pages through, so it must not come from the minute-rounded
 * projection shortcut or from a count cut short at the time limit. Only the
 * JSON boolean asks for it; every other caller keeps the count it had.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "5f8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d",
);

const props: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: ObjectID.generate(),
};

describe("BaseAnalyticsAPI.isExactCountRequested", () => {
  test("the JSON boolean true asks for an exact count", () => {
    expect(BaseAnalyticsAPI.isExactCountRequested({ exact: true })).toBe(true);
  });

  test("nothing else does: the cheap count stays the default", () => {
    for (const body of [
      {},
      { exact: false },
      { exact: "true" },
      { exact: 1 },
      { exact: {} },
      { exact: null },
      null,
      undefined,
      "exact",
      ["exact"],
    ]) {
      expect(BaseAnalyticsAPI.isExactCountRequested(body)).toBe(false);
    }
  });
});

describe("POST /span/count", () => {
  let countBy: MockFunction;
  let api: BaseAnalyticsAPI<
    AnalyticsDataModel,
    AnalyticsDatabaseService<AnalyticsDataModel>
  >;

  beforeEach(() => {
    countBy = getJestMockFunction().mockImplementation(() => {
      return Promise.resolve(new PositiveNumber(712345));
    });

    api = new BaseAnalyticsAPI<
      AnalyticsDataModel,
      AnalyticsDatabaseService<AnalyticsDataModel>
    >(
      Span as unknown as { new (): AnalyticsDataModel },
      { countBy } as unknown as AnalyticsDatabaseService<AnalyticsDataModel>,
    );

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(props);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    (Response.sendJsonObjectResponse as jest.Mock).mockReset();
  });

  const request: (body: JSONObject) => ExpressRequest = (
    body: JSONObject,
  ): ExpressRequest => {
    return {
      params: {},
      query: {},
      headers: { tenantid: PROJECT_ID.toString() },
      body,
    } as unknown as ExpressRequest;
  };

  const query: JSONObject = JSONFunctions.serialize({
    projectId: PROJECT_ID,
  } as unknown as JSONObject);

  test("exact: true is handed to the service with the query and the caller's props", async () => {
    await api.count(request({ query, exact: true }), {} as ExpressResponse);

    expect(countBy).toHaveBeenCalledTimes(1);
    const countArgs: CountBy<AnalyticsDataModel> = countBy.mock
      .calls[0]![0] as CountBy<AnalyticsDataModel>;
    expect(countArgs.exact).toBe(true);
    expect(countArgs.props).toBe(props);
    expect(String((countArgs.query as JSONObject)["projectId"])).toBe(
      PROJECT_ID.toString(),
    );
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { count: 712345 },
    );
  });

  test("without the flag the service is asked for the count it always gave", async () => {
    await api.count(request({ query }), {} as ExpressResponse);

    const countArgs: CountBy<AnalyticsDataModel> = countBy.mock
      .calls[0]![0] as CountBy<AnalyticsDataModel>;
    expect(countArgs.exact).toBe(false);
  });

  test("a stringly-typed flag is not a request this API documents", async () => {
    await api.count(request({ query, exact: "true" }), {} as ExpressResponse);

    const countArgs: CountBy<AnalyticsDataModel> = countBy.mock
      .calls[0]![0] as CountBy<AnalyticsDataModel>;
    expect(countArgs.exact).toBe(false);
  });

  test("an exact count that ran out of time propagates as the 408 the client explains", async () => {
    countBy.mockImplementation(() => {
      return Promise.reject(
        new TimeoutException("Counting every matching span took too long."),
      );
    });

    await expect(
      api.count(request({ query, exact: true }), {} as ExpressResponse),
    ).rejects.toBeInstanceOf(TimeoutException);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("the route is registered as POST /span/count", () => {
    const route: { method: string; uri: string } = mockRouter.match(
      "POST",
      "/span/count",
    );

    expect(route.uri).toBe("/span/count");
  });
});
