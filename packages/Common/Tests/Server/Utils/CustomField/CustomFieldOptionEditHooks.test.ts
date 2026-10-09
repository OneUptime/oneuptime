import AlertCustomField from "../../../../Models/DatabaseModels/AlertCustomField";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentCustomField from "../../../../Models/DatabaseModels/IncidentCustomField";
import MonitorCustomField from "../../../../Models/DatabaseModels/MonitorCustomField";
import TeamCustomField from "../../../../Models/DatabaseModels/TeamCustomField";
import AlertCustomFieldService from "../../../../Server/Services/AlertCustomFieldService";
import AlertService from "../../../../Server/Services/AlertService";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import FormService from "../../../../Server/Services/FormService";
import IncidentCustomFieldService from "../../../../Server/Services/IncidentCustomFieldService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentTemplateService from "../../../../Server/Services/IncidentTemplateService";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorTemplateService from "../../../../Server/Services/MonitorTemplateService";
import ScheduledMaintenanceCustomFieldService from "../../../../Server/Services/ScheduledMaintenanceCustomFieldService";
import TableViewService from "../../../../Server/Services/TableViewService";
import TeamService from "../../../../Server/Services/TeamService";
import DatabaseRequestType from "../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ModelPermission from "../../../../Server/Types/Database/Permissions/Index";
import UpdateBy from "../../../../Server/Types/Database/UpdateBy";
import {
  applyCustomFieldOptionEdit,
  CustomFieldOptionEditCarryForward,
  getCustomFieldOptionUsage,
  prepareCustomFieldOptionEdit,
} from "../../../../Server/Utils/CustomField/CustomFieldOptionEditHooks";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { CustomFieldOptionUsage } from "../../../../Types/CustomField/CustomFieldOptionEdit";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import FormTargetType from "../../../../Types/Form/FormTargetType";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import {
  readsOfRowsCallerMayWrite,
  RowsCallerMayWriteRead,
  stubRowsCallerMayWriteLikeFindBy,
} from "../../TestingUtils/RowsCallerMayWrite";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * Saving a dropdown custom field whose options changed (#4564), the way every
 * one of the nine definition services does it: what the write is checked
 * for before it is made (prepareCustomFieldOptionEdit), and what is carried
 * to the field's values once it is (applyCustomFieldOptionEdit) - the
 * records and templates moved in one transaction, saved views and form
 * templates after, and a monitor field's renames and new options made on the
 * incident, alert and scheduled maintenance fields that copy it. Every read
 * and write is stubbed; the SQL runs against Postgres in
 * CustomFieldOptionEditPostgres.test.ts.
 */

const projectId: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const fieldId: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const otherFieldId: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const ADMIN_PROPS: DatabaseCommonInteractionProps = {
  tenantId: projectId,
  userId: new ObjectID("44444444-4444-4444-8444-444444444444"),
};

interface FakeDefinitionService {
  service: DatabaseService<any>;
  // The read of the fields an update writes, which holds the update to them.
  findRowsAndHold: MockFunction;
  findBy: MockFunction;
  findOneById: MockFunction;
  restore: MockFunction;
  transaction: MockFunction;
}

/*
 * One transaction manager for the whole test: every statement inside it is
 * handed to the fake of the table it names.
 */
const tableQueries: Record<string, MockFunction> = {};
const statements: Array<{ table: string; sql: string; parameters: unknown }> =
  [];

const transactionManager: { query: MockFunction } = {
  query: getJestMockFunction(),
};

function tableOf(sql: string): string {
  const match: RegExpMatchArray | null = sql.match(/UPDATE "([A-Za-z]+)"/);
  return match ? match[1]! : "";
}

function fakeRepository(tableName: string, answer: unknown): unknown {
  const query: MockFunction = getJestMockFunction();
  query.mockResolvedValue(answer as never);
  tableQueries[tableName] = query;

  return {
    metadata: {
      tableName: tableName,
      findColumnWithPropertyName: (
        propertyName: string,
      ): { databaseName: string } => {
        return { databaseName: propertyName };
      },
    },
    manager: {
      query: query,
      transaction: async (
        run: (manager: unknown) => Promise<unknown>,
      ): Promise<unknown> => {
        return await run(transactionManager);
      },
    },
  };
}

function definitionService(): FakeDefinitionService {
  const findRowsAndHold: MockFunction = getJestMockFunction();
  findRowsAndHold.mockResolvedValue([] as never);
  const findBy: MockFunction = getJestMockFunction();
  findBy.mockResolvedValue([] as never);
  const findOneById: MockFunction = getJestMockFunction();
  findOneById.mockResolvedValue(null as never);
  const restore: MockFunction = getJestMockFunction();
  restore.mockResolvedValue(undefined as never);
  const transaction: MockFunction = getJestMockFunction();
  transaction.mockImplementation((async (
    run: (manager: unknown) => Promise<unknown>,
  ): Promise<unknown> => {
    return await run(transactionManager);
  }) as never);

  return {
    service: {
      findRowsAndHoldUpdateToThem: findRowsAndHold,
      findBy: findBy,
      findOneById: findOneById,
      updateColumnsByIdWithoutHooks: restore,
      getRepository: (): unknown => {
        return { manager: { transaction: transaction } };
      },
    } as unknown as DatabaseService<any>,
    findRowsAndHold,
    findBy,
    findOneById,
    restore,
    transaction,
  };
}

function definition<T extends BaseModel>(
  modelType: { new (): T },
  data: {
    id?: ObjectID;
    name?: string;
    customFieldType?: CustomFieldType;
    dropdownOptions?: string | null;
    project?: ObjectID;
  },
): T {
  const item: T = new modelType();
  const row: Record<string, unknown> = item as unknown as Record<
    string,
    unknown
  >;

  if (data.id) {
    item._id = data.id.toString();
  }

  row["name"] = data.name;
  row["customFieldType"] = data.customFieldType;
  row["dropdownOptions"] = data.dropdownOptions;
  row["projectId"] = data.project || projectId;

  return item;
}

function update(data: {
  payload: JSONObject;
  miscDataProps?: JSONObject;
  props?: DatabaseCommonInteractionProps;
  query?: JSONObject;
}): UpdateBy<any> {
  return {
    query: (data.query || { _id: fieldId.toString() }) as never,
    data: data.payload as never,
    miscDataProps: data.miscDataProps,
    props: data.props || ADMIN_PROPS,
    limit: 1,
    skip: 0,
  };
}

let tableViewFindBy: MockFunction;
let tableViewWrite: MockFunction;
let formFindBy: MockFunction;
let formWrite: MockFunction;

beforeEach(() => {
  for (const key of Object.keys(tableQueries)) {
    delete tableQueries[key];
  }

  statements.length = 0;

  transactionManager.query = getJestMockFunction();
  transactionManager.query.mockImplementation(((
    sql: string,
    parameters: unknown,
  ) => {
    const table: string = tableOf(sql);
    statements.push({ table, sql, parameters });
    const query: MockFunction | undefined = tableQueries[table];

    if (!query) {
      throw new Error(`No fake table for: ${sql.slice(0, 120)}`);
    }

    return query(sql, parameters);
  }) as never);

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

  formFindBy = getJestMockFunction();
  formFindBy.mockResolvedValue([] as never);
  jest.spyOn(FormService, "findBy").mockImplementation(formFindBy as never);

  formWrite = getJestMockFunction();
  formWrite.mockResolvedValue(undefined as never);
  jest
    .spyOn(FormService, "updateColumnsByIdWithoutHooks")
    .mockImplementation(formWrite as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("prepareCustomFieldOptionEdit", () => {
  test("a write that neither renames nor sends options reads nothing and carries nothing", async () => {
    const definitions: FakeDefinitionService = definitionService();

    expect(
      await prepareCustomFieldOptionEdit({
        definitionModelType: IncidentCustomField,
        definitionService: definitions.service,
        updateBy: update({ payload: { description: "Where it happened" } }),
      }),
    ).toBeNull();

    expect(definitions.findRowsAndHold).not.toHaveBeenCalled();
  });

  test("new options without renames only matter for a field others copy", async () => {
    const definitions: FakeDefinitionService = definitionService();

    // An incident field: nobody copies it, so the list is all there is to it.
    expect(
      await prepareCustomFieldOptionEdit({
        definitionModelType: IncidentCustomField,
        definitionService: definitions.service,
        updateBy: update({ payload: { dropdownOptions: "A\nB\nC" } }),
      }),
    ).toBeNull();

    expect(definitions.findRowsAndHold).not.toHaveBeenCalled();

    // A monitor field: incident, alert and maintenance fields can copy it.
    definitions.findRowsAndHold.mockResolvedValue([
      definition(MonitorCustomField, {
        id: fieldId,
        name: "Facility",
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: "A\nB",
      }),
    ] as never);

    expect(
      await prepareCustomFieldOptionEdit({
        definitionModelType: MonitorCustomField,
        definitionService: definitions.service,
        updateBy: update({ payload: { dropdownOptions: "A\nB\nC" } }),
      }),
    ).toEqual({
      fields: [
        {
          id: fieldId,
          projectId: projectId,
          name: "Facility",
          dropdownOptions: "A\nB",
        },
      ],
      renames: [],
    });
  });

  test("reads the renames from the write's misc data, and what the field held before it", async () => {
    const definitions: FakeDefinitionService = definitionService();
    definitions.findRowsAndHold.mockResolvedValue([
      definition(IncidentCustomField, {
        id: fieldId,
        name: "Facility",
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: "Facility A\nFacility B",
      }),
    ] as never);

    const updateBy: UpdateBy<any> = update({
      payload: { dropdownOptions: "Facility Alpha\nFacility B" },
      miscDataProps: {
        renamedDropdownOptions: [{ from: "Facility A", to: "Facility Alpha" }],
      },
    });

    const carryForward: CustomFieldOptionEditCarryForward | null =
      await prepareCustomFieldOptionEdit({
        definitionModelType: IncidentCustomField,
        definitionService: definitions.service,
        updateBy: updateBy,
      });

    expect(carryForward).toEqual({
      fields: [
        {
          id: fieldId,
          projectId: projectId,
          name: "Facility",
          dropdownOptions: "Facility A\nFacility B",
        },
      ],
      renames: [{ from: "Facility A", to: "Facility Alpha" }],
    });

    /*
     * The fields read are the ones the update writes, and the update is held
     * to them: the very update, with what the check needs.
     */
    expect(definitions.findRowsAndHold).toHaveBeenCalledTimes(1);
    expect(definitions.findRowsAndHold.mock.calls[0]![0]).toBe(updateBy);
    expect(definitions.findRowsAndHold.mock.calls[0]![1]).toEqual({
      _id: true,
      projectId: true,
      name: true,
      customFieldType: true,
      dropdownOptions: true,
    });
    expect(definitions.findBy).not.toHaveBeenCalled();
  });

  test("refuses a rename list that is not one", async () => {
    const definitions: FakeDefinitionService = definitionService();

    await expect(
      prepareCustomFieldOptionEdit({
        definitionModelType: IncidentCustomField,
        definitionService: definitions.service,
        updateBy: update({
          payload: { dropdownOptions: "B" },
          miscDataProps: { renamedDropdownOptions: { A: "B" } },
        }),
      }),
    ).rejects.toThrow(
      new BadDataException(
        'renamedDropdownOptions must be a list of { "from", "to" } pairs.',
      ),
    );

    expect(definitions.findRowsAndHold).not.toHaveBeenCalled();
  });

  test("refuses renaming the options of several fields in one write", async () => {
    const definitions: FakeDefinitionService = definitionService();
    definitions.findRowsAndHold.mockResolvedValue([
      definition(IncidentCustomField, {
        id: fieldId,
        name: "Facility",
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: "A\nB",
      }),
      definition(IncidentCustomField, {
        id: otherFieldId,
        name: "Region",
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: "A\nB",
      }),
    ] as never);

    await expect(
      prepareCustomFieldOptionEdit({
        definitionModelType: IncidentCustomField,
        definitionService: definitions.service,
        updateBy: update({
          payload: { dropdownOptions: "B" },
          miscDataProps: { renamedDropdownOptions: [{ from: "A", to: "B" }] },
          query: { projectId: projectId.toString() },
        }),
      }),
    ).rejects.toThrow(
      "Options can be renamed on one custom field at a time. Update a single field to rename its options.",
    );
  });

  test("refuses renames on a field that is not a dropdown", async () => {
    const definitions: FakeDefinitionService = definitionService();
    definitions.findRowsAndHold.mockResolvedValue([
      definition(TeamCustomField, {
        id: fieldId,
        name: "Cost Centre",
        customFieldType: CustomFieldType.Text,
      }),
    ] as never);

    await expect(
      prepareCustomFieldOptionEdit({
        definitionModelType: TeamCustomField,
        definitionService: definitions.service,
        updateBy: update({
          payload: { description: "Where the money goes" },
          miscDataProps: { renamedDropdownOptions: [{ from: "A", to: "B" }] },
        }),
      }),
    ).rejects.toThrow("Only a dropdown field has options to rename.");
  });

  test("checks the renames against the options the write saves", async () => {
    const definitions: FakeDefinitionService = definitionService();
    definitions.findRowsAndHold.mockResolvedValue([
      definition(IncidentCustomField, {
        id: fieldId,
        name: "Facility",
        customFieldType: CustomFieldType.MultiSelectDropdown,
        dropdownOptions: "Facility A\nFacility B",
      }),
    ] as never);

    // Onto an option the same write adds: fine.
    await expect(
      prepareCustomFieldOptionEdit({
        definitionModelType: IncidentCustomField,
        definitionService: definitions.service,
        updateBy: update({
          payload: { dropdownOptions: "Facility Alpha\nFacility B" },
          miscDataProps: {
            renamedDropdownOptions: [
              { from: "Facility A", to: "Facility Alpha" },
            ],
          },
        }),
      }),
    ).resolves.not.toBeNull();

    // Onto one the write does not keep: refused.
    await expect(
      prepareCustomFieldOptionEdit({
        definitionModelType: IncidentCustomField,
        definitionService: definitions.service,
        updateBy: update({
          payload: { dropdownOptions: "Facility B" },
          miscDataProps: {
            renamedDropdownOptions: [
              { from: "Facility A", to: "Facility Alpha" },
            ],
          },
        }),
      }),
    ).rejects.toThrow(
      '"Facility Alpha" is not one of the field\'s options. A value can only be renamed to an option the field offers.',
    );
  });

  test("without new options, the renames are checked against the options the field has", async () => {
    const definitions: FakeDefinitionService = definitionService();
    definitions.findRowsAndHold.mockResolvedValue([
      definition(IncidentCustomField, {
        id: fieldId,
        name: "Facility",
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: "Facility A\nFacility B",
      }),
    ] as never);

    // Tidying a value no longer offered onto an option, options unchanged.
    await expect(
      prepareCustomFieldOptionEdit({
        definitionModelType: IncidentCustomField,
        definitionService: definitions.service,
        updateBy: update({
          payload: { description: "Sites" },
          miscDataProps: {
            renamedDropdownOptions: [{ from: "Old Site", to: "Facility B" }],
          },
        }),
      }),
    ).resolves.toEqual({
      fields: [
        {
          id: fieldId,
          projectId: projectId,
          name: "Facility",
          dropdownOptions: "Facility A\nFacility B",
        },
      ],
      renames: [{ from: "Old Site", to: "Facility B" }],
    });

    await expect(
      prepareCustomFieldOptionEdit({
        definitionModelType: IncidentCustomField,
        definitionService: definitions.service,
        updateBy: update({
          payload: { description: "Sites" },
          miscDataProps: {
            renamedDropdownOptions: [{ from: "Old Site", to: "Nowhere" }],
          },
        }),
      }),
    ).rejects.toThrow('"Nowhere" is not one of the field\'s options.');
  });

  test("a write that matches no field carries nothing", async () => {
    const definitions: FakeDefinitionService = definitionService();

    expect(
      await prepareCustomFieldOptionEdit({
        definitionModelType: IncidentCustomField,
        definitionService: definitions.service,
        updateBy: update({
          payload: { dropdownOptions: "B" },
          miscDataProps: { renamedDropdownOptions: [{ from: "A", to: "B" }] },
        }),
      }),
    ).toBeNull();
  });
});

describe("prepareCustomFieldOptionEdit: the fields a teammate's update writes", () => {
  /*
   * The real read of the fields (DatabaseService.findRowsAndHoldUpdateToThem)
   * with the database stubbed: a teammate may write the fields of their own
   * project (stubRowsCallerMayWriteLikeFindBy narrows the read to it), and
   * the suite's findBy answers that read, and the read of those fields by id.
   */
  const OTHER_PROJECT: ObjectID = new ObjectID(
    "55555555-5555-4555-8555-555555555555",
  );

  function answerFields(fields: Array<IncidentCustomField>): MockFunction {
    const findBy: MockFunction = getJestMockFunction();

    findBy.mockImplementation((async (read: {
      query: JSONObject;
    }): Promise<Array<IncidentCustomField>> => {
      const inProject: unknown = read.query["projectId"];

      return fields.filter((field: IncidentCustomField): boolean => {
        return (
          !inProject ||
          String(inProject) === String(field.getColumnValue("projectId"))
        );
      });
    }) as never);

    jest
      .spyOn(IncidentCustomFieldService, "findBy")
      .mockImplementation(findBy as never);
    stubRowsCallerMayWriteLikeFindBy(IncidentCustomFieldService, findBy);

    return findBy;
  }

  test("reads the field among those the caller may write, and holds the update to it", async () => {
    const findBy: MockFunction = answerFields([
      definition(IncidentCustomField, {
        id: fieldId,
        name: "Facility",
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: "Facility A\nFacility B",
      }),
    ]);

    const updateBy: UpdateBy<any> = update({
      payload: { dropdownOptions: "Facility Alpha\nFacility B" },
      miscDataProps: {
        renamedDropdownOptions: [{ from: "Facility A", to: "Facility Alpha" }],
      },
    });

    const carryForward: CustomFieldOptionEditCarryForward | null =
      await prepareCustomFieldOptionEdit({
        definitionModelType: IncidentCustomField,
        definitionService: IncidentCustomFieldService,
        updateBy: updateBy,
      });

    expect(
      carryForward?.fields.map(
        (field: { id: ObjectID; dropdownOptions: string | null }) => {
          return [field.id.toString(), field.dropdownOptions];
        },
      ),
    ).toEqual([[fieldId.toString(), "Facility A\nFacility B"]]);

    // Among the fields the caller may write: those of their project.
    const writable: RowsCallerMayWriteRead = readsOfRowsCallerMayWrite(
      IncidentCustomFieldService,
    )[0]!;
    expect(writable.query["_id"]).toBe(fieldId.toString());
    expect(String(writable.query["projectId"])).toBe(projectId.toString());

    // Then that one, by id, as root, with what the check needs.
    const read: JSONObject = findBy.mock.calls[0]![0] as JSONObject;
    expect(read["query"]).toEqual({ _id: fieldId.toString() });
    expect((read["props"] as JSONObject)["isRoot"]).toBe(true);
    expect(read["select"]).toEqual({
      _id: true,
      projectId: true,
      name: true,
      customFieldType: true,
      dropdownOptions: true,
    });

    // And the update writes the field whose options were checked.
    expect(DatabaseService.getOneRowIdNamedBy(updateBy.query)?.toString()).toBe(
      fieldId.toString(),
    );
  });

  test("a field the caller may not write is not checked: nothing is refused about it, and the update writes nothing", async () => {
    // A text field of another project: renames on it would be refused.
    answerFields([
      definition(IncidentCustomField, {
        id: fieldId,
        name: "Cost Centre",
        customFieldType: CustomFieldType.Text,
        project: OTHER_PROJECT,
      }),
    ]);

    const updateBy: UpdateBy<any> = update({
      payload: { description: "Where the money goes" },
      miscDataProps: { renamedDropdownOptions: [{ from: "A", to: "B" }] },
    });

    await expect(
      prepareCustomFieldOptionEdit({
        definitionModelType: IncidentCustomField,
        definitionService: IncidentCustomFieldService,
        updateBy: updateBy,
      }),
    ).resolves.toBeNull();

    // Held to none of the fields: "any of" no id.
    const held: unknown = (updateBy.query as JSONObject)["_id"];
    expect(held).toBeInstanceOf(FindOperator);
    expect((held as FindOperator<unknown>).value).toEqual([]);
  });

  test("OneUptime's own update reads the fields its query names, in its window", async () => {
    const findBy: MockFunction = answerFields([
      definition(IncidentCustomField, {
        id: fieldId,
        name: "Facility",
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: "A",
        project: OTHER_PROJECT,
      }),
    ]);

    await expect(
      prepareCustomFieldOptionEdit({
        definitionModelType: IncidentCustomField,
        definitionService: IncidentCustomFieldService,
        updateBy: update({
          payload: { dropdownOptions: "B" },
          miscDataProps: { renamedDropdownOptions: [{ from: "A", to: "B" }] },
          props: { isRoot: true },
        }),
      }),
    ).resolves.not.toBeNull();

    expect(readsOfRowsCallerMayWrite(IncidentCustomFieldService)).toEqual([]);
    expect(
      (findBy.mock.calls[0]![0] as JSONObject)["query"] as JSONObject,
    ).toEqual({ _id: fieldId.toString() });
  });
});

describe("applyCustomFieldOptionEdit: the field's own values", () => {
  let definitions: FakeDefinitionService;

  const CARRY: CustomFieldOptionEditCarryForward = {
    fields: [
      {
        id: fieldId,
        projectId: projectId,
        name: "Facility",
        dropdownOptions: "Facility A\nFacility B\nFacility C",
      },
    ],
    renames: [
      { from: "Facility A", to: "Facility Alpha" },
      { from: "Facility B", to: "Facility Beta" },
    ],
  };

  beforeEach(() => {
    definitions = definitionService();
    definitions.findOneById.mockResolvedValue(
      definition(IncidentCustomField, {
        id: fieldId,
        name: "Facility",
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: "Facility Alpha\nFacility Beta\nFacility C",
      }) as never,
    );

    jest
      .spyOn(IncidentService, "getRepository")
      .mockReturnValue(fakeRepository("Incident", [{ moved: 12 }]) as never);
    jest
      .spyOn(IncidentTemplateService, "getRepository")
      .mockReturnValue(
        fakeRepository("IncidentTemplate", [{ moved: 2 }]) as never,
      );
  });

  async function apply(
    carryForward: CustomFieldOptionEditCarryForward | null = CARRY,
    updatedItemIds: Array<ObjectID> = [fieldId],
  ): Promise<void> {
    await applyCustomFieldOptionEdit({
      definitionModelType: IncidentCustomField,
      definitionService: definitions.service,
      carryForward: carryForward,
      updatedItemIds: updatedItemIds,
    });
  }

  test("moves the values on incidents and incident templates, in one transaction", async () => {
    await apply();

    expect(definitions.transaction).toHaveBeenCalledTimes(1);
    expect(
      statements.map((statement: { table: string }): string => {
        return statement.table;
      }),
    ).toEqual(["Incident", "IncidentTemplate"]);

    for (const statement of statements) {
      expect(statement.parameters).toEqual([
        projectId.toString(),
        "Facility",
        JSON.stringify({
          "Facility A": "Facility Alpha",
          "Facility B": "Facility Beta",
        }),
      ]);
    }

    // The field as saved is read back, as root.
    const read: JSONObject = definitions.findOneById.mock
      .calls[0]![0] as JSONObject;
    expect(read["id"]).toEqual(fieldId);
    expect((read["props"] as JSONObject)["isRoot"]).toBe(true);
  });

  test("then the incidents list's saved views and the incident forms' templates", async () => {
    await apply();

    expect(tableViewFindBy).toHaveBeenCalledTimes(1);
    expect(
      (
        (tableViewFindBy.mock.calls[0]![0] as JSONObject)["query"] as JSONObject
      )["projectId"],
    ).toBe(projectId);

    expect(formFindBy).toHaveBeenCalledTimes(1);
    expect((formFindBy.mock.calls[0]![0] as JSONObject)["query"]).toEqual({
      projectId: projectId,
      targetType: FormTargetType.Incident,
    });
  });

  test("moves the values under the name the field is saved with", async () => {
    // Renamed in the same save: the field's rename moved the values first.
    definitions.findOneById.mockResolvedValue(
      definition(IncidentCustomField, {
        id: fieldId,
        name: "Site",
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: "Facility Alpha\nFacility Beta",
      }) as never,
    );

    await apply();

    expect((statements[0]!.parameters as Array<string>)[1]).toBe("Site");
  });

  test("a rename onto an option the saved field does not offer is not made", async () => {
    definitions.findOneById.mockResolvedValue(
      definition(IncidentCustomField, {
        id: fieldId,
        name: "Facility",
        customFieldType: CustomFieldType.Dropdown,
        // Someone saved another list in between.
        dropdownOptions: "Facility Alpha\nFacility C",
      }) as never,
    );

    await apply();

    expect(
      JSON.parse((statements[0]!.parameters as Array<string>)[2]!),
    ).toEqual({ "Facility A": "Facility Alpha" });
  });

  test("nothing happens for a write that changed no row, carried nothing or was not a dropdown", async () => {
    await apply(null);
    await apply({ fields: [], renames: CARRY.renames });
    await apply(CARRY, []);
    await apply(CARRY, [otherFieldId]);

    expect(definitions.findOneById).not.toHaveBeenCalled();

    definitions.findOneById.mockResolvedValue(
      definition(IncidentCustomField, {
        id: fieldId,
        name: "Facility",
        customFieldType: CustomFieldType.Text,
      }) as never,
    );

    await apply();

    definitions.findOneById.mockResolvedValue(null as never);

    await apply();

    expect(definitions.transaction).not.toHaveBeenCalled();
    expect(statements).toEqual([]);
  });

  test("no renames on a field nobody copies is nothing to carry", async () => {
    await apply({ fields: CARRY.fields, renames: [] });

    expect(definitions.transaction).not.toHaveBeenCalled();
    expect(tableViewFindBy).not.toHaveBeenCalled();
    expect(formFindBy).not.toHaveBeenCalled();
  });

  test("values that cannot be moved put the field's options back, and the save fails", async () => {
    tableQueries["IncidentTemplate"]!.mockRejectedValue(
      new Error("connection lost") as never,
    );

    await expect(apply()).rejects.toThrow("connection lost");

    expect(definitions.restore).toHaveBeenCalledTimes(1);
    expect(definitions.restore.mock.calls[0]![0]).toEqual({
      id: fieldId,
      data: { dropdownOptions: "Facility A\nFacility B\nFacility C" },
      // Only if nobody has changed them since.
      expectedData: {
        dropdownOptions: "Facility Alpha\nFacility Beta\nFacility C",
      },
    });

    // Nothing remembered was rewritten for values that never moved.
    expect(tableViewFindBy).not.toHaveBeenCalled();
    expect(formFindBy).not.toHaveBeenCalled();
  });

  test("a failed restore still reports why the values did not move", async () => {
    tableQueries["Incident"]!.mockRejectedValue(
      new Error("connection lost") as never,
    );
    definitions.restore.mockRejectedValue(new Error("still down") as never);

    await expect(apply()).rejects.toThrow("connection lost");
  });

  test("a saved view or form that cannot be rewritten does not fail the save: the values moved", async () => {
    tableViewFindBy.mockRejectedValue(new Error("views down") as never);
    formFindBy.mockRejectedValue(new Error("forms down") as never);

    await expect(apply()).resolves.toBeUndefined();

    expect(statements).toHaveLength(2);
    expect(definitions.restore).not.toHaveBeenCalled();
  });

  test("a field of a resource with no forms rewrites no form", async () => {
    const teams: FakeDefinitionService = definitionService();
    teams.findOneById.mockResolvedValue(
      definition(TeamCustomField, {
        id: fieldId,
        name: "Tier",
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: "Gold\nSilver",
      }) as never,
    );
    jest
      .spyOn(TeamService, "getRepository")
      .mockReturnValue(fakeRepository("Team", [{ moved: 3 }]) as never);

    await applyCustomFieldOptionEdit({
      definitionModelType: TeamCustomField,
      definitionService: teams.service,
      carryForward: {
        fields: [
          {
            id: fieldId,
            projectId: projectId,
            name: "Tier",
            dropdownOptions: "Platinum\nSilver",
          },
        ],
        renames: [{ from: "Platinum", to: "Gold" }],
      },
      updatedItemIds: [fieldId],
    });

    expect(
      statements.map((s: { table: string }) => {
        return s.table;
      }),
    ).toEqual(["Team"]);
    expect(
      (
        (tableViewFindBy.mock.calls[0]![0] as JSONObject)["query"] as JSONObject
      )["tableId"],
    ).toBeDefined();
    expect(formFindBy).not.toHaveBeenCalled();
  });
});

describe("applyCustomFieldOptionEdit: fields that copy a monitor field", () => {
  let monitorFields: FakeDefinitionService;
  let incidentFieldFind: MockFunction;
  let alertFieldFind: MockFunction;
  let maintenanceFieldFind: MockFunction;

  const incidentCopyId: ObjectID = new ObjectID(
    "55555555-5555-4555-8555-555555555555",
  );
  const alertCopyId: ObjectID = new ObjectID(
    "66666666-6666-4666-8666-666666666666",
  );

  beforeEach(() => {
    monitorFields = definitionService();
    monitorFields.findOneById.mockResolvedValue(
      definition(MonitorCustomField, {
        id: fieldId,
        name: "Facility",
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: "Facility Alpha\nFacility B\nFacility D",
      }) as never,
    );

    jest
      .spyOn(MonitorService, "getRepository")
      .mockReturnValue(fakeRepository("Monitor", [{ moved: 7 }]) as never);
    jest
      .spyOn(MonitorTemplateService, "getRepository")
      .mockReturnValue(
        fakeRepository("MonitorTemplate", [{ moved: 1 }]) as never,
      );
    jest
      .spyOn(IncidentService, "getRepository")
      .mockReturnValue(fakeRepository("Incident", [{ moved: 4 }]) as never);
    jest
      .spyOn(IncidentTemplateService, "getRepository")
      .mockReturnValue(
        fakeRepository("IncidentTemplate", [{ moved: 0 }]) as never,
      );
    jest
      .spyOn(AlertService, "getRepository")
      .mockReturnValue(fakeRepository("Alert", [{ moved: 9 }]) as never);
    jest
      .spyOn(IncidentCustomFieldService, "getRepository")
      .mockReturnValue(
        fakeRepository("IncidentCustomField", [{ written: 1 }]) as never,
      );
    jest
      .spyOn(AlertCustomFieldService, "getRepository")
      .mockReturnValue(
        fakeRepository("AlertCustomField", [{ written: 1 }]) as never,
      );

    incidentFieldFind = getJestMockFunction();
    incidentFieldFind.mockResolvedValue([
      definition(IncidentCustomField, {
        id: incidentCopyId,
        name: "Facility",
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: JSON.stringify([
          { value: "Facility A", color: "#ef4444" },
          { value: "Facility B" },
          { value: "Facility Z" },
        ]),
      }),
    ] as never);
    jest
      .spyOn(IncidentCustomFieldService, "findBy")
      .mockImplementation(incidentFieldFind as never);

    alertFieldFind = getJestMockFunction();
    alertFieldFind.mockResolvedValue([
      definition(AlertCustomField, {
        id: alertCopyId,
        name: "Site",
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: "Facility A\nFacility B",
      }),
    ] as never);
    jest
      .spyOn(AlertCustomFieldService, "findBy")
      .mockImplementation(alertFieldFind as never);

    maintenanceFieldFind = getJestMockFunction();
    maintenanceFieldFind.mockResolvedValue([] as never);
    jest
      .spyOn(ScheduledMaintenanceCustomFieldService, "findBy")
      .mockImplementation(maintenanceFieldFind as never);
  });

  async function apply(
    carryForward: CustomFieldOptionEditCarryForward,
  ): Promise<void> {
    await applyCustomFieldOptionEdit({
      definitionModelType: MonitorCustomField,
      definitionService: monitorFields.service,
      carryForward: carryForward,
      updatedItemIds: [fieldId],
    });
  }

  const RENAME_AND_ADD: CustomFieldOptionEditCarryForward = {
    fields: [
      {
        id: fieldId,
        projectId: projectId,
        name: "Facility",
        dropdownOptions: "Facility A\nFacility B",
      },
    ],
    renames: [{ from: "Facility A", to: "Facility Alpha" }],
  };

  test("finds the copying fields of the project by the field's name, before and after the save", async () => {
    monitorFields.findOneById.mockResolvedValue(
      definition(MonitorCustomField, {
        id: fieldId,
        name: "Site",
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: "Facility Alpha\nFacility B",
      }) as never,
    );

    await apply(RENAME_AND_ADD);

    for (const find of [
      incidentFieldFind,
      alertFieldFind,
      maintenanceFieldFind,
    ]) {
      const read: JSONObject = find.mock.calls[0]![0] as JSONObject;
      const query: JSONObject = read["query"] as JSONObject;

      expect(query["projectId"]).toBe(projectId);
      expect(query["mapFromResourceType"]).toBe("Monitor");
      expect(JSON.stringify(query["mapFromCustomFieldName"])).toContain(
        "Facility",
      );
      expect(JSON.stringify(query["mapFromCustomFieldName"])).toContain("Site");
      expect((read["props"] as JSONObject)["isRoot"]).toBe(true);
    }
  });

  test("renames and adds the options of each copying field, and moves their values, with the monitors' in one transaction", async () => {
    await apply(RENAME_AND_ADD);

    expect(monitorFields.transaction).toHaveBeenCalledTimes(1);

    expect(
      statements.map((statement: { table: string }): string => {
        return statement.table;
      }),
      // In the catalog's order: alerts, incidents, scheduled maintenance.
    ).toEqual([
      "Monitor",
      "MonitorTemplate",
      "AlertCustomField",
      "Alert",
      "IncidentCustomField",
      "Incident",
      "IncidentTemplate",
    ]);

    const incidentOptions: { parameters: unknown } = statements.find(
      (statement: { table: string }): boolean => {
        return statement.table === "IncidentCustomField";
      },
    )!;

    expect(incidentOptions.parameters).toEqual([
      JSON.stringify([
        { value: "Facility Alpha", color: "#ef4444" },
        { value: "Facility B" },
        { value: "Facility Z" },
        // Added to the monitor field: offered here too.
        { value: "Facility D" },
      ]),
      incidentCopyId.toString(),
      // Written only if the incident field still holds what was read.
      JSON.stringify([
        { value: "Facility A", color: "#ef4444" },
        { value: "Facility B" },
        { value: "Facility Z" },
      ]),
    ]);

    const alertOptions: { parameters: unknown } = statements.find(
      (statement: { table: string }): boolean => {
        return statement.table === "AlertCustomField";
      },
    )!;

    expect(alertOptions.parameters).toEqual([
      "Facility Alpha\nFacility B\nFacility D",
      alertCopyId.toString(),
      "Facility A\nFacility B",
    ]);

    // The alert field is named Site: its values are moved under that name.
    const alertValues: { parameters: unknown } = statements.find(
      (statement: { table: string }): boolean => {
        return statement.table === "Alert";
      },
    )!;

    expect((alertValues.parameters as Array<string>)[1]).toBe("Site");
  });

  test("rewrites the saved views of the monitors, incidents and alerts lists, and the incident forms", async () => {
    await apply(RENAME_AND_ADD);

    const tableIds: Array<unknown> = tableViewFindBy.mock.calls.map(
      (call: Array<unknown>): unknown => {
        return JSON.stringify(
          ((call[0] as JSONObject)["query"] as JSONObject)["tableId"],
        );
      },
    );

    expect(tableIds).toHaveLength(3);
    expect(tableIds[0]).toContain("all-monitors-table");
    expect(tableIds[1]).toContain("all-alerts-table");
    expect(tableIds[2]).toContain("all-incidents-table");

    // Monitors and alerts have no forms; incidents do.
    expect(formFindBy).toHaveBeenCalledTimes(1);
    expect((formFindBy.mock.calls[0]![0] as JSONObject)["query"]).toEqual({
      projectId: projectId,
      targetType: FormTargetType.Incident,
    });
  });

  test("an option only added to the monitor field is added to the copying fields, and nothing is moved", async () => {
    await apply({
      fields: [
        {
          id: fieldId,
          projectId: projectId,
          name: "Facility",
          dropdownOptions: "Facility Alpha\nFacility B",
        },
      ],
      renames: [],
    });

    expect(
      statements.map((statement: { table: string }): string => {
        return statement.table;
      }),
    ).toEqual(["AlertCustomField", "IncidentCustomField"]);

    expect((statements[0]!.parameters as Array<string>)[0]).toBe(
      "Facility A\nFacility B\nFacility Alpha\nFacility D",
    );

    expect(tableViewFindBy).not.toHaveBeenCalled();
    expect(formFindBy).not.toHaveBeenCalled();
  });

  test("a copying field that already offers everything is left alone", async () => {
    alertFieldFind.mockResolvedValue([
      definition(AlertCustomField, {
        id: alertCopyId,
        name: "Site",
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: "Facility Alpha\nFacility B\nFacility D",
      }),
    ] as never);
    incidentFieldFind.mockResolvedValue([] as never);

    await apply({
      fields: [
        {
          id: fieldId,
          projectId: projectId,
          name: "Facility",
          dropdownOptions: "Facility Alpha\nFacility B",
        },
      ],
      renames: [],
    });

    expect(monitorFields.transaction).not.toHaveBeenCalled();
    expect(statements).toEqual([]);
  });

  test("a copying field that is not a dropdown is not given options", async () => {
    alertFieldFind.mockResolvedValue([
      definition(AlertCustomField, {
        id: alertCopyId,
        name: "Site",
        customFieldType: CustomFieldType.Text,
      }),
    ] as never);
    incidentFieldFind.mockResolvedValue([] as never);

    await apply(RENAME_AND_ADD);

    expect(
      statements.map((statement: { table: string }): string => {
        return statement.table;
      }),
    ).toEqual(["Monitor", "MonitorTemplate"]);
  });

  test("when only new options could not be added to the copying fields, the save stands", async () => {
    tableQueries["AlertCustomField"]!.mockRejectedValue(
      new Error("connection lost") as never,
    );

    await expect(
      apply({
        fields: [
          {
            id: fieldId,
            projectId: projectId,
            name: "Facility",
            dropdownOptions: "Facility Alpha\nFacility B",
          },
        ],
        renames: [],
      }),
    ).resolves.toBeUndefined();

    expect(monitorFields.restore).not.toHaveBeenCalled();
  });

  test("when a copying field's values cannot be moved, nothing is, and the monitor field's options go back", async () => {
    tableQueries["Alert"]!.mockRejectedValue(
      new Error("connection lost") as never,
    );

    await expect(apply(RENAME_AND_ADD)).rejects.toThrow("connection lost");

    expect(monitorFields.restore.mock.calls[0]![0]).toEqual({
      id: fieldId,
      data: { dropdownOptions: "Facility A\nFacility B" },
      expectedData: {
        dropdownOptions: "Facility Alpha\nFacility B\nFacility D",
      },
    });
  });
});

describe("getCustomFieldOptionUsage", () => {
  let definitions: FakeDefinitionService;
  let tableWriteCheck: MockFunction;

  beforeEach(() => {
    definitions = definitionService();
    tableWriteCheck = getJestMockFunction();
    jest
      .spyOn(ModelPermission, "checkTableWritePermission")
      .mockImplementation(tableWriteCheck as never);
  });

  test("reads the field as the caller, and refuses one they cannot read", async () => {
    await expect(
      getCustomFieldOptionUsage({
        definitionModelType: IncidentCustomField,
        definitionService: definitions.service,
        fieldId: fieldId,
        props: ADMIN_PROPS,
      }),
    ).rejects.toThrow(new NotFoundException("Custom field not found."));

    const read: JSONObject = definitions.findOneById.mock
      .calls[0]![0] as JSONObject;
    expect(read["id"]).toEqual(fieldId);
    expect(read["props"]).toBe(ADMIN_PROPS);
    expect(tableWriteCheck).not.toHaveBeenCalled();
  });

  test("takes what editing the field takes", async () => {
    definitions.findOneById.mockResolvedValue(
      definition(IncidentCustomField, {
        id: fieldId,
        name: "Facility",
        customFieldType: CustomFieldType.Dropdown,
      }) as never,
    );
    tableWriteCheck.mockImplementation((() => {
      throw new BadDataException("You do not have permission to edit this.");
    }) as never);

    await expect(
      getCustomFieldOptionUsage({
        definitionModelType: IncidentCustomField,
        definitionService: definitions.service,
        fieldId: fieldId,
        props: ADMIN_PROPS,
      }),
    ).rejects.toThrow("You do not have permission to edit this.");

    expect(tableWriteCheck).toHaveBeenCalledWith(
      IncidentCustomField,
      ADMIN_PROPS,
      DatabaseRequestType.Update,
    );
  });

  test("counts the incidents holding each value of an incident field", async () => {
    definitions.findOneById.mockResolvedValue(
      definition(IncidentCustomField, {
        id: fieldId,
        name: "Facility",
        customFieldType: CustomFieldType.MultiSelectDropdown,
      }) as never,
    );
    jest.spyOn(IncidentService, "getRepository").mockReturnValue(
      fakeRepository("Incident", [
        { value: "Facility A", count: 12 },
        { value: "Old Site", count: 3 },
      ]) as never,
    );

    const usage: CustomFieldOptionUsage = await getCustomFieldOptionUsage({
      definitionModelType: IncidentCustomField,
      definitionService: definitions.service,
      fieldId: fieldId,
      props: ADMIN_PROPS,
    });

    expect(usage).toEqual({
      values: [
        { value: "Facility A", count: 12 },
        { value: "Old Site", count: 3 },
      ],
      copiedBy: [],
    });

    // Only the incidents themselves: templates are not records.
    const [sql, parameters] = tableQueries["Incident"]!.mock.calls[0] as [
      string,
      Array<string>,
    ];
    expect(sql).toContain('FROM "Incident" AS "record"');
    expect(parameters).toEqual([projectId.toString(), "Facility"]);
  });

  test("names the fields that copy a monitor field", async () => {
    definitions.findOneById.mockResolvedValue(
      definition(MonitorCustomField, {
        id: fieldId,
        name: "Facility",
        customFieldType: CustomFieldType.Dropdown,
      }) as never,
    );
    jest
      .spyOn(MonitorService, "getRepository")
      .mockReturnValue(fakeRepository("Monitor", []) as never);

    jest.spyOn(IncidentCustomFieldService, "findBy").mockResolvedValue([
      definition(IncidentCustomField, {
        id: otherFieldId,
        name: "Facility",
        customFieldType: CustomFieldType.Dropdown,
      }),
    ] as never);
    jest
      .spyOn(AlertCustomFieldService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(ScheduledMaintenanceCustomFieldService, "findBy")
      .mockResolvedValue([] as never);

    const usage: CustomFieldOptionUsage = await getCustomFieldOptionUsage({
      definitionModelType: MonitorCustomField,
      definitionService: definitions.service,
      fieldId: fieldId,
      props: ADMIN_PROPS,
    });

    expect(usage.copiedBy).toEqual([
      { resource: "Incident", fieldName: "Facility" },
    ]);
  });

  test("a field that is not a dropdown has nothing to count", async () => {
    definitions.findOneById.mockResolvedValue(
      definition(IncidentCustomField, {
        id: fieldId,
        name: "Ticket",
        customFieldType: CustomFieldType.Text,
      }) as never,
    );
    const incidents: unknown = fakeRepository("Incident", []);
    jest
      .spyOn(IncidentService, "getRepository")
      .mockReturnValue(incidents as never);

    expect(
      await getCustomFieldOptionUsage({
        definitionModelType: IncidentCustomField,
        definitionService: definitions.service,
        fieldId: fieldId,
        props: ADMIN_PROPS,
      }),
    ).toEqual({ values: [], copiedBy: [] });

    expect(tableQueries["Incident"]).not.toHaveBeenCalled();
  });
});
