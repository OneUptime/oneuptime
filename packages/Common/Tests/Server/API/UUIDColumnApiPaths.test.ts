import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ProjectService from "../../../Server/Services/ProjectService";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import { EXAMPLE_UUID } from "../../../Server/Types/Database/UUIDColumnFilter";
import {
  RunOptions,
  RunReturnType,
} from "../../../Server/Types/Workflow/ComponentCode";
import CreateOneBaseModel from "../../../Server/Types/Workflow/Components/BaseModel/CreateOneBaseModel";
import UpdateOneBaseModel from "../../../Server/Types/Workflow/Components/BaseModel/UpdateOneBaseModel";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import { FindOperator } from "typeorm";

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
 * EVERY API PATH THAT HANDS POSTGRES AN ID, GIVEN ONE THAT IS NOT AN ID.
 *
 * Production Postgres logged, about once a minute,
 *
 *   ERROR: invalid input syntax for type uuid: "[object Object]"
 *
 * for a list of a project's incidents filtered by an object for
 * currentIncidentStateId, and the API answered each with a 500. The same
 * error was one request away on every other path that hands Postgres an id
 * the caller wrote. Each path here runs for real - BaseAPI's handler, or a
 * workflow's step, then DatabaseService and the permission layer - and stops
 * where SQL would be sent (the repository) or at the service's first hook:
 *
 *   - a list and a count (POST /get-list, /count): the query's ids are read
 *     as Postgres reads a uuid, or the request is a 400 naming the column,
 *     before any statement (UUIDColumnFilter, run by QueryUtil);
 *   - one record by the id in the path (get-item, update, delete): a 400
 *     before anything is read, as it already was (ObjectID.validateUUID);
 *   - a create and an update (POST, PUT, and a workflow's Create and Update
 *     steps): the ids the record gives - an ID column, the records a
 *     relation names - are held to the same rule before any hook runs, and
 *     the 400 names the column. They used to reach Postgres, often first
 *     through a lookup a check made with them, and come back a 500;
 *   - anything that still reaches Postgres some other way: its 22P02 is
 *     answered with a 400 that does not repeat the value
 *     (PostgresErrorTranslator).
 *
 * And for each, an id that is one - in every form Postgres reads, or as a
 * serialized ObjectID - goes through as it did, or as the id it holds.
 *
 * No database: a fake repository records what would have been sent.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-cccc-4aaa-8bbb-000000000001",
);
const STATE_ID: string = "5f0e8e3a-1f24-4a2f-9e4c-2b1d3c4e5f60";
const RECORD_ID: string = "0193c0de-cccc-4aaa-8bbb-0000000000a1";
const UNRESOLVED_REFERENCE: string =
  "{{local.components.monitor-find-one-1.returnValues.model._id}}";

const ROOT_IN_PROJECT: DatabaseCommonInteractionProps = {
  isRoot: true,
  tenantId: PROJECT_ID,
};

// What a statement would have been sent with, had the read reached one.
interface FakeRepository {
  find: Mock<(options: { where: Record<string, unknown> }) => Promise<[]>>;
  count: Mock<(options: { where: Record<string, unknown> }) => Promise<number>>;
}

// The service's repository, recording every read instead of sending it.
function fakeRepository(service: DatabaseService<any>): FakeRepository {
  const repository: FakeRepository = {
    find: jest.fn(async (): Promise<[]> => {
      return [];
    }),
    count: jest.fn(async (): Promise<number> => {
      return 0;
    }),
  };

  getJestSpyOn(service, "getRepository").mockReturnValue(repository as never);

  return repository;
}

// The ids a read's condition on `column` would have bound.
function boundIds(repository: FakeRepository, column: string): Array<unknown> {
  const condition: unknown = repository.find.mock.calls[0]![0].where[column];

  if (condition instanceof FindOperator) {
    return Object.values(
      (
        condition as unknown as {
          objectLiteralParameters: Record<string, unknown>;
        }
      ).objectLiteralParameters,
    );
  }

  return [condition];
}

// Every request below is made as root, in the project.
function asRootInProject(): void {
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(ROOT_IN_PROJECT as never);
}

// BaseAPI's handlers for a model, over the service a test made for it.
function incidentApi(
  service: DatabaseService<Incident>,
): BaseAPI<Incident, DatabaseService<Incident>> {
  asRootInProject();

  return new BaseAPI<Incident, DatabaseService<Incident>>(Incident, service);
}

function monitorApi(
  service: DatabaseService<Monitor>,
): BaseAPI<Monitor, DatabaseService<Monitor>> {
  asRootInProject();

  return new BaseAPI<Monitor, DatabaseService<Monitor>>(Monitor, service);
}

function request(data: { id?: string; body: JSONObject }): OneUptimeRequest {
  return {
    params: { id: data.id || RECORD_ID },
    query: {},
    body: data.body,
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

// The id a write handed the hooks, as text, whatever it was handed as.
function asText(value: unknown): unknown {
  return value instanceof ObjectID ? value.toString() : value;
}

beforeEach(() => {
  stubProjectDirectory({});
  jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  });
  // A workflow step logs the stop at the hooks as its error.
  getJestSpyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a list and a count: the production request", () => {
  /*
   * Shapes of "an object for currentIncidentStateId" the API cannot read as
   * an id, with the text forms that failed the same way. Each was a 500.
   */
  const NOT_AN_ID: Array<[string, unknown]> = [
    ["a record", { _id: STATE_ID }],
    ["an empty object", {}],
    ["an operator the API does not know", { $in: [STATE_ID] }],
    ["the text [object Object]", "[object Object]"],
    ["an unresolved workflow reference", UNRESOLVED_REFERENCE],
    ["a number", 42],
  ];

  test.each(NOT_AN_ID)(
    "POST /incident/get-list filtered by %s is a 400 naming the column, and sends nothing",
    async (_name: string, value: unknown) => {
      const service: DatabaseService<Incident> = new DatabaseService<Incident>(
        Incident,
      );
      const repository: FakeRepository = fakeRepository(service);

      const attempt: Promise<void> = incidentApi(service).getList(
        request({
          body: { query: { currentIncidentStateId: value } as JSONObject },
        }),
        response(),
      );

      await expect(attempt).rejects.toBeInstanceOf(BadDataException);
      await expect(attempt).rejects.toThrow(
        'Invalid ID for "currentIncidentStateId" in the query',
      );
      expect(repository.find).not.toHaveBeenCalled();
      expect(repository.count).not.toHaveBeenCalled();
    },
  );

  test.each(NOT_AN_ID)(
    "POST /incident/count filtered by %s is a 400 naming the column, and sends nothing",
    async (_name: string, value: unknown) => {
      const service: DatabaseService<Incident> = new DatabaseService<Incident>(
        Incident,
      );
      const repository: FakeRepository = fakeRepository(service);

      const attempt: Promise<void> = incidentApi(service).count(
        request({
          body: { query: { currentIncidentStateId: value } as JSONObject },
        }),
        response(),
      );

      await expect(attempt).rejects.toBeInstanceOf(BadDataException);
      await expect(attempt).rejects.toThrow(
        'Invalid ID for "currentIncidentStateId" in the query',
      );
      expect(repository.count).not.toHaveBeenCalled();
    },
  );

  // The relation's own name for the same filter, and its list of records.
  test.each([
    ["currentIncidentState", "Resolved"],
    ["currentIncidentState", { _type: "EqualTo", value: "abc" }],
    ["monitors", ["abc"]],
    ["monitors", { _type: "Includes", value: [{ name: "api" }] }],
  ] as Array<[string, unknown]>)(
    "POST /incident/get-list filtered on the relation %s by %p is a 400 naming it",
    async (column: string, value: unknown) => {
      const service: DatabaseService<Incident> = new DatabaseService<Incident>(
        Incident,
      );
      const repository: FakeRepository = fakeRepository(service);

      const attempt: Promise<void> = incidentApi(service).getList(
        request({ body: { query: { [column]: value } as JSONObject } }),
        response(),
      );

      await expect(attempt).rejects.toThrow(
        `Invalid ID for "${column}" in the query`,
      );
      expect(repository.find).not.toHaveBeenCalled();
    },
  );

  /*
   * No change for an id that is one: every form Postgres reads is sent as
   * it came, and a serialized ObjectID - as an object, or as the JSON text a
   * workflow writes - as the id it holds.
   */
  test.each([
    ["canonical", STATE_ID, STATE_ID],
    ["upper case", STATE_ID.toUpperCase(), STATE_ID.toUpperCase()],
    ["in braces", `{${STATE_ID}}`, `{${STATE_ID}}`],
    ["a serialized ObjectID", { _type: "ObjectID", value: STATE_ID }, STATE_ID],
    [
      "a serialized ObjectID's JSON text",
      JSON.stringify({ _type: "ObjectID", value: STATE_ID }),
      STATE_ID,
    ],
  ] as Array<[string, unknown, string]>)(
    "POST /incident/get-list filtered by an id written %s sends that id",
    async (_name: string, value: unknown, sent: string) => {
      const service: DatabaseService<Incident> = new DatabaseService<Incident>(
        Incident,
      );
      const repository: FakeRepository = fakeRepository(service);

      await incidentApi(service).getList(
        request({
          body: { query: { currentIncidentStateId: value } as JSONObject },
        }),
        response(),
      );

      expect(repository.find).toHaveBeenCalledTimes(1);
      expect(repository.count).toHaveBeenCalledTimes(1);
      expect(boundIds(repository, "currentIncidentStateId")).toEqual([sent]);
    },
  );

  test("a list of ids in Includes is sent as it was", async () => {
    const service: DatabaseService<Incident> = new DatabaseService<Incident>(
      Incident,
    );
    const repository: FakeRepository = fakeRepository(service);
    const otherId: string = ObjectID.generate().toString();

    await incidentApi(service).getList(
      request({
        body: {
          query: {
            currentIncidentStateId: {
              _type: "Includes",
              value: [STATE_ID, otherId],
            },
          },
        },
      }),
      response(),
    );

    expect(boundIds(repository, "currentIncidentStateId")).toEqual([
      [STATE_ID, otherId],
    ]);
  });
});

describe("one record by the id in its path", () => {
  // Already a 400 before this change (ObjectID.validateUUID); pinned here.
  test.each([
    ["get-item", "getItem"],
    ["update", "updateItem"],
    ["delete", "deleteItem"],
  ] as Array<[string, "getItem" | "updateItem" | "deleteItem"]>)(
    "%s with an id that is not one is a 400 before anything is read",
    async (_name: string, handler: "getItem" | "updateItem" | "deleteItem") => {
      const service: DatabaseService<Incident> = new DatabaseService<Incident>(
        Incident,
      );
      const repository: FakeRepository = fakeRepository(service);

      const attempt: Promise<void> = incidentApi(service)[handler](
        request({
          id: "[object Object]",
          body: { data: { title: "Database is down" } },
        }),
        response(),
      );

      await expect(attempt).rejects.toBeInstanceOf(BadDataException);
      await expect(attempt).rejects.toThrow(
        'Invalid ID format: "[object Object]"',
      );
      expect(repository.find).not.toHaveBeenCalled();
    },
  );
});

describe("a create and an update: the ids the record gives", () => {
  /*
   * What a create or an update may give an ID column that is no id. Each
   * used to reach Postgres - or a lookup a check made with it - and come
   * back a 500.
   */
  const NOT_AN_ID: Array<[string, unknown]> = [
    ["text that is no id", "abc"],
    ["a record", { _id: STATE_ID }],
    ["the text [object Object]", "[object Object]"],
    ["an unresolved workflow reference", UNRESOLVED_REFERENCE],
    ["a serialized ObjectID holding no id", { _type: "ObjectID", value: "x" }],
    ["a number", 42],
  ];

  test.each(NOT_AN_ID)(
    "POST /monitor with currentMonitorStatusId %s is a 400 naming the field, and reaches no hook",
    async (_name: string, value: unknown) => {
      const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
        Monitor,
      );
      const reached: Reached = stopAtTheHooks(service);

      const attempt: Promise<void> = monitorApi(service).createItem(
        request({
          body: {
            data: {
              name: "Checkout API",
              currentMonitorStatusId: value,
            } as JSONObject,
          },
        }),
        response(),
      );

      await expect(attempt).rejects.toBeInstanceOf(BadDataException);
      await expect(attempt).rejects.toThrow(
        'Invalid ID for "currentMonitorStatusId" in the data:',
      );
      expect(reached.createHook).not.toHaveBeenCalled();
    },
  );

  test.each(NOT_AN_ID)(
    "PUT /monitor/:id with currentMonitorStatusId %s is a 400 naming the field, and reaches no hook",
    async (_name: string, value: unknown) => {
      const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
        Monitor,
      );
      const reached: Reached = stopAtTheHooks(service);

      const attempt: Promise<void> = monitorApi(service).updateItem(
        request({
          body: { data: { currentMonitorStatusId: value } as JSONObject },
        }),
        response(),
      );

      await expect(attempt).rejects.toBeInstanceOf(BadDataException);
      await expect(attempt).rejects.toThrow(
        'Invalid ID for "currentMonitorStatusId" in the data:',
      );
      expect(reached.updateHook).not.toHaveBeenCalled();
    },
  );

  // The records a relation names, by id or as records.
  test.each([
    ["POST", "currentMonitorStatus", { _id: "abc" }],
    ["POST", "labels", [{ _id: STATE_ID }, { _id: "[object Object]" }]],
    ["PUT", "currentMonitorStatus", "abc"],
    ["PUT", "labels", ["abc"]],
    ["PUT", "labels", [{ id: UNRESOLVED_REFERENCE }]],
  ] as Array<[string, string, unknown]>)(
    "%s naming a record of %s by an id that is not one is a 400 naming the relation",
    async (method: string, column: string, value: unknown) => {
      const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
        Monitor,
      );
      const reached: Reached = stopAtTheHooks(service);
      const theApi: BaseAPI<Monitor, DatabaseService<Monitor>> = monitorApi(
        service,
      );

      const attempt: Promise<void> =
        method === "POST"
          ? theApi.createItem(
              request({
                body: {
                  data: { name: "Checkout API", [column]: value } as JSONObject,
                },
              }),
              response(),
            )
          : theApi.updateItem(
              request({ body: { data: { [column]: value } as JSONObject } }),
              response(),
            );

      await expect(attempt).rejects.toThrow(
        `Invalid ID for "${column}" in the data:`,
      );
      expect(reached.createHook).not.toHaveBeenCalled();
      expect(reached.updateHook).not.toHaveBeenCalled();
    },
  );

  /*
   * No change for an id that is one: it reaches the hooks as it was sent.
   * A clear and an empty text too - the column has always written "" as
   * NULL.
   */
  test.each([
    ["canonical", STATE_ID, STATE_ID],
    ["upper case", STATE_ID.toUpperCase(), STATE_ID.toUpperCase()],
    ["without hyphens", STATE_ID.replace(/-/g, ""), STATE_ID.replace(/-/g, "")],
    [
      "as a serialized ObjectID",
      { _type: "ObjectID", value: STATE_ID },
      STATE_ID,
    ],
    ["as a clear", null, null],
    ["as an empty text", "", ""],
  ] as Array<[string, unknown, unknown]>)(
    "POST and PUT with currentMonitorStatusId %s reach the hooks with that id",
    async (_name: string, value: unknown, reachedAs: unknown) => {
      for (const method of ["POST", "PUT"]) {
        const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
          Monitor,
        );
        const reached: Reached = stopAtTheHooks(service);
        const theApi: BaseAPI<Monitor, DatabaseService<Monitor>> = monitorApi(
          service,
        );

        const attempt: Promise<void> =
          method === "POST"
            ? theApi.createItem(
                request({
                  body: {
                    data: {
                      name: "Checkout API",
                      currentMonitorStatusId: value,
                    } as JSONObject,
                  },
                }),
                response(),
              )
            : theApi.updateItem(
                request({
                  body: {
                    data: { currentMonitorStatusId: value } as JSONObject,
                  },
                }),
                response(),
              );

        await expect(attempt).rejects.toBeInstanceOf(AtTheHooks);
        expect(asText(reached.writes[0]!["currentMonitorStatusId"])).toBe(
          reachedAs,
        );
      }
    },
  );

  test("PUT naming records of a relation by ids that are ids reaches the hooks with them", async () => {
    const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
      Monitor,
    );
    const reached: Reached = stopAtTheHooks(service);
    const otherId: string = ObjectID.generate().toString();

    await expect(
      monitorApi(service).updateItem(
        request({
          body: {
            data: { labels: [STATE_ID, { _id: otherId }] } as JSONObject,
          },
        }),
        response(),
      ),
    ).rejects.toBeInstanceOf(AtTheHooks);

    expect(reached.writes[0]!["labels"]).toEqual([STATE_ID, { _id: otherId }]);
  });
});

describe("a workflow's Create and Update steps", () => {
  /*
   * The step builder writes a reference in quotes, and a record's id that
   * a reference resolves to - {"_type": "ObjectID", ...}, as a record's
   * JSON holds one - is written into the string as its JSON text. Postgres
   * was asked for the uuid "{\n  "_type": "ObjectID", ...". It is the id it
   * holds.
   */
  const QUOTED_ID: string = JSON.stringify(
    { _type: "ObjectID", value: STATE_ID },
    null,
    2,
  );

  function withTheRecord(service: DatabaseService<Monitor>): void {
    const record: Monitor = new Monitor();
    record._id = RECORD_ID;
    record.projectId = PROJECT_ID;
    getJestSpyOn(service, "_findBy").mockResolvedValue([record]);
  }

  test("Create One writes the id a quoted reference resolved to", async () => {
    const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
      Monitor,
    );
    const reached: Reached = stopAtTheHooks(service);

    await new CreateOneBaseModel<Monitor>(service).run(
      {
        json: {
          name: "Checkout API",
          currentMonitorStatusId: QUOTED_ID,
        } as JSONObject,
      },
      runOptions([]),
    );

    expect(reached.writes).toHaveLength(1);
    expect(asText(reached.writes[0]!["currentMonitorStatusId"])).toBe(STATE_ID);
  });

  test("Update One writes it too", async () => {
    const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
      Monitor,
    );
    const reached: Reached = stopAtTheHooks(service);
    withTheRecord(service);

    await new UpdateOneBaseModel<Monitor>(service).run(
      {
        query: { _id: RECORD_ID },
        data: { currentMonitorStatusId: QUOTED_ID } as JSONObject,
      },
      runOptions([]),
    );

    expect(reached.writes).toHaveLength(1);
    expect(asText(reached.writes[0]!["currentMonitorStatusId"])).toBe(STATE_ID);
  });

  test("an id that is not one stops the step on its error port, and the run log names the field", async () => {
    const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
      Monitor,
    );
    const reached: Reached = stopAtTheHooks(service);
    const log: Array<string> = [];

    const result: RunReturnType = await new CreateOneBaseModel<Monitor>(
      service,
    ).run(
      {
        json: {
          name: "Checkout API",
          currentMonitorStatusId: "abc",
        } as JSONObject,
      },
      runOptions(log),
    );

    expect(result.executePort?.id).toBe("error");
    expect(reached.createHook).not.toHaveBeenCalled();
    expect(log).toContain(
      `Invalid ID for "currentMonitorStatusId" in the data: "abc" is not an ID. An ID is a UUID such as "${EXAMPLE_UUID}".`,
    );
  });
});

describe("what reaches Postgres some other way", () => {
  /*
   * A condition built by server code (here, one a custom route might build
   * from what it was sent) is not read by the query layer. Should Postgres
   * still refuse its id, the answer is a 400 that says what an ID is, not a
   * 500 - and not the value, which need not be the caller's.
   */
  test("a list whose statement Postgres refuses with 22P02 for a uuid is a 400", async () => {
    const service: DatabaseService<Incident> = new DatabaseService<Incident>(
      Incident,
    );
    const repository: FakeRepository = fakeRepository(service);

    repository.find.mockRejectedValue({
      name: "QueryFailedError",
      message: 'invalid input syntax for type uuid: "abc"',
      code: "22P02",
    } as never);

    const attempt: Promise<Array<Incident>> = service.findBy({
      query: { _id: QueryHelper.any(["abc"]) } as never,
      select: { _id: true },
      limit: 10,
      skip: 0,
      props: ROOT_IN_PROJECT,
    });

    await expect(attempt).rejects.toBeInstanceOf(BadDataException);
    await expect(attempt).rejects.toThrow(
      `An ID in this request is not valid. An ID is a UUID, such as "${EXAMPLE_UUID}".`,
    );
  });

  test("any other error Postgres answers is left as it was", async () => {
    const service: DatabaseService<Incident> = new DatabaseService<Incident>(
      Incident,
    );
    const repository: FakeRepository = fakeRepository(service);
    const failure: JSONObject = {
      name: "QueryFailedError",
      message: 'invalid input syntax for type integer: "abc"',
      code: "22P02",
    };

    repository.find.mockRejectedValue(failure as never);

    await expect(
      service.findBy({
        query: {},
        select: { _id: true },
        limit: 10,
        skip: 0,
        props: ROOT_IN_PROJECT,
      }),
    ).rejects.toBe(failure);
  });
});
