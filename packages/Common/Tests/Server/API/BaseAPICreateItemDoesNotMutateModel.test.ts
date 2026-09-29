import ProjectSCIM from "../../../Models/DatabaseModels/ProjectSCIM";
import BaseAPI from "../../../Server/API/BaseAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import CreateBy from "../../../Server/Types/Database/CreateBy";
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
 * WHY: createItem must not DELETE own properties from the model instance it
 * hands to the service, however tempting a `delete item._id` looks.
 *
 * The service asks that instance for its own column list on the way through
 * (DatabaseService.generateDefaultValues -> data.getTableColumns()), and that
 * lookup caches its answer per model CLASS for the life of the process. A
 * deleted key was therefore a column the whole process then believed the model
 * did not have, and responses - for every caller, on every route, not just
 * this one - were serialized without it. One POST, even a refused one, was
 * enough to drop `_id` from every response for that model.
 *
 * TableColumn.ts no longer reads the caller's instance, so the poisoning is
 * fixed at the source; this test exists so a future tidy-up cannot quietly
 * reintroduce the mutation and leave the next person to find out why their ids
 * vanished. It asserts on the INSTANCE that reaches the service, not on the
 * response, because the response would look right either way.
 *
 * The behaviour being preserved is unchanged: the new row must not carry a
 * client-supplied primary key, so `_id` arrives cleared (undefined), which is
 * what an unset column holds and what TypeORM reads as "no id, INSERT it".
 */

const SUPPLIED_ID: string = "550e8400-e29b-41d4-a716-446655440123";

describe("BaseAPI.createItem does not strip own properties off the model", () => {
  let service: DatabaseService<ProjectSCIM>;
  let api: BaseAPI<ProjectSCIM, DatabaseService<ProjectSCIM>>;
  let request: OneUptimeRequest;
  let response: ExpressResponse;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    service = new DatabaseService<ProjectSCIM>(ProjectSCIM);
    api = new BaseAPI<ProjectSCIM, DatabaseService<ProjectSCIM>>(
      ProjectSCIM,
      service,
    );

    request = {
      params: {},
      body: {
        data: {
          _id: SUPPLIED_ID,
          name: "a scim configuration",
          projectId: new ObjectID(
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          ).toString(),
        },
      },
      headers: {},
    } as unknown as OneUptimeRequest;

    response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;
  });

  it("keeps _id as an own property of the instance it passes to the service, cleared rather than deleted", async () => {
    const created: ProjectSCIM = new ProjectSCIM();
    created._id = "22222222-2222-4222-8222-222222222222";

    const createSpy: jest.Mock = getJestSpyOn(
      service,
      "create",
    ).mockResolvedValue(created) as unknown as jest.Mock;

    await api.createItem(request, response);

    const createBy: CreateBy<ProjectSCIM> = createSpy.mock
      .calls[0]![0] as CreateBy<ProjectSCIM>;
    const item: ProjectSCIM = createBy.data;

    // the column is still declared on the instance...
    expect(Object.keys(item)).toContain("_id");
    expect(Object.prototype.hasOwnProperty.call(item, "_id")).toBe(true);

    // ...and, as before, the client's id is not carried into the new row
    expect(item._id).toBeUndefined();
    expect(item.name).toBe("a scim configuration");

    /*
     * Asking that very instance for its columns is what the service does
     * next. It must still describe the class completely.
     */
    expect(item.getTableColumns().columns).toContain("_id");
  });

  it("leaves a fresh instance of the model able to report _id after the request", async () => {
    getJestSpyOn(service, "create").mockResolvedValue(new ProjectSCIM());

    await api.createItem(request, response);

    expect(new ProjectSCIM().getTableColumns().columns).toContain("_id");
  });
});
