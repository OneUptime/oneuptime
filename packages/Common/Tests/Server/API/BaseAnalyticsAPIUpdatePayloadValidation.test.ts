import "../TestingUtils/Init";
import BaseAnalyticsAPI from "../../../Server/API/BaseAnalyticsAPI";
import AnalyticsDatabaseService from "../../../Server/Services/AnalyticsDatabaseService";
import MonitorLog from "../../../Models/AnalyticsModels/MonitorLog";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import { getJestSpyOn } from "../../Spy";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

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
  };
});

/*
 * PUT /<analytics-model>/:id answered 200 with an empty body while writing
 * nothing at all.
 *
 * The wire contract is a WRAPPED payload - { "data": { ...columns... } } - but
 * nothing enforced it. A client that sent the columns flat (the shape a
 * hand-written Workflow naturally produces) had body["data"] === undefined,
 * which deserialized into an empty model, which matched the row and updated
 * zero columns. The request looked successful and the edit silently vanished.
 *
 * These tests pin the guards in BaseAnalyticsAPI.updateItem: the payload must
 * be a wrapped plain object, and it must still carry at least one updatable
 * field once _id / createdAt / updatedAt are stripped.
 *
 * Note the emptiness check has to count fields on the RAW body, not on the
 * hydrated model: an analytics model instance always carries its own internal
 * properties (data, _tableColumns), so Object.keys() on the instance is never
 * empty and could never detect a no-op update.
 */

const TEST_ID: string = "550e8400-e29b-41d4-a716-446655440011";

describe("BaseAnalyticsAPI.updateItem payload validation", () => {
  let service: AnalyticsDatabaseService<MonitorLog>;
  let api: BaseAnalyticsAPI<MonitorLog, AnalyticsDatabaseService<MonitorLog>>;
  let response: ExpressResponse;

  type MakeRequestFunction = (body: unknown) => OneUptimeRequest;

  const makeRequest: MakeRequestFunction = (
    body: unknown,
  ): OneUptimeRequest => {
    return {
      params: { id: TEST_ID },
      body: body as JSONObject,
      headers: {},
    } as unknown as OneUptimeRequest;
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    service = new AnalyticsDatabaseService<MonitorLog>({
      modelType: MonitorLog,
    });

    api = new BaseAnalyticsAPI<
      MonitorLog,
      AnalyticsDatabaseService<MonitorLog>
    >(MonitorLog, service);

    /*
     * Stubbed so a payload that WRONGLY gets past the guards still fails the
     * assertion rather than trying to reach ClickHouse.
     */
    getJestSpyOn(service, "updateBy").mockResolvedValue(undefined);

    response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;
  });

  it("rejects a flat body that forgot to wrap its columns in data", async () => {
    const request: OneUptimeRequest = makeRequest({
      logBody: { message: "flat-payload" },
      monitorId: TEST_ID,
    });

    await expect(api.updateItem(request, response)).rejects.toThrow(
      BadDataException,
    );

    expect(service.updateBy).not.toHaveBeenCalled();
  });

  it("tells the caller the payload has to look like { data: { ... } }", async () => {
    const request: OneUptimeRequest = makeRequest({
      logBody: { message: "flat-payload" },
    });

    await expect(api.updateItem(request, response)).rejects.toThrow(/"data"/);
  });

  it("rejects a completely empty body", async () => {
    const request: OneUptimeRequest = makeRequest({});

    await expect(api.updateItem(request, response)).rejects.toThrow(
      BadDataException,
    );

    expect(service.updateBy).not.toHaveBeenCalled();
  });

  it("rejects data: {} and says there are no fields to update", async () => {
    const request: OneUptimeRequest = makeRequest({ data: {} });

    await expect(api.updateItem(request, response)).rejects.toThrow(
      BadDataException,
    );
    await expect(api.updateItem(request, response)).rejects.toThrow(
      /no fields to update/i,
    );

    expect(service.updateBy).not.toHaveBeenCalled();
  });

  it("rejects data: null", async () => {
    const request: OneUptimeRequest = makeRequest({ data: null });

    await expect(api.updateItem(request, response)).rejects.toThrow(
      BadDataException,
    );

    expect(service.updateBy).not.toHaveBeenCalled();
  });

  /*
   * A string is iterable and `for (const key in "abc")` yields "0", "1", "2",
   * so a lenient implementation could quietly treat it as an object with
   * numeric keys. Assert both that it is refused AND that nothing about it
   * looked like a field set worth forwarding.
   */
  it("rejects a string data payload instead of treating it as an object", async () => {
    const request: OneUptimeRequest = makeRequest({ data: "some string" });

    await expect(api.updateItem(request, response)).rejects.toThrow(
      BadDataException,
    );

    expect(service.updateBy).not.toHaveBeenCalled();
    expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
  });

  it("rejects an empty array data payload", async () => {
    const request: OneUptimeRequest = makeRequest({ data: [] });

    await expect(api.updateItem(request, response)).rejects.toThrow(
      BadDataException,
    );

    expect(service.updateBy).not.toHaveBeenCalled();
  });

  it("rejects an array of objects data payload", async () => {
    const request: OneUptimeRequest = makeRequest({
      data: [{ logBody: { message: "one" } }, { logBody: { message: "two" } }],
    });

    await expect(api.updateItem(request, response)).rejects.toThrow(
      BadDataException,
    );

    expect(service.updateBy).not.toHaveBeenCalled();
  });

  it("rejects a numeric data payload", async () => {
    const request: OneUptimeRequest = makeRequest({ data: 42 });

    await expect(api.updateItem(request, response)).rejects.toThrow(
      BadDataException,
    );

    expect(service.updateBy).not.toHaveBeenCalled();
  });

  it("rejects a boolean data payload", async () => {
    const request: OneUptimeRequest = makeRequest({ data: true });

    await expect(api.updateItem(request, response)).rejects.toThrow(
      BadDataException,
    );

    expect(service.updateBy).not.toHaveBeenCalled();
  });

  /*
   * _id / createdAt / updatedAt are stripped before the update is issued, so a
   * payload made only of those would write nothing. This proves the emptiness
   * check runs on the STRIPPED field set, not on the raw key count.
   */
  it("rejects a payload of only _id, createdAt and updatedAt because nothing updatable survives stripping", async () => {
    const request: OneUptimeRequest = makeRequest({
      data: {
        _id: TEST_ID,
        createdAt: "2026-07-29T00:00:00.000Z",
        updatedAt: "2026-07-29T00:00:00.000Z",
      },
    });

    await expect(api.updateItem(request, response)).rejects.toThrow(
      BadDataException,
    );
    await expect(api.updateItem(request, response)).rejects.toThrow(
      /no fields to update/i,
    );

    expect(service.updateBy).not.toHaveBeenCalled();
  });

  /*
   * No-regression guard: the guards above must not have made the happy path
   * stricter. A correctly wrapped payload with one real column of the model
   * still reaches the service and still reports success.
   */
  it("still updates and reports success for a correctly wrapped payload", async () => {
    const request: OneUptimeRequest = makeRequest({
      data: { logBody: { message: "wrapped-payload" } },
    });

    await api.updateItem(request, response);

    expect(service.updateBy).toHaveBeenCalledTimes(1);
    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledWith(
      request,
      response,
    );
  });

  it("keeps the _id in the update query and out of the written columns", async () => {
    const request: OneUptimeRequest = makeRequest({
      data: { _id: TEST_ID, logBody: { message: "wrapped-payload" } },
    });

    await api.updateItem(request, response);

    expect(service.updateBy).toHaveBeenCalledTimes(1);

    const updateBy: { query: JSONObject; data: MonitorLog } = (
      service.updateBy as unknown as jest.Mock
    ).mock.calls[0]![0] as { query: JSONObject; data: MonitorLog };

    expect(updateBy.query["_id"]).toBe(TEST_ID);
    expect(updateBy.data.getColumnValue("logBody")).toEqual({
      message: "wrapped-payload",
    });
  });

  /*
   * Named for the original symptom: the customer's Workflow PUT a flat body,
   * got HTTP 200 with an empty object back, and nothing was written. The 200
   * came from sendEmptySuccessResponse, so that is the exact call that must
   * never happen for an unwrapped payload.
   */
  it("never reports an empty success for the flat body that silently wrote nothing", async () => {
    const request: OneUptimeRequest = makeRequest({
      content: "<token>",
      name: "Airflow-Token",
      description: "token used by the airflow workflow",
    });

    await expect(api.updateItem(request, response)).rejects.toThrow(
      BadDataException,
    );

    expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
    expect(service.updateBy).not.toHaveBeenCalled();
  });
});
