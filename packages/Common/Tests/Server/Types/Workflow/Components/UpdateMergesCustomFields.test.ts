import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import {
  MAX_GUARDED_MERGE_WRITES,
  getCustomFieldsToMerge,
  mergeCustomFieldValues,
} from "../../../../../Server/Types/Workflow/Components/BaseModel/CustomFieldsArgument";
import UpdateManyBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/UpdateManyBaseModel";
import UpdateOneBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/UpdateOneBaseModel";
import DatabaseService from "../../../../../Server/Services/DatabaseService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import Label from "../../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import Team from "../../../../../Models/DatabaseModels/Team";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * https://github.com/OneUptime/oneuptime/issues/4469 - Update One Incident
 * with {"customFields": {"Notification Count": "1"}} left the incident with
 * that one custom field and reported success. The Update steps now merge the
 * custom fields they write into what each record holds.
 *
 * DatabaseService's findBy and updateOneBy are backed here by a small table
 * that keeps a version per record, as Postgres does, so a write guarded by a
 * stale version is refused the way the real one is, and another workflow can
 * be made to write in between a step's read and its write.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const INCIDENT_ID: string = "8b1f7c62-0d4e-4f2a-9c3b-5e6a7d8f9012";
const OTHER_INCIDENT_ID: string = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const THIRD_INCIDENT_ID: string = "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b";

const STORED_CUSTOM_FIELDS: JSONObject = {
  Application: "Example Application",
  Duration: "2 hours",
  Impact: "Service unavailable",
  Locations: ["Location A"],
};

interface TableRow {
  _id: string;
  projectId: string;
  version: number;
  title?: string | undefined;
  customFields?: JSONObject | null | undefined;
}

interface WriteCall {
  query: JSONObject;
  data: JSONObject;
}

/*
 * The rows a findBy or an updateOneBy query reaches: every key of the query
 * must match. Only plain values are compared, which is all these tests send.
 */
function matches(row: TableRow, query: JSONObject): boolean {
  return Object.keys(query).every((key: string): boolean => {
    const wanted: unknown = query[key];
    const held: unknown = (row as unknown as JSONObject)[key];

    if (wanted === undefined) {
      return true;
    }

    return String(held) === String(wanted);
  });
}

class FakeTable {
  public rows: Array<TableRow> = [];
  public reads: Array<JSONObject> = [];
  public writes: Array<WriteCall> = [];

  // Runs before each write is matched: another writer, getting in first.
  public beforeWrite: ((write: WriteCall) => void) | null = null;

  public row(id: string): TableRow {
    return this.rows.find((row: TableRow) => {
      return row._id === id;
    }) as TableRow;
  }

  public find(
    query: JSONObject,
    limit: number,
    skip: number,
  ): Array<JSONObject> {
    this.reads.push(query);

    return this.rows
      .filter((row: TableRow) => {
        return matches(row, query);
      })
      .slice(skip, skip + limit)
      .map((row: TableRow): JSONObject => {
        // A copy, as a database read is: later writes do not change it.
        return JSON.parse(JSON.stringify(row)) as JSONObject;
      });
  }

  public update(query: JSONObject, data: JSONObject): number {
    const write: WriteCall = { query: query, data: data };
    this.writes.push(write);

    if (this.beforeWrite) {
      this.beforeWrite(write);
    }

    const row: TableRow | undefined = this.rows.find((candidate: TableRow) => {
      return matches(candidate, query);
    });

    if (!row) {
      return 0;
    }

    Object.assign(row, JSON.parse(JSON.stringify(data)));
    row.version++;

    return 1;
  }

  // Another workflow writing one custom field, between a step's read and write.
  public writeElsewhere(id: string, field: string, value: string): void {
    const row: TableRow = this.row(id);
    row.customFields = { ...(row.customFields || {}), [field]: value };
    row.version++;
  }
}

interface Fixture<TModel extends BaseModel> {
  service: DatabaseService<TModel>;
  table: FakeTable;
  options: RunOptions;
  log: jest.Mock;
  updateBy: jest.SpiedFunction<DatabaseService<TModel>["updateBy"]>;
}

function makeFixture<TModel extends BaseModel>(
  modelType: { new (): TModel },
  rows: Array<Omit<TableRow, "projectId">>,
): Fixture<TModel> {
  const service: DatabaseService<TModel> = new DatabaseService<TModel>(
    modelType,
  );
  const table: FakeTable = new FakeTable();

  table.rows = rows.map((row: Omit<TableRow, "projectId">): TableRow => {
    return { ...row, projectId: PROJECT_ID.toString() };
  });

  jest.spyOn(service, "findBy").mockImplementation((async (findBy: {
    query: JSONObject;
    limit: number;
    skip: number;
  }) => {
    return table.find(findBy.query, findBy.limit, findBy.skip);
  }) as never);

  jest.spyOn(service, "updateOneBy").mockImplementation((async (updateBy: {
    query: JSONObject;
    data: JSONObject;
  }) => {
    return table.update(updateBy.query, updateBy.data);
  }) as never);

  const updateBy: jest.SpiedFunction<DatabaseService<TModel>["updateBy"]> = jest
    .spyOn(service, "updateBy")
    .mockResolvedValue(7 as never);

  const log: jest.Mock = jest.fn();

  return {
    service: service,
    table: table,
    log: log,
    updateBy: updateBy,
    options: {
      log: log as RunOptions["log"],
      workflowLogId: ObjectID.generate(),
      workflowId: ObjectID.generate(),
      projectId: PROJECT_ID,
      onError: jest.fn((exception: Exception): Exception => {
        return exception;
      }) as RunOptions["onError"],
      executeWorkflow: async (): Promise<void> => {},
    },
  };
}

async function updateOneIncident(
  fixture: Fixture<Incident>,
  data: JSONObject,
  query: JSONObject = { _id: INCIDENT_ID },
): Promise<RunReturnType> {
  return await new UpdateOneBaseModel<Incident>(fixture.service).run(
    { query: query, data: data },
    fixture.options,
  );
}

function loggedLines(log: jest.Mock): string {
  return log.mock.calls
    .flat()
    .map((line: unknown): string => {
      return String(line);
    })
    .join("\n");
}

beforeEach(() => {
  // The project's plan, which a step's props carry on a server with billing.
  jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Update One merges the custom fields it writes (issue 4469)", () => {
  test("sets the one custom field it names and keeps every other one", async () => {
    const fixture: Fixture<Incident> = makeFixture(Incident, [
      { _id: INCIDENT_ID, version: 3, customFields: STORED_CUSTOM_FIELDS },
    ]);

    const result: RunReturnType = await updateOneIncident(fixture, {
      customFields: { "Notification Count": "1" },
    });

    expect(result.executePort?.id).toBe("success");
    expect(result.returnValues["items-updated"]).toBe(1);
    expect(fixture.table.row(INCIDENT_ID).customFields).toEqual({
      Application: "Example Application",
      Duration: "2 hours",
      Impact: "Service unavailable",
      Locations: ["Location A"],
      "Notification Count": "1",
    });
  });

  test("changes a field it names and leaves the rest", async () => {
    const fixture: Fixture<Incident> = makeFixture(Incident, [
      { _id: INCIDENT_ID, version: 3, customFields: STORED_CUSTOM_FIELDS },
    ]);

    await updateOneIncident(fixture, {
      customFields: { Impact: "Degraded", Locations: ["Location B"] },
    });

    expect(fixture.table.row(INCIDENT_ID).customFields).toEqual({
      ...STORED_CUSTOM_FIELDS,
      Impact: "Degraded",
      Locations: ["Location B"],
    });
  });

  test("clears a field set to null and keeps the others", async () => {
    const fixture: Fixture<Incident> = makeFixture(Incident, [
      { _id: INCIDENT_ID, version: 3, customFields: STORED_CUSTOM_FIELDS },
    ]);

    await updateOneIncident(fixture, { customFields: { Impact: null } });

    expect(fixture.table.row(INCIDENT_ID).customFields).toEqual({
      ...STORED_CUSTOM_FIELDS,
      Impact: null,
    });
  });

  test("changes no custom field for an empty object", async () => {
    const fixture: Fixture<Incident> = makeFixture(Incident, [
      { _id: INCIDENT_ID, version: 3, customFields: STORED_CUSTOM_FIELDS },
    ]);

    await updateOneIncident(fixture, { customFields: {} });

    expect(fixture.table.row(INCIDENT_ID).customFields).toEqual(
      STORED_CUSTOM_FIELDS,
    );
  });

  test("starts from no values on a record that holds none", async () => {
    const fixture: Fixture<Incident> = makeFixture(Incident, [
      { _id: INCIDENT_ID, version: 1, customFields: null },
    ]);

    await updateOneIncident(fixture, {
      customFields: { "Notification Count": "1" },
    });

    expect(fixture.table.row(INCIDENT_ID).customFields).toEqual({
      "Notification Count": "1",
    });
  });

  test("writes the other fields of Data alongside the merged custom fields", async () => {
    const fixture: Fixture<Incident> = makeFixture(Incident, [
      {
        _id: INCIDENT_ID,
        version: 3,
        title: "Checkout down",
        customFields: STORED_CUSTOM_FIELDS,
      },
    ]);

    await updateOneIncident(fixture, {
      title: "Checkout degraded",
      customFields: { Impact: "Degraded" },
    });

    expect(fixture.table.row(INCIDENT_ID).title).toBe("Checkout degraded");
    expect(fixture.table.row(INCIDENT_ID).customFields).toEqual({
      ...STORED_CUSTOM_FIELDS,
      Impact: "Degraded",
    });
  });

  test("clears every custom field when customFields is null, without reading them", async () => {
    const fixture: Fixture<Incident> = makeFixture(Incident, [
      { _id: INCIDENT_ID, version: 3, customFields: STORED_CUSTOM_FIELDS },
    ]);

    const result: RunReturnType = await updateOneIncident(fixture, {
      customFields: null,
    });

    expect(result.returnValues["items-updated"]).toBe(1);
    expect(fixture.table.row(INCIDENT_ID).customFields).toBeNull();
    expect(fixture.table.reads).toHaveLength(0);
  });

  test("writes a customFields that is not an object as it is", async () => {
    const fixture: Fixture<Incident> = makeFixture(Incident, [
      { _id: INCIDENT_ID, version: 3, customFields: STORED_CUSTOM_FIELDS },
    ]);

    await updateOneIncident(fixture, { customFields: ["not", "a", "bag"] });

    expect(fixture.table.reads).toHaveLength(0);
    expect(fixture.table.writes[0]!.data["customFields"]).toEqual([
      "not",
      "a",
      "bag",
    ]);
  });

  test("writes Data without customFields exactly as before", async () => {
    const fixture: Fixture<Incident> = makeFixture(Incident, [
      { _id: INCIDENT_ID, version: 3, customFields: STORED_CUSTOM_FIELDS },
    ]);

    await updateOneIncident(fixture, { title: "Renamed" });

    expect(fixture.table.reads).toHaveLength(0);
    expect(fixture.table.writes).toHaveLength(1);
    expect(fixture.table.writes[0]!.query["_id"]).toBe(INCIDENT_ID);
    expect(fixture.table.writes[0]!.query["version"]).toBeUndefined();
    expect(fixture.table.row(INCIDENT_ID).customFields).toEqual(
      STORED_CUSTOM_FIELDS,
    );
  });

  test("leaves a model without a customFields column alone", async () => {
    const fixture: Fixture<Label> = makeFixture(Label, [
      { _id: INCIDENT_ID, version: 1 },
    ]);

    await new UpdateOneBaseModel<Label>(fixture.service).run(
      {
        query: { _id: INCIDENT_ID },
        data: { customFields: { a: 1 } },
      },
      fixture.options,
    );

    expect(fixture.table.reads).toHaveLength(0);
    expect(fixture.table.writes[0]!.data["customFields"]).toEqual({ a: 1 });
  });

  test("merges on every model with custom fields, not only incidents", async () => {
    const fixture: Fixture<Monitor> = makeFixture(Monitor, [
      { _id: INCIDENT_ID, version: 2, customFields: { Team: "Payments" } },
    ]);

    await new UpdateOneBaseModel<Monitor>(fixture.service).run(
      {
        query: { _id: INCIDENT_ID },
        data: { customFields: { Tier: "1" } },
      },
      fixture.options,
    );

    expect(fixture.table.row(INCIDENT_ID).customFields).toEqual({
      Team: "Payments",
      Tier: "1",
    });
  });

  test("updates nothing, and says so, when the query matches nothing", async () => {
    const fixture: Fixture<Incident> = makeFixture(Incident, []);

    const result: RunReturnType = await updateOneIncident(fixture, {
      customFields: { "Notification Count": "1" },
    });

    expect(result.executePort?.id).toBe("success");
    expect(result.returnValues["items-updated"]).toBe(0);
    expect(fixture.table.writes).toHaveLength(0);
    expect(loggedLines(fixture.log)).toContain("Updated 0");
  });

  test("reads and writes in the running project only", async () => {
    const fixture: Fixture<Incident> = makeFixture(Incident, [
      { _id: INCIDENT_ID, version: 3, customFields: STORED_CUSTOM_FIELDS },
    ]);
    fixture.table.rows.push({
      _id: OTHER_INCIDENT_ID,
      projectId: ObjectID.generate().toString(),
      version: 1,
      customFields: { Impact: "Other project" },
    });

    const result: RunReturnType = await updateOneIncident(
      fixture,
      { customFields: { Impact: "Degraded" } },
      { _id: OTHER_INCIDENT_ID },
    );

    expect(result.returnValues["items-updated"]).toBe(0);
    expect(String(fixture.table.reads[0]!["projectId"])).toBe(
      PROJECT_ID.toString(),
    );
    expect(fixture.table.row(OTHER_INCIDENT_ID).customFields).toEqual({
      Impact: "Other project",
    });
  });

  test('accepts a query keyed on "id", as every other update does', async () => {
    const fixture: Fixture<Incident> = makeFixture(Incident, [
      { _id: INCIDENT_ID, version: 3, customFields: STORED_CUSTOM_FIELDS },
    ]);

    await updateOneIncident(
      fixture,
      { customFields: { "Notification Count": "1" } },
      { id: INCIDENT_ID },
    );

    expect(fixture.table.reads[0]!["_id"]).toBe(INCIDENT_ID);
    expect(fixture.table.row(INCIDENT_ID).customFields).toEqual({
      ...STORED_CUSTOM_FIELDS,
      "Notification Count": "1",
    });
  });

  test("writes the record it read, under the step's own conditions and the version it read", async () => {
    const fixture: Fixture<Incident> = makeFixture(Incident, [
      {
        _id: INCIDENT_ID,
        version: 3,
        title: "Checkout down",
        customFields: STORED_CUSTOM_FIELDS,
      },
    ]);

    await updateOneIncident(
      fixture,
      { customFields: { "Notification Count": "1" } },
      { title: "Checkout down" },
    );

    const write: WriteCall = fixture.table.writes[0]!;

    expect(write.query["title"]).toBe("Checkout down");
    expect(write.query["_id"]).toBe(INCIDENT_ID);
    expect(write.query["version"]).toBe(3);
    expect(String(write.query["projectId"])).toBe(PROJECT_ID.toString());
  });

  test("keeps a field another workflow wrote between this step's read and its write", async () => {
    const fixture: Fixture<Incident> = makeFixture(Incident, [
      { _id: INCIDENT_ID, version: 3, customFields: STORED_CUSTOM_FIELDS },
    ]);

    let hasWrittenElsewhere: boolean = false;

    fixture.table.beforeWrite = (): void => {
      if (!hasWrittenElsewhere) {
        hasWrittenElsewhere = true;
        fixture.table.writeElsewhere(INCIDENT_ID, "Owner", "ops");
      }
    };

    const result: RunReturnType = await updateOneIncident(fixture, {
      customFields: { "Notification Count": "1" },
    });

    expect(result.returnValues["items-updated"]).toBe(1);
    expect(fixture.table.row(INCIDENT_ID).customFields).toEqual({
      ...STORED_CUSTOM_FIELDS,
      Owner: "ops",
      "Notification Count": "1",
    });
    // The refused write, then the one merged over the fresh read.
    expect(fixture.table.writes).toHaveLength(2);
    expect(fixture.table.writes[1]!.query["version"]).toBe(4);
  });

  test("leaves a record that stopped matching the query before the write", async () => {
    const fixture: Fixture<Incident> = makeFixture(Incident, [
      {
        _id: INCIDENT_ID,
        version: 3,
        title: "Checkout down",
        customFields: STORED_CUSTOM_FIELDS,
      },
    ]);

    fixture.table.beforeWrite = (): void => {
      const row: TableRow = fixture.table.row(INCIDENT_ID);
      row.title = "Renamed elsewhere";
      row.version++;
    };

    const result: RunReturnType = await updateOneIncident(
      fixture,
      { customFields: { "Notification Count": "1" } },
      { title: "Checkout down" },
    );

    expect(result.executePort?.id).toBe("success");
    expect(result.returnValues["items-updated"]).toBe(0);
    expect(fixture.table.writes).toHaveLength(1);
    expect(fixture.table.row(INCIDENT_ID).customFields).toEqual(
      STORED_CUSTOM_FIELDS,
    );
  });

  test("leaves a record deleted before the write", async () => {
    const fixture: Fixture<Incident> = makeFixture(Incident, [
      { _id: INCIDENT_ID, version: 3, customFields: STORED_CUSTOM_FIELDS },
    ]);

    fixture.table.beforeWrite = (): void => {
      fixture.table.rows = [];
    };

    const result: RunReturnType = await updateOneIncident(fixture, {
      customFields: { "Notification Count": "1" },
    });

    expect(result.returnValues["items-updated"]).toBe(0);
    expect(fixture.table.writes).toHaveLength(1);
  });

  test("does not try again when the write was refused for a reason of its own", async () => {
    const fixture: Fixture<Incident> = makeFixture(Incident, [
      { _id: INCIDENT_ID, version: 3, customFields: STORED_CUSTOM_FIELDS },
    ]);

    jest.spyOn(fixture.service, "updateOneBy").mockResolvedValue(0 as never);

    const result: RunReturnType = await updateOneIncident(fixture, {
      customFields: { "Notification Count": "1" },
    });

    expect(result.returnValues["items-updated"]).toBe(0);
    expect(fixture.service.updateOneBy).toHaveBeenCalledTimes(1);
  });

  test("writes on top of the latest read when the record keeps changing", async () => {
    const fixture: Fixture<Incident> = makeFixture(Incident, [
      { _id: INCIDENT_ID, version: 3, customFields: STORED_CUSTOM_FIELDS },
    ]);

    let otherWrites: number = 0;

    fixture.table.beforeWrite = (write: WriteCall): void => {
      // Every guarded attempt loses to another writer.
      if (write.query["version"] !== undefined) {
        otherWrites++;
        fixture.table.writeElsewhere(
          INCIDENT_ID,
          "Last Writer",
          `other-${otherWrites}`,
        );
      }
    };

    const result: RunReturnType = await updateOneIncident(fixture, {
      customFields: { "Notification Count": "1" },
    });

    expect(result.executePort?.id).toBe("success");
    expect(result.returnValues["items-updated"]).toBe(1);
    expect(fixture.table.writes).toHaveLength(MAX_GUARDED_MERGE_WRITES + 1);
    expect(fixture.table.row(INCIDENT_ID).customFields).toEqual({
      ...STORED_CUSTOM_FIELDS,
      "Last Writer": `other-${MAX_GUARDED_MERGE_WRITES}`,
      "Notification Count": "1",
    });
    expect(loggedLines(fixture.log)).toContain("kept changing");
  });

  test("takes the Error port when the write fails", async () => {
    const fixture: Fixture<Incident> = makeFixture(Incident, [
      { _id: INCIDENT_ID, version: 3, customFields: STORED_CUSTOM_FIELDS },
    ]);

    jest
      .spyOn(fixture.service, "updateOneBy")
      .mockRejectedValue(new Error("connection reset") as never);

    const result: RunReturnType = await updateOneIncident(fixture, {
      customFields: { "Notification Count": "1" },
    });

    expect(result.executePort?.id).toBe("error");
    expect(loggedLines(fixture.log)).toContain("connection reset");
  });

  test("accepts the JSON text the workflow runner passes", async () => {
    const fixture: Fixture<Incident> = makeFixture(Incident, [
      { _id: INCIDENT_ID, version: 3, customFields: STORED_CUSTOM_FIELDS },
    ]);

    await new UpdateOneBaseModel<Incident>(fixture.service).run(
      {
        query: JSON.stringify({ _id: INCIDENT_ID }),
        data: JSON.stringify({ customFields: { "Notification Count": "1" } }),
      },
      fixture.options,
    );

    expect(fixture.table.row(INCIDENT_ID).customFields).toEqual({
      ...STORED_CUSTOM_FIELDS,
      "Notification Count": "1",
    });
  });
});

describe("Update Many merges the custom fields it writes into each record", () => {
  async function updateManyIncidents(
    fixture: Fixture<Incident>,
    args: JSONObject,
  ): Promise<RunReturnType> {
    return await new UpdateManyBaseModel<Incident>(fixture.service).run(
      args,
      fixture.options,
    );
  }

  test("keeps each record's own custom fields", async () => {
    const fixture: Fixture<Incident> = makeFixture(Incident, [
      { _id: INCIDENT_ID, version: 3, customFields: STORED_CUSTOM_FIELDS },
      { _id: OTHER_INCIDENT_ID, version: 9, customFields: { Impact: "Low" } },
    ]);

    const result: RunReturnType = await updateManyIncidents(fixture, {
      query: {},
      data: { customFields: { Reviewed: true } },
    });

    expect(result.executePort?.id).toBe("success");
    expect(result.returnValues["items-updated"]).toBe(2);
    expect(fixture.table.row(INCIDENT_ID).customFields).toEqual({
      ...STORED_CUSTOM_FIELDS,
      Reviewed: true,
    });
    expect(fixture.table.row(OTHER_INCIDENT_ID).customFields).toEqual({
      Impact: "Low",
      Reviewed: true,
    });
    expect(fixture.updateBy).not.toHaveBeenCalled();
  });

  test("reaches the records the step's Limit and Skip pick", async () => {
    const fixture: Fixture<Incident> = makeFixture(Incident, [
      { _id: INCIDENT_ID, version: 1, customFields: { n: 1 } },
      { _id: OTHER_INCIDENT_ID, version: 1, customFields: { n: 2 } },
      { _id: THIRD_INCIDENT_ID, version: 1, customFields: { n: 3 } },
    ]);

    const result: RunReturnType = await updateManyIncidents(fixture, {
      query: {},
      data: { customFields: { Reviewed: true } },
      limit: 1,
      skip: 1,
    });

    expect(result.returnValues["items-updated"]).toBe(1);
    expect(fixture.table.row(INCIDENT_ID).customFields).toEqual({ n: 1 });
    expect(fixture.table.row(OTHER_INCIDENT_ID).customFields).toEqual({
      n: 2,
      Reviewed: true,
    });
    expect(fixture.table.row(THIRD_INCIDENT_ID).customFields).toEqual({
      n: 3,
    });
  });

  test("reads at most 10 records when Limit is left out, as the update did", async () => {
    const fixture: Fixture<Incident> = makeFixture(Incident, []);
    const findBy: jest.SpiedFunction<DatabaseService<Incident>["findBy"]> = jest
      .spyOn(fixture.service, "findBy")
      .mockResolvedValue([] as never);

    await updateManyIncidents(fixture, {
      query: {},
      data: { customFields: { Reviewed: true } },
    });

    expect(findBy.mock.calls[0]![0].limit).toBe(10);
    expect(findBy.mock.calls[0]![0].skip).toBe(0);
  });

  test("counts only the records it wrote", async () => {
    const fixture: Fixture<Incident> = makeFixture(Incident, [
      { _id: INCIDENT_ID, version: 1, customFields: {} },
      { _id: OTHER_INCIDENT_ID, version: 1, customFields: {} },
    ]);

    fixture.table.beforeWrite = (write: WriteCall): void => {
      if (write.query["_id"] === OTHER_INCIDENT_ID) {
        fixture.table.rows = fixture.table.rows.filter((row: TableRow) => {
          return row._id !== OTHER_INCIDENT_ID;
        });
      }
    };

    const result: RunReturnType = await updateManyIncidents(fixture, {
      query: {},
      data: { customFields: { Reviewed: true } },
    });

    expect(result.returnValues["items-updated"]).toBe(1);
  });

  test("keeps a field another workflow wrote to one of the records meanwhile", async () => {
    const fixture: Fixture<Incident> = makeFixture(Incident, [
      { _id: INCIDENT_ID, version: 1, customFields: { a: 1 } },
      { _id: OTHER_INCIDENT_ID, version: 1, customFields: { b: 2 } },
    ]);

    let hasWrittenElsewhere: boolean = false;

    fixture.table.beforeWrite = (write: WriteCall): void => {
      if (!hasWrittenElsewhere && write.query["_id"] === OTHER_INCIDENT_ID) {
        hasWrittenElsewhere = true;
        fixture.table.writeElsewhere(OTHER_INCIDENT_ID, "Owner", "ops");
      }
    };

    await updateManyIncidents(fixture, {
      query: {},
      data: { customFields: { Reviewed: true } },
    });

    expect(fixture.table.row(OTHER_INCIDENT_ID).customFields).toEqual({
      b: 2,
      Owner: "ops",
      Reviewed: true,
    });
  });

  test("updates as before, in one write, without customFields", async () => {
    const fixture: Fixture<Incident> = makeFixture(Incident, [
      { _id: INCIDENT_ID, version: 1, customFields: { a: 1 } },
    ]);

    const result: RunReturnType = await updateManyIncidents(fixture, {
      query: {},
      data: { title: "Renamed" },
    });

    expect(result.returnValues["items-updated"]).toBe(7);
    expect(fixture.updateBy).toHaveBeenCalledTimes(1);
    expect(fixture.table.reads).toHaveLength(0);
  });

  test("clears every record's custom fields in one write when customFields is null", async () => {
    const fixture: Fixture<Incident> = makeFixture(Incident, [
      { _id: INCIDENT_ID, version: 1, customFields: { a: 1 } },
    ]);

    await updateManyIncidents(fixture, {
      query: {},
      data: { customFields: null },
    });

    expect(fixture.updateBy).toHaveBeenCalledTimes(1);
    expect(
      (fixture.updateBy.mock.calls[0]![0].data as JSONObject)["customFields"],
    ).toBeNull();
    expect(fixture.table.reads).toHaveLength(0);
  });

  test("reads and writes in the running project only", async () => {
    const fixture: Fixture<Incident> = makeFixture(Incident, [
      { _id: INCIDENT_ID, version: 1, customFields: { a: 1 } },
    ]);
    fixture.table.rows.push({
      _id: OTHER_INCIDENT_ID,
      projectId: ObjectID.generate().toString(),
      version: 1,
      customFields: { b: 2 },
    });

    const result: RunReturnType = await updateManyIncidents(fixture, {
      query: {},
      data: { customFields: { Reviewed: true } },
    });

    expect(result.returnValues["items-updated"]).toBe(1);
    expect(fixture.table.row(OTHER_INCIDENT_ID).customFields).toEqual({
      b: 2,
    });

    for (const write of fixture.table.writes) {
      expect(String(write.query["projectId"])).toBe(PROJECT_ID.toString());
    }
  });
});

describe("mergeCustomFieldValues", () => {
  test("sets the written fields over the stored ones", () => {
    expect(
      mergeCustomFieldValues({
        stored: { a: 1, b: 2 },
        written: { b: 3, c: 4 },
      }),
    ).toEqual({ a: 1, b: 3, c: 4 });
  });

  test("replaces a list whole rather than merging it", () => {
    expect(
      mergeCustomFieldValues({
        stored: { Locations: ["A", "B"] },
        written: { Locations: ["C"] },
      }),
    ).toEqual({ Locations: ["C"] });
  });

  test("keeps a field written as null, as an explicit empty value", () => {
    expect(
      mergeCustomFieldValues({ stored: { a: 1 }, written: { a: null } }),
    ).toEqual({ a: null });
  });

  test("starts from nothing when the stored value is not a bag", () => {
    for (const stored of [null, undefined, "text", 5, ["a"]]) {
      expect(mergeCustomFieldValues({ stored, written: { a: 1 } })).toEqual({
        a: 1,
      });
    }
  });

  test("returns a new object, leaving both inputs as they were", () => {
    const stored: JSONObject = { a: 1 };
    const written: JSONObject = { b: 2 };

    const merged: JSONObject = mergeCustomFieldValues({ stored, written });

    merged["c"] = 3;

    expect(stored).toEqual({ a: 1 });
    expect(written).toEqual({ b: 2 });
  });
});

describe("getCustomFieldsToMerge", () => {
  test("returns the object written to a model's custom fields", () => {
    for (const model of [new Incident(), new Monitor(), new Team()]) {
      expect(getCustomFieldsToMerge({ customFields: { a: 1 } }, model)).toEqual(
        { a: 1 },
      );
    }
  });

  test("returns nothing when there is no object to merge", () => {
    for (const customFields of [undefined, null, "text", 5, true, ["a"]]) {
      expect(
        getCustomFieldsToMerge(
          { customFields: customFields } as JSONObject,
          new Incident(),
        ),
      ).toBeNull();
    }
  });

  test("returns nothing for a model without a customFields column", () => {
    expect(
      getCustomFieldsToMerge({ customFields: { a: 1 } }, new Label()),
    ).toBeNull();
  });
});
