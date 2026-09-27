import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import TableView from "../../../Models/DatabaseModels/TableView";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentCustomFieldService from "../../../Server/Services/IncidentCustomFieldService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentTemplateService from "../../../Server/Services/IncidentTemplateService";
import TableViewService from "../../../Server/Services/TableViewService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import * as MappingValidator from "../../../Server/Utils/CustomField/CustomFieldMappingValidator";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PositiveNumber from "../../../Types/PositiveNumber";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * IncidentCustomFieldService looks after the two things an incident custom
 * field is known by besides its settings:
 *
 *   - its template key (variableKey): made from the name on create, unique
 *     in the project, whatever the client sent replaced, and never changed
 *     by an update;
 *   - its name, which incidents and incident templates store its values
 *     under. A rename moves those values - with raw SQL, so no "On Update
 *     Incident" workflow runs for any incident - and rewrites the saved
 *     views of the incidents list that name the field. A rename onto
 *     another field's name, or of several fields at once, is refused.
 *
 * Every read and write is stubbed; the SQL itself runs against Postgres in
 * CustomFieldRenamePostgres.test.ts.
 */

const projectId: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const fieldId: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

const ADMIN_PROPS: DatabaseCommonInteractionProps = {
  tenantId: projectId,
  userId: new ObjectID("33333333-3333-4333-8333-333333333333"),
};

type OnBeforeCreate = (
  createBy: CreateBy<IncidentCustomField>,
) => Promise<OnCreate<IncidentCustomField>>;

type OnBeforeUpdate = (
  updateBy: UpdateBy<IncidentCustomField>,
) => Promise<OnUpdate<IncidentCustomField>>;

type OnUpdateSuccess = (
  onUpdate: OnUpdate<IncidentCustomField>,
  updatedItemIds: Array<ObjectID>,
) => Promise<OnUpdate<IncidentCustomField>>;

const service: {
  onBeforeCreate: OnBeforeCreate;
  onBeforeUpdate: OnBeforeUpdate;
  onUpdateSuccess: OnUpdateSuccess;
} = IncidentCustomFieldService as unknown as {
  onBeforeCreate: OnBeforeCreate;
  onBeforeUpdate: OnBeforeUpdate;
  onUpdateSuccess: OnUpdateSuccess;
};

function field(data: {
  id?: ObjectID;
  name?: string;
  variableKey?: string;
  project?: ObjectID;
}): IncidentCustomField {
  const item: IncidentCustomField = new IncidentCustomField();

  if (data.id) {
    item._id = data.id.toString();
  }

  if (data.name !== undefined) {
    item.name = data.name;
  }

  if (data.variableKey !== undefined) {
    item.variableKey = data.variableKey;
  }

  item.projectId = data.project || projectId;

  return item;
}

interface FakeRepository {
  query: MockFunction;
  repository: unknown;
}

// Enough of a TypeORM repository for the raw rename statement.
function fakeRepository(tableName: string, moved: number): FakeRepository {
  const query: MockFunction = getJestMockFunction();
  query.mockResolvedValue([{ count: moved }] as never);

  return {
    query: query,
    repository: {
      metadata: {
        tableName: tableName,
        name: tableName,
        findColumnWithPropertyName: (propertyName: string) => {
          return { databaseName: propertyName };
        },
      },
      manager: {
        query: query,
      },
    },
  };
}

let findBy: MockFunction;
let countBy: MockFunction;

beforeEach(() => {
  findBy = getJestMockFunction();
  findBy.mockResolvedValue([] as never);
  jest
    .spyOn(IncidentCustomFieldService, "findBy")
    .mockImplementation(findBy as never);

  countBy = getJestMockFunction();
  countBy.mockResolvedValue(new PositiveNumber(0) as never);
  jest
    .spyOn(IncidentCustomFieldService, "countBy")
    .mockImplementation(countBy as never);

  jest
    .spyOn(MappingValidator, "validateCustomFieldMappingOnCreate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(MappingValidator, "validateCustomFieldMappingOnUpdate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(CustomFieldMappingService, "backfillProject")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("IncidentCustomFieldService.onBeforeCreate: the template key", () => {
  async function create(
    data: Partial<IncidentCustomField>,
    props: DatabaseCommonInteractionProps = ADMIN_PROPS,
  ): Promise<IncidentCustomField> {
    const item: IncidentCustomField = new IncidentCustomField();
    Object.assign(item, data);

    const onCreate: OnCreate<IncidentCustomField> =
      await service.onBeforeCreate({ data: item, props });

    return onCreate.createBy.data;
  }

  test("is made from the name", async () => {
    const created: IncidentCustomField = await create({
      name: "Expected Resolution",
      customFieldType: CustomFieldType.DateTime,
    });

    expect(created.variableKey).toBe("expected_resolution");
  });

  test("is numbered past the keys the project's other fields hold", async () => {
    findBy.mockResolvedValue([
      field({
        name: "Expected Resolution",
        variableKey: "expected_resolution",
      }),
      field({
        name: "expected-resolution",
        variableKey: "expected_resolution_2",
      }),
      field({ name: "Legacy" }),
    ] as never);

    const created: IncidentCustomField = await create({
      name: "EXPECTED RESOLUTION!",
    });

    expect(created.variableKey).toBe("expected_resolution_3");

    const read: JSONObject = findBy.mock.calls[0]![0] as JSONObject;
    expect(read["query"]).toEqual({ projectId: projectId });
    expect(read["select"]).toEqual({ variableKey: true });
    expect((read["props"] as JSONObject)["isRoot"]).toBe(true);
  });

  test("replaces whatever key the client sent", async () => {
    const created: IncidentCustomField = await create({
      name: "Impact",
      variableKey: "Not A Valid-Key {{x}}",
    });

    expect(created.variableKey).toBe("impact");
  });

  test("a non-ASCII name gets the fallback key", async () => {
    findBy.mockResolvedValue([field({ variableKey: "field" })] as never);

    const created: IncidentCustomField = await create({ name: "影响" });

    expect(created.variableKey).toBe("field_2");
  });

  test("uses the row's project for a root create without a tenant", async () => {
    const otherProject: ObjectID = new ObjectID(
      "44444444-4444-4444-8444-444444444444",
    );

    await create({ name: "Impact", projectId: otherProject }, { isRoot: true });

    expect((findBy.mock.calls[0]![0] as JSONObject)["query"]).toEqual({
      projectId: otherProject,
    });
  });
});

describe("IncidentCustomFieldService.onBeforeUpdate", () => {
  function update(
    data: JSONObject,
    props: DatabaseCommonInteractionProps = ADMIN_PROPS,
    query: JSONObject = { _id: fieldId.toString() },
  ): UpdateBy<IncidentCustomField> {
    return {
      query: query as never,
      data: data as never,
      props: props,
      limit: 1,
      skip: 0,
    };
  }

  test("drops the template key: it never changes after create", async () => {
    const onUpdate: OnUpdate<IncidentCustomField> =
      await service.onBeforeUpdate(
        update({ description: "Now documented", variableKey: "hijacked" }),
      );

    expect(onUpdate.updateBy.data).toEqual({ description: "Now documented" });
    expect(onUpdate.carryForward).toBeNull();
    // No name in the write: nothing about renaming is read.
    expect(findBy).not.toHaveBeenCalled();
  });

  test("drops the template key for root writes too", async () => {
    const onUpdate: OnUpdate<IncidentCustomField> =
      await service.onBeforeUpdate(
        update({ variableKey: "hijacked" }, { isRoot: true }),
      );

    expect(onUpdate.updateBy.data).toEqual({});
  });

  test("records the old name of a field being renamed", async () => {
    findBy.mockResolvedValue([field({ id: fieldId, name: "Impact" })] as never);

    const onUpdate: OnUpdate<IncidentCustomField> =
      await service.onBeforeUpdate(update({ name: "Business Impact" }));

    expect(onUpdate.carryForward).toEqual({
      [fieldId.toString()]: { oldName: "Impact", projectId: projectId },
    });

    const read: JSONObject = findBy.mock.calls[0]![0] as JSONObject;
    // Read as root, but only within the caller's project.
    expect(read["query"]).toEqual({
      _id: fieldId.toString(),
      projectId: projectId,
    });
    expect((read["props"] as JSONObject)["isRoot"]).toBe(true);
  });

  test("a save that keeps the name is not a rename", async () => {
    findBy.mockResolvedValue([field({ id: fieldId, name: "Impact" })] as never);

    const onUpdate: OnUpdate<IncidentCustomField> =
      await service.onBeforeUpdate(
        update({ name: "Impact", description: "edited" }),
      );

    expect(onUpdate.carryForward).toBeNull();
    expect(countBy).not.toHaveBeenCalled();
  });

  test("refuses a rename onto another field's name", async () => {
    findBy.mockResolvedValue([field({ id: fieldId, name: "Impact" })] as never);
    countBy.mockResolvedValue(new PositiveNumber(1) as never);

    await expect(
      service.onBeforeUpdate(update({ name: "severity" })),
    ).rejects.toThrow(BadDataException);

    await expect(
      service.onBeforeUpdate(update({ name: "severity" })),
    ).rejects.toThrow(
      "Another incident custom field already has this name. Choose a different name.",
    );

    const clashQuery: JSONObject = (countBy.mock.calls[0]![0] as JSONObject)[
      "query"
    ] as JSONObject;
    expect(clashQuery["projectId"]).toBe(projectId);
    expect(clashQuery["name"]).toBeDefined();
    expect(clashQuery["_id"]).toBeDefined();
  });

  test("allows changing only the case of a name", async () => {
    findBy.mockResolvedValue([field({ id: fieldId, name: "impact" })] as never);

    const onUpdate: OnUpdate<IncidentCustomField> =
      await service.onBeforeUpdate(update({ name: "Impact" }));

    expect(onUpdate.carryForward).toEqual({
      [fieldId.toString()]: { oldName: "impact", projectId: projectId },
    });
  });

  test("refuses renaming several fields in one write", async () => {
    findBy.mockResolvedValue([
      field({ id: fieldId, name: "Impact" }),
      field({
        id: new ObjectID("55555555-5555-4555-8555-555555555555"),
        name: "Region",
      }),
    ] as never);

    await expect(
      service.onBeforeUpdate(
        update({ name: "Merged" }, ADMIN_PROPS, {
          projectId: projectId.toString(),
        }),
      ),
    ).rejects.toThrow(
      "Incident custom fields can only be renamed one at a time.",
    );
  });

  test("a rename that matches no field is nothing to prepare", async () => {
    findBy.mockResolvedValue([] as never);

    const onUpdate: OnUpdate<IncidentCustomField> =
      await service.onBeforeUpdate(update({ name: "Anything" }));

    expect(onUpdate.carryForward).toBeNull();
  });
});

describe("IncidentCustomFieldService.onUpdateSuccess: moving a renamed field's values", () => {
  let incidentTable: FakeRepository;
  let templateTable: FakeRepository;
  let tableViewFindBy: MockFunction;
  let tableViewWrite: MockFunction;
  let workflowTriggers: Array<MockFunction>;
  let hookedWrites: Array<MockFunction>;

  beforeEach(() => {
    incidentTable = fakeRepository("Incident", 12);
    templateTable = fakeRepository("IncidentTemplate", 2);

    jest
      .spyOn(IncidentService, "getRepository")
      .mockReturnValue(incidentTable.repository as never);
    jest
      .spyOn(IncidentTemplateService, "getRepository")
      .mockReturnValue(templateTable.repository as never);

    tableViewFindBy = getJestMockFunction();
    tableViewFindBy.mockResolvedValue([] as never);
    jest
      .spyOn(TableViewService, "findBy")
      .mockImplementation(tableViewFindBy as never);

    tableViewWrite = getJestMockFunction();
    tableViewWrite.mockResolvedValue(undefined as never);
    jest
      .spyOn(TableViewService, "updateColumnsByIdWithoutHooks")
      .mockImplementation(tableViewWrite as never);

    // The workflow trigger path of every table a rename writes to.
    workflowTriggers = [
      IncidentService,
      IncidentTemplateService,
      TableViewService,
    ].map((target: { onTriggerWorkflow: unknown }) => {
      const trigger: MockFunction = getJestMockFunction();
      trigger.mockResolvedValue(undefined as never);
      jest
        .spyOn(target as never, "onTriggerWorkflow" as never)
        .mockImplementation(trigger as never);
      return trigger;
    });

    // And every hooked write that would reach that path.
    hookedWrites = [];
    for (const target of [IncidentService, IncidentTemplateService]) {
      for (const method of ["updateBy", "updateOneBy", "updateOneById"]) {
        const write: MockFunction = getJestMockFunction();
        write.mockResolvedValue(undefined as never);
        jest
          .spyOn(target as never, method as never)
          .mockImplementation(write as never);
        hookedWrites.push(write);
      }
    }
  });

  function onUpdate(
    carryForward: unknown,
    props: DatabaseCommonInteractionProps = ADMIN_PROPS,
  ): OnUpdate<IncidentCustomField> {
    return {
      updateBy: {
        query: { _id: fieldId.toString() } as never,
        data: { name: "Business Impact" } as never,
        props: props,
        limit: 1,
        skip: 0,
      },
      carryForward: carryForward,
    };
  }

  const RENAME: JSONObject = {
    [fieldId.toString()]: { oldName: "Impact", projectId: projectId },
  } as unknown as JSONObject;

  test("moves the values in Incident and IncidentTemplate with one raw statement each", async () => {
    // The name as saved, read back from the store.
    findBy.mockResolvedValue([
      field({ id: fieldId, name: "Business Impact" }),
    ] as never);

    await service.onUpdateSuccess(onUpdate(RENAME), [fieldId]);

    for (const [table, fake] of [
      ["Incident", incidentTable],
      ["IncidentTemplate", templateTable],
    ] as Array<[string, FakeRepository]>) {
      expect(fake.query).toHaveBeenCalledTimes(1);

      const [sql, parameters] = fake.query.mock.calls[0] as [
        string,
        Array<string>,
      ];

      expect(sql).toContain(`UPDATE "${table}"`);
      expect(sql).toContain(
        `SET "customFields" = ("customFields" - $2::text) || jsonb_build_object($3::text, "customFields" -> $2::text)`,
      );
      expect(sql).toContain(`WHERE "projectId" = $1`);
      expect(sql).toContain(`jsonb_typeof("customFields") = 'object'`);
      expect(sql).toContain(`jsonb_exists("customFields", $2::text)`);
      // No version bump, no updatedAt: a rename is not an edit of the record.
      expect(sql).not.toContain("version");
      expect(sql).not.toContain("updatedAt");
      expect(parameters).toEqual([
        projectId.toString(),
        "Impact",
        "Business Impact",
      ]);
    }
  });

  test("starts no workflow and makes no hooked write", async () => {
    findBy.mockResolvedValue([
      field({ id: fieldId, name: "Business Impact" }),
    ] as never);

    await service.onUpdateSuccess(onUpdate(RENAME), [fieldId]);

    for (const trigger of workflowTriggers) {
      expect(trigger).not.toHaveBeenCalled();
    }

    for (const write of hookedWrites) {
      expect(write).not.toHaveBeenCalled();
    }
  });

  test("rewrites the incidents list's saved views that name the field", async () => {
    findBy.mockResolvedValue([
      field({ id: fieldId, name: "Business Impact" }),
    ] as never);

    const namesTheField: TableView = new TableView();
    namesTheField._id = "66666666-6666-4666-8666-666666666666";
    namesTheField.columns = {
      order: ["title", "customFields.Impact"],
      hidden: [],
    };
    namesTheField.facets = {
      facetSelections: { "customField:Impact": ["High"] },
      facetOperators: {},
    };
    namesTheField.query = {} as never;

    const doesNot: TableView = new TableView();
    doesNot._id = "77777777-7777-4777-8777-777777777777";
    doesNot.columns = { order: ["title"], hidden: [] };

    tableViewFindBy.mockResolvedValue([namesTheField, doesNot] as never);

    await service.onUpdateSuccess(onUpdate(RENAME), [fieldId]);

    const read: JSONObject = tableViewFindBy.mock.calls[0]![0] as JSONObject;
    expect((read["query"] as JSONObject)["projectId"]).toBe(projectId);
    expect((read["props"] as JSONObject)["isRoot"]).toBe(true);

    expect(tableViewWrite).toHaveBeenCalledTimes(1);

    const write: JSONObject = tableViewWrite.mock.calls[0]![0] as JSONObject;
    expect((write["id"] as ObjectID).toString()).toBe(
      "66666666-6666-4666-8666-666666666666",
    );
    expect(write["data"]).toEqual({
      columns: { order: ["title", "customFields.Business Impact"], hidden: [] },
      facets: {
        facetSelections: { "customField:Business Impact": ["High"] },
        facetOperators: {},
      },
    });
    // Compare-and-set on what was read, without touching updatedAt.
    expect(write["expectedData"]).toEqual({
      columns: namesTheField.columns,
      facets: namesTheField.facets,
    });
    expect(write["skipUpdateDateColumn"]).toBe(true);
  });

  test("moves the values before the mapping backfill runs", async () => {
    findBy.mockResolvedValue([
      field({ id: fieldId, name: "Business Impact" }),
    ] as never);

    const order: Array<string> = [];

    incidentTable.query.mockImplementation((() => {
      order.push("move");
      return Promise.resolve([{ count: 1 }]);
    }) as never);

    (
      CustomFieldMappingService.backfillProject as unknown as MockFunction
    ).mockImplementation((() => {
      order.push("backfill");
      return Promise.resolve();
    }) as never);

    await service.onUpdateSuccess(onUpdate(RENAME), [fieldId]);

    expect(order).toEqual(["move", "backfill"]);
  });

  test("does nothing for an update that renamed nothing", async () => {
    await service.onUpdateSuccess(onUpdate(null), [fieldId]);

    expect(incidentTable.query).not.toHaveBeenCalled();
    expect(templateTable.query).not.toHaveBeenCalled();
    expect(tableViewFindBy).not.toHaveBeenCalled();
  });

  test("does nothing when the rename did not write the field", async () => {
    await service.onUpdateSuccess(onUpdate(RENAME), []);

    expect(incidentTable.query).not.toHaveBeenCalled();
  });

  test("does nothing when the stored name is still the old one", async () => {
    findBy.mockResolvedValue([field({ id: fieldId, name: "Impact" })] as never);

    await service.onUpdateSuccess(onUpdate(RENAME), [fieldId]);

    expect(incidentTable.query).not.toHaveBeenCalled();
  });

  test("a failed move is reported, not swallowed", async () => {
    findBy.mockResolvedValue([
      field({ id: fieldId, name: "Business Impact" }),
    ] as never);
    incidentTable.query.mockRejectedValue(
      new Error("connection lost") as never,
    );

    await expect(
      service.onUpdateSuccess(onUpdate(RENAME), [fieldId]),
    ).rejects.toThrow("connection lost");
  });
});
