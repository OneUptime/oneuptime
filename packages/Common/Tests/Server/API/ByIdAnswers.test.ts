import "../TestingUtils/Init";
import BaseAPI from "../../../Server/API/BaseAPI";
import BaseAnalyticsAPI from "../../../Server/API/BaseAnalyticsAPI";
import AnalyticsDatabaseService from "../../../Server/Services/AnalyticsDatabaseService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import AnalyticsModelPermission from "../../../Server/Types/AnalyticsDatabase/ModelPermission";
import AnalyticsQuery from "../../../Server/Types/AnalyticsDatabase/Query";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import MonitorLog from "../../../Models/AnalyticsModels/MonitorLog";
import Probe from "../../../Models/DatabaseModels/Probe";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
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
 * ONE ANSWER FOR A RECORD NAMED BY ITS ID THAT THE CALLER CANNOT REACH.
 *
 *   - Reading it (get-item) answers 404 when it does not exist, is in
 *     another project or is one the caller may not read - the same answer
 *     a change or a delete of it gets, never 200 with an empty body.
 *   - Changing or deleting a row of telemetry by its id answers like a
 *     database record: 404 for a row the caller may not read, 422 for one
 *     they may read but not change or delete, 200 only when the write
 *     reached it.
 */

const TEST_ID: string = "550e8400-e29b-41d4-a716-446655440031";

const responseStub: () => ExpressResponse = (): ExpressResponse => {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;
};

const requestFor: (body: unknown) => OneUptimeRequest = (
  body: unknown,
): OneUptimeRequest => {
  return {
    params: { id: TEST_ID },
    body: body,
    headers: {},
  } as unknown as OneUptimeRequest;
};

const errorOf: (promise: Promise<unknown>) => Promise<unknown> = async (
  promise: Promise<unknown>,
): Promise<unknown> => {
  return await promise.then(
    () => {
      return undefined;
    },
    (caught: unknown) => {
      return caught;
    },
  );
};

describe("BaseAPI.getItem", () => {
  let service: DatabaseService<Probe>;
  let api: BaseAPI<Probe, DatabaseService<Probe>>;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    service = new DatabaseService<Probe>(Probe);
    api = new BaseAPI<Probe, DatabaseService<Probe>>(Probe, service);
  });

  it("answers the record the caller may read", async () => {
    const probe: Probe = new Probe();
    getJestSpyOn(service, "findOneById").mockResolvedValue(probe);

    const request: OneUptimeRequest = requestFor({});
    const response: ExpressResponse = responseStub();

    await api.getItem(request, response);

    expect(Response.sendEntityResponse).toHaveBeenCalledWith(
      request,
      response,
      probe,
      Probe,
    );
  });

  it("answers a record that is missing or unreadable as missing (404), with no body", async () => {
    getJestSpyOn(service, "findOneById").mockResolvedValue(null);

    const error: unknown = await errorOf(
      api.getItem(requestFor({}), responseStub()),
    );

    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).code).toBe(404);
    expect((error as Error).message).toBe("Probe not found.");
    expect(Response.sendEntityResponse).not.toHaveBeenCalled();
  });

  it("keeps a refusal of the table a refusal, not an answer about the record", async () => {
    const refusal: NotAuthorizedException = new NotAuthorizedException(
      "You do not have permissions to read Probe.",
    );
    getJestSpyOn(service, "findOneById").mockRejectedValue(refusal);

    await expect(api.getItem(requestFor({}), responseStub())).rejects.toBe(
      refusal,
    );
  });

  it("reads the record by the id in the path", async () => {
    const findOneById: jest.Mock = getJestSpyOn(
      service,
      "findOneById",
    ).mockResolvedValue(new Probe()) as unknown as jest.Mock;

    await api.getItem(requestFor({ select: { name: true } }), responseStub());

    expect(
      (findOneById.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
    ).toBe(TEST_ID);
  });
});

describe("BaseAnalyticsAPI by id", () => {
  let service: AnalyticsDatabaseService<MonitorLog>;
  let api: BaseAnalyticsAPI<MonitorLog, AnalyticsDatabaseService<MonitorLog>>;

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
  });

  describe("getItem", () => {
    it("answers the row the caller may read", async () => {
      const log: MonitorLog = new MonitorLog();
      getJestSpyOn(service, "findOneById").mockResolvedValue(log);

      const request: OneUptimeRequest = requestFor({});
      const response: ExpressResponse = responseStub();

      await api.getItem(request, response);

      expect(Response.sendEntityResponse).toHaveBeenCalledWith(
        request,
        response,
        log,
        MonitorLog,
      );
    });

    it("answers a row that is missing or unreadable as missing (404)", async () => {
      getJestSpyOn(service, "findOneById").mockResolvedValue(null);

      const error: unknown = await errorOf(
        api.getItem(requestFor({}), responseStub()),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as Error).message).toBe("Monitor Log not found.");
      expect(Response.sendEntityResponse).not.toHaveBeenCalled();
    });
  });

  describe("deleteItem", () => {
    it("reports success when the delete reached the row", async () => {
      getJestSpyOn(service, "deleteOneById").mockResolvedValue(1);

      const request: OneUptimeRequest = requestFor({});
      const response: ExpressResponse = responseStub();

      await api.deleteItem(request, response);

      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledWith(
        request,
        response,
      );
    });

    it("answers a row the caller may not read as missing (404)", async () => {
      getJestSpyOn(service, "deleteOneById").mockResolvedValue(0);
      getJestSpyOn(service, "findOneById").mockResolvedValue(null);

      const error: unknown = await errorOf(
        api.deleteItem(requestFor({}), responseStub()),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as Error).message).toBe("Monitor Log not found.");
      expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
    });

    it("answers as missing when the caller may not read the table at all", async () => {
      getJestSpyOn(service, "deleteOneById").mockResolvedValue(0);
      getJestSpyOn(service, "findOneById").mockRejectedValue(
        new NotAuthorizedException(
          "You do not have permissions to read Monitor Log.",
        ),
      );

      await expect(
        api.deleteItem(requestFor({}), responseStub()),
      ).rejects.toThrow(NotFoundException);
    });

    it("refuses a row the caller may read but not delete (422)", async () => {
      getJestSpyOn(service, "deleteOneById").mockResolvedValue(0);
      getJestSpyOn(service, "findOneById").mockResolvedValue(new MonitorLog());

      const error: unknown = await errorOf(
        api.deleteItem(requestFor({}), responseStub()),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect((error as NotAuthorizedException).code).toBe(422);
      expect((error as Error).message).toBe(
        "You do not have permission to delete this monitor log.",
      );
    });

    it("raises a lookup that fails as it is, never as missing", async () => {
      const failure: Error = new Error("ClickHouse is not reachable.");
      getJestSpyOn(service, "deleteOneById").mockResolvedValue(0);
      getJestSpyOn(service, "findOneById").mockRejectedValue(failure);

      await expect(api.deleteItem(requestFor({}), responseStub())).rejects.toBe(
        failure,
      );
    });
  });

  describe("updateItem", () => {
    const body: unknown = { data: { logBody: { message: "changed" } } };

    it("reports success when the update reached the row", async () => {
      getJestSpyOn(service, "updateOneById").mockResolvedValue(1);

      const request: OneUptimeRequest = requestFor(body);
      const response: ExpressResponse = responseStub();

      await api.updateItem(request, response);

      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledWith(
        request,
        response,
      );
    });

    it("answers a row the caller may not read as missing (404)", async () => {
      getJestSpyOn(service, "updateOneById").mockResolvedValue(0);
      getJestSpyOn(service, "findOneById").mockResolvedValue(null);

      await expect(
        api.updateItem(requestFor(body), responseStub()),
      ).rejects.toThrow(NotFoundException);
      expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
    });

    it("refuses a row the caller may read but not change (422)", async () => {
      getJestSpyOn(service, "updateOneById").mockResolvedValue(0);
      getJestSpyOn(service, "findOneById").mockResolvedValue(new MonitorLog());

      const error: unknown = await errorOf(
        api.updateItem(requestFor(body), responseStub()),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect((error as Error).message).toBe(
        "You do not have permission to update this monitor log.",
      );
    });
  });
});

describe("AnalyticsDatabaseService writes by id", () => {
  let service: AnalyticsDatabaseService<MonitorLog>;
  const props: DatabaseCommonInteractionProps = {
    tenantId: ObjectID.generate(),
    userId: ObjectID.generate(),
  };
  const scopedQuery: AnalyticsQuery<MonitorLog> = {
    _id: TEST_ID,
    projectId: props.tenantId,
    monitorId: new Includes([ObjectID.generate()]),
  } as unknown as AnalyticsQuery<MonitorLog>;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    service = new AnalyticsDatabaseService<MonitorLog>({
      modelType: MonitorLog,
    });
  });

  it("deletes the row only when the delete's own scope reaches it, and says so", async () => {
    const checkDelete: jest.Mock = getJestSpyOn(
      AnalyticsModelPermission,
      "checkDeletePermission",
    ).mockResolvedValue(scopedQuery) as unknown as jest.Mock;
    const existsBy: jest.Mock = getJestSpyOn(
      service,
      "existsBy",
    ).mockResolvedValue(true) as unknown as jest.Mock;
    const deleteBy: jest.Mock = getJestSpyOn(
      service,
      "deleteBy",
    ).mockResolvedValue(undefined) as unknown as jest.Mock;

    expect(
      await service.deleteOneById({ id: new ObjectID(TEST_ID), props }),
    ).toBe(1);

    // The row is looked up under the scope the delete runs with.
    expect(checkDelete).toHaveBeenCalledWith(
      MonitorLog,
      { _id: TEST_ID },
      props,
    );
    expect(existsBy).toHaveBeenCalledWith({
      query: scopedQuery,
      props: { isRoot: true },
    });
    expect(deleteBy).toHaveBeenCalledWith({
      query: { _id: TEST_ID },
      props: props,
    });
  });

  it("deletes nothing when the row is out of reach, and answers 0", async () => {
    getJestSpyOn(
      AnalyticsModelPermission,
      "checkDeletePermission",
    ).mockResolvedValue(scopedQuery);
    getJestSpyOn(service, "existsBy").mockResolvedValue(false);
    const deleteBy: jest.Mock = getJestSpyOn(
      service,
      "deleteBy",
    ).mockResolvedValue(undefined) as unknown as jest.Mock;

    expect(
      await service.deleteOneById({ id: new ObjectID(TEST_ID), props }),
    ).toBe(0);
    expect(deleteBy).not.toHaveBeenCalled();
  });

  it("refuses as the delete would when the caller may not delete on the table at all", async () => {
    const refusal: NotAuthorizedException = new NotAuthorizedException(
      "You do not have permissions to delete Monitor Log.",
    );
    getJestSpyOn(
      AnalyticsModelPermission,
      "checkDeletePermission",
    ).mockRejectedValue(refusal);
    const deleteBy: jest.Mock = getJestSpyOn(
      service,
      "deleteBy",
    ).mockResolvedValue(undefined) as unknown as jest.Mock;

    await expect(
      service.deleteOneById({ id: new ObjectID(TEST_ID), props }),
    ).rejects.toBe(refusal);
    expect(deleteBy).not.toHaveBeenCalled();
  });

  it("updates the row only when the update's own scope reaches it", async () => {
    const data: MonitorLog = new MonitorLog();
    const checkUpdate: jest.Mock = getJestSpyOn(
      AnalyticsModelPermission,
      "checkUpdatePermissions",
    ).mockResolvedValue(scopedQuery) as unknown as jest.Mock;
    getJestSpyOn(service, "existsBy").mockResolvedValue(true);
    const updateBy: jest.Mock = getJestSpyOn(
      service,
      "updateBy",
    ).mockResolvedValue(undefined) as unknown as jest.Mock;

    expect(
      await service.updateOneById({
        id: new ObjectID(TEST_ID),
        data: data,
        props,
      }),
    ).toBe(1);

    expect(checkUpdate).toHaveBeenCalledWith(
      MonitorLog,
      { _id: TEST_ID },
      data,
      props,
    );
    expect(updateBy).toHaveBeenCalledWith({
      query: { _id: TEST_ID },
      data: data,
      props: props,
    });
  });

  it("updates nothing when the row is out of reach, and answers 0", async () => {
    getJestSpyOn(
      AnalyticsModelPermission,
      "checkUpdatePermissions",
    ).mockResolvedValue(scopedQuery);
    getJestSpyOn(service, "existsBy").mockResolvedValue(false);
    const updateBy: jest.Mock = getJestSpyOn(
      service,
      "updateBy",
    ).mockResolvedValue(undefined) as unknown as jest.Mock;

    expect(
      await service.updateOneById({
        id: new ObjectID(TEST_ID),
        data: new MonitorLog(),
        props,
      }),
    ).toBe(0);
    expect(updateBy).not.toHaveBeenCalled();
  });

  it("says why a write by id reached nothing: missing (404) or refused (422)", async () => {
    getJestSpyOn(service, "findOneById").mockResolvedValue(null);

    const missing: Error = await service.getUnwrittenByIdError({
      id: new ObjectID(TEST_ID),
      props,
      type: DatabaseRequestType.Delete,
    });

    expect(missing).toBeInstanceOf(NotFoundException);

    getJestSpyOn(service, "findOneById").mockResolvedValue(new MonitorLog());

    const refused: Error = await service.getUnwrittenByIdError({
      id: new ObjectID(TEST_ID),
      props,
      type: DatabaseRequestType.Update,
    });

    expect(refused).toBeInstanceOf(NotAuthorizedException);
    expect(refused.message).toBe(
      "You do not have permission to update this monitor log.",
    );
  });
});
