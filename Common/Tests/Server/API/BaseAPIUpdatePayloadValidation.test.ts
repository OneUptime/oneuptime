import BaseAPI from "../../../Server/API/BaseAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import Probe from "../../../Models/DatabaseModels/Probe";
import { getJestSpyOn } from "../../Spy";

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
 * PUT /<model>/:id takes its payload wrapped as { "data": { ...columns... } }.
 *
 * A caller that sent the columns flat instead - no "data" key - got HTTP 200
 * and an empty body, and nothing was written. body["data"] was undefined,
 * deserializing that handed back {}, and an update carrying no columns still
 * matched the row, so the "matched nothing" guard never fired. The fields were
 * dropped on the floor and the caller was told the write succeeded.
 *
 * A customer hit this rotating an API token from a Workflow: every run
 * reported success and every run read back the previous token.
 */

const TEST_ID: string = "550e8400-e29b-41d4-a716-446655440009";

describe("BaseAPI.updateItem payload validation", () => {
  let service: DatabaseService<Probe>;
  let api: BaseAPI<Probe, DatabaseService<Probe>>;
  let response: ExpressResponse;

  type RequestWithBodyFunction = (body: JSONObject) => OneUptimeRequest;

  const requestWithBody: RequestWithBodyFunction = (
    body: JSONObject,
  ): OneUptimeRequest => {
    return {
      params: { id: TEST_ID },
      body: body,
      headers: {},
    } as unknown as OneUptimeRequest;
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    service = new DatabaseService<Probe>(Probe);
    api = new BaseAPI<Probe, DatabaseService<Probe>>(Probe, service);

    response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;

    getJestSpyOn(service, "updateOneById").mockResolvedValue(1);
  });

  describe("when the payload is not wrapped in a data object", () => {
    /*
     * This is the customer's exact request body, minus the token value. It is
     * the case the whole fix exists for.
     */
    it("refuses a flat body that puts the columns at the top level", async () => {
      const request: OneUptimeRequest = requestWithBody({
        content: "new-token-value",
        name: "Airflow-Token",
        description: "Token to connect to Airflow.",
      });

      await expect(api.updateItem(request, response)).rejects.toThrow(
        BadDataException,
      );

      expect(service.updateOneById).not.toHaveBeenCalled();
      expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
    });

    it("names the shape it wants so the caller can fix the request", async () => {
      const request: OneUptimeRequest = requestWithBody({
        content: "new-token-value",
      });

      await expect(api.updateItem(request, response)).rejects.toThrow(/data/);
    });

    it("refuses an empty body", async () => {
      await expect(
        api.updateItem(requestWithBody({}), response),
      ).rejects.toThrow(BadDataException);

      expect(service.updateOneById).not.toHaveBeenCalled();
    });

    it("refuses a null data payload", async () => {
      await expect(
        api.updateItem(requestWithBody({ data: null }), response),
      ).rejects.toThrow(BadDataException);

      expect(service.updateOneById).not.toHaveBeenCalled();
    });

    /*
     * A string used to survive deserialization as its own index map -
     * "abc" became { "0": "a", "1": "b", "2": "c" } - and went to the service
     * as three nonsense columns.
     */
    it("refuses a string data payload rather than indexing it into columns", async () => {
      await expect(
        api.updateItem(
          requestWithBody({ data: "abc" } as JSONObject),
          response,
        ),
      ).rejects.toThrow(BadDataException);

      expect(service.updateOneById).not.toHaveBeenCalled();
    });

    it("refuses a numeric data payload", async () => {
      await expect(
        api.updateItem(requestWithBody({ data: 42 } as JSONObject), response),
      ).rejects.toThrow(BadDataException);
    });

    it("refuses a boolean data payload", async () => {
      await expect(
        api.updateItem(requestWithBody({ data: true } as JSONObject), response),
      ).rejects.toThrow(BadDataException);
    });

    it("refuses an empty array data payload", async () => {
      await expect(
        api.updateItem(requestWithBody({ data: [] } as JSONObject), response),
      ).rejects.toThrow(BadDataException);

      expect(service.updateOneById).not.toHaveBeenCalled();
    });

    it("refuses an array of objects, which updates one row not many", async () => {
      await expect(
        api.updateItem(
          requestWithBody({ data: [{ name: "renamed-probe" }] } as JSONObject),
          response,
        ),
      ).rejects.toThrow(BadDataException);

      expect(service.updateOneById).not.toHaveBeenCalled();
    });
  });

  describe("when the payload carries no fields to write", () => {
    it("refuses an empty data object", async () => {
      await expect(
        api.updateItem(requestWithBody({ data: {} }), response),
      ).rejects.toThrow(BadDataException);

      expect(service.updateOneById).not.toHaveBeenCalled();
      expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
    });

    it("says there is nothing to update", async () => {
      await expect(
        api.updateItem(requestWithBody({ data: {} }), response),
      ).rejects.toThrow(/No fields to update/i);
    });

    /*
     * _id, createdAt and updatedAt are stripped before the write, so a payload
     * of nothing but those leaves zero columns. The emptiness check has to run
     * after the strip to catch it.
     */
    it("refuses a payload of only the fields it strips", async () => {
      const request: OneUptimeRequest = requestWithBody({
        data: {
          _id: TEST_ID,
          createdAt: "2026-07-28T20:58:55.000Z",
          updatedAt: "2026-07-28T20:58:55.000Z",
        },
      });

      await expect(api.updateItem(request, response)).rejects.toThrow(
        /No fields to update/i,
      );

      expect(service.updateOneById).not.toHaveBeenCalled();
    });
  });

  describe("when the payload is well formed", () => {
    it("writes the update and reports success", async () => {
      const request: OneUptimeRequest = requestWithBody({
        data: { name: "renamed-probe" },
      });

      await api.updateItem(request, response);

      expect(service.updateOneById).toHaveBeenCalledTimes(1);
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledWith(
        request,
        response,
      );
    });

    it("passes the payload through to the service untouched", async () => {
      await api.updateItem(
        requestWithBody({ data: { name: "renamed-probe" } }),
        response,
      );

      expect(service.updateOneById).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { name: "renamed-probe" },
        }),
      );
    });

    /*
     * The strip has to survive the new guard: a real client payload echoes
     * _id/createdAt/updatedAt back and only the remaining columns may be
     * written.
     */
    it("still strips _id, createdAt and updatedAt from a payload that also has real fields", async () => {
      await api.updateItem(
        requestWithBody({
          data: {
            _id: TEST_ID,
            createdAt: "2026-07-28T20:58:55.000Z",
            updatedAt: "2026-07-28T20:58:55.000Z",
            name: "renamed-probe",
          },
        }),
        response,
      );

      expect(service.updateOneById).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { name: "renamed-probe" },
        }),
      );
    });
  });

  /*
   * PUT /:id, POST /:id/update-item and GET /:id/update-item all land on this
   * one handler, so none of them can be left answering 200 to a payload that
   * writes nothing. GET carries no body at all.
   */
  describe("across every route that reaches updateItem", () => {
    it("refuses the flat body on the POST update-item route", async () => {
      const request: OneUptimeRequest = requestWithBody({
        content: "new-token-value",
        name: "Airflow-Token",
      });

      await expect(api.updateItem(request, response)).rejects.toThrow(
        BadDataException,
      );
    });

    it("refuses the bodyless GET update-item route instead of quietly writing nothing", async () => {
      await expect(
        api.updateItem(requestWithBody({}), response),
      ).rejects.toThrow(BadDataException);

      expect(service.updateOneById).not.toHaveBeenCalled();
    });

    it("registers all three update routes", () => {
      const crudPath: string = new Probe().getCrudApiPath()!.toString();

      expect(mockRouter.match("PUT", `${crudPath}/:id`)).toBeTruthy();
      expect(
        mockRouter.match("POST", `${crudPath}/:id/update-item`),
      ).toBeTruthy();
      expect(
        mockRouter.match("GET", `${crudPath}/:id/update-item`),
      ).toBeTruthy();
    });
  });

  /*
   * The original symptom, stated as an assertion: the customer saw
   * "response-status":200,"response-body":{} on every run while the variable
   * never changed.
   */
  it("never reports success for a request that would write nothing", async () => {
    const request: OneUptimeRequest = requestWithBody({
      content: "new-token-value",
      name: "Airflow-Token",
      description: "Token to connect to Airflow.",
    });

    await expect(api.updateItem(request, response)).rejects.toThrow(
      BadDataException,
    );

    expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
  });
});
