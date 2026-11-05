import CustomFieldType from "../../../../../Types/CustomField/CustomFieldType";
import { CUSTOM_FIELD_RECORD_KINDS } from "../../../../../Types/CustomField/CustomFieldRecordKinds";
import TableColumnType from "../../../../../Types/Database/TableColumnType";
import { JSONObject } from "../../../../../Types/JSON";
import { DictionaryFilterOperator } from "../../../../../UI/Components/Dictionary/DictionaryFilterOperator";
import {
  columnPickLabel,
  controlForColumn,
  controlForFilter,
  isOfferableColumn,
  jsonOnlyColumns,
  literalFitsControl,
} from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnControl";
import { operatorsForControl } from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnOperators";
import {
  ColumnPickerGroup,
  ColumnPickerGroupId,
  groupPickerColumns,
  isColumnKeyInformative,
  searchPickerColumns,
} from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnPickerOptions";
import {
  ColumnValueMode,
  ModelColumnControl,
  ModelColumnRow,
  makeColumnRow,
} from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnRow";
import {
  isCustomFieldBag,
  rowIssue,
  rowsFromParsedValue,
  serializeColumnRows,
} from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnRowSerialization";
import { ColumnUse } from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnUse";
import {
  WorkflowCustomField,
  toCustomFieldColumn,
  withCustomFieldColumns,
} from "../../../../../UI/Components/Workflow/CustomFields/CustomFieldColumns";
import {
  ModelColumnEditorMode,
  classifyColumnValueCompatibility,
} from "../../../../../UI/Components/Workflow/ModelColumnEditor";
import { ModelSchemaColumn } from "../../../../../UI/Components/Workflow/ModelSchema";
import { describe, expect, test } from "@jest/globals";

/*
 * Issue #5942, in the record editor and the query builder: a project's custom
 * fields are fields of the record to fill in, each with what its type takes, and
 * what a step stores is the customFields column it always was - a workflow that
 * is only opened and saved does not change by a byte.
 */

const CUSTOM_FIELDS_COLUMN_DESCRIPTOR: ModelSchemaColumn = {
  id: "customFields",
  title: "Custom Fields",
  type: TableColumnType.JSON,
  isRelation: false,
  canCreate: true,
  canUpdate: true,
};

const TITLE_COLUMN: ModelSchemaColumn = {
  id: "title",
  title: "Title",
  type: TableColumnType.ShortText,
  isRelation: false,
  required: true,
};

const FIELDS: Array<WorkflowCustomField> = [
  {
    name: "Priority Level",
    customFieldType: CustomFieldType.Dropdown,
    description: "How urgent this is",
    options: [{ value: "P1" }, { value: "P2", color: "#f57c00" }],
  },
  {
    name: "Tags",
    customFieldType: CustomFieldType.MultiSelectDropdown,
    options: [{ value: "blue" }, { value: "green" }, { value: "red" }],
  },
  { name: "Count", customFieldType: CustomFieldType.Number, options: [] },
  { name: "Reviewed", customFieldType: CustomFieldType.Boolean, options: [] },
  { name: "Due On", customFieldType: CustomFieldType.Date, options: [] },
  { name: "Seen At", customFieldType: CustomFieldType.DateTime, options: [] },
  { name: "Summary", customFieldType: CustomFieldType.LongText, options: [] },
  { name: "Notes", customFieldType: CustomFieldType.Markdown, options: [] },
  { name: "Customer", customFieldType: CustomFieldType.Text, options: [] },
  { name: "Contract", customFieldType: CustomFieldType.File, options: [] },
  {
    name: "Scans",
    customFieldType: CustomFieldType.MultipleFiles,
    options: [],
  },
  { name: "No Type", options: [] },
  { name: "Release 1.2", customFieldType: CustomFieldType.Text, options: [] },
];

const COLUMNS: Array<ModelSchemaColumn> = withCustomFieldColumns(
  [TITLE_COLUMN, CUSTOM_FIELDS_COLUMN_DESCRIPTOR],
  FIELDS,
);

type ColumnFunction = (name: string) => ModelSchemaColumn;

const column: ColumnFunction = (name: string): ModelSchemaColumn => {
  return COLUMNS.find((candidate: ModelSchemaColumn): boolean => {
    return candidate.id === `customFields.${name}`;
  }) as ModelSchemaColumn;
};

describe("withCustomFieldColumns", () => {
  test("adds a column for each custom field, keeping the record's own", () => {
    expect(COLUMNS).toHaveLength(2 + FIELDS.length);
    expect(COLUMNS[0]).toBe(TITLE_COLUMN);
    expect(column("Tags").title).toBe("Tags");
    expect(column("Priority Level").description).toBe("How urgent this is");
  });

  test("adds none where the model has no customFields column", () => {
    expect(withCustomFieldColumns([TITLE_COLUMN], FIELDS)).toEqual([
      TITLE_COLUMN,
    ]);
  });

  test("adds none where the project has no custom fields", () => {
    expect(
      withCustomFieldColumns(
        [TITLE_COLUMN, CUSTOM_FIELDS_COLUMN_DESCRIPTOR],
        [],
      ),
    ).toHaveLength(2);
  });

  test("a field may be written as far as the column they all live in may", () => {
    const updateOnly: ModelSchemaColumn = toCustomFieldColumn(FIELDS[2]!, {
      ...CUSTOM_FIELDS_COLUMN_DESCRIPTOR,
      canCreate: false,
    });

    expect(isOfferableColumn(updateOnly, ColumnUse.Create)).toBe(false);
    expect(isOfferableColumn(updateOnly, ColumnUse.Update)).toBe(true);
  });

  test("a custom field is never a system column, required or the project", () => {
    for (const field of FIELDS) {
      const fieldColumn: ModelSchemaColumn = column(field.name);

      expect(fieldColumn.required).toBe(false);
      expect(fieldColumn.isSystemColumn).toBe(false);
      expect(fieldColumn.isTenantColumn).toBe(false);
      expect(fieldColumn.isRelation).toBe(false);
    }
  });
});

describe("what each kind of custom field is filled in with", () => {
  test.each([
    ["Customer", ModelColumnControl.Text, "Text"],
    ["Summary", ModelColumnControl.LongText, "Long text"],
    ["Notes", ModelColumnControl.LongText, "Long text"],
    ["Count", ModelColumnControl.Number, "Number"],
    ["Reviewed", ModelColumnControl.Boolean, "True or false"],
    ["Due On", ModelColumnControl.DateOnly, "Date"],
    ["Seen At", ModelColumnControl.Date, "Date and time"],
    ["Priority Level", ModelColumnControl.Choice, "Choice"],
    ["Tags", ModelColumnControl.ChoiceList, "Choices"],
    ["No Type", ModelColumnControl.Text, "Text"],
  ] as Array<[string, ModelColumnControl, string]>)(
    "%s",
    (name: string, control: ModelColumnControl, label: string) => {
      expect(controlForColumn(column(name))).toBe(control);
      expect(columnPickLabel(column(name))).toBe(label);
    },
  );

  test("every kind there is has its control: nothing falls through to JSON by accident", () => {
    for (const kind of Object.values(CustomFieldType)) {
      const control: ModelColumnControl = controlForColumn(
        toCustomFieldColumn(
          { name: "x", customFieldType: kind, options: [] },
          CUSTOM_FIELDS_COLUMN_DESCRIPTOR,
        ),
      );

      expect([kind, control]).toEqual([
        kind,
        kind === CustomFieldType.File || kind === CustomFieldType.MultipleFiles
          ? ModelColumnControl.Unsupported
          : expect.anything(),
      ]);
    }
  });
});

describe("what a query does with them", () => {
  test("a multi-select is filtered on one option, or several with is any of", () => {
    expect(controlForFilter(column("Tags"))).toBe(ModelColumnControl.Choice);
    expect(operatorsForControl(ModelColumnControl.Choice)).toEqual(
      expect.arrayContaining([
        DictionaryFilterOperator.EqualTo,
        DictionaryFilterOperator.IsAnyOf,
        DictionaryFilterOperator.IsEmpty,
      ]),
    );
  });

  test("a date offers before and after", () => {
    expect(operatorsForControl(ModelColumnControl.DateOnly)).toContain(
      DictionaryFilterOperator.GreaterThan,
    );
  });

  test("any other kind is filtered as it is filled in", () => {
    expect(controlForFilter(column("Count"))).toBe(ModelColumnControl.Number);
    expect(controlForFilter(column("Priority Level"))).toBe(
      ModelColumnControl.Choice,
    );
  });

  test("a date's value is held to being a date", () => {
    const row: ModelColumnRow = makeColumnRow({
      columnId: "customFields.Due On",
      text: "not a date",
    });

    expect(rowIssue(row, column("Due On"))).toBe(
      "This column takes a date and time.",
    );
  });
});

describe("the list a field is added from", () => {
  const offered: Array<ModelSchemaColumn> = COLUMNS.filter(
    (candidate: ModelSchemaColumn): boolean => {
      return isOfferableColumn(candidate, ColumnUse.Create);
    },
  );

  test("lists them, but not the column they all live in, nor file fields", () => {
    const ids: Array<string> = offered.map(
      (candidate: ModelSchemaColumn): string => {
        return candidate.id;
      },
    );

    expect(ids).toContain("customFields.Priority Level");
    expect(ids).toContain("customFields.Tags");
    expect(ids).not.toContain("customFields");
    expect(ids).not.toContain("customFields.Contract");
    expect(ids).not.toContain("customFields.Scans");
  });

  test("groups them apart, in the order the project keeps them", () => {
    const groups: Array<ColumnPickerGroup> = groupPickerColumns({
      columns: offered,
      use: ColumnUse.Create,
      requiredColumnIds: [],
    });

    const custom: ColumnPickerGroup | undefined = groups.find(
      (group: ColumnPickerGroup): boolean => {
        return group.id === ColumnPickerGroupId.Custom;
      },
    );

    expect(custom?.label).toBe("Custom fields");
    expect(custom?.columns[0]?.title).toBe("Priority Level");
    expect(custom?.columns[1]?.title).toBe("Tags");
    expect(
      groups.map((group: ColumnPickerGroup): ColumnPickerGroupId => {
        return group.id;
      }),
    ).toEqual([ColumnPickerGroupId.Main, ColumnPickerGroupId.Custom]);
  });

  test("a search finds one by its name, and all of them by the word custom", () => {
    expect(searchPickerColumns(offered, "priority")[0]?.title).toBe(
      "Priority Level",
    );

    expect(searchPickerColumns(offered, "custom").length).toBe(
      offered.length - 1,
    );
  });

  test("does not print the path under a name a person gave it", () => {
    expect(isColumnKeyInformative(column("Priority Level"))).toBe(false);
  });

  test("the ones that cannot be a row are named as JSON only, and the column is not", () => {
    const names: Array<string> = jsonOnlyColumns(COLUMNS, ColumnUse.Create).map(
      (candidate: ModelSchemaColumn): string => {
        return candidate.title;
      },
    );

    expect(names).toEqual(["Contract", "Scans"]);
  });
});

describe("isCustomFieldBag", () => {
  test("is a bag of named values", () => {
    expect(isCustomFieldBag({ Team: "a" })).toBe(true);
  });

  test.each([
    ["no value", null],
    ["an empty bag, which has nothing to show", {}],
    ["a reference for the whole bag", "{{local.variables.x}}"],
    ["a list", ["a"]],
    ["an operator on the whole column", { _type: "IsNull" }],
  ])("is not %s", (_name: string, value: unknown) => {
    expect(isCustomFieldBag(value)).toBe(false);
  });
});

type RoundTripFunction = (
  value: JSONObject,
  mode?: ModelColumnEditorMode,
) => string;

const roundTrip: RoundTripFunction = (
  value: JSONObject,
  mode: ModelColumnEditorMode = ModelColumnEditorMode.Record,
): string => {
  return serializeColumnRows(
    rowsFromParsedValue(value, COLUMNS, mode),
    COLUMNS,
    mode,
  );
};

describe("opening a record and saving it again", () => {
  test.each([
    ["a dropdown", { customFields: { "Priority Level": "P1" } }],
    ["a multi-select", { customFields: { Tags: ["red", "blue"] } }],
    ["a number", { customFields: { Count: 3 } }],
    ["a switch that is off", { customFields: { Reviewed: false } }],
    ["a date", { customFields: { "Due On": "2026-11-20" } }],
    ["a time", { customFields: { "Seen At": "2026-11-20T10:00:00.000Z" } }],
    ["text", { customFields: { Customer: "Acme" } }],
    ["a name with a dot", { customFields: { "Release 1.2": "x" } }],
    ["a field to clear", { customFields: { Customer: null } }],
    ["a number stored as text", { customFields: { Count: "3" } }],
    ["a deleted field", { customFields: { "Old Field": "kept" } }],
    [
      "a reference",
      { customFields: { Customer: "{{local.variables.customer}}" } },
    ],
    [
      "several, in their order, between other fields",
      {
        title: "Down",
        customFields: { Tags: ["blue"], Count: 3, Customer: "Acme" },
      },
    ],
    ["the bag cleared whole", { customFields: null }],
    ["the bag from a reference", { customFields: "{{local.variables.bag}}" }],
  ] as Array<[string, JSONObject]>)(
    "keeps %s",
    (_name: string, stored: JSONObject) => {
      expect(roundTrip(stored)).toBe(JSON.stringify(stored));
    },
  );

  test("gives each custom field a row of its own, named by its path", () => {
    const rows: Array<ModelColumnRow> = rowsFromParsedValue(
      { title: "Down", customFields: { Tags: ["blue"], Count: 3 } },
      COLUMNS,
      ModelColumnEditorMode.Record,
    );

    expect(
      rows.map((row: ModelColumnRow): string => {
        return row.columnId;
      }),
    ).toEqual(["title", "customFields.Tags", "customFields.Count"]);
    expect(rows[1]?.values).toEqual(["blue"]);
    expect(rows[2]?.text).toBe("3");
  });

  test("a value of another kind than its field's is kept as it was", () => {
    const rows: Array<ModelColumnRow> = rowsFromParsedValue(
      { customFields: { Tags: "blue", Count: "many" } },
      COLUMNS,
      ModelColumnEditorMode.Record,
    );

    expect(rows[0]?.valueMode).toBe(ColumnValueMode.Raw);
    expect(rows[1]?.valueMode).toBe(ColumnValueMode.Raw);
  });
});

describe("what a row writes", () => {
  type WriteFunction = (rows: Array<ModelColumnRow>) => string;

  const write: WriteFunction = (rows: Array<ModelColumnRow>): string => {
    return serializeColumnRows(rows, COLUMNS, ModelColumnEditorMode.Record);
  };

  test("goes under the customFields column, keyed by the field's name", () => {
    expect(
      write([
        makeColumnRow({
          columnId: "customFields.Priority Level",
          text: "P1",
        }),
      ]),
    ).toBe(JSON.stringify({ customFields: { "Priority Level": "P1" } }));
  });

  test("a number is a number, as the server's check of a Number field wants", () => {
    expect(
      write([makeColumnRow({ columnId: "customFields.Count", text: "3" })]),
    ).toBe(JSON.stringify({ customFields: { Count: 3 } }));
  });

  test("a switch is true or false", () => {
    expect(
      write([
        makeColumnRow({ columnId: "customFields.Reviewed", text: "false" }),
      ]),
    ).toBe(JSON.stringify({ customFields: { Reviewed: false } }));
  });

  test("several options are a list of them", () => {
    expect(
      write([
        makeColumnRow({
          columnId: "customFields.Tags",
          values: ["blue", "red"],
        }),
      ]),
    ).toBe(JSON.stringify({ customFields: { Tags: ["blue", "red"] } }));
  });

  test("a blank one says nothing about the field, and no bag is written for it", () => {
    expect(
      write([
        makeColumnRow({ columnId: "customFields.Customer", text: "" }),
        makeColumnRow({ columnId: "customFields.Tags", values: [] }),
      ]),
    ).toBe("");
  });

  test("a blank one beside a set one is left out of the bag", () => {
    expect(
      write([
        makeColumnRow({ columnId: "customFields.Customer", text: "" }),
        makeColumnRow({ columnId: "customFields.Count", text: "1" }),
      ]),
    ).toBe(JSON.stringify({ customFields: { Count: 1 } }));
  });

  test("a new field joins the bag where the bag already is", () => {
    const rows: Array<ModelColumnRow> = [
      ...rowsFromParsedValue(
        { customFields: { Count: 1 }, title: "Down" },
        COLUMNS,
        ModelColumnEditorMode.Record,
      ),
      makeColumnRow({ columnId: "customFields.Customer", text: "Acme" }),
    ];

    expect(write(rows)).toBe(
      JSON.stringify({
        customFields: { Count: 1, Customer: "Acme" },
        title: "Down",
      }),
    );
  });

  test("a value from an earlier step is written as the reference it is", () => {
    expect(
      write([
        makeColumnRow({
          columnId: "customFields.Count",
          valueMode: ColumnValueMode.Reference,
          text: "{{local.variables.count}}",
        }),
      ]),
    ).toBe(
      JSON.stringify({
        customFields: { Count: "{{local.variables.count}}" },
      }),
    );
  });
});

describe("a query's conditions", () => {
  test.each([
    ["equals, stored bare", { customFields: { "Priority Level": "P1" } }],
    [
      "a comparison",
      { customFields: { Count: { _type: "GreaterThan", value: 2 } } },
    ],
    [
      "is any of",
      { customFields: { Tags: { _type: "Includes", value: ["red", "blue"] } } },
    ],
    [
      "is not set, as the operator writes itself",
      { customFields: { Customer: { _type: "IsNull", value: null } } },
    ],
    [
      "beside a column of the record",
      { title: "Down", customFields: { Customer: "Acme" } },
    ],
  ] as Array<[string, JSONObject]>)(
    "keeps %s",
    (_name: string, stored: JSONObject) => {
      expect(
        JSON.parse(roundTrip(stored, ModelColumnEditorMode.Query)),
      ).toEqual(stored);
    },
  );

  test("a condition with no value yet is still a condition on it", () => {
    expect(
      serializeColumnRows(
        [makeColumnRow({ columnId: "customFields.Customer", text: "" })],
        COLUMNS,
        ModelColumnEditorMode.Query,
      ),
    ).toBe(JSON.stringify({ customFields: { Customer: "" } }));
  });

  test("reads a comparison's operator and value into the row", () => {
    const rows: Array<ModelColumnRow> = rowsFromParsedValue(
      { customFields: { Count: { _type: "GreaterThan", value: 2 } } },
      COLUMNS,
      ModelColumnEditorMode.Query,
    );

    expect(rows[0]?.operator).toBe(DictionaryFilterOperator.GreaterThan);
    expect(rows[0]?.text).toBe("2");
    expect(rows[0]?.valueMode).toBe(ColumnValueMode.Literal);
  });

  test("reads is any of's options into the row", () => {
    const rows: Array<ModelColumnRow> = rowsFromParsedValue(
      { customFields: { Tags: { _type: "Includes", value: ["red"] } } },
      COLUMNS,
      ModelColumnEditorMode.Query,
    );

    expect(rows[0]?.operator).toBe(DictionaryFilterOperator.IsAnyOf);
    expect(rows[0]?.values).toEqual(["red"]);
  });
});

describe("classifyColumnValueCompatibility", () => {
  test("a bag of values the rows can show is rows, not JSON", () => {
    expect(
      classifyColumnValueCompatibility(
        {
          customFields: {
            "Priority Level": "P1",
            Tags: ["blue"],
            Count: 2,
            Reviewed: true,
          },
        },
        COLUMNS,
        ModelColumnEditorMode.Record,
      ),
    ).toEqual({ compatible: true, reasons: [] });
  });

  test("a field the project no longer has is no warning: its row says so", () => {
    expect(
      classifyColumnValueCompatibility(
        { customFields: { "Old Field": "kept" } },
        COLUMNS,
        ModelColumnEditorMode.Record,
      ),
    ).toEqual({ compatible: true, reasons: [] });
  });

  test("a file's reference stays JSON, saying which field", () => {
    const result: { compatible: boolean; reasons: Array<string> } =
      classifyColumnValueCompatibility(
        { customFields: { Contract: { fileId: "x", name: "a.pdf" } } },
        COLUMNS,
        ModelColumnEditorMode.Record,
      );

    expect(result.compatible).toBe(false);
    expect(result.reasons.join(" ")).toContain("customFields.Contract");
  });

  test("a list on a field that takes one value stays JSON", () => {
    expect(
      classifyColumnValueCompatibility(
        { customFields: { Customer: ["a", "b"] } },
        COLUMNS,
        ModelColumnEditorMode.Record,
      ).compatible,
    ).toBe(false);
  });

  test("a list of anything but options stays JSON", () => {
    expect(
      classifyColumnValueCompatibility(
        { customFields: { Tags: [1, 2] } },
        COLUMNS,
        ModelColumnEditorMode.Record,
      ).compatible,
    ).toBe(false);
  });

  test("with no schema to go by, the bag stays JSON", () => {
    expect(
      classifyColumnValueCompatibility(
        { customFields: { Customer: "a" } },
        [],
        ModelColumnEditorMode.Record,
      ).compatible,
    ).toBe(false);
  });

  test("a query's operator on a custom field is a row", () => {
    expect(
      classifyColumnValueCompatibility(
        { customFields: { Count: { _type: "GreaterThan", value: 2 } } },
        COLUMNS,
        ModelColumnEditorMode.Query,
      ).compatible,
    ).toBe(true);
  });

  test("an operator on the whole column is still its own row", () => {
    expect(
      classifyColumnValueCompatibility(
        { customFields: { _type: "IsNull" } },
        COLUMNS,
        ModelColumnEditorMode.Query,
      ).compatible,
    ).toBe(true);
  });
});

describe("literalFitsControl, for a custom field's options", () => {
  test("a list of text fits several options", () => {
    expect(literalFitsControl(ModelColumnControl.ChoiceList, ["a", "b"])).toBe(
      true,
    );
    expect(literalFitsControl(ModelColumnControl.ChoiceList, [])).toBe(true);
  });

  test("nothing else does", () => {
    expect(literalFitsControl(ModelColumnControl.ChoiceList, "a")).toBe(false);
    expect(literalFitsControl(ModelColumnControl.ChoiceList, [1])).toBe(false);
    expect(literalFitsControl(ModelColumnControl.ChoiceList, [""])).toBe(false);
  });

  test("one option takes text", () => {
    expect(literalFitsControl(ModelColumnControl.Choice, "a")).toBe(true);
    expect(literalFitsControl(ModelColumnControl.Choice, 1)).toBe(false);
  });

  test("a date takes a date", () => {
    expect(literalFitsControl(ModelColumnControl.DateOnly, "2026-11-20")).toBe(
      true,
    );
    expect(literalFitsControl(ModelColumnControl.DateOnly, "soon")).toBe(false);
  });
});

describe("every kind of record with custom fields", () => {
  test("is known, so the builder can read their definitions", () => {
    expect(
      CUSTOM_FIELD_RECORD_KINDS.map(
        (kind: { recordTableName: string }): string => {
          return kind.recordTableName;
        },
      ),
    ).toEqual(
      expect.arrayContaining([
        "Incident",
        "Alert",
        "Monitor",
        "ScheduledMaintenance",
        "StatusPage",
        "OnCallDutyPolicy",
        "Team",
        "InventoryItem",
        "SecurityCase",
      ]),
    );
  });
});
