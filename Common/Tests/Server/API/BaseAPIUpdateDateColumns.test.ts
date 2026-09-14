import BaseAPI from "../../../Server/API/BaseAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import { mockRouter } from "./Helpers";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import EnterpriseLicense from "../../../Models/DatabaseModels/EnterpriseLicense";
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
 * PUT /<model>/:id never builds a model — it goes from the request body
 * straight to a partial entity — so it does not get BaseModel.fromJSON's
 * coercion for free the way POST does. Without the same normalization here, a
 * PUT and a POST disagree about whether "2027-01-01" is a Date, and the
 * save-time hooks see a different type depending on which verb the caller
 * used. That is the same split that made a number column arrive as the string
 * "10" on one path and the number 10 on the other.
 */

const TEST_ID: string = "550e8400-e29b-41d4-a716-446655440009";

describe("BaseAPI.updateItem date column coercion", () => {
  let service: DatabaseService<EnterpriseLicense>;
  let api: BaseAPI<EnterpriseLicense, DatabaseService<EnterpriseLicense>>;
  let response: ExpressResponse;

  type RequestWithDataFunction = (data: JSONObject) => OneUptimeRequest;

  const requestWithData: RequestWithDataFunction = (
    data: JSONObject,
  ): OneUptimeRequest => {
    return {
      params: { id: TEST_ID },
      body: { data: data },
      headers: {},
    } as unknown as OneUptimeRequest;
  };

  type UpdatedDataFunction = () => JSONObject;

  const updatedData: UpdatedDataFunction = (): JSONObject => {
    const call: Array<unknown> = (service.updateOneById as unknown as jest.Mock)
      .mock.calls[0] as Array<unknown>;

    return (call[0] as { data: JSONObject }).data;
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    service = new DatabaseService<EnterpriseLicense>(EnterpriseLicense);
    api = new BaseAPI<EnterpriseLicense, DatabaseService<EnterpriseLicense>>(
      EnterpriseLicense,
      service,
    );

    response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;

    getJestSpyOn(service, "updateOneById").mockResolvedValue(1);
  });

  it("turns the date string an edit form posts into a Date", async () => {
    await api.updateItem(
      requestWithData({ expiresAt: "2028-06-30" }),
      response,
    );

    const data: JSONObject = updatedData();

    expect(data["expiresAt"]).toBeInstanceOf(Date);
    expect((data["expiresAt"] as Date).toISOString()).toBe(
      "2028-06-30T00:00:00.000Z",
    );
  });

  it("agrees with what a POST of the same value would have produced", async () => {
    await api.updateItem(
      requestWithData({ expiresAt: "2028-06-30" }),
      response,
    );

    const created: EnterpriseLicense = EnterpriseLicense.fromJSON(
      { expiresAt: "2028-06-30" },
      EnterpriseLicense,
    ) as EnterpriseLicense;

    expect((updatedData()["expiresAt"] as Date).getTime()).toBe(
      created.expiresAt!.getTime(),
    );
  });

  it("still coerces number columns in the same patch", async () => {
    await api.updateItem(
      requestWithData({ expiresAt: "2028-06-30", userLimit: "75" }),
      response,
    );

    const data: JSONObject = updatedData();

    expect(data["expiresAt"]).toBeInstanceOf(Date);
    expect(data["userLimit"]).toBe(75);
  });

  it("leaves the columns it does not own alone", async () => {
    await api.updateItem(
      requestWithData({
        companyName: "Acme, Inc.",
        licenseKey: "2028-06-30",
        isEvaluationLicense: true,
      }),
      response,
    );

    const data: JSONObject = updatedData();

    expect(data["companyName"]).toBe("Acme, Inc.");
    expect(data["licenseKey"]).toBe("2028-06-30");
    expect(data["isEvaluationLicense"]).toBe(true);
  });

  it("keeps an explicit null so a nullable date can be cleared", async () => {
    await api.updateItem(
      requestWithData({ userCountUpdatedAt: null }),
      response,
    );

    expect(updatedData()["userCountUpdatedAt"]).toBeNull();
  });
});
