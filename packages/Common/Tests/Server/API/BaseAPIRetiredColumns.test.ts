import Monitor from "../../../Models/DatabaseModels/Monitor";
import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { FIELDS_LEFT_OUT_HEADER } from "../../../Types/API/FieldsLeftOut";
import PositiveNumber from "../../../Types/PositiveNumber";
import { mockRouter } from "./Helpers";
import { getJestSpyOn } from "../../Spy";
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
 * THE API, ASKED FOR WHO DELETED A RECORD AFTER THE COLUMN WENT (#10469).
 *
 * A list or a record read with a select that names deletedByUserId or
 * deletedByUser is answered with each as null, as it was while the column
 * was there and nothing wrote it: BaseAPI tells the response which, from
 * the select as the client sent it (DatabaseService leaves them out of the
 * read itself). A create that sends one is told it was left out, as a value
 * for a column only OneUptime writes was (FieldsLeftOut).
 */

const RECORD_ID: string = "0193c0de-aaaa-4aaa-8bbb-0000000000a1";

describe("BaseAPI and the columns every record had", () => {
  let service: DatabaseService<Monitor>;
  let api: BaseAPI<Monitor, DatabaseService<Monitor>>;
  let response: ExpressResponse;
  let headers: Record<string, unknown>;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    service = new DatabaseService<Monitor>(Monitor);
    api = new BaseAPI<Monitor, DatabaseService<Monitor>>(Monitor, service);
    headers = {};

    response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      setHeader: jest.fn((name: string, value: unknown) => {
        headers[name] = value;
      }),
    } as unknown as ExpressResponse;

    getJestSpyOn(CommonAPI, "getDatabaseCommonInteractionProps").mockResolvedValue(
      { isRoot: true },
    );
    getJestSpyOn(api, "assertProductIsOn").mockResolvedValue(undefined);
  });

  function request(body: unknown, params: unknown = {}): OneUptimeRequest {
    return {
      params: params,
      query: {},
      body: body,
      headers: {},
    } as unknown as OneUptimeRequest;
  }

  it("answers a list's records with the retired columns its select named, as null", async () => {
    getJestSpyOn(service, "findBy").mockResolvedValue([new Monitor()]);
    getJestSpyOn(service, "countBy").mockResolvedValue(new PositiveNumber(1));

    await api.getList(
      request({
        query: {},
        select: { name: true, deletedByUserId: true, deletedByUser: { name: true } },
      }),
      response,
    );

    expect(Response.sendEntityArrayResponse).toHaveBeenCalledWith(
      expect.anything(),
      response,
      expect.any(Array),
      expect.any(PositiveNumber),
      Monitor,
      { retiredColumns: ["deletedByUserId", "deletedByUser"] },
    );
  });

  it("names none when the select named none", async () => {
    getJestSpyOn(service, "findBy").mockResolvedValue([]);
    getJestSpyOn(service, "countBy").mockResolvedValue(new PositiveNumber(0));

    await api.getList(request({ select: { name: true } }), response);

    expect(Response.sendEntityArrayResponse).toHaveBeenCalledWith(
      expect.anything(),
      response,
      [],
      expect.any(PositiveNumber),
      Monitor,
      { retiredColumns: [] },
    );
  });

  it("answers one record the same way", async () => {
    const monitor: Monitor = new Monitor();
    monitor._id = RECORD_ID;
    getJestSpyOn(service, "findOneById").mockResolvedValue(monitor);

    await api.getItem(
      request({ select: { name: true, deletedByUserId: true } }, { id: RECORD_ID }),
      response,
    );

    expect(Response.sendEntityResponse).toHaveBeenCalledWith(
      expect.anything(),
      response,
      monitor,
      Monitor,
      { retiredColumns: ["deletedByUserId"] },
    );
  });

  it("tells a create that sent one it was left out, and creates the record without it", async () => {
    const create: jest.SpyInstance = getJestSpyOn(service, "create").mockResolvedValue(
      new Monitor(),
    );

    await api.createItem(
      request({
        data: { name: "API", deletedByUserId: RECORD_ID },
      }),
      response,
    );

    const createBy: CreateBy<Monitor> = create.mock
      .calls[0]![0] as CreateBy<Monitor>;

    expect(createBy.data.name).toBe("API");
    expect(Object.keys(createBy.data)).not.toContain("deletedByUserId");
    expect(createBy.fieldsLeftOut).toEqual(["deletedByUserId"]);
    expect(headers[FIELDS_LEFT_OUT_HEADER]).toBe("deletedByUserId");
  });

  it("says nothing was left out of a create that sent none", async () => {
    getJestSpyOn(service, "create").mockResolvedValue(new Monitor());

    await api.createItem(request({ data: { name: "API" } }), response);

    expect(headers[FIELDS_LEFT_OUT_HEADER]).toBeUndefined();
  });
});
