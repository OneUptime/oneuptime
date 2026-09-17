import BaseAPI from "../../../Server/API/BaseAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
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
 * PUT /<model>/:id answered 200 with an empty body no matter what happened.
 *
 * DatabaseService narrows the update query AFTER the caller builds it - tenant
 * scope, access-control labels, owned scope - so an update can match zero rows
 * and write nothing. updateOneById threw that count away and BaseAPI reported
 * success regardless, so the client showed a saved edit that was never
 * persisted and "disappeared" on the next page load, with no error anywhere.
 */

const TEST_ID: string = "550e8400-e29b-41d4-a716-446655440009";

describe("BaseAPI.updateItem when the update matches nothing", () => {
  let service: DatabaseService<Probe>;
  let api: BaseAPI<Probe, DatabaseService<Probe>>;
  let request: OneUptimeRequest;
  let response: ExpressResponse;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    service = new DatabaseService<Probe>(Probe);
    api = new BaseAPI<Probe, DatabaseService<Probe>>(Probe, service);

    request = {
      params: { id: TEST_ID },
      body: { data: { name: "renamed-probe" } },
      headers: {},
    } as unknown as OneUptimeRequest;

    response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;
  });

  it("reports success when a row was actually updated", async () => {
    getJestSpyOn(service, "updateOneById").mockResolvedValue(1);

    await api.updateItem(request, response);

    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledWith(
      request,
      response,
    );
  });

  it("refuses to report success when nothing was written", async () => {
    getJestSpyOn(service, "updateOneById").mockResolvedValue(0);

    await expect(api.updateItem(request, response)).rejects.toThrow(
      NotAuthorizedException,
    );

    expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
  });

  it("names the resource in the error so the message is actionable", async () => {
    getJestSpyOn(service, "updateOneById").mockResolvedValue(0);

    await expect(api.updateItem(request, response)).rejects.toThrow(/probe/i);
  });
});

describe("DatabaseService.updateOneById", () => {
  it("hands back the number of rows the update matched", async () => {
    const service: DatabaseService<Probe> = new DatabaseService<Probe>(Probe);

    getJestSpyOn(
      ModelPermission,
      "checkUpdatePermissionByModel",
    ).mockResolvedValue(undefined);
    getJestSpyOn(service, "updateOneBy").mockResolvedValue(3);

    const numberOfDocsAffected: number = await service.updateOneById({
      id: new ObjectID(TEST_ID),
      data: {} as any,
      props: { isRoot: true },
    });

    expect(numberOfDocsAffected).toBe(3);
  });

  it("hands back zero when the permission-scoped query matched no rows", async () => {
    const service: DatabaseService<Probe> = new DatabaseService<Probe>(Probe);

    getJestSpyOn(
      ModelPermission,
      "checkUpdatePermissionByModel",
    ).mockResolvedValue(undefined);
    getJestSpyOn(service, "updateOneBy").mockResolvedValue(0);

    const numberOfDocsAffected: number = await service.updateOneById({
      id: new ObjectID(TEST_ID),
      data: {} as any,
      props: { isRoot: true },
    });

    expect(numberOfDocsAffected).toBe(0);
  });
});
