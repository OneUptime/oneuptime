import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import CreateManyBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/CreateManyBaseModel";
import CreateOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/CreateOneBaseModel";
import DeleteManyBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/DeleteManyBaseModel";
import DeleteOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/DeleteOneBaseModel";
import FindManyBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/FindManyBaseModel";
import FindOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/FindOneBaseModel";
import UpdateManyBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/UpdateManyBaseModel";
import UpdateOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/UpdateOneBaseModel";
import DatabaseService from "../../../../../Server/Services/DatabaseService";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * https://github.com/OneUptime/oneuptime/issues/3132 - "Update One Monitor"
 * with a query of {"id": "<uuid>"} logged
 * `Property "id" was not found in "Monitor". Make sure your query is correct.`
 * and took the Error port, because the persisted primary key column is "_id"
 * and "id" is only a TypeScript accessor on the model.
 *
 * These tests drive the real components and assert on the query object that
 * actually reaches DatabaseService, which is the seam the bug lived in. They
 * also pin three things found alongside it: Update Many dropped the tenant
 * filter on its way to the database, the write components discarded the
 * affected-row count, and Create Many created nothing at all for a model
 * without a tenant column.
 */

const MONITOR_ID: string = "09dc4d63-2fc3-4757-a509-5f688ae38ffd";
const MONITOR_STATUS_ID: string = "dfadda01-fdf6-4cdd-921d-73edcfd71124";

interface OptionsFixture {
  options: RunOptions;
  log: jest.Mock;
  onError: jest.Mock;
  projectId: ObjectID;
}

function makeOptions(): OptionsFixture {
  const log: jest.Mock = jest.fn();
  const onError: jest.Mock = jest.fn((exception: Exception): Exception => {
    return exception;
  });
  const projectId: ObjectID = ObjectID.generate();

  return {
    log,
    onError,
    projectId,
    options: {
      log: log as RunOptions["log"],
      workflowLogId: ObjectID.generate(),
      workflowId: ObjectID.generate(),
      projectId: projectId,
      onError: onError as RunOptions["onError"],
      executeWorkflow: async (): Promise<void> => {},
    },
  };
}

function makeMonitorService(): DatabaseService<Monitor> {
  return new DatabaseService<Monitor>(Monitor);
}

/*
 * Every component calls exactly one DatabaseService method, so the assertions
 * read the first argument of that one call.
 */
function firstCallArgument(mocked: unknown): JSONObject {
  const calls: Array<Array<unknown>> = (mocked as jest.Mock).mock.calls;
  return calls[0]![0] as JSONObject;
}

function loggedLines(log: jest.Mock): string {
  return log.mock.calls
    .flat()
    .map((line: unknown): string => {
      return String(line);
    })
    .join("\n");
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Update One - the component reported in issue 3132", () => {
  test('accepts a query keyed on "id" and queries the "_id" column', async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    jest.spyOn(service, "updateOneBy").mockResolvedValue(1 as never);

    const fixture: OptionsFixture = makeOptions();
    const component: UpdateOneBaseModel<Monitor> =
      new UpdateOneBaseModel<Monitor>(service);

    const result: RunReturnType = await component.run(
      {
        query: { id: MONITOR_ID },
        data: { currentMonitorStatusId: MONITOR_STATUS_ID },
      },
      fixture.options,
    );

    const query: JSONObject = firstCallArgument(service.updateOneBy)[
      "query"
    ] as JSONObject;

    expect(result.executePort?.id).toBe("success");
    expect(query["_id"]).toBe(MONITOR_ID);
    expect(query["id"]).toBeUndefined();
  });

  test("still accepts a query keyed on _id", async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    jest.spyOn(service, "updateOneBy").mockResolvedValue(1 as never);

    const fixture: OptionsFixture = makeOptions();
    const component: UpdateOneBaseModel<Monitor> =
      new UpdateOneBaseModel<Monitor>(service);

    const result: RunReturnType = await component.run(
      { query: { _id: MONITOR_ID }, data: { isEnabled: true } },
      fixture.options,
    );

    const query: JSONObject = firstCallArgument(service.updateOneBy)[
      "query"
    ] as JSONObject;

    expect(result.executePort?.id).toBe("success");
    expect(query["_id"]).toBe(MONITOR_ID);
  });

  test('accepts "id" in the Data argument too', async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    jest.spyOn(service, "updateOneBy").mockResolvedValue(1 as never);

    const fixture: OptionsFixture = makeOptions();
    const component: UpdateOneBaseModel<Monitor> =
      new UpdateOneBaseModel<Monitor>(service);

    await component.run(
      { query: { _id: MONITOR_ID }, data: { id: MONITOR_ID } },
      fixture.options,
    );

    const data: JSONObject = firstCallArgument(service.updateOneBy)[
      "data"
    ] as JSONObject;

    expect(data["_id"]).toBe(MONITOR_ID);
    expect(data["id"]).toBeUndefined();
  });

  test("accepts the JSON strings the workflow runner really passes", async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    jest.spyOn(service, "updateOneBy").mockResolvedValue(1 as never);

    const fixture: OptionsFixture = makeOptions();
    const component: UpdateOneBaseModel<Monitor> =
      new UpdateOneBaseModel<Monitor>(service);

    const result: RunReturnType = await component.run(
      {
        query: JSON.stringify({ id: MONITOR_ID }),
        data: JSON.stringify({ currentMonitorStatusId: MONITOR_STATUS_ID }),
      },
      fixture.options,
    );

    const query: JSONObject = firstCallArgument(service.updateOneBy)[
      "query"
    ] as JSONObject;

    expect(result.executePort?.id).toBe("success");
    expect(query["_id"]).toBe(MONITOR_ID);
  });

  test("scopes the query to the running project", async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    jest.spyOn(service, "updateOneBy").mockResolvedValue(1 as never);

    const fixture: OptionsFixture = makeOptions();
    const component: UpdateOneBaseModel<Monitor> =
      new UpdateOneBaseModel<Monitor>(service);

    await component.run(
      { query: { id: MONITOR_ID }, data: { isEnabled: true } },
      fixture.options,
    );

    const query: JSONObject = firstCallArgument(service.updateOneBy)[
      "query"
    ] as JSONObject;

    expect(query["projectId"]).toBe(fixture.projectId);
  });

  test("reports how many records it updated", async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    jest.spyOn(service, "updateOneBy").mockResolvedValue(1 as never);

    const fixture: OptionsFixture = makeOptions();
    const component: UpdateOneBaseModel<Monitor> =
      new UpdateOneBaseModel<Monitor>(service);

    const result: RunReturnType = await component.run(
      { query: { id: MONITOR_ID }, data: { isEnabled: true } },
      fixture.options,
    );

    expect(result.returnValues["items-updated"]).toBe(1);
    expect(loggedLines(fixture.log)).toContain("Updated 1 Monitor(s).");
  });

  test("says so when the query matched nothing, instead of a bare success", async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    jest.spyOn(service, "updateOneBy").mockResolvedValue(0 as never);

    const fixture: OptionsFixture = makeOptions();
    const component: UpdateOneBaseModel<Monitor> =
      new UpdateOneBaseModel<Monitor>(service);

    const result: RunReturnType = await component.run(
      { query: { id: MONITOR_ID }, data: { isEnabled: true } },
      fixture.options,
    );

    expect(result.executePort?.id).toBe("success");
    expect(result.returnValues["items-updated"]).toBe(0);
    expect(loggedLines(fixture.log)).toContain("Updated 0 Monitor(s).");
  });

  test("takes the error port and explains an unknown column", async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    jest
      .spyOn(service, "updateOneBy")
      .mockRejectedValue(
        new Error(
          'Property "currentStatus" was not found in "Monitor". Make sure your query is correct.',
        ) as never,
      );

    const fixture: OptionsFixture = makeOptions();
    const component: UpdateOneBaseModel<Monitor> =
      new UpdateOneBaseModel<Monitor>(service);

    const result: RunReturnType = await component.run(
      { query: { currentStatus: "up" }, data: { isEnabled: true } },
      fixture.options,
    );

    const logs: string = loggedLines(fixture.log);

    expect(result.executePort?.id).toBe("error");
    expect(logs).toContain("Error running component");
    expect(logs).toContain('"currentStatus" is not a column on Monitor');
    expect(logs).toContain("currentMonitorStatusId");
  });

  test("cannot move the record into another project via the project relation", async () => {
    /*
     * Monitor.project is @JoinColumn({name: "projectId"}), the same physical
     * column the tenant stamp writes, and TypeORM reads the relation property
     * first. A Data payload naming another project therefore used to beat the
     * stamp and re-home the row.
     */
    const service: DatabaseService<Monitor> = makeMonitorService();
    jest.spyOn(service, "updateOneBy").mockResolvedValue(1 as never);

    const fixture: OptionsFixture = makeOptions();
    const component: UpdateOneBaseModel<Monitor> =
      new UpdateOneBaseModel<Monitor>(service);

    await component.run(
      {
        query: { id: MONITOR_ID },
        data: {
          isEnabled: true,
          project: "11111111-1111-1111-1111-111111111111",
        },
      },
      fixture.options,
    );

    const data: JSONObject = firstCallArgument(service.updateOneBy)[
      "data"
    ] as JSONObject;

    expect(data["project"]).toBeUndefined();
    expect(data["projectId"]).toBe(fixture.projectId);
    expect(data["isEnabled"]).toBe(true);
  });

  test("cannot move the record via the project relation written as an object", async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    jest.spyOn(service, "updateOneBy").mockResolvedValue(1 as never);

    const fixture: OptionsFixture = makeOptions();
    const component: UpdateOneBaseModel<Monitor> =
      new UpdateOneBaseModel<Monitor>(service);

    await component.run(
      {
        query: { id: MONITOR_ID },
        data: { project: { id: "11111111-1111-1111-1111-111111111111" } },
      },
      fixture.options,
    );

    const data: JSONObject = firstCallArgument(service.updateOneBy)[
      "data"
    ] as JSONObject;

    expect(data["project"]).toBeUndefined();
    expect(data["projectId"]).toBe(fixture.projectId);
  });

  test("routes a missing query to the error port without crashing", async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    const updateOneBy: jest.Mock = jest
      .spyOn(service, "updateOneBy")
      .mockResolvedValue(1 as never) as unknown as jest.Mock;

    const fixture: OptionsFixture = makeOptions();
    const component: UpdateOneBaseModel<Monitor> =
      new UpdateOneBaseModel<Monitor>(service);

    const result: RunReturnType = await component.run(
      { data: { isEnabled: true } },
      fixture.options,
    );

    expect(result.executePort?.id).toBe("error");
    expect(updateOneBy).not.toHaveBeenCalled();
  });
});

describe("Update Many", () => {
  test('accepts a query keyed on "id"', async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    jest.spyOn(service, "updateBy").mockResolvedValue(2 as never);

    const fixture: OptionsFixture = makeOptions();
    const component: UpdateManyBaseModel<Monitor> =
      new UpdateManyBaseModel<Monitor>(service);

    const result: RunReturnType = await component.run(
      { query: { id: MONITOR_ID }, data: { isEnabled: true } },
      fixture.options,
    );

    const query: JSONObject = firstCallArgument(service.updateBy)[
      "query"
    ] as JSONObject;

    expect(result.executePort?.id).toBe("success");
    expect(query["_id"]).toBe(MONITOR_ID);
    expect(query["id"]).toBeUndefined();
  });

  test("scopes the query to the running project", async () => {
    /*
     * Regression test. The tenant column was written to args["query"] after
     * JSONFunctions.deserialize had already copied it into a new object, so
     * the query that reached the database carried no projectId - and an update
     * running as root is not re-scoped by the permission layer, which put rows
     * in other projects in reach of a broad Update Many.
     */
    const service: DatabaseService<Monitor> = makeMonitorService();
    jest.spyOn(service, "updateBy").mockResolvedValue(2 as never);

    const fixture: OptionsFixture = makeOptions();
    const component: UpdateManyBaseModel<Monitor> =
      new UpdateManyBaseModel<Monitor>(service);

    await component.run(
      { query: { monitorType: "Website" }, data: { isEnabled: true } },
      fixture.options,
    );

    const query: JSONObject = firstCallArgument(service.updateBy)[
      "query"
    ] as JSONObject;

    expect(query["projectId"]).toBe(fixture.projectId);
    expect(query["monitorType"]).toBe("Website");
  });

  test("cannot move records into another project via the project relation", async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    jest.spyOn(service, "updateBy").mockResolvedValue(2 as never);

    const fixture: OptionsFixture = makeOptions();
    const component: UpdateManyBaseModel<Monitor> =
      new UpdateManyBaseModel<Monitor>(service);

    await component.run(
      {
        query: { monitorType: "Website" },
        data: { project: "11111111-1111-1111-1111-111111111111" },
      },
      fixture.options,
    );

    const data: JSONObject = firstCallArgument(service.updateBy)[
      "data"
    ] as JSONObject;

    expect(data["project"]).toBeUndefined();
    expect(data["projectId"]).toBe(fixture.projectId);
  });

  test("reports how many records it updated", async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    jest.spyOn(service, "updateBy").mockResolvedValue(7 as never);

    const fixture: OptionsFixture = makeOptions();
    const component: UpdateManyBaseModel<Monitor> =
      new UpdateManyBaseModel<Monitor>(service);

    const result: RunReturnType = await component.run(
      { query: { monitorType: "Website" }, data: { isEnabled: true } },
      fixture.options,
    );

    expect(result.returnValues["items-updated"]).toBe(7);
    expect(loggedLines(fixture.log)).toContain("Updated 7 Monitor(s).");
  });
});

describe("Delete One", () => {
  test('accepts a query keyed on "id"', async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    jest.spyOn(service, "deleteOneBy").mockResolvedValue(1 as never);

    const fixture: OptionsFixture = makeOptions();
    const component: DeleteOneBaseModel<Monitor> =
      new DeleteOneBaseModel<Monitor>(service);

    const result: RunReturnType = await component.run(
      { query: { id: MONITOR_ID } },
      fixture.options,
    );

    const query: JSONObject = firstCallArgument(service.deleteOneBy)[
      "query"
    ] as JSONObject;

    expect(result.executePort?.id).toBe("success");
    expect(query["_id"]).toBe(MONITOR_ID);
    expect(query["id"]).toBeUndefined();
  });

  test("scopes the query to the running project", async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    jest.spyOn(service, "deleteOneBy").mockResolvedValue(1 as never);

    const fixture: OptionsFixture = makeOptions();
    const component: DeleteOneBaseModel<Monitor> =
      new DeleteOneBaseModel<Monitor>(service);

    await component.run({ query: { id: MONITOR_ID } }, fixture.options);

    const query: JSONObject = firstCallArgument(service.deleteOneBy)[
      "query"
    ] as JSONObject;

    expect(query["projectId"]).toBe(fixture.projectId);
  });

  test("reports how many records it deleted", async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    jest.spyOn(service, "deleteOneBy").mockResolvedValue(1 as never);

    const fixture: OptionsFixture = makeOptions();
    const component: DeleteOneBaseModel<Monitor> =
      new DeleteOneBaseModel<Monitor>(service);

    const result: RunReturnType = await component.run(
      { query: { id: MONITOR_ID } },
      fixture.options,
    );

    expect(result.returnValues["items-deleted"]).toBe(1);
    expect(loggedLines(fixture.log)).toContain("Deleted 1 Monitor(s).");
  });
});

describe("Delete Many", () => {
  test('accepts a query keyed on "id" and stays scoped to the project', async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    jest.spyOn(service, "deleteBy").mockResolvedValue(3 as never);

    const fixture: OptionsFixture = makeOptions();
    const component: DeleteManyBaseModel<Monitor> =
      new DeleteManyBaseModel<Monitor>(service);

    const result: RunReturnType = await component.run(
      { query: { id: MONITOR_ID } },
      fixture.options,
    );

    const query: JSONObject = firstCallArgument(service.deleteBy)[
      "query"
    ] as JSONObject;

    expect(result.executePort?.id).toBe("success");
    expect(query["_id"]).toBe(MONITOR_ID);
    expect(query["projectId"]).toBe(fixture.projectId);
    expect(result.returnValues["items-deleted"]).toBe(3);
  });
});

describe("Find One", () => {
  test('accepts "id" in both the query and the select', async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    jest.spyOn(service, "findOneBy").mockResolvedValue(null as never);

    const fixture: OptionsFixture = makeOptions();
    const component: FindOneBaseModel<Monitor> = new FindOneBaseModel<Monitor>(
      service,
    );

    const result: RunReturnType = await component.run(
      { query: { id: MONITOR_ID }, select: { id: true, name: true } },
      fixture.options,
    );

    const call: JSONObject = firstCallArgument(service.findOneBy);
    const query: JSONObject = call["query"] as JSONObject;
    const select: JSONObject = call["select"] as JSONObject;

    expect(result.executePort?.id).toBe("success");
    expect(query["_id"]).toBe(MONITOR_ID);
    expect(query["id"]).toBeUndefined();
    expect(select).toEqual({ _id: true, name: true });
  });

  test("rewrites the alias inside a related record", async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    jest.spyOn(service, "findOneBy").mockResolvedValue(null as never);

    const fixture: OptionsFixture = makeOptions();
    const component: FindOneBaseModel<Monitor> = new FindOneBaseModel<Monitor>(
      service,
    );

    await component.run(
      {
        query: { _id: MONITOR_ID },
        select: { project: { id: true, name: true } },
      },
      fixture.options,
    );

    const select: JSONObject = firstCallArgument(service.findOneBy)[
      "select"
    ] as JSONObject;

    expect(select).toEqual({ project: { _id: true, name: true } });
  });

  test("scopes the query to the running project", async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    jest.spyOn(service, "findOneBy").mockResolvedValue(null as never);

    const fixture: OptionsFixture = makeOptions();
    const component: FindOneBaseModel<Monitor> = new FindOneBaseModel<Monitor>(
      service,
    );

    await component.run(
      { query: { id: MONITOR_ID }, select: { _id: true } },
      fixture.options,
    );

    const query: JSONObject = firstCallArgument(service.findOneBy)[
      "query"
    ] as JSONObject;

    expect(query["projectId"]).toBe(fixture.projectId);
  });

  test("explains an unknown column on the error port", async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    jest
      .spyOn(service, "findOneBy")
      .mockRejectedValue(
        new Error(
          'Property "id" was not found in "Monitor". Make sure your query is correct.',
        ) as never,
      );

    const fixture: OptionsFixture = makeOptions();
    const component: FindOneBaseModel<Monitor> = new FindOneBaseModel<Monitor>(
      service,
    );

    const result: RunReturnType = await component.run(
      { query: { _id: MONITOR_ID }, select: { _id: true } },
      fixture.options,
    );

    expect(result.executePort?.id).toBe("error");
    expect(loggedLines(fixture.log)).toContain('Use "_id" instead');
  });
});

describe("Find Many", () => {
  test('accepts "id" in both the query and the select, and stays project scoped', async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    jest.spyOn(service, "findBy").mockResolvedValue([] as never);

    const fixture: OptionsFixture = makeOptions();
    const component: FindManyBaseModel<Monitor> =
      new FindManyBaseModel<Monitor>(service);

    const result: RunReturnType = await component.run(
      { query: { id: MONITOR_ID }, select: { id: true } },
      fixture.options,
    );

    const call: JSONObject = firstCallArgument(service.findBy);
    const query: JSONObject = call["query"] as JSONObject;

    expect(result.executePort?.id).toBe("success");
    expect(query["_id"]).toBe(MONITOR_ID);
    expect(query["projectId"]).toBe(fixture.projectId);
    expect(call["select"]).toEqual({ _id: true });
  });
});

describe("Create One", () => {
  test("creates the record in the project the workflow runs in", async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    const created: Monitor = new Monitor();
    created._id = MONITOR_ID;
    jest.spyOn(service, "create").mockResolvedValue(created as never);

    const fixture: OptionsFixture = makeOptions();
    const component: CreateOneBaseModel<Monitor> =
      new CreateOneBaseModel<Monitor>(service);

    const result: RunReturnType = await component.run(
      {
        json: {
          name: "new monitor",
          project: "11111111-1111-1111-1111-111111111111",
        },
      },
      fixture.options,
    );

    const data: Monitor = firstCallArgument(service.create)[
      "data"
    ] as unknown as Monitor;

    expect(result.executePort?.id).toBe("success");
    expect(data.project).toBeUndefined();
    expect(data.projectId?.toString()).toBe(fixture.projectId.toString());
  });
});

describe("Create Many", () => {
  test("creates every record it was given", async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    const created: Monitor = new Monitor();
    created._id = MONITOR_ID;
    jest.spyOn(service, "create").mockResolvedValue(created as never);

    const fixture: OptionsFixture = makeOptions();
    const component: CreateManyBaseModel<Monitor> =
      new CreateManyBaseModel<Monitor>(service);

    const result: RunReturnType = await component.run(
      { "json-array": [{ name: "one" }, { name: "two" }] },
      fixture.options,
    );

    expect(result.executePort?.id).toBe("success");
    expect(service.create).toHaveBeenCalledTimes(2);
  });

  test("creates every record in the project the workflow runs in", async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    const created: Monitor = new Monitor();
    created._id = MONITOR_ID;
    jest.spyOn(service, "create").mockResolvedValue(created as never);

    const fixture: OptionsFixture = makeOptions();
    const component: CreateManyBaseModel<Monitor> =
      new CreateManyBaseModel<Monitor>(service);

    await component.run(
      {
        "json-array": [
          { name: "one", project: "11111111-1111-1111-1111-111111111111" },
        ],
      },
      fixture.options,
    );

    const data: Monitor = firstCallArgument(service.create)[
      "data"
    ] as unknown as Monitor;

    expect(data.project).toBeUndefined();
    expect(data.projectId?.toString()).toBe(fixture.projectId.toString());
  });

  test("creates records for a model that has no tenant column", async () => {
    /*
     * Regression test. The create loop used to sit inside the
     * `if (getTenantColumn())` check, so a model without a tenant column
     * created nothing and still reported success.
     */
    const service: DatabaseService<Monitor> = makeMonitorService();
    const created: Monitor = new Monitor();
    created._id = MONITOR_ID;
    jest.spyOn(service, "create").mockResolvedValue(created as never);
    jest.spyOn(service.getModel(), "getTenantColumn").mockReturnValue(null);

    const fixture: OptionsFixture = makeOptions();
    const component: CreateManyBaseModel<Monitor> =
      new CreateManyBaseModel<Monitor>(service);

    const result: RunReturnType = await component.run(
      { "json-array": [{ name: "one" }] },
      fixture.options,
    );

    expect(result.executePort?.id).toBe("success");
    expect(service.create).toHaveBeenCalledTimes(1);
  });
});

/*
 * Create used to discard a key it did not recognise without a word.
 * DatabaseBaseModel._fromJSON assigns only when getTableColumnMetadata returns
 * something and has no else branch, so a misspelled column never reached the
 * record. A required column still failed loudly through checkRequiredFields,
 * but an optional one produced a green run and a record quietly missing a
 * field — which is the worst possible outcome for a typo.
 */
describe("Create reports the columns it ignored", () => {
  test("names an unknown key and lists the columns that exist", async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    const created: Monitor = new Monitor();
    created._id = MONITOR_ID;
    jest.spyOn(service, "create").mockResolvedValue(created as never);

    const fixture: OptionsFixture = makeOptions();
    const component: CreateOneBaseModel<Monitor> =
      new CreateOneBaseModel<Monitor>(service);

    const result: RunReturnType = await component.run(
      { json: { name: "new monitor", descriptoin: "typo" } },
      fixture.options,
    );

    const logged: string = loggedLines(fixture.log);

    // Still a success — reporting must not start failing workflows that run today.
    expect(result.executePort?.id).toBe("success");
    expect(logged).toContain("descriptoin");
    // The real column list is the fastest way to spot what was meant.
    expect(logged).toContain("description");
  });

  test("says nothing when every key is a real column", async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    jest.spyOn(service, "create").mockResolvedValue(new Monitor() as never);

    const fixture: OptionsFixture = makeOptions();
    const component: CreateOneBaseModel<Monitor> =
      new CreateOneBaseModel<Monitor>(service);

    await component.run(
      { json: { name: "new monitor", description: "fine" } },
      fixture.options,
    );

    expect(loggedLines(fixture.log)).not.toContain("Ignored");
  });

  /*
   * "id" is a legitimate key even though there is no "id" column — _fromJSON
   * rewrites it to "_id" itself. Reporting it would send the builder chasing a
   * mistake they did not make, and "id" is the spelling the rest of the product
   * uses.
   */
  test('does not report "id", which the create path accepts as an alias', async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    jest.spyOn(service, "create").mockResolvedValue(new Monitor() as never);

    const fixture: OptionsFixture = makeOptions();
    const component: CreateOneBaseModel<Monitor> =
      new CreateOneBaseModel<Monitor>(service);

    await component.run(
      { json: { id: MONITOR_ID, name: "new monitor" } },
      fixture.options,
    );

    expect(loggedLines(fixture.log)).not.toContain("Ignored");
  });

  test("reports several unknown keys at once", async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    jest.spyOn(service, "create").mockResolvedValue(new Monitor() as never);

    const fixture: OptionsFixture = makeOptions();
    const component: CreateOneBaseModel<Monitor> =
      new CreateOneBaseModel<Monitor>(service);

    await component.run(
      { json: { name: "n", nmae: "x", desc: "y" } },
      fixture.options,
    );

    const logged: string = loggedLines(fixture.log);

    expect(logged).toContain("nmae");
    expect(logged).toContain("desc");
  });

  /*
   * The tenant column is stamped by the component, not typed by the builder, so
   * checking before the stamp keeps the report about what they actually wrote.
   */
  test("never reports the project column the component stamps itself", async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    jest.spyOn(service, "create").mockResolvedValue(new Monitor() as never);

    const fixture: OptionsFixture = makeOptions();
    const component: CreateOneBaseModel<Monitor> =
      new CreateOneBaseModel<Monitor>(service);

    await component.run({ json: { name: "n" } }, fixture.options);

    expect(loggedLines(fixture.log)).not.toContain("Ignored");
  });

  test("Create Many says which element the unknown key was in", async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    jest.spyOn(service, "create").mockResolvedValue(new Monitor() as never);

    const fixture: OptionsFixture = makeOptions();
    const component: CreateManyBaseModel<Monitor> =
      new CreateManyBaseModel<Monitor>(service);

    const result: RunReturnType = await component.run(
      {
        "json-array": [{ name: "first" }, { name: "second", nmae: "typo" }],
      },
      fixture.options,
    );

    const logged: string = loggedLines(fixture.log);

    expect(result.executePort?.id).toBe("success");
    expect(logged).toContain("nmae");
    // One bad key in a long array is otherwise impossible to locate.
    expect(logged).toContain("Item 2");
  });
});

/*
 * Both create components used to catch and format their own errors, and only
 * one of them wrote to the server log. The other six database components share
 * logComponentError, which also appends the model's real column list when the
 * failure names a column.
 */
describe("Create uses the shared error logging", () => {
  test("Create One takes the Error port and explains an unknown column", async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    jest
      .spyOn(service, "create")
      .mockRejectedValue(
        new Error(
          'Property "nmae" was not found in "Monitor". Make sure your query is correct.' as never,
        ) as never,
      );

    const fixture: OptionsFixture = makeOptions();
    const component: CreateOneBaseModel<Monitor> =
      new CreateOneBaseModel<Monitor>(service);

    const result: RunReturnType = await component.run(
      { json: { name: "n" } },
      fixture.options,
    );

    const logged: string = loggedLines(fixture.log);

    expect(result.executePort?.id).toBe("error");
    expect(logged).toContain("nmae");
    expect(logged).toContain("Columns you can use");
    /*
     * The Error branch of the graph has to run — onError would abort the whole
     * run instead, which is not what an unconnected Error port should mean.
     */
    expect(fixture.onError).not.toHaveBeenCalled();
  });

  test("Create Many takes the Error port the same way", async () => {
    const service: DatabaseService<Monitor> = makeMonitorService();
    jest
      .spyOn(service, "create")
      .mockRejectedValue(new Error("database exploded") as never);

    const fixture: OptionsFixture = makeOptions();
    const component: CreateManyBaseModel<Monitor> =
      new CreateManyBaseModel<Monitor>(service);

    const result: RunReturnType = await component.run(
      { "json-array": [{ name: "first" }] },
      fixture.options,
    );

    expect(result.executePort?.id).toBe("error");
    expect(loggedLines(fixture.log)).toContain("database exploded");
    expect(fixture.onError).not.toHaveBeenCalled();
  });
});
