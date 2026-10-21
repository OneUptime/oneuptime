import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ProjectService from "../../../Server/Services/ProjectService";
import {
  RunOptions,
  RunReturnType,
} from "../../../Server/Types/Workflow/ComponentCode";
import CreateManyBaseModel from "../../../Server/Types/Workflow/Components/BaseModel/CreateManyBaseModel";
import CreateOneBaseModel from "../../../Server/Types/Workflow/Components/BaseModel/CreateOneBaseModel";
import UpdateManyBaseModel from "../../../Server/Types/Workflow/Components/BaseModel/UpdateManyBaseModel";
import UpdateOneBaseModel from "../../../Server/Types/Workflow/Components/BaseModel/UpdateOneBaseModel";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { mockRouter } from "../API/Helpers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

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
 * A SWITCH WRITTEN AS TEXT IS THE SWITCH THE DATABASE STORES, WHOEVER WRITES
 * IT: the REST API (which Terraform and the CLI use), and a workflow's Create
 * and Update steps.
 *
 * Each write runs the real path - BaseAPI or the workflow component, then
 * DatabaseService - and stops at the service's first hook, which records
 * what it was handed: the boolean the database stores, never the text. A
 * value the database would refuse is refused before any hook runs, with one
 * plain message naming the field: as a 400 through the API, and in the run
 * log of a workflow, whose step takes its error port.
 *
 * No database: nothing reaches one.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-cccc-4aaa-8bbb-000000000001",
);
const RECORD_ID: string = "0193c0de-cccc-4aaa-8bbb-0000000000a1";

class AtTheHooks extends Error {}

interface Reached {
  // What each write handed the service's first hook, in order.
  writes: Array<Record<string, unknown>>;
  createHook: Mock<() => void>;
  updateHook: Mock<() => void>;
}

// Stops the service's writes at their first hook and records what they carried.
function stopAtTheHooks(service: DatabaseService<Monitor>): Reached {
  const reached: Reached = {
    writes: [],
    createHook: jest.fn<() => void>(),
    updateHook: jest.fn<() => void>(),
  };

  getJestSpyOn(service, "_onBeforeCreate").mockImplementation(
    async (createBy: { data: unknown }): Promise<never> => {
      reached.createHook();
      reached.writes.push({
        ...(createBy.data as Record<string, unknown>),
      });
      throw new AtTheHooks();
    },
  );

  getJestSpyOn(service, "onBeforeUpdate").mockImplementation(
    async (updateBy: { data: unknown }): Promise<never> => {
      reached.updateHook();
      reached.writes.push({
        ...(updateBy.data as Record<string, unknown>),
      });
      throw new AtTheHooks();
    },
  );

  return reached;
}

function runOptions(log: Array<string>): RunOptions {
  return {
    log: (message: unknown): void => {
      log.push(String(message));
    },
    workflowLogId: ObjectID.generate(),
    workflowId: ObjectID.generate(),
    projectId: PROJECT_ID,
    onError: (exception: Exception): Exception => {
      return exception;
    },
    executeWorkflow: async (): Promise<void> => {},
  };
}

function monitorService(): DatabaseService<Monitor> {
  return new DatabaseService<Monitor>(Monitor);
}

beforeEach(() => {
  stubProjectDirectory({});
  // The project's plan, which a step's props carry on a server with billing.
  jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  });
  // A component logs the stop at the hooks as its error.
  getJestSpyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a workflow step writes the switch the database stores", () => {
  /*
   * The step updates as a Project Admin of its project, so the rows it may
   * write are read before the hooks run: here, the one it names.
   */
  function withTheRecord(service: DatabaseService<Monitor>): void {
    const record: Monitor = new Monitor();
    record._id = RECORD_ID;
    record.projectId = PROJECT_ID;
    getJestSpyOn(service, "_findBy").mockResolvedValue([record]);
  }

  test.each([
    ['"yes"', "yes", true],
    ['"TRUE"', "TRUE", true],
    ['"1"', "1", true],
    ["1", 1, true],
    ['"off"', "off", false],
    ['"false"', "false", false],
    ["0", 0, false],
  ] as Array<[string, unknown, boolean]>)(
    "Create One with Disable Active Monitoring %s hands the hooks the boolean the database stores",
    async (_label: string, value: unknown, stored: boolean) => {
      const service: DatabaseService<Monitor> = monitorService();
      const reached: Reached = stopAtTheHooks(service);

      const result: RunReturnType = await new CreateOneBaseModel<Monitor>(
        service,
      ).run(
        {
          json: {
            name: "Checkout API",
            disableActiveMonitoring: value,
          } as JSONObject,
        },
        runOptions([]),
      );

      // The write stopped at the hooks, so the component took its error port.
      expect(result.executePort?.id).toBe("error");
      expect(reached.writes).toHaveLength(1);
      expect(reached.writes[0]!["disableActiveMonitoring"]).toBe(stored);
      expect(reached.writes[0]!["name"]).toBe("Checkout API");
    },
  );

  test("Create Many hands the hooks every record's switches as booleans", async () => {
    const service: DatabaseService<Monitor> = monitorService();
    const reached: Reached = stopAtTheHooks(service);

    await new CreateManyBaseModel<Monitor>(service).run(
      {
        "json-array": [
          { name: "First", disableActiveMonitoring: "on" },
        ] as Array<JSONObject>,
      },
      runOptions([]),
    );

    expect(reached.writes).toHaveLength(1);
    expect(reached.writes[0]!["disableActiveMonitoring"]).toBe(true);
  });

  test.each([
    ['"no"', "no", false],
    ['"Off"', "Off", false],
    ['"true"', "true", true],
    ["1", 1, true],
  ] as Array<[string, unknown, boolean]>)(
    "Update One with Disable Active Monitoring %s hands the hooks the boolean the database stores",
    async (_label: string, value: unknown, stored: boolean) => {
      const service: DatabaseService<Monitor> = monitorService();
      const reached: Reached = stopAtTheHooks(service);
      withTheRecord(service);

      await new UpdateOneBaseModel<Monitor>(service).run(
        {
          query: { _id: RECORD_ID },
          data: { disableActiveMonitoring: value } as JSONObject,
        },
        runOptions([]),
      );

      expect(reached.writes).toHaveLength(1);
      expect(reached.writes[0]!["disableActiveMonitoring"]).toBe(stored);
    },
  );

  test("Update Many hands the hooks the boolean too", async () => {
    const service: DatabaseService<Monitor> = monitorService();
    const reached: Reached = stopAtTheHooks(service);
    withTheRecord(service);

    await new UpdateManyBaseModel<Monitor>(service).run(
      {
        query: { _id: RECORD_ID },
        data: { disableActiveMonitoring: "0" } as JSONObject,
      },
      runOptions([]),
    );

    expect(reached.writes).toHaveLength(1);
    expect(reached.writes[0]!["disableActiveMonitoring"]).toBe(false);
  });

  test("a value the database would refuse is refused before any hook, and the run log says which field", async () => {
    const service: DatabaseService<Monitor> = monitorService();
    const reached: Reached = stopAtTheHooks(service);
    withTheRecord(service);
    const log: Array<string> = [];

    const result: RunReturnType = await new UpdateOneBaseModel<Monitor>(
      service,
    ).run(
      {
        query: { _id: RECORD_ID },
        data: { disableActiveMonitoring: "sometimes" } as JSONObject,
      },
      runOptions(log),
    );

    expect(result.executePort?.id).toBe("error");
    expect(reached.updateHook).not.toHaveBeenCalled();
    expect(log).toContain("disableActiveMonitoring must be true or false.");
  });

  test("so does Create One, for an empty text", async () => {
    const service: DatabaseService<Monitor> = monitorService();
    const reached: Reached = stopAtTheHooks(service);
    const log: Array<string> = [];

    const result: RunReturnType = await new CreateOneBaseModel<Monitor>(
      service,
    ).run(
      {
        json: { name: "Checkout API", isArchived: "" } as JSONObject,
      },
      runOptions(log),
    );

    expect(result.executePort?.id).toBe("error");
    expect(reached.createHook).not.toHaveBeenCalled();
    expect(log).toContain("isArchived must be true or false.");
  });
});

describe("the REST API - and Terraform, which writes through it - hands the service the switch the database stores", () => {
  const ROOT_IN_PROJECT: DatabaseCommonInteractionProps = {
    isRoot: true,
    tenantId: PROJECT_ID,
  };

  function api(
    service: DatabaseService<Monitor>,
  ): BaseAPI<Monitor, DatabaseService<Monitor>> {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(ROOT_IN_PROJECT as never);

    return new BaseAPI<Monitor, DatabaseService<Monitor>>(Monitor, service);
  }

  function request(data: JSONObject): OneUptimeRequest {
    return {
      params: { id: RECORD_ID },
      body: { data: data },
      headers: {},
    } as unknown as OneUptimeRequest;
  }

  function response(): ExpressResponse {
    return {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;
  }

  test.each([
    ['"true"', "true", true],
    ['" Yes "', " Yes ", true],
    ["1", 1, true],
    ['"no"', "no", false],
    ["0", 0, false],
  ] as Array<[string, unknown, boolean]>)(
    "POST with Disable Active Monitoring %s reaches the hooks as the boolean the database stores",
    async (_label: string, value: unknown, stored: boolean) => {
      const service: DatabaseService<Monitor> = monitorService();
      const reached: Reached = stopAtTheHooks(service);

      await expect(
        api(service).createItem(
          request({
            name: "Checkout API",
            disableActiveMonitoring: value,
          } as JSONObject),
          response(),
        ),
      ).rejects.toBeInstanceOf(AtTheHooks);

      expect(reached.writes[0]!["disableActiveMonitoring"]).toBe(stored);
    },
  );

  test.each([
    ['"off"', "off", false],
    ['"t"', "t", true],
  ] as Array<[string, unknown, boolean]>)(
    "PUT with Disable Active Monitoring %s reaches the hooks as the boolean the database stores",
    async (_label: string, value: unknown, stored: boolean) => {
      const service: DatabaseService<Monitor> = monitorService();
      const reached: Reached = stopAtTheHooks(service);

      await expect(
        api(service).updateItem(
          request({ disableActiveMonitoring: value } as JSONObject),
          response(),
        ),
      ).rejects.toBeInstanceOf(AtTheHooks);

      expect(reached.writes[0]!["disableActiveMonitoring"]).toBe(stored);
    },
  );

  test.each([
    ["POST", "maybe"],
    ["PUT", "maybe"],
    ["POST", 2],
    ["PUT", ""],
  ] as Array<[string, unknown]>)(
    "%s with a switch the database would refuse (%p) is a 400 naming the field, and reaches no hook",
    async (method: string, value: unknown) => {
      const service: DatabaseService<Monitor> = monitorService();
      const reached: Reached = stopAtTheHooks(service);
      const theApi: BaseAPI<Monitor, DatabaseService<Monitor>> = api(service);

      const attempt: Promise<void> =
        method === "POST"
          ? theApi.createItem(
              request({
                name: "Checkout API",
                isArchived: value,
              } as JSONObject),
              response(),
            )
          : theApi.updateItem(
              request({ isArchived: value } as JSONObject),
              response(),
            );

      await expect(attempt).rejects.toBeInstanceOf(BadDataException);
      await expect(attempt).rejects.toThrow(
        "isArchived must be true or false.",
      );
      expect(reached.createHook).not.toHaveBeenCalled();
      expect(reached.updateHook).not.toHaveBeenCalled();
    },
  );
});
