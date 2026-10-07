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
import NotFoundException from "../../../Types/Exception/NotFoundException";
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
 * PUT /<model>/:id answered 200 with an empty body no matter what happened,
 * and DELETE /<model>/:id still did.
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

  /*
   * A record the caller may not read - missing, gone, of another project or
   * outside what they may read - is answered exactly as a missing one.
   */
  it("answers a record the caller may not read as missing (404)", async () => {
    getJestSpyOn(service, "updateOneById").mockResolvedValue(0);
    getJestSpyOn(service, "findOneById").mockResolvedValue(null);

    const error: unknown = await api
      .updateItem(request, response)
      .catch((caught: unknown) => {
        return caught;
      });

    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).code).toBe(404);
    expect((error as Error).message).toBe("Probe not found.");
    expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
  });

  it("answers as missing when the caller may not read the table at all", async () => {
    getJestSpyOn(service, "updateOneById").mockResolvedValue(0);
    getJestSpyOn(service, "findOneById").mockRejectedValue(
      new NotAuthorizedException("You do not have permissions to read Probe."),
    );

    await expect(api.updateItem(request, response)).rejects.toThrow(
      NotFoundException,
    );
  });

  // One they may read but not change: refused, naming the resource.
  it("refuses a record the caller may read but not change", async () => {
    getJestSpyOn(service, "updateOneById").mockResolvedValue(0);
    getJestSpyOn(service, "findOneById").mockResolvedValue(new Probe());

    const error: unknown = await api
      .updateItem(request, response)
      .catch((caught: unknown) => {
        return caught;
      });

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect((error as Error).message).toBe(
      "You do not have permission to update this probe.",
    );
    expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
  });

  it("asks whether the record is readable with the caller's own props, for the record named", async () => {
    getJestSpyOn(service, "updateOneById").mockResolvedValue(0);
    const findOneById: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      service,
      "findOneById",
    ).mockResolvedValue(null);

    await api.updateItem(request, response).catch(() => {
      return undefined;
    });

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(
      (
        findOneById.mock.calls[0]![0] as { id: ObjectID; select: unknown }
      ).id.toString(),
    ).toBe(TEST_ID);
    expect(
      (findOneById.mock.calls[0]![0] as { select: unknown }).select,
    ).toEqual({ _id: true });
  });
});

describe("BaseAPI.deleteItem when the delete removes nothing", () => {
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
      body: {},
      headers: {},
    } as unknown as OneUptimeRequest;

    response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;
  });

  it("reports success when a row was actually deleted", async () => {
    getJestSpyOn(service, "deleteOneById").mockResolvedValue(1);

    await api.deleteItem(request, response);

    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledWith(
      request,
      response,
    );
  });

  // It used to answer 200 with nothing deleted.
  it("answers a record the caller may not read as missing (404), never a silent success", async () => {
    getJestSpyOn(service, "deleteOneById").mockResolvedValue(0);
    getJestSpyOn(service, "findOneById").mockResolvedValue(null);

    const error: unknown = await api
      .deleteItem(request, response)
      .catch((caught: unknown) => {
        return caught;
      });

    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as Error).message).toBe("Probe not found.");
    expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
  });

  it("refuses a record the caller may read but not delete", async () => {
    getJestSpyOn(service, "deleteOneById").mockResolvedValue(0);
    getJestSpyOn(service, "findOneById").mockResolvedValue(new Probe());

    await expect(api.deleteItem(request, response)).rejects.toThrow(
      new NotAuthorizedException(
        "You do not have permission to delete this probe.",
      ),
    );
    expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
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
