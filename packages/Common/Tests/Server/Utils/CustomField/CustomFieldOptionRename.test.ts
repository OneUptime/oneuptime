import Form from "../../../../Models/DatabaseModels/Form";
import TableView from "../../../../Models/DatabaseModels/TableView";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import FormService from "../../../../Server/Services/FormService";
import TableViewService from "../../../../Server/Services/TableViewService";
import {
  countCustomFieldOptionValues,
  MAX_COUNTED_CUSTOM_FIELD_VALUES,
  moveCustomFieldOptionValues,
  renameCustomFieldOptionsInFormTemplates,
  renameCustomFieldOptionsInTableViews,
  updateCustomFieldDropdownOptions,
} from "../../../../Server/Utils/CustomField/CustomFieldOptionRename";
import {
  CustomFieldOptionRenameMap,
  CustomFieldOptionUsageValue,
  toCustomFieldOptionRenameMap,
} from "../../../../Types/CustomField/CustomFieldOptionEdit";
import { FormFieldSource } from "../../../../Types/Form/FormField";
import FormTargetType from "../../../../Types/Form/FormTargetType";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The writes behind renaming a dropdown field's options (#4564), with every
 * read and write stubbed: the statements are built from the table's own
 * metadata and hand every value over as a parameter, and the saved views and
 * form templates are rewritten with a compare-and-set, only where they name
 * a renamed option. What the statements DO to rows is pinned against
 * Postgres in CustomFieldOptionEditPostgres.test.ts.
 */

const projectId: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const RENAMES: CustomFieldOptionRenameMap = toCustomFieldOptionRenameMap([
  { from: "Facility A", to: "Facility Alpha" },
  { from: "Facility B", to: "Facility Alpha" },
]);

interface FakeService {
  service: DatabaseService<any>;
  query: MockFunction;
}

// Enough of a service for the raw statements: a repository's metadata and manager.
function fakeService(data: {
  tableName: string;
  columns?: Record<string, string>;
  hasDeletedAt?: boolean;
  answer?: unknown;
}): FakeService {
  const query: MockFunction = getJestMockFunction();
  query.mockResolvedValue((data.answer ?? [{ moved: 0 }]) as never);

  const columns: Record<string, string> = {
    customFields: "customFields",
    projectId: "projectId",
    _id: "_id",
    dropdownOptions: "dropdownOptions",
    ...(data.hasDeletedAt === false ? {} : { deletedAt: "deletedAt" }),
    ...(data.columns || {}),
  };

  const repository: unknown = {
    metadata: {
      tableName: data.tableName,
      findColumnWithPropertyName: (
        propertyName: string,
      ): { databaseName: string } | undefined => {
        return columns[propertyName]
          ? { databaseName: columns[propertyName]! }
          : undefined;
      },
    },
    manager: { query: query },
  };

  return {
    service: {
      getRepository: (): unknown => {
        return repository;
      },
    } as unknown as DatabaseService<any>,
    query: query,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("moveCustomFieldOptionValues", () => {
  test("one UPDATE of the project's records, every value a parameter", async () => {
    const incidents: FakeService = fakeService({
      tableName: "Incident",
      answer: [{ moved: 12 }],
    });

    const moved: number = await moveCustomFieldOptionValues({
      service: incidents.service,
      projectId: projectId,
      fieldName: "Facility",
      renames: RENAMES,
    });

    expect(moved).toBe(12);
    expect(incidents.query).toHaveBeenCalledTimes(1);

    const [sql, parameters] = incidents.query.mock.calls[0] as [
      string,
      Array<string>,
    ];

    expect(sql).toContain('UPDATE "Incident"');
    expect(sql).toContain(
      'SET "customFields" = jsonb_set("customFields", ARRAY[$2::text],',
    );
    expect(sql).toContain('WHERE "projectId" = $1');
    // Only a bag that is an object holds named values.
    expect(sql).toContain(`jsonb_typeof("customFields") = 'object'`);
    // Counted from the rows written, not from TypeORM's update answer.
    expect(sql).toContain('SELECT COUNT(*)::int AS "moved" FROM "renamed"');

    expect(parameters).toEqual([
      projectId.toString(),
      "Facility",
      JSON.stringify({
        "Facility A": "Facility Alpha",
        "Facility B": "Facility Alpha",
      }),
    ]);

    // Neither the field's name nor an option is ever written into the SQL.
    expect(sql).not.toContain("Facility");
  });

  test("maps a single value and a list's entries, dropping repeats a rename makes", async () => {
    const incidents: FakeService = fakeService({ tableName: "Incident" });

    await moveCustomFieldOptionValues({
      service: incidents.service,
      projectId: projectId,
      fieldName: "Facility",
      renames: RENAMES,
    });

    const sql: string = incidents.query.mock.calls[0]![0] as string;

    expect(sql).toContain("WITH ORDINALITY");
    expect(sql).toContain('SELECT DISTINCT ON ("mapping"."mapped")');
    expect(sql).toContain('ORDER BY "mapping"."mapped", "mapping"."position"');
    expect(sql).toContain('jsonb_agg("deduped"."mapped" ORDER BY "deduped"."position")');
    expect(sql).toContain("jsonb_exists($3::jsonb,");
    expect(sql).toContain(
      `jsonb_typeof("element"."entry") IN ('string', 'number', 'boolean')`,
    );
  });

  test("takes the table and column names from the entity metadata", async () => {
    const renamedColumns: FakeService = fakeService({
      tableName: "MonitorTemplate",
      columns: { customFields: "custom_fields", projectId: "project_id" },
    });

    await moveCustomFieldOptionValues({
      service: renamedColumns.service,
      projectId: projectId,
      fieldName: "Region",
      renames: RENAMES,
    });

    const sql: string = renamedColumns.query.mock.calls[0]![0] as string;

    expect(sql).toContain('UPDATE "MonitorTemplate"');
    expect(sql).toContain('"custom_fields"');
    expect(sql).toContain('WHERE "project_id" = $1');
    expect(sql).not.toContain('"customFields"');
  });

  test("runs inside the transaction it is handed", async () => {
    const incidents: FakeService = fakeService({ tableName: "Incident" });
    const manager: { query: MockFunction } = {
      query: getJestMockFunction(),
    };
    manager.query.mockResolvedValue([{ moved: 4 }] as never);

    const moved: number = await moveCustomFieldOptionValues({
      service: incidents.service,
      projectId: projectId,
      fieldName: "Facility",
      renames: RENAMES,
      manager: manager as never,
    });

    expect(moved).toBe(4);
    expect(manager.query).toHaveBeenCalledTimes(1);
    expect(incidents.query).not.toHaveBeenCalled();
  });

  test("a value such as __proto__ is passed as the value it is", async () => {
    const incidents: FakeService = fakeService({ tableName: "Incident" });

    await moveCustomFieldOptionValues({
      service: incidents.service,
      projectId: projectId,
      fieldName: "Facility",
      renames: toCustomFieldOptionRenameMap([
        { from: "__proto__", to: "Prototype" },
      ]),
    });

    expect(
      JSON.parse((incidents.query.mock.calls[0]![1] as Array<string>)[2]!),
    ).toEqual(JSON.parse('{"__proto__":"Prototype"}'));
  });

  test("nothing to rename, or no field name, writes nothing", async () => {
    const incidents: FakeService = fakeService({ tableName: "Incident" });

    expect(
      await moveCustomFieldOptionValues({
        service: incidents.service,
        projectId: projectId,
        fieldName: "Facility",
        renames: new Map(),
      }),
    ).toBe(0);

    expect(
      await moveCustomFieldOptionValues({
        service: incidents.service,
        projectId: projectId,
        fieldName: "",
        renames: RENAMES,
      }),
    ).toBe(0);

    expect(incidents.query).not.toHaveBeenCalled();
  });

  test("a table with no customFields column is refused, not guessed at", async () => {
    const noBag: FakeService = fakeService({
      tableName: "Project",
      columns: { customFields: "" },
    });

    await expect(
      moveCustomFieldOptionValues({
        service: noBag.service,
        projectId: projectId,
        fieldName: "Facility",
        renames: RENAMES,
      }),
    ).rejects.toThrow(
      'Cannot rename a custom field\'s options on Project: it has no "customFields" column.',
    );
  });

  test("an answer that is not rows counts as nothing moved", async () => {
    const incidents: FakeService = fakeService({
      tableName: "Incident",
      answer: [[], 3],
    });

    expect(
      await moveCustomFieldOptionValues({
        service: incidents.service,
        projectId: projectId,
        fieldName: "Facility",
        renames: RENAMES,
      }),
    ).toBe(0);
  });
});

describe("countCustomFieldOptionValues", () => {
  test("counts the project's live records holding each value, the most held first", async () => {
    const incidents: FakeService = fakeService({
      tableName: "Incident",
      answer: [
        { value: "Facility A", count: "12" },
        { value: "Old Site", count: 3 },
        { value: "Nobody", count: 0 },
      ],
    });

    const values: Array<CustomFieldOptionUsageValue> =
      await countCustomFieldOptionValues({
        service: incidents.service,
        projectId: projectId,
        fieldName: "Facility",
      });

    expect(values).toEqual([
      { value: "Facility A", count: 12 },
      { value: "Old Site", count: 3 },
    ]);

    const [sql, parameters] = incidents.query.mock.calls[0] as [
      string,
      Array<string>,
    ];

    expect(parameters).toEqual([projectId.toString(), "Facility"]);
    expect(sql).toContain('FROM "Incident" AS "record"');
    expect(sql).toContain('WHERE "record"."projectId" = $1');
    // Deleted records hold no answer anybody sees.
    expect(sql).toContain('AND "record"."deletedAt" IS NULL');
    // A record listing a value twice counts once.
    expect(sql).toContain("SELECT DISTINCT");
    expect(sql).toContain('GROUP BY "held"."value"');
    expect(sql).toContain('ORDER BY COUNT(*) DESC, "held"."value" ASC');
    expect(sql).toContain(`LIMIT ${MAX_COUNTED_CUSTOM_FIELD_VALUES}`);
    expect(sql).not.toContain("Facility");
  });

  test("a table without soft deletes is counted whole", async () => {
    const table: FakeService = fakeService({
      tableName: "IncidentTemplate",
      hasDeletedAt: false,
      answer: [],
    });

    await countCustomFieldOptionValues({
      service: table.service,
      projectId: projectId,
      fieldName: "Facility",
    });

    expect(table.query.mock.calls[0]![0] as string).not.toContain("deletedAt");
  });

  test("answers at most the limit asked for, and never more than the cap", async () => {
    const incidents: FakeService = fakeService({
      tableName: "Incident",
      answer: [],
    });

    await countCustomFieldOptionValues({
      service: incidents.service,
      projectId: projectId,
      fieldName: "Facility",
      limit: 5,
    });

    await countCustomFieldOptionValues({
      service: incidents.service,
      projectId: projectId,
      fieldName: "Facility",
      limit: 50000,
    });

    expect(incidents.query.mock.calls[0]![0] as string).toContain("LIMIT 5");
    expect(incidents.query.mock.calls[1]![0] as string).toContain(
      `LIMIT ${MAX_COUNTED_CUSTOM_FIELD_VALUES}`,
    );
  });

  test("no field name counts nothing, and asks nothing", async () => {
    const incidents: FakeService = fakeService({ tableName: "Incident" });

    expect(
      await countCustomFieldOptionValues({
        service: incidents.service,
        projectId: projectId,
        fieldName: "",
      }),
    ).toEqual([]);

    expect(incidents.query).not.toHaveBeenCalled();
  });
});

describe("updateCustomFieldDropdownOptions", () => {
  test("sets the option list only if the field still holds what was read", async () => {
    const definitions: FakeService = fakeService({
      tableName: "IncidentCustomField",
      answer: [{ written: 1 }],
    });

    const fieldId: ObjectID = ObjectID.generate();

    expect(
      await updateCustomFieldDropdownOptions({
        service: definitions.service,
        fieldId: fieldId,
        expectedDropdownOptions: "A\nB",
        dropdownOptions: "Alpha\nB",
      }),
    ).toBe(true);

    const [sql, parameters] = definitions.query.mock.calls[0] as [
      string,
      Array<string | null>,
    ];

    expect(sql).toContain('UPDATE "IncidentCustomField"');
    expect(sql).toContain('SET "dropdownOptions" = $1');
    expect(sql).toContain('WHERE "_id" = $2');
    expect(sql).toContain('AND "dropdownOptions" IS NOT DISTINCT FROM $3');
    expect(parameters).toEqual(["Alpha\nB", fieldId.toString(), "A\nB"]);
  });

  test("says when someone changed the options first", async () => {
    const definitions: FakeService = fakeService({
      tableName: "IncidentCustomField",
      answer: [{ written: 0 }],
    });

    expect(
      await updateCustomFieldDropdownOptions({
        service: definitions.service,
        fieldId: ObjectID.generate(),
        expectedDropdownOptions: null,
        dropdownOptions: "Alpha",
      }),
    ).toBe(false);
  });
});

describe("renameCustomFieldOptionsInTableViews", () => {
  let findBy: MockFunction;
  let write: MockFunction;

  beforeEach(() => {
    findBy = getJestMockFunction();
    write = getJestMockFunction();
    write.mockResolvedValue(undefined as never);

    jest.spyOn(TableViewService, "findBy").mockImplementation(findBy as never);
    jest
      .spyOn(TableViewService, "updateColumnsByIdWithoutHooks")
      .mockImplementation(write as never);
  });

  function view(data: {
    facets?: JSONObject;
    query?: JSONObject;
  }): TableView {
    const item: TableView = new TableView();
    item._id = ObjectID.generate().toString();
    item.facets = data.facets as JSONObject;
    item.query = (data.query || {}) as never;
    return item;
  }

  test("rewrites the views that select a renamed option, with a compare-and-set", async () => {
    const selecting: TableView = view({
      facets: {
        facetSelections: { "customField:Facility": ["Facility B", "Other"] },
      },
    });
    const notSelecting: TableView = view({
      facets: { facetSelections: { "customField:Facility": ["Other"] } },
    });

    findBy.mockResolvedValue([selecting, notSelecting] as never);

    const rewritten: number = await renameCustomFieldOptionsInTableViews({
      projectId: projectId,
      tableIds: ["all-incidents-table"],
      fieldName: "Facility",
      renames: RENAMES,
    });

    expect(rewritten).toBe(1);

    const read: JSONObject = findBy.mock.calls[0]![0] as JSONObject;
    expect((read["query"] as JSONObject)["projectId"]).toBe(projectId);
    expect((read["props"] as JSONObject)["isRoot"]).toBe(true);

    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]![0]).toEqual({
      id: selecting.id,
      data: {
        facets: {
          facetSelections: {
            "customField:Facility": ["Facility Alpha", "Other"],
          },
        },
      },
      expectedData: { facets: selecting.facets },
      skipUpdateDateColumn: true,
    });
  });

  test("no tables, no field name or no renames reads nothing", async () => {
    for (const input of [
      { tableIds: [], fieldName: "Facility", renames: RENAMES },
      { tableIds: ["all-incidents-table"], fieldName: "", renames: RENAMES },
      {
        tableIds: ["all-incidents-table"],
        fieldName: "Facility",
        renames: new Map<string, string>(),
      },
    ]) {
      expect(
        await renameCustomFieldOptionsInTableViews({
          projectId: projectId,
          ...input,
        }),
      ).toBe(0);
    }

    expect(findBy).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});

describe("renameCustomFieldOptionsInFormTemplates", () => {
  const fieldId: ObjectID = new ObjectID(
    "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
  );

  let findBy: MockFunction;
  let write: MockFunction;

  beforeEach(() => {
    findBy = getJestMockFunction();
    write = getJestMockFunction();
    write.mockResolvedValue(undefined as never);

    jest.spyOn(FormService, "findBy").mockImplementation(findBy as never);
    jest
      .spyOn(FormService, "updateColumnsByIdWithoutHooks")
      .mockImplementation(write as never);
  });

  function form(fields: JSONArray, templates: JSONArray): Form {
    const item: Form = new Form();
    item._id = ObjectID.generate().toString();
    item.fields = fields;
    item.templates = templates;
    return item;
  }

  const FACILITY_QUESTION: JSONObject = {
    id: "facility",
    source: FormFieldSource.TargetCustomField,
    label: "Where?",
    isRequired: false,
    // Stored in any case: compared without it.
    customFieldId: fieldId.toString().toUpperCase(),
  };

  const OTHER_QUESTION: JSONObject = {
    id: "region",
    source: FormFieldSource.TargetCustomField,
    label: "Region",
    isRequired: false,
    customFieldId: ObjectID.generate().toString(),
  };

  const OWN_QUESTION: JSONObject = {
    id: "own",
    source: FormFieldSource.Question,
    label: "Own",
    isRequired: false,
    type: "Dropdown",
    dropdownOptions: "Facility A\nElse",
  };

  test("renames the answers templates hold for questions that are the field, and nothing else", async () => {
    const templates: JSONArray = [
      {
        id: "outage",
        name: "Outage",
        isDefault: true,
        answers: {
          facility: "Facility A",
          region: "Facility A",
          own: "Facility A",
        },
      },
      {
        id: "multi",
        name: "Several",
        answers: { facility: ["Facility B", "Facility Alpha", "Facility C"] },
      },
      { id: "untouched", name: "Untouched", answers: { facility: "Facility C" } },
      { id: "empty", name: "Empty", answers: {} },
    ];

    const target: Form = form(
      [FACILITY_QUESTION, OTHER_QUESTION, OWN_QUESTION],
      templates,
    );

    findBy.mockResolvedValue([target] as never);

    const rewritten: number = await renameCustomFieldOptionsInFormTemplates({
      projectId: projectId,
      targetType: FormTargetType.Incident,
      customFieldId: fieldId,
      renames: RENAMES,
    });

    expect(rewritten).toBe(1);

    const read: JSONObject = findBy.mock.calls[0]![0] as JSONObject;
    expect(read["query"]).toEqual({
      projectId: projectId,
      targetType: FormTargetType.Incident,
    });
    expect((read["props"] as JSONObject)["isRoot"]).toBe(true);

    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]![0]).toEqual({
      id: target.id,
      data: {
        templates: [
          {
            id: "outage",
            name: "Outage",
            isDefault: true,
            answers: {
              facility: "Facility Alpha",
              // Another field's question, and the form's own question.
              region: "Facility A",
              own: "Facility A",
            },
          },
          {
            id: "multi",
            name: "Several",
            answers: { facility: ["Facility Alpha", "Facility C"] },
          },
          {
            id: "untouched",
            name: "Untouched",
            answers: { facility: "Facility C" },
          },
          { id: "empty", name: "Empty", answers: {} },
        ],
      },
      // Written only if nobody saved the templates in the meantime.
      expectedData: { templates: templates },
    });
  });

  test("a form that does not ask the field, or holds no renamed answer, is not written", async () => {
    findBy.mockResolvedValue([
      form([OTHER_QUESTION], [{ id: "t", name: "T", answers: { region: "Facility A" } }]),
      form([FACILITY_QUESTION], [{ id: "t", name: "T", answers: { facility: "Facility C" } }]),
      form([FACILITY_QUESTION], []),
      form([FACILITY_QUESTION], "broken" as unknown as JSONArray),
    ] as never);

    expect(
      await renameCustomFieldOptionsInFormTemplates({
        projectId: projectId,
        targetType: FormTargetType.Incident,
        customFieldId: fieldId,
        renames: RENAMES,
      }),
    ).toBe(0);

    expect(write).not.toHaveBeenCalled();
  });

  test("templates that are not objects are written back as they were", async () => {
    const templates: JSONArray = [
      "not a template" as unknown as JSONObject,
      { id: "t", name: "T", answers: "broken" },
      { id: "u", name: "U", answers: { facility: "Facility B" } },
    ];

    findBy.mockResolvedValue([form([FACILITY_QUESTION], templates)] as never);

    await renameCustomFieldOptionsInFormTemplates({
      projectId: projectId,
      targetType: FormTargetType.ScheduledMaintenance,
      customFieldId: fieldId,
      renames: RENAMES,
    });

    expect(
      (write.mock.calls[0]![0] as { data: { templates: JSONArray } }).data
        .templates,
    ).toEqual([
      "not a template",
      { id: "t", name: "T", answers: "broken" },
      { id: "u", name: "U", answers: { facility: "Facility Alpha" } },
    ]);
  });

  test("no renames reads no forms", async () => {
    expect(
      await renameCustomFieldOptionsInFormTemplates({
        projectId: projectId,
        targetType: FormTargetType.Incident,
        customFieldId: fieldId,
        renames: new Map(),
      }),
    ).toBe(0);

    expect(findBy).not.toHaveBeenCalled();
  });
});
